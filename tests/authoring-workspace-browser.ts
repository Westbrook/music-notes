import type { MusicSurface } from '../src/components/index.js';
import type { Annotation, MusicEvent, Score } from '../src/model/types.js';
import type { AuthorProject } from '../src/authoring/types.js';
import type { SystemGeometry } from '../src/engraving/render.js';
import { readScore } from '../src/dom/index.js';
import { pitchText } from '../src/model/index.js';
import { authorActiveElement, authorControlParent, queryAuthorControl } from './author-fixture.js';

// These routes use actual Author controls. Static checks do not qualify geometry
// or trusted input; use results from a fresh browser run.

interface Action { kind: 'click' | 'choice' | 'text' | 'key' | 'scroll'; target: string; value?: string }
interface Fixture { frame: HTMLIFrameElement; doc: Document; view: Window; workspace: string; actions: Action[]; confirmations: string[]; confirmReply: boolean | null; printRequests: number }
interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Snapshot { source: string; music: string; revision: number; cursor: object; palette: object; undo: boolean; redo: boolean }
interface Outcome { detail: string; metrics?: Record<string, unknown> }
interface Test { gate: string; name: string; run: () => Promise<Outcome> }
interface Result extends Outcome { gate: string; name: string; passed: boolean }
interface Geometry { root: MusicSurface; system: SystemGeometry; svg: SVGSVGElement }
interface InkMetrics { staffSpace: number; notehead: { width: number; height: number }; scale: { x: number; y: number } }

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const visualFixtures = document.querySelector<HTMLElement>('#visual-fixtures')!;
const visualStatus = document.querySelector<HTMLElement>('#visual-status')!;
const visualButtons = [...document.querySelectorAll<HTMLButtonElement>('.visual-controls button')];
const ownedKeys = new Set<string>();
const tabNames = ['rhythm', 'markings', 'measure'] as const;
const taskNames = ['edit', ...tabNames] as const;
const panels = { edit: 'selection-inspector', rhythm: 'passage-inspector', markings: 'annotation-inspector', measure: 'measure-inspector' } as const;
// Header-sized controls reserve one desktop row and two phone rows. Preserve
// actual ink, target, and no-overlap checks within the resulting score region.
const limits = { desktopFirstInk: 241, phoneFirstInk: 261, desktopScore: 399, shortScore: 150, shortPendingScore: 139,
  target: 43.75, pinnedScore: 719 } as const;
const tests: Test[] = [];
let token = '';
let sequence = 0;
let busy = false;
let latestFixture: Fixture | undefined;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}
function setBusy(value: boolean): void { busy = value; runButton.disabled = value; visualButtons.forEach(button => { button.disabled = value; }); }
async function watchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: did not complete within 20 seconds.`)), 20_000); })]); }
  finally { clearTimeout(timer); }
}
async function frames(fixture: Fixture): Promise<void> {
  await watchdog(new Promise<void>(resolve => fixture.view.requestAnimationFrame(() => fixture.view.requestAnimationFrame(() => resolve()))), 'Observe the actual frame layout');
}
async function waitFor(fixture: Fixture, check: () => boolean, label: string): Promise<void> {
  let observer: MutationObserver | undefined; let animation = 0;
  try {
    await watchdog(new Promise<void>((resolve, reject) => {
      const inspect = () => { try { if (check()) resolve(); } catch (error) { reject(error); } };
      const frame = () => { inspect(); animation = fixture.view.requestAnimationFrame(frame); };
      observer = new MutationObserver(inspect); observer.observe(fixture.doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      animation = fixture.view.requestAnimationFrame(frame); inspect();
    }), label);
  } finally { observer?.disconnect(); fixture.view.cancelAnimationFrame(animation); }
}
function field<T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string): T {
  const value = queryAuthorControl<T>(fixture.doc, selector); assert(value, `The actual workspace is missing ${selector}.`); return value;
}
function value(fixture: Fixture, selector: string): string { return field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(fixture, selector).value; }
function visible(fixture: Fixture, element: Element): boolean {
  const style = fixture.view.getComputedStyle(element); return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}
function click(fixture: Fixture, selector: string): void {
  const element = field(fixture, selector); assert(visible(fixture, element), `${selector} must be visible before use.`);
  assert(!('disabled' in element) || !element.disabled, `${selector} is unexpectedly disabled.`);
  fixture.actions.push({ kind: 'click', target: selector }); element.focus(); element.click();
}
function changeEvent(fixture: Fixture, element: HTMLElement, type: string): void {
  const event = fixture.doc.createEvent('Event'); event.initEvent(type, true, false); element.dispatchEvent(event);
}
function choose(fixture: Fixture, selector: string, choice: string): void {
  const select = field<HTMLSelectElement>(fixture, selector);
  assert(visible(fixture, select) && !select.disabled, `${selector} must be available as a native choice.`);
  assert([...select.options].some(option => option.value === choice), `${selector} has no ${JSON.stringify(choice)} option.`);
  fixture.actions.push({ kind: 'choice', target: selector, value: choice }); select.focus(); select.value = choice;
  changeEvent(fixture, select, 'input'); changeEvent(fixture, select, 'change');
}
function write(fixture: Fixture, selector: string, text: string): void {
  const input = field<HTMLInputElement | HTMLTextAreaElement>(fixture, selector); assert(visible(fixture, input) && !input.disabled, `${selector} must be available for writing.`);
  fixture.actions.push({ kind: 'text', target: selector, value: selector === '#source-input' ? '(fixture source)' : text }); input.focus(); input.value = text;
  changeEvent(fixture, input, 'input'); changeEvent(fixture, input, 'change');
}
function check(fixture: Fixture, selector: string, checked: boolean): void {
  const input = field<HTMLInputElement>(fixture, selector); if (input.checked !== checked) click(fixture, selector);
  equal(input.checked, checked, `${selector} must retain the chosen checkbox state`);
}
function closestControl(element: HTMLElement, selector: string): HTMLElement | null {
  for (let current: HTMLElement | null = element; current; current = authorControlParent(current)) if (current.matches(selector)) return current;
  return null;
}
function key(fixture: Fixture, target: HTMLElement, name: string, modifiers: KeyboardEventInit = {}): void {
  assert(visible(fixture, target) && !closestControl(target, '[inert]'), `Keyboard target #${target.id} must be visible and interactive.`);
  fixture.actions.push({ kind: 'key', target: `#${target.id}`, value: `${modifiers.ctrlKey ? 'Control+' : ''}${modifiers.shiftKey ? 'Shift+' : ''}${name}` });
  target.focus({ preventScroll: true }); target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true, ...modifiers }));
}
function source(fixture: Fixture): string { return value(fixture, '#source-input'); }
function revision(fixture: Fixture): number { return Number(fixture.doc.body.dataset.authorRevision); }
function surface(fixture: Fixture): MusicSurface {
  const root = field(fixture, '#score-host').shadowRoot?.querySelector<MusicSurface>('music-system, music-staff');
  assert(root && typeof root.renderComplete?.then === 'function', 'The actual workspace must use a public notation surface.'); return root;
}
function score(fixture: Fixture): Score { const parsed = surface(fixture).score; assert(parsed, 'The accepted score is unavailable.'); return parsed; }
function events(fixture: Fixture): MusicEvent[] { return score(fixture).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events]))); }
function annotations(fixture: Fixture): Annotation[] { return score(fixture).staves.flatMap(staff => staff.measures.flatMap(measure => [...measure.annotations])); }
function eventById(fixture: Fixture, id: string): MusicEvent { const event = events(fixture).find(event => event.id === id); assert(event, `Missing accepted source event ${id}.`); return event; }
function pitch(event: MusicEvent): string { const p = event.pitches[0]; assert(p, 'A pitched event is required.'); return pitchText(p); }
function music(fixture: Fixture): string {
  const root = surface(fixture);
  return JSON.stringify(score(fixture).staves.map(staff => ({ ...staff, measures: staff.measures.map(measure => ({ ...measure,
    voices: measure.voices.map(voice => ({ ...voice, id: root.getSource(voice.id)?.localName === 'music-voice' ? voice.id : { implicitVoiceOf: measure.id } })),
  })) })));
}
function canonicalSource(fixture: Fixture, html: string): string {
  const template = fixture.doc.createElement('template'); template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const attributes = [...element.attributes].map(attribute => [attribute.name, attribute.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
  return template.innerHTML;
}
function cursor(fixture: Fixture): object {
  return { staff: value(fixture, '#staff-select'), measure: value(fixture, '#measure-select'), voice: value(fixture, '#event-voice'),
    event: queryAuthorControl<HTMLElement>(fixture.doc, '#event-navigator [data-source-id][aria-pressed="true"]')?.dataset.sourceId ?? null };
}
function palette(fixture: Fixture): object {
  return { ...Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-duration', 'event-dots', 'insert-position', 'event-accidental-display', 'event-stem', 'event-beam']
    .map(id => [id, value(fixture, `#${id}`)])),
    'event-measure-rest': field<HTMLInputElement>(fixture, '#event-measure-rest').checked,
    'event-rhythmic': field<HTMLInputElement>(fixture, '#event-rhythmic').checked };
}
function snapshot(fixture: Fixture): Snapshot {
  return { source: source(fixture), music: music(fixture), revision: revision(fixture), cursor: cursor(fixture), palette: palette(fixture),
    undo: !field<HTMLButtonElement>(fixture, '#undo').disabled, redo: !field<HTMLButtonElement>(fixture, '#redo').disabled };
}
function unchanged(fixture: Fixture, before: Snapshot, label: string, selection = true): void {
  equal(source(fixture), before.source, `${label}: accepted Source must remain byte-for-byte unchanged`);
  equal(music(fixture), before.music, `${label}: musical values and real identities must remain unchanged`);
  equal(revision(fixture), before.revision, `${label}: authored revision must not change`);
  equal([!field<HTMLButtonElement>(fixture, '#undo').disabled, !field<HTMLButtonElement>(fixture, '#redo').disabled], [before.undo, before.redo], `${label}: Undo/Redo availability must remain unchanged`);
  if (selection) equal(cursor(fixture), before.cursor, `${label}: source selection must remain unchanged`);
}
async function settle(fixture: Fixture): Promise<void> {
  await waitFor(fixture, () => fixture.doc.body.dataset.authorReady === 'true' && fixture.doc.body.dataset.renderState !== 'rendering', 'Finish the actual workspace render');
  assert(fixture.doc.body.dataset.renderState === 'ready', `Workspace rendering failed: ${field(fixture, '#author-errors').textContent}`);
  await watchdog(fixture.doc.fonts.ready, 'Load the bundled notation fonts'); await watchdog(surface(fixture).renderComplete, 'Finish the public notation render');
  const errors = surface(fixture).diagnostics.filter(error => error.severity === 'error');
  assert(!errors.length, `Accepted music contains errors: ${errors.map(error => error.message).join(' ')}`);
}
async function mutate(fixture: Fixture, action: () => void, accepted: () => boolean, label: string): Promise<Snapshot> {
  const before = snapshot(fixture); action();
  await waitFor(fixture, () => revision(fixture) === before.revision + 1 && fixture.doc.body.dataset.renderState === 'ready' && accepted(), label);
  await settle(fixture); return before;
}
async function undo(fixture: Fixture, before: Snapshot): Promise<void> {
  if (fixture.doc.body.dataset.toolsPresentation === 'sheet') await tools(fixture, false);
  const previous = revision(fixture); key(fixture, field(fixture, '#score-editor'), 'z', { ctrlKey: true });
  await waitFor(fixture, () => revision(fixture) === previous + 1 && fixture.doc.body.dataset.renderState === 'ready'
    && canonicalSource(fixture, source(fixture)) === canonicalSource(fixture, before.source), 'Undo exactly one musical transaction');
  await settle(fixture); equal(music(fixture), before.music, 'Undo must restore the complete prior musical model'); equal(cursor(fixture), before.cursor, 'Undo must restore staff, measure, voice, and event selection');
}
async function popup(fixture: Fixture, trigger: string, panel: string, open: boolean): Promise<void> {
  const element = field(fixture, panel); equal(element.getAttribute('popover'), 'auto', `${panel} must use the native auto-popover contract`);
  if (element.matches(':popover-open') === open) return;
  if (open) click(fixture, trigger);
  else {
    const hide = element.querySelector<HTMLButtonElement>(`button[popovertarget="${element.id}"][popovertargetaction="hide"]`);
    if (hide?.id) click(fixture, `#${hide.id}`); else click(fixture, trigger);
  }
  await waitFor(fixture, () => element.matches(':popover-open') === open, `${open ? 'Open' : 'Close'} ${panel} through its native invoker`); await frames(fixture);
}
async function applySource(fixture: Fixture, html: string): Promise<void> {
  // A deliberately valid setup must pass the public DOM reader before it is
  // offered to Author. Invalid-source journeys stage their text directly.
  const holder = fixture.doc.createElement('template'); holder.innerHTML = html;
  const root = holder.content.firstElementChild;
  assert(root && holder.content.children.length === 1, 'Fixture authoring error: valid setup needs exactly one musical root.');
  const parsed = readScore(root); const errors = parsed.diagnostics.filter(item => item.severity === 'error');
  assert(errors.length === 0, `Fixture authoring error before Source Apply: ${errors.map(item => `${item.code} (${item.sourceId}): ${item.message}`).join(' ')}`);
  const project = await recoverableProject(fixture);
  const staffIds = new Set(parsed.score.staves.map(staff => staff.id));
  const annotationIds = new Set(parsed.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations.map(annotation => annotation.id))));
  const partIds = new Set(project.parts.map(part => part.id));
  for (const part of project.parts) for (const staffId of part.staffIds) {
    assert(staffIds.has(staffId), `Fixture metadata error before Source Apply: part ${part.label || part.id} still names removed staff ${staffId}. Preserve or explicitly repair the fixture's part membership first.`);
  }
  for (const [id, recipients] of Object.entries(project.instructionScopes)) {
    assert(annotationIds.has(id), `Fixture metadata error before Source Apply: instruction scope ${id} would lose its canonical annotation. Preserve or explicitly repair the fixture's scope first.`);
    if (recipients !== 'all') for (const partId of recipients) assert(partIds.has(partId), `Fixture metadata error before Source Apply: instruction ${id} names missing part ${partId}.`);
  }
  await popup(fixture, '#source-trigger', '#source-panel', true); write(fixture, '#source-input', html);
  const before = revision(fixture); click(fixture, '#source-apply');
  await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready', 'Apply the valid fixture source');
  await settle(fixture); await popup(fixture, '#source-trigger', '#source-panel', false);
}
async function template(fixture: Fixture, name: 'blank' | 'lead' | 'piano' | 'ensemble'): Promise<void> {
  await popup(fixture, '#document-menu-trigger', '#document-menu', true); choose(fixture, '#new-template', name);
  const before = revision(fixture); click(fixture, '#new-project');
  await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready', `Load the real ${name} composition template`); await settle(fixture);
}
async function location(fixture: Fixture, measure: string, staff?: string, voice?: string): Promise<void> {
  await popup(fixture, '#location-trigger', '#location-panel', true);
  if (staff) choose(fixture, '#staff-select', staff); choose(fixture, '#measure-select', measure); if (voice) choose(fixture, '#event-voice', voice);
  await popup(fixture, '#location-trigger', '#location-panel', false); await frames(fixture); await settle(fixture);
}
async function tools(fixture: Fixture, open: boolean): Promise<void> {
  if (visible(fixture, field(fixture, '#workspace-tools')) !== open) click(fixture, open
    ? field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true' ? '#tools-toggle' : '#edit-selected-event'
    : '#tools-hide');
  await waitFor(fixture, () => visible(fixture, field(fixture, '#workspace-tools')) === open, `${open ? 'Show' : 'Hide'} persistent tools`); await frames(fixture); await settle(fixture);
}
async function tab(fixture: Fixture, name: typeof taskNames[number]): Promise<void> {
  await tools(fixture, true);
  if (name === 'edit') {
    if (!visible(fixture, field(fixture, '#selection-inspector'))) click(fixture, '#back-to-properties');
    await waitFor(fixture, () => visible(fixture, field(fixture, '#selection-inspector'))
      && field(fixture, '#workspace-tools').dataset.toolsView === 'properties', 'Show the separate Properties task');
    await frames(fixture); await settle(fixture); return;
  }
  if (!visible(fixture, field(fixture, '#tools-tablist'))) click(fixture, '#other-tools');
  click(fixture, `#tool-tab-${name}`);
  await waitFor(fixture, () => field(fixture, `#tool-tab-${name}`).getAttribute('aria-selected') === 'true'
    && visible(fixture, field(fixture, `#${panels[name]}`)), `Activate the ${name} task panel`); await frames(fixture); await settle(fixture);
}
function geometry(fixture: Fixture, sourceId: string): Geometry {
  const root = surface(fixture); const layout = root.getLayoutGeometry(); assert(layout && layout.revision === root.renderRevision, 'Current public geometry is required.');
  const system = layout.systems.find(system => [...system.events, ...system.measures, ...system.annotations, ...system.staves].some(item => item.sourceId === sourceId));
  assert(system, `No rendered system contains ${sourceId}.`);
  const svg = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)[system.index]; assert(svg, 'A system must map to its actual rendered SVG.'); return { root, system, svg };
}
function screenBox(svg: SVGSVGElement, ink: { x: number; y: number; width: number; height: number }): Box {
  const matrix = svg.getScreenCTM(); assert(matrix, 'The actual SVG must have a screen transform.');
  const points = [[ink.x, ink.y], [ink.x + ink.width, ink.y], [ink.x, ink.y + ink.height], [ink.x + ink.width, ink.y + ink.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
  const left = Math.min(...points.map(point => point.x)); const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x)); const bottom = Math.max(...points.map(point => point.y)); return { left, top, right, bottom, width: right - left, height: bottom - top };
}
function box(element: Element): Box { const { left, top, right, bottom, width, height } = element.getBoundingClientRect(); return { left, top, right, bottom, width, height }; }
function eventBox(fixture: Fixture, id: string): Box { const context = geometry(fixture, id); const event = context.system.events.find(event => event.sourceId === id); assert(event, `No event ink for ${id}.`); return screenBox(context.svg, event.ink); }
async function reveal(fixture: Fixture, id: string, fraction = 0.5): Promise<void> {
  const scroller = field(fixture, '#score-scroll'); const ink = eventBox(fixture, id); const viewport = box(scroller);
  scroller.scrollTop += ink.top - viewport.top - viewport.height * fraction;
  await frames(fixture); await settle(fixture);
}
async function selectEvent(fixture: Fixture, id: string): Promise<void> {
  if (fixture.doc.body.dataset.toolsPresentation === 'sheet') await tools(fixture, false);
  if (field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true') click(fixture, '#select-mode');
  await reveal(fixture, id); const context = geometry(fixture, id);
  const group = [...context.svg.querySelectorAll<SVGGraphicsElement>('[data-source-id]')].find(element => element.dataset.sourceId === id); assert(group, `The actual engraved ${id} must be selectable.`);
  const ink = eventBox(fixture, id); fixture.actions.push({ kind: 'click', target: `[data-source-id="${id}"]` });
  group.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1, clientX: (ink.left + ink.right) / 2, clientY: (ink.top + ink.bottom) / 2, view: fixture.view }));
  await frames(fixture); await settle(fixture);
}
async function recoverableProject(fixture: Fixture): Promise<AuthorProject> {
  let project: AuthorProject | undefined;
  await waitFor(fixture, () => {
    const raw = fixture.view.localStorage.getItem(`music-notes.author.recovery.v1:${fixture.workspace}`); if (!raw) return false;
    const record = JSON.parse(raw) as { project?: AuthorProject }; project = record.project;
    const status = field(fixture, '#save-status').textContent ?? '';
    return !!project && project.pendingSource === null && project.sourceHtml === source(fixture)
      && /\bsaved\b|\brecovered\b/i.test(status) && !/\bunsaved\b|saving|failed|unavailable|conflict/i.test(status);
  }, 'Observe the fixture’s own saved public project record');
  return project!;
}
function observeConfirmations(fixture: Fixture): void {
  let recordedOpen = false; let recordedMessage = ''; let queued = false; let responded = false;
  const inspect = () => {
    if (!fixture.frame.isConnected) { observer.disconnect(); return; }
    const dialog = fixture.doc.querySelector<HTMLDialogElement>('#author-confirmation');
    if (!dialog?.open) { recordedOpen = false; recordedMessage = ''; responded = false; return; }
    const message = fixture.doc.querySelector<HTMLElement>('#author-confirmation-message');
    if (!message || !visible(fixture, dialog) || !visible(fixture, message) || !message.textContent?.trim()) return;
    if (!recordedOpen || recordedMessage !== message.textContent) { fixture.confirmations.push(message.textContent); recordedOpen = true; recordedMessage = message.textContent; }
    if (fixture.confirmReply === null || queued || responded) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!fixture.frame.isConnected || !dialog.open || fixture.confirmReply === null || responded) return;
      const selector = fixture.confirmReply ? '#author-confirmation-confirm' : '#author-confirmation-cancel';
      const button = fixture.doc.querySelector<HTMLButtonElement>(selector);
      if (button && !button.disabled && visible(fixture, button)) { responded = true; click(fixture, selector); }
    });
  };
  const observer = new MutationObserver(inspect);
  observer.observe(fixture.doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  fixture.view.addEventListener('pagehide', () => observer.disconnect(), { once: true }); inspect();
}
async function mount(label: string, width = 1180, height = 660, container = fixtures): Promise<Fixture> {
  token ||= crypto.randomUUID(); const workspace = `test-workspace-${token}-${++sequence}`; const recoveryKey = `music-notes.author.recovery.v1:${workspace}`;
  assert(localStorage.getItem(recoveryKey) === null, 'A fixture must never replace an existing recovery record.'); ownedKeys.add(recoveryKey);
  const article = document.createElement('article'); article.className = 'fixture'; article.dataset.workspace = workspace;
  const heading = document.createElement('h3'); heading.textContent = label;
  const note = document.createElement('p'); note.className = 'fixture-note'; note.textContent = 'Actual Author workspace; synthetic controls, isolated recovery, public notation geometry. ';
  const viewport = document.createElement('div'); viewport.className = 'viewport'; const frame = document.createElement('iframe'); frame.title = label; frame.style.width = `${width}px`; frame.style.height = `${height}px`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true })); frame.src = `/author.html?workspace=${workspace}`;
  const link = document.createElement('a'); link.href = frame.src; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open this isolated workspace'; note.append(link);
  viewport.append(frame); article.append(heading, note, viewport); container.append(article); await watchdog(loaded, 'Load the actual workspace fixture');
  assert(frame.contentDocument && frame.contentWindow, 'The test iframe must remain on the same origin.');
  const fixture: Fixture = { frame, doc: frame.contentDocument, view: frame.contentWindow, workspace, actions: [], confirmations: [], confirmReply: true, printRequests: 0 }; latestFixture = fixture;
  observeConfirmations(fixture);
  fixture.view.print = () => { fixture.printRequests++; };
  await settle(fixture); return fixture;
}
function leadSource(count: number, ending = '', incompleteMeasures: readonly number[] = []): string {
  return `<music-staff id="blank-staff" label="Journey lead" clef="treble" key="C" meter="4/4">${Array.from({ length: count }, (_, index) => {
    const n = index + 1; return `<music-measure id="${n === 1 ? 'blank-m1' : `journey-m${n}`}"${n === count && ending ? ` end-bar="${ending}"` : ''}${incompleteMeasures.includes(n) ? ' incomplete' : ''}><music-note id="journey-n${n}a" pitch="F4" duration="half"></music-note><music-note id="journey-n${n}b" pitch="A4" duration="half"></music-note></music-measure>`;
  }).join('')}</music-staff>`;
}
function ensembleSource(count: number): string {
  // These fixtures retain every scoped annotation from the real Ensemble
  // template, at its original staff/bar and canonical ID. The fixture changes
  // the pulse to 4/4, so its authored marking and harmony text state that idea.
  const instructions: Record<string, string> = {
    'ensemble-flute-m1': '<music-tempo id="ensemble-tempo" marking="Light, in four" bpm="108" beat="quarter"></music-tempo><music-rehearsal id="ensemble-rehearsal-a" text="A"></music-rehearsal><music-harmony id="ensemble-m1-harmony" text="Cmaj9"></music-harmony><music-dynamics id="ensemble-flute-dynamics" level="mf"></music-dynamics>',
    'ensemble-flute-m2': '<music-harmony id="ensemble-m2-harmony" text="Fmaj9"></music-harmony>',
    'ensemble-flute-m3': '<music-rehearsal id="ensemble-rehearsal-b" text="B"></music-rehearsal><music-direction id="ensemble-pulse-instruction" text="Keep the quarter-note pulse."></music-direction><music-direction id="ensemble-flute-instruction" text="Leave space around the written line."></music-direction><music-harmony id="ensemble-m3-harmony" text="Dm9"></music-harmony>',
    'ensemble-flute-m4': '<music-harmony id="ensemble-m4-harmony" text="G13"></music-harmony>',
    'ensemble-vibes-m1': '<music-dynamics id="ensemble-vibes-dynamics" level="p"></music-dynamics>',
    'ensemble-vibes-m3': '<music-direction id="ensemble-vibes-instruction" text="Sustain with space."></music-direction>',
    'ensemble-cello-m1': '<music-dynamics id="ensemble-cello-dynamics" level="mp"></music-dynamics>',
  };
  return `<music-system id="ensemble-score" label="Long session" meter="4/4" key="C">${[['ensemble-flute', 'Flute', 'treble', 'C5'], ['ensemble-vibes', 'Vibraphone', 'treble', 'G4'], ['ensemble-cello', 'Cello', 'bass', 'C3']].map(([id, label, clef, note]) =>
    `<music-staff id="${id}" label="${label}" clef="${clef}">${Array.from({ length: count }, (_, index) => {
      const n = index + 1; const base = `${id}-m${n}`; return `<music-measure id="${base}">${instructions[base] ?? ''}<music-voice id="${base}-v1"><music-note id="${base}-n1" pitch="${note}" duration="whole"></music-note></music-voice><music-voice id="${base}-v2"><music-rest id="${base}-r2" measure></music-rest></music-voice></music-measure>`;
    }).join('')}</music-staff>`).join('')}</music-system>`;
}

