import type { MusicSurface } from '../src/components/index.js';
import { parsePitch, pitchDescription, pitchText } from '../src/model/index.js';
import type { EventGeometry, InsertionAnchor, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import type { Clef, MusicEvent, Score } from '../src/model/types.js';
import { authorActiveElement, authorControlParent, queryAuthorControl } from './author-fixture.js';

interface Fixture {
  frame: HTMLIFrameElement; doc: Document; view: Window; workspace: string; syntheticCapture: boolean;
  confirmationDecision: 'confirm' | 'cancel'; confirmations: { message: string; decision: 'confirm' | 'cancel' }[];
  stopConfirmations?: () => void;
}
interface MountOptions { width?: number; height?: number; container?: HTMLElement }
interface Point { x: number; y: number }
interface Target { element: Element; point: Point }
interface Gesture {
  fixture: Fixture; target: Target; pointerId: number; pointerType: 'mouse' | 'touch';
  source: string; revision: number; music: string;
}
interface Result { name: string; passed: boolean; detail: string }
interface Test { name: string; run: () => Promise<string> }
interface GeometryContext { system: SystemGeometry; measure: MeasureGeometry; svg: SVGSVGElement }
interface PointerStep { type: string; pointerId: number; pointerType: string; buttons: number; point: Point; target: string }

const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const visualButtons = [...document.querySelectorAll<HTMLButtonElement>('#show-desktop-preview, #show-phone-preview')];
const visualFixtures = document.querySelector<HTMLElement>('#visual-fixtures')!;
const visualStatus = document.querySelector<HTMLElement>('#visual-preview-status')!;
const ownedKeys = new Set<string>();
const pointerTraces = new WeakMap<Fixture, { start?: PointerStep; latest: PointerStep }>();
let sequence = 0;
let pointerSequence = 100;
let token = '';
let previewCount = 0;
let committedGestures = 0;
let busy = false;
let visualHover: { fixture: Fixture; target: Target; pointerId: number } | undefined;

function setBusy(value: boolean): void {
  busy = value; button.disabled = value;
  for (const control of visualButtons) control.disabled = value;
}
function clearVisual(): void {
  if (visualHover?.fixture.frame.isConnected) {
    pointer(visualHover.fixture, field(visualHover.fixture, '#score-host'), 'pointerleave', visualHover.target.point, visualHover.pointerId, 'mouse', true, 0);
  }
  visualHover = undefined; visualFixtures.replaceChildren();
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}
function describeTarget(target: Element | Document | Window | null | undefined): string {
  if (!target) return 'none';
  if (!('tagName' in target)) return 'nodeName' in target ? target.nodeName : 'window';
  const element = target as Element;
  return `${element.localName}${element.id ? `#${element.id}` : ''}${element.getAttribute('class') ? `.${element.getAttribute('class')!.trim().replace(/\s+/g, '.')}` : ''}${element.getAttribute('data-source-id') ? `[data-source-id="${element.getAttribute('data-source-id')}"]` : ''}`;
}
function boundsOf(element: Element | null | undefined): object | null {
  if (!element) return null;
  const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect();
  return { x, y, width, height, top, right, bottom, left };
}
function diagnostic(fixture: Fixture): string {
  try {
    const host = queryAuthorControl<HTMLElement>(fixture.doc, '#score-host');
    const root = host?.shadowRoot?.querySelector<MusicSurface>('music-system, music-staff');
    const layout = root?.getLayoutGeometry();
    const trace = pointerTraces.get(fixture);
    const point = trace?.latest.point;
    const svgNodes = [...(root?.shadowRoot?.querySelectorAll<SVGSVGElement>(`.${layout?.projection ?? 'screen'} .system-row svg`) ?? [])];
    return JSON.stringify({
      workspace: fixture.workspace, url: fixture.frame.src, syntheticCapture: fixture.syntheticCapture,
      viewport: { width: fixture.view.innerWidth, height: fixture.view.innerHeight, scrollX: fixture.view.scrollX, scrollY: fixture.view.scrollY },
      state: { mode: fixture.doc.body.dataset.view, render: fixture.doc.body.dataset.renderState, revision: fixture.doc.body.dataset.authorRevision,
        gesture: fixture.doc.body.dataset.pointerGesture ?? null, entry: queryAuthorControl(fixture.doc, '#toggle-entry')?.getAttribute('aria-pressed'),
        voice: queryAuthorControl<HTMLSelectElement>(fixture.doc, '#event-voice')?.value, position: queryAuthorControl<HTMLSelectElement>(fixture.doc, '#insert-position')?.value },
      pointerStatus: queryAuthorControl(fixture.doc, '#pointer-status')?.textContent,
      headerFeedback: queryAuthorControl(fixture.doc, '#workspace-feedback-label')?.textContent,
      selection: { location: queryAuthorControl(fixture.doc, '#selection-context')?.textContent,
        event: queryAuthorControl(fixture.doc, '#edit-selected-event')?.textContent,
        eventIds: queryAuthorControl<HTMLElement>(fixture.doc, '#selection-controls')?.dataset.eventIds,
        navigator: [...queryAuthorControl(fixture.doc, '#event-navigator')?.shadowRoot?.querySelectorAll<HTMLElement>('[data-source-id][aria-pressed="true"]') ?? []].map(element => element.dataset.sourceId),
        outlines: [...host?.shadowRoot?.querySelectorAll<HTMLElement>('.author-selection[data-source-id]') ?? []].map(element => element.dataset.sourceId) },
      feedback: { header: queryAuthorControl(fixture.doc, '#workspace-feedback-label')?.textContent,
        accessibleHeader: queryAuthorControl(fixture.doc, '#workspace-feedback-label')?.getAttribute('aria-label'),
        kind: queryAuthorControl<HTMLElement>(fixture.doc, '#workspace-feedback-label')?.dataset.feedbackKind,
        headerBounds: boundsOf(queryAuthorControl(fixture.doc, '#workspace-feedback-label')),
        local: host?.shadowRoot?.querySelector('.pointer-target-label')?.textContent,
        localBounds: boundsOf(host?.shadowRoot?.querySelector('.pointer-target-label')) },
      authorErrors: { text: queryAuthorControl(fixture.doc, '#author-errors')?.textContent, hidden: queryAuthorControl<HTMLElement>(fixture.doc, '#author-errors')?.hidden },
      confirmations: fixture.confirmations,
      pointer: trace, activeElement: describeTarget(authorActiveElement(fixture.doc)),
      host: boundsOf(host), palette: boundsOf(queryAuthorControl(fixture.doc, '#workspace-dock')), editor: boundsOf(queryAuthorControl(fixture.doc, '#score-editor')),
      scoreViewport: (() => {
        const viewport = queryAuthorControl<HTMLElement>(fixture.doc, '#score-scroll');
        return viewport ? { bounds: boundsOf(viewport), scrollTop: viewport.scrollTop, scrollLeft: viewport.scrollLeft,
          scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight, clientWidth: viewport.clientWidth } : null;
      })(),
      openPopovers: [...fixture.doc.querySelectorAll('[popover]')].filter(element => element.matches(':popover-open')).map(element => element.id),
      hitAtLatestPoint: point ? { document: describeTarget(fixture.doc.elementFromPoint(point.x, point.y)),
        scoreHost: describeTarget(host?.shadowRoot?.elementFromPoint(point.x, point.y)),
        notation: describeTarget(root?.shadowRoot?.elementFromPoint(point.x, point.y)) } : null,
      projection: layout && { id: layout.projectionId, revision: layout.revision, kind: layout.projection },
      systems: layout?.systems.map(system => {
        const svg = svgNodes[system.index]; const matrix = svg?.getScreenCTM();
        const local = point && matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse()) : undefined;
        return { index: system.index, viewBox: system.viewBox, rect: boundsOf(svg),
          screenCTM: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], localLatestPoint: local && { x: local.x, y: local.y },
          lanes: system.measures.map(measure => ({ id: measure.sourceId, staffId: measure.staffId, noteStartX: measure.noteStartX,
            noteEndX: measure.noteEndX, topLine: measure.topLine, bottomLine: measure.bottomLine })),
          events: system.events.map(event => ({ id: event.sourceId, voiceId: event.voiceId, anchorX: event.anchorX, heads: event.noteheads })),
          anchors: system.anchors.map(anchor => ({ x: anchor.x, eventIndex: anchor.eventIndex, voiceId: anchor.voiceId,
            beforeId: anchor.beforeId, afterId: anchor.afterId, onset: anchor.onset })),
        };
      }),
    }, null, 2);
  } catch (error) { return `Diagnostic collection failed: ${error instanceof Error ? error.message : String(error)}`; }
}
async function watchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: did not complete within 20 seconds.`)), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function waitFor(fixture: Fixture, check: () => boolean, label: string): Promise<void> {
  let observer: MutationObserver | undefined;
  let animation = 0;
  try {
    await watchdog(new Promise<void>((resolve, reject) => {
      const inspect = () => { try { if (check()) resolve(); } catch (error) { reject(error); } };
      const frame = () => { inspect(); animation = fixture.view.requestAnimationFrame(frame); };
      observer = new MutationObserver(inspect);
      observer.observe(fixture.doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      animation = fixture.view.requestAnimationFrame(frame);
      inspect();
    }), label);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nActual fixture diagnostics:\n${diagnostic(fixture)}`);
  } finally { observer?.disconnect(); fixture.view.cancelAnimationFrame(animation); }
}
async function frames(fixture: Fixture): Promise<void> {
  await watchdog(new Promise<void>(resolve => fixture.view.requestAnimationFrame(() => fixture.view.requestAnimationFrame(() => resolve()))),
    'Deliver rendering and viewport observations');
}
function field<T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string): T {
  const element = queryAuthorControl<T>(fixture.doc, selector);
  assert(element, `The actual Author route is missing ${selector}.`);
  return element;
}
function visible(fixture: Fixture, element: Element): boolean {
  const style = fixture.view.getComputedStyle(element);
  return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}
function closestControl(element: HTMLElement, selector: string): HTMLElement | null {
  for (let current: HTMLElement | null = element; current; current = authorControlParent(current)) if (current.matches(selector)) return current;
  return null;
}

/** Follow the actual public pane/popover controls; never reveal a hidden field by mutation. */
function enterAtSelection(fixture: Fixture): void {
  const enter = field<HTMLElement>(fixture, '#toggle-entry');
  if (enter.getAttribute('aria-pressed') === 'true') return;
  // Fixed Write resumes the saved writing destination. Pointer fixture setup
  // deliberately starts at the selected location through its separate action.
  click(fixture, '#start-entry-here');
  assert(enter.getAttribute('aria-pressed') === 'true', 'Start writing here must enable entry at the selected location.');
}

function revealControl(fixture: Fixture, selector: string): HTMLElement {
  const target = field<HTMLElement>(fixture, selector);
  if (visible(fixture, target)) return target;
  const inspector = closestControl(target, '#selection-inspector, #passage-inspector, #annotation-inspector, #measure-inspector');
  if (inspector) {
    const tools = field<HTMLElement>(fixture, '#workspace-tools');
    if (!visible(fixture, tools)) click(fixture, visible(fixture, field(fixture, '#edit-selected-event')) ? '#edit-selected-event' : '#tools-toggle');
    if (inspector.id === 'selection-inspector') {
      if (!visible(fixture, inspector)) click(fixture, '#back-to-properties');
    } else {
      const tabs: Record<string, string> = { 'passage-inspector': 'rhythm', 'annotation-inspector': 'markings', 'measure-inspector': 'measure' };
      if (!visible(fixture, field(fixture, '#tools-tablist'))) click(fixture, '#other-tools');
      const tab = '#tool-tab-' + tabs[inspector.id];
      if (field<HTMLElement>(fixture, tab).getAttribute('aria-selected') !== 'true') click(fixture, tab);
    }
  }
  const popover = closestControl(target, '[popover]');
  if (popover && !popover.matches(':popover-open')) {
    const invokers = [...fixture.doc.querySelectorAll<HTMLButtonElement>(
      '[popovertarget="' + popover.id + '"]:not([popovertargetaction="hide"])')];
    const invoker = invokers.find(button => visible(fixture, button)) ?? invokers[0];
    assert(invoker?.id, popover.id + ' needs a public popover invoker.');
    if (['entry-settings', 'entry-value-chooser'].includes(popover.id) && !visible(fixture, invoker)) {
      assert(fixture.doc.body.dataset.view === 'write', 'Entry settings must not be exposed outside Write.');
      enterAtSelection(fixture);
      if (popover.id === 'entry-value-chooser' && visible(fixture, field(fixture, '#cancel-entry-drag'))) click(fixture, '#cancel-entry-drag');
    }
    click(fixture, '#' + invoker.id);
  }
  if (!visible(fixture, target) && ['insert-event', 'entry-settings-trigger', 'entry-value-trigger'].includes(target.id)) {
    assert(fixture.doc.body.dataset.view === 'write', 'Entry controls must not be exposed outside Write.');
    enterAtSelection(fixture);
    if (['insert-event', 'entry-value-trigger'].includes(target.id) && visible(fixture, field(fixture, '#cancel-entry-drag'))) click(fixture, '#cancel-entry-drag');
  }
  const disclosures: HTMLDetailsElement[] = [];
  for (let parent = authorControlParent(target); parent; parent = authorControlParent(parent)) {
    if (parent.localName === 'details') disclosures.unshift(parent as HTMLDetailsElement);
  }
  for (const details of disclosures) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    assert(summary && visible(fixture, summary), 'An inline disclosure needs its visible native summary before use.');
    summary.focus(); summary.click();
  }
  assert(visible(fixture, target), selector + ' must be visible after opening its public controls.');
  return target;
}