async function resize(fixture: Fixture, width: number, height = fixture.view.innerHeight): Promise<void> {
  fixture.frame.style.width = `${width}px`; fixture.frame.style.height = `${height}px`;
  await waitFor(fixture, () => fixture.view.innerWidth === width && fixture.view.innerHeight === height, 'Resize the actual iframe viewport');
  await frames(fixture); await settle(fixture); await frames(fixture);
}
async function recipe(fixture: Fixture, options: { kind?: string; pitch?: string; duration?: string; dots?: string; position?: string; continuation?: boolean } = {}): Promise<void> {
  await tools(fixture, false); await enter(fixture);
  await popup(fixture, '#entry-settings-trigger', '#entry-settings', true);
  if (options.kind) choose(fixture, '#event-kind', options.kind);
  if (options.pitch) write(fixture, '#event-pitch', options.pitch);
  if (options.position) choose(fixture, '#insert-position', options.position);
  if (options.continuation !== undefined) check(fixture, '#continuation-enabled', options.continuation);
  await popup(fixture, '#entry-settings-trigger', '#entry-settings', false);
  if (options.duration !== undefined || options.dots !== undefined) {
    await popup(fixture, '#entry-value-trigger', '#entry-value-chooser', true);
    if (options.duration !== undefined) choose(fixture, '#event-duration', options.duration);
    if (options.dots !== undefined) choose(fixture, '#event-dots', options.dots);
    await popup(fixture, '#entry-value-trigger', '#entry-value-chooser', false);
  }
}
async function startHere(fixture: Fixture): Promise<void> {
  await popup(fixture, '#location-trigger', '#location-panel', true); click(fixture, '#start-entry-here');
  await frames(fixture); await settle(fixture);
  if (field(fixture, '#location-panel').matches(':popover-open')) await popup(fixture, '#location-trigger', '#location-panel', false);
}
async function enter(fixture: Fixture): Promise<void> {
  if (field(fixture, '#toggle-entry').getAttribute('aria-pressed') !== 'true') click(fixture, '#toggle-entry');
  await frames(fixture);
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'The fixed Write control resumes a valid saved destination; missing locations require explicit Start writing here');
}
async function insert(fixture: Fixture, expectedNotes: number, keyboard = false): Promise<Snapshot> {
  return mutate(fixture, () => keyboard ? key(fixture, field(fixture, '#score-editor'), 'f') : click(fixture, '#insert-event'),
    () => events(fixture).filter(event => event.kind === 'note').length === expectedNotes, 'Accept exactly one note through the primary writing action');
}
function assertQuarterBars(fixture: Fixture, count: number): void {
  equal(score(fixture).staves.length, 1, 'The Blank writing journey must keep one canonical staff');
  const bars = score(fixture).staves[0].measures; equal(bars.length, count, 'Continuation must not create a trailing empty measure');
  const ids = new Set<string>();
  for (const [index, measure] of bars.entries()) {
    equal(measure.voices.length, 1, `Measure ${index + 1} must retain one voice`);
    equal(measure.voices[0].events.length, 4, `Measure ${index + 1} must contain four accepted entries`);
    for (const [beat, event] of measure.voices[0].events.entries()) {
      assert(event.kind === 'note' && event.duration === 'quarter' && event.dots === 0, 'Each continuation entry must remain a written quarter note.');
      equal(event.onset.numerator * 4, beat * event.onset.denominator, 'Each quarter must occupy its exact rational onset');
      equal(event.time.numerator * 4, event.time.denominator, 'Quarter duration must remain exact');
      assert(!ids.has(event.id), 'Appended musical events must keep unique canonical source identities.'); ids.add(event.id);
    }
  }
}
function ranges(fixture: Fixture): number[][] { return surface(fixture).getLayoutGeometry()!.systems.map(system => [system.start, system.end]); }
function clipBox(fixture: Fixture): Box {
  const scroller = field(fixture, '#score-scroll'); const outer = box(scroller);
  const left = Math.max(0, outer.left + scroller.clientLeft); const top = Math.max(0, outer.top + scroller.clientTop);
  const right = Math.min(fixture.view.innerWidth, outer.left + scroller.clientLeft + scroller.clientWidth);
  const bottom = Math.min(fixture.view.innerHeight, outer.top + scroller.clientTop + scroller.clientHeight);
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function overlaps(a: Box, b: Box, tolerance = 0.25): boolean {
  return a.left < b.right - tolerance && a.right > b.left + tolerance && a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
}
function inside(inner: Box, outer: Box, tolerance = 0.75): boolean {
  return inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
}
function expectedPaletteLayout(fixture: Fixture): { height: number; rows: number; rowGap: number; controlSize: number } {
  const rootSize = Number.parseFloat(fixture.view.getComputedStyle(fixture.doc.documentElement).fontSize);
  const controlSize = Math.max(44, 2.75 * rootSize);
  const phone = fixture.view.innerWidth <= 760;
  const short = fixture.view.innerHeight <= 480;
  const rows = field(fixture, '#author-workbench').clientWidth <= Math.max(760, 47.5 * rootSize) ? 2 : 1;
  const rowGap = phone ? 2 : fixture.view.innerWidth <= 1099 ? 8 : 14;
  const padding = short ? 2 : phone ? 4 : 6;
  // The mode enclosure adds two border pixels; the dock has one top divider.
  const height = Math.max(short ? 48 : 60, controlSize + 2 + (rows - 1) * (controlSize + rowGap) + 2 * padding + 1);
  return { height, rows, rowGap, controlSize };
}
function layoutMetrics(fixture: Fixture): Record<string, unknown> {
  const root = surface(fixture); const layout = root.getLayoutGeometry()!; const svgs = [...root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)];
  const clip = clipBox(fixture); const strip = box(field(fixture, '#workspace-dock'));
  const music = layout.systems.map(system => screenBox(svgs[system.index], system.ink));
  const firstInk = Math.min(...music.filter(ink => overlaps(ink, clip)).map(ink => ink.top));
  const noteheads = layout.systems.flatMap(system => system.events.flatMap(event => (event.noteheads ?? []).map(head => screenBox(svgs[system.index], head))));
  const visibleHeads = noteheads.filter(head => inside(head, clip));
  // The reserved control strip may not be counted as useful score space even if
  // a broken CSS rule accidentally overlays it inside the scroll viewport.
  const stripOverlap = overlaps(strip, clip) ? Math.max(0, Math.min(strip.bottom, clip.bottom) - Math.max(strip.top, clip.top)) : 0;
  const usableHeight = Math.max(0, clip.height - stripOverlap);
  const controls = [...field(fixture, '#workspace-dock').querySelectorAll<HTMLButtonElement>('button')]
    .filter(control => visible(fixture, control)).map(control => ({ selector: `#${control.id}`, ...box(control) }));
  assert(visibleHeads.length > 0, 'At least one ordinary, fully visible notehead is required; a tempo mark or blank SVG does not establish useful notation.');
  for (const head of visibleHeads) assert(!overlaps(head, strip), 'A visible ordinary notehead must not sit underneath the writing strip.');
  assert(fixture.doc.documentElement.scrollWidth <= fixture.doc.documentElement.clientWidth + 1, 'The application must not cause unintended document-level horizontal scrolling.');
  return { viewport: [fixture.view.innerWidth, fixture.view.innerHeight], firstInk, usableHeight, clip, strip, visibleNoteheads: visibleHeads.length, controls, ranges: ranges(fixture) };
}
function inkMetrics(root: MusicSurface, id: string): InkMetrics {
  const layout = root.getLayoutGeometry(); assert(layout, 'Public geometry must exist for scale comparison.');
  const system = layout.systems.find(system => system.events.some(event => event.sourceId === id)); assert(system, `No scale reference for ${id}.`);
  const event = system.events.find(event => event.sourceId === id)!; const staff = system.staves.find(staff => staff.sourceId === event.staffId);
  const head = event.noteheads?.[0]; assert(staff && head, 'Scale comparison requires an ordinary pitched staff and a real notehead.');
  const svg = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)[system.index]; const matrix = svg.getScreenCTM(); assert(matrix, 'A current notation transform is required.');
  const top = new DOMPoint(0, staff.topLine).matrixTransform(matrix); const bottom = new DOMPoint(0, staff.bottomLine).matrixTransform(matrix);
  const headBounds = screenBox(svg, head);
  return { staffSpace: Math.hypot(bottom.x - top.x, bottom.y - top.y) / 4,
    notehead: { width: headBounds.width, height: headBounds.height }, scale: { x: Math.hypot(matrix.a, matrix.b), y: Math.hypot(matrix.c, matrix.d) } };
}
async function neutralMetrics(fixture: Fixture, id: string): Promise<InkMetrics> {
  // This separate public notation surface is an intrinsic-size reference, not
  // an app controller hook. Its shadow boundary excludes authoring CSS. Only
  // this disposable reference is given intrinsic SVG dimensions.
  const host = fixture.doc.createElement('div'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1180px;height:auto;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'open' }); const holder = fixture.doc.createElement('template'); holder.innerHTML = source(fixture);
  shadow.append(holder.content); fixture.doc.body.append(host);
  try {
    const root = shadow.querySelector<MusicSurface>('music-system,music-staff'); assert(root, 'Neutral reference must use the same accepted musical source.');
    await watchdog(fixture.doc.fonts.ready, 'Load reference notation fonts'); await watchdog(root.renderComplete, 'Render an independent notation reference');
    const layout = root.getLayoutGeometry(); assert(layout, 'The neutral public surface must publish geometry.');
    const svgs = [...root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)];
    for (const system of layout.systems) { const svg = svgs[system.index]; svg.style.width = `${system.viewBox.width}px`; svg.style.height = `${system.viewBox.height}px`; svg.style.maxWidth = 'none'; svg.style.transform = 'none'; }
    await frames(fixture); return inkMetrics(root, id);
  } finally { host.remove(); }
}
function equalScale(actual: InkMetrics, baseline: InkMetrics, context: string): void {
  assert(Math.abs(actual.staffSpace - baseline.staffSpace) <= 0.1, `${context}: ordinary staff spacing changed from ${baseline.staffSpace} to ${actual.staffSpace} CSS px.`);
  for (const dimension of ['width', 'height'] as const) assert(Math.abs(actual.notehead[dimension] - baseline.notehead[dimension]) <= 0.25, `${context}: the same notehead ${dimension} must match its intrinsic-size reference.`);
  for (const axis of ['x', 'y'] as const) assert(Math.abs(actual.scale[axis] / baseline.scale[axis] - 1) <= 0.01, `${context}: the actual notation ${axis} scale must remain within one percent of intrinsic size.`);
}
async function addChord(fixture: Fixture): Promise<void> {
  await popup(fixture, '#location-trigger', '#location-panel', true); click(fixture, '#add-chord-symbol');
  await waitFor(fixture, () => visible(fixture, field(fixture, '#annotation-inspector')) && authorActiveElement(fixture.doc)?.id === 'annotation-text', 'Open chord entry directly with text focus');
  await frames(fixture); await settle(fixture);
}
async function showNested(fixture: Fixture, selector: string): Promise<void> {
  const element = field(fixture, selector); const disclosures: HTMLDetailsElement[] = [];
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) if (parent.localName === 'details') disclosures.unshift(parent as HTMLDetailsElement);
  for (const details of disclosures) if (!details.open) { const summary = details.querySelector<HTMLElement>(':scope > summary'); assert(summary, 'An inline disclosure needs its native summary.'); summary.click(); }
  await frames(fixture);
}
function draftTarget(fixture: Fixture, form: 'measure' | 'annotation'): string {
  const panel = field(fixture, form === 'measure' ? '#measure-inspector' : '#annotation-inspector');
  return `${panel.dataset.draftTarget ?? ''} ${field(fixture, form === 'measure' ? '#measure-draft-status' : '#annotation-draft-target').textContent ?? ''}`;
}
function draftStatus(fixture: Fixture, form: 'measure' | 'annotation'): string {
  const panel = field(fixture, form === 'measure' ? '#measure-inspector' : '#annotation-inspector');
  const status = field(fixture, `#${form}-draft-status`);
  return `${status.dataset.draftState ?? panel.dataset.draftState ?? panel.dataset.annotationState ?? ''} ${status.textContent ?? ''}`;
}
async function exposeControl(fixture: Fixture, selector: string): Promise<void> {
  const element = field(fixture, selector);
  const panel = closestControl(element, '[role="tabpanel"]');
  if (panel) { const name = tabNames.find(name => panels[name] === panel.id); if (name) await tab(fixture, name); }
  const popover = closestControl(element, '[popover]');
  if (popover && !popover.matches(':popover-open')) {
    const trigger = fixture.doc.querySelector<HTMLButtonElement>(`button[popovertarget="${popover.id}"]:not([popovertargetaction="hide"])`);
    assert(trigger?.id, `The ${popover.id} panel needs an actual native invoker.`); await popup(fixture, `#${trigger.id}`, `#${popover.id}`, true);
  }
  await showNested(fixture, selector);
}
function changeSourceAttribute(fixture: Fixture, id: string, attribute: string, next: string): string {
  const holder = fixture.doc.createElement('template'); holder.innerHTML = source(fixture);
  const element = [...holder.content.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === id); assert(element, `Cannot change missing fixture source ${id}.`);
  element.setAttribute(attribute, next); return holder.innerHTML;
}
async function closeOpenPopovers(fixture: Fixture): Promise<void> {
  for (const panel of fixture.doc.querySelectorAll<HTMLElement>('[popover]:popover-open')) {
    const trigger = fixture.doc.querySelector<HTMLButtonElement>(`button[popovertarget="${panel.id}"]:not([popovertargetaction="hide"])`);
    assert(trigger?.id, `The open ${panel.id} panel must keep its native invoker.`); await popup(fixture, `#${trigger.id}`, `#${panel.id}`, false);
  }
}
async function requireTarget(fixture: Fixture, form: 'measure' | 'annotation', sourceId: string, bar: number): Promise<void> {
  await frames(fixture); const target = draftTarget(fixture, form);
  assert(target.includes(sourceId) || new RegExp(`(?:bar|measure)\\s*${bar}(?:\\D|$)`, 'i').test(target), `The ${form} form must visibly identify its original target, ${sourceId} / bar ${bar}; received ${JSON.stringify(target)}.`);
}

function offset(fixture: Fixture, id: string): { x: number; y: number } {
  const ink = eventBox(fixture, id); const clip = clipBox(fixture); return { x: ink.left - clip.left, y: ink.top - clip.top };
}
function horizontalViewport(fixture: Fixture, id: string): HTMLElement {
  const context = geometry(fixture, id); const row = context.svg.closest<HTMLElement>('.system-row'); const outer = field(fixture, '#score-scroll');
  // MusicSurface intentionally owns native horizontal scrolling per system;
  // the author viewport owns the score's vertical working space. Inspect the
  // actual overflow owner instead of requiring the outer box to overflow too.
  const found = [row, outer].find((element): element is HTMLElement => !!element && element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(fixture.view.getComputedStyle(element).overflowX));
  assert(found, 'Readable wide notation must have an actual contained horizontal scroll viewport.'); return found;
}
function anchorRetained(fixture: Fixture, id: string, before: { x: number; y: number }, context: string): void {
  const current = offset(fixture, id); const scroller = field(fixture, '#score-scroll');
  const clampedY = scroller.scrollTop <= 0.75 || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 0.75;
  const clampedX = scroller.scrollLeft <= 0.75 || scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 0.75;
  if (!clampedY) assert(Math.abs(current.y - before.y) <= 2, `${context}: source ${id} vertical anchor moved ${current.y - before.y}px instead of staying within 2px.`);
  else assert(overlaps(eventBox(fixture, id), clipBox(fixture)), `${context}: a clamped vertical edge must still retain the same identifiable musical anchor.`);
  if (!clampedX) assert(Math.abs(current.x - before.x) <= 2, `${context}: source ${id} horizontal anchor moved ${current.x - before.x}px instead of staying within 2px.`);
}

tests.push(
  {
    gate: 'UX-DRAFT', name: 'Two dirty musical forms survive unrelated note, title, source, and workspace changes',
    async run() {
      const fixture = await mount('Two independent dirty form drafts'); await applySource(fixture, leadSource(8));
      await location(fixture, 'journey-m2'); await tab(fixture, 'measure'); write(fixture, '#measure-meter', '8/8'); await requireTarget(fixture, 'measure', 'journey-m2', 2);
      await location(fixture, 'journey-m4'); await addChord(fixture); write(fixture, '#annotation-text', 'F#m11 — leave space'); await requireTarget(fixture, 'annotation', 'journey-m4', 4);
      await selectEvent(fixture, 'journey-n6a'); await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true);
      await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => pitch(eventById(fixture, 'journey-n6a')) === 'F#4', 'Accept an unrelated note correction'); await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false);
      await exposeControl(fixture, '#project-title'); const metadataRevision = revision(fixture); write(fixture, '#project-title', 'Draft continuity rehearsal');
      await waitFor(fixture, () => revision(fixture) > metadataRevision, 'Accept the independent document title'); await settle(fixture); await closeOpenPopovers(fixture);
      for (const name of tabNames) await tab(fixture, name); await resize(fixture, 390); await resize(fixture, 1180);
      await tab(fixture, 'measure'); equal(value(fixture, '#measure-meter'), '8/8', 'Dirty meter must survive unrelated note, title, tabs, and width changes'); await requireTarget(fixture, 'measure', 'journey-m2', 2);
      await tab(fixture, 'markings'); equal(value(fixture, '#annotation-text'), 'F#m11 — leave space', 'The second dirty form must survive the same changes'); await requireTarget(fixture, 'annotation', 'journey-m4', 4);
      await applySource(fixture, changeSourceAttribute(fixture, 'journey-m2', 'key', 'G'));
      await tab(fixture, 'measure'); equal(value(fixture, '#measure-meter'), '8/8', 'An unrelated accepted property on the target must not erase its dirty meter');
      assert(!/conflict|changed.*review/i.test(draftStatus(fixture, 'measure')), 'A source revision changing only an unrelated key must not lock a dirty meter.');
      await mutate(fixture, () => click(fixture, '#apply-measure'), () => score(fixture).staves[0].measures[1].meter.display === '8/8', 'Apply only the originally dirty meter field');
      const accepted = score(fixture).staves[0].measures[1]; equal(accepted.key, 'G', 'Dirty-fields-only Apply must preserve the newer accepted key signature');
      await tab(fixture, 'markings'); equal(value(fixture, '#annotation-text'), 'F#m11 — leave space', 'Applying another form must not clear the pending harmony'); await requireTarget(fixture, 'annotation', 'journey-m4', 4);
      await mutate(fixture, () => click(fixture, '#add-annotation'), () => score(fixture).staves[0].measures[3].annotations.some(item => item.text === 'F#m11 — leave space'), 'Apply the other form to its original bar');
      assert(!score(fixture).staves[0].measures[5].annotations.length, 'A dirty marking must never be silently redirected to the later note selection.');
      const saved = await recoverableProject(fixture); equal(saved.metadata.title, 'Draft continuity rehearsal', 'The title remains accepted independently of both drafts');
      const part = saved.parts.find(part => part.staffIds.includes('blank-staff')); assert(part, 'The valid fixture must retain an actual part for its staff.');
      await popup(fixture, '#location-trigger', '#location-panel', true); choose(fixture, '#part-select', part.id); await closeOpenPopovers(fixture); await settle(fixture);
      await popup(fixture, '#document-menu-trigger', '#document-menu', true); await popup(fixture, '#score-setup-trigger', '#score-setup', true);
      const beforePartDraft = snapshot(fixture); const savedBeforePartDraft = JSON.stringify(await recoverableProject(fixture)); const pendingPartLabel = `${part.label} — rehearsal copy`;
      write(fixture, '#part-label', pendingPartLabel); await frames(fixture);
      equal(field(fixture, '#part-draft-status').dataset.draftState, 'dirty', 'REVIEW-PART-DRAFT: changing only Part name must leave a named, unsaved part draft');
      await closeOpenPopovers(fixture); await popup(fixture, '#workspace-review-trigger', '#workspace-review', true); click(fixture, '#review-drafts');
      await waitFor(fixture, () => field(fixture, '#score-setup').matches(':popover-open') && authorActiveElement(fixture.doc)?.id === 'part-label', 'Review the dirty part in its actual Score setup surface');
      await frames(fixture); equal(authorActiveElement(fixture.doc)?.id, 'part-label', 'Review must retain focus on the dirty Part name after native surface layout');
      assert(field(fixture, '#score-setup').contains(field(fixture, '#part-label')) && visible(fixture, field(fixture, '#part-label')), 'Review must expose the actual Part name control, not a nonexistent part inspector.');
      assert(inside(box(field(fixture, '#part-label')), box(field(fixture, '#score-setup .popover-body'))), 'Review must scroll the dirty Part name into its actual setup viewport, not merely focus a clipped control.');
      equal(value(fixture, '#part-label'), pendingPartLabel, 'Review must retain the unsaved part name'); unchanged(fixture, beforePartDraft, 'Route Review to the part-only draft');
      equal(JSON.stringify(await recoverableProject(fixture)), savedBeforePartDraft, 'Reviewing the session-only part draft must not accept it or change project recovery');
      return { detail: 'Bar 2’s dirty meter and bar 4’s dirty harmony survive changes elsewhere; each Apply edits its own target and only dirty fields. Review then opens the actual Score setup surface and focuses a separately dirty Part name without accepting it.', metrics: { originalTargets: ['journey-m2', 'journey-m4'], unrelatedAcceptedChanges: ['bar6 F#4', 'document title', 'bar2 key G'], preservedKeyAfterMeterApply: accepted.key, partDraftGate: 'REVIEW-PART-DRAFT', partDraftTarget: part.id, reviewDestination: 'score-setup → part-label', partDraftTransactions: 0 } };
    },
  },
  {
    gate: 'UX-DRAFT-CONFLICT', name: 'Relevant source changes and reused IDs require explicit draft resolution',
    async run() {
      const fixture = await mount('Draft dependency and document identity'); await applySource(fixture, leadSource(8));
      await location(fixture, 'journey-m2'); await tab(fixture, 'measure'); write(fixture, '#measure-meter', '8/8');
      await applySource(fixture, changeSourceAttribute(fixture, 'journey-m2', 'meter', '2/2')); await tab(fixture, 'measure');
      equal(value(fixture, '#measure-meter'), '8/8', 'A conflicting accepted meter must retain the user’s draft text'); await requireTarget(fixture, 'measure', 'journey-m2', 2);
      assert(/conflict|changed|review/i.test(draftStatus(fixture, 'measure')), 'A changed relevant meter dependency must be explained before Apply.');
      const conflict = snapshot(fixture); const apply = field<HTMLButtonElement>(fixture, '#apply-measure');
      if (!apply.disabled) { click(fixture, '#apply-measure'); await frames(fixture); await settle(fixture); }
      unchanged(fixture, conflict, 'Unreviewed conflicting draft');
      assert(visible(fixture, field(fixture, '#review-measure-draft')) && visible(fixture, field(fixture, '#discard-measure-draft')), 'Conflicting work needs explicit review and discard controls.');
      click(fixture, '#discard-measure-draft'); await frames(fixture); equal(value(fixture, '#measure-meter'), '2/2', 'Explicit discard loads the current accepted dependency');
      write(fixture, '#measure-meter', '8/8'); const removed = fixture.doc.createElement('template'); removed.innerHTML = source(fixture); removed.content.querySelector('#journey-m2')!.remove();
      await applySource(fixture, removed.innerHTML); await tab(fixture, 'measure'); equal(value(fixture, '#measure-meter'), '8/8', 'Deleting the original target must retain its orphaned form for inspection');
      const missingNotice = field(fixture, '#measure-draft-status');
      equal(missingNotice.dataset.draftState, 'missing', `A deleted target must be explicitly marked missing; local explanation: ${missingNotice.textContent}`);
      await requireTarget(fixture, 'measure', 'journey-m2', 2);
      assert(/no longer|missing|removed|deleted|unavailable/i.test(missingNotice.textContent ?? '') && /kept|preserv|retain|unsaved|unapplied/i.test(missingNotice.textContent ?? ''), `A deleted target must explain that it is unavailable and the work is retained; received ${JSON.stringify(missingNotice.textContent)}.`); const missing = snapshot(fixture);
      if (!field<HTMLButtonElement>(fixture, '#apply-measure').disabled) { click(fixture, '#apply-measure'); await frames(fixture); await settle(fixture); } unchanged(fixture, missing, 'Deleted target draft');
      click(fixture, '#discard-measure-draft'); await frames(fixture);
      await location(fixture, 'blank-m1'); await tab(fixture, 'measure'); write(fixture, '#measure-meter', '5/4');
      const priorProject = await recoverableProject(fixture); assert(!JSON.stringify(priorProject).includes('5/4'), 'A session-only inspector draft must not be represented as saved musical recovery.');
      assert(/draft|unsaved|not saved|session/i.test(`${draftStatus(fixture, 'measure')} ${field(fixture, '#inspector-draft-status').textContent}`), 'The working draft must be visibly distinguished from saved composition recovery.');
      const oldId = priorProject.id; await template(fixture, 'blank'); const newId = (await recoverableProject(fixture)).id; assert(newId !== oldId, 'New Blank must establish a new document identity even when its measure IDs repeat.');
      await tab(fixture, 'measure'); const state = draftStatus(fixture, 'measure');
      if (value(fixture, '#measure-meter') === '5/4') {
        assert(/document|different|missing|changed/i.test(state), 'An intentionally retained old-document draft must explain why it cannot target the new document.');
        const before = snapshot(fixture); if (!field<HTMLButtonElement>(fixture, '#apply-measure').disabled) { click(fixture, '#apply-measure'); await frames(fixture); await settle(fixture); } unchanged(fixture, before, 'Old document draft with reused source ID');
      }
      equal(score(fixture).staves[0].measures[0].meter.display, '4/4', 'A reused blank-m1 ID must never redirect an old 5/4 draft into the new composition');
      assert(fixture.confirmations.some(message => /draft|unsaved|changes|replace/i.test(message)), 'Discarding a composition with an unfinished form must require explicit user confirmation.');
      return { detail: 'Conflicting and deleted targets preserve work but block unsafe Apply; inspector drafts are session-only, and a new document cannot inherit one because blank-m1 is reused.', metrics: { relevantDependency: 'meter', deletedTarget: 'journey-m2', oldDocumentId: oldId, newDocumentId: newId, reusedSourceId: 'blank-m1', inspectorDraftInRecovery: false } };
    },
  },
  {
    gate: 'UX-TABS', name: 'Separate Properties and three persistent task tabs preserve writing geometry and history',
    async run() {
      const fixture = await mount('Persistent task tabs and history'); await template(fixture, 'piano'); await selectEvent(fixture, 'piano-upper-m3-n3');
      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true); const beforeEdit = snapshot(fixture);
      await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => eventById(fixture, 'piano-upper-m3-n3').pitches[0].alter === 1, 'Create a redo checkpoint');
      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false); await undo(fixture, beforeEdit); const before = snapshot(fixture); const recovered = JSON.stringify(await recoverableProject(fixture)); const saveText = field(fixture, '#save-status').textContent;
      const width = box(field(fixture, '#score-scroll')).width; const systems = ranges(fixture);
      await tools(fixture, true);
      const properties = field(fixture, '#selection-inspector'); assert(visible(fixture, properties), 'More opens Properties directly for the selected event.');
      equal(properties.getAttribute('role'), 'region', 'Properties remains a separate named region rather than a fourth tab');
      assert(field(fixture, '#tools-tablist').hidden, 'The unrelated task tablist must not compete with direct Properties.');
      assert(Math.abs(box(field(fixture, '#score-scroll')).width - width) <= 0.5, 'Opening More must preserve the chosen writing frame width.');
      equal(ranges(fixture), systems, 'Opening More must not rewrap the writing frame');
      await tab(fixture, 'rhythm'); const first = field<HTMLButtonElement>(fixture, '#tool-tab-rhythm'); key(fixture, first, 'Home'); key(fixture, first, 'Enter');
      for (const [index, name] of tabNames.entries()) {
        const button = field<HTMLButtonElement>(fixture, `#tool-tab-${name}`); const panel = field(fixture, `#${panels[name]}`);
        equal(button.getAttribute('role'), 'tab', 'Each task control must expose tab semantics'); equal(panel.getAttribute('role'), 'tabpanel', 'Each tabbed working form must be a tabpanel');
        equal([button.getAttribute('aria-controls'), panel.getAttribute('aria-labelledby')], [panel.id, button.id], 'The tab and its working form must name each other');
        if (index > 0) {
          const previous = field<HTMLButtonElement>(fixture, `#tool-tab-${tabNames[index - 1]}`); key(fixture, previous, 'ArrowRight');
          equal(authorActiveElement(fixture.doc)?.id, button.id, 'Arrow navigation moves focus within the tablist');
          equal(previous.getAttribute('aria-selected'), 'true', 'Arrow navigation alone must not activate another working form');
          key(fixture, button, index % 2 ? 'Enter' : ' '); await frames(fixture);
        }
        equal(button.getAttribute('aria-selected'), 'true', 'Enter or Space activates the focused working task');
        assert(visible(fixture, panel), 'The active working form must be visible.');
        for (const other of tabNames.filter(other => other !== name)) assert(field(fixture, `#${panels[other]}`).hidden, 'Inactive task panels must be hidden rather than competing with the active form.');
        assert(Math.abs(box(field(fixture, '#score-scroll')).width - width) <= 0.5, 'Changing task tabs must not alter the score surface width.'); equal(ranges(fixture), systems, 'Changing task tabs must not rewrap systems');
        unchanged(fixture, before, `Activate ${name} tools`);
      }
      await tab(fixture, 'edit'); assert(visible(fixture, properties) && field(fixture, '#tools-tablist').hidden, 'Back to Properties restores the separate task without a musical edit.');
      click(fixture, '#tools-hide'); await frames(fixture); await settle(fixture); equal(authorActiveElement(fixture.doc)?.id, 'edit-selected-event', 'Hide tools returns focus to the actual Select-mode More invoker');
      assert(visible(fixture, field(fixture, '#score-editor')) && !field(fixture, '#score-editor').inert, 'Returning from a task must expose the interactive score again.');
      assert(Math.abs(box(field(fixture, '#score-scroll')).width - width) <= 0.5, 'Closing More restores the unchanged writing frame width.'); equal(ranges(fixture), systems, 'Returning from a task retains the same system groups');
      unchanged(fixture, before, 'Hide tools'); equal(JSON.stringify(await recoverableProject(fixture)), recovered, 'Task preferences must not change the recoverable musical project'); equal(field(fixture, '#save-status').textContent, saveText, 'Task preferences must not claim a new recovery write');
      assert(!field<HTMLButtonElement>(fixture, '#redo').disabled, 'Redo remains available after changing only workspace preferences.');
      return { detail: 'Direct Properties and the three other task tabs keep the writing frame stable; arrows move focus, Enter/Space activate, and history plus recovery remain unchanged.', metrics: { propertiesRoute: 'More → Properties', tasks: [...tabNames], stableScoreWidth: width, systemRanges: systems, musicalTransactions: 0, redoRetained: true } };
    },
  },
);

tests.push({
  gate: 'UX-STATIONARY-PALETTE', name: 'More, Mode, and Location stay fixed through pane toggles and edit feedback',
  async run() {
    const observations: Record<string, unknown>[] = [];
    for (const [width, presentation, enlargedText] of [[1500, 'side', false], [390, 'sheet', false], [390, 'sheet', true]] as const) {
      const fixture = await mount(`Stationary palette with ${presentation} tools${enlargedText ? ' — CSS 20px root fixture, not OS text sizing or page zoom' : ''}`, width, 660);
      if (enlargedText) { fixture.doc.documentElement.style.fontSize = '20px'; await frames(fixture); await settle(fixture); }
      await applySource(fixture, leadSource(4)); await primeRedo(fixture, 'journey-n2a');
      await selectEvent(fixture, 'journey-n4b'); await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'D#6', duration: 'eighth', dots: '1', position: 'after' });
      const writerLocation = { staff: value(fixture, '#staff-select'), measure: value(fixture, '#measure-select'), voice: value(fixture, '#event-voice') };
      click(fixture, '#select-mode'); await selectEvent(fixture, 'journey-n2a');
      const selectedBeforeResume = snapshot(fixture); await enter(fixture); await settle(fixture);
      const writerCursor = cursor(fixture);
      equal({ staff: value(fixture, '#staff-select'), measure: value(fixture, '#measure-select'), voice: value(fixture, '#event-voice') }, writerLocation, 'The captured Write cursor must resume the original bar-4 location');
      unchanged(fixture, selectedBeforeResume, 'Capture the independent resumed writing location', false);
      click(fixture, '#select-mode'); await frames(fixture); await settle(fixture); unchanged(fixture, selectedBeforeResume, 'Return to the separately selected bar-2 location');
      const before = snapshot(fixture); const originalRanges = ranges(fixture); const originalSurface = surface(fixture);
      const paper = field(fixture, '#score-editor'); const paperBounds = box(paper);
      const originalOthers = JSON.stringify(events(fixture).filter(event => event.id !== 'journey-n2a'));
      const entryRecipe = () => ({ ...palette(fixture), alteration: value(fixture, '#event-alteration'), direction: value(fixture, '#event-direction') });
      const originalRecipe = entryRecipe();
      const moreSelector = () => field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true' ? '#tools-toggle' : '#edit-selected-event';
      const rectangles = () => ({ dock: box(field(fixture, '#workspace-dock')), modeSlot: box(field(fixture, '#workspace-mode-slot')),
        write: box(field(fixture, '#toggle-entry')), select: box(field(fixture, '#select-mode')), moreSlot: box(field(fixture, '#palette-more-slot')),
        more: box(field(fixture, moreSelector())), location: box(field(fixture, '#location-trigger')) });
      const baseline = rectangles(); const expectedPalette = expectedPaletteLayout(fixture); const checkpoints: Record<string, unknown>[] = [];
      const viewport = { left: 0, top: 0, right: width, bottom: 660, width, height: 660 };
      const checkpoint = async (label: string, expectedPresentation: 'closed' | 'side' | 'sheet' = 'closed', preserveMusic = true) => {
        await frames(fixture); await settle(fixture);
        const current = rectangles(); let maximumDeltaPx = 0;
        const writing = field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true';
        for (const name of Object.keys(baseline) as (keyof typeof baseline)[]) {
          for (const dimension of ['left', 'top', 'right', 'bottom', 'width', 'height'] as const) {
            const delta = Math.abs(current[name][dimension] - baseline[name][dimension]); maximumDeltaPx = Math.max(maximumDeltaPx, delta);
            assert(delta <= 0.5, `${label}: ${name}.${dimension} moved ${delta}px; More, Mode, and Location must stay within 0.5 CSS px of their original rectangles.`);
          }
        }
        const minimumTarget = expectedPalette.controlSize - 0.25;
        assert(Math.abs(current.dock.height - expectedPalette.height) <= 1, `${label}: the ${expectedPalette.rows}-row palette with header spacing must remain ${expectedPalette.height}px ±1; received ${current.dock.height}px.`);
        assert(Math.abs(current.write.height - expectedPalette.controlSize) <= 0.25, `${label}: the shared header and palette control size must remain ${expectedPalette.controlSize}px.`);
        const dockControls = [...field(fixture, '#workspace-dock').querySelectorAll<HTMLButtonElement>('button')].filter(control => visible(fixture, control));
        for (const control of dockControls) {
          const bounds = box(control);
          assert(bounds.width >= limits.target && bounds.height >= minimumTarget
            && inside(bounds, current.dock) && inside(bounds, viewport), `${label}: #${control.id} must remain an uncropped target at least ${limits.target}px wide and ${minimumTarget}px high.`);
        }
        for (const selector of ['#toggle-entry', '#select-mode', moreSelector(), '#location-trigger']) assert(visible(fixture, field(fixture, selector)), `${label}: ${selector} must stay visible.`);
        assert(fixture.doc.documentElement.scrollWidth <= fixture.doc.documentElement.clientWidth + 1, `${label}: the palette must not create document-level horizontal overflow.`);
        if (enlargedText) {
          equal(fixture.view.getComputedStyle(fixture.doc.documentElement).fontSize, '20px', `${label}: retain the explicit CSS root size without shrinking text`);
        }
        if (expectedPalette.rows === 2) {
          const musical = box(field(fixture, '#palette-musical-slots'));
          assert(Math.abs(musical.top - current.modeSlot.bottom - expectedPalette.rowGap) <= 0.5
            && Math.abs(musical.height - current.write.height) <= 0.5, `${label}: the musical controls must occupy the second actual row, below the mode enclosure with the ${expectedPalette.rowGap}px header row gap.`);
          for (const control of dockControls) assert([current.write.top, musical.top].some(top => Math.abs(box(control).top - top) <= 0.5), `${label}: each visible palette control must belong to one of the two actual rows.`);
        }
        const otherMore = moreSelector() === '#tools-toggle' ? '#edit-selected-event' : '#tools-toggle';
        assert(!visible(fixture, field(fixture, otherMore)), `${label}: only the current mode's More control may occupy the reserved slot.`);
        equal(fixture.doc.body.dataset.toolsPresentation, expectedPresentation, `${label}: use the actual side pane, sheet, or closed state`);
        assert(paper.isConnected && field(fixture, '#score-editor') === paper && surface(fixture) === originalSurface, `${label}: the same paper and public notation surface must stay mounted.`);
        for (const dimension of ['left', 'top', 'width', 'height'] as const) {
          assert(Math.abs(box(paper)[dimension] - paperBounds[dimension]) <= 0.5, `${label}: the chosen paper frame's ${dimension} must not change with palette or pane state.`);
        }
        if (expectedPresentation === 'sheet') {
          assert(paper.inert && paper.getAttribute('aria-hidden') === 'true' && !visible(fixture, paper), `${label}: a sheet keeps the same paper mounted but hides it from interaction and accessibility.`);
        } else assert(!paper.inert && paper.getAttribute('aria-hidden') !== 'true' && visible(fixture, paper), `${label}: closed or side tools must leave the paper visible and interactive.`);
        if (preserveMusic) { unchanged(fixture, before, label, false); equal(ranges(fixture), originalRanges, `${label}: pure workspace changes must not rewrap the music`); }
        // The navigator lists only the current location's measure. In Write at
        // bar 4 it cannot expose a pressed button for the separate bar-2 selection.
        equal(cursor(fixture), writing ? writerCursor : before.cursor, `${label}: preserve the exact location controls for the current mode`);
        const selectedSourceIds = [...field(fixture, '#score-host').shadowRoot!.querySelectorAll<HTMLElement>('.author-selection[data-source-id]:not(.author-measure-selection)')]
          .map(element => element.dataset.sourceId).sort();
        equal(selectedSourceIds, ['journey-n2a'], `${label}: the public source-selection overlay must retain the independent bar-2 event`);
        equal(entryRecipe(), originalRecipe, `${label}: the independent next-entry recipe must remain unchanged`);
        const captionInk: Record<string, unknown>[] = [];
        if (writing) {
          const action = field(fixture, '#insert-event'); const actionBounds = box(action);
          for (const [selector, expected] of [['#insert-event-label', 'Add + insert'], ['#insert-event-destination', 'Bar 5']] as const) {
            const caption = field(fixture, selector); equal(caption.textContent?.trim(), expected, `${label}: name the next action before any append`);
            assert(visible(fixture, caption), `${label}: ${selector} must be visibly rendered.`);
            const range = fixture.doc.createRange(); range.selectNodeContents(caption); const ink = [...range.getClientRects()];
            assert(ink.length > 0 && ink.every(rect => rect.width > 0 && rect.height > 0 && inside(rect, actionBounds, 0.5) && inside(rect, box(caption), 0.5)), `${label}: every line of ${expected} must fit inside its actual button and caption box without vertical clipping or ellipsis.`);
            captionInk.push({ selector, ink: ink.map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })) });
          }
          equal(score(fixture).staves[0].measures.length, 4, `${label}: forecasting bar 5 must not append it`);
        }
        const feedback = field(fixture, '#workspace-feedback-label');
        checkpoints.push({ label, mode: writing ? 'write' : 'select', captionInk,
          presentation: expectedPresentation, more: moreSelector(), maximumDeltaPx, stripHeight: current.dock.height,
          feedbackKind: feedback.dataset.feedbackKind, feedback: feedback.getAttribute('aria-label') ?? feedback.textContent });
      };

      await checkpoint('Initial selected note');
      for (const mode of ['select', 'write'] as const) {
        click(fixture, mode === 'write' ? '#toggle-entry' : '#select-mode'); await checkpoint(`${mode}: fixed mode control`);
        equal(field(fixture, mode === 'write' ? '#toggle-entry' : '#select-mode').getAttribute('aria-pressed'), 'true', `${mode}: the requested mode must be active`);
        for (const [index, open] of [true, false, true, false].entries()) {
          click(fixture, moreSelector());
          await waitFor(fixture, () => visible(fixture, field(fixture, '#workspace-tools')) === open, `${mode}: More ${open ? 'opens' : 'closes'} its task`);
          await checkpoint(`${mode}: More ${index === 2 ? 'reopened' : open ? 'opened' : 'closed'} ${index + 1}`, open ? presentation : 'closed');
          equal(field(fixture, moreSelector()).getAttribute('aria-expanded'), String(open), `${mode}: More must report its actual task visibility`);
        }
      }
      click(fixture, '#select-mode'); await checkpoint('Return to Select');
      await popup(fixture, '#location-trigger', '#location-panel', true); await checkpoint('Location opened');
      await popup(fixture, '#location-trigger', '#location-panel', false); await checkpoint('Location closed');

      await popup(fixture, '#selection-value', '#selection-value-chooser', true); await checkpoint('Written value chooser opened');
      choose(fixture, '#selection-duration', 'whole');
      const localError = field(fixture, '#selection-value-error');
      await waitFor(fixture, () => visible(fixture, localError) && !!localError.textContent?.trim(), 'Reject a whole note in the already full two-half-note voice');
      await checkpoint('Overflow rejected in the value chooser');
      equal(value(fixture, '#selection-duration'), 'half', 'Rejected overflow must restore the accepted half-note value');
      const rejection = localError.textContent!.trim(); const feedback = field(fixture, '#workspace-feedback-label');
      assert(/exceed|overflow|fit|remaining|capacity|contains.*whole notes.*meter allows/i.test(rejection), `The refusal must explain the voice capacity; received ${JSON.stringify(rejection)}.`);
      assert(visible(fixture, feedback) && feedback.dataset.feedbackKind === 'error'
        && (feedback.getAttribute('aria-label') ?? '').includes(rejection), 'The fixed header must expose the actual rejected-edit explanation.');
      await popup(fixture, '#selection-value', '#selection-value-chooser', false); await checkpoint('Rejection retained after closing Value');
      assert(visible(fixture, field(fixture, '#workspace-review-trigger')), 'The rejected edit must leave a visible Review route after the chooser closes.');
      await popup(fixture, '#workspace-review-trigger', '#workspace-review', true);
      const reviewError = field(fixture, '#author-errors');
      assert(visible(fixture, reviewError) && reviewError.textContent?.includes(rejection), 'Review must expose the same complete validation detail through its real visible invoker.');
      await checkpoint('Review error opened');
      await popup(fixture, '#workspace-review-trigger', '#workspace-review', false); await checkpoint('Review error closed');

      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true);
      const correction = await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => pitch(eventById(fixture, 'journey-n2a')) === 'F#4', 'Accept one real accidental correction after the rejected value');
      equal(correction.revision, before.revision, 'No mode, pane, chooser, Review, or rejected edit may create a history entry');
      equal(cursor(fixture), before.cursor, 'The accepted quick correction keeps the same selected musical location');
      equal(JSON.stringify(events(fixture).filter(event => event.id !== 'journey-n2a')), originalOthers, 'The quick correction must preserve every other event');
      equal([eventById(fixture, 'journey-n2a').duration, eventById(fixture, 'journey-n2a').dots], ['half', 0], 'The accepted accidental must not retain the rejected whole-note value');
      assert(source(fixture) !== before.source && field<HTMLButtonElement>(fixture, '#redo').disabled, 'One accepted correction changes Source and replaces the old Redo branch.');
      await checkpoint('Successful accidental correction', 'closed', false);
      const successFeedback = field(fixture, '#workspace-feedback-label');
      assert(visible(fixture, successFeedback) && successFeedback.dataset.feedbackKind === 'info' && !!successFeedback.textContent?.trim()
        && field(fixture, '#author-errors').hidden && field(fixture, '#selection-value-error').hidden, 'Success must replace the rejected-edit feedback without retaining a hidden active error.');
      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false); await checkpoint('Successful chooser closed', 'closed', false);
      await undo(fixture, correction); await checkpoint('One Undo restores the original music', 'closed', false);
      equal(revision(fixture), before.revision + 2, 'The correction and its single Undo are the only tested musical transactions');
      assert(!field<HTMLButtonElement>(fixture, '#redo').disabled, 'One Undo restores a real Redo action.');
      const restored = snapshot(fixture); await enter(fixture); await checkpoint('Resume the preserved full-bar writer after Undo', 'closed', false);
      unchanged(fixture, restored, 'Resume the original writer without changing music or selection', false);
      click(fixture, '#select-mode'); await checkpoint('Park the same writer after Undo', 'closed', false); unchanged(fixture, restored, 'Park the original writer');
      observations.push({ viewport: [width, 660], pane: presentation, textSizing: enlargedText ? 'Explicit CSS 20px root fixture; not OS preferences, page zoom, or native accessibility qualification' : 'Default text size', baselineRectangles: baseline, paperBounds, checkpoints,
        rectangleTolerancePx: 0.5, paletteHeightPx: expectedPalette.height, paletteRows: expectedPalette.rows, paletteHeightTolerancePx: 1, targetMinimumPx: limits.target,
        acceptedCorrectionTransactions: 1, rejectedEditTransactions: 0, undoTransactions: 1 });
    }
    return { detail: 'The actual More, Write, Select, and Location controls keep their rectangles through side/sheet task toggles, native choosers, overflow Review, one accepted pitch correction, and one Undo. Pure workspace changes preserve Source, selection, recipe, and the existing Redo branch.', metrics: { observations } };
  },
});