function closePanel(fixture: Fixture, selector: string): void {
  const panel = field<HTMLElement>(fixture, selector);
  if (panel.localName === 'details') {
    if ((panel as HTMLDetailsElement).open) click(fixture, selector + ' > summary');
    return;
  }
  if (!visible(fixture, panel)) return;
  if (panel.hasAttribute('popover') && !panel.matches(':popover-open')) return;
  const close = panel.querySelector<HTMLButtonElement>(
    '[popovertarget="' + panel.id + '"][popovertargetaction="hide"]');
  assert(close?.id, selector + ' needs its actual Close control.');
  click(fixture, '#' + close.id);
}

function click(fixture: Fixture, selector: string): void {
  const element = revealControl(fixture, selector);
  assert(visible(fixture, element), `${selector} must be visible before use.`);
  assert(!('disabled' in element) || !element.disabled, `${selector} is unexpectedly disabled.`);
  element.focus(); element.click();
}
function inputEvent(fixture: Fixture, target: HTMLElement, type: string): void {
  const event = fixture.doc.createEvent('Event'); event.initEvent(type, true, false); target.dispatchEvent(event);
}
function choose(fixture: Fixture, selector: string, value: string): void {
  const select = revealControl(fixture, selector) as HTMLSelectElement;
  assert(visible(fixture, select) && !select.disabled, `${selector} must be available for native selection.`);
  assert([...select.options].some(option => option.value === value && !option.disabled), `${selector} has no enabled ${value} option.`);
  select.focus(); select.value = value; inputEvent(fixture, select, 'input'); inputEvent(fixture, select, 'change');
}
function write(fixture: Fixture, selector: string, value: string): void {
  const input = revealControl(fixture, selector) as HTMLInputElement | HTMLTextAreaElement;
  assert(visible(fixture, input) && !input.disabled, `${selector} must be available for editing.`);
  input.focus(); input.value = value; inputEvent(fixture, input, 'input'); inputEvent(fixture, input, 'change');
}
function source(fixture: Fixture): string { return field<HTMLTextAreaElement>(fixture, '#source-input').value; }
function revision(fixture: Fixture): number { return Number(fixture.doc.body.dataset.authorRevision); }
function entryRecipe(fixture: Fixture): object {
  return Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-duration', 'event-dots',
    'event-accidental-display', 'event-stem', 'event-beam', 'insert-position']
    .map(id => [id, field<HTMLInputElement | HTMLSelectElement>(fixture, '#' + id).value]));
}
async function selectedNote(fixture: Fixture, expectedPitch: string, label: string): Promise<void> {
  const trigger = field<HTMLButtonElement>(fixture, '#selection-pitch');
  const expected = parsePitch(expectedPitch);
  assert(visible(fixture, trigger) && !trigger.disabled, `${label}: the selected note must expose its visible Pitch action.`);
  equal(trigger.getAttribute('aria-label'), `Pitch: ${pitchDescription(expected)}`, `${label}: the visible Pitch action names its accepted target`);
  const before = [source(fixture), revision(fixture), music(fixture)]; const recipe = entryRecipe(fixture);
  click(fixture, '#selection-pitch'); await frames(fixture);
  for (const selector of ['#selection-note-step', '#selection-note-octave', '#selection-alteration']) {
    assert(visible(fixture, field(fixture, selector)), `${label}: the explicit Pitch chooser must display ${selector}.`);
  }
  equal(['selection-note-step', 'selection-note-octave', 'selection-alteration'].map(id => field<HTMLSelectElement>(fixture, '#' + id).value),
    [expected.step, String(expected.octave), String(expected.alter)], `${label}: the visible chooser shows the exact selected spelling`);
  closePanel(fixture, '#selection-pitch-chooser'); await frames(fixture); await settle(fixture);
  equal([source(fixture), revision(fixture), music(fixture)], before, `${label}: inspecting the spelling must not edit accepted music`);
  equal(entryRecipe(fixture), recipe, `${label}: inspecting selected music preserves the independent entry recipe`);
}
function shadow(fixture: Fixture): ShadowRoot {
  const shadow = field(fixture, '#score-host').shadowRoot;
  assert(shadow, 'The real score host must expose its open source-isolation shadow root.');
  return shadow;
}
function surface(fixture: Fixture): MusicSurface {
  const root = shadow(fixture).querySelector<MusicSurface>('music-system, music-staff');
  assert(root && typeof root.renderComplete?.then === 'function', 'The actual Author route must use a public notation surface.');
  return root;
}
function score(fixture: Fixture): Score { const score = surface(fixture).score; assert(score, 'The notation has not exposed its parsed score.'); return score; }
function events(fixture: Fixture): MusicEvent[] {
  return score(fixture).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
}
function eventById(fixture: Fixture, id: string): MusicEvent {
  const event = events(fixture).find(item => item.id === id); assert(event, `Missing accepted event ${id}.`); return event;
}
function music(fixture: Fixture): string {
  // Implicit voice/standalone-score IDs belong to a projected DOM instance.
  // Real source IDs, ordering, written values, tuplets and timing remain exact.
  return JSON.stringify(score(fixture).staves.map(staff => ({ id: staff.id, clef: staff.clef, key: staff.key,
    measures: staff.measures.map(measure => ({ ...measure, voices: measure.voices.map(voice => ({
      events: voice.events, tuplets: voice.tuplets,
    })) })),
  })));
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
async function settle(fixture: Fixture): Promise<void> {
  await waitFor(fixture, () => fixture.doc.body.dataset.authorReady === 'true' && fixture.doc.body.dataset.renderState !== 'rendering', 'Complete the Author render');
  assert(fixture.doc.body.dataset.renderState === 'ready', `The Author render failed: ${field(fixture, '#author-errors').textContent}`);
  await watchdog(fixture.doc.fonts.ready, 'Load the bundled notation fonts');
  await watchdog(surface(fixture).renderComplete, 'Complete actual notation rendering');
  const errors = surface(fixture).diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(!errors.length, `Accepted notation contains errors: ${errors.map(diagnostic => diagnostic.message).join('\n')}`);
}
async function exposeScore(fixture: Fixture): Promise<void> {
  closePanel(fixture, '#entry-settings');
  closePanel(fixture, '#entry-value-chooser');
  closePanel(fixture, '#selection-pitch-chooser');
  closePanel(fixture, '#location-panel');
  const editor = field(fixture, '#score-editor');
  editor.scrollIntoView({ block: 'center', behavior: 'instant' });
  editor.focus({ preventScroll: true });
  await frames(fixture);
  await settle(fixture);
}
function shimCapture(fixture: Fixture): void {
  // Browser-created active pointer IDs cannot be forged with PointerEvent().
  // These three disposable elements keep test-local capture bookkeeping only;
  // event routing stays explicit and no native/prototype/application API changes.
  for (const selector of ['#score-host', '#drag-entry', '#drag-pitch']) {
    const element = field(fixture, selector);
    const captured = new Set<number>();
    Object.defineProperties(element, {
      setPointerCapture: { configurable: true, value: (id: number) => { captured.add(id); } },
      hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) },
      releasePointerCapture: { configurable: true, value: (id: number) => { captured.delete(id); } },
    });
  }
}
function observeFixtureConfirmations(fixture: Fixture): void {
  fixture.stopConfirmations?.();
  const dialog = field<HTMLDialogElement>(fixture, '#author-confirmation');
  const message = field(fixture, '#author-confirmation-message');
  const controls = {
    confirm: field<HTMLButtonElement>(fixture, '#author-confirmation-confirm'),
    cancel: field<HTMLButtonElement>(fixture, '#author-confirmation-cancel'),
  };
  let answered = false;
  const respond = () => {
    if (!dialog.open) { answered = false; return; }
    if (answered || !visible(fixture, dialog)) return;
    const decision = fixture.confirmationDecision;
    const button = controls[decision];
    const text = message.textContent?.trim();
    if (!text || button.disabled || !visible(fixture, button)) return;
    answered = true;
    fixture.confirmations.push({ message: text, decision });
    button.focus(); button.click();
  };
  const observer = new MutationObserver(respond);
  observer.observe(dialog, { attributes: true, childList: true, subtree: true, characterData: true });
  dialog.addEventListener('toggle', respond);
  const view = fixture.view;
  const stop = () => { observer.disconnect(); dialog.removeEventListener('toggle', respond); view.removeEventListener('pagehide', stop); };
  view.addEventListener('pagehide', stop, { once: true });
  fixture.stopConfirmations = stop;
  respond();
}
async function mount(label: string, syntheticCapture = true, options: MountOptions = {}): Promise<Fixture> {
  token ||= crypto.randomUUID();
  const workspace = `test-pointer-${token}-${++sequence}`;
  const key = `music-notes.author.recovery.v1:${workspace}`;
  assert(localStorage.getItem(key) === null, 'Pointer fixtures must never replace an existing recovery key.');
  ownedKeys.add(key);
  const article = document.createElement('article'); article.className = 'fixture'; article.dataset.workspace = workspace;
  const heading = document.createElement('h3'); heading.textContent = label;
  const note = document.createElement('p'); note.className = 'fixture-note';
  note.textContent = syntheticCapture
    ? 'Actual Author route; synthetic input and capture bookkeeping shim on this iframe’s three capture targets. Opening a separate tab restores native capture. '
    : 'Actual Author route; native capture is untouched. Synthetic pointer rejection and coalesced release are checked here. ';
  const viewport = document.createElement('div'); viewport.className = 'viewport';
  const frame = document.createElement('iframe'); frame.title = label; frame.style.width = `${options.width ?? 1180}px`;
  if (options.height !== undefined) frame.style.height = `${options.height}px`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.src = `/author.html?workspace=${workspace}`;
  const open = document.createElement('a'); open.href = frame.src; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open this isolated workspace';
  note.append(open); viewport.append(frame); article.append(heading, note, viewport); (options.container ?? fixtures).append(article);
  await watchdog(loaded, 'Load the actual pointer-editing workspace');
  const doc = frame.contentDocument; const view = frame.contentWindow;
  assert(doc && view, 'The fixture must remain on the same origin.');
  const fixture: Fixture = { frame, doc, view, workspace, syntheticCapture, confirmationDecision: 'confirm', confirmations: [] };
  observeFixtureConfirmations(fixture);
  view.print = () => { throw new Error('Pointer regressions must not request a native print dialog.'); };
  await settle(fixture);
  if (syntheticCapture) shimCapture(fixture);
  await exposeScore(fixture);
  return fixture;
}
function staffSource(rhythm: string, clef: Clef = 'treble', measureAttributes = ''): string {
  return `<music-staff id="blank-staff" label="Pointer study" clef="${clef}" key="C" meter="4/4"><music-measure id="blank-m1" ${measureAttributes}>${rhythm}</music-measure></music-staff>`;
}
const twoNotes = '<!-- retain the written idea --><music-note id="first" pitch="F4" accidental="sharp" duration="half" accidental-display="courtesy" data-author="kept"></music-note><music-direction id="listen" text="Listen" at="1/2"></music-direction><music-note id="second" pitch="G4" duration="half"></music-note>';
async function applySource(fixture: Fixture, html: string): Promise<void> {
  revealControl(fixture, '#source-panel');
  write(fixture, '#source-input', html);
  const before = revision(fixture);
  click(fixture, '#source-apply');
  await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready'
    && !/unapplied|pending|invalid/i.test(field(fixture, '#source-status').textContent ?? ''), 'Apply the pointer fixture through guarded Source');
  await settle(fixture);
  closePanel(fixture, '#source-panel');
  await exposeScore(fixture);
}
async function selectMode(fixture: Fixture): Promise<void> {
  if (field(fixture, '#select-mode').getAttribute('aria-pressed') !== 'true') click(fixture, '#select-mode');
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'false', 'Select mode must not leave click-to-write active');
  await exposeScore(fixture);
}
async function enterMode(fixture: Fixture, duration = 'quarter'): Promise<void> {
  enterAtSelection(fixture);
  choose(fixture, '#event-kind', 'note'); write(fixture, '#event-pitch', 'C4');
  choose(fixture, '#event-duration', duration); choose(fixture, '#event-dots', '0');
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Options and Value keep the explicit writing intent');
  await exposeScore(fixture);
}
async function prepareEntryHandle(fixture: Fixture): Promise<void> {
  const before = [source(fixture), revision(fixture), music(fixture)]; const recipe = entryRecipe(fixture);
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Choose a writing destination before preparing an entry drag');
  click(fixture, '#prepare-entry-drag'); await exposeScore(fixture);
  assert(visible(fixture, field(fixture, '#drag-entry')) && visible(fixture, field(fixture, '#cancel-entry-drag')),
    'The deliberate Options action exposes the entry handle and its Done action.');
  equal([source(fixture), revision(fixture), music(fixture)], before, 'Preparing an entry handle changes no accepted music or history');
  equal(entryRecipe(fixture), recipe, 'Preparing entry dragging keeps every recipe value');
}
async function preparePitchHandle(fixture: Fixture): Promise<void> {
  const before = [source(fixture), revision(fixture), music(fixture)]; const recipe = entryRecipe(fixture);
  equal(field(fixture, '#select-mode').getAttribute('aria-pressed'), 'true', 'Choose Select before preparing a pitch drag');
  click(fixture, '#selection-prepare-drag'); await exposeScore(fixture);
  assert(visible(fixture, field(fixture, '#drag-pitch')) && visible(fixture, field(fixture, '#selection-done')),
    'Properties exposes the deliberate pitch handle and Done through the real preparation action.');
  equal([source(fixture), revision(fixture), music(fixture)], before, 'Preparing pitch dragging changes no accepted music or history');
  equal(entryRecipe(fixture), recipe, 'Preparing selected-pitch dragging preserves the future recipe');
}
function geometry(fixture: Fixture, measureId = 'blank-m1'): GeometryContext {
  const root = surface(fixture); const layout = root.getLayoutGeometry();
  assert(layout && layout.revision === root.renderRevision, 'Pointer tests need current public geometry.');
  const system = layout.systems.find(system => system.measures.some(measure => measure.sourceId === measureId));
  assert(system, `No system contains measure ${measureId}.`);
  const measure = system.measures.find(measure => measure.sourceId === measureId)!;
  const svg = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)[system.index];
  assert(svg && visible(fixture, svg), 'Pointer target geometry must belong to a visible actual SVG.');
  return { system, measure, svg };
}
function client(svg: SVGSVGElement, x: number, y: number): Point {
  const matrix = svg.getScreenCTM(); assert(matrix, 'The actual SVG must have a current screen transform.');
  const point = new DOMPoint(x, y).matrixTransform(matrix); return { x: point.x, y: point.y };
}
function eventGeometry(fixture: Fixture, id: string): { context: GeometryContext; event: EventGeometry } {
  const layout = surface(fixture).getLayoutGeometry(); assert(layout, 'The public geometry is unavailable.');
  const event = layout.systems.flatMap(system => system.events).find(event => event.sourceId === id);
  assert(event, `No actual geometry for event ${id}.`);
  return { context: geometry(fixture, event.measureId), event };
}
function head(fixture: Fixture, id: string, steps = 0): Target {
  const { context, event } = eventGeometry(fixture, id);
  const head = event.noteheads?.[0]; assert(head, `${id} has no painted notehead geometry.`);
  const element = [...context.svg.querySelectorAll<SVGGraphicsElement>('g[data-source-id]')].find(element => element.dataset.sourceId === id);
  assert(element, 'The notehead must resolve to an actual rendered source group.');
  const step = (context.measure.bottomLine - context.measure.topLine) / 8;
  return { element, point: client(context.svg, head.centerX, head.centerY - steps * step) };
}
function eventInk(fixture: Fixture, id: string): Target {
  const { context, event } = eventGeometry(fixture, id);
  const element = [...context.svg.querySelectorAll<SVGGraphicsElement>('g[data-source-id]')].find(element => element.dataset.sourceId === id);
  assert(element, `Event ${id} must resolve to rendered DOM.`);
  return { element, point: client(context.svg, event.ink.x + event.ink.width / 2, event.ink.y + event.ink.height / 2) };
}
function staffPoint(fixture: Fixture, options: { measureId?: string; beforeId?: string; afterId?: string; voiceId?: string; steps?: number } = {}): Target {
  const context = geometry(fixture, options.measureId);
  const anchors = context.system.anchors.filter(anchor => anchor.measureId === context.measure.sourceId
    && (!options.voiceId || anchor.voiceId === options.voiceId));
  const anchor: InsertionAnchor | undefined = anchors.find(anchor => options.beforeId ? anchor.beforeId === options.beforeId
    : options.afterId ? anchor.afterId === options.afterId : anchor.eventIndex === 0);
  assert(anchor, 'The fixture must use an actual insertion anchor, not an invented x coordinate.');
  const step = (context.measure.bottomLine - context.measure.topLine) / 8;
  return { element: context.svg, point: client(context.svg, anchor.x, context.measure.bottomLine - (options.steps ?? 0) * step) };
}
function handle(fixture: Fixture, selector: string): Target {
  const element = field(fixture, selector); assert(visible(fixture, element), `${selector} must be a visible deliberate drag handle.`);
  assert(!('disabled' in element) || !element.disabled, `${selector} must be enabled for this note.`);
  const bounds = element.getBoundingClientRect(); return { element, point: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
}
function assertNotationTarget(fixture: Fixture, target: Target, entry: boolean, label: string): void {
  equal(fixture.doc.body.dataset.view, 'write', `${label}: the actual workspace must be in Write`);
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), String(entry),
    `${label}: explicitly choose ${entry ? 'Enter here' : 'Select'} before beginning the gesture`);
  const openPopovers = [...fixture.doc.querySelectorAll('[popover]')].filter(element => element.matches(':popover-open')).map(element => element.id);
  equal(openPopovers, [], `${label}: close transient controls before targeting the notation`);
  const host = field(fixture, '#score-host');
  const viewport = field(fixture, '#score-scroll');
  const root = surface(fixture);
  const svg = target.element.closest('svg');
  const row = target.element.closest('.system-row');
  assert(svg && row, `${label}: the target must resolve to an actual rendered system.`);
  const bounds = [host, viewport, svg].map(element => element.getBoundingClientRect());
  const left = Math.max(0, ...bounds.map(box => box.left));
  const top = Math.max(0, ...bounds.map(box => box.top));
  const right = Math.min(fixture.view.innerWidth, ...bounds.map(box => box.right));
  const bottom = Math.min(fixture.view.innerHeight, ...bounds.map(box => box.bottom));
  assert(target.point.x >= left && target.point.x <= right && target.point.y >= top && target.point.y <= bottom,
    `${label}: the intended point must lie inside the visible host, notation viewport, and target SVG.\n${JSON.stringify({ point: target.point, left, top, right, bottom })}`);
  const hit = fixture.doc.elementFromPoint(target.point.x, target.point.y);
  const notationHit = root.shadowRoot!.elementFromPoint(target.point.x, target.point.y);
  assert(hit === host && notationHit && (notationHit === row || row.contains(notationHit)),
    `${label}: the intended point must actually hit its notation system, not a popover or clipped content.\n${JSON.stringify({ documentHit: describeTarget(hit), notationHit: describeTarget(notationHit), point: target.point })}`);
}
function pointer(fixture: Fixture, target: Element | Document | Window, type: string, point: Point, pointerId: number,
  pointerType: 'mouse' | 'touch' = 'mouse', isPrimary = true, buttons?: number): boolean {
  const pressed = buttons ?? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1);
  const latest = { type, pointerId, pointerType, buttons: pressed, point: { ...point }, target: describeTarget(target) };
  pointerTraces.set(fixture, { start: type === 'pointerdown' ? latest : pointerTraces.get(fixture)?.start, latest });
  return target.dispatchEvent(new (fixture.view as Window & typeof globalThis).PointerEvent(type, {
    bubbles: true, composed: true, cancelable: true, view: fixture.view,
    pointerId, pointerType, isPrimary, button: 0,
    buttons: pressed,
    pressure: pressed ? 0.5 : 0,
    clientX: point.x, clientY: point.y,
  }));
}
function compatibilityClick(fixture: Fixture, target: Element, point: Point): void {
  target.dispatchEvent(new (fixture.view as Window & typeof globalThis).MouseEvent('click', { bubbles: true, composed: true, cancelable: true,
    view: fixture.view, button: 0, buttons: 0, detail: 1, clientX: point.x, clientY: point.y }));
}
function begin(fixture: Fixture, target: Target, pointerType: 'mouse' | 'touch' = 'mouse'): Gesture {
  const gesture = { fixture, target, pointerId: ++pointerSequence, pointerType, source: source(fixture), revision: revision(fixture), music: music(fixture) };
  pointer(fixture, target.element, 'pointerdown', target.point, gesture.pointerId, pointerType);
  return gesture;
}
function move(gesture: Gesture, point: Point): void {
  pointer(gesture.fixture, gesture.target.element, 'pointermove', point, gesture.pointerId, gesture.pointerType);
}
function release(gesture: Gesture, point: Point, compat = true): void {
  pointer(gesture.fixture, gesture.target.element, 'pointerup', point, gesture.pointerId, gesture.pointerType);
  if (compat) compatibilityClick(gesture.fixture, gesture.target.element, point);
}
function unchanged(gesture: Gesture, label: string): void {
  equal(source(gesture.fixture), gesture.source, `${label}: accepted Source text must remain byte-for-byte unchanged`);
  equal(revision(gesture.fixture), gesture.revision, `${label}: no authoring history revision may be created`);
  equal(music(gesture.fixture), gesture.music, `${label}: the accepted musical model must remain unchanged`);
}
function onScreen(fixture: Fixture, element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return visible(fixture, element) && rect.width > 0 && rect.height > 0
    && rect.left >= -0.5 && rect.top >= -0.5 && rect.right <= fixture.view.innerWidth + 0.5 && rect.bottom <= fixture.view.innerHeight + 0.5;
}
function readableMatch(fixture: Fixture, element: HTMLElement, pattern: RegExp, expected?: string): boolean {
  if (!onScreen(fixture, element)) return false;
  // These production feedback elements contain one text node. Measure the
  // actual pitch or rest value so ellipsis cannot turn a hidden suffix into a pass.
  const node = element.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE || element.childNodes.length !== 1) return false;
  const text = node.textContent ?? '';
  const bounds = element.getBoundingClientRect(); const style = fixture.view.getComputedStyle(element);
  const ellipsis = style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth
    ? (Number.parseFloat(style.fontSize) || 12) * 1.25 : 0;
  return [...text.matchAll(pattern)].some(match => {
    if (expected && match[0] !== expected) return false;
    const range = fixture.doc.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
    const rects = [...range.getClientRects()];
    return rects.length > 0 && rects.every(rect => rect.width > 0 && rect.height > 0
      && rect.left >= bounds.left - 0.5 && rect.right <= bounds.right - ellipsis + 0.5
      && rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5);
  });
}
function readablePitch(fixture: Fixture, element: HTMLElement, expectedPitch?: string): boolean {
  return readableMatch(fixture, element, /\b[A-G](?:bb|##|tqf|tqs|qf|qs|b|#)?-?\d+\b/g, expectedPitch);
}
function previewFeedback(fixture: Fixture, expectedPitch?: string, restDuration?: string): {
  localLabelVisible: boolean; headerPitchVisible: boolean; headerRestVisible: boolean; checkedInkSystems: number;
} {
  assert(shadow(fixture).querySelector('.pointer-target-caret'), 'A real preview must retain its engraved target caret.');
  const label = shadow(fixture).querySelector<HTMLElement>('.pointer-target-label');
  const status = field(fixture, '#workspace-feedback-label');
  const readable = (element: HTMLElement) => restDuration
    ? readableMatch(fixture, element, new RegExp(`\\b${restDuration} rest\\b`, 'g'))
    : readablePitch(fixture, element, expectedPitch);
  const concrete = (text: string) => {
    return (restDuration ? text.includes(`${restDuration} rest`) : /\b[A-G](?:bb|##|tqf|tqs|qf|qs|b|#)?-?\d+\b/.test(text)) && /\bbar\s+\d+\b/i.test(text)
      && /\bvoice\s+\d+\b/i.test(text) && (!expectedPitch || text.includes(expectedPitch));
  };
  const localLabelVisible = !!label && onScreen(fixture, label);
  const headerPitchVisible = !restDuration && readablePitch(fixture, status, expectedPitch);
  const headerRestVisible = !!restDuration && readable(status);
  assert((localLabelVisible && readable(label!)) || headerPitchVisible || headerRestVisible,
    `A preview must show a readable ${restDuration ? 'written rest value' : 'concrete pitch'} in its local label or persistent header, not only in closed Review content.`);
  assert((localLabelVisible && concrete(label!.textContent ?? ''))
    || onScreen(fixture, status) && concrete(status.getAttribute('aria-label') ?? status.textContent ?? ''),
  'The visible preview feedback must retain its full pitch or rest value, bar, and voice context in the chip or the header’s accessible name.');
  let checkedInkSystems = 0;
  if (label && visible(fixture, label)) {
    assert(localLabelVisible, 'A displayed local preview label must fit completely inside the viewport.');
    const chip = label.getBoundingClientRect();
    const root = surface(fixture); const layout = root.getLayoutGeometry();
    assert(layout, 'A visible local label must be checked against current source geometry.');
    const svgNodes = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`);
    for (const system of layout.systems) {
      const svg = svgNodes[system.index]; const matrix = svg?.getScreenCTM();
      assert(svg && matrix, 'Every system needs its actual screen transform for the preview collision check.');
      const ink = system.ink;
      const corners = [[ink.x, ink.y], [ink.x + ink.width, ink.y], [ink.x, ink.y + ink.height], [ink.x + ink.width, ink.y + ink.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const bounds = { left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)),
        top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)) };
      const overlapX = Math.min(chip.right, bounds.right) - Math.max(chip.left, bounds.left);
      const overlapY = Math.min(chip.bottom, bounds.bottom) - Math.max(chip.top, bounds.top);
      assert(overlapX <= 0.1 || overlapY <= 0.1,
        `The local preview label covers measured notation ink in system ${system.index + 1}.\n${JSON.stringify({ chip: boundsOf(label), ink: bounds, overlapX, overlapY })}`);
      checkedInkSystems++;
    }
  }
  return { localLabelVisible, headerPitchVisible, headerRestVisible, checkedInkSystems };
}
async function preview(gesture: Gesture, kind: 'insert' | 'pitch', restDuration?: string): Promise<void> {
  const fixture = gesture.fixture;
  await waitFor(fixture, () => fixture.doc.body.dataset.pointerGesture === kind
    && !!shadow(fixture).querySelector('.pointer-preview .pointer-ghost[data-valid="true"] svg'), 'Engrave the detached pointer preview');
  const layer = shadow(fixture).querySelector<HTMLElement>('.pointer-preview')!;
  equal(layer.getAttribute('aria-hidden'), 'true', 'The temporary pointer preview must stay outside the accessible score');
  equal(fixture.view.getComputedStyle(layer).pointerEvents, 'none', 'A preview must not intercept the intended staff hit target');
  if (restDuration) assert(shadow(fixture).querySelector(`.pointer-ghost[data-entry-kind="rest"] svg[data-rest-preview="${restDuration}"]`),
    'A rest gesture must engrave the chosen written rest, never a pitched-note ghost.');
  try { previewFeedback(fixture, undefined, restDuration); }
  catch (error) {
    // Capture while the preview is still active. A subsequent tool focus,
    // viewport change, or next fixture can replace the live gesture message.
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nPreview-time fixture diagnostics:\n${diagnostic(fixture)}`);
  }
  unchanged(gesture, 'Pointer preview');
  previewCount++;
}
async function commit(gesture: Gesture, point: Point, expected: () => boolean): Promise<void> {
  release(gesture, point);
  await waitFor(gesture.fixture, () => revision(gesture.fixture) === gesture.revision + 1
    && gesture.fixture.doc.body.dataset.renderState === 'ready' && expected(), 'Commit one validated pointer transaction');
  await settle(gesture.fixture);
  assert(!gesture.fixture.doc.body.dataset.pointerGesture, 'A completed pointer transaction must clear the active gesture state.');
  committedGestures++;
}
async function noCommit(gesture: Gesture, label: string): Promise<void> {
  await frames(gesture.fixture); await settle(gesture.fixture);
  await waitFor(gesture.fixture, () => !gesture.fixture.doc.body.dataset.pointerGesture, `Clear ${label}`);
  unchanged(gesture, label);
  assert([...shadow(gesture.fixture).querySelectorAll('.pointer-ghost')].every(element => !visible(gesture.fixture, element)),
    `${label}: cancelled or completed previews must not remain visible.`);
}
async function undoGesture(gesture: Gesture): Promise<void> {
  const fixture = gesture.fixture; const before = revision(fixture);
  click(fixture, '#undo');
  await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready'
    && canonicalSource(fixture, source(fixture)) === canonicalSource(fixture, gesture.source), 'Undo exactly the completed pointer gesture');
  await settle(fixture);
  equal(music(fixture), gesture.music, 'One Undo must restore all pitches, written values, timing, voices, and real event identities');
}
async function tap(fixture: Fixture, target: Target): Promise<void> {
  const gesture = begin(fixture, target); release(gesture, target.point); await frames(fixture); await settle(fixture);
}
async function selectNoteForDrag(fixture: Fixture, id: string): Promise<void> {
  equal(field(fixture, '#select-mode').getAttribute('aria-pressed'), 'true', 'Choose Select before preparing a single-note pitch gesture');
  const before = [source(fixture), revision(fixture), music(fixture)]; const recipe = entryRecipe(fixture);
  const target = head(fixture, id); assertNotationTarget(fixture, target, false, `Select ${id} before its pitch gesture`);
  const root = surface(fixture); const hit = root.shadowRoot!.elementFromPoint(target.point.x, target.point.y);
  assert(hit && (hit === root || root.shadowRoot!.contains(hit)),
    `The actual painted notehead for ${id} must hit the rendered notation, not a covering control.`);
  await tap(fixture, { element: hit, point: target.point });
  await waitFor(fixture, () => {
    const chosen = [...field(fixture, '#event-navigator').shadowRoot?.querySelectorAll<HTMLElement>('[data-source-id][aria-pressed="true"]') ?? []];
    return chosen.length === 1 && chosen[0].dataset.sourceId === id;
  }, `Select the exact ${id} event through its actual rendered notehead`);
  equal(JSON.parse(field(fixture, '#selection-controls').dataset.eventIds ?? '[]'), [id],
    'The public selection controls must identify exactly one event before an eligible pitch drag');
  equal([source(fixture), revision(fixture), music(fixture)], before, 'Preparing a note selection changes no accepted music or undo history');
  equal(entryRecipe(fixture), recipe, 'Preparing a note selection preserves the independent writing recipe');
}
function pitch(event: MusicEvent): string {
  const value = event.pitches[0]; assert(value, 'A pitched event is required.');
  return pitchText(value);
}

const tests: Test[] = [
  {
    name: 'Select mode chooses music without inserting or changing a pitch',
    async run() {
      const fixture = await mount('Selection is the default');
      equal(field(fixture, '#select-mode').getAttribute('aria-pressed'), 'true', 'A new workspace must begin in Select mode');
      const initial = begin(fixture, staffPoint(fixture));
      release(initial, initial.target.point);
      await noCommit(initial, 'A default staff click');
      assert(field<HTMLButtonElement>(fixture, '#undo').disabled, 'A selection click must not create undo history.');
      await applySource(fixture, staffSource(twoNotes));
      await enterMode(fixture, 'sixteenth');
      write(fixture, '#event-pitch', 'D#6'); choose(fixture, '#event-dots', '2'); choose(fixture, '#insert-position', 'before');
      await selectMode(fixture);
      const recipe = entryRecipe(fixture);
      const selected = begin(fixture, head(fixture, 'second'));
      release(selected, selected.target.point);
      await noCommit(selected, 'A notehead selection tap');
      equal(entryRecipe(fixture), recipe, 'Selecting an existing note must preserve every configured next-entry value, including alteration, dots, and Before placement');
      equal(pitch(eventById(fixture, 'second')), 'G4', 'The selected source event must retain its actual written pitch');
      await selectedNote(fixture, 'G4', 'Staff selection');
      const editor = field(fixture, '#score-editor'); editor.focus({ preventScroll: true });
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true, cancelable: true }));
      await frames(fixture); await settle(fixture);
      await selectedNote(fixture, 'F#4', 'Arrow selection');
      equal(entryRecipe(fixture), recipe, 'Keyboard selection must preserve the independent insertion recipe');
      click(fixture, '#event-navigator [data-source-id="second"]');
      await frames(fixture); await settle(fixture);
      await selectedNote(fixture, 'G4', 'List navigation');
      equal(entryRecipe(fixture), recipe, 'List selection must preserve the independent insertion recipe');
      await noCommit(selected, 'Staff, keyboard, and list selection of accepted notes');
      await enterMode(fixture);
      const navigator = field<HTMLDetailsElement>(fixture, '#navigator-panel');
      const invoker = field(fixture, '#navigator-panel > summary');
      invoker.scrollIntoView({ block: 'center', behavior: 'instant' }); await frames(fixture);
      const bounds = invoker.getBoundingClientRect();
      const target = { element: invoker, point: { x: bounds.left + 12, y: bounds.top + bounds.height / 2 } };
      const wasOpen = navigator.open; const before = source(fixture); const beforeRevision = revision(fixture);
      const pointerId = ++pointerSequence;
      assert(pointer(fixture, invoker, 'pointerdown', target.point, pointerId), 'The native summary pointerdown must not be intercepted by staff entry.');
      pointer(fixture, invoker, 'pointerup', target.point, pointerId); compatibilityClick(fixture, invoker, target.point);
      await frames(fixture);
      equal(navigator.open, !wasOpen, 'The actual summary must retain its native disclosure action even in Enter notes mode');
      equal([source(fixture), revision(fixture)], [before, beforeRevision], 'Opening an inline score disclosure must not insert music');
      assert(!fixture.doc.body.dataset.pointerGesture, 'Native score controls must not start a staff gesture.');
      return 'Staff and notehead taps select without source changes or extra history. The visible Pitch action and its explicit chooser identify the selected spelling, and the score navigator keeps its native disclosure action during writing.';
    },
  },
  {
    name: 'Staff clicks place the correct pitch in treble, bass, alto, and tenor clefs',
    async run() {
      const references: readonly [Clef, string][] = [['treble', 'E4'], ['bass', 'G2'], ['alto', 'F3'], ['tenor', 'D3']];
      for (const [clef, expected] of references) {
        const fixture = await mount(`Click the bottom staff line in ${clef} clef`);
        await applySource(fixture, staffSource('<music-rest id="initial-rest" measure></music-rest>', clef));
        await enterMode(fixture, 'eighth');
        const target = staffPoint(fixture, { beforeId: 'initial-rest' });
        const gesture = begin(fixture, target);
        await preview(gesture, 'insert');
        await commit(gesture, target.point, () => events(fixture).length === 1 && events(fixture)[0].kind === 'note');
        const note = events(fixture)[0];
        equal([pitch(note), note.duration, note.time], [expected, 'eighth', { numerator: 1, denominator: 8 }], `${clef}: staff pitch and chosen duration must remain exact`);
        equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'An Enter-notes staff click must keep entry mode active');
        await undoGesture(gesture);
      }
      return 'Four actual clef projections map their bottom line to E4/G2/F3/D3. Each click previews real notation without changing Source, commits one eighth note, and undoes in one step.';
    },
  },
  {
    name: 'Ordinary rest clicks and prepared drags preserve exact time on pitched, rhythm, and 3 roads staves',
    async run() {
      for (const notation of ['pitched', 'rhythm', 'three-roads'] as const) {
        const fixture = await mount(`Written rests on ${notation}`, true, { width: notation === 'pitched' ? 1180 : 390, height: 660 });
        if (notation !== 'pitched') {
          choose(fixture, '#new-template', notation); const before = revision(fixture);
          click(fixture, '#new-project');
          await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready'
            && score(fixture).staves[0].notation === notation, `Open the actual ${notation} starter through Document`);
          await settle(fixture); closePanel(fixture, '#document-menu');
        }
        const originalStaff = score(fixture).staves[0]; const originalBar = originalStaff.measures[0];
        equal(originalStaff.notation ?? 'pitched', notation, 'The fixture must use its actual requested notation type');
        equal([originalBar.incomplete, originalBar.voices.length, originalBar.voices[0].events.length], [true, 1, 0],
          'Rest entry begins in a genuinely empty ordinary voice, without a manufactured full-measure rest');
        const barId = originalBar.id; const meter = originalBar.meter;
        const setup = [source(fixture), revision(fixture), music(fixture)];
        click(fixture, '#toggle-entry');
        if (notation === 'pitched') {
          write(fixture, '#event-pitch', 'Fqs5');
          choose(fixture, '#event-accidental-display', 'courtesy');
          choose(fixture, '#event-stem', 'down'); choose(fixture, '#event-beam', 'none');
        } else if (notation === 'three-roads') {
          // Roads exposes its focused Direction chooser first. Follow its real
          // Other note options action instead of invoking the hidden note button.
          click(fixture, '#entry-direction-trigger'); click(fixture, '#entry-direction-options');
          choose(fixture, '#event-direction', 'higher');
        }
        click(fixture, '#entry-choose-rest');
        choose(fixture, '#insert-position', 'after');
        choose(fixture, '#event-duration', 'quarter'); choose(fixture, '#event-dots', '1');
        await exposeScore(fixture);
        equal([source(fixture), revision(fixture), music(fixture)], setup,
          'Opening the real writing controls and choosing a rest recipe must not edit music or history');
        const recipe = () => ({ ...entryRecipe(fixture),
          alteration: field<HTMLSelectElement>(fixture, '#event-alteration').value,
          direction: field<HTMLSelectElement>(fixture, '#event-direction').value,
          fullMeasure: field<HTMLInputElement>(fixture, '#event-measure-rest').checked });
        const retainedRecipe = recipe();
        assert(!retainedRecipe.fullMeasure && field<HTMLSelectElement>(fixture, '#event-kind').value === 'rest',
          'The public Rest choice must mean an ordinary written rest.');
        const pointAt = (afterId: string | undefined, band: number): Target => {
          const context = geometry(fixture, barId);
          const voiceId = score(fixture).staves[0].measures[0].voices[0].id;
          const anchor = context.system.anchors.find(anchor => anchor.measureId === barId && anchor.voiceId === voiceId
            && (afterId ? anchor.afterId === afterId : anchor.eventIndex === 0));
          assert(anchor, `${notation}: the rest target needs an actual time anchor in the existing voice.`);
          const space = context.measure.staffSpace;
          assert(space && Number.isFinite(space) && space > 0, `${notation}: use the renderer's measured staff space, including the one-line staff.`);
          const y = (context.measure.topLine + context.measure.bottomLine) / 2 + band * space;
          const target = { element: context.svg, point: client(context.svg, anchor.x, y) };
          assertNotationTarget(fixture, target, true, `${notation}: ordinary rest target`);
          return target;
        };
        const restShape = () => {
          const ghost = shadow(fixture).querySelector<SVGSVGElement>('.pointer-ghost[data-entry-kind="rest"] svg[data-rest-preview="quarter"]');
          assert(ghost, 'The production ghost must contain the real engraved quarter-rest SVG.');
          return ['x', 'y', 'viewBox'].map(attribute => ghost.getAttribute(attribute));
        };
        const firstTarget = pointAt(undefined, -0.5); const first = begin(fixture, firstTarget);
        await preview(first, 'insert', 'quarter'); const firstShape = restShape();
        const higherTarget = pointAt(undefined, 0.5);
        move(first, higherTarget.point); await preview(first, 'insert', 'quarter');
        equal(restShape(), firstShape, `${notation}: changing pointer height within the staff must not move or repitch a rest`);
        await commit(first, higherTarget.point, () => events(fixture).length === 1 && events(fixture)[0].kind === 'rest');
        const written = events(fixture)[0];
        equal([written.kind, written.pitches, written.duration, written.dots, written.onset, written.time, written.measureRest],
          ['rest', [], 'quarter', 1, { numerator: 0, denominator: 1 }, { numerator: 3, denominator: 8 }, false],
          `${notation}: the click writes one exact dotted-quarter rest at zero without any pitch`);
        equal(recipe(), retainedRecipe, `${notation}: a rest click must preserve dormant pitch, alteration, road direction, and every next-event choice`);
        equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Rest placement keeps the explicit Write intent');

        await prepareEntryHandle(fixture);
        equal(field(fixture, '#drag-entry').getAttribute('aria-label'), 'Drag the configured rest to the staff',
          'The deliberately prepared handle must identify the actual rest recipe');
        const secondTarget = pointAt(written.id, -0.5);
        const second = begin(fixture, handle(fixture, '#drag-entry'));
        move(second, secondTarget.point); await preview(second, 'insert', 'quarter');
        const secondShape = restShape(); const lowerTarget = pointAt(written.id, 0.5);
        move(second, lowerTarget.point); await preview(second, 'insert', 'quarter');
        equal(restShape(), secondShape, `${notation}: dragging up or down at one boundary must keep the written rest anchored to its staff`);
        await commit(second, lowerTarget.point, () => events(fixture).length === 2 && events(fixture).every(event => event.kind === 'rest'));
        const accepted = score(fixture).staves[0].measures[0]; const writtenRests = accepted.voices[0].events;
        equal(writtenRests[0], written, `${notation}: appending a rest must preserve the first event's identity and complete musical value`);
        assert(writtenRests[1].id !== written.id, 'The second accepted rest needs its own source identity.');
        equal(writtenRests.map(rest => [rest.kind, rest.duration, rest.dots, rest.onset, rest.time, rest.measureRest, rest.pitches]), [
          ['rest', 'quarter', 1, { numerator: 0, denominator: 1 }, { numerator: 3, denominator: 8 }, false, []],
          ['rest', 'quarter', 1, { numerator: 3, denominator: 8 }, { numerator: 3, denominator: 8 }, false, []],
        ], `${notation}: the prepared drag appends at the real 3/8 boundary without a beat grid, invented notes, or filler rests`);
        equal([score(fixture).staves.length, score(fixture).staves[0].id, accepted.id, accepted.meter, accepted.voices.length],
          [1, originalStaff.id, barId, meter, 1], 'Both rest gestures preserve the staff, bar, meter, and voice count');
        for (const rest of writtenRests) {
          const element = surface(fixture).getSource(rest.id);
          assert(element?.localName === 'music-rest' && !['pitch', 'pitches', 'accidental', 'direction', 'measure'].some(attribute => element.hasAttribute(attribute)),
            'Accepted Source must contain an ordinary music-rest, without dormant pitch, direction, or full-measure attributes.');
        }
        equal(recipe(), retainedRecipe, `${notation}: prepared rest dragging preserves the independent entry recipe`);
        await undoGesture(second); await undoGesture(first);
        equal(events(fixture).length, 0, 'Two separate Undos restore the truly empty starter, without replacing silence with a rest');
        equal(recipe(), retainedRecipe, 'Undoing rest gestures must not rewrite the next-event recipe');
      }
      return 'Actual empty Single staff, Rhythm, and 3 roads starters each receive one dotted-quarter rest by staff click and another by the prepared rest handle at 0 and 3/8. Real rest SVGs stay at a fixed staff height, visible feedback names value/bar/voice, dormant entry settings and source containers are preserved, and each gesture undoes once. Pointer routing is synthetic; native capture and touch remain separate qualification.';
    },
  },
  {
    name: 'A notehead drag changes only pitch and remains one undoable transaction',
    async run() {
      const fixture = await mount('Preserve spelling, rhythm, metadata and comments while repitching');
      await applySource(fixture, staffSource(twoNotes));
      await selectMode(fixture);
      await selectNoteForDrag(fixture, 'first');
      const previous = eventById(fixture, 'first');
      const { pitches: _pitches, ...unchangedFields } = previous;
      const other = JSON.stringify(eventById(fixture, 'second'));
      const start = head(fixture, 'first'); const target = head(fixture, 'first', 2);
      const gesture = begin(fixture, start);
      move(gesture, head(fixture, 'first', 3).point);
      await preview(gesture, 'pitch');
      move(gesture, target.point); await preview(gesture, 'pitch');
      await commit(gesture, target.point, () => pitch(eventById(fixture, 'first')) === 'A#4');
      const { pitches: _changedPitches, ...retainedFields } = eventById(fixture, 'first');
      equal(retainedFields, unchangedFields, 'Repitching must not change duration, onset, dots, stem, beam, tie, tuplets, or event identity');
      equal(JSON.stringify(eventById(fixture, 'second')), other, 'Repitching must not affect the next event');
      assert(source(fixture).includes('data-author="kept"') && source(fixture).includes('<!-- retain the written idea -->'), 'Ordinary source metadata and comments must survive a pitch edit.');
      equal(eventById(fixture, 'first').pitches[0].alter, 1, 'Vertical dragging must preserve the explicit sharp alteration');
      await undoGesture(gesture);
      return 'Multiple detached pitch previews produce one F#4→A#4 command. Timing, written rhythm, alteration, IDs, the next note, source comments and data attributes are preserved; one Undo restores the original source.';
    },
  },
  {
    name: 'Horizontal and return-to-origin drags do not reorder music or add history',
    async run() {
      const fixture = await mount('Pitch-only movement and no-op drops');
      await applySource(fixture, staffSource(twoNotes));
      await enterMode(fixture, 'eighth');
      write(fixture, '#event-pitch', 'C#6'); choose(fixture, '#event-dots', '1');
      await selectMode(fixture);
      await selectNoteForDrag(fixture, 'first');
      const recipe = entryRecipe(fixture);
      const start = head(fixture, 'first');
      const horizontal = begin(fixture, start);
      const point = { x: start.point.x + 30, y: start.point.y };
      move(horizontal, point); await preview(horizontal, 'pitch'); release(horizontal, point);
      await noCommit(horizontal, 'A purely horizontal drag');
      const returned = begin(fixture, head(fixture, 'first'));
      move(returned, head(fixture, 'first', 2).point); await preview(returned, 'pitch');
      move(returned, returned.target.point); await preview(returned, 'pitch');
      release(returned, returned.target.point);
      await noCommit(returned, 'A drag returned to its starting pitch');
      await tap(fixture, head(fixture, 'first'));
      const unselected = begin(fixture, head(fixture, 'second'));
      const unchangedPitch = { x: unselected.target.point.x + 20, y: unselected.target.point.y };
      move(unselected, unchangedPitch); await preview(unselected, 'pitch'); release(unselected, unchangedPitch);
      await noCommit(unselected, 'A no-op drag of the previously unselected second note');
      equal(entryRecipe(fixture), recipe, 'An unchanged drop must select its source event without repurposing the next-entry recipe');
      await selectedNote(fixture, 'G4', 'Unchanged drop on the previously unselected second note');
      const secondHead = head(fixture, 'second').point;
      const highlights = [...shadow(fixture).querySelectorAll<HTMLElement>('.author-selection')];
      assert(highlights.some(element => {
        const bounds = element.getBoundingClientRect();
        return secondHead.x >= bounds.left && secondHead.x <= bounds.right && secondHead.y >= bounds.top && secondHead.y <= bounds.bottom;
      }), 'The visible selection outline must contain the unchanged note that was just dragged.');
      revealControl(fixture, '#selection-inspector');
      equal([field<HTMLInputElement>(fixture, '#selected-pitch').value, field<HTMLSelectElement>(fixture, '#selected-duration').value],
        ['G4', 'half'], 'The pristine Edit panel must bind directly to the unchanged second note, independently of entry values');
      unchanged(unselected, 'Opening the independently bound selection editor');
      const first = JSON.stringify(eventById(fixture, 'first')); const beforeApply = revision(fixture);
      write(fixture, '#selected-pitch', 'B4'); click(fixture, '#update-event');
      await waitFor(fixture, () => revision(fixture) === beforeApply + 1 && fixture.doc.body.dataset.renderState === 'ready'
        && pitch(eventById(fixture, 'second')) === 'B4', 'Apply an ordinary pitch field edit to the newly selected second note');
      equal(JSON.stringify(eventById(fixture, 'first')), first, 'Apply after an unchanged drag must not edit the previously selected first note');
      equal(entryRecipe(fixture), recipe, 'Advanced correction after a no-op drag must preserve the independent insertion recipe');
      await undoGesture(unselected);
      return 'Horizontal and return-to-origin drops preserve exact Source and history. An unchanged drop selects the other note in its cursor, highlight, and pristine Edit form while preserving the insertion recipe; the next Apply edits only that bound note and undoes once.';
    },
  },
  {
    name: 'A new measure retains After placement for four consecutive staff clicks',
    async run() {
      const fixture = await mount('Add a bar and write four quarter notes');
      equal(field<HTMLSelectElement>(fixture, '#insert-position').value, 'after', 'The initial placement must be After');
      const firstMeasure = JSON.stringify(score(fixture).staves[0].measures[0]);
      const beforeAdd = revision(fixture); click(fixture, '#add-measure');
      await waitFor(fixture, () => revision(fixture) === beforeAdd + 1 && fixture.doc.body.dataset.renderState === 'ready'
        && score(fixture).staves[0].measures.length === 2, 'Add a new measure through its visible control');
      equal(field<HTMLSelectElement>(fixture, '#insert-position').value, 'after', 'Adding a measure must not force the entry position to Replace');
      const measureId = score(fixture).staves[0].measures[1].id;
      equal(score(fixture).staves[0].measures[1].voices[0].events.map(event => [event.kind, event.measureRest]), [['rest', true]],
        'Add measure preserves its explicit full-measure-rest contract; only the initial blank template starts empty');
      await enterMode(fixture, 'quarter');
      const gestures: Gesture[] = [];
      for (let index = 0; index < 4; index++) {
        const measure = score(fixture).staves[0].measures[1]; const last = measure.voices[0].events.at(-1);
        assert(last, 'The new bar initially contains its explicit rest, then the notes written by preceding clicks.');
        const target = staffPoint(fixture, { measureId, ...(index ? { afterId: last.id } : { beforeId: last.id }), steps: index });
        const gesture = begin(fixture, target); await preview(gesture, 'insert');
        await commit(gesture, target.point, () => score(fixture).staves[0].measures[1].voices[0].events.filter(event => event.kind === 'note').length === index + 1);
        gestures.push(gesture);
      }
      const written = score(fixture).staves[0].measures[1].voices[0].events;
      equal(written.map(note => [pitch(note), note.duration, note.onset]), [
        ['E4', 'quarter', { numerator: 0, denominator: 1 }], ['F4', 'quarter', { numerator: 1, denominator: 4 }],
        ['G4', 'quarter', { numerator: 1, denominator: 2 }], ['A4', 'quarter', { numerator: 3, denominator: 4 }],
      ], 'Four staff clicks must append four exact quarter notes into the new bar');
      // A projected implicit voice ID can regenerate. The initial bar's source
      // identity and event content, rather than that wrapper, must stay intact.
      const prior = JSON.parse(firstMeasure) as Score['staves'][number]['measures'][number];
      const retained = score(fixture).staves[0].measures[0];
      equal([retained.id, retained.voices[0].events], [prior.id, prior.voices[0].events], 'Writing in the new bar must not change the previous bar');
      for (const gesture of gestures.reverse()) await undoGesture(gesture);
      return 'Add measure leaves After selected. Four clicks replace only the starter rest and then append E4–A4 at 0, 1/4, 1/2, and 3/4. The previous bar is preserved and each click has one Undo.';
    },
  },
  {
    name: 'Wrapped systems resolve their own bar and reject the gap between systems',
    async run() {
      const fixture = await mount('Use the actual second system and its surrounding gap');
      await applySource(fixture, staffSource('<music-rest id="first-system-rest" measure></music-rest>')
        .replace('</music-staff>', '<music-measure id="second-system-bar" break-before="line"><music-rest id="second-system-rest" measure></music-rest></music-measure></music-staff>'));
      await enterMode(fixture);
      equal(surface(fixture).getLayoutGeometry()?.systems.length, 2, 'The authored line break must create two real systems');
      const secondSvg = geometry(fixture, 'second-system-bar').svg;
      secondSvg.scrollIntoView({ block: 'center', behavior: 'instant' }); await frames(fixture); await settle(fixture);
      const beforeFirst = JSON.stringify(eventById(fixture, 'first-system-rest'));
      const target = staffPoint(fixture, { measureId: 'second-system-bar', beforeId: 'second-system-rest', steps: 2 });
      const gesture = begin(fixture, target); await preview(gesture, 'insert');
      await commit(gesture, target.point, () => score(fixture).staves[0].measures[1].voices[0].events[0].kind === 'note');
      equal([pitch(score(fixture).staves[0].measures[1].voices[0].events[0]), JSON.stringify(eventById(fixture, 'first-system-rest'))],
        ['G4', beforeFirst], 'Clicking the second system must edit only its own bar');
      const first = geometry(fixture).svg.getBoundingClientRect();
      const second = geometry(fixture, 'second-system-bar').svg.getBoundingClientRect();
      assert(second.top > first.bottom, 'The fixture must expose a physical intersystem gap.');
      const gap: Target = { element: field(fixture, '#score-host'), point: { x: target.point.x, y: (first.bottom + second.top) / 2 } };
      assert(gap.point.y >= 0 && gap.point.y < fixture.view.innerHeight, 'The tested gap must be inside the real viewport.');
      const missed = begin(fixture, gap); release(missed, gap.point); await noCommit(missed, 'A click in the intersystem gap');
      await undoGesture(gesture);
      return 'A click on the second wrapped staff inserts G4 only into its own measure. A point between the two actual SVG viewports produces no music or history, and one Undo restores the second bar.';
    },
  },
  {
    name: 'Existing high and low ledger notes can move beyond the insertion margin',
    async run() {
      const fixture = await mount('Repitch source notes outside the new-note ledger margin');
      await applySource(fixture, staffSource('<music-note id="high-ledger" pitch="C7" duration="half"></music-note><music-note id="low-ledger" pitch="C2" duration="half"></music-note>'));
      await selectMode(fixture);
      for (const [id, steps, expected] of [['high-ledger', -1, 'B6'], ['low-ledger', 1, 'D2']] as const) {
        // Undo focuses the header and may scroll the score out of the viewport.
        // Restore a real visible grab before measuring the next notehead.
        await exposeScore(fixture);
        await selectNoteForDrag(fixture, id);
        const { context, event } = eventGeometry(fixture, id); const center = event.noteheads![0].centerY;
        assert(center < context.measure.topLine - 40 || center > context.measure.bottomLine + 40,
          `${id} must start beyond the 40-unit insertion margin to exercise the existing-note path.`);
        const gesture = begin(fixture, head(fixture, id)); const end = head(fixture, id, steps).point;
        // Cross the drag threshold first, then return to the neighboring space.
        move(gesture, head(fixture, id, steps * 2).point); await preview(gesture, 'pitch');
        move(gesture, end); await preview(gesture, 'pitch');
        await commit(gesture, end, () => pitch(eventById(fixture, id)) === expected);
        await undoGesture(gesture);
      }
      return 'The actual C7 and C2 ledger noteheads, both outside the new-note margin, can be grabbed and moved one step to B6 and D2 while retaining their original staff and musical time. Each drop undoes once.';
    },
  },
  {
    name: 'Scaled, translated, and internally scrolled notation uses the full screen transform',
    async run() {
      const fixture = await mount('Fixture-only CSS transforms and real score-content scrolling');
      await applySource(fixture, staffSource('<music-rest id="scaled-rest-1" measure></music-rest>')
        .replace('</music-staff>', '<music-measure id="scaled-bar-2" break-before="line"><music-rest id="scaled-rest-2" measure></music-rest></music-measure>'
          + `<music-measure id="scaled-bar-3" break-before="line">${twoNotes}</music-measure>`
          + '<music-measure id="scaled-bar-4" break-before="line"><music-rest id="scaled-rest-4" measure></music-rest></music-measure></music-staff>'));
      await selectMode(fixture);
      const host = field(fixture, '#score-host');
      const scroller = shadow(fixture).querySelector<HTMLElement>('.score-mount');
      assert(scroller, 'The fixture must use the actual score-content scroll container.');
      host.style.transformOrigin = '0 0'; host.style.transform = 'translate(17px, 11px) scale(0.86)';
      scroller.style.maxHeight = '210px'; scroller.style.overflow = 'auto'; scroller.style.overflowAnchor = 'none';
      await frames(fixture); await settle(fixture);
      const reveal = async (measureId: string) => {
        const context = geometry(fixture, measureId);
        context.svg.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        await frames(fixture); await settle(fixture);
        assert(scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop > 0,
          `The actual score-content container must be scrolled for ${measureId}, not merely the outer document.`);
        const matrix = geometry(fixture, measureId).svg.getScreenCTM();
        assert(matrix && Math.abs(matrix.a - 1) > 0.05 && Math.abs(matrix.d - 1) > 0.05,
          'The actual rendered SVG must expose the fixture scale through its screen transform.');
      };
      await reveal('scaled-bar-3');
      await selectNoteForDrag(fixture, 'first');
      const first = head(fixture, 'first');
      assertNotationTarget(fixture, first, false, 'Transformed pitch drag');
      const repitch = begin(fixture, first); const pitchTarget = head(fixture, 'first', 2).point;
      move(repitch, pitchTarget); await preview(repitch, 'pitch');
      await commit(repitch, pitchTarget, () => pitch(eventById(fixture, 'first')) === 'A#4');
      await undoGesture(repitch);
      choose(fixture, '#measure-select', 'scaled-bar-4'); await frames(fixture); await settle(fixture);
      await enterMode(fixture, 'quarter');
      await reveal('scaled-bar-4');
      const target = staffPoint(fixture, { measureId: 'scaled-bar-4', beforeId: 'scaled-rest-4', steps: 2 });
      assertNotationTarget(fixture, target, true, 'Transformed staff entry after deliberate bar navigation');
      const insertion = begin(fixture, target); await preview(insertion, 'insert');
      await commit(insertion, target.point, () => score(fixture).staves[0].measures[3].voices[0].events[0].kind === 'note');
      const note = score(fixture).staves[0].measures[3].voices[0].events[0];
      equal([pitch(note), note.duration, note.onset], ['G4', 'quarter', { numerator: 0, denominator: 1 }],
        'The transformed pointer must preserve the exact intended staff pitch, duration, and onset');
      await undoGesture(insertion);
      return 'With a 0.86 CSS scale, translation, and nonzero native scrolling inside the score container, public screen transforms still target F#4→A#4 and a new G4 quarter exactly. Each gesture previews without changing Source, commits once, and undoes once.';
    },
  },
  {
    name: 'Pointer entry and pitch editing respect the explicitly selected voice',
    async run() {
      const fixture = await mount('Independent voices remain explicit');
      await applySource(fixture, staffSource('<music-voice id="upper"><music-note id="upper-note" pitch="C5" duration="whole"></music-note></music-voice><music-voice id="lower"><music-rest id="lower-rest" measure></music-rest></music-voice>'));
      const upper = JSON.stringify(eventById(fixture, 'upper-note'));
      choose(fixture, '#event-voice', '1');
      await enterMode(fixture, 'quarter');
      const target = staffPoint(fixture, { voiceId: 'lower', beforeId: 'lower-rest', steps: 1 });
      const insertion = begin(fixture, target); await preview(insertion, 'insert');
      await commit(insertion, target.point, () => score(fixture).staves[0].measures[0].voices[1].events[0].kind === 'note');
      const note = score(fixture).staves[0].measures[0].voices[1].events[0];
      equal(pitch(note), 'F4', 'The inserted pitch belongs to the requested lower voice');
      equal(JSON.stringify(eventById(fixture, 'upper-note')), upper, 'Entry into voice 2 must leave voice 1 untouched');
      await selectMode(fixture);
      choose(fixture, '#event-voice', '0'); await exposeScore(fixture);
      const wrongVoice = begin(fixture, head(fixture, note.id));
      move(wrongVoice, head(fixture, note.id, 2).point); release(wrongVoice, head(fixture, note.id, 2).point);
      await noCommit(wrongVoice, 'Dragging a note outside the active voice');
      choose(fixture, '#event-voice', '1'); await exposeScore(fixture);
      await selectNoteForDrag(fixture, note.id);
      const repitch = begin(fixture, head(fixture, note.id)); const end = head(fixture, note.id, 2).point;
      move(repitch, end); await preview(repitch, 'pitch');
      await commit(repitch, end, () => pitch(eventById(fixture, note.id)) === 'A4');
      equal(JSON.stringify(eventById(fixture, 'upper-note')), upper, 'Repitching voice 2 must still leave voice 1 untouched');
      await undoGesture(repitch); await undoGesture(insertion);
      return 'Voice 2 receives and repitches its own note while voice 1 stays exact. A drag targeting the wrong active voice is refused. Each successful gesture has one independent Undo.';
    },
  },
  {
    name: 'Repitching inside a tuplet preserves its exact duration, grouping, and source order',
    async run() {
      const fixture = await mount('Exact rhythm survives direct pitch editing');
      await applySource(fixture, staffSource('<music-tuplet id="triplet" actual="3" normal="2" bracket="yes"><music-note id="t1" pitch="C5" duration="eighth"></music-note><music-note id="t2" pitch="D5" duration="eighth"></music-note><music-note id="t3" pitch="E5" duration="eighth"></music-note></music-tuplet><music-rest id="tail" duration="half" dots="1"></music-rest>'));
      await selectMode(fixture);
      await selectNoteForDrag(fixture, 't2');
      const before = eventById(fixture, 't2'); const tuplets = JSON.stringify(score(fixture).staves[0].measures[0].voices[0].tuplets);
      const gesture = begin(fixture, head(fixture, 't2')); const end = head(fixture, 't2', 2).point;
      move(gesture, end); await preview(gesture, 'pitch');
      await commit(gesture, end, () => pitch(eventById(fixture, 't2')) === 'F5');
      const after = eventById(fixture, 't2');
      equal([after.duration, after.time, after.onset, after.tupletIds], [before.duration, before.time, before.onset, before.tupletIds], 'The exact tuplet timing and ancestry must remain unchanged');
      equal(JSON.stringify(score(fixture).staves[0].measures[0].voices[0].tuplets), tuplets, 'The authored tuplet object must remain intact');
      equal(events(fixture).map(event => event.id), ['t1', 't2', 't3', 'tail'], 'Pointer pitch editing must not reorder the tuplet or its following rest');
      await undoGesture(gesture);
      return 'D5→F5 preserves the written eighth, exact 1/12 elapsed time, onset, triplet ID, group membership, and source event order. One Undo restores the original tuplet passage.';
    },
  },
  {
    name: 'Write keeps entry drag hidden until Options explicitly prepares one undoable drag-to-staff insertion',
    async run() {
      const fixture = await mount('Deliberate drag-to-staff entry');
      await selectMode(fixture);
      assert(!visible(fixture, field(fixture, '#drag-entry')), 'Select must not expose the entry-only drag tile as an inert or misleading control.');
      const accepted = [source(fixture), revision(fixture), music(fixture)];
      await enterMode(fixture, 'quarter');
      equal([source(fixture), revision(fixture), music(fixture)], accepted, 'Choosing Enter and its recipe must not itself change accepted music or history');
      assert(!visible(fixture, field(fixture, '#drag-entry')), 'Ordinary writing must not expose an unprepared drag handle.');
      await prepareEntryHandle(fixture);
      const target = staffPoint(fixture, { steps: 2 });
      const gesture = begin(fixture, handle(fixture, '#drag-entry'));
      move(gesture, target.point); await preview(gesture, 'insert');
      await commit(gesture, target.point, () => events(fixture).length === 1 && events(fixture)[0].kind === 'note');
      equal([pitch(events(fixture)[0]), events(fixture)[0].duration], ['G4', 'quarter'], 'The tile must use the staff pitch and chosen duration');
      equal([field(fixture, '#select-mode').getAttribute('aria-pressed'), field(fixture, '#toggle-entry').getAttribute('aria-pressed')],
        ['false', 'true'], 'A drag-to-place action and its compatibility click must retain the explicitly chosen Enter mode');
      await undoGesture(gesture);
      return 'Select and ordinary Write keep the drag handle hidden. Preparing it through Options changes no music; its visible handle drops one G4 quarter as one transaction. The compatibility click adds nothing, writing intent is retained, and one Undo restores the original score.';
    },
  },
  {
    name: 'An overflowing drop is rejected before accepted source or history changes',
    async run() {
      const fixture = await mount('A full measure rejects an invalid pointer insertion');
      await applySource(fixture, staffSource('<music-note id="full-note" pitch="C4" duration="whole"></music-note>'));
      await enterMode(fixture, 'whole'); choose(fixture, '#insert-position', 'after'); await exposeScore(fixture);
      const context = geometry(fixture);
      const append = context.system.anchors.find(anchor => anchor.measureId === context.measure.sourceId && anchor.afterId === 'full-note' && !anchor.beforeId);
      assert(append && append.eventIndex === 1, 'The overflow fixture must use the final boundary after its existing whole note.');
      equal(append.onset, { numerator: 1, denominator: 1 }, 'The overflow attempt must occur after the full measure has elapsed');
      const target = staffPoint(fixture, { afterId: 'full-note', steps: 2 });
      const gesture = begin(fixture, target);
      await waitFor(fixture, () => /Voice contains 2 whole notes; this meter allows 1\./i.test(field(fixture, '#pointer-status').textContent ?? '')
        && !!shadow(fixture).querySelector('.pointer-ghost[data-valid="false"]')
        && onScreen(fixture, field(fixture, '#workspace-feedback-label'))
        && /cannot|voice contains|meter allows/i.test(field(fixture, '#workspace-feedback-label').textContent ?? ''),
      'Expose the invalid insertion target');
      unchanged(gesture, 'Invalid pointer preview');
      release(gesture, target.point); await noCommit(gesture, 'An overflowing pointer drop');
      return 'A second whole note cannot be placed into a full 4/4 bar. Invalid feedback is shown while accepted Source, musical events, and undo revision stay unchanged.';
    },
  },
  {
    name: 'Source drafts block staff gestures without losing either version',
    async run() {
      const fixture = await mount('Unapplied source must be resolved before pointer editing');
      await enterMode(fixture);
      const acceptedBlank = music(fixture);
      equal(events(fixture), [], 'The blank fixture starts with an actually empty voice, not a full-measure rest');
      revealControl(fixture, '#source-panel');
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Opening Source retains the chosen writing intent');
      const draft = '<music-staff>unfinished pointer source';
      write(fixture, '#source-input', draft); closePanel(fixture, '#source-panel'); await exposeScore(fixture);
      assert(onScreen(fixture, field(fixture, '#workspace-feedback-label'))
        && /source unapplied.*apply or revert/i.test(field(fixture, '#workspace-feedback-label').textContent ?? ''),
      'The persistent header must explain the pending Source pause after Source closes.');
      const beforeGate = [source(fixture), revision(fixture), music(fixture)];
      click(fixture, '#toggle-entry');
      await frames(fixture);
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Activating already chosen Write only returns focus, even with a Source draft');
      assert(authorActiveElement(fixture.doc) === field(fixture, '#score-editor'), 'Active Write returns actual score focus.');
      assert(field(fixture, '#author-errors').hidden, 'Returning focus through active Write must not fabricate an insertion error.');
      equal([source(fixture), revision(fixture), music(fixture)], beforeGate, 'Active Write changes neither Source buffer nor accepted music');
      field(fixture, '#score-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
      await waitFor(fixture, () => onScreen(fixture, field(fixture, '#workspace-feedback-label'))
        && /source unapplied.*apply or revert/i.test(field(fixture, '#workspace-feedback-label').textContent ?? '')
        && onScreen(fixture, field(fixture, '#workspace-review-trigger'))
        && /review error/i.test(field(fixture, '#workspace-review-trigger').textContent ?? ''),
      'Reject score Enter while keeping a visible Source pause and actionable Review error');
      assert(!field(fixture, '#workspace-review').matches(':popover-open'), 'A rejected score Enter must not force open the detailed Review popover.');
      click(fixture, '#workspace-review-trigger');
      await waitFor(fixture, () => visible(fixture, field(fixture, '#author-errors'))
        && /apply.*revert.*source draft/i.test(field(fixture, '#author-errors').textContent ?? '')
        && visible(fixture, field(fixture, '#source-draft-notice'))
        && /source unapplied.*editing and printing paused/i.test(field(fixture, '#source-draft-notice').textContent ?? ''),
      'One public Review action reveals the full Source correction reason and pause notice');
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'A pending Source draft blocks insertion without discarding writing intent');
      closePanel(fixture, '#workspace-review');
      await waitFor(fixture, () => !field(fixture, '#workspace-review').matches(':popover-open'), 'Close Review before targeting the accepted notation');
      equal([source(fixture), revision(fixture), music(fixture)], beforeGate, 'Rejected Enter and opening/closing Review must retain both the Source buffer and accepted music without history');
      await exposeScore(fixture);
      const target = staffPoint(fixture, { steps: 1 });
      assertNotationTarget(fixture, target, true, 'The blank staff retains Write intent while pending Source gates pointer input');
      const gesture = begin(fixture, target);
      release(gesture, target.point); await noCommit(gesture, 'A gesture over an unapplied source draft');
      equal(source(fixture), draft, 'The recoverable pending source text must not be overwritten by a staff gesture');
      equal(events(fixture), [], 'The accepted empty writing voice must remain intact behind the pending draft');
      equal(music(fixture), acceptedBlank, 'Opening, staging, closing, and rejecting entry must retain the complete accepted blank score');

      const pitched = await mount('Pending Source also rejects a real notehead drag');
      await applySource(pitched, staffSource(twoNotes)); await selectMode(pitched);
      await selectNoteForDrag(pitched, 'first');
      const acceptedNotes = music(pitched);
      revealControl(pitched, '#source-panel');
      write(pitched, '#source-input', draft); closePanel(pitched, '#source-panel'); await exposeScore(pitched);
      const origin = head(pitched, 'first');
      assertNotationTarget(pitched, origin, false, 'Blocked pitch drag with a pending Source draft');
      const blocked = begin(pitched, origin); const attemptedPitch = head(pitched, 'first', 2).point;
      move(blocked, attemptedPitch);
      await waitFor(pitched, () => onScreen(pitched, field(pitched, '#workspace-feedback-label'))
        && /source unapplied.*apply or revert/i.test(field(pitched, '#workspace-feedback-label').textContent ?? ''),
      'The visible header explains why pending Source blocks the notehead drag');
      unchanged(blocked, 'A blocked pitch preview with pending Source');
      release(blocked, attemptedPitch); await noCommit(blocked, 'A blocked pitch drop with pending Source');
      equal(source(pitched), draft, 'The pending Source text must survive the blocked pitch drag exactly');
      equal(music(pitched), acceptedNotes, 'A blocked pitch drag must preserve every accepted note, written value, source identity, and annotation');
      return 'Source retains Write intent; active Write only returns focus, while score Enter and staff gestures are blocked by the pending draft. The header explains the pause and Review reveals its full correction. Empty and pitched fixtures preserve accepted music, history and the exact recoverable Source draft.';
    },
  },
  {
    name: 'Cancellation, context changes, and stale geometry cannot commit a pending pitch',
    async run() {
      const fixture = await mount('Cancel previews without changing the written music');
      const scrollingScore = staffSource(twoNotes).replace('</music-staff>', Array.from({ length: 5 }, (_, index) =>
        `<music-measure id="cancel-bar-${index + 2}" break-before="line"><music-rest id="cancel-rest-${index + 2}" measure></music-rest></music-measure>`).join('') + '</music-staff>');
      await applySource(fixture, scrollingScore); await selectMode(fixture);
      const reasons = ['Escape', 'pointercancel', 'outside', 'lostcapture', 'form', 'scroll', 'resize', 'render', 'view'] as const;
      for (const reason of reasons) {
        if (fixture.doc.body.dataset.view !== 'write') { click(fixture, '#view-write'); await settle(fixture); }
        await selectMode(fixture); await exposeScore(fixture);
        await selectNoteForDrag(fixture, 'first');
        const gesture = begin(fixture, head(fixture, 'first')); const end = head(fixture, 'first', 2).point;
        move(gesture, end); await preview(gesture, 'pitch');
        if (reason === 'Escape') {
          authorActiveElement(fixture.doc)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
        } else if (reason === 'pointercancel') {
          pointer(fixture, gesture.target.element, 'pointercancel', end, gesture.pointerId);
        } else if (reason === 'outside') {
          const outside = { x: -50, y: -50 }; move(gesture, outside); release(gesture, outside); await noCommit(gesture, 'Release outside the score'); continue;
        } else if (reason === 'lostcapture') {
          pointer(fixture, field(fixture, '#score-host'), 'lostpointercapture', end, gesture.pointerId);
        } else if (reason === 'form') {
          choose(fixture, '#event-duration', 'eighth');
        } else if (reason === 'scroll') {
          const viewport = field(fixture, '#score-scroll');
          assert(viewport.scrollHeight > viewport.clientHeight, 'The cancellation fixture must contain genuinely scrollable notation.');
          const before = viewport.scrollTop;
          viewport.scrollBy(0, before > 0 ? -30 : 30);
          await waitFor(fixture, () => viewport.scrollTop !== before, 'Scroll the actual notation viewport');
        } else if (reason === 'resize') {
          const before = fixture.view.innerWidth; fixture.frame.style.width = `${before === 1180 ? 1060 : 1180}px`;
          await waitFor(fixture, () => fixture.view.innerWidth !== before, 'Resize the actual fixture viewport'); await frames(fixture);
        } else if (reason === 'render') {
          await watchdog(surface(fixture).refresh(), 'Regenerate public geometry without changing source');
        } else {
          click(fixture, '#view-read'); await settle(fixture);
        }
        // Deliberately route a late pointerup after cancellation or invalidation.
        pointer(fixture, fixture.doc, 'pointerup', end, gesture.pointerId);
        compatibilityClick(fixture, gesture.target.element, end);
        await noCommit(gesture, `${reason} cancellation`);
      }
      return 'Nine interruption paths—Escape, cancel, outside release, lost capture, form change, real scrolling, viewport resize, refreshed geometry, and Read—discard pending pitch changes and ignore a late pointerup.';
    },
  },
  {
    name: 'Touch movement on music cancels editing while deliberate handles can drag',
    async run() {
      const fixture = await mount('Synthetic touch routing and deliberate touch handles');
      await applySource(fixture, staffSource(twoNotes)); await selectMode(fixture);
      await selectNoteForDrag(fixture, 'first');
      const swipe = begin(fixture, head(fixture, 'first'), 'touch'); const end = head(fixture, 'first', 3).point;
      move(swipe, end); release(swipe, end); await noCommit(swipe, 'A normal touch swipe over a notehead');
      assert(onScreen(fixture, field(fixture, '#workspace-feedback-label'))
        && /scroll|no music changed/i.test(field(fixture, '#workspace-feedback-label').textContent ?? ''),
      'Visible touch feedback explains that scrolling does not edit music.');
      await tap(fixture, head(fixture, 'first'));
      await preparePitchHandle(fixture);
      const deliberate = begin(fixture, handle(fixture, '#drag-pitch'), 'touch'); const changed = head(fixture, 'first', 2).point;
      move(deliberate, changed); await preview(deliberate, 'pitch');
      await commit(deliberate, changed, () => pitch(eventById(fixture, 'first')) === 'A#4');
      await undoGesture(deliberate);
      await tap(fixture, head(fixture, 'first'));
      await preparePitchHandle(fixture);
      const multitouch = begin(fixture, handle(fixture, '#drag-pitch'), 'touch');
      move(multitouch, head(fixture, 'first', 2).point); await preview(multitouch, 'pitch');
      pointer(fixture, field(fixture, '#score-host'), 'pointerdown', end, ++pointerSequence, 'touch', false);
      release(multitouch, end); await noCommit(multitouch, 'A second simultaneous pointer');
      return 'Synthetic touch movement on score ink is routed to cancellation, not pitch editing; an explicit touch handle can commit one pitch, and an additional pointer cancels it. Native touch scrolling and hardware capture are not certified by this test.';
    },
  },
  {
    name: 'Chords, rests, slashes, and tied notes retain explicit control-based editing',
    async run() {
      const fixture = await mount('Unsupported direct-pitch targets remain unchanged');
      const html = staffSource('<music-chord id="chord" pitches="C4 E4 G4" duration="quarter"></music-chord><music-rest id="rest" duration="quarter"></music-rest><music-slash id="slash" duration="quarter"></music-slash><music-note id="plain" pitch="C4" duration="quarter"></music-note>')
        .replace('</music-staff>', '<music-measure id="tied-bar"><music-note id="tie-start" pitch="C4" duration="half" tie="start"></music-note><music-note id="tie-end" pitch="C4" duration="half" tie="end"></music-note></music-measure></music-staff>');
      await applySource(fixture, html); await selectMode(fixture);
      for (const id of ['chord', 'rest', 'slash', 'tie-start']) {
        const target = id === 'rest' || id === 'slash' ? eventInk(fixture, id) : head(fixture, id);
        await tap(fixture, target);
        assert(field<HTMLButtonElement>(fixture, '#drag-pitch').disabled, `${id}: the deliberate pitch handle must be unavailable for this unsupported operation.`);
        assert(/tied|single note|chord|rest|slash|Apply/i.test(field(fixture, '#drag-pitch-help').textContent ?? ''), `${id}: the accessible drag explanation must name the supported editing path.`);
        assert(visible(fixture, field(fixture, '#edit-selected-event')) && !field<HTMLButtonElement>(fixture, '#edit-selected-event').disabled,
          `${id}: the actual More action remains available for explicit Properties editing.`);
        const gesture = begin(fixture, target); const destination = { x: target.point.x, y: target.point.y - 20 };
        move(gesture, destination); release(gesture, destination); await noCommit(gesture, `${id} pitch-drag refusal`);
      }
      return 'All four unsupported direct-pitch targets retain their music and history, disable the pitch handle, and expose ordinary controls or tie-chain instructions instead of silently rewriting notation.';
    },
  },
  {
    name: 'Read and Pages refuse pointer editing and composition undo shortcuts',
    async run() {
      const fixture = await mount('Reading and publishing remain free of editing gestures');
      await applySource(fixture, staffSource(twoNotes));
      assert(!field<HTMLButtonElement>(fixture, '#undo').disabled, 'The fixture must have real authoring history before entering a read-only view.');
      const accepted = source(fixture); const authoredRevision = revision(fixture);
      for (const mode of ['read', 'pages'] as const) {
        click(fixture, `#view-${mode}`); await settle(fixture);
        assert(field<HTMLButtonElement>(fixture, '#undo').disabled && field<HTMLButtonElement>(fixture, '#redo').disabled,
          `${mode}: header history controls must not edit the composition.`);
        let target: Target;
        if (mode === 'read') target = head(fixture, 'first');
        else {
          const element = field(fixture, '#page-host').querySelector<SVGGraphicsElement>('g[data-source-id="first"]');
          assert(element, 'The printed page must contain the actual first note.');
          const bounds = element.getBoundingClientRect(); target = { element, point: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
        }
        const gesture = begin(fixture, target); const end = { x: target.point.x, y: target.point.y - 20 };
        move(gesture, end); release(gesture, end); await noCommit(gesture, `${mode} pointer attempt`);
        const keyboardTarget = mode === 'read' ? field(fixture, '#score-editor') : field(fixture, '#view-pages');
        keyboardTarget.focus();
        for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) keyboardTarget.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', bubbles: true, composed: true, cancelable: true, ...modifiers,
        }));
        await frames(fixture); await settle(fixture);
        equal([source(fixture), revision(fixture)], [accepted, authoredRevision], `${mode}: Command/Control+Z must not edit the accepted composition`);
      }
      click(fixture, '#view-write'); await settle(fixture);
      assert(!field<HTMLButtonElement>(fixture, '#undo').disabled, 'Returning to Write must restore the untouched history controls.');
      return 'Real reading and page projections ignore pointer pitch attempts and Command/Control+Z. Header history actions are disabled there and become available again in Write without consuming history.';
    },
  },
  {
    name: 'An unavailable preview transform rejects the gesture without changing source',
    async run() {
      const fixture = await mount('Unavailable detached preview geometry');
      await applySource(fixture, staffSource(twoNotes)); await selectMode(fixture);
      await selectNoteForDrag(fixture, 'first');
      const content = shadow(fixture).querySelector<HTMLElement>('.pointer-preview-content');
      assert(content, 'The app must expose its actual detached preview container.');
      const own = Object.getOwnPropertyDescriptor(content, 'replaceChildren');
      const replaceChildren = content.replaceChildren;
      // Error injection is confined to the next detached overlay SVG. It does
      // not alter live notation geometry, DOM prototypes, or production state.
      Object.defineProperty(content, 'replaceChildren', { configurable: true, value: (...nodes: (Node | string)[]) => {
        replaceChildren.apply(content, nodes);
        const overlay = content.querySelector<SVGSVGElement>('svg.pointer-geometry');
        if (overlay) Object.defineProperty(overlay, 'getScreenCTM', { configurable: true, value: () => null });
      } });
      try {
        const gesture = begin(fixture, head(fixture, 'first')); const end = head(fixture, 'first', 2).point;
        move(gesture, end);
        await waitFor(fixture, () => onScreen(fixture, field(fixture, '#workspace-feedback-label'))
          && /preview unavailable|not visible/i.test(field(fixture, '#workspace-feedback-label').textContent ?? ''),
        'Explain the injected missing preview transform in the visible header');
        unchanged(gesture, 'An unavailable preview transform');
        release(gesture, end); await noCommit(gesture, 'A drop whose preview cannot be positioned');
      } finally {
        if (own) Object.defineProperty(content, 'replaceChildren', own);
        else Reflect.deleteProperty(content, 'replaceChildren');
      }
      return 'A fixture-local null transform on the detached preview SVG produces explicit feedback and rejects the drop. Accepted notation geometry, Source text, and the undo revision remain unchanged.';
    },
  },
  {
    name: 'Native capture rejection cancels safely, and coalesced release needs no capture shim',
    async run() {
      const fixture = await mount('Unmodified native capture failure and coalesced pointerup', false);
      await applySource(fixture, staffSource(twoNotes)); await selectMode(fixture);
      await selectNoteForDrag(fixture, 'first');
      const rejected = begin(fixture, head(fixture, 'first')); const destination = head(fixture, 'first', 2).point;
      move(rejected, destination); release(rejected, destination); await noCommit(rejected, 'Native capture rejection for an unregistered synthetic pointer');
      assert(!field(fixture, '#author-errors').hidden && /capture|pointer/i.test(field(fixture, '#author-errors').textContent ?? ''),
        'The unshimmed browser retains the full native pointer-capture rejection for Review.');
      assert(onScreen(fixture, field(fixture, '#workspace-feedback-label'))
        && field(fixture, '#workspace-feedback-label').dataset.feedbackKind === 'error'
        && onScreen(fixture, field(fixture, '#workspace-review-trigger'))
        && /review error/i.test(field(fixture, '#workspace-review-trigger').textContent ?? ''),
      'The persistent header must visibly report the capture failure and offer Review without forcing its details open.');
      await exposeScore(fixture);
      const coalesced = begin(fixture, head(fixture, 'first'));
      unchanged(coalesced, 'A coalesced drag before pointerup');
      await commit(coalesced, head(fixture, 'first', 2).point, () => pitch(eventById(fixture, 'first')) === 'A#4');
      assert(field(fixture, '#author-errors').hidden, 'A later successful staff gesture must clear the prior capture error without requiring another control action.');
      await undoGesture(coalesced);
      return 'With native capture untouched, a synthetic moved pointer is rejected without editing. A later coalesced pointerup commits and undoes once without capture and clears the stale error. Neither path claims trusted hardware input.';
    },
  },
];