async function pageView(fixture: Fixture): Promise<void> {
  click(fixture, '#view-pages'); await waitFor(fixture, () => fixture.doc.body.dataset.view === 'pages' && fixture.doc.body.dataset.renderState === 'ready' && !!field(fixture, '#page-host').querySelector('.score-page'), 'Compose actual physical pages'); await settle(fixture);
}
function pageComposition(fixture: Fixture, paper: 'letter' | 'a4'): object {
  const host = field(fixture, '#page-host'); const sheets = [...host.querySelectorAll<HTMLElement>('.score-page')]; assert(sheets.length > 0, 'Physical pages must be present.');
  assert(!host.querySelector('button,input,select,textarea,[role="tablist"],details,.pointer-preview,.author-overlays'), 'No working pane, entry control, popover, or pointer preview may enter the composed physical pages.');
  const round = (n: number) => Math.round(n * 1000) / 1000; const size = (element: Element) => { const bounds = box(element); return [round(bounds.width), round(bounds.height)]; };
  const expectedMm = paper === 'letter' ? [215.9, 279.4] : [210, 297]; let nextMeasure = 0; let nextSystem = 0;
  const composition = sheets.map((sheet, index) => {
    const content = sheet.querySelector<HTMLElement>('.page-content'); const heading = sheet.querySelector<HTMLElement>('.page-heading'); const footer = sheet.querySelector<HTMLElement>('.page-footer');
    assert(content && heading && footer, 'Each physical sheet needs measured content, heading, and footer.'); const title = sheet.querySelector<HTMLElement>('.page-title');
    const dimensions = size(sheet); assert(Math.abs(dimensions[0] - expectedMm[0] * 96 / 25.4) <= 2 && Math.abs(dimensions[1] - expectedMm[1] * 96 / 25.4) <= 2, 'Paper dimensions must match the selected physical sheet.');
    assert(inside(box(content), box(sheet)), 'The content region must be contained by its physical sheet.'); assert(inside(box(heading), box(content)) && inside(box(footer), box(content)), 'Running furniture must stay inside the margins.');
    let previousBottom = title ? box(title).bottom : box(heading).bottom;
    const systems = [...sheet.querySelectorAll<HTMLElement>('.page-system')].map(system => {
      const svg = system.querySelector<SVGSVGElement>('svg'); assert(svg, 'A physical system must contain real vector notation.');
      equal(Number(system.dataset.systemIndex), nextSystem++, 'Physical systems must appear once and in their original order'); equal(Number(system.dataset.start), nextMeasure, 'Physical systems must cover contiguous source measures'); nextMeasure = Number(system.dataset.end);
      const bounds = box(system); assert(bounds.top >= previousBottom - 0.75 && bounds.bottom <= box(footer).top + 0.75, 'Physical systems must not overlap the title, another system, or the footer.'); assert(inside(box(svg), bounds), 'Intrinsic SVG notation must fit its planned physical system box.');
      assert(bounds.left >= box(content).left - 0.75 && bounds.right <= box(content).right + 0.75, 'Complete notation must fit within the horizontal page margins.'); previousBottom = bounds.bottom;
      return { index: Number(system.dataset.systemIndex), start: Number(system.dataset.start), end: Number(system.dataset.end), size: size(system), svg: { size: size(svg), width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox') },
        events: [...svg.querySelectorAll<SVGGElement>('g[data-source-id][data-measure-id][data-staff-id][data-x]')].map(group => group.dataset.sourceId).sort() };
    });
    return { index, sheet: dimensions, content: size(content), heading: size(heading), footer: size(footer), title: title ? size(title) : null, systems };
  });
  equal(nextMeasure, score(fixture).staves[0].measures.length, 'Composed pages must include the final authored bar');
  equal(composition.flatMap(page => page.systems.flatMap(system => system.events)).sort(), events(fixture).map(event => event.id).sort(), 'Every selected-part event must appear exactly once in the physical composition');
  return composition;
}
function pointerTap(fixture: Fixture, measureId: string, afterId: string): void {
  const context = geometry(fixture, measureId); const lane = context.system.measures.find(measure => measure.sourceId === measureId); assert(lane, 'Pointer recovery needs a real staff lane.');
  const anchor = context.system.anchors.find(anchor => anchor.measureId === measureId && anchor.afterId === afterId); assert(anchor, 'The recovery fixture must use the actual append anchor.');
  const matrix = context.svg.getScreenCTM(); assert(matrix, 'Pointer recovery needs an actual screen transform.');
  const point = new DOMPoint(anchor.x, lane.bottomLine - (lane.bottomLine - lane.topLine) / 8).matrixTransform(matrix);
  assert(point.x >= 0 && point.x < fixture.view.innerWidth && point.y >= 0 && point.y < fixture.view.innerHeight, 'The synthetic staff tap must target actual visible notation.');
  fixture.actions.push({ kind: 'click', target: `synthetic pointer ${measureId} after ${afterId}` });
  for (const type of ['pointerdown', 'pointerup']) context.svg.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 7301, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: point.x, clientY: point.y, view: fixture.view }));
}

tests.push(
  {
    gate: 'UX-CONSTRAINED-TASKS', name: 'Entry, correction, overflow, and eight-bar harmony remain usable on narrow and short screens',
    async run() {
      const journeys: Record<string, unknown>[] = [];
      for (const [width, height] of [[390, 660], [390, 360], [1180, 360]]) {
        const fixture = await mount(`${width}×${height} complete musical task`, width, height);
        await applySource(fixture, leadSource(8, '', [1]).replace('<music-note id="journey-n1b" pitch="A4" duration="half"></music-note>', ''));
        await location(fixture, 'blank-m1'); await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'G4', duration: 'quarter', dots: '0', position: 'after' }); await enter(fixture);
        const originalCount = events(fixture).length; await insert(fixture, originalCount + 1); const newNote = score(fixture).staves[0].measures[0].voices[0].events.at(-1)!;
        equal([pitch(newNote), newNote.duration, newNote.onset], ['G4', 'quarter', { numerator: 1, denominator: 2 }], 'Constrained-screen entry must reach its exact intended point');
        await recipe(fixture, { duration: 'whole' }); const beforeOverflow = snapshot(fixture); const primary = field<HTMLButtonElement>(fixture, '#insert-event');
        if (!primary.disabled) { click(fixture, '#insert-event'); await frames(fixture); await settle(fixture); }
        unchanged(fixture, beforeOverflow, 'Partial-bar overflow');
        assert(/contains|allows|overflow|excess|fit|full|long|cannot/i.test(`${field(fixture, '#author-errors').textContent} ${field(fixture, '#author-status').textContent} ${field(fixture, '#remaining-time').textContent}`), 'Partial overflow must have an understandable visible reason.');
        await recipe(fixture, { duration: 'quarter' }); click(fixture, '#select-mode'); await selectEvent(fixture, 'journey-n1a'); await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true);
        const noteEditor = field(fixture, '#selection-pitch-chooser'); assert(inside(box(noteEditor), { left: 0, top: 0, right: width, bottom: height, width, height }), 'Quick correction must fit the actual constrained viewport.');
        await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => pitch(eventById(fixture, 'journey-n1a')) === 'F#4', 'Correct a note on the constrained screen'); await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false);
        await location(fixture, 'blank-m1'); await addChord(fixture); const pane = field(fixture, '#workspace-tools');
        assert(!pane.hasAttribute('popover'), 'Repeated musical tools must remain a reserved persistent pane, not a dismissed auto-popover.');
        for (let index = 0; index < 8; index++) {
          write(fixture, '#annotation-text', ['Dm9', 'G13', 'Cmaj9', 'A7alt'][index % 4]);
          await mutate(fixture, () => click(fixture, '#add-annotation-next'), () => annotations(fixture).length === index + 1, 'Complete the constrained harmony pass');
          equal(authorActiveElement(fixture.doc)?.id, 'annotation-text', 'Each constrained harmony advance keeps the writing field focused'); assert(visible(fixture, pane), 'The working pane must not dismiss between harmonies');
        }
        equal(score(fixture).staves[0].measures.length, 8, 'A constrained harmony pass must not append a ninth bar'); await tools(fixture, false); await reveal(fixture, 'journey-n8a', 0.15);
        const accepted = music(fixture); const acceptedHtml = source(fixture);
        const invalidSource = '<music-staff><music-measure><music-note pitch="not a pitch"></music-note></music-measure></music-staff>';
        await popup(fixture, '#source-trigger', '#source-panel', true); write(fixture, '#source-input', invalidSource); await frames(fixture); const stagedSource = snapshot(fixture);
        click(fixture, '#source-apply');
        const sourceError = field(fixture, '#source-error'); const sourceInput = field<HTMLTextAreaElement>(fixture, '#source-input');
        await waitFor(fixture, () => visible(fixture, sourceError) && !!sourceError.textContent?.trim() && sourceInput.getAttribute('aria-invalid') === 'true', 'Expose the failed Source validation beside its unchanged draft');
        await frames(fixture); unchanged(fixture, stagedSource, 'Reject the already-staged invalid Source');
        equal(sourceError.getAttribute('role'), 'alert', 'Source validation must use the local accessible alert');
        assert(sourceInput.getAttribute('aria-describedby')?.split(/\s+/).includes('source-error'), 'The Source textarea must be associated with its own validation error.');
        const sourceMessage = sourceError.textContent ?? ''; assert(/pitch/i.test(sourceMessage), 'The local Source diagnostic must explain the actual invalid pitch.');
        const errorBox = box(sourceError); const bodyBox = box(field(fixture, '#source-panel .popover-body'));
        assert(errorBox.height <= bodyBox.height ? inside(errorBox, bodyBox) : errorBox.top >= bodyBox.top - 1 && errorBox.top < bodyBox.bottom - 1,
          'Failed Apply must reveal the local diagnostic inside Source’s own reading viewport without moving the score behind it.');
        await popup(fixture, '#source-trigger', '#source-panel', false);
        const pendingFeedback = field(fixture, '#workspace-feedback-label');
        assert(visible(fixture, pendingFeedback) && /source unapplied/i.test(pendingFeedback.textContent ?? ''), 'Pending invalid Source must retain its visible header warning after the popover closes.');
        assert(visible(fixture, field(fixture, '#workspace-review-trigger')), 'The header must retain the route to full Source and validation details.');
        equal(music(fixture), accepted, 'An invalid source draft must leave the accepted notation available');
        const pending = layoutMetrics(fixture); assert(Number(pending.usableHeight) > 0, 'The pending-source summary must not consume the whole working score viewport.');
        if (width === 390 && height === 360) assert(Number(pending.usableHeight) >= limits.shortPendingScore, `Pending Source at 390×360 must retain at least ${limits.shortPendingScore}px of useful notation plus an ordinary fully visible notehead; received ${pending.usableHeight}.`);
        await popup(fixture, '#workspace-review-trigger', '#workspace-review', true);
        assert(visible(fixture, field(fixture, '#source-draft-notice')) && /editing and printing paused/i.test(field(fixture, '#source-draft-notice').textContent ?? ''), 'Review must retain the complete editing/publication blocker.');
        click(fixture, '#review-source');
        await waitFor(fixture, () => field(fixture, '#source-panel').matches(':popover-open'), 'Return from Review to the failed Source draft'); await frames(fixture);
        equal(value(fixture, '#source-input'), invalidSource, 'Review → Source must retain the exact failed raw draft'); equal(sourceError.textContent, sourceMessage, 'Review → Source must retain that draft’s local diagnostic');
        assert(visible(fixture, sourceError) && sourceInput.getAttribute('aria-invalid') === 'true', 'Reopening the same failing Source must not silently clear its validation state.');
        unchanged(fixture, stagedSource, 'Review and reopen the same failing Source');
        write(fixture, '#source-input', invalidSource.replace('not a pitch', 'still not a pitch')); await frames(fixture);
        assert(sourceError.hidden && !sourceError.textContent?.trim() && sourceInput.getAttribute('aria-invalid') !== 'true', 'Changing the raw draft must clear the obsolete local diagnostic without claiming the new text is accepted.');
        assert(/unapplied|draft/i.test(field(fixture, '#source-status').textContent ?? ''), 'The changed draft remains unapplied until a separate successful Apply or Revert.');
        const changedDraft = snapshot(fixture); click(fixture, '#source-apply'); await waitFor(fixture, () => !sourceError.hidden && sourceInput.getAttribute('aria-invalid') === 'true', 'Validate the changed Source draft separately');
        unchanged(fixture, changedDraft, 'Reject the changed invalid Source'); click(fixture, '#source-revert'); await frames(fixture);
        assert(sourceError.hidden && !sourceError.textContent?.trim() && sourceInput.getAttribute('aria-invalid') !== 'true', 'Revert must clear the local Source error and invalid state.');
        equal(value(fixture, '#source-input'), acceptedHtml, 'Revert restores the exact accepted musical HTML'); await popup(fixture, '#source-trigger', '#source-panel', false);
        equal(music(fixture), accepted, 'Source recovery must restore the workspace without changing accepted music');
        const resolvedSource = changeSourceAttribute(fixture, 'journey-n8a', 'pitch', 'G4'); await popup(fixture, '#source-trigger', '#source-panel', true); write(fixture, '#source-input', resolvedSource); await frames(fixture);
        await mutate(fixture, () => click(fixture, '#source-apply'), () => pitch(eventById(fixture, 'journey-n8a')) === 'G4', 'Accept one separate corrected Source revision after the error was resolved');
        assert(sourceError.hidden && !sourceError.textContent?.trim() && sourceInput.getAttribute('aria-invalid') !== 'true', 'Successful Source Apply must leave no stale local validation error.'); await popup(fixture, '#source-trigger', '#source-panel', false);
        const resolved = await recoverableProject(fixture); assert(resolved.pendingSource === null && resolved.sourceHtml === source(fixture), 'Successful Source Apply must recover the accepted correction without an unapplied draft.');
        journeys.push({ viewport: [width, height], enteredNotes: 1, correctedNotes: 1, rejectedOverflowTransactions: 0, harmonySymbols: 8, persistentTaskPane: true, pendingSourceScoreHeight: pending.usableHeight, localSourceError: sourceMessage, sourceReviewRoute: 'Review → Source', rejectedSourceApplies: 2, rejectedSourceApplyTransactions: 0, sourceErrorClearedBy: ['changed raw draft', 'Revert', 'successful Apply'], correctedSourceTransactions: 1 });
      }
      return { detail: 'The same entry, correction, failed-overflow, sustained harmony, and pending-Source recovery tasks complete on phone, short phone, and short desktop fixtures.', metrics: { journeys, softwareKeyboardQualified: false, trustedInputQualified: false } };
    },
  },
  {
    gate: 'UX-CONTINUE-ENDING', name: 'Continuing a finished ensemble states hidden staves and undoes the whole decision',
    async run() {
      const fixture = await mount('Explicit final-ending continuation'); await template(fixture, 'ensemble');
      const html = ensembleSource(4).replaceAll('id="ensemble-flute-m4"', 'id="ensemble-flute-m4" end-bar="final"').replaceAll('id="ensemble-vibes-m4"', 'id="ensemble-vibes-m4" end-bar="final"').replaceAll('id="ensemble-cello-m4"', 'id="ensemble-cello-m4" end-bar="final"');
      await applySource(fixture, html); await exposeControl(fixture, '#part-select'); const flute = [...field<HTMLSelectElement>(fixture, '#part-select').options].find(option => /flute/i.test(option.textContent ?? '') && option.value !== 'score'); assert(flute, 'The ensemble must expose an authored-pitch flute part.'); choose(fixture, '#part-select', flute.value); await closeOpenPopovers(fixture); await settle(fixture);
      await location(fixture, 'ensemble-flute-m4', 'ensemble-flute', '0'); await selectEvent(fixture, 'ensemble-flute-m4-n1'); await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'F4', duration: 'quarter', dots: '0', position: 'after', continuation: false }); await enter(fixture);
      const before = snapshot(fixture); const original = await recoverableProject(fixture);
      click(fixture, '#select-mode'); await popup(fixture, '#location-trigger', '#location-panel', true);
      assert(visible(fixture, field(fixture, '#continue-piece')) && !field<HTMLButtonElement>(fixture, '#continue-piece').disabled, 'UX-CONTINUE-LOCAL: a supported final ending must expose Continue this piece in Select-mode Location & actions.');
      click(fixture, '#continue-piece'); await waitFor(fixture, () => field(fixture, '#continuation-review').matches(':popover-open'), 'Open the guarded ending decision from local actions');
      const localExplanation = field(fixture, '#continuation-review-context').textContent ?? '';
      for (const name of ['Flute', 'Vibraphone', 'Cello']) assert(localExplanation.includes(name), `The local ending decision must name affected ${name}, including hidden staves.`);
      assert(/(?:bar|measure)\s*5/i.test(localExplanation) && /F4/.test(localExplanation) && /voice\s*1/i.test(localExplanation), 'The local ending route must disclose the same next bar, pending pitch, and destination voice as the primary route.');
      unchanged(fixture, before, 'Inspect the local final-ending decision before confirmation'); equal(palette(fixture), before.palette, 'The local ending decision must use, not overwrite, the parked insertion recipe');
      click(fixture, '#close-continuation-review'); await frames(fixture); assert(!field(fixture, '#continuation-review').matches(':popover-open'), 'Cancelling the local ending decision must close its native popover.'); unchanged(fixture, before, 'Cancel the local final-ending decision');
      await closeOpenPopovers(fixture); await enter(fixture);
      assert(/continue.*piece/i.test(field(fixture, '#insert-event').textContent ?? ''), 'The final ending must offer a visibly separate Continue this piece decision.'); click(fixture, '#insert-event');
      await waitFor(fixture, () => field(fixture, '#continuation-review').matches(':popover-open'), 'Present the explicit final-ending review');
      const explanation = field(fixture, '#continuation-review-context').textContent ?? '';
      for (const name of ['Flute', 'Vibraphone', 'Cello']) assert(explanation.includes(name), `Final-ending review must name affected ${name}, including staves hidden by the part view.`);
      assert(/(?:bar|measure)\s*5/i.test(explanation) && /F4/.test(explanation) && /voice\s*1/i.test(explanation), 'The decision must state the new bar, pending pitch, and destination voice.'); unchanged(fixture, before, 'Opening final-ending review');
      await mutate(fixture, () => click(fixture, '#confirm-continue-piece'), () => score(fixture).staves[0].measures.length === 5, 'Confirm one all-staff ending, append, and entry transaction');
      const changed = await recoverableProject(fixture); const holder = fixture.doc.createElement('template'); holder.innerHTML = changed.sourceHtml;
      for (const staff of ['ensemble-flute', 'ensemble-vibes', 'ensemble-cello']) {
        equal(holder.content.querySelector(`#${staff}-m4`)?.getAttribute('end-bar'), 'single', 'Every canonical final barline must change only after explicit confirmation'); equal(holder.content.querySelector(`#${staff}`)?.querySelectorAll(':scope > music-measure').length, 5, 'A confirmed continuation appends exactly one canonical column to each affected staff');
      }
      const continued = score(fixture).staves[0].measures[4].voices[0].events[0];
      equal([pitch(continued), continued.duration, continued.onset], ['F4', 'quarter', { numerator: 0, denominator: 1 }], 'The new voice begins with the pending value at exact onset zero');
      await undo(fixture, before); const undone = await recoverableProject(fixture); equal(canonicalSource(fixture, undone.sourceHtml), canonicalSource(fixture, original.sourceHtml), 'One Undo restores the ending, all hidden staves, column, and entry');
      await applySource(fixture, changeSourceAttribute(fixture, 'ensemble-flute-m4', 'end-bar', 'repeat-end')); await selectEvent(fixture, 'ensemble-flute-m4-n1'); await startHere(fixture); await enter(fixture); const repeat = snapshot(fixture);
      if (!field<HTMLButtonElement>(fixture, '#insert-event').disabled) { click(fixture, '#insert-event'); await frames(fixture); await settle(fixture); }
      unchanged(fixture, repeat, 'Repeat boundary rejection'); assert(!field(fixture, '#continuation-review').matches(':popover-open'), 'Repeat semantics must not receive the final-to-single exception.');
      click(fixture, '#select-mode'); await popup(fixture, '#location-trigger', '#location-panel', true);
      const localRepeat = field<HTMLButtonElement>(fixture, '#continue-piece'); assert(!visible(fixture, localRepeat) || localRepeat.disabled, 'UX-CONTINUE-LOCAL: local actions must not offer the final-ending exception at a repeat boundary.'); unchanged(fixture, repeat, 'Inspect guarded repeat-boundary local actions');
      await closeOpenPopovers(fixture);
      const indistinctNames = fixture.doc.createElement('template'); indistinctNames.innerHTML = html;
      indistinctNames.content.querySelector('#ensemble-flute')!.setAttribute('label', '');
      for (const id of ['ensemble-vibes', 'ensemble-cello']) indistinctNames.content.querySelector(`#${id}`)!.setAttribute('label', 'Player');
      indistinctNames.content.querySelector('#ensemble-cello-m4')!.setAttribute('end-bar', 'single');
      await applySource(fixture, indistinctNames.innerHTML); await selectEvent(fixture, 'ensemble-flute-m4-n1'); await startHere(fixture);
      await recipe(fixture, { kind: 'chord', duration: 'quarter', dots: '1', position: 'after', continuation: false });
      await popup(fixture, '#entry-settings-trigger', '#entry-settings', true); write(fixture, '#event-pitches', 'C4 Eb4 G#4'); await closeOpenPopovers(fixture); await enter(fixture);
      const beforeChordReview = snapshot(fixture); const savedBeforeChordReview = JSON.stringify(await recoverableProject(fixture)); click(fixture, '#insert-event');
      await waitFor(fixture, () => field(fixture, '#continuation-review').matches(':popover-open'), 'Review the complete captured dotted chord with ambiguous staff names');
      const chordExplanation = field(fixture, '#continuation-review-context').textContent ?? '';
      const finalChange = chordExplanation.match(/change final barlines to single barlines on ([^.]+)\./i)?.[1]; assert(finalChange, 'The ending review must separately describe which final barlines change.');
      assert(/staff\s*1/i.test(finalChange) && /Player\s*\(staff\s*2\)/i.test(finalChange), 'CONT-FINAL-CONFIRM-CONTENT: missing and duplicate labels must identify the affected canonical staff ordinals, including hidden staff 2.');
      assert(!/staff\s*3/i.test(finalChange), 'The separate final-barline list must not claim that hidden staff 3’s existing single barline changes.');
      assert(/every staff/i.test(chordExplanation) && /hidden/i.test(chordExplanation), 'The review must state that the appended measure aligns every canonical staff, including those without a final barline change.');
      assert(/chord/i.test(chordExplanation) && ['C4', 'Eb4', 'G#4'].every(note => chordExplanation.includes(note)) && /quarter/i.test(chordExplanation) && /1\s+dot|dotted/i.test(chordExplanation), 'The decision must disclose all captured chord pitches and the dotted written value, not just the event kind or nominal pitch.');
      assert(/Staff\s*1,?\s*bar\s*5,?\s*voice\s*1/i.test(chordExplanation) && /one\s+undo/i.test(chordExplanation), 'The complete decision must identify the unique destination and its single Undo boundary.');
      unchanged(fixture, beforeChordReview, 'Review the captured dotted chord'); click(fixture, '#close-continuation-review'); await frames(fixture); await settle(fixture);
      unchanged(fixture, beforeChordReview, 'Cancel the captured dotted chord'); equal(palette(fixture), beforeChordReview.palette, 'Cancelling the complete ending decision must preserve the future chord recipe');
      equal(JSON.stringify(await recoverableProject(fixture)), savedBeforeChordReview, 'Opening and cancelling the ending review must leave all canonical source and project recovery unchanged');
      return { detail: 'Local and primary entry routes disclose the same all-staff ending decision. One confirmation and Undo cover the complete change; repeats stay protected. A further prompt distinguishes missing/duplicate staff names and describes the full captured dotted chord without changing music on Cancel.', metrics: { localGate: 'UX-CONTINUE-LOCAL', contentGate: 'CONT-FINAL-CONFIRM-CONTENT', routes: ['Select → Location & actions → Continue this piece', 'Enter notes → primary action'], localExplanation, chordExplanation, affectedStaves: ['Flute', 'Vibraphone', 'Cello'], hiddenStaves: 2, destination: 'bar 5 · Flute · voice 1 · F4', cancelledLocalTransactions: 0, cancelledChordTransactions: 0, confirmationTransactions: 1, undoTransactions: 1 } };
    },
  },
  {
    gate: 'UX-POINTER-RECOVERY', name: 'A rejected staff placement ends before a separate captured-value continuation decision',
    async run() {
      const fixture = await mount('Strict pointer and explicit recovery'); await applySource(fixture, leadSource(1)); await selectEvent(fixture, 'journey-n1b');
      await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'F#4', duration: 'quarter', dots: '0', position: 'after', continuation: true }); await enter(fixture); await reveal(fixture, 'journey-n1b', 0.25);
      const before = snapshot(fixture); pointerTap(fixture, 'blank-m1', 'journey-n1b'); await frames(fixture); await settle(fixture);
      unchanged(fixture, before, 'Rejected full-bar staff placement'); assert(!fixture.doc.body.dataset.pointerGesture, 'The rejected pointer gesture must end before recovery is offered.');
      const recovery = field(fixture, '#pointer-recovery'); assert(recovery.matches(':popover-open'), 'An eligible rejected placement should offer a separate explicit recovery decision.');
      const explanation = field(fixture, '#pointer-recovery-context').textContent ?? '';
      assert(/F#4|F♯4/.test(explanation) && /(?:bar|measure)\s*2/i.test(explanation) && /voice\s*1/i.test(explanation), 'Recovery must describe the captured pending pitch, new bar, and destination voice.');
      assert(!field(fixture, '#score-host').shadowRoot?.querySelector('.pointer-ghost'), 'No old-measure ghost may imply a different new-measure commit destination.');
      await mutate(fixture, () => click(fixture, '#confirm-pointer-recovery'), () => score(fixture).staves[0].measures.length === 2, 'Confirm the separately stated pointer recovery');
      const note = score(fixture).staves[0].measures[1].voices[0].events[0]; equal([pitch(note), note.duration, note.onset], ['F#4', 'quarter', { numerator: 0, denominator: 1 }], 'Recovery commits the captured value exactly at the separately disclosed destination');
      equal(value(fixture, '#measure-select'), score(fixture).staves[0].measures[1].id, 'The confirmed destination becomes the visible selected measure'); assert(overlaps(eventBox(fixture, note.id), clipBox(fixture)), 'The new destination must be visible after confirmation');
      await undo(fixture, before);
      return { detail: 'A synthetic staff tap cannot silently continue into a different measure; the failed gesture ends and one explicit captured-value confirmation creates the visible new destination.', metrics: { rejectedGestureTransactions: 0, separatelyConfirmedTransactions: 1, capturedPitch: 'F#4', destinationBar: 2, nativePointerCaptureOrTouchQualified: false } };
    },
  },
  {
    gate: 'ENG-PRINT-INVARIANCE', name: 'Workspace changes preserve source breaks, paper composition, profiles, and reviewed turns',
    async run() {
      const fixture = await mount('Physical pages independent of writing workspace'); await template(fixture, 'lead');
      const holder = fixture.doc.createElement('template'); holder.innerHTML = source(fixture);
      holder.content.querySelector('#lead-m5')!.setAttribute('break-before', 'line'); holder.content.querySelector('#lead-m9')!.setAttribute('break-before', 'page'); holder.content.querySelector('#lead-m6')!.setAttribute('keep-with-next', ''); await applySource(fixture, holder.innerHTML);
      const reports: Record<string, unknown>[] = [];
      for (const [paper, part] of [['letter', 'score'], ['a4', 'lead']] as const) {
        if (fixture.doc.body.dataset.view !== 'write') { click(fixture, '#view-write'); await settle(fixture); }
        await exposeControl(fixture, '#part-select'); choose(fixture, '#part-select', part); await closeOpenPopovers(fixture); await settle(fixture); await pageView(fixture);
        await exposeControl(fixture, '#page-paper'); choose(fixture, '#page-paper', paper); write(fixture, '#page-max-measures', '2');
        await mutate(fixture, () => click(fixture, '#apply-pages'), () => !!field(fixture, '#page-host').querySelector('.score-page'), 'Apply explicit physical paper settings');
        await exposeControl(fixture, '#turn-boundary'); const boundary = [...field<HTMLSelectElement>(fixture, '#turn-boundary').options].find(option => option.value); assert(boundary, 'The explicit before-bar-nine page break must produce a physical turn to review.'); choose(fixture, '#turn-boundary', boundary.value);
        await mutate(fixture, () => click(fixture, '#mark-turn-reviewed'), () => /Reviewed for this layout/.test(field(fixture, '#turn-preview').textContent ?? ''), 'Review an actual physical page turn');
        const before = snapshot(fixture); const project = await recoverableProject(fixture); const composition = pageComposition(fixture, paper); const fingerprint = project.layouts[part].reviewedTurns[boundary.value]; assert(fingerprint, 'An actual reviewed turn must retain its saved layout fingerprint.');
        click(fixture, '#view-write'); await settle(fixture); await tools(fixture, true); for (const name of tabNames) await tab(fixture, name); await resize(fixture, 980); await resize(fixture, 1180);
        fixture.view.dispatchEvent(new Event('beforeprint')); equal(fixture.doc.body.dataset.authorPrintReady, 'false', 'Raw printing from Write with tools open must keep the stale-page guard engaged'); equal(fixture.printRequests, 0, 'The raw-print guard test must not request a native dialog');
        click(fixture, '#view-read'); await settle(fixture); const reading = ranges(fixture); await resize(fixture, 900); await resize(fixture, 1180); equal(ranges(fixture), reading, 'Workspace changes must not silently refit captured Read systems');
        await pageView(fixture); await exposeControl(fixture, '#turn-boundary'); choose(fixture, '#turn-boundary', boundary.value);
        unchanged(fixture, before, 'Writing workspace and captured Read changes'); const after = await recoverableProject(fixture); equal(after.layouts, project.layouts, 'All saved page profiles and reviewed-turn fingerprints must remain unchanged'); equal(after.sourceHtml, project.sourceHtml, 'Source line/page/keep constraints must not be authored by workspace reflow');
        equal(pageComposition(fixture, paper), composition, 'Recomputed physical page composition must remain identical for the same source, part, fonts, and paper'); assert(/Reviewed for this layout/.test(field(fixture, '#turn-preview').textContent ?? ''), 'The actual turn must remain visibly reviewed for the recomputed unchanged layout');
        reports.push({ paper, part, sourceBreaks: ['line before 5', 'page before 9', 'keep 6 with 7'], reviewedBoundary: boundary.value, fingerprint, physicalPages: (composition as unknown[]).length });
      }
      await exposeControl(fixture, '#ack-layout-warnings'); check(fixture, '#ack-layout-warnings', true); const beforePrint = fixture.printRequests; click(fixture, '#print-score');
      await waitFor(fixture, () => fixture.printRequests === beforePrint + 1, 'Request printing once at the prepared vector-page boundary'); equal(fixture.doc.body.dataset.authorPrintReady, 'true', 'The prepared print request must pass current publication preflight');
      return { detail: 'Letter/full score and A4/authored-pitch part retain identical physical page composition and reviewed fingerprints after dock, tab, width, and captured Read changes. One print request is intercepted; no saved PDF is claimed.', metrics: { layouts: reports, interceptedPrintRequests: fixture.printRequests, compared: 'public physical page DOM and own saved profiles; no private raw PagePlan hook', savedPdfQualified: false } };
    },
  },
);

tests.unshift(
  {
    gate: 'UX-8BAR', name: 'Thirty-two entries produce eight exact bars; sixty-four produce sixteen',
    async run() {
      const report: Record<string, unknown>[] = [];
      for (const barCount of [8, 16]) {
        const fixture = await mount(`Write ${barCount} bars from Blank`);
        await recipe(fixture, { kind: 'note', pitch: 'F4', duration: 'quarter', dots: '0', position: 'after', continuation: true }); await enter(fixture);
        const header = field(fixture, '#workspace-feedback-label'); const insertLabel = field(fixture, '#insert-event-label'); const insertCaption = field(fixture, '#insert-event-destination');
        const noForecast = (label: string, writing = true) => {
          assert(!/Next with Insert:/i.test(`${header.textContent} ${header.getAttribute('aria-label') ?? ''}`)
            && !visible(fixture, insertCaption), `${label}: neither the visible header nor the button caption may forecast an ineligible next bar.`);
          if (writing) assert(visible(fixture, insertLabel) && insertLabel.textContent?.trim() === 'Insert here', `${label}: the writing action must name insertion at the current location.`);
          else assert(!visible(fixture, insertLabel), `${label}: the insertion action must not appear in Select.`);
        };
        const requireForecast = () => {
          const forecast = header.getAttribute('aria-label') ?? header.textContent ?? '';
          assert(visible(fixture, header) && /^Next with Insert:\s*bar\s*2\b/i.test(header.textContent ?? ''), 'UX-CONTINUE-FORECAST: the next destination must appear in the visible header before input, not only in Location or a title.');
          assert(forecast.includes(score(fixture).staves[0].label || 'Staff') && /voice\s*1(?:\D|$)/i.test(forecast), `Continuation feedback must name the destination staff and voice 1; received ${JSON.stringify(forecast)}.`);
          assert(visible(fixture, insertLabel) && insertLabel.textContent?.trim() === 'Add + insert'
            && visible(fixture, insertCaption) && insertCaption.textContent?.trim() === 'Bar 2', 'The visible primary action must say Add + insert with its Bar 2 destination.');
          return forecast;
        };
        noForecast('Initial empty measure');
        const start = fixture.actions.length; const firstRevision = revision(fixture); let boundaryUndo = false; let forecast = '';
        for (let count = 1; count <= barCount * 4; count++) {
          const before = await insert(fixture, count, barCount === 16);
          if (count === 4) {
            const fullBar = snapshot(fixture); forecast = requireForecast(); unchanged(fixture, fullBar, 'Read the next-bar forecast before any input');
            equal(score(fixture).staves[0].measures.length, 1, 'A destination forecast must not pre-create the next measure');
            click(fixture, '#select-mode'); await frames(fixture);
            noForecast('Select the full bar', false); unchanged(fixture, fullBar, 'Inspect a full bar in Select mode');
            await enter(fixture); requireForecast(); unchanged(fixture, fullBar, 'Restore the full-bar entry forecast');
          }
          if (count === 5) noForecast('The new measure is partial');
          if (count === 5 && barCount === 8) {
            const accepted = source(fixture); await undo(fixture, before); equal(score(fixture).staves[0].measures.length, 1, 'One Undo removes the entire appended column and its note');
            const old = revision(fixture); key(fixture, field(fixture, '#score-editor'), 'z', { ctrlKey: true, shiftKey: true });
            await waitFor(fixture, () => revision(fixture) === old + 1 && canonicalSource(fixture, source(fixture)) === canonicalSource(fixture, accepted), 'Redo the complete continuation transaction'); await settle(fixture); boundaryUndo = true;
          }
        }
        assertQuarterBars(fixture, barCount); const actions = fixture.actions.slice(start);
        equal(actions.filter(action => ['#tools-toggle', '#view-read', '#add-measure'].includes(action.target)).length, 0, 'Ordinary continuation must require no Tools, Read, or manual Add visit');
        equal(revision(fixture) - firstRevision, barCount * 4 + (boundaryUndo ? 2 : 0), 'Every accepted entry contributes exactly one history transaction');
        assert(!visible(fixture, field(fixture, '#workspace-tools')), 'Ordinary writing must leave Tools closed.');
        report.push({ bars: barCount, notes: events(fixture).length, entryMethod: barCount === 16 ? 'synthetic application keyboard routing' : 'primary Insert', musicalTransactions: revision(fixture) - firstRevision, manualAdd: 0, toolsVisits: 0, readVisits: 0, oneBoundaryUndoAndRedo: boundaryUndo,
          forecast: { gate: 'UX-CONTINUE-FORECAST', beforeNextInput: forecast, existingBarsAtForecast: 1, hiddenInSelect: true, hiddenWhenIneligible: true } });
      }
      return { detail: 'The same recipe writes 8 and 16 complete bars without a trailing bar or a detour into Tools; the append and first entry undo together.', metrics: { journeys: report } };
    },
  },
  {
    gate: 'UX-CORRECT-RESUME', name: 'Correct bar eight and explicitly resume the parked writing location in bar forty-eight',
    async run() {
      const fixture = await mount('Correction and explicit resume');
      await applySource(fixture, leadSource(48, '', [48]).replace('<music-note id="journey-n48b" pitch="A4" duration="half"></music-note>', ''));
      await location(fixture, 'journey-m48'); await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'D#6', duration: 'eighth', dots: '1', position: 'after' }); await enter(fixture);
      click(fixture, '#select-mode'); await frames(fixture); const parked = palette(fixture);
      await location(fixture, 'journey-m8'); equal(palette(fixture), parked, 'Choosing another measure must not copy its note into the insertion recipe');
      key(fixture, field(fixture, '#score-editor'), 'ArrowRight'); await frames(fixture); equal(palette(fixture), parked, 'Arrow selection must not alter the independent insertion recipe');
      const activationStart = fixture.actions.length; await selectEvent(fixture, 'journey-n8a'); equal(palette(fixture), parked, 'Staff selection must not alter the independent insertion recipe');
      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true); const before = snapshot(fixture);
      await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => pitch(eventById(fixture, 'journey-n8a')) === 'F#4', 'Correct the selected note immediately');
      equal(fixture.actions.slice(activationStart).filter(action => action.kind === 'click').length, 3, 'Select note → Edit → Sharp must be exactly three activations from Select mode');
      equal(palette(fixture), parked, 'The correction must preserve the configured kind, pitch, written value, dots, and placement');
      await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false);
      assert(visible(fixture, field(fixture, '#toggle-entry')) && /write notes/i.test(field(fixture, '#toggle-entry').textContent ?? ''), 'The fixed Write notes action must remain visible after correction.');
      const resumeStart = fixture.actions.length; click(fixture, '#toggle-entry'); await frames(fixture); await settle(fixture);
      equal(fixture.actions.length - resumeStart, 1, 'The fixed Write notes action must resume directly');
      equal(value(fixture, '#measure-select'), 'journey-m48', 'Resume must target the parked writing measure'); equal(palette(fixture), parked, 'Resume must retain the parked recipe');
      const count = events(fixture).length; await insert(fixture, count + 1);
      const added = score(fixture).staves[0].measures[47].voices[0].events.at(-1)!;
      equal([pitch(added), added.duration, added.dots, added.onset], ['D#6', 'eighth', 1, { numerator: 1, denominator: 2 }], 'Resumed entry must use the original recipe at the correct exact musical time');
      equal(pitch(eventById(fixture, 'journey-n8a')), 'F#4', 'Resuming writing must retain the earlier correction');
      return { detail: 'List, arrows, and staff selection leave the recipe intact; three correction activations and the fixed Write notes action return to bar 48.', metrics: { correctionActivations: 3, resumeActivations: 1, resumeControl: 'toggle-entry', correctedEvent: 'journey-n8a', resumedMeasure: 'journey-m48', parkedRecipe: parked, correctionRevision: before.revision + 1 } };
    },
  },
  {
    gate: 'UX-HARMONY-PASS', name: 'Write a sustained eight-bar harmony pass with one opening and stable recipients',
    async run() {
      const fixture = await mount('Eight-bar harmony pass'); await applySource(fixture, leadSource(8)); await location(fixture, 'blank-m1');
      const originalEvents = music(fixture); await addChord(fixture); equal(value(fixture, '#annotation-kind'), 'harmony', 'Add chord symbol must choose the musical task directly');
      await showNested(fixture, '#annotation-scope'); choose(fixture, '#annotation-scope', 'all'); choose(fixture, '#annotation-placement', 'above'); click(fixture, '#annotation-at-start');
      const progression = ['Dm9', 'G13(b9)', 'Cmaj9', 'A7alt', 'Dm11', 'Db13(#11)', 'C6/9', 'G7sus']; const ids: string[] = []; const firstRevision = revision(fixture);
      for (const [index, text] of progression.entries()) {
        equal(value(fixture, '#annotation-at'), '0', 'A sustained bar-start harmony pass keeps exact onset zero'); equal(value(fixture, '#annotation-scope'), 'all', 'Recipient scope must survive advance'); equal(value(fixture, '#annotation-placement'), 'above', 'Placement must survive advance');
        write(fixture, '#annotation-text', text);
        await mutate(fixture, () => click(fixture, '#add-annotation-next'), () => annotations(fixture).filter(item => item.kind === 'harmony').length === index + 1, 'Commit one chord symbol and advance to an existing measure');
        const accepted = score(fixture).staves[0].measures[index].annotations.find(item => item.kind === 'harmony'); assert(accepted, `Measure ${index + 1} must receive its own harmony.`);
        equal([accepted.text, accepted.placement, accepted.onset], [text, 'above', { numerator: 0, denominator: 1 }], 'Harmony must keep its intended text, placement, and exact onset'); ids.push(accepted.id);
        equal(authorActiveElement(fixture.doc)?.id, 'annotation-text', 'Successful harmony advance must return focus to the text field');
      }
      equal(score(fixture).staves[0].measures.length, 8, 'Harmony advance must never append a ninth bar'); equal(revision(fixture) - firstRevision, 8, 'Eight new symbols require exactly eight musical transactions');
      const project = await recoverableProject(fixture); for (const id of ids) equal(project.instructionScopes[id], 'all', 'Each harmony retains its shared-recipient intent');
      const unchangedEvents = JSON.parse(music(fixture)).map((staff: { measures: { annotations: unknown[] }[] }) => ({ ...staff, measures: staff.measures.map(measure => ({ ...measure, annotations: [] })) }));
      equal(JSON.stringify(unchangedEvents), originalEvents, 'A harmony pass must not rewrite notes, bar structure, voices, or source identities');
      equal(fixture.actions.filter(action => action.target === '#add-chord-symbol').length, 1, 'A complete harmony pass opens the task only once');
      return { detail: 'Eight text-and-advance cycles produce exactly eight chord symbols on existing bars, preserve shared scope, and keep the text field focused.', metrics: { symbols: ids.length, musicalTransactions: 8, taskOpenings: 1, bars: 8, progression } };
    },
  },
  {
    gate: 'UX-HARMONY-EXISTS', name: 'Existing symbols are explicitly loaded, unchanged Apply advances, and invalid text stays with its target',
    async run() {
      const fixture = await mount('Existing harmony and no-op advance');
      const html = leadSource(4).replace('<music-note id="journey-n2a"', '<music-harmony id="existing-harmony" text="G13" at="0" placement="above"></music-harmony><music-note id="journey-n2a"');
      await applySource(fixture, html); await location(fixture, 'blank-m1'); await addChord(fixture); write(fixture, '#annotation-text', 'Dm9');
      await mutate(fixture, () => click(fixture, '#add-annotation-next'), () => annotations(fixture).length === 2, 'Commit bar one and load the existing target without overwriting it');
      equal(value(fixture, '#annotation-select'), 'existing-harmony', 'Unique matching destination must visibly load its original source identity'); equal(value(fixture, '#annotation-text'), 'G13', 'The loaded value must remain the accepted destination symbol');
      assert(visible(fixture, field(fixture, '#update-annotation-next')), 'The next operation must be visibly Apply and next for the existing symbol.');
      const before = snapshot(fixture); click(fixture, '#update-annotation-next'); await frames(fixture); await settle(fixture);
      unchanged(fixture, before, 'Unchanged existing harmony advance', false); equal(value(fixture, '#measure-select'), 'journey-m3', 'An unchanged Apply must still advance to the next existing bar');
      equal(annotations(fixture).filter(annotation => annotation.id === 'existing-harmony').length, 1, 'No-op Apply must not duplicate the loaded symbol');
      write(fixture, '#annotation-text', 'E7alt'); write(fixture, '#annotation-at', 'not-a-rational'); const rejected = snapshot(fixture); const target = draftTarget(fixture, 'annotation');
      click(fixture, '#add-annotation-next'); await frames(fixture); await settle(fixture); unchanged(fixture, rejected, 'Invalid harmony advance');
      equal(value(fixture, '#annotation-text'), 'E7alt', 'Rejected harmony preserves the work'); equal(value(fixture, '#annotation-at'), 'not-a-rational', 'Rejected harmony preserves the invalid field for correction'); equal(draftTarget(fixture, 'annotation'), target, 'Rejected harmony keeps the original target');
      assert(/invalid|rational|position|fraction|number/i.test(`${draftStatus(fixture, 'annotation')} ${field(fixture, '#author-errors').textContent}`), 'A rejected musical position needs an actionable explanation.');
      write(fixture, '#annotation-at', '0'); await mutate(fixture, () => click(fixture, '#add-annotation'), () => annotations(fixture).length === 3, 'Correct the draft and accept the first harmony in bar three');
      await selectEvent(fixture, 'journey-n3b'); await addChord(fixture); equal(value(fixture, '#annotation-at'), '1/2', 'A second chord can capture the selected note’s exact position without typing a fraction');
      write(fixture, '#annotation-text', 'A7alt'); await mutate(fixture, () => click(fixture, '#add-annotation'), () => score(fixture).staves[0].measures[2].annotations.length === 2, 'Place the second harmony in the same bar');
      equal(score(fixture).staves[0].measures[2].annotations.map(item => item.onset), [{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 2 }], 'Two changes in a bar retain separate exact musical positions');
      await location(fixture, 'journey-m4'); await addChord(fixture); choose(fixture, '#annotation-kind', 'direction'); write(fixture, '#annotation-text', 'Solo until cue');
      await mutate(fixture, () => click(fixture, '#add-annotation'), () => annotations(fixture).some(item => item.kind === 'direction' && item.text === 'Solo until cue'), 'Write an improvisation instruction as authored notation');
      equal(score(fixture).staves[0].measures.length, 4, 'An improvisation direction does not create playback bars or infer a duration');
      await applySource(fixture, source(fixture).replace('<music-note id="journey-n2a"', '<music-harmony id="ambiguous-harmony" text="G7sus" at="0"></music-harmony><music-note id="journey-n2a"'));
      await location(fixture, 'blank-m1'); await tab(fixture, 'markings'); choose(fixture, '#annotation-select', score(fixture).staves[0].measures[0].annotations[0].id);
      const ambiguity = snapshot(fixture); click(fixture, '#update-annotation-next'); await frames(fixture); await settle(fixture); unchanged(fixture, ambiguity, 'Ambiguous destination after unchanged Apply', false);
      equal(field(fixture, '#annotation-inspector').dataset.annotationState, 'choose', 'Multiple matching symbols must require a visible choice before the next mutation');
      assert(/choose|several|matching/i.test(draftStatus(fixture, 'annotation')), 'Ambiguous harmony must explain why the next target needs an explicit choice.');
      equal(score(fixture).staves[0].measures[1].annotations.length, 2, 'Ambiguous advance must not duplicate or overwrite either existing symbol');
      choose(fixture, '#annotation-select', 'existing-harmony'); equal(value(fixture, '#annotation-text'), 'G13', 'An explicit existing choice loads precisely its original value');
      choose(fixture, '#annotation-select', ''); equal(value(fixture, '#annotation-select'), '', 'An explicit native New choice starts a new instruction without writing it'); unchanged(fixture, ambiguity, 'Explicit collision resolution choices', false);
      return { detail: 'Existing identity, no-op advance, invalid drafts, and ambiguous destinations are handled explicitly. Two exact harmony positions and Solo until cue remain ordinary authored notation.', metrics: { existingId: 'existing-harmony', noOpHistoryTransactions: 0, accidentalDuplicateSymbols: 0, sameBarOnsets: ['0', '1/2'], improvisationDirection: 'Solo until cue', ambiguousDestinationRequiresChoice: true } };
    },
  },
);