function visualReport(value: unknown): void {
  let output = document.querySelector<HTMLScriptElement>('#visual-preview-result');
  if (!output) { output = document.createElement('script'); output.id = 'visual-preview-result'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify(value, null, 2);
}
async function showVisualPreview(width: 1180 | 390): Promise<void> {
  if (busy) return;
  setBusy(true); clearVisual();
  const label = width === 1180 ? 'Desktop' : 'Phone';
  visualStatus.dataset.state = 'running';
  visualStatus.textContent = `Preparing the ${label.toLowerCase()} synthetic hover preview on the actual Author route…`;
  visualReport({ state: 'running', scenario: 'synthetichover', width });
  let fixture: Fixture | undefined;
  try {
    fixture = await mount(`${label} synthetic hover preview · ${width} × 660`, false,
      { width, height: 660, container: visualFixtures });
    const caption = visualFixtures.querySelector<HTMLElement>('.fixture-note')!;
    const open = caption.querySelector('a')!;
    caption.replaceChildren(`${label} synthetic hover fixture: F#4 quarter at bar 13 of 16. Native capture stays untouched; no pointerdown or source edit is sent. `, open);
    const laterMeasures = Array.from({ length: 15 }, (_, index) => {
      const number = index + 2;
      return `<music-measure id="visual-bar-${number}"${number % 2 === 1 ? ' break-before="line"' : ''}><music-rest id="visual-rest-${number}" measure></music-rest></music-measure>`;
    }).join('');
    await applySource(fixture, staffSource('<music-rest id="visual-rest-1" measure></music-rest>')
      .replace('</music-staff>', `${laterMeasures}</music-staff>`));
    await enterMode(fixture, 'quarter'); write(fixture, '#event-pitch', 'F#4');
    // This actual selector invokes Author's own scroll-to-selection path.
    choose(fixture, '#measure-select', 'visual-bar-13'); await frames(fixture); await settle(fixture);
    // Location navigation inspects the chosen bar; it does not repoint fixed
    // Write's remembered destination. Deliberately start at this selected bar.
    enterAtSelection(fixture); await exposeScore(fixture);
    const palette = field(fixture, '#workspace-dock');
    const expectedPaletteHeight = field(fixture, '.app-header').getBoundingClientRect().height;
    assert(Math.abs(palette.getBoundingClientRect().height - expectedPaletteHeight) <= 1,
      'The phone and desktop palettes must match the corresponding header height, allowing one rounding pixel.');
    assert(!visible(fixture, field(fixture, '#drag-entry')), 'The visual fixture must explicitly prepare its handle, not assume Write exposes it.');
    await prepareEntryHandle(fixture);
    const layout = surface(fixture).getLayoutGeometry();
    assert(layout && layout.systems.length >= 8, 'The visual fixture must form a long score with at least eight actual systems.');
    equal(score(fixture).staves[0].measures.length, 16, 'The scroll fixture contains exactly sixteen explicitly authored rest bars');
    assert(events(fixture).length === 16 && events(fixture).every(event => event.kind === 'rest' && event.measureRest),
      'Every visual-fixture bar must contain its explicit full-measure rest, with no hidden inserted notes.');
    equal(field<HTMLSelectElement>(fixture, '#measure-select').value, 'visual-bar-13', 'The visual fixture must navigate to bar 13 through the actual selector');
    equal(field<HTMLInputElement>(fixture, '#event-pitch').value, 'F#4', 'The explicit sharp spelling must remain selected for the visual preview');
    const scoreViewport = field(fixture, '#score-scroll');
    // Complete parent and iframe scrolling/focus before sending the hover.
    // A hover has no active drag or capture for later browser focus to cancel.
    fixture.frame.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await frames(fixture); await settle(fixture);
    const paletteBounds = palette.getBoundingClientRect();
    const scoreBounds = scoreViewport.getBoundingClientRect();
    const target = staffPoint(fixture, { measureId: 'visual-bar-13', beforeId: 'visual-rest-13', steps: 1 });
    const tile = handle(fixture, '#drag-entry'); const tileBounds = tile.element.getBoundingClientRect();
    assert(scoreViewport.scrollTop > 0 && !scoreViewport.contains(palette),
      'The later system must be reached through the actual notation viewport without scrolling away its controls.');
    assert(paletteBounds.top >= -1 && paletteBounds.bottom <= fixture.view.innerHeight + 1
      && tileBounds.top >= 0 && tileBounds.bottom <= fixture.view.innerHeight + 1
      && tileBounds.width >= 43.5 && tileBounds.height >= 43.5 && Math.abs(paletteBounds.height - expectedPaletteHeight) <= 1,
    'The bottom palette and deliberately prepared 44px handle must fit the actual viewport while retaining the shared header height.');
    assert(scoreBounds.bottom <= paletteBounds.top + 1 && target.point.x > 0 && target.point.x < fixture.view.innerWidth
      && target.point.y > scoreBounds.top && target.point.y < Math.min(scoreBounds.bottom, fixture.view.innerHeight),
      'Author navigation must keep the later staff inside the reserved score region above the bottom palette, with no overlap.');
    assert(fixture.doc.documentElement.scrollWidth <= fixture.view.innerWidth + 1 && fixture.doc.body.scrollWidth <= fixture.view.innerWidth + 1,
      'The visual fixture must fit its actual phone or desktop width without document overflow.');
    const hover: Gesture = { fixture, target, pointerId: ++pointerSequence, pointerType: 'mouse',
      source: source(fixture), revision: revision(fixture), music: music(fixture) };
    visualHover = { fixture, target, pointerId: hover.pointerId };
    pointer(fixture, target.element, 'pointermove', target.point, hover.pointerId, 'mouse', true, 0);
    await frames(fixture);
    await waitFor(fixture, () => {
      const ghost = shadow(hover.fixture).querySelector('.pointer-ghost[data-valid="true"]');
      return !hover.fixture.doc.body.dataset.pointerGesture && !!ghost?.querySelector('svg') && visible(hover.fixture, ghost);
    }, 'Keep the actual Enter-notes hover ghost visible after a frame');
    unchanged(hover, 'The synthetic Enter-notes hover preview');
    const layer = shadow(fixture).querySelector<HTMLElement>('.pointer-preview')!;
    equal(layer.getAttribute('aria-hidden'), 'true', 'The hover preview must remain outside the accepted accessible score');
    equal(fixture.view.getComputedStyle(layer).pointerEvents, 'none', 'The hover ghost must not intercept its staff target');
    const feedback = previewFeedback(fixture, 'F#4');
    assert(!field(fixture, '#score-host').hasPointerCapture(hover.pointerId), 'A hover must not acquire native pointer capture.');
    visualStatus.dataset.state = 'ready';
    visualStatus.textContent = `${label} synthetic hover preview ready at ${width} × 660. Bar 13 and the prepared bottom-palette handle are visible; F#4 is a transient ghost and all sixteen accepted measures remain full rests. Only pointermove with buttons=0 was sent: no pointerdown, drag capture, or edit.`;
    visualReport({ state: 'ready', scenario: 'synthetichover', workspace: fixture.workspace, url: fixture.frame.src, width, height: 660,
      selectedMeasure: 'visual-bar-13', measures: 16, systems: layout.systems.length, sourceUnchanged: true, revision: revision(fixture),
      syntheticCapture: false, pointerDown: false, buttons: 0, committed: false, target: target.point, tile: tile.point,
      localLabelVisible: feedback.localLabelVisible, headerPitchVisible: feedback.headerPitchVisible, checkedInkSystems: feedback.checkedInkSystems,
      viewport: { scrollY: fixture.view.scrollY, scoreScrollTop: scoreViewport.scrollTop, score: boundsOf(scoreViewport), palette: boundsOf(palette), host: boundsOf(field(fixture, '#score-host')) },
      pointerStatus: field(fixture, '#pointer-status').textContent, headerFeedback: field(fixture, '#workspace-feedback-label').textContent });
  } catch (error) {
    const detail = `${error instanceof Error ? error.message : String(error)}${fixture ? `\nActual fixture diagnostics:\n${diagnostic(fixture)}` : ''}`;
    visualStatus.dataset.state = 'failed'; visualStatus.textContent = detail;
    visualReport({ state: 'failed', scenario: 'synthetichover', width, detail });
    if (visualHover) {
      pointer(visualHover.fixture, field(visualHover.fixture, '#score-host'), 'pointerleave', visualHover.target.point, visualHover.pointerId, 'mouse', true, 0);
      visualHover = undefined;
    }
  } finally { setBusy(false); }
}

async function run(): Promise<void> {
  if (busy) return;
  setBusy(true); clearVisual(); fixtures.replaceChildren();
  visualStatus.dataset.state = 'idle'; visualStatus.textContent = 'Visual controls are disabled while the regression checks are running.';
  for (const key of ownedKeys) localStorage.removeItem(key);
  ownedKeys.clear(); results.replaceChildren(); sequence = 0; previewCount = 0; committedGestures = 0;
  token = crypto.randomUUID();
  summary.dataset.state = 'running';
  environment.textContent = `${navigator.userAgent}. Synthetic routing through actual SVG geometry; capture bookkeeping is shimmed only on disposable fixture targets except the explicit native-rejection/coalesced-up case. No production globals.`;
  const report: Result[] = [];
  for (const [index, entry] of tests.entries()) {
    summary.textContent = `Running ${index + 1}/${tests.length}: ${entry.name}`;
    const item = document.createElement('li'); item.dataset.state = 'running';
    const name = document.createElement('strong'); name.textContent = `Running: ${entry.name}`; item.append(name); results.append(item);
    try {
      const detail = await entry.run(); item.dataset.state = 'passed'; name.textContent = `PASS — ${entry.name}`;
      const explanation = document.createElement('div'); explanation.textContent = detail; item.append(explanation);
      report.push({ name: entry.name, passed: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error); item.dataset.state = 'failed'; name.textContent = `FAIL — ${entry.name}`;
      const explanation = document.createElement('pre'); explanation.textContent = detail; item.append(explanation);
      report.push({ name: entry.name, passed: false, detail });
    }
  }
  const passed = report.filter(result => result.passed).length; const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed';
  summary.textContent = `${passed}/${tests.length} staff interaction checks passed${failed ? `; ${failed} failed` : ''}. ${previewCount} detached previews and ${committedGestures} single-transaction gestures inspected. Trusted pointer capture, native touch scrolling and hardware input still require manual qualification.`;
  let output = document.querySelector<HTMLScriptElement>('#pointer-browser-results');
  if (!output) { output = document.createElement('script'); output.id = 'pointer-browser-results'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, previews: previewCount, committedGestures, results: report }, null, 2);
  visualStatus.textContent = 'Choose a desktop or phone viewport to inspect the synthetic preview.';
  setBusy(false);
}
button.addEventListener('click', () => { void run(); });
document.querySelector('#show-desktop-preview')!.addEventListener('click', () => { void showVisualPreview(1180); });
document.querySelector('#show-phone-preview')!.addEventListener('click', () => { void showVisualPreview(390); });