tests.push(
  {
    gate: 'UX-WRITTEN-IMPROVISED', name: 'Duplicate a written section before its vamp and choose clear next-entry slash semantics',
    async run() {
      const fixture = await mount('Written section, vamp, and next-entry semantics'); await template(fixture, 'lead'); await location(fixture, 'lead-m7'); await tab(fixture, 'measure');
      choose(fixture, '#duplicate-from-measure', 'lead-m7'); choose(fixture, '#duplicate-through-measure', 'lead-m8');
      const originalEvents = new Map(events(fixture).map(event => [event.id, JSON.stringify(event)])); const before = snapshot(fixture);
      await mutate(fixture, () => click(fixture, '#duplicate-measures'), () => score(fixture).staves[0].measures.length === 14, 'Duplicate two aligned written bars before the existing vamp');
      const bars = score(fixture).staves[0].measures; equal(bars[10].id, 'lead-m9', 'The existing vamp follows the two new bars without changing its canonical identity'); equal(bars[12].id, 'lead-m11', 'The existing written cue retains its canonical identity');
      for (const event of events(fixture)) if (originalEvents.has(event.id)) equal(JSON.stringify(event), originalEvents.get(event.id), 'Duplicating a section must not rewrite any existing musical event');
      const copied = bars.slice(8, 10); assert(copied.every(measure => !['lead-m7', 'lead-m8', 'lead-m9'].includes(measure.id)), 'Duplicated bars must receive fresh source identities');
      equal(new Set(events(fixture).map(event => event.id)).size, events(fixture).length, 'All copied event identities must be unique');
      assert(annotations(fixture).some(item => item.id === 'lead-vamp-instruction' && /cue/i.test(item.text)), 'The original improvisation instruction must stay at the original vamp.');
      await undo(fixture, before); await tools(fixture, false); await enter(fixture); const preferenceOnly = snapshot(fixture); const saved = JSON.stringify(await recoverableProject(fixture)); const labels: string[] = [];
      await popup(fixture, '#entry-settings-trigger', '#entry-settings', true);
      for (const kind of ['note', 'rhythmic-slash', 'slash', 'note']) {
        choose(fixture, '#event-kind', kind); labels.push(field<HTMLSelectElement>(fixture, '#event-kind').selectedOptions[0].textContent ?? ''); await frames(fixture); unchanged(fixture, preferenceOnly, 'Choose the next entry kind');
      }
      await popup(fixture, '#entry-settings-trigger', '#entry-settings', false);
      assert(labels.some(label => /rhythmic slash/i.test(label)) && labels.some(label => /open slash/i.test(label)), 'Written slash rhythm and open improvisation must have distinct visible next-entry names.'); equal(JSON.stringify(await recoverableProject(fixture)), saved, 'Choosing future notation semantics must not write recovery/history for existing music');
      return { detail: 'Two written bars duplicate before the retained vamp/cue in one transaction and one Undo; future note, rhythmic slash, and open slash choices do not alter the composition.', metrics: { duplicatedBars: 2, resultingBars: 14, originalVamp: 'lead-m9', originalCue: 'lead-m11', undoTransactions: 1, entryChoiceLabels: labels } };
    },
  },
  {
    gate: 'ENG-SCALE', name: 'Dense piano keeps its writing frame and intrinsic size across side-pane and task-sheet layouts',
    async run() {
      const fixture = await mount('Dense piano intrinsic size and side/sheet threshold', 1500); await template(fixture, 'piano'); await selectEvent(fixture, 'piano-upper-m3-n3');
      const before = snapshot(fixture); const reference = await neutralMetrics(fixture, 'piano-upper-m3-n3');
      const closedWidth = box(field(fixture, '#score-scroll')).width; const closedRanges = ranges(fixture);
      equalScale(inkMetrics(surface(fixture), 'piano-upper-m3-n3'), reference, 'Tools closed'); await tools(fixture, true);
      const a = ranges(fixture); const wide = box(field(fixture, '#score-scroll')); const widePane = box(field(fixture, '#workspace-tools'));
      equal(fixture.doc.body.dataset.toolsPresentation, 'side', 'The wide scenario must exercise a real side pane in spare width');
      assert(Math.abs(wide.width - closedWidth) <= 0.5, 'Opening More must not shrink the chosen writing frame to fit a pane.'); equal(a, closedRanges, 'Opening More must preserve existing system grouping');
      assert(widePane.left >= wide.right - 1, 'At the wide fixture the tools must use the side dock, not cover the music.'); assert(wide.width >= limits.pinnedScore, 'A pinned task pane must leave at least 719px of actual score surface.');
      equalScale(inkMetrics(surface(fixture), 'piano-upper-m3-n3'), reference, 'Wide tools dock');
      for (const name of taskNames) { await tab(fixture, name); equal(ranges(fixture), a, 'Dense nested tuplets and lower-voice chords must not rewrap on a task switch'); assert(Math.abs(box(field(fixture, '#score-scroll')).width - wide.width) <= 0.5, 'Task choice must not resize dense piano'); }
      await resize(fixture, 980); const narrow = box(field(fixture, '#score-scroll')); const narrowPane = box(field(fixture, '#workspace-tools'));
      equal(fixture.doc.body.dataset.toolsPresentation, 'sheet', 'Without spare side width the deliberate task must become a sheet');
      assert(visible(fixture, field(fixture, '#workspace-tools')) && field(fixture, '#score-editor').inert && !visible(fixture, field(fixture, '#score-editor')), 'The sheet must hide and disable the mounted paper, not leave competing visible notation underneath.');
      assert(inside(narrowPane, { left: 0, top: 0, right: 980, bottom: fixture.view.innerHeight, width: 980, height: fixture.view.innerHeight }), 'The deliberate task sheet must remain within the actual viewport.');
      const sheetRanges = ranges(fixture); click(fixture, '#tools-expand'); await frames(fixture); await settle(fixture);
      assert(visible(fixture, field(fixture, '#score-editor')) && !field(fixture, '#score-editor').inert, 'Return to score must restore interactive notation.');
      assert(Math.abs(box(field(fixture, '#score-scroll')).width - narrow.width) <= 0.5, 'Leaving a sheet must not reframe the paper.'); equal(ranges(fixture), sheetRanges, 'Return from the task sheet must preserve the current system grouping');
      equalScale(inkMetrics(surface(fixture), 'piano-upper-m3-n3'), reference, 'Visible paper after narrow task sheet');
      await resize(fixture, 1500); equal(ranges(fixture), a, 'Returning A→B→A must restore the same dense-piano system grouping'); equalScale(inkMetrics(surface(fixture), 'piano-upper-m3-n3'), reference, 'Restored wide writing frame'); unchanged(fixture, before, 'Side/sheet threshold and task changes');
      return { detail: 'Nested 3:2/5:4 piano keeps intrinsic ink size and the chosen frame through More. The 1500px side scenario becomes an explicit sheet at 980px; Return exposes the same paper, and A→B→A restores grouping.', metrics: { reference, widths: [1500, 980, 1500], wideScoreWidth: wide.width, narrowScoreWidth: narrow.width, restoredRanges: a, tolerances: { staffSpace: 0.1, notehead: 0.25, scaleFraction: 0.01, tabWidth: 0.5 } } };
    },
  },
  {
    gate: 'UX-VIEW', name: 'Bar eight stays selected while a lower staff in bar forty-eight remains in view',
    async run() {
      const fixture = await mount('64-bar ensemble independent visible anchor', 1500); await template(fixture, 'ensemble'); await applySource(fixture, ensembleSource(64));
      await selectEvent(fixture, 'ensemble-flute-m8-n1'); await reveal(fixture, 'ensemble-cello-m48-n1', 0.04);
      const before = snapshot(fixture); const original = offset(fixture, 'ensemble-cello-m48-n1'); const positions: Record<string, unknown>[] = [];
      assert(overlaps(eventBox(fixture, 'ensemble-cello-m48-n1'), clipBox(fixture)), 'The lower staff of bar 48 must actually be visible before a workspace change.');
      for (let index = 0; index < 10; index++) {
        await tools(fixture, true); await tab(fixture, taskNames[index % taskNames.length]); equal(fixture.doc.body.dataset.toolsPresentation, 'side', 'The visible-anchor task cycle requires a side pane with visible paper'); anchorRetained(fixture, 'ensemble-cello-m48-n1', original, `Task switch ${index + 1}`);
        positions.push({ operation: `task ${index + 1}`, ...offset(fixture, 'ensemble-cello-m48-n1') });
      }
      await resize(fixture, 980); equal(fixture.doc.body.dataset.toolsPresentation, 'sheet', 'The narrower task becomes a deliberate sheet');
      assert(field(fixture, '#score-editor').inert && !visible(fixture, field(fixture, '#score-editor')), 'The task sheet must not permit scrolling hidden paper.');
      click(fixture, '#tools-expand'); await frames(fixture); await settle(fixture); anchorRetained(fixture, 'ensemble-cello-m48-n1', original, 'Return from the narrow task sheet');
      await resize(fixture, 1500); anchorRetained(fixture, 'ensemble-cello-m48-n1', original, 'Restored wide layout');
      await tools(fixture, false); anchorRetained(fixture, 'ensemble-cello-m48-n1', original, 'Hide tools'); unchanged(fixture, before, 'Long-score workspace navigation');
      equal(value(fixture, '#measure-select'), 'ensemble-flute-m8', 'Visible bar 48 must never replace the independently selected bar 8');
      // Issue an intentional new scroll immediately after a layout-changing
      // action. This uses only real scroll state and records whether the app
      // exposed an in-flight render; no production timers/hooks are replaced.
      const scroller = field(fixture, '#score-scroll'); const lateTarget = eventBox(fixture, 'ensemble-cello-m56-n1'); const clip = clipBox(fixture);
      const targetScroll = scroller.scrollTop + lateTarget.top - clip.top - 12;
      click(fixture, '#edit-selected-event'); const duringRendering = fixture.doc.body.dataset.renderState === 'rendering';
      assert(visible(fixture, scroller) && !field(fixture, '#score-editor').inert, 'The newer user scroll must act on visible paper beside the task, not through a sheet.');
      scroller.scrollTop = Math.min(Math.max(0, targetScroll), scroller.scrollHeight - scroller.clientHeight); const chosenScroll = scroller.scrollTop;
      await frames(fixture); await settle(fixture); await frames(fixture);
      assert(Math.abs(scroller.scrollTop - chosenScroll) <= 2 || overlaps(eventBox(fixture, 'ensemble-cello-m56-n1'), clipBox(fixture)), 'A newer real scroll must win over the old bar-48 restoration request.');
      assert(!overlaps(eventBox(fixture, 'ensemble-cello-m48-n1'), clipBox(fixture)), 'The stale bar-48 anchor must not pull the user back after an intentional later scroll.');
      unchanged(fixture, before, 'Newer scroll wins');
      return { detail: 'Ten task switches preserve a separate lower-staff viewing anchor while bar 8 stays selected. A newer real scroll is not overwritten by the earlier restoration request.', metrics: { selectedMeasure: 'ensemble-flute-m8', visibleAnchor: 'ensemble-cello-m48-n1', originalOffset: original, positions, anchorTolerancePx: 2, lateScroll: { target: 'ensemble-cello-m56-n1', requested: chosenScroll, actual: scroller.scrollTop, duringRendering }, pendingRenderRaceQualified: duringRendering, humanTwentyMinuteWalkthroughQualified: false } };
    },
  },
  {
    gate: 'UX-SCORE-FIRST', name: 'Actual notation stays usable beside header-sized desktop, phone, and short-screen controls',
    async run() {
      const observations: Record<string, unknown>[] = [];
      for (const name of ['lead', 'piano'] as const) {
        const fixture = await mount(`${name} initial desktop score budgets`); await template(fixture, name); await tools(fixture, false);
        fixture.view.scrollTo(0, 0); field(fixture, '#score-scroll').scrollTop = 0; await frames(fixture);
        const metrics = layoutMetrics(fixture); assert(Number(metrics.firstInk) <= limits.desktopFirstInk, `${name}: first actual notation must appear by y=${limits.desktopFirstInk}, received ${metrics.firstInk}.`);
        assert(Number(metrics.usableHeight) >= limits.desktopScore, `${name}: useful score viewport must be at least ${limits.desktopScore}px, received ${metrics.usableHeight}.`);
        assert(Math.abs((metrics.strip as Box).height - expectedPaletteLayout(fixture).height) <= 1, 'The desktop music palette must use the header height and spacing, allowing one rounding pixel.');
        const id = name === 'lead' ? 'lead-m1-n1' : 'piano-upper-m1-n1'; equalScale(inkMetrics(surface(fixture), id), await neutralMetrics(fixture, id), `${name} first-screen music`);
        observations.push({ fixture: name, ...metrics });
      }
      const phone = await mount('Phone useful notation budgets', 390, 660); await applySource(phone, leadSource(8)); await tools(phone, false); phone.view.scrollTo(0, 0); field(phone, '#score-scroll').scrollTop = 0; await frames(phone);
      const regular = layoutMetrics(phone); assert(Number(regular.firstInk) <= limits.phoneFirstInk, `Phone first notation must appear by y=${limits.phoneFirstInk}, received ${regular.firstInk}.`); observations.push({ fixture: 'phone', ...regular });
      await recipe(phone, { pitch: 'F4', duration: 'quarter', dots: '0' }); await enter(phone); const entry = layoutMetrics(phone);
      assert(Math.abs((entry.strip as Box).height - expectedPaletteLayout(phone).height) <= 1, 'Phone Enter mode must retain the two rows and spacing shared with the header.'); observations.push({ fixture: 'phone enter', ...entry });
      click(phone, '#select-mode'); await resize(phone, 390, 360); await selectEvent(phone, 'journey-n6a'); await tools(phone, false); await reveal(phone, 'journey-n6a', 0.1);
      const short = layoutMetrics(phone); assert(Number(short.usableHeight) >= limits.shortScore, `Deep short-screen Select needs at least ${limits.shortScore}px of useful score, received ${short.usableHeight}.`);
      assert(Math.abs((short.strip as Box).height - expectedPaletteLayout(phone).height) <= 1, 'Short-screen Select must use the shared header padding while retaining both palette rows.'); observations.push({ fixture: 'short deep Select', ...short });
      for (const observation of observations) for (const control of observation.controls as (Box & { selector: string })[]) {
        if (control.width === 0 || control.height === 0) continue;
        assert(control.width >= limits.target && control.height >= limits.target, `${control.selector}: currently visible target must be at least ${limits.target}px in both axes, received ${control.width}×${control.height}.`);
      }
      await popup(phone, '#location-trigger', '#location-panel', true); const panel = box(field(phone, '#location-panel')); const viewport: Box = { left: 0, top: 0, right: 390, bottom: 360, width: 390, height: 360 };
      assert(inside(panel, viewport), 'The short-screen location/actions popover must fit its actual viewport.');
      for (const selector of ['#add-measure', '#next-measure', '#add-chord-symbol']) assert(inside(box(field(phone, selector)), panel), `${selector} must be discoverable immediately on opening the short-screen actions panel, without scrolling past selectors.`);
      const locationTrigger = field(phone, '#location-trigger');
      assert(/action|add|write|location/i.test(`${locationTrigger.textContent ?? ''} ${locationTrigger.getAttribute('aria-label') ?? ''}`), 'The local trigger must name its writing/location task accessibly while the compact label states ownership.');
      return { detail: 'Useful score height and first ink are measured from actual transformed notation, with an ordinary visible notehead and intrinsic engraving size—not blank SVG or reduced music.', metrics: { lockedLimits: limits, observations } };
    },
  },
  {
    gate: 'ENG-WIDE-BAR', name: 'A dense accidental-rich bar stays readable and all horizontal ink remains reachable',
    async run() {
      const fixture = await mount('Phone dense bar and ledger visibility', 390, 660);
      const dense = `<music-staff id="blank-staff" label="Dense readable bar" clef="treble" meter="4/4" key="C"><music-measure id="blank-m1"><music-harmony id="wide-harmony" text="Cmaj13(#11) / freely vary the upper extensions" at="0"></music-harmony>${Array.from({ length: 16 }, (_, index) => `<music-note id="wide-n${index + 1}" pitch="${index % 2 ? 'Bb4' : 'C#5'}" duration="sixteenth" accidental-display="courtesy"></music-note>`).join('')}</music-measure><music-measure id="wide-ledgers"><music-note id="wide-high" pitch="C#7" duration="half" accidental-display="courtesy"></music-note><music-note id="wide-low" pitch="Cb2" duration="half" accidental-display="courtesy"></music-note></music-measure></music-staff>`;
      await applySource(fixture, dense); await tools(fixture, false); equalScale(inkMetrics(surface(fixture), 'wide-n1'), await neutralMetrics(fixture, 'wide-n1'), 'Accidental-rich wide bar');
      await selectEvent(fixture, 'wide-n1');
      const scroller = horizontalViewport(fixture, 'wide-n1'); assert(scroller.tabIndex >= 0, 'The real horizontal score viewport must be keyboard-focusable.');
      assert(scroller.matches('.system-row') && scroller.getRootNode() === surface(fixture).shadowRoot, 'ENG-INNER-SCROLL-SELECTION must exercise the real per-system scrolling element inside MusicSurface’s shadow root.');
      scroller.scrollLeft = 0; await reveal(fixture, 'wide-n1', 0.25); assert(overlaps(eventBox(fixture, 'wide-n1'), clipBox(fixture)), 'The first dense-bar note must be reachable at the start of the horizontal scroll range.');
      const currentRegion = (): Box => { const context = geometry(fixture, 'wide-n1'); return screenBox(context.svg, context.system.events.find(event => event.sourceId === 'wide-n1')!); };
      const currentOutline = (): Box | undefined => {
        const outlines = field(fixture, '#score-host').shadowRoot!.querySelectorAll<HTMLElement>('.author-selection:not(.author-measure-selection)');
        assert(outlines.length <= 1, 'A single selected dense-bar note must never leave a second stale event outline.'); return outlines[0] ? box(outlines[0]) : undefined;
      };
      const initialRegion = currentRegion(); const initialOutline = currentOutline(); assert(initialOutline, 'The visible selected dense-bar note must have its actual event outline.');
      const selectedContext = geometry(fixture, 'wide-n1'); const selectedHead = selectedContext.system.events.find(event => event.sourceId === 'wide-n1')!.noteheads?.[0]; assert(selectedHead, 'The selected dense-bar event must expose its real notehead geometry.');
      assert(inside(screenBox(selectedContext.svg, selectedHead), initialOutline), 'The initial event outline must actually enclose the selected source notehead.');
      assert(Math.abs((initialOutline.left + initialOutline.right) - (initialRegion.left + initialRegion.right)) <= 2
        && Math.abs((initialOutline.top + initialOutline.bottom) - (initialRegion.top + initialRegion.bottom)) <= 2, 'The outline must start centered on the selected source region, not establish a baseline over a different note.');
      const edges = ['left', 'top', 'right', 'bottom'] as const;
      const outlineInset = Object.fromEntries(edges.map(edge => [edge, initialOutline[edge] - initialRegion[edge]])) as Record<typeof edges[number], number>;
      const checkOutline = (required: boolean): Box | undefined => {
        const current = currentOutline(); const region = currentRegion();
        if (!current) { assert(!required && !overlaps(eventBox(fixture, 'wide-n1'), clipBox(fixture)), 'A visible selected note must retain its outline.'); return undefined; }
        for (const edge of edges) assert(Math.abs(current[edge] - region[edge] - outlineInset[edge]) <= 1, `The selected-note outline ${edge} must follow the current public SVG transform after inner scrolling, not remain over another note.`);
        return current;
      };
      const beforePan = snapshot(fixture); let nonComposedInnerScrollObserved = false;
      scroller.addEventListener('scroll', event => { nonComposedInnerScrollObserved ||= event.target === scroller && !event.composed; }, { once: true });
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth; await frames(fixture); assert(overlaps(eventBox(fixture, 'wide-n16'), clipBox(fixture)), 'The final dense-bar note must be reachable at the end of the horizontal scroll range.');
      assert(nonComposedInnerScrollObserved, 'The test must observe the real inner scroll event that does not cross the notation shadow root.');
      assert(!overlaps(eventBox(fixture, 'wide-n1'), clipBox(fixture)), 'The selected first note must actually leave the visible score region before testing Return.');
      const shiftedOutline = checkOutline(false);
      assert(!shiftedOutline || !overlaps(shiftedOutline, clipBox(fixture)), 'The offscreen first-note outline must not remain visible over later notes after panning to the bar’s end.');
      await popup(fixture, '#location-trigger', '#location-panel', true);
      assert(visible(fixture, field(fixture, '#return-to-selection')), 'Inner scrolling must make the local Return action available for the same offscreen source selection.'); unchanged(fixture, beforePan, 'Pan the inner system away from its selected note');
      click(fixture, '#return-to-selection'); await popup(fixture, '#location-trigger', '#location-panel', false); await frames(fixture); await settle(fixture);
      assert(inside(eventBox(fixture, 'wide-n1'), clipBox(fixture)), 'Return after inner scrolling must expose the same selected note and its accidental ink.'); const returnedOutline = checkOutline(true);
      unchanged(fixture, beforePan, 'Return to the selected source after inner scrolling');
      // Keep the dense-bar horizontal case intact. Separate authored lines in a
      // short ledger fixture make vertical offscreen selection a real precondition.
      const ledger = await mount('Ledger Return after a real vertical scroll', 390, 360);
      const ledgerSource = ledger.doc.createElement('template'); ledgerSource.innerHTML = leadSource(8);
      for (const measure of [...ledgerSource.content.querySelectorAll('music-measure')].slice(1)) measure.setAttribute('break-before', 'line');
      for (const [original, id, pitch] of [['journey-n8a', 'wide-high', 'C#7'], ['journey-n8b', 'wide-low', 'Cb2']]) {
        const note = ledgerSource.content.querySelector(`#${original}`)!; note.id = id; note.setAttribute('pitch', pitch); note.setAttribute('accidental-display', 'courtesy');
      }
      await applySource(ledger, ledgerSource.innerHTML);
      const extremes: Record<string, unknown>[] = [];
      for (const id of ['wide-high', 'wide-low']) {
        await selectEvent(ledger, id); await reveal(ledger, 'journey-n1a', 0.1);
        const offscreenInk = eventBox(ledger, id); const beforeClip = clipBox(ledger); const beforeReturn = snapshot(ledger);
        assert(!overlaps(offscreenInk, beforeClip), `${id}: the selected ledger event must actually leave the score clip before Return is required.`);
        await popup(ledger, '#location-trigger', '#location-panel', true);
        assert(visible(ledger, field(ledger, '#return-to-selection')), 'A proven offscreen selection needs the explicit local Return to selection action.'); click(ledger, '#return-to-selection');
        await popup(ledger, '#location-trigger', '#location-panel', false); await frames(ledger); await settle(ledger);
        const ink = eventBox(ledger, id); const clip = clipBox(ledger); const strip = box(field(ledger, '#workspace-dock'));
        assert(inside(ink, clip), `${id}: Return must expose the selected accidental, ledger, and event ink, not only its stave center.`); assert(!overlaps(ink, strip), `${id}: sticky writing controls must not hide the selected ledger note.`);
        unchanged(ledger, beforeReturn, `${id}: Return to the exact offscreen ledger selection`); extremes.push({ id, offscreenInk, beforeClip, ink, clip });
      }
      assert(fixture.doc.documentElement.scrollWidth <= fixture.doc.documentElement.clientWidth + 1, 'The wide measure must not force application-level horizontal scrolling.');
      assert(ledger.doc.documentElement.scrollWidth <= ledger.doc.documentElement.clientWidth + 1, 'Ledger Return must not create application-level horizontal scrolling.');
      return { detail: 'Sixteen courtesy-accidental sixteenths retain intrinsic size. A real inner shadow-root scroll updates both the outline’s SVG position and Return without changing music; a separate short-screen fixture proves C#7 and Cb2 are offscreen before Return exposes their complete ledger ink.', metrics: { innerScrollGate: 'ENG-INNER-SCROLL-SELECTION', nonComposedInnerScrollObserved, selectedInnerSource: 'wide-n1', initialOutline, shiftedOutline: shiftedOutline ?? null, returnedOutline, innerScrollTransactions: 0, horizontalOwner: scroller.id || scroller.className, horizontalRange: scroller.scrollWidth - scroller.clientWidth, denseNotes: 16, ledgerViewport: [390, 360], selectedExtremes: extremes } };
    },
  },
);

async function primeRedo(fixture: Fixture, noteId: string): Promise<void> {
  await selectEvent(fixture, noteId); const original = snapshot(fixture); await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', true);
  assert(eventById(fixture, noteId).pitches[0].alter !== 1, 'The redo checkpoint must make a real accidental change.');
  await mutate(fixture, () => click(fixture, '#selection-chooser-sharp'), () => eventById(fixture, noteId).pitches[0].alter === 1, 'Create a real musical redo checkpoint');
  await popup(fixture, '#selection-pitch', '#selection-pitch-chooser', false); await undo(fixture, original);
  assert(!field<HTMLButtonElement>(fixture, '#redo').disabled, 'The safety fixture needs a real available Redo branch.');
}
async function staleActivation(fixture: Fixture, selector: string): Promise<void> {
  // Native .click() correctly suppresses disabled buttons. Deliver an explicit
  // stale DOM event instead to check the handler's source/target guard as well.
  fixture.actions.push({ kind: 'click', target: selector, value: 'deliberate stale DOM delivery; not a trusted disabled-button activation' });
  field(fixture, selector).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1, view: fixture.view }));
  await frames(fixture); await settle(fixture);
}
tests.push(
  {
    gate: 'UX-DIRTY-STRUCTURAL-TARGET', name: 'Dirty forms naming A cannot structurally edit the later selection B',
    async run() {
      const fixture = await mount('Dirty form structural target guards');
      await applySource(fixture, leadSource(8, '', [6]).replace('<music-note id="journey-n6b" pitch="A4" duration="half"></music-note>', ''));
      await primeRedo(fixture, 'journey-n8a'); const saved = JSON.stringify(await recoverableProject(fixture));
      await selectEvent(fixture, 'journey-n2a'); await tab(fixture, 'edit'); write(fixture, '#selected-pitch', 'F#4'); await selectEvent(fixture, 'journey-n6a'); await tab(fixture, 'edit');
      equal(field(fixture, '#selection-inspector').dataset.draftTarget, 'journey-n2a', 'The dirty Edit form must retain its original source identity A');
      equal(value(fixture, '#selected-pitch'), 'F#4', 'Selecting B must retain the original unaccepted pitch draft');
      assert(field<HTMLButtonElement>(fixture, '#remove-event').disabled, 'Remove must be disabled while its dirty form names A and the selected event is B.');
      assert(/draft|unapplied|return|discard/i.test(field(fixture, '#selected-draft-status').textContent ?? ''), 'The disabled structural action must have a visible dirty-target explanation.');
      const eventGuard = snapshot(fixture); await staleActivation(fixture, '#remove-event'); unchanged(fixture, eventGuard, 'Stale Remove from a dirty A form'); equal(value(fixture, '#selected-pitch'), 'F#4', 'Rejected Remove must preserve the original pitch draft');
      click(fixture, '#load-event-values'); await frames(fixture); equal(field(fixture, '#selection-inspector').dataset.draftTarget, 'journey-n6a', 'Explicit discard and start here may adopt selection B');
      await location(fixture, 'journey-m2'); await tab(fixture, 'measure'); write(fixture, '#measure-meter', '8/8'); await selectEvent(fixture, 'journey-n6a'); await tab(fixture, 'measure');
      await requireTarget(fixture, 'measure', 'journey-m2', 2); equal(value(fixture, '#measure-meter'), '8/8', 'The dirty Measure form must retain A’s draft');
      const structural = ['#add-voice', '#move-measure-earlier', '#move-measure-later', '#remove-measure', '#review-short-measure', '#clear-short-review'];
      const measureGuard = snapshot(fixture);
      for (const selector of structural) {
        assert(field<HTMLButtonElement>(fixture, selector).disabled, `${selector} must be disabled while its dirty form names measure A and the selected measure is B.`);
        assert(/draft|unapplied|return|discard/i.test(field(fixture, '#measure-draft-status').textContent ?? ''), `${selector} needs the retained-target explanation.`);
        await staleActivation(fixture, selector); unchanged(fixture, measureGuard, `${selector} stale target delivery`); equal(value(fixture, '#measure-meter'), '8/8', 'Rejected structural commands must keep the unaccepted meter');
      }
      equal(JSON.stringify(await recoverableProject(fixture)), saved, 'Rejected stale structural commands and draft navigation must not alter saved project metadata');
      assert(!field<HTMLButtonElement>(fixture, '#redo').disabled, 'Target guards must preserve the existing Redo branch.');
      return { detail: 'A dirty pitch and meter remain bound to bar 2 while bar 6 is selected; disabled structural controls also reject intentionally delivered stale DOM events without changing source, cursor, history, drafts, or recovery.', metrics: { eventTargetA: 'journey-n2a', measureTargetA: 'journey-m2', selectedB: 'journey-n6a', guardedStaleDeliveries: 1 + structural.length, musicalTransactions: 0, redoRetained: true, trustedDisabledActivationClaimed: false } };
    },
  },
  {
    gate: 'UX-MARKING-NOOP-REVEAL', name: 'No-op harmony navigation leaves no delayed jump, and later scrolling wins over an entry reveal',
    async run() {
      const fixture = await mount('No-op harmony and later user scrolling', 1500);
      const html = leadSource(64, '', [64]).replace('<music-note id="journey-n64b" pitch="A4" duration="half"></music-note>', '')
        .replace('<music-note id="journey-n1a"', '<music-harmony id="noop-first" text="Dm9" at="0"></music-harmony><music-note id="journey-n1a"')
        .replace('<music-note id="journey-n2a"', '<music-harmony id="noop-next" text="G13" at="0"></music-harmony><music-note id="journey-n2a"')
        .replace('id="journey-m48"', 'id="journey-m48" break-before="line"');
      await applySource(fixture, html); await primeRedo(fixture, 'journey-n4a'); await location(fixture, 'blank-m1'); await tab(fixture, 'markings'); choose(fixture, '#annotation-select', 'noop-first');
      const before = snapshot(fixture); click(fixture, '#update-annotation-next'); await frames(fixture); await settle(fixture);
      unchanged(fixture, before, 'Unchanged harmony Apply and next', false); equal(value(fixture, '#annotation-select'), 'noop-next', 'The unchanged action must navigate immediately to the existing next harmony'); equal(value(fixture, '#measure-select'), 'journey-m2', 'No-op harmony navigation selects the next existing bar');
      await reveal(fixture, 'journey-n48a', 0.08); const laterAnchor = offset(fixture, 'journey-n48a'); const afterNavigation = snapshot(fixture);
      for (const open of [false, true, false]) { await tools(fixture, open); anchorRetained(fixture, 'journey-n48a', laterAnchor, 'Later tools change after no-op harmony advance'); assert(overlaps(eventBox(fixture, 'journey-n48a'), clipBox(fixture)), 'A consumed no-op navigation intent must not reveal bar 2 after a later user scroll.'); }
      unchanged(fixture, afterNavigation, 'No latent no-op reveal after later tools changes'); assert(!field<HTMLButtonElement>(fixture, '#redo').disabled, 'No-op navigation, scroll, and tools must preserve Redo.');
      const beforeShortViewport = snapshot(fixture); const wideRanges = ranges(fixture); const writingWidth = box(field(fixture, '#score-scroll')).width;
      await resize(fixture, 1500, 360);
      equal(ranges(fixture), wideRanges, 'The shorter race viewport must retain the same musical system grouping');
      assert(Math.abs(box(field(fixture, '#score-scroll')).width - writingWidth) <= 0.5, 'Only height may change when preparing the shorter scroll-race fixture.');
      unchanged(fixture, beforeShortViewport, 'Prepare the short viewport without editing or rewrapping music');
      await selectEvent(fixture, 'journey-n64a'); await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'D#6', duration: 'quarter', dots: '0', position: 'after' }); await enter(fixture); await settle(fixture);
      const scroller = field(fixture, '#score-scroll'); const clip = clipBox(fixture); const target = eventBox(fixture, 'journey-n32a'); const requested = scroller.scrollTop + target.top - clip.top - 24;
      const current64 = eventBox(fixture, 'journey-n64a'); const candidateScroll = Math.min(Math.max(0, requested), scroller.scrollHeight - scroller.clientHeight);
      const candidateDelta = candidateScroll - scroller.scrollTop;
      const afterCandidateScroll = (ink: Box): Box => ({ ...ink, top: ink.top - candidateDelta, bottom: ink.bottom - candidateDelta });
      const candidate32 = afterCandidateScroll(target); const candidate64 = afterCandidateScroll(current64);
      assert(inside(current64, clip), 'Before Insert, the actual bar-64 writing event must be fully visible.');
      assert(Math.abs(candidateDelta) >= Math.max(32, clip.height / 2), 'The clamped candidate must represent a meaningful new viewport, not an unchanged or near-identical scroll position.');
      assert(inside(candidate32, clip) && candidate64.top >= clip.bottom + 16, 'Before Insert, the clamped candidate must fully expose bar 32 and put bar 64 at least 16px below the score clip.');
      const beforeEntry = snapshot(fixture); const originalCount = events(fixture).length; click(fixture, '#insert-event'); const duringRendering = fixture.doc.body.dataset.renderState === 'rendering';
      assert(duringRendering, 'The late-scroll fixture must observe a genuinely pending accepted-entry render to qualify the reveal race.');
      // Synthetic wheel intent exercises the public input listener; the paired
      // real scrollTop change produces native scroll state/events. It does not
      // claim a trusted hardware wheel or replace any app timer/controller.
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true, deltaY: candidateScroll - scroller.scrollTop, view: fixture.view }));
      scroller.scrollTop = candidateScroll; const chosenScroll = scroller.scrollTop;
      fixture.actions.push({ kind: 'scroll', target: '#score-scroll', value: `synthetic wheel intent + real scrollTop ${chosenScroll} during accepted-entry render` });
      await waitFor(fixture, () => revision(fixture) === beforeEntry.revision + 1 && fixture.doc.body.dataset.renderState === 'ready' && events(fixture).length === originalCount + 1, 'Complete the one accepted entry without stealing the newer viewport'); await settle(fixture); await frames(fixture);
      assert(Math.abs(scroller.scrollTop - chosenScroll) <= 2, `A newer user scroll must cancel the pending bar-64 reveal; requested ${chosenScroll}, received ${scroller.scrollTop}.`);
      assert(overlaps(eventBox(fixture, 'journey-n32a'), clipBox(fixture)) && !overlaps(eventBox(fixture, 'journey-n64a'), clipBox(fixture)), 'The musician’s later bar-32 viewport must win while bar 64 remains the accepted entry destination.');
      const added = score(fixture).staves[0].measures[63].voices[0].events.at(-1)!; equal([pitch(added), added.duration, added.onset], ['D#6', 'quarter', { numerator: 1, denominator: 2 }], 'Cancelling a deferred reveal must not cancel or retarget the accepted musical entry');
      assert(field<HTMLButtonElement>(fixture, '#redo').disabled, 'The one real new entry must replace the old Redo branch.');
      return { detail: 'Unchanged harmony Apply-and-next uses no history and leaves no latent reveal. A later real viewport scroll, signalled through synthetic wheel routing, cancels an in-flight reveal without losing the one accepted note.', metrics: { noOpTransactions: 0, noOpNextMeasure: 'journey-m2', laterVisibleAnchor: 'journey-n48a', laterAnchor, raceViewport: [1500, 360], candidate: { scroll: candidateScroll, delta: candidateDelta, clip, current64, target32: candidate32, excluded64: candidate64 }, pendingEntryRenderObserved: duringRendering, acceptedEntryMeasure: 'journey-m64', chosenViewport: 'journey-n32a', requestedScroll: chosenScroll, actualScroll: scroller.scrollTop, acceptedEntryTransactions: 1, trustedWheelQualified: false } };
    },
  },
  {
    gate: 'UX-RECIPE-MEASURE-REST / UX-RESUME-MISSING', name: 'The next-entry recipe states meter-controlled rests and an unavailable writing location honestly',
    async run() {
      const rest = await mount('Explicit full-measure rest recipe'); const fullVoice = rest.doc.createElement('template'); fullVoice.innerHTML = leadSource(2);
      fullVoice.content.querySelector('#journey-n1a')!.setAttribute('duration', 'whole'); fullVoice.content.querySelector('#journey-n1b')!.remove();
      await applySource(rest, fullVoice.innerHTML); await primeRedo(rest, 'journey-n1a'); const before = snapshot(rest);
      await recipe(rest, { kind: 'rest', duration: 'quarter', dots: '2', position: 'replace' }); await popup(rest, '#entry-settings-trigger', '#entry-settings', true);
      await showNested(rest, '#event-beam'); choose(rest, '#event-beam', 'start'); check(rest, '#event-measure-rest', true); await frames(rest);
      for (const id of ['event-duration', 'event-dots', 'event-beam']) assert(field<HTMLSelectElement>(rest, `#${id}`).disabled, `A full-measure rest must disable ${id}: its meter-controlled rhythm cannot use dormant duration, dots, or explicit beaming.`);
      await popup(rest, '#entry-settings-trigger', '#entry-settings', false); const collapsed = field(rest, '#entry-settings-trigger');
      const recipeText = [field(rest, '#entry-settings-label').textContent, field(rest, '#entry-recipe').textContent].join(' ');
      assert(visible(rest, collapsed) && /\brest\b/i.test(recipeText) && /\bfull\s+bar\b/i.test(recipeText)
        && /full[-\s]+measure\s+rest/i.test(collapsed.getAttribute('aria-label') ?? ''), `The complete collapsed control must visibly say Rest and Full bar and name a Full-measure rest accessibly; received ${JSON.stringify(recipeText)}.`);
      assert(!/quarter|eighth|half note|whole note|\bdot/i.test(recipeText), 'A full-measure-rest summary must not present the retained ordinary duration or dots as its written rhythm.'); unchanged(rest, before, 'Configure the meter-controlled next rest');
      const beforeRest = await mutate(rest, () => click(rest, '#insert-event'), () => {
        const voice = score(rest).staves[0].measures[0].voices[0]; return voice.events.length === 1 && voice.events[0].kind === 'rest' && voice.events[0].measureRest;
      }, 'Replace the sole whole note with one meter-controlled full-measure rest');
      const writtenRest = score(rest).staves[0].measures[0].voices[0].events[0];
      equal({ kind: writtenRest.kind, duration: writtenRest.duration, dots: writtenRest.dots, beam: writtenRest.beam, stem: writtenRest.stem, onset: writtenRest.onset, time: writtenRest.time, measureRest: writtenRest.measureRest },
        { kind: 'rest', duration: 'whole', dots: 0, beam: 'none', stem: 'auto', onset: { numerator: 0, denominator: 1 }, time: { numerator: 1, denominator: 1 }, measureRest: true },
        'FULL-REST-DORMANT-DOTS/BEAM: accepted music must normalize the dormant quarter, two dots, and start-beam choices to an exact full-measure rest');
      equal(score(rest).staves[0].measures.length, 2, 'Replacing the entire one-note voice must not append another bar');
      const withoutPosition = (recipe: object): object => Object.fromEntries(Object.entries(recipe).filter(([id]) => id !== 'insert-position'));
      equal(withoutPosition(palette(rest)), withoutPosition(beforeRest.palette), 'Accepting a full-measure rest must not overwrite dormant future-entry choices');
      equal(value(rest, '#insert-position'), 'after', 'A successful Replace deliberately advances the next entry position to After');
      await undo(rest, beforeRest); equal(pitch(eventById(rest, 'journey-n1a')), 'F4', 'One Undo restores the deliberately replaced whole note');
      equal(withoutPosition(palette(rest)), withoutPosition(beforeRest.palette), 'Undoing the full-measure rest must also retain its deliberate future-entry recipe');
      equal(value(rest, '#insert-position'), 'after', 'Undo restores music while retaining the explicitly advanced future position');
      await enter(rest); click(rest, '#select-mode'); const parkedRestCursor = cursor(rest); const parkedRestRecipe = palette(rest);
      await popup(rest, '#location-trigger', '#location-panel', true);
      const beforeAddMeasure = await mutate(rest, () => click(rest, '#add-measure'), () => score(rest).staves[0].measures.length === 3, 'Add an actual aligned measure while retaining the parked full-measure-rest recipe');
      const appendedMeasure = score(rest).staves[0].measures[1]; equal(value(rest, '#measure-select'), appendedMeasure.id, 'Add measure selects the newly inserted measure after bar 1');
      assert(appendedMeasure.voices[0].events.length === 1 && appendedMeasure.voices[0].events[0].measureRest, 'The actual new bar must begin with its canonical full-measure-rest placeholder.');
      equal(palette(rest), parkedRestRecipe, 'Add measure must not silently clear the musician’s full-measure-rest preference or dormant values');
      await closeOpenPopovers(rest); assert(visible(rest, field(rest, '#toggle-entry')), 'The fixed Write notes control remains available after selecting the new bar.');
      const beforeResume = snapshot(rest); click(rest, '#toggle-entry');
      const parked = parkedRestCursor as { staff: string; measure: string; voice: string; event: string | null };
      await waitFor(rest, () => field(rest, '#toggle-entry').getAttribute('aria-pressed') === 'true' && value(rest, '#measure-select') === parked.measure, 'Resume the original full-rest writing location directly'); await settle(rest);
      equal([value(rest, '#staff-select'), value(rest, '#measure-select'), value(rest, '#event-voice')], [parked.staff, parked.measure, parked.voice], 'Fixed Write returns to the exact parked staff, bar and voice without replacing musical selection');
      assert(parked.event, 'The source fixture must have an exact parked note before resuming the rest recipe.');
      const parkedGeometry = geometry(rest, parked.event); const parkedAnchor = parkedGeometry.system.anchors.find(anchor => anchor.measureId === parked.measure && anchor.afterId === parked.event);
      const caret = field(rest, '#score-host').shadowRoot?.querySelector<HTMLElement>('.author-caret');
      assert(parkedAnchor && caret && caret.dataset.sourceId === parkedAnchor.sourceId
        && inside(screenBox(parkedGeometry.svg, { x: parkedAnchor.x, y: parkedAnchor.y, width: 0, height: parkedAnchor.height }), box(caret)), 'The resumed caret must identify the exact parked source-event boundary.');
      equal(palette(rest), parkedRestRecipe, 'Resume preserves the full-measure-rest recipe rather than converting it to an ordinary quarter rest');
      unchanged(rest, beforeResume, 'Resume the parked rest recipe', false);
      await undo(rest, beforeAddMeasure); equal(palette(rest), parkedRestRecipe, 'Undoing the added bar retains the same full-rest recipe');
      await enter(rest); const afterRestUndo = snapshot(rest);
      await popup(rest, '#entry-settings-trigger', '#entry-settings', true); check(rest, '#event-measure-rest', false); await frames(rest);
      for (const id of ['event-duration', 'event-dots', 'event-beam']) assert(!field<HTMLSelectElement>(rest, `#${id}`).disabled, `Returning to an ordinary rest must restore the native ${id} choice.`);
      equal([value(rest, '#event-duration'), value(rest, '#event-dots'), value(rest, '#event-beam')], ['quarter', '2', 'start'], 'Meter-controlled mode must retain the previously chosen ordinary rhythm and beaming for a deliberate return');
      await popup(rest, '#entry-settings-trigger', '#entry-settings', false); unchanged(rest, afterRestUndo, 'Return to the ordinary next-rest recipe'); assert(!field<HTMLButtonElement>(rest, '#redo').disabled, 'Future rest preferences must not erase the latest actual Add-measure Redo.');

      const fixture = await mount('Unavailable parked writing point on short phone', 390, 360); await applySource(fixture, leadSource(8)); await selectEvent(fixture, 'journey-n8b');
      await startHere(fixture); await recipe(fixture, { kind: 'note', pitch: 'D#6', duration: 'eighth', dots: '1', position: 'after' }); await enter(fixture); click(fixture, '#select-mode'); await selectEvent(fixture, 'journey-n2a');
      const parkedRecipe = palette(fixture); assert(visible(fixture, field(fixture, '#toggle-entry')), 'The valid bar-8 bookmark must remain resumable through the fixed Write notes control.');
      const removed = fixture.doc.createElement('template'); removed.innerHTML = source(fixture); removed.content.querySelector('#journey-m8')!.remove(); await applySource(fixture, removed.innerHTML);
      equal(palette(fixture), parkedRecipe, 'Removing the parked source location must not erase or replace its insertion recipe'); equal(value(fixture, '#measure-select'), 'journey-m2', 'The surviving selected location stays independent of the removed bookmark');
      const entryAction = field(fixture, '#toggle-entry'); const reason = field(fixture, '#entry-mode-reason'); const label = field(fixture, '#entry-mode-label');
      const missing = snapshot(fixture); click(fixture, '#toggle-entry'); await frames(fixture); await settle(fixture);
      unchanged(fixture, missing, 'Fixed Write refuses a missing writing location'); equal(entryAction.getAttribute('aria-pressed'), 'false', 'A missing bookmark must not silently start writing at the selection');
      equal(palette(fixture), parkedRecipe, 'The rejected Write request must preserve the uncommitted recipe');
      const feedback = field(fixture, '#workspace-feedback-label'); const status = feedback.getAttribute('aria-label') ?? feedback.textContent?.trim() ?? ''; const startLabel = label.textContent?.trim() ?? '';
      assert(visible(fixture, feedback) && /unavailable|changed|missing/i.test(status) && /location|start writing here/i.test(status), 'The persistent header must explain the unavailable writing point and its deliberate local recovery.');
      assert(visible(fixture, label) && /^write notes$/i.test(startLabel), 'Missing bookmarks must not replace the fixed Write notes mode label.');
      assert(/unavailable/i.test(entryAction.getAttribute('aria-label') ?? ''), 'The fixed Write control must also explain its unavailable saved location accessibly.');
      const expectedPalette = expectedPaletteLayout(fixture);
      const actionBounds = box(entryAction); assert(Math.abs(actionBounds.height - expectedPalette.controlSize) <= 0.25, `The fixed Write control must retain its shared ${expectedPalette.controlSize}px target; received ${actionBounds.height}px.`);
      assert(inside(box(label), actionBounds), 'The fixed mode label must fit without clipping.');
      assert(field(fixture, '#entry-destination').hidden, 'Select mode must not add a second destination/status row for the unavailable bookmark.');
      await reveal(fixture, 'journey-n2a'); const missingLayout = layoutMetrics(fixture);
      assert(Number(missingLayout.usableHeight) >= limits.shortScore, `The clean missing-bookmark state must retain the ${limits.shortScore}px short-screen score budget; received ${missingLayout.usableHeight}.`);
      assert(Math.abs((missingLayout.strip as Box).height - expectedPalette.height) <= 1, 'A missing bookmark must not change the palette height or shared header spacing.');
      for (const selector of ['#select-mode', '#toggle-entry', '#location-trigger', '#edit-selected-event']) {
        const control = field(fixture, selector); const bounds = box(control);
        assert(visible(fixture, control) && bounds.width >= limits.target && bounds.height >= limits.target
          && inside(bounds, { left: 0, top: 0, right: 390, bottom: 360, width: 390, height: 360 }), `${selector} must remain a usable visible action in the short-screen missing-bookmark state.`);
      }
      const resume = field<HTMLButtonElement>(fixture, '#resume-entry'); assert(!visible(fixture, resume) || resume.disabled, 'An unavailable bookmark must not remain an enabled advertised Resume action.');
      await staleActivation(fixture, '#resume-entry'); unchanged(fixture, missing, 'Stale quiet Resume for a removed writing point'); equal(palette(fixture), parkedRecipe, 'Rejected stale Resume must retain the recipe');
      await popup(fixture, '#location-trigger', '#location-panel', true); const start = field<HTMLButtonElement>(fixture, '#start-entry-here'); const namedLocation = `${start.textContent} ${field(fixture, '#location-context').textContent}`;
      assert(visible(fixture, reason) && /can['’]t resume/i.test(reason.textContent ?? ''), 'Location must retain the complete missing-bookmark explanation beside recovery.');
      assert(visible(fixture, start) && !start.disabled && /(?:bar|measure)\s*2(?:\D|$)/i.test(namedLocation) && namedLocation.includes('Journey lead'), `The explicit Start action must name the surviving staff and bar 2 in its visible local context; received ${JSON.stringify(namedLocation)}.`);
      click(fixture, '#start-entry-here'); await frames(fixture); await settle(fixture); equal(value(fixture, '#measure-select'), 'journey-m2', 'The explicit local Start action chooses the named surviving location'); equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Explicit Start activates entry at the chosen surviving point');
      equal(palette(fixture), parkedRecipe, 'Starting at a new named location reuses the preserved recipe'); unchanged(fixture, missing, 'Choose a replacement writing point');
      return { detail: 'The full-rest replacement normalizes dormant rhythm and undoes once; its recipe survives actual Add measure and fixed Write resumption. A lost bar-8 bookmark is explained in the header and refuses implicit resumption; local Start writing here deliberately selects bar 2 within the unchanged compact palette.', metrics: { restGate: 'FULL-REST-DORMANT-DOTS/BEAM', restRecipe: recipeText, ordinaryValuesRetained: ['quarter', '2 dots', 'start beam'], acceptedRest: { duration: writtenRest.duration, dots: writtenRest.dots, beam: writtenRest.beam, measureRest: writtenRest.measureRest }, replacementAdvancesPosition: 'after', restReplacementTransactions: 1, restUndoTransactions: 1, addMeasureTransactions: 1, addMeasureUndoTransactions: 1, fullRestResumeTransactions: 0, recipePreferenceTransactions: 0, redoRetainedThroughPreferences: true, removedBookmark: 'journey-m8', missingExplanation: status, fixedWriteLabel: startLabel, missingActionBounds: actionBounds, missingScoreHeight: missingLayout.usableHeight, replacementLocation: namedLocation, replacementLocationTransactions: 0 } };
    },
  },
);

tests.push({
  gate: 'UX-NATIVE-CONFIRMATION', name: 'In-app confirmation cancels cleanly and rejects an action after accepted Source changes',
  async run() {
    const fixture = await mount('Native confirmation and stale source guard'); await applySource(fixture, leadSource(3)); await primeRedo(fixture, 'journey-n1a');
    fixture.confirmReply = null; await selectEvent(fixture, 'journey-n2a'); await tab(fixture, 'measure');
    const viewports: number[][] = [];
    for (const [width, height] of [[1180, 660], [390, 360]]) {
      await resize(fixture, width, height); const before = snapshot(fixture); click(fixture, '#remove-measure');
      const dialog = field<HTMLDialogElement>(fixture, '#author-confirmation'); await waitFor(fixture, () => dialog.open, 'Open the in-app destructive-action confirmation');
      equal(dialog.localName, 'dialog', 'The confirmation must be an application-owned native dialog'); assert(dialog.matches(':modal'), 'The supported browser must use the dialog top layer and native modal semantics.');
      assert(inside(box(dialog), { left: 0, top: 0, right: width, bottom: height, width, height }), 'The complete confirmation must fit the actual desktop or short-phone viewport.');
      assert(visible(fixture, field(fixture, '#author-confirmation-message')) && /measure|bar/i.test(field(fixture, '#author-confirmation-message').textContent ?? ''), 'The dialog must state the musical operation before either choice.');
      assert(dialog.contains(authorActiveElement(fixture.doc)), 'Opening confirmation must put focus inside the native dialog.'); unchanged(fixture, before, 'Open a destructive-action confirmation');
      click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open, 'Cancel the native confirmation through its visible button'); await frames(fixture); await settle(fixture);
      unchanged(fixture, before, 'Cancel a destructive-action confirmation'); equal(authorActiveElement(fixture.doc)?.id, 'remove-measure', 'Cancel must restore focus to the available originating action'); viewports.push([width, height]);
    }
    await resize(fixture, 1180, 660); const beforeSource = snapshot(fixture); click(fixture, '#remove-measure');
    const dialog = field<HTMLDialogElement>(fixture, '#author-confirmation'); await waitFor(fixture, () => dialog.open, 'Hold the original removal decision');
    const nextSource = changeSourceAttribute(fixture, 'journey-n1a', 'pitch', 'G4');
    // Deliberately deliver a delayed public Source event while a native modal
    // makes ordinary background input inert. This is a stale-event safety test,
    // not a claim that a user can click through the native dialog. No controller
    // methods, accepted model objects, timers, or storage records are replaced.
    const input = field<HTMLTextAreaElement>(fixture, '#source-input'); input.value = nextSource;
    changeEvent(fixture, input, 'input'); changeEvent(fixture, input, 'change');
    fixture.actions.push({ kind: 'text', target: '#source-input', value: '(deliberately delayed Source event while modal)' });
    const stagedRevision = revision(fixture); assert(stagedRevision > beforeSource.revision, 'Staging Source records its separate draft revision before the accepted Apply transaction.');
    field(fixture, '#source-apply').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1, view: fixture.view }));
    await waitFor(fixture, () => revision(fixture) === stagedRevision + 1 && fixture.doc.body.dataset.renderState === 'ready' && pitch(eventById(fixture, 'journey-n1a')) === 'G4', 'Accept the separately delivered Source change as one transaction after staging, before the old confirmation'); await settle(fixture);
    const afterSource = snapshot(fixture); await staleActivation(fixture, '#author-confirmation-confirm'); unchanged(fixture, afterSource, 'Old confirmation after accepted Source changes');
    equal(score(fixture).staves[0].measures.length, 3, 'An outdated removal confirmation must not remove a bar from the newer accepted Source');
    if (dialog.open) {
      assert(/changed|stale|expired|no longer|review|cancel/i.test(field(fixture, '#author-confirmation-status').textContent ?? ''), 'A retained stale dialog must explain that the original action is no longer current.');
      click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open, 'Close the outdated native decision');
    }
    await selectEvent(fixture, 'journey-n2a'); await tab(fixture, 'measure'); const fresh = snapshot(fixture); click(fixture, '#remove-measure'); await waitFor(fixture, () => dialog.open, 'Request a fresh decision for the current Source');
    await mutate(fixture, () => click(fixture, '#author-confirmation-confirm'), () => score(fixture).staves[0].measures.length === 2, 'Confirm the fresh named removal exactly once');
    await undo(fixture, fresh); equal(pitch(eventById(fixture, 'journey-n1a')), 'G4', 'Undoing the fresh removal retains the independently accepted Source correction');
    const saved = await recoverableProject(fixture); const part = saved.parts.find(part => part.staffIds.includes('blank-staff')); assert(part, 'The focus-return fixture must retain a real part definition.');
    await popup(fixture, '#location-trigger', '#location-panel', true); choose(fixture, '#part-select', part.id); await closeOpenPopovers(fixture); await settle(fixture);
    await popup(fixture, '#document-menu-trigger', '#document-menu', true); await popup(fixture, '#score-setup-trigger', '#score-setup', true);
    const beforePartRemoval = snapshot(fixture); const savedBeforePartRemoval = JSON.stringify(await recoverableProject(fixture)); click(fixture, '#remove-part');
    await waitFor(fixture, () => dialog.open, 'Confirm removal requested from the transient Score setup surface');
    assert(!field(fixture, '#score-setup').matches(':popover-open'), 'The part-removal fixture must close the originating setup popover before its modal decision.');
    assert((field(fixture, '#author-confirmation-message').textContent ?? '').includes(part.label), 'The removal decision must identify the selected part before cancellation.');
    click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open, 'Cancel removal of the named part'); await frames(fixture); await settle(fixture);
    const returnTarget = field(fixture, '#document-menu-trigger'); assert(authorActiveElement(fixture.doc) === returnTarget, 'CONFIRM-RETURN-VISIBLE: Cancel must return focus to the visible Document invoker, not a control inside the closed setup popover.');
    assert(visible(fixture, returnTarget) && inside(box(returnTarget), { left: 0, top: 0, right: fixture.view.innerWidth, bottom: fixture.view.innerHeight, width: fixture.view.innerWidth, height: fixture.view.innerHeight }), 'The fallback focus destination must be exposed inside the actual viewport.');
    unchanged(fixture, beforePartRemoval, 'Cancel a part removal whose original invoker is hidden');
    equal(JSON.stringify(await recoverableProject(fixture)), savedBeforePartRemoval, 'Cancelling a part removal must preserve its definition, layout, and all recovery data');

    // An in-memory FileList swap deliberately stresses the same guard used by
    // fallback confirmations. It does not invoke a native picker, dispatch a
    // file-input change, read a disk file, import a project, or qualify fallback UI.
    assert(typeof DataTransfer === 'function', 'The synthetic file-identity case requires the browser’s real DataTransfer/FileList implementation.');
    const fileInput = field<HTMLInputElement>(fixture, '#project-file'); const metadata = (file: File) => ({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified });
    const firstFiles = new DataTransfer(); firstFiles.items.add(new File(['{"fixture":"A"}'], 'same-project.json', { type: 'application/json', lastModified: 1_700_000_000_000 })); fileInput.files = firstFiles.files;
    const fileA = fileInput.files?.[0]; assert(fileA && await fileA.text() === '{"fixture":"A"}', 'The fixture must stage its actual first in-memory File before opening the decision.'); const originalFileValue = fileInput.value;
    fixture.actions.push({ kind: 'text', target: '#project-file', value: 'synthetic FileList A; no input/change event or import' });
    await selectEvent(fixture, 'journey-n2a'); await tab(fixture, 'measure'); const beforeFileSwap = snapshot(fixture); const savedBeforeFileSwap = JSON.stringify(await recoverableProject(fixture));
    click(fixture, '#remove-measure'); await waitFor(fixture, () => dialog.open, 'Capture a decision while the first File identity is selected');
    const secondFiles = new DataTransfer(); secondFiles.items.add(new File(['{"fixture":"B"}'], 'same-project.json', { type: 'application/json', lastModified: 1_700_000_000_000 })); fileInput.files = secondFiles.files;
    const fileB = fileInput.files?.[0]; assert(fileB && fileB !== fileA && await fileB.text() === '{"fixture":"B"}', 'The actual selected File must change identity and content, not merely be another reference to A.');
    equal(metadata(fileB), metadata(fileA), 'The identity stress must keep filename, MIME type, byte size, and last-modified metadata identical'); equal(fileInput.value, originalFileValue, 'A filename-only fingerprint must not distinguish this FileList change');
    fixture.actions.push({ kind: 'text', target: '#project-file', value: 'synthetic distinct FileList B with identical metadata; no input/change or import' });
    await staleActivation(fixture, '#author-confirmation-confirm'); unchanged(fixture, beforeFileSwap, 'Reject the old decision after a same-metadata File identity change');
    equal(JSON.stringify(await recoverableProject(fixture)), savedBeforeFileSwap, 'A stale File-dependent decision must leave all accepted recovery data unchanged');
    if (dialog.open) { assert(/changed|stale|expired|no longer|review|cancel/i.test(field(fixture, '#author-confirmation-status').textContent ?? ''), 'The retained File-stale decision must explain why it cannot proceed.'); click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open, 'Close the File-stale decision'); }
    const freshFileDecision = snapshot(fixture); assert(fileInput.files?.[0] === fileB, 'The positive control must still use the same B object.'); click(fixture, '#remove-measure'); await waitFor(fixture, () => dialog.open, 'Capture a fresh decision with unchanged File B');
    await mutate(fixture, () => click(fixture, '#author-confirmation-confirm'), () => score(fixture).staves[0].measures.length === 2, 'Allow the fresh decision with a stable selected File identity'); await undo(fixture, freshFileDecision);
    assert(fileInput.files?.[0] === fileB, 'The successful positive control must not silently clear or replace the selected File to evade its guard.'); fileInput.files = new DataTransfer().files;

    await applySource(fixture, leadSource(3, '', [2])); await selectEvent(fixture, 'journey-n2a'); await tab(fixture, 'measure');
    const fullDraft = snapshot(fixture); const fullDraftEvents = JSON.stringify(events(fixture)); assert(score(fixture).staves[0].measures[1].incomplete, 'The completion fixture must explicitly flag a rhythmically full bar as an incomplete draft.');
    click(fixture, '#fill-rests'); await waitFor(fixture, () => dialog.open, 'Review completion of the already-full draft bar');
    equal(field(fixture, '#author-confirmation-title').textContent?.trim(), 'Mark this full bar complete', 'The no-new-rests operation must explain the incomplete-flag change in its title');
    equal(field(fixture, '#author-confirmation-confirm').textContent?.trim(), 'Mark this full bar complete', 'The affirmative action must name the flag-only operation');
    const completionMessage = field(fixture, '#author-confirmation-message').textContent ?? '';
    assert(/bar\s*2/i.test(completionMessage) && /incomplete|draft/i.test(completionMessage) && /without adding or changing notes or rests/i.test(completionMessage) && /one\s+undo/i.test(completionMessage), 'The completion decision must identify bar 2, state that no music is added or changed, and disclose one Undo.');
    unchanged(fixture, fullDraft, 'Review completion before accepting'); click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open, 'Cancel the full-bar completion'); await frames(fixture); unchanged(fixture, fullDraft, 'Cancel completion of a full draft bar');
    click(fixture, '#fill-rests'); await waitFor(fixture, () => dialog.open, 'Request the full-bar completion again');
    await mutate(fixture, () => click(fixture, '#author-confirmation-confirm'), () => !score(fixture).staves[0].measures[1].incomplete, 'Mark the full bar complete in exactly one accepted transaction');
    const completedSource = fixture.doc.createElement('template'); completedSource.innerHTML = fullDraft.source; completedSource.content.querySelector('#journey-m2')!.removeAttribute('incomplete');
    equal(canonicalSource(fixture, source(fixture)), canonicalSource(fixture, completedSource.innerHTML), 'Completing a full bar must change only its incomplete attribute'); equal(JSON.stringify(events(fixture)), fullDraftEvents, 'Completing the full bar must not add rests, rewrite pitches, or change event identity, order, or time');
    const complete = snapshot(fixture); click(fixture, '#fill-rests'); await frames(fixture); await settle(fixture);
    assert(!dialog.open, 'An already-full, already-complete bar must not request a spurious completion decision.'); unchanged(fixture, complete, 'Fill rests on an already-complete full bar');
    await undo(fixture, fullDraft); assert(score(fixture).staves[0].measures[1].incomplete, 'One Undo must restore the original incomplete-draft flag');

    // Only this disposable, in-memory File instance has a deferred text()
    // method. Native FileList assignment and the public change event drive the
    // actual import route; no application reader, global prototype, or state is
    // replaced. Neither prospective project is accepted.
    const currentProject = await recoverableProject(fixture); const beforeReads = snapshot(fixture); const savedBeforeReads = JSON.stringify(currentProject);
    const titleA = 'Deferred fixture A — superseded'; const titleB = 'Current fixture B — cancel only';
    const projectText = (title: string) => JSON.stringify({ ...currentProject, metadata: { ...currentProject.metadata, title } });
    let releaseA!: (text: string) => void; let readAStarted = false; const pendingA = new Promise<string>(resolve => { releaseA = resolve; });
    const readFilesA = new DataTransfer(); readFilesA.items.add(new File([projectText(titleA)], 'fixture-read-a.json', { type: 'application/json' })); fileInput.files = readFilesA.files;
    const selectedReadA = fileInput.files?.[0]; assert(selectedReadA, 'The deferred-read fixture must select its actual File A.');
    Object.defineProperty(selectedReadA, 'text', { configurable: true, value: () => { readAStarted = true; return pendingA; } });
    fixture.actions.push({ kind: 'text', target: '#project-file', value: 'synthetic change event for in-memory File A with deferred instance text()' }); changeEvent(fixture, fileInput, 'change');
    await waitFor(fixture, () => readAStarted, 'Begin the actual file-input read of A before selecting another file');
    assert(!dialog.open, 'A’s unresolved file text must not yet open an import decision.'); const priorDecisions = fixture.confirmations.length;
    const readFilesB = new DataTransfer(); readFilesB.items.add(new File([projectText(titleB)], 'fixture-read-b.json', { type: 'application/json' })); fileInput.files = readFilesB.files;
    const selectedReadB = fileInput.files?.[0]; assert(selectedReadB && selectedReadB !== selectedReadA, 'The later native FileList must contain distinct File B.');
    fixture.actions.push({ kind: 'text', target: '#project-file', value: 'synthetic change event for valid in-memory File B while A is reading' }); changeEvent(fixture, fileInput, 'change');
    await waitFor(fixture, () => dialog.open && (field(fixture, '#author-confirmation-message').textContent ?? '').includes(titleB), 'Show only the newer file B’s import decision'); await frames(fixture);
    const messageB = field(fixture, '#author-confirmation-message').textContent; unchanged(fixture, beforeReads, 'Hold B’s import decision before accepting any project');
    releaseA(projectText(titleA)); await frames(fixture); await settle(fixture);
    assert(dialog.open && field(fixture, '#author-confirmation-message').textContent === messageB, 'UX-FILE-READ-SUPERSESSION: resolving old A must not replace or dismiss B’s held decision.');
    assert(fileInput.files?.[0] === selectedReadB, 'The superseded read’s cleanup must not clear the newer File B selection.');
    const importDecisions = fixture.confirmations.slice(priorDecisions); assert(!importDecisions.some(message => message.includes(titleA)), 'A superseded file read must never open its own stale import decision.');
    equal(importDecisions.filter(message => message.includes(titleB)).length, 1, 'The newer file must open exactly one held import decision'); unchanged(fixture, beforeReads, 'Resolve a superseded file while the newer decision remains pending');
    click(fixture, '#author-confirmation-cancel'); await waitFor(fixture, () => !dialog.open && !fileInput.files?.length, 'Cancel B and release only its owned file selection'); await frames(fixture); await settle(fixture);
    unchanged(fixture, beforeReads, 'Cancel B after the older read settles'); equal(JSON.stringify(await recoverableProject(fixture)), savedBeforeReads, 'Cancelling the only current import decision must leave the entire accepted project and recovery unchanged');
    Reflect.deleteProperty(selectedReadA, 'text');
    return { detail: 'Native decisions preserve music on Cancel and reject stale Source/File intent. A superseded file read cannot replace B’s decision or clear its input. Full-bar completion changes only the draft flag, undoes once, and is a no-op when already complete.', metrics: { nativeModalViewports: viewports, cancelledTransactions: 0, staleConfirmationTransactions: 0, separatelyAcceptedSourceTransactions: 1, freshConfirmedTransactions: 1, undoTransactions: 1, returnFocusGate: 'CONFIRM-RETURN-VISIBLE', cancelledPartTarget: part.id, returnedFocus: returnTarget.id, cancelledPartTransactions: 0, fileIdentityMetadata: metadata(fileB), staleFileTransactions: 0, stableFilePositiveTransactions: 1, stableFileUndoTransactions: 1, fileReadGate: 'UX-FILE-READ-SUPERSESSION', deferredFileSequence: 'A starts → B opens decision → A settles → Cancel B', supersededFileDecisions: 0, currentFileDecisions: 1, acceptedFileImports: 0, fullBarCompletionMessage: completionMessage, cancelledFullBarTransactions: 0, fullBarCompletionTransactions: 1, fullBarUndoTransactions: 1, alreadyCompleteTransactions: 0, staleEventStressIsSynthetic: true, deferredFileReadIsSynthetic: true, trustedModalKeyboardQualified: false, trustedFilePickerQualified: false, fallbackConfirmationQualified: false } };
  },
});

function diagnostic(fixture: Fixture): string {
  try { return JSON.stringify({ workspace: fixture.workspace, viewport: { width: fixture.view.innerWidth, height: fixture.view.innerHeight }, state: { ...fixture.doc.body.dataset },
    authored: revision(fixture), cursor: cursor(fixture), palette: palette(fixture), active: authorActiveElement(fixture.doc)?.id,
    scoreViewport: box(field(fixture, '#score-scroll')), scoreScroll: { top: field(fixture, '#score-scroll').scrollTop, left: field(fixture, '#score-scroll').scrollLeft },
    status: field(fixture, '#author-status').textContent, error: field(fixture, '#author-errors').textContent, recovery: field(fixture, '#save-status').textContent,
    drafts: Object.fromEntries(['measure', 'annotation'].map(form => [form, { target: draftTarget(fixture, form as 'measure' | 'annotation'), status: draftStatus(fixture, form as 'measure' | 'annotation') }])),
    recentActions: fixture.actions.slice(-14), confirmations: fixture.confirmations, geometry: surface(fixture).getLayoutGeometry()?.systems.map(system => ({ index: system.index, start: system.start, end: system.end, width: system.width, height: system.height })),
  }, null, 2); } catch (error) { return `Diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`; }
}
async function visualFixture(kind: 'desktop' | 'phone' | 'short' | 'piano'): Promise<void> {
  if (busy) return; setBusy(true); visualFixtures.replaceChildren(); visualStatus.dataset.state = 'running'; visualStatus.textContent = 'Preparing a live musical workspace for inspection…';
  try {
    const width = kind === 'phone' || kind === 'short' ? 390 : 1180; const height = kind === 'short' ? 360 : 660;
    const fixture = await mount(`${kind}: actual musical workspace`, width, height, visualFixtures); await template(fixture, kind === 'piano' ? 'piano' : 'lead');
    if (kind === 'piano') { await selectEvent(fixture, 'piano-upper-m3-n3'); await tab(fixture, 'rhythm'); }
    else if (kind === 'phone') {
      await location(fixture, 'lead-m5'); await addChord(fixture); write(fixture, '#annotation-text', 'Bbmaj13(#11)');
    } else if (kind === 'short') {
      await selectEvent(fixture, 'lead-m12-n1'); await tools(fixture, false); await reveal(fixture, 'lead-m12-n1', 0.12);
    } else {
      await tools(fixture, false); field(fixture, '#score-scroll').scrollTop = 0; await frames(fixture);
    }
    fixture.frame.closest('article')!.scrollIntoView({ block: 'start', behavior: 'instant' }); await frames(fixture); await settle(fixture);
    const metrics = layoutMetrics(fixture); const state = { state: 'ready', scenario: 'actual-workspace-with-synthetic-setup', kind, viewport: [width, height], workspace: fixture.workspace, view: fixture.doc.body.dataset.view,
      tools: fixture.doc.body.dataset.toolsOpen, activeTask: field(fixture, '#workspace-tools').dataset.activeTool, cursor: cursor(fixture), palette: palette(fixture), metrics,
      limitations: ['setup uses synthetic clicks and form events', 'no trusted input or software keyboard qualification', 'phone harmony remains an intentional unsaved inspector draft'] };
    visualStatus.dataset.state = 'ready'; visualStatus.textContent = `Ready — ${kind} live workspace. ${kind === 'phone' ? 'The new harmony is an intentional inspector draft; nothing overwrites the existing chord.' : 'Only the isolated fixture’s own composition is used.'}\n${JSON.stringify(state, null, 2)}`;
    let output = document.querySelector<HTMLScriptElement>('#workspace-visual-results'); if (!output) { output = document.createElement('script'); output.id = 'workspace-visual-results'; output.type = 'application/json'; document.body.append(output); } output.textContent = JSON.stringify(state);
  } catch (error) {
    visualStatus.dataset.state = 'failed'; visualStatus.textContent = `Visual fixture failed: ${error instanceof Error ? error.message : String(error)}${latestFixture ? `\n${diagnostic(latestFixture)}` : ''}`;
  } finally { setBusy(false); }
}
async function run(): Promise<void> {
  if (busy) return; setBusy(true); fixtures.replaceChildren(); visualFixtures.replaceChildren();
  for (const key of ownedKeys) localStorage.removeItem(key); ownedKeys.clear(); results.replaceChildren(); token = crypto.randomUUID(); sequence = 0; latestFixture = undefined;
  summary.dataset.state = 'running'; environment.textContent = `${navigator.userAgent}; public actual Author fixtures. Layout limits locked before implementation measurements: ${JSON.stringify(limits)}.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    summary.textContent = `Running ${index + 1}/${tests.length}: ${test.gate} — ${test.name}`;
    const item = document.createElement('li'); item.dataset.state = 'running'; const title = document.createElement('strong'); title.textContent = `Running: ${test.gate} — ${test.name}`; item.append(title); results.append(item);
    try {
      const outcome = await test.run(); item.dataset.state = 'passed'; title.textContent = `PASS — ${test.gate}: ${test.name}`;
      const text = document.createElement('div'); text.textContent = outcome.detail; item.append(text);
      if (outcome.metrics) { const metrics = document.createElement('pre'); metrics.className = 'metrics'; metrics.textContent = JSON.stringify(outcome.metrics, null, 2); item.append(metrics); }
      report.push({ gate: test.gate, name: test.name, passed: true, ...outcome });
    } catch (error) {
      const detail = `${error instanceof Error ? error.message : String(error)}${latestFixture ? `\nActual fixture diagnostics:\n${diagnostic(latestFixture)}` : ''}`;
      item.dataset.state = 'failed'; title.textContent = `FAIL — ${test.gate}: ${test.name}`; const text = document.createElement('pre'); text.textContent = detail; item.append(text); report.push({ gate: test.gate, name: test.name, passed: false, detail });
    }
  }
  const passed = report.filter(result => result.passed).length; const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed'; summary.textContent = `${passed}/${tests.length} scripted workspace journeys passed${failed ? `; ${failed} failed` : ''}. Trusted input, software keyboard, a human long-session walkthrough, and PDF/print qualification are separate.`;
  let output = document.querySelector<HTMLScriptElement>('#workspace-browser-results'); if (!output) { output = document.createElement('script'); output.id = 'workspace-browser-results'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, limits, results: report,
    notQualified: ['trusted native keyboard/pickers', 'touch/pen capture', 'software keyboard', 'twenty-minute human walkthrough', 'saved PDF and physical printing'] }, null, 2);
  setBusy(false);
}
environment.textContent = 'Routes were statically migrated to the current writing surface; this version has not been run in a browser. Native layout, input and PDF qualification remain pending.';
runButton.addEventListener('click', () => { void run(); });
for (const kind of ['desktop', 'phone', 'short', 'piano'] as const) document.querySelector<HTMLButtonElement>(`#show-${kind}`)!.addEventListener('click', () => { void visualFixture(kind); });
