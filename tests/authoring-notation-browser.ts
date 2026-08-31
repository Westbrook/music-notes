import type { MusicSurface } from '../src/components/index.js';
import { readScore } from '../src/dom/index.js';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, harmonyIntervalText, parseHarmonyInterval, pitchText } from '../src/model/index.js';
import type { ArticulationType, EventMarking, MusicEvent, OrnamentType, PitchAlteration, PitchDirection, Score, StaffNotation } from '../src/model/types.js';
import type { AuthorProject } from '../src/authoring/types.js';
import type { TemplateId } from '../src/authoring/templates.js';
import type { SystemGeometry } from '../src/engraving/render.js';
import { authorActiveElement, authorControlParent, findAuthorControl, queryAuthorControl } from './author-fixture.js';

interface Action { kind: 'click' | 'choice' | 'text' | 'key' | 'scroll' | 'file'; target: string; value?: string }
interface Download { name: string; blob: Blob; type: string }
interface Fixture { frame: HTMLIFrameElement; doc: Document; view: Window; workspace: string; actions: Action[]; confirmations: string[]; confirmReply: boolean | null; downloads: Download[]; boundaryErrors: string[]; prints: number; commits: number; sourceSetups: number }
interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Snapshot { source: string; music: string; revision: number; cursor: object; recipe: object; undo: boolean; redo: boolean }
interface Outcome { detail: string; metrics?: Record<string, unknown> }
interface Test { gate: string; name: string; run: () => Promise<Outcome> }
interface Result extends Outcome { gate: string; name: string; passed: boolean }
interface Geometry { system: SystemGeometry; svg: SVGSVGElement }
interface Mixed { fixture: Fixture; pitched: string; rhythm: string; roads: string; firstNote: string; tieStart: string; tieEnd: string; accent: string; ornament: string; intervals: string[]; parts: Record<string, string>; instructions: string[] }

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const resultList = document.querySelector<HTMLOListElement>('#results')!;
const fixtureList = document.querySelector<HTMLElement>('#fixtures')!;
const visualList = document.querySelector<HTMLElement>('#visual-fixtures')!;
const visualStatus = document.querySelector<HTMLElement>('#visual-status')!;
const visualButtons = [...document.querySelectorAll<HTMLButtonElement>('.visual-controls button')];
const tests: Test[] = [];
const ownedKeys = new Set<string>();
const fixtures = new Map<string, Fixture>();
const panels = { edit: 'selection-inspector', rhythm: 'passage-inspector', markings: 'annotation-inspector', measure: 'measure-inspector' } as const;
const alterations: Record<PitchAlteration, string> = { '-2': 'bb', '-1.5': 'tqf', '-1': 'b', '-0.5': 'qf', '0': '', '0.5': 'qs', '1': '#', '1.5': 'tqs', '2': '##' };
const directions: Record<PitchDirection, string> = { higher: 'Higher', same: 'Same', lower: 'Lower' };
const staffKinds: Record<StaffNotation, readonly string[]> = { pitched: ['note', 'chord', 'rest', 'rhythmic-slash', 'slash'], rhythm: ['rhythm', 'rest', 'rhythmic-slash', 'slash'], 'three-roads': ['road', 'rest'] };
const ordinaryAccidentals: Record<string, string> = { '-2': '#note-double-flat', '-1': '#note-flat', '0': '#note-natural', '1': '#note-sharp', '2': '#note-double-sharp' };
let runId = crypto.randomUUID(); let sequence = 0; let busy = false; let latest: Fixture | undefined;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`); }
function field<T extends HTMLElement = HTMLElement>(f: Fixture, selector: string): T { const element = queryAuthorControl<T>(f.doc, selector); assert(element, `Missing actual Author control ${selector}.`); return element; }
function closestControl(element: HTMLElement, selector: string): HTMLElement | null {
  for (let current: HTMLElement | null = element; current; current = authorControlParent(current)) if (current.matches(selector)) return current;
  return null;
}
function value(f: Fixture, selector: string): string { return field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(f, selector).value; }
function visible(f: Fixture, element: Element): boolean { const css = f.view.getComputedStyle(element); return !!element.getClientRects().length && css.display !== 'none' && css.visibility !== 'hidden'; }
function box(element: Element): Box { const { left, top, right, bottom, width, height } = element.getBoundingClientRect(); return { left, top, right, bottom, width, height }; }
function inside(a: Box, b: Box, tolerance = 0.75): boolean { return a.left >= b.left - tolerance && a.top >= b.top - tolerance && a.right <= b.right + tolerance && a.bottom <= b.bottom + tolerance; }
function overlaps(a: Box, b: Box): boolean { return a.left < b.right - 0.25 && a.right > b.left + 0.25 && a.top < b.bottom - 0.25 && a.bottom > b.top + 0.25; }
function viewport(f: Fixture): Box { return { left: 0, top: 0, right: f.view.innerWidth, bottom: f.view.innerHeight, width: f.view.innerWidth, height: f.view.innerHeight }; }
function clickElement(f: Fixture, element: HTMLElement, label = element.id ? `#${element.id}` : element.getAttribute('aria-label') ?? element.textContent ?? element.localName): void {
  assert(visible(f, element) && (!('disabled' in element) || !element.disabled), `${label} must be visible and enabled before use.`); f.actions.push({ kind: 'click', target: label }); element.focus(); element.click();
}
function click(f: Fixture, selector: string): void { clickElement(f, field(f, selector), selector); }
function dispatch(f: Fixture, element: HTMLElement, name: string): void { const event = f.doc.createEvent('Event'); event.initEvent(name, true, false); element.dispatchEvent(event); }
function chooseElement(f: Fixture, control: HTMLSelectElement, choice: string): void {
  assert(visible(f, control) && !control.disabled, `${control.id} must be an available native select.`);
  assert([...control.options].some(option => option.value === choice && !option.disabled), `${control.id} must offer the enabled choice ${JSON.stringify(choice)}.`);
  f.actions.push({ kind: 'choice', target: `#${control.id}`, value: choice }); control.focus(); control.value = choice; dispatch(f, control, 'input'); dispatch(f, control, 'change');
}
function choose(f: Fixture, selector: string, choice: string): void { chooseElement(f, field<HTMLSelectElement>(f, selector), choice); }
function writeElement(f: Fixture, control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  assert(visible(f, control) && !control.disabled, `${control.id} must be available for typing.`); f.actions.push({ kind: 'text', target: `#${control.id}`, value: control.id === 'source-input' ? '(supplemental Source edit)' : text });
  control.focus(); control.value = text; dispatch(f, control, 'input'); dispatch(f, control, 'change');
}
function write(f: Fixture, selector: string, text: string): void { writeElement(f, field<HTMLInputElement | HTMLTextAreaElement>(f, selector), text); }
function check(f: Fixture, selector: string, checked: boolean): void { const control = field<HTMLInputElement>(f, selector); if (control.checked !== checked) click(f, selector); equal(control.checked, checked, `${selector} retains its explicit checkbox state`); }
function key(f: Fixture, target: HTMLElement, name: string, options: KeyboardEventInit = {}): void { target.focus({ preventScroll: true }); f.actions.push({ kind: 'key', target: `#${target.id}`, value: `${options.ctrlKey ? 'Control+' : ''}${options.shiftKey ? 'Shift+' : ''}${name}` }); target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true, ...options })); }
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: did not complete within 20 seconds.`)), 20_000); })]); } finally { clearTimeout(timer); } }
async function frames(f: Fixture): Promise<void> { await bounded(new Promise<void>(resolve => f.view.requestAnimationFrame(() => f.view.requestAnimationFrame(() => resolve()))), 'Observe actual layout'); }
async function waitFor(f: Fixture, condition: () => boolean, label: string): Promise<void> {
  let observer: MutationObserver | undefined; let animation = 0;
  try { await bounded(new Promise<void>((resolve, reject) => { const inspect = () => { try { if (condition()) resolve(); } catch (error) { reject(error); } }; const tick = () => { inspect(); animation = f.view.requestAnimationFrame(tick); }; observer = new MutationObserver(inspect); observer.observe(f.doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); animation = f.view.requestAnimationFrame(tick); inspect(); }), label); }
  finally { observer?.disconnect(); f.view.cancelAnimationFrame(animation); }
}
function surface(f: Fixture): MusicSurface { const root = field(f, '#score-host').shadowRoot?.querySelector<MusicSurface>('music-system,music-staff'); assert(root?.score && root.renderComplete, 'The actual Author projection must expose its public notation model.'); return root; }
function score(f: Fixture): Score { return surface(f).score!; }
function events(f: Fixture): MusicEvent[] { return score(f).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events]))); }
function event(f: Fixture, id: string): MusicEvent { const found = events(f).find(event => event.id === id); assert(found, `Missing visible source event ${id}.`); return found; }
function marks(f: Fixture): EventMarking[] { return events(f).flatMap(event => [...event.markings ?? []]); }
function source(f: Fixture): string { return value(f, '#source-input'); }
function revision(f: Fixture): number { return Number(f.doc.body.dataset.authorRevision); }
function sourceElement(f: Fixture, html = source(f)): Element { const template = f.doc.createElement('template'); template.innerHTML = html; assert(template.content.children.length === 1, 'A musical source needs one root.'); return template.content.firstElementChild!; }
function canonical(f: Fixture, html: string): string { const template = f.doc.createElement('template'); template.innerHTML = html; assert(template.content.children.length === 1, 'Canonical source needs one musical root.'); for (const element of template.content.querySelectorAll('*')) { const attrs = [...element.attributes].map(item => [item.name, item.value] as const).sort(([a], [b]) => a.localeCompare(b)); for (const attr of [...element.attributes]) element.removeAttribute(attr.name); for (const [name, value] of attrs) element.setAttribute(name, value); } return template.innerHTML; }
function explicitVoiceIds(f: Fixture): Set<string> { return new Set([...sourceElement(f).querySelectorAll('music-voice[id]')].map(element => element.id)); }
function meaning(model: Score, stableVoices: ReadonlySet<string>): string { return JSON.stringify(model.staves.map(staff => ({ ...staff, notation: staff.notation ?? 'pitched', measures: staff.measures.map(measure => ({ ...measure, voices: measure.voices.map((voice, index) => ({ ...voice, id: stableVoices.has(voice.id) ? voice.id : { implicitOf: measure.id, index } })) })) }))); }
function music(f: Fixture): string { return meaning(score(f), explicitVoiceIds(f)); }
function cursor(f: Fixture): object { return { staff: value(f, '#staff-select'), measure: value(f, '#measure-select'), voice: value(f, '#event-voice'), event: queryAuthorControl<HTMLElement>(f.doc, '#event-navigator [data-source-id][aria-pressed="true"]')?.dataset.sourceId ?? null }; }
function recipe(f: Fixture): object { return { ...Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration', 'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, value(f, `#${id}`)])), measureRest: field<HTMLInputElement>(f, '#event-measure-rest').checked, rhythmic: field<HTMLInputElement>(f, '#event-rhythmic').checked }; }
function snapshot(f: Fixture): Snapshot { return { source: source(f), music: music(f), revision: revision(f), cursor: cursor(f), recipe: recipe(f), undo: !field<HTMLButtonElement>(f, '#undo').disabled, redo: !field<HTMLButtonElement>(f, '#redo').disabled }; }
function unchanged(f: Fixture, before: Snapshot, label: string, selection = true): void { equal(source(f), before.source, `${label}: Source stays unchanged`); equal(music(f), before.music, `${label}: canonical music and real child IDs stay unchanged`); equal(revision(f), before.revision, `${label}: no authored revision`); equal([!field<HTMLButtonElement>(f, '#undo').disabled, !field<HTMLButtonElement>(f, '#redo').disabled], [before.undo, before.redo], `${label}: preserve Undo/Redo`); if (selection) equal(cursor(f), before.cursor, `${label}: preserve source cursor`); }
async function settle(f: Fixture): Promise<void> { await waitFor(f, () => f.doc.body.dataset.authorReady === 'true' && f.doc.body.dataset.renderState !== 'rendering', 'Finish Author rendering'); assert(f.doc.body.dataset.renderState === 'ready', `Author rendering failed: ${field(f, '#author-errors').textContent}`); await bounded(f.doc.fonts.ready, 'Load notation fonts'); await bounded(surface(f).renderComplete, 'Complete public notation rendering'); const errors = surface(f).diagnostics.filter(item => item.severity === 'error'); assert(!errors.length, `Accepted notation errors: ${errors.map(item => item.message).join(' ')}`); }
async function mutate(f: Fixture, action: () => void, accepted: () => boolean, label: string): Promise<Snapshot> { const before = snapshot(f); action(); await waitFor(f, () => revision(f) === before.revision + 1 && f.doc.body.dataset.renderState === 'ready' && accepted(), label); await settle(f); f.commits++; return before; }
async function history(f: Fixture, before: Snapshot, redo = false): Promise<void> { const prior = revision(f); key(f, field(f, '#score-editor'), 'z', { ctrlKey: true, shiftKey: redo }); await waitFor(f, () => revision(f) === prior + 1 && f.doc.body.dataset.renderState === 'ready' && canonical(f, source(f)) === canonical(f, before.source), `${redo ? 'Redo' : 'Undo'} exactly one accepted transaction`); await settle(f); equal(music(f), before.music, 'History restores exact musical state and child identities'); equal(cursor(f), before.cursor, 'History restores the complete source cursor'); }
async function popup(f: Fixture, trigger: string, panel: string, open = true): Promise<void> { const element = field(f, panel); equal(element.getAttribute('popover'), 'auto', `${panel} uses a native auto popover`); if (element.matches(':popover-open') === open) return; if (open) click(f, trigger); else { const close = element.querySelector<HTMLButtonElement>(`button[popovertarget="${element.id}"][popovertargetaction="hide"]`); assert(close, `${panel} needs a close invoker.`); clickElement(f, close); } await waitFor(f, () => element.matches(':popover-open') === open, `${open ? 'Open' : 'Close'} ${panel}`); await frames(f); }
async function closePopovers(f: Fixture): Promise<void> { for (const panel of f.doc.querySelectorAll<HTMLElement>('[popover]:popover-open')) { if (!panel.matches(':popover-open')) continue; const close = panel.querySelector<HTMLButtonElement>(`button[popovertarget="${panel.id}"][popovertargetaction="hide"]`); assert(close, `${panel.id} needs its actual Close button.`); clickElement(f, close); } await frames(f); }
async function tools(f: Fixture, open: boolean): Promise<void> { if (visible(f, field(f, '#workspace-tools')) !== open) click(f, open ? '#tools-toggle' : '#tools-hide'); await frames(f); await settle(f); equal(visible(f, field(f, '#workspace-tools')), open, 'Tools keep their requested visibility'); }
async function tab(f: Fixture, name: keyof typeof panels): Promise<void> { await tools(f, true); click(f, `#tool-tab-${name}`); await waitFor(f, () => field(f, `#tool-tab-${name}`).getAttribute('aria-selected') === 'true' && visible(f, field(f, `#${panels[name]}`)), `Open ${name} tools`); await frames(f); await settle(f); }
async function inlineDetails(f: Fixture, element: HTMLElement): Promise<void> { const chain: HTMLDetailsElement[] = []; for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) if (parent.localName === 'details') chain.unshift(parent as HTMLDetailsElement); for (const details of chain) if (!details.open) { const summary = details.querySelector<HTMLElement>(':scope > summary'); assert(summary, 'An inline detail needs a summary.'); clickElement(f, summary); } await frames(f); }
async function expose(f: Fixture, selector: string): Promise<void> { const element = field(f, selector); const pane = closestControl(element, '[role="tabpanel"]'); if (pane) { const name = (Object.keys(panels) as (keyof typeof panels)[]).find(name => panels[name] === pane.id); if (name) await tab(f, name); } const panel = closestControl(element, '[popover]'); if (panel && !panel.matches(':popover-open')) { const trigger = f.doc.querySelector<HTMLButtonElement>(`button[popovertarget="${panel.id}"]:not([popovertargetaction="hide"])`); assert(trigger?.id, `${panel.id} needs a visible invoker.`); if (closestControl(trigger, '[popover]')) await expose(f, `#${trigger.id}`); await popup(f, `#${trigger.id}`, `#${panel.id}`); } await inlineDetails(f, element); }
async function location(f: Fixture, staffId: string, measureId: string, voice = '0'): Promise<void> { await popup(f, '#location-trigger', '#location-panel'); choose(f, '#staff-select', staffId); choose(f, '#measure-select', measureId); choose(f, '#event-voice', voice); await closePopovers(f); await settle(f); }
async function choosePart(f: Fixture, id: string): Promise<void> { await popup(f, '#location-trigger', '#location-panel'); choose(f, '#part-select', id); await closePopovers(f); await settle(f); }
async function enter(f: Fixture, here = false): Promise<void> { await tools(f, false); if (here || !visible(f, field(f, '#toggle-entry'))) { await popup(f, '#location-trigger', '#location-panel'); click(f, '#start-entry-here'); } else if (field(f, '#toggle-entry').getAttribute('aria-pressed') !== 'true') click(f, '#toggle-entry'); await frames(f); await settle(f); }
async function configure(f: Fixture, options: { kind?: string; pitch?: string; pitches?: string; alter?: PitchAlteration; direction?: PitchDirection; duration?: string; dots?: string; position?: string; continuation?: boolean } = {}): Promise<void> {
  await enter(f); if (options.kind) choose(f, '#event-kind', options.kind); if (options.duration) choose(f, '#event-duration', options.duration); if (options.direction) choose(f, '#event-direction', options.direction);
  await popup(f, '#entry-settings-trigger', '#entry-settings'); if (options.pitch !== undefined) write(f, '#event-pitch', options.pitch); if (options.pitches !== undefined) write(f, '#event-pitches', options.pitches); if (options.alter !== undefined) choose(f, '#event-alteration', String(options.alter)); if (options.dots !== undefined) choose(f, '#event-dots', options.dots); if (options.position) choose(f, '#insert-position', options.position); if (options.continuation !== undefined) check(f, '#continuation-enabled', options.continuation); await closePopovers(f);
}
async function insert(f: Fixture, keyboard = false): Promise<string> { const beforeIds = new Set(events(f).map(event => event.id)); const before = await mutate(f, () => keyboard ? key(f, field(f, '#score-editor'), 'Enter') : click(f, '#insert-event'), () => true, 'Insert the current recipe through the actual Author action'); const selected = (cursor(f) as { event: string | null }).event; assert(selected && events(f).some(event => event.id === selected), 'Insertion must select its actual written event.'); assert(!beforeIds.has(selected) || source(f) !== before.source, 'Replacing a placeholder must actually change its accepted event.'); return selected; }
async function addMeasure(f: Fixture): Promise<string> { const count = score(f).staves[0].measures.length; await popup(f, '#location-trigger', '#location-panel'); await mutate(f, () => click(f, '#add-measure'), () => score(f).staves.every(staff => staff.measures.length === count + 1), 'Add one aligned measure using the visible action'); await closePopovers(f); return value(f, '#measure-select'); }
function geometry(f: Fixture, id: string): Geometry { const root = surface(f); const layout = root.getLayoutGeometry(); assert(layout && layout.revision === root.renderRevision, 'Require current public layout geometry.'); const system = layout.systems.find(system => [...system.events, ...(system.markings ?? []), ...system.measures, ...system.annotations, ...system.staves].some(item => item.sourceId === id)); assert(system, `No current geometry for ${id}.`); const svg = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)[system.index]; assert(svg, 'Public geometry must map to its actual SVG.'); return { system, svg }; }
function screenBox(svg: SVGSVGElement, ink: { x: number; y: number; width: number; height: number }): Box { const matrix = svg.getScreenCTM(); assert(matrix, 'The actual SVG needs a complete screen transform.'); const points = [[ink.x, ink.y], [ink.x + ink.width, ink.y], [ink.x, ink.y + ink.height], [ink.x + ink.width, ink.y + ink.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix)); const left = Math.min(...points.map(point => point.x)); const right = Math.max(...points.map(point => point.x)); const top = Math.min(...points.map(point => point.y)); const bottom = Math.max(...points.map(point => point.y)); return { left, right, top, bottom, width: right - left, height: bottom - top }; }
function sourceBox(f: Fixture, id: string): Box { const { system, svg } = geometry(f, id); const item = system.events.find(event => event.sourceId === id)?.ink ?? [...(system.markings ?? []), ...system.annotations, ...system.measures].find(item => item.sourceId === id); assert(item, `No actual ink for ${id}.`); return screenBox(svg, item); }
function scoreClip(f: Fixture): Box { const scroller = field(f, '#score-scroll'); const bounds = box(scroller); const left = Math.max(0, bounds.left + scroller.clientLeft); const right = Math.min(f.view.innerWidth, bounds.left + scroller.clientLeft + scroller.clientWidth); const top = Math.max(0, bounds.top + scroller.clientTop); const bottom = Math.min(f.view.innerHeight, bounds.top + scroller.clientTop + scroller.clientHeight); return { left, right, top, bottom, width: right - left, height: bottom - top }; }
async function reveal(f: Fixture, id: string): Promise<void> { const scroller = field(f, '#score-scroll'); const ink = sourceBox(f, id); const clip = scoreClip(f); scroller.scrollTop += ink.top - clip.top - (clip.height - ink.height) / 2; const { svg } = geometry(f, id); const row = svg.closest<HTMLElement>('.system-row'); if (row && row.scrollWidth > row.clientWidth) { const now = sourceBox(f, id); const bounds = box(row); if (now.left < bounds.left) row.scrollLeft += now.left - bounds.left - 6; else if (now.right > bounds.right) row.scrollLeft += now.right - bounds.right + 6; } await frames(f); await settle(f); }
async function select(f: Fixture, id: string): Promise<void> { if (f.doc.body.dataset.view !== 'write') { click(f, '#view-write'); await settle(f); } if (field(f, '#toggle-entry').getAttribute('aria-pressed') === 'true') click(f, '#select-mode'); await reveal(f, id); const { svg } = geometry(f, id); const group = [...svg.querySelectorAll<SVGGraphicsElement>('[data-source-id]')].find(group => group.dataset.sourceId === id); assert(group, `Missing selectable rendered source ${id}.`); const ink = sourceBox(f, id); const clip = scoreClip(f); assert((ink.left + ink.right) / 2 >= clip.left && (ink.left + ink.right) / 2 <= clip.right && (ink.top + ink.bottom) / 2 >= clip.top && (ink.top + ink.bottom) / 2 <= clip.bottom, `The actual click target ${id} must be visible inside the notation viewport.`); f.actions.push({ kind: 'click', target: `[data-source-id="${id}"]` }); group.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1, clientX: (ink.left + ink.right) / 2, clientY: (ink.top + ink.bottom) / 2, view: f.view })); await frames(f); await settle(f); }
async function resize(f: Fixture, width: number, height: number): Promise<void> { f.frame.style.width = `${width}px`; f.frame.style.height = `${height}px`; await waitFor(f, () => f.view.innerWidth === width && f.view.innerHeight === height, 'Resize the actual fixture viewport'); await frames(f); await settle(f); }
async function project(f: Fixture): Promise<AuthorProject> { let saved: AuthorProject | undefined; await waitFor(f, () => { const raw = f.view.localStorage.getItem(`music-notes.author.recovery.v1:${f.workspace}`); if (!raw) return false; saved = (JSON.parse(raw) as { project: AuthorProject }).project; const status = field(f, '#save-status').textContent ?? ''; return saved?.pendingSource === null && saved.sourceHtml === source(f) && /saved|recovered/i.test(status) && !/unsaved|saving|failed|unavailable/i.test(status); }, 'Observe only this fixture’s accepted recovery record'); return saved!; }
function installBoundaries(f: Fixture): void {
  const realm = f.view as unknown as typeof globalThis; const original = realm.URL.createObjectURL; const blobs = new Map<string, Blob>();
  realm.URL.createObjectURL = object => { const url = original.call(realm.URL, object); if (typeof (object as Blob).text === 'function') blobs.set(url, object as Blob); return url; };
  const capture = (event: Event) => { const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof realm.HTMLAnchorElement && !!node.download); if (!anchor) return; event.preventDefault(); const blob = blobs.get(anchor.href); if (!blob) { f.boundaryErrors.push('An Author download did not use its actual captured Blob; the request was cancelled.'); return; } f.downloads.push({ name: anchor.download, blob, type: blob.type }); };
  f.doc.addEventListener('click', capture, true); f.view.print = () => { f.prints++; };
  f.view.addEventListener('pagehide', () => { realm.URL.createObjectURL = original; f.doc.removeEventListener('click', capture, true); blobs.clear(); }, { once: true });
  let recorded = false; let responded = false;
  const observer = new MutationObserver(() => {
    if (!f.frame.isConnected) { observer.disconnect(); return; }
    const dialog = f.doc.querySelector<HTMLDialogElement>('#author-confirmation'); if (!dialog?.open) { recorded = false; responded = false; return; }
    const message = field(f, '#author-confirmation-message').textContent?.trim(); if (!message) return;
    if (!recorded) { f.confirmations.push(message); recorded = true; }
    if (f.confirmReply === null || responded) return; responded = true; queueMicrotask(() => { if (dialog.open && f.confirmReply !== null) click(f, f.confirmReply ? '#author-confirmation-confirm' : '#author-confirmation-cancel'); });
  }); observer.observe(f.doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true }); f.view.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
async function mount(name: string, width = 1180, height = 660, host = fixtureList): Promise<Fixture> { const workspace = `test-notation-${runId}-${++sequence}`; const recoveryKey = `music-notes.author.recovery.v1:${workspace}`; assert(localStorage.getItem(recoveryKey) === null, 'Refuse to claim an existing workspace.'); ownedKeys.add(recoveryKey); const article = document.createElement('article'); article.className = 'fixture'; const heading = document.createElement('h3'); heading.textContent = name; const note = document.createElement('p'); note.className = 'fixture-note'; const link = document.createElement('a'); link.href = `/author.html?workspace=${workspace}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open this isolated Author fixture'; note.append(link, ` · ${width} × ${height} · synthetic setup, actual app`); const viewport = document.createElement('div'); viewport.className = 'viewport'; const frame = document.createElement('iframe'); frame.title = name; frame.style.width = `${width}px`; frame.style.height = `${height}px`; const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true })); frame.src = link.href; viewport.append(frame); article.append(heading, note, viewport); host.append(article); await bounded(loaded, 'Load the actual Author route'); assert(frame.contentDocument && frame.contentWindow, 'The actual fixture must remain same-origin.'); const f: Fixture = { frame, doc: frame.contentDocument, view: frame.contentWindow, workspace, actions: [], confirmations: [], confirmReply: true, downloads: [], boundaryErrors: [], prints: 0, commits: 0, sourceSetups: 0 }; latest = f; fixtures.set(workspace, f); installBoundaries(f); await settle(f); return f; }
async function template(f: Fixture, id: TemplateId): Promise<void> { await popup(f, '#document-menu-trigger', '#document-menu'); choose(f, '#new-template', id); const before = revision(f); click(f, '#new-project'); await waitFor(f, () => revision(f) === before + 1 && f.doc.body.dataset.renderState === 'ready', 'Create the chosen composition through the real Document action'); await settle(f); f.commits++; }
async function supplement(f: Fixture, html: string, reason: string): Promise<void> { const root = sourceElement(f, html); const parsed = readScore(root); assert(!parsed.diagnostics.some(item => item.severity === 'error'), `Invalid supplemental fixture: ${reason}: ${parsed.diagnostics.map(item => item.message).join(' ')}`); const saved = await project(f); const staves = new Set(parsed.score.staves.map(staff => staff.id)); const annotations = new Set(parsed.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations.map(item => item.id)))); for (const part of saved.parts) assert(part.staffIds.every(id => staves.has(id)), 'Supplement must preserve all part membership.'); for (const id of Object.keys(saved.instructionScopes)) assert(annotations.has(id), `Supplement would orphan scope ${id}.`); await popup(f, '#source-trigger', '#source-panel'); write(f, '#source-input', html); await frames(f); await mutate(f, () => click(f, '#source-apply'), () => true, `Apply supplemental Source: ${reason}`); await closePopovers(f); f.sourceSetups++; }
async function exportPayload(f: Fixture, kind: 'project' | 'html'): Promise<Download & { text: string }> { const before = snapshot(f); const count = f.downloads.length; await popup(f, '#document-menu-trigger', '#document-menu'); click(f, kind === 'project' ? '#download-project' : '#export-html'); await waitFor(f, () => f.downloads.length === count + 1 || f.boundaryErrors.length > 0, `Capture the actual ${kind} download request`); assert(!f.boundaryErrors.length, f.boundaryErrors.join(' ')); const download = f.downloads[count]; const text = await bounded(download.blob.text(), 'Read only the captured export bytes'); assert(text.trim(), 'Actual export must contain bytes.'); equal(download.type, kind === 'project' ? 'application/json' : 'text/html', 'The actual download has its declared MIME type'); assert(download.name.endsWith(kind === 'project' ? '.music-notes.json' : '.music.html'), 'The download uses its musical file extension.'); unchanged(f, before, 'Export accepted music'); return { ...download, text }; }
async function openPayload(f: Fixture, payload: { name: string; text: string; type: string }): Promise<void> { const transfer = new DataTransfer(); transfer.items.add(new File([payload.text], payload.name, { type: payload.type })); const input = field<HTMLInputElement>(f, '#project-file'); const before = revision(f); input.files = transfer.files; f.actions.push({ kind: 'file', target: '#project-file', value: `synthetic file selection of captured ${payload.name}` }); dispatch(f, input, 'change'); await waitFor(f, () => revision(f) === before + 1 && f.doc.body.dataset.renderState === 'ready' && !field<HTMLDialogElement>(f, '#author-confirmation').open, 'Open captured export through the actual guarded file route'); await settle(f); f.commits++; }

function musicalTime(item: MusicEvent): object {
  return { id: item.id, kind: item.kind, duration: item.duration, dots: item.dots, onset: item.onset,
    time: item.time, tupletIds: item.tupletIds, tie: item.tie, beam: item.beam, stem: item.stem,
    measureRest: item.measureRest, rhythmic: item.rhythmic };
}
function markDescription(mark: EventMarking): object {
  return mark.kind === 'interval' ? { ...mark, figure: harmonyIntervalText(mark.interval) } : { ...mark };
}
function nativeSelects(f: Fixture): number {
  const controls = [...f.doc.querySelectorAll<HTMLSelectElement>('select')];
  assert(controls.length > 0, 'Author must contain actual native choice controls.');
  for (const control of controls) {
    const button = control.firstElementChild;
    assert(button?.localName === 'button' && button.getAttribute('type') === 'button'
      && button.querySelector('selectedcontent'), `${control.id}: native select requires its first button/selectedcontent.`);
    assert(control.labels?.length, `${control.id}: native choice must have an associated label.`);
    assert([...control.options].every(option => option.hasAttribute('value')), `${control.id}: every native option has an explicit value.`);
    assert(!control.hasAttribute('role'), `${control.id}: do not replace native select semantics with a combobox role.`);
    const css = (f.view as unknown as typeof globalThis).CSS;
    const custom = css.supports('appearance', 'base-select') && css.supports('selector(::picker(select))');
    if (visible(f, control) && custom) equal(f.view.getComputedStyle(control).appearance, 'base-select', `${control.id}: use the supported customizable-select appearance`);
    if (visible(f, control) && !custom) assert(f.view.getComputedStyle(control).appearance !== 'none', `${control.id}: preserve native fallback appearance.`);
  }
  return controls.length;
}
function nativeOptions(f: Fixture, selector: string, expected: readonly string[], onlyEnabled = false): void {
  equal([...field<HTMLSelectElement>(f, selector).options].filter(option => !onlyEnabled || !option.disabled)
    .map(option => option.value), expected, `${selector}: the GUI matches the model vocabulary`);
}
function notationGeometry(f: Fixture, expected: StaffNotation): number {
  const root = surface(f); const layout = root.getLayoutGeometry(); assert(layout, 'Notation needs public current geometry.');
  const staff = score(f).staves.find(staff => (staff.notation ?? 'pitched') === expected); assert(staff, `Missing authored ${expected} staff.`);
  const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>(`.${layout.projection} g.vf-music-staff`)]
    .filter(group => group.dataset.staffId === staff.id);
  assert(groups.length, `${expected}: actual engraved staff groups must be present.`);
  let staves = 0;
  for (const group of groups) {
    equal(group.dataset.notation ?? 'pitched', expected, 'The rendered staff names its actual notation');
    for (const stave of group.querySelectorAll<SVGGElement>('g.vf-stave')) {
      equal(stave.querySelectorAll(':scope > path').length, expected === 'pitched' ? 5 : expected === 'rhythm' ? 1 : 3, 'Count actual printed staff lines'); staves++;
    }
    if (expected !== 'pitched') equal(group.querySelectorAll('g.vf-clef,g.vf-keysignature').length, 0, 'Pitchless notation must not print a pitched clef or key');
  }
  for (const item of staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))) {
    if (item.kind !== 'rhythm' && item.kind !== 'road') continue;
    equal(item.pitches, [], 'Pitchless authoring must not invent absolute pitches');
    const found = layout.systems.flatMap(system => system.events).find(region => region.sourceId === item.id);
    assert(found, 'Every authored pitchless event needs public geometry.'); equal(found.noteheads, [], 'Pitchless event geometry does not pretend to contain pitched noteheads');
  }
  return staves;
}
function focusIn(f: Fixture, container: HTMLElement, label: string): void {
  const active = authorActiveElement(f.doc) as HTMLElement | null;
  assert(active && container.contains(active) && visible(f, active) && !active.matches(':disabled'), `${label}: focus remains on a visible, enabled control or status in this editor.`);
}
function focusInToolViewport(f: Fixture, label: string): void {
  const pane = field(f, '#selection-inspector'); focusIn(f, pane, label);
  const active = authorActiveElement(f.doc)!; const bounds = box(pane); const activeBox = box(active);
  assert(activeBox.height <= bounds.height ? inside(activeBox, bounds, 1) : activeBox.top >= bounds.top - 1 && activeBox.top < bounds.bottom,
    `${label}: the focused field must be revealed inside the tool pane, not clipped below it.`);
}
async function quick(f: Fixture, id: string): Promise<void> {
  await closePopovers(f); await tools(f, false); await select(f, id);
  await popup(f, '#edit-selected-event', '#note-editor');
  equal(field(f, '#note-editor').dataset.eventId, id, 'Quick editing binds the accepted event, not the future recipe');
}
async function undoQuick(f: Fixture, before: Snapshot): Promise<void> {
  const prior = revision(f); click(f, '#note-editor-undo');
  await waitFor(f, () => revision(f) === prior + 1 && f.doc.body.dataset.renderState === 'ready' && canonical(f, source(f)) === canonical(f, before.source), 'Undo one local quick edit');
  await settle(f); equal(music(f), before.music, 'Local Undo restores exact pitches, child IDs, and time');
  equal(cursor(f), before.cursor, 'Local Undo retains its selected target'); equal(recipe(f), before.recipe, 'Local Undo preserves the future recipe');
  assert(field(f, '#note-editor').matches(':popover-open'), 'Local Undo keeps the quick editor open.'); focusIn(f, field(f, '#note-editor'), 'Local Undo');
}
async function attached(f: Fixture, id: string, route = false): Promise<void> {
  await closePopovers(f); await select(f, id);
  if (route) { await quick(f, id); click(f, '#note-attached-marks'); }
  else await tab(f, 'edit');
  await waitFor(f, () => visible(f, field(f, '#event-markings-editor')), 'Reveal the existing Edit tool’s attached marks'); await frames(f);
  equal(field(f, '#event-markings-editor').dataset.draftTarget, id, 'Attached-mark controls bind the displayed owner');
}
function markingRows(f: Fixture): HTMLElement[] { return [...f.doc.querySelectorAll<HTMLElement>('#event-markings-rows [data-marking-row]')]; }
function rowFor(f: Fixture, id: string): HTMLElement { const row = markingRows(f).find(row => row.dataset.markingId === id); assert(row, `No accepted marking row ${id}.`); return row; }
function rowControl<T extends HTMLInputElement | HTMLSelectElement>(row: HTMLElement, name: string): T {
  const control = row.querySelector<T>(`[data-marking-field="${name}"]`); assert(control, `Missing ${name} control in ${row.dataset.markingId ?? row.dataset.markingRow}.`); return control;
}
async function addMark(f: Fixture, kind: EventMarking['kind'], content?: string, placement?: 'above' | 'below'): Promise<HTMLElement> {
  const previous = new Set(markingRows(f).map(row => row.dataset.markingRow)); const scroll = field(f, '#score-scroll').scrollTop;
  click(f, `#add-event-${kind}`); await frames(f);
  const row = markingRows(f).find(row => !previous.has(row.dataset.markingRow)); assert(row, 'Add creates a draft row with a separate identity.');
  equal(field(f, '#score-scroll').scrollTop, scroll, 'Adding an attached row does not scroll the score'); focusInToolViewport(f, 'Add attached mark');
  equal(row.dataset.markingKind, kind, 'The draft row retains its family');
  if (content !== undefined) {
    if (kind === 'interval') writeElement(f, rowControl<HTMLInputElement>(row, 'value'), content);
    else chooseElement(f, rowControl<HTMLSelectElement>(row, 'type'), content);
  }
  if (placement) { assert(kind === 'interval', 'Only interval harmony direction is an authored row placement choice.'); chooseElement(f, rowControl<HTMLSelectElement>(row, 'placement'), placement); }
  if (kind !== 'interval') assert(!row.querySelector('[data-marking-field="placement"]'), 'Articulation and ornament sides are automatic; do not expose a conflicting manual placement choice.');
  return row;
}
async function applyMarks(f: Fixture, id: string, expected: () => boolean): Promise<Snapshot> {
  const before = await mutate(f, () => click(f, '#apply-event-markings'), expected, 'Apply the displayed attached-mark draft atomically');
  equal(field(f, '#event-markings-editor').dataset.draftTarget, id, 'Apply retains its source owner');
  focusInToolViewport(f, 'Apply attached marks'); return before;
}
async function rejectMarks(f: Fixture, before: Snapshot, reason: RegExp): Promise<void> {
  click(f, '#apply-event-markings'); await frames(f); await settle(f); unchanged(f, before, 'Reject attached-mark edit');
  const status = field(f, '#event-markings-draft-status');
  assert(visible(f, status) && status.getAttribute('role') === 'alert' && reason.test(status.textContent ?? ''), `Rejected edit needs its local musical explanation: ${status.textContent}`);
}
async function fillRests(f: Fixture): Promise<void> { await tab(f, 'rhythm'); await mutate(f, () => click(f, '#fill-rests'), () => true, 'Fill the selected voice’s remainder using the visible rhythm command'); await tools(f, false); }
async function addStaff(f: Fixture, notation: StaffNotation, label: string): Promise<string> {
  const original = new Set(score(f).staves.map(staff => staff.id)); const count = score(f).staves[0].measures.length;
  await expose(f, '#staff-notation'); choose(f, '#staff-notation', notation); write(f, '#staff-label', label);
  await mutate(f, () => click(f, '#add-staff'), () => score(f).staves.length === original.size + 1, `Create the ${notation} staff through Score setup`);
  await closePopovers(f); const staff = score(f).staves.find(staff => !original.has(staff.id)); assert(staff, 'Add staff must create a new canonical staff.');
  equal([staff.notation ?? 'pitched', staff.label, staff.measures.length], [notation, label, count], 'The created staff has its requested notation and all aligned bars'); return staff.id;
}
async function createPart(f: Fixture, staffId: string, label: string): Promise<string> {
  await choosePart(f, 'score'); const original = new Set((await project(f)).parts.map(part => part.id));
  await expose(f, '#part-label'); write(f, '#part-label', label);
  const boxes = [...f.doc.querySelectorAll<HTMLInputElement>('#part-staves input[type="checkbox"]')];
  assert(boxes.some(box => box.value === staffId), 'The canonical staff is offered for the new part.');
  for (const box of boxes) if (box.checked !== (box.value === staffId)) clickElement(f, box);
  await mutate(f, () => click(f, '#add-part'), () => true, `Create the named ${label} part through Score setup`);
  await closePopovers(f); const part = (await project(f)).parts.find(part => !original.has(part.id)); assert(part, 'Create part writes one new part.'); equal(part.staffIds, [staffId], 'Part membership uses the intended canonical staff'); return part.id;
}
async function instruction(f: Fixture, staffId: string, measureId: string, kind: 'direction' | 'tempo' | 'rehearsal', text: string, scope: 'all' | string): Promise<string> {
  await choosePart(f, 'score'); await location(f, staffId, measureId); await tab(f, 'markings');
  if (visible(f, field(f, '#new-annotation'))) click(f, '#new-annotation');
  choose(f, '#annotation-kind', kind); choose(f, '#annotation-placement', 'above'); write(f, '#annotation-text', text); click(f, '#annotation-at-start');
  if (kind === 'tempo') { write(f, '#annotation-bpm', '112'); choose(f, '#annotation-beat', 'quarter'); choose(f, '#annotation-dots', '0'); }
  await expose(f, '#annotation-scope'); choose(f, '#annotation-scope', scope === 'all' ? 'all' : 'parts');
  if (scope !== 'all') for (const box of f.doc.querySelectorAll<HTMLInputElement>('#annotation-part-scopes input[type="checkbox"]')) if (box.checked !== (box.value === scope)) clickElement(f, box);
  const before = new Set(score(f).staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations.map(mark => mark.id))));
  await mutate(f, () => click(f, '#add-annotation'), () => true, 'Create a scoped performance instruction through Markings');
  const mark = score(f).staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations)).find(mark => !before.has(mark.id)); assert(mark, 'Instruction creation needs a new source ID.');
  equal((await project(f)).instructionScopes[mark.id], scope === 'all' ? 'all' : [scope], 'The project preserves the chosen recipients'); return mark.id;
}
async function selectRange(f: Fixture, first: string, last: string): Promise<void> {
  await select(f, first); await tab(f, 'rhythm'); choose(f, '#range-start', first); choose(f, '#range-end', last); await frames(f);
}
async function tie(f: Fixture, first: string, last: string): Promise<void> {
  await selectRange(f, first, last); await mutate(f, () => click(f, '#tie-events'), () => event(f, first).tie === 'start' && event(f, last).tie === 'end', 'Tie the GUI-authored road phrase across the barline');
  await select(f, first);
}
async function duplicateAllBars(f: Fixture): Promise<void> {
  await choosePart(f, 'score'); const staff = score(f).staves[0]; const count = staff.measures.length;
  await location(f, staff.id, staff.measures[0].id); await tab(f, 'rhythm');
  choose(f, '#duplicate-from-measure', staff.measures[0].id); choose(f, '#duplicate-through-measure', staff.measures[count - 1].id);
  await mutate(f, () => click(f, '#duplicate-measures'), () => score(f).staves.every(staff => staff.measures.length === count * 2), 'Duplicate the complete GUI-authored passage across all staves'); await tools(f, false);
}
async function roadPhrase(f: Fixture, bars = 2): Promise<{ staff: string; first: string; start: string; end: string }> {
  await template(f, 'three-roads'); const staff = score(f).staves[0].id;
  await configure(f, { kind: 'road', direction: 'same', duration: 'quarter', dots: '0', position: 'after', continuation: true });
  const ids: string[] = [];
  for (let index = 0; index < bars * 4; index++) { choose(f, '#event-direction', (['same', 'higher', 'lower', 'lower'] as const)[index % 4]); ids.push(await insert(f, index % 2 === 1)); }
  equal(score(f).staves[0].measures.length, bars, 'A road phrase does not create a trailing empty bar'); return { staff, first: ids[0], start: ids[3], end: ids[4] };
}
async function mixedFixture(name: string, host = fixtureList): Promise<Mixed> {
  const f = await mount(name, 1180, 660, host); const pitched = score(f).staves[0].id;
  await configure(f, { kind: 'note', pitch: 'F4', duration: 'quarter', dots: '0', continuation: false });
  const noteIds: string[] = [];
  for (const alter of [0.5, -0.5, 1.5, -1.5] as const) { await configure(f, { alter }); noteIds.push(await insert(f)); }
  await addMeasure(f); await configure(f, { pitch: 'C4', duration: 'whole' }); await insert(f);
  const rhythm = await addStaff(f, 'rhythm', 'Unpitched pulse');
  let staff = score(f).staves.find(staff => staff.id === rhythm)!; await location(f, rhythm, staff.measures[0].id);
  await configure(f, { kind: 'rhythm', duration: 'quarter', dots: '0', position: 'after' }); await insert(f);
  for (const duration of ['eighth', 'eighth', 'half']) { choose(f, '#event-duration', duration); await insert(f); }
  const roads = await addStaff(f, 'three-roads', 'Relative melody'); staff = score(f).staves.find(staff => staff.id === roads)!;
  await location(f, roads, staff.measures[0].id); await configure(f, { kind: 'road', direction: 'same', duration: 'quarter', dots: '0', position: 'after' });
  const roadIds: string[] = [];
  for (const direction of ['same', 'higher', 'lower', 'lower'] as const) { choose(f, '#event-direction', direction); roadIds.push(await insert(f)); }
  await location(f, roads, staff.measures[1].id); await configure(f, { kind: 'road', direction: 'same', duration: 'whole', position: 'after' }); const tieEnd = await insert(f);
  const tieStart = roadIds[3]; await tie(f, tieStart, tieEnd);
  await attached(f, tieStart, true); await addMark(f, 'articulation', 'accent'); await addMark(f, 'ornament', 'turn');
  await applyMarks(f, tieStart, () => event(f, tieStart).markings?.length === 2);
  const accent = event(f, tieStart).markings!.find(mark => mark.kind === 'articulation')!.id;
  const ornament = event(f, tieStart).markings!.find(mark => mark.kind === 'ornament')!.id;
  await attached(f, tieEnd); await addMark(f, 'articulation', 'staccato'); await applyMarks(f, tieEnd, () => event(f, tieEnd).markings?.length === 1);
  await attached(f, tieStart); check(f, '#event-markings-tie-scope', true); await addMark(f, 'interval', '5', 'above'); await addMark(f, 'interval', 'b3', 'below');
  await applyMarks(f, tieStart, () => [tieStart, tieEnd].every(id => event(f, id).markings?.filter(mark => mark.kind === 'interval').length === 2));
  const intervals = [tieStart, tieEnd].flatMap(id => event(f, id).markings!.filter(mark => mark.kind === 'interval').map(mark => mark.id));
  await attached(f, noteIds[0]); await addMark(f, 'articulation', 'tenuto'); await addMark(f, 'ornament', 'trill'); await applyMarks(f, noteIds[0], () => event(f, noteIds[0]).markings?.length === 2);
  const originalParts = (await project(f)).parts; const melodyPart = originalParts.find(part => part.staffIds.length === 1 && part.staffIds[0] === pitched); assert(melodyPart, 'The Blank template has its authored-pitch part.');
  const parts = { pitched: melodyPart.id, rhythm: await createPart(f, rhythm, 'Pulse part'), roads: await createPart(f, roads, 'Relative melody part') };
  await choosePart(f, 'score');
  const firstBar = score(f).staves.find(staff => staff.id === pitched)!.measures[0].id;
  const instructions = [await instruction(f, pitched, firstBar, 'tempo', 'Moderate, elastic', 'all'), await instruction(f, pitched, firstBar, 'rehearsal', 'A', 'all'),
    await instruction(f, pitched, firstBar, 'direction', 'Choose a main pitch; intervals refer to that main pitch.', parts.roads)];
  await tools(f, false); await choosePart(f, 'score'); equal(f.sourceSetups, 0, 'Mixed notation is created entirely through visible Author actions');
  return { fixture: f, pitched, rhythm, roads, firstNote: noteIds[0], tieStart, tieEnd, accent, ornament, intervals, parts, instructions };
}

tests.push(
  {
    gate: 'AUTHOR-RHYTHM', name: 'Create unpitched rhythm, rests, and slashes; edit values and exact tuplets',
    async run() {
      const f = await mount('Rhythm staff created and edited through Author'); await template(f, 'rhythm');
      await configure(f, { kind: 'rhythm', duration: 'quarter', dots: '0', position: 'after', continuation: true });
      nativeOptions(f, '#event-kind', staffKinds.rhythm, true); const ids: string[] = [];
      for (const kind of ['rhythm', 'rest', 'rhythmic-slash', 'slash']) {
        choose(f, '#event-kind', kind); ids.push(await insert(f));
      }
      equal(ids.map(id => ({ kind: event(f, id).kind, rhythmic: event(f, id).rhythmic, pitches: event(f, id).pitches })),
        [{ kind: 'rhythm', rhythmic: false, pitches: [] }, { kind: 'rest', rhythmic: false, pitches: [] },
          { kind: 'slash', rhythmic: true, pitches: [] }, { kind: 'slash', rhythmic: false, pitches: [] }], 'Each GUI kind has its exact musical representation');
      choose(f, '#event-kind', 'rhythm'); const notes: string[] = [];
      for (let index = 0; index < 4; index++) notes.push(await insert(f, true));
      equal(score(f).staves[0].measures.length, 2, 'Eight accepted quarter entries create exactly two bars');
      assert(!visible(f, field(f, '#drag-entry')), 'An unpitched entry must not offer pitched dragging.');
      const beforeLetter = snapshot(f); key(f, field(f, '#score-editor'), 'g'); await frames(f); unchanged(f, beforeLetter, 'Letter-key pitch entry on an unpitched staff');
      const count = notationGeometry(f, 'rhythm'); await quick(f, notes[0]);
      assert(!visible(f, field(f, '#note-direction')) && !visible(f, field(f, '#note-microtone')), 'The rhythm quick editor must not offer pitch choices.');
      const beforeValue = await mutate(f, () => choose(f, '#note-duration', 'eighth'), () => event(f, notes[0]).duration === 'eighth', 'Change only the accepted rhythm value');
      equal(event(f, notes[0]).time, { numerator: 1, denominator: 8 }, 'A shortened rhythm event has exact eighth-note time');
      await undoQuick(f, beforeValue); await closePopovers(f);
      await selectRange(f, notes[0], notes[2]); await expose(f, '#tuplet-actual');
      write(f, '#tuplet-actual', '3'); write(f, '#tuplet-normal', '2'); choose(f, '#tuplet-bracket', 'yes');
      const beforeTuplet = await mutate(f, () => click(f, '#wrap-tuplet'), () => event(f, notes[0]).tupletIds.length === 1, 'Wrap the three actual selected rhythm events in a 3:2 tuplet');
      for (const id of notes.slice(0, 3)) equal(event(f, id).time, { numerator: 1, denominator: 6 }, 'Three written quarters take exact 3:2 time');
      equal(event(f, notes[3]).onset, { numerator: 1, denominator: 2 }, 'The following event moves to the exact tuplet boundary');
      await tools(f, false); await history(f, beforeTuplet); equal(f.sourceSetups, 0, 'Rhythm creation and editing do not need Source');
      return { detail: 'Two GUI-authored bars retain pitchless rendering, both slash meanings, exact rhythm edits, and one-step tuplet Undo.', metrics: { staffInstances: count, nativeSelects: nativeSelects(f), acceptedTransactions: f.commits, sourceSetups: f.sourceSetups } };
    },
  },
  {
    gate: 'ROAD-CONTEXTUAL', name: 'Alternate road directions inline on phone screens and correct a selected road note',
    async run() {
      const f = await mount('Phone road authoring without reopening entry settings', 390, 660); const phrase = await roadPhrase(f);
      nativeOptions(f, '#event-kind', staffKinds['three-roads'], true); nativeOptions(f, '#event-direction', Object.keys(directions));
      const directionActions = f.actions.filter(action => action.kind === 'choice' && action.target === '#event-direction');
      equal(directionActions.length, 9, 'One initial direction plus eight inline choices author the phrase');
      assert(field(f, '#event-direction').closest('#write-tools'), 'The frequent road choice is in the immediate writing strip.');
      assert(!field(f, '#event-direction').closest('[popover]'), 'Alternating direction must not require repeatedly opening settings.');
      const ids = events(f).filter(item => item.kind === 'road').map(item => item.id);
      equal(ids.map(id => event(f, id).pitchDirection), ['same', 'higher', 'lower', 'lower', 'same', 'higher', 'lower', 'lower'], 'Inline choices create the exact intended relative phrase');
      const rendered = notationGeometry(f, 'three-roads');
      await quick(f, ids[1]); const future = recipe(f); const beforeTiming = musicalTime(event(f, ids[1]));
      assert(visible(f, field(f, '#note-direction')) && !visible(f, field(f, '#note-microtone')), 'Quick road correction offers relative direction without absolute accidentals.');
      const before = await mutate(f, () => choose(f, '#note-direction', 'lower'), () => event(f, ids[1]).pitchDirection === 'lower', 'Correct the selected relative direction immediately');
      equal(musicalTime(event(f, ids[1])), beforeTiming, 'Direction correction does not change time, tie, or source identity'); equal(recipe(f), future, 'Quick correction does not rewrite the future road recipe');
      await undoQuick(f, before); await closePopovers(f); await tools(f, false);
      const dimensions: object[] = [];
      for (const height of [660, 360]) {
        await resize(f, 390, height); await select(f, phrase.first);
        const clip = scoreClip(f); assert(height !== 360 || clip.height >= 179, `Short Select mode must reserve at least 179px of usable notation, received ${clip.height}.`);
        const ink = sourceBox(f, phrase.first); assert(overlaps(ink, clip), 'A real road event remains visible, not only blank score space.');
        assert(f.doc.documentElement.scrollWidth <= f.doc.documentElement.clientWidth + 1, 'The phone page must not require unintended horizontal scrolling.');
        await enter(f, true); const direction = field(f, '#event-direction');
        assert(visible(f, direction) && inside(box(direction), viewport(f)), 'The inline direction control must fit the actual phone viewport.');
        for (const selector of ['#event-kind', '#event-duration', '#event-direction', '#insert-event']) assert(box(field(f, selector)).height >= 43.75, `${selector} retains its 44px target.`);
        dimensions.push({ width: 390, height, selectNotationHeight: clip.height, direction: box(direction) }); click(f, '#select-mode');
      }
      equal(f.sourceSetups, 0, 'The phone phrase uses only real writing controls');
      return { detail: 'Eight direction choices stay inline; a quick correction and Undo preserve the accepted rhythm and future recipe at both phone heights.', metrics: { renderedStaffInstances: rendered, viewports: dimensions, acceptedTransactions: f.commits } };
    },
  },
  {
    gate: 'AUTHOR-ATTACHED-FAMILIES', name: 'Author every articulation and ornament, then edit, remove, Undo, and enforce event restrictions',
    async run() {
      const f = await mount('Six articulations and five ornaments through the actual Edit tool');
      await configure(f, { kind: 'note', pitch: 'F4', duration: 'whole', dots: '0' }); const id = await insert(f); await attached(f, id, true);
      const original = snapshot(f); const originalTime = musicalTime(event(f, id));
      for (const type of ARTICULATION_TYPES) await addMark(f, 'articulation', type);
      for (const type of ORNAMENT_TYPES) await addMark(f, 'ornament', type);
      unchanged(f, original, 'Staging all eleven attached marks');
      assert(field<HTMLButtonElement>(f, '#add-event-articulation').disabled && field<HTMLButtonElement>(f, '#add-event-ornament').disabled, 'Exhausted unique families must not silently add duplicates.');
      const expectedArticulations: Record<ArticulationType, true> = { accent: true, staccato: true, tenuto: true, marcato: true, staccatissimo: true, fermata: true };
      const expectedOrnaments: Record<OrnamentType, true> = { trill: true, turn: true, 'inverted-turn': true, 'upper-mordent': true, 'lower-mordent': true };
      equal([...ARTICULATION_TYPES].sort(), Object.keys(expectedArticulations).sort(), 'Articulation vocabulary has an explicit Author test decision');
      equal([...ORNAMENT_TYPES].sort(), Object.keys(expectedOrnaments).sort(), 'Ornament vocabulary has an explicit Author test decision');
      const beforeApply = await applyMarks(f, id, () => event(f, id).markings?.length === 11);
      equal(musicalTime(event(f, id)), originalTime, 'Attached symbols consume no time');
      equal(new Set(marks(f).map(mark => mark.id)).size, 11, 'Each attached symbol gets its own stable source ID');
      const all = snapshot(f); await tools(f, false); await history(f, beforeApply); await history(f, all, true);
      await attached(f, id); const removeId = event(f, id).markings!.find(mark => mark.kind === 'ornament' && mark.type === 'turn')!.id;
      clickElement(f, rowFor(f, removeId).querySelector<HTMLButtonElement>('[data-remove-marking]')!); await frames(f);
      focusInToolViewport(f, 'Remove attached row'); equal(event(f, id).markings!.length, 11, 'Removing a row is a draft until Apply');
      const beforeRemove = await applyMarks(f, id, () => event(f, id).markings?.length === 10);
      assert(!marks(f).some(mark => mark.id === removeId), 'Apply removes the intended child only.');
      await tools(f, false); await history(f, beforeRemove);
      const permissions: Record<MusicEvent['kind'], { articulation: boolean; ornament: boolean; interval: boolean }> = {
        note: { articulation: true, ornament: true, interval: false }, chord: { articulation: true, ornament: false, interval: false },
        rest: { articulation: true, ornament: false, interval: false }, slash: { articulation: true, ornament: false, interval: false },
        rhythm: { articulation: true, ornament: false, interval: false }, road: { articulation: true, ornament: true, interval: true },
      };
      const restricted: object[] = [];
      for (const kind of ['chord', 'rest', 'rhythmic-slash', 'slash', 'rhythm', 'road']) {
        const sample = await mount(`Attached-mark restrictions: ${kind}`, 390, 660);
        if (kind === 'rhythm') await template(sample, 'rhythm'); if (kind === 'road') await template(sample, 'three-roads');
        await configure(sample, { kind, ...(kind === 'chord' ? { pitches: 'C4 Eqs4 G4' } : {}), duration: 'whole', dots: '0' }); const target = await insert(sample);
        await attached(sample, target, true); const model = event(sample, target); const allowed = permissions[model.kind];
        for (const family of ['articulation', 'ornament', 'interval'] as const) equal(!field<HTMLButtonElement>(sample, `#add-event-${family}`).disabled, allowed[family], `${kind}: the visible Add choices match actual event support`);
        const row = await addMark(sample, 'articulation'); const type = rowControl<HTMLSelectElement>(row, 'type');
        const fermataOnly = kind === 'rest' || kind === 'slash';
        equal([...type.options].filter(option => !option.disabled).map(option => option.value), fermataOnly ? ['fermata'] : [...ARTICULATION_TYPES], `${kind}: restriction applies to offered articulation types`);
        const draft = snapshot(sample); await applyMarks(sample, target, () => event(sample, target).markings?.length === 1);
        equal(musicalTime(event(sample, target)), musicalTime(model), `${kind}: supported attachment does not change rhythm`);
        await tools(sample, false); await history(sample, draft); restricted.push({ kind, permitted: allowed, fermataOnly });
      }
      return { detail: 'All eleven attached families are authored in one atomic edit; child removal and Undo are exact, with event-specific choices enforced by the actual UI.', metrics: { types: { articulations: ARTICULATION_TYPES.length, ornaments: ORNAMENT_TYPES.length }, restrictions: restricted, nativeSelects: nativeSelects(f), sourceSetups: f.sourceSetups } };
    },
  },
  {
    gate: 'AUTHOR-INTERVAL-VOCABULARY', name: 'Write all supported interval figures and reject invalid raw drafts without losing them',
    async run() {
      const f = await mount('Interval figures authored on a road main note'); await template(f, 'three-roads');
      await configure(f, { kind: 'road', direction: 'same', duration: 'whole', dots: '0' }); const id = await insert(f); await attached(f, id, true);
      const figures = Array.from({ length: 13 }, (_, index) => index + 1).flatMap(number => number === 1 ? ['1', '#1'] : [`b${number}`, String(number), `#${number}`]);
      const row = await addMark(f, 'interval', figures[0], 'above'); nativeOptions(f, `#${rowControl<HTMLSelectElement>(row, 'placement').id}`, ['above', 'below']);
      const initialTime = musicalTime(event(f, id)); let markId = '';
      for (const [index, figure] of figures.entries()) {
        const current = markId ? rowFor(f, markId) : row; writeElement(f, rowControl<HTMLInputElement>(current, 'value'), figure);
        chooseElement(f, rowControl<HTMLSelectElement>(current, 'placement'), index % 2 ? 'below' : 'above');
        await applyMarks(f, id, () => {
          const mark = event(f, id).markings?.find(mark => mark.kind === 'interval');
          return mark?.kind === 'interval' && harmonyIntervalText(mark.interval) === figure && mark.placement === (index % 2 ? 'below' : 'above');
        });
        const mark = event(f, id).markings![0]; assert(mark.kind === 'interval', 'The accepted row remains an interval.');
        if (markId) equal(mark.id, markId, 'Editing a figure preserves its child source identity'); else markId = mark.id;
        equal(mark.interval, parseHarmonyInterval(figure), 'The actual GUI uses the model’s public interval grammar'); equal(musicalTime(event(f, id)), initialTime, 'Interval harmony consumes no time');
      }
      for (const [raw, normalized] of [['♭3', 'b3'], ['♯11', '#11']]) {
        writeElement(f, rowControl<HTMLInputElement>(rowFor(f, markId), 'value'), raw);
        await applyMarks(f, id, () => { const mark = event(f, id).markings?.[0]; return mark?.kind === 'interval' && harmonyIntervalText(mark.interval) === normalized; });
      }
      const invalid: string[] = [];
      for (const raw of ['b1', '0', '14', 'b14', '##5', '3.5', '']) {
        const input = rowControl<HTMLInputElement>(rowFor(f, markId), 'value'); writeElement(f, input, raw); const before = snapshot(f);
        await rejectMarks(f, before, /interval|figure|unison|1.{0,12}13|supported|invalid|required/i); equal(input.value, raw, 'Invalid raw text stays available for correction'); invalid.push(raw);
        click(f, '#discard-event-markings'); await frames(f);
      }
      return { detail: 'All 38 canonical interval spellings and both Unicode accidental aliases pass through actual row controls; seven invalid drafts preserve text and history.', metrics: { acceptedFigures: figures.length, aliases: 2, rejectedRawFigures: invalid, sourceSetups: f.sourceSetups, acceptedTransactions: f.commits } };
    },
  },
);

tests.push(
  {
    gate: 'AUTHOR-MARKING-IDENTITY', name: 'Select an exact printed child mark, open its matching row, and route chord editing safely',
    async run() {
      const f = await mount('Exact attached-mark identity and contextual edit routes'); await configure(f, { kind: 'note', pitch: 'Fqs4', duration: 'whole', dots: '0' }); const id = await insert(f);
      await attached(f, id, true); await addMark(f, 'articulation', 'accent'); await addMark(f, 'ornament', 'turn'); await applyMarks(f, id, () => event(f, id).markings?.length === 2);
      const children = event(f, id).markings!.map(mark => mark.id); const baseline = snapshot(f); await tools(f, false);
      const childBoxes: Box[] = [];
      for (const child of children) {
        await select(f, child); unchanged(f, baseline, 'Passive exact attached-mark selection', false);
        equal((cursor(f) as { event: string }).event, id, 'The notation session cursor stays on the owner event');
        equal(field(f, '#score-editor').dataset.activeMarkingId, child, 'The workspace separately remembers the exact clicked child');
        assert(!visible(f, field(f, '#workspace-tools')), 'A passive mark click must not open tools automatically.');
        const ink = sourceBox(f, child); childBoxes.push(ink);
        const outline = [...field(f, '#score-host').shadowRoot!.querySelectorAll<HTMLElement>('.author-selection[data-source-id]')].find(element => element.dataset.sourceId === child);
        assert(outline, 'The selection overlay names the exact child source ID.');
        const highlighted = box(outline); assert(inside(ink, highlighted, 1) && highlighted.width <= ink.width + 7 && highlighted.height <= ink.height + 7, 'Highlight the child’s actual bounds, not its whole owning event.');
        assert(!field(f, '#edit-selected-event').hasAttribute('popovertarget'), 'An exact attached-mark edit routes directly to its row, not the owner’s scalar quick editor.');
        click(f, '#edit-selected-event'); await waitFor(f, () => visible(f, field(f, '#event-markings-editor')), 'Open the explicitly selected child’s existing Edit tool'); await frames(f);
        equal(field(f, '#event-markings-editor').dataset.activeMarkingId, child, 'The attached editor retains the exact route identity');
        const row = rowFor(f, child); assert(row.contains(authorActiveElement(f.doc)), 'The exact clicked mark’s own field receives focus.'); focusInToolViewport(f, 'Open the exact printed marking');
        unchanged(f, baseline, 'Opening a child row', false); await tools(f, false);
      }
      assert(JSON.stringify(childBoxes[0]) !== JSON.stringify(childBoxes[1]), 'Separate children have distinct actual geometry.');
      await attached(f, id); const removed = children[0]; clickElement(f, rowFor(f, removed).querySelector<HTMLButtonElement>('[data-remove-marking]')!);
      await applyMarks(f, id, () => !event(f, id).markings?.some(mark => mark.id === removed));
      assert(!field(f, '#score-editor').dataset.activeMarkingId, 'Removing or leaving the exact child invalidates that child target.');
      await tools(f, false); await location(f, score(f).staves[0].id, score(f).staves[0].measures[0].id); await addMeasure(f);
      await configure(f, { kind: 'chord', pitches: 'C4 E4 G4', duration: 'whole', dots: '0' }); const chord = await insert(f);
      await quick(f, chord); assert(!visible(f, field(f, '#note-microtone')), 'Chord corrections must not silently choose one pitch for scalar accidental edits.');
      assert(/chord pitches/i.test(field(f, '#note-advanced-edit').textContent ?? ''), 'The quick route names the actual chord task.');
      const future = recipe(f); click(f, '#note-advanced-edit'); await frames(f); await expose(f, '#selected-pitches');
      equal(authorActiveElement(f.doc)?.id, 'selected-pitches', 'Advanced chord route focuses the accepted chord’s pitch field');
      write(f, '#selected-pitches', 'C4 Eqs4 G4'); const beforeChord = await mutate(f, () => click(f, '#update-event'), () => event(f, chord).pitches.some(pitch => pitch.alter === 0.5), 'Apply the explicit advanced chord correction');
      equal(event(f, chord).pitches.map(pitchText), ['C4', 'Eqs4', 'G4'], 'The actual chord route writes quarter-tone spelling without changing other pitches'); equal(recipe(f), future, 'Advanced accepted-event correction preserves the independent writing recipe');
      await tools(f, false); await history(f, beforeChord);
      return { detail: 'Printed children retain separate target identities and focused rows; chord editing follows its named advanced route and Undo restores the accepted chord.', metrics: { exactChildren: children, childBoxes, sourceSetups: f.sourceSetups, acceptedTransactions: f.commits } };
    },
  },
  {
    gate: 'AUTHOR-TIED-INTERVALS', name: 'Create a tied road sound in the GUI and edit complete-chain harmony with one Undo',
    async run() {
      const f = await mount('GUI-created tied road sound and explicit interval scope'); await template(f, 'three-roads');
      await configure(f, { kind: 'road', direction: 'same', duration: 'quarter', dots: '0' }); const ids: string[] = [];
      for (const direction of ['same', 'higher', 'lower', 'lower'] as const) { choose(f, '#event-direction', direction); ids.push(await insert(f)); }
      await addMeasure(f); await configure(f, { kind: 'road', direction: 'same', duration: 'whole' }); const end = await insert(f); const start = ids[3]; await tie(f, start, end);
      await attached(f, start, true); equal(field<HTMLInputElement>(f, '#event-markings-tie-scope').checked, false, 'Complete tied-sound scope is an explicit opt-in');
      await addMark(f, 'articulation', 'accent'); await addMark(f, 'ornament', 'turn'); await applyMarks(f, start, () => event(f, start).markings?.length === 2);
      await attached(f, end); await addMark(f, 'articulation', 'staccato'); await applyMarks(f, end, () => event(f, end).markings?.length === 1);
      const ownStart = event(f, start).markings!.map(markDescription); const ownEnd = event(f, end).markings!.map(markDescription);
      const times = [start, end].map(id => musicalTime(event(f, id))); const directionsBefore = [start, end].map(id => event(f, id).pitchDirection);
      await attached(f, start); check(f, '#event-markings-tie-scope', true); const help = field(f, '#event-markings-tie-help').textContent ?? '';
      assert(/2 tied|2.*notes/i.test(help) && /bars.*1.*2/i.test(help) && /interval/i.test(help), 'Complete scope visibly names the full sound, its bars, and its interval-only meaning.');
      await addMark(f, 'interval', '5', 'above'); await addMark(f, 'interval', 'b3', 'below');
      const before = await applyMarks(f, start, () => [start, end].every(id => event(f, id).markings?.filter(mark => mark.kind === 'interval').length === 2));
      const written = snapshot(f); const intervalIds = [start, end].flatMap(id => event(f, id).markings!.filter(mark => mark.kind === 'interval').map(mark => mark.id));
      equal(new Set(intervalIds).size, 4, 'Each physical tied segment retains independent child identities');
      for (const id of [start, end]) equal(event(f, id).markings!.filter(mark => mark.kind === 'interval').map(mark => mark.kind === 'interval' ? [harmonyIntervalText(mark.interval), mark.placement] : []), [['5', 'above'], ['b3', 'below']], 'Complete scope writes the same harmonic sound on every tied segment');
      equal(event(f, start).markings!.filter(mark => mark.kind !== 'interval').map(markDescription), ownStart, 'Complete interval edits retain start-specific articulation and ornament');
      equal(event(f, end).markings!.filter(mark => mark.kind !== 'interval').map(markDescription), ownEnd, 'Complete interval edits retain end-specific articulation');
      equal([start, end].map(id => musicalTime(event(f, id))), times, 'Chain harmony does not alter time, source identity, or tie policies'); equal([start, end].map(id => event(f, id).pitchDirection), directionsBefore, 'Harmony does not replace the chain’s main-pitch directions');
      await tools(f, false); await history(f, before); await history(f, written, true);
      await attached(f, start); check(f, '#event-markings-tie-scope', false); const first = event(f, start).markings!.find(mark => mark.kind === 'interval')!;
      writeElement(f, rowControl<HTMLInputElement>(rowFor(f, first.id), 'value'), '#11'); const attempted = snapshot(f);
      await rejectMarks(f, attempted, /tie|interval|same|match|sound/i); equal(rowControl<HTMLInputElement>(rowFor(f, first.id), 'value').value, '#11', 'Rejected segment-only harmony retains the draft');
      check(f, '#event-markings-tie-scope', true); const beforeChainChange = await applyMarks(f, start, () => [start, end].every(id => event(f, id).markings?.some(mark => mark.kind === 'interval' && harmonyIntervalText(mark.interval) === '#11')));
      equal([start, end].flatMap(id => event(f, id).markings!.filter(mark => mark.kind === 'interval').map(mark => mark.id)), intervalIds, 'Updating existing tied harmonies preserves every child ID');
      await tools(f, false); await history(f, beforeChainChange); await quick(f, end);
      equal([...field<HTMLSelectElement>(f, '#note-direction').options].filter(option => !option.disabled).map(option => option.value), ['same'], 'A held continuation cannot silently change its main pitch');
      const guarded = snapshot(f); const direction = field<HTMLSelectElement>(f, '#note-direction'); direction.value = 'higher'; dispatch(f, direction, 'change'); await frames(f); await settle(f);
      unchanged(f, guarded, 'Synthetic stale delivery of a disabled tied direction'); equal(direction.value, 'same', 'Rejected tied direction returns to its accepted value'); await closePopovers(f);
      equal(f.sourceSetups, 0, 'Ties and interval harmonies are created through actual Author commands');
      return { detail: 'A tied sound spanning two GUI-authored bars keeps segment-specific marks; complete-sound interval edits are explicit, atomic, reversible, and protect held direction.', metrics: { intervalChildren: intervalIds, affectedSegments: [start, end], acceptedTransactions: f.commits, sourceSetups: f.sourceSetups } };
    },
  },
  {
    gate: 'MARK-DRAFT-SAFETY', name: 'Keep displayed marking drafts bound to their original source through selection, Source conflicts, and deletion',
    async run() {
      const f = await mount('Attached-mark drafts survive unrelated selection and expose real conflicts'); await configure(f, { kind: 'note', pitch: 'F4', duration: 'half', dots: '0' }); const a = await insert(f); const b = await insert(f);
      await attached(f, a, true); await addMark(f, 'articulation', 'accent'); await addMark(f, 'ornament', 'turn'); await applyMarks(f, a, () => event(f, a).markings?.length === 2);
      const art = event(f, a).markings!.find(mark => mark.kind === 'articulation')!.id; const orn = event(f, a).markings!.find(mark => mark.kind === 'ornament')!.id;
      chooseElement(f, rowControl<HTMLSelectElement>(rowFor(f, art), 'type'), 'tenuto'); const accepted = snapshot(f);
      await select(f, b); equal(field(f, '#event-markings-editor').dataset.draftTarget, a, 'A dirty displayed editor does not retarget to the newly selected event');
      equal(rowControl<HTMLSelectElement>(rowFor(f, art), 'type').value, 'tenuto', 'The original draft is kept');
      assert(visible(f, field(f, '#return-event-markings')), 'A dirty draft offers a named route back to its original owner.'); unchanged(f, accepted, 'Selection with dirty attached marks', false);
      click(f, '#return-event-markings'); await frames(f); await settle(f); equal((cursor(f) as { event: string }).event, a, 'Return goes to the original displayed owner');
      const external = sourceElement(f); const artNode = [...external.querySelectorAll('[id]')].find(node => node.id === art)!; const ornNode = [...external.querySelectorAll('[id]')].find(node => node.id === orn)!;
      artNode.setAttribute('type', 'marcato'); artNode.setAttribute('placement', 'below'); ornNode.remove();
      await supplement(f, external.outerHTML, 'An external accepted edit changes the dirty articulation and deletes an untouched ornament'); await tab(f, 'edit');
      const status = field(f, '#event-markings-draft-status'); await waitFor(f, () => status.dataset.draftState === 'conflict', 'Expose the genuine changed-mark dependency');
      assert(/Accepted:/i.test(status.textContent ?? '') && /Draft:/i.test(status.textContent ?? '') && /marcato/i.test(status.textContent ?? '') && /tenuto/i.test(status.textContent ?? ''), 'The visible conflict explains accepted and intended row values before Review.');
      const beforeReview = snapshot(f); click(f, '#review-event-markings'); await frames(f); unchanged(f, beforeReview, 'Review visible accepted-versus-draft differences');
      assert(!markingRows(f).some(row => row.dataset.markingId === orn), 'Review adopts an externally deleted row that the user did not modify.');
      await applyMarks(f, a, () => event(f, a).markings?.some(mark => mark.id === art && mark.kind === 'articulation' && mark.type === 'tenuto') === true);
      assert(!marks(f).some(mark => mark.id === orn), 'Applying the dirty row must not recreate an untouched externally deleted ornament.');
      equal([...sourceElement(f).querySelectorAll('[id]')].find(node => node.id === art)?.getAttribute('placement'), 'below', 'A type-only GUI edit preserves a legacy source placement attribute without exposing a manual side control');
      chooseElement(f, rowControl<HTMLSelectElement>(rowFor(f, art), 'type'), 'staccato');
      const deletion = sourceElement(f); [...deletion.querySelectorAll('[id]')].find(node => node.id === art)!.remove();
      await supplement(f, deletion.outerHTML, 'External deletion removes a locally changed child'); await tab(f, 'edit');
      await waitFor(f, () => field(f, '#event-markings-draft-status').dataset.draftState === 'conflict', 'Keep the locally modified deleted child as an explicit conflict');
      const remainingDraft = rowFor(f, art); equal(rowControl<HTMLSelectElement>(remainingDraft, 'type').value, 'staccato', 'A locally changed missing row remains recoverable');
      const beforeDeletedReview = snapshot(f); click(f, '#review-event-markings'); await frames(f); unchanged(f, beforeDeletedReview, 'Review a removed child without recreating it');
      const recover = rowFor(f, art).querySelector<HTMLButtonElement>('[data-remove-marking]'); assert(recover && /Discard row change/i.test(recover.textContent ?? ''), 'A missing edited child has an explicit discard-row recovery route.');
      if (!field<HTMLButtonElement>(f, '#apply-event-markings').disabled) await rejectMarks(f, snapshot(f), /removed|missing|recreat|source/i);
      else { const stale = snapshot(f); field(f, '#apply-event-markings').dispatchEvent(new MouseEvent('click', { bubbles: true })); await frames(f); unchanged(f, stale, 'Synthetic stale Apply cannot resurrect a removed child'); }
      clickElement(f, recover); await frames(f); assert(!marks(f).some(mark => mark.id === art), 'Discarding a removed draft row leaves it absent in accepted Source.');
      await addMark(f, 'articulation', 'fermata'); const rawSource = source(f); await popup(f, '#source-trigger', '#source-panel'); write(f, '#source-input', rawSource.replace('F4', 'invalid-pitch'));
      await frames(f); await closePopovers(f); await tab(f, 'edit'); const pending = snapshot(f);
      assert(field<HTMLButtonElement>(f, '#apply-event-markings').disabled, 'A pending Source draft blocks scalar/marking mutations.');
      field(f, '#apply-event-markings').dispatchEvent(new MouseEvent('click', { bubbles: true })); await frames(f); unchanged(f, pending, 'Synthetic stale Apply while Source is pending');
      equal(markingRows(f).filter(row => !row.dataset.markingId).length, 1, 'Blocked Apply preserves its new row draft.');
      await popup(f, '#source-trigger', '#source-panel'); click(f, '#source-revert'); await frames(f); await settle(f); await closePopovers(f);
      return { detail: 'A dirty row stays with its original event; Review distinguishes accepted/draft values, merges untouched deletions, and never recreates a missing child or applies over pending Source.', metrics: { originalOwner: a, unrelatedSelection: b, guardedChild: art, supplementalExternalEdits: f.sourceSetups, acceptedTransactions: f.commits } };
    },
  },
);
// Insert after the shared helpers. These cases author their fixtures entirely through Author's GUI.
const pitchCaseOrder = (Object.keys(alterations).map(Number).sort((left, right) => left - right)) as PitchAlteration[];

function pitchCaseUnclaimedKey(f: Fixture, selector: string): void {
  const target = field(f, selector);
  assert(visible(f, target) && !target.matches(':disabled'), `${selector}: a native keyboard target must be available.`);
  target.focus();
  const keyboard = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
  f.actions.push({ kind: 'key', target: selector, value: 'Enter (native-field ownership check)' });
  target.dispatchEvent(keyboard);
  assert(!keyboard.defaultPrevented, `${selector}: Author must leave Enter to the native field or button.`);
}

function pitchCaseQuickChoice(f: Fixture, alter: PitchAlteration): void {
  const button = ordinaryAccidentals[String(alter)];
  if (button) click(f, button);
  else choose(f, '#note-microtone', String(alter));
}

function pitchCaseQuickVisible(f: Fixture, selector: string, label: string): void {
  const panel = field(f, '#note-editor');
  assert(panel.matches(':popover-open'), `${label}: use the actual native quick editor.`);
  assert(inside(box(panel), viewport(f), 1), `${label}: the complete popover fits the actual viewport.`);
  assert(f.doc.documentElement.scrollWidth <= f.view.innerWidth + 1, `${label}: the popover creates no horizontal document overflow.`);
  const target = field(f, selector);
  assert(authorActiveElement(f.doc) === target, `${label}: initial focus belongs to the accepted ${selector} field.`);
  focusIn(f, panel, label);
  const body = field(f, '.note-editor-body'); const bodyBox = box(body);
  const footer = box(field(f, '.note-editor-footer'));
  const left = bodyBox.left + body.clientLeft; const top = bodyBox.top + body.clientTop;
  const right = Math.min(f.view.innerWidth, left + body.clientWidth);
  const bottom = Math.min(f.view.innerHeight, footer.top, top + body.clientHeight);
  const clip: Box = { left, top, right, bottom, width: right - left, height: bottom - top };
  assert(inside(box(target), clip, 1), `${label}: accepted focus is fully revealed inside the editor body without harness scrolling.`);
  const context = field(f, '#note-editor-context');
  assert(visible(f, context) && inside(box(context), clip, 1), `${label}: the staff, measure, and voice context remains visible.`);
  assert(/measure\s+\S+.*voice\s+\d+/i.test(context.textContent ?? ''), `${label}: context identifies the selected musical location.`);
  assert(!overlaps(box(target), box(context)), `${label}: pinned context must not cover the focused field.`);
  for (const control of [target, field(f, '#close-note-editor')]) {
    assert(box(control).height >= 43.5 && box(control).width >= 43.5, `${label}: focused action and Close retain 44-pixel targets.`);
  }
}

async function pitchCaseReopen(f: Fixture, id: string, initial: string, label: string): Promise<{ width: number; height: number; overflow: boolean }> {
  await quick(f, id);
  const before = snapshot(f); const future = recipe(f);
  const scroller = field(f, '#score-scroll');
  const scroll = [scroller.scrollTop, scroller.scrollLeft];
  pitchCaseQuickVisible(f, initial, `${label}, first open`);
  const body = field(f, '.note-editor-body'); const overflow = body.scrollHeight > body.clientHeight + 1;
  body.scrollTop = body.scrollHeight;
  f.actions.push({ kind: 'scroll', target: '.note-editor-body', value: 'bottom before reopening' });
  await frames(f);
  if (overflow) assert(body.scrollTop > 0, `${label}: the reopen check must actually leave a scrolled editor body.`);
  await popup(f, '#edit-selected-event', '#note-editor', false);
  await popup(f, '#edit-selected-event', '#note-editor');
  pitchCaseQuickVisible(f, initial, `${label}, reopened from bottom`);
  equal([scroller.scrollTop, scroller.scrollLeft], scroll, `${label}: revealing the editor's initial field does not scroll the score.`);
  equal(recipe(f), future, `${label}: opening and reopening preserve future entry settings.`);
  unchanged(f, before, `${label}: opening, scrolling and reopening are not musical edits`);
  // A passive viewport refresh must not move focus back to the initial field.
  const close = field(f, '#close-note-editor'); close.focus();
  const width = f.view.innerWidth; const height = f.view.innerHeight;
  await resize(f, width, height + 1);
  assert(authorActiveElement(f.doc) === close, `${label}: passive layout refresh must not steal focus.`);
  await resize(f, width, height);
  assert(authorActiveElement(f.doc) === close, `${label}: restoring viewport size must not steal focus.`);
  unchanged(f, before, `${label}: passive resize does not change accepted music`);
  await closePopovers(f);
  return { width, height, overflow };
}

tests.push({
  gate: 'ENTRY-ALTERATION / ENTRY-KEYBOARD / COVERAGE-VOCABULARY',
  name: 'Nine native entry alterations preserve spelling and recipe; score Enter and A–G have distinct, explicit behavior',
  async run() {
    const f = await mount('GUI entry: all nine absolute alterations');
    await template(f, 'blank');
    await configure(f, { kind: 'note', pitch: 'F4', duration: 'quarter', dots: '0', position: 'after', continuation: true });
    await expose(f, '#event-accidental-display');
    choose(f, '#event-accidental-display', 'courtesy'); choose(f, '#event-stem', 'up'); choose(f, '#event-beam', 'none');
    check(f, '#event-measure-rest', false);
    nativeOptions(f, '#event-alteration', pitchCaseOrder.map(String));
    nativeOptions(f, '#event-kind', staffKinds.pitched, true);
    const nativeCount = nativeSelects(f);
    await closePopovers(f);
    const inserted: string[] = [];
    for (const alter of pitchCaseOrder) {
      await popup(f, '#entry-settings-trigger', '#entry-settings');
      const before = snapshot(f);
      const expected = pitchText({ step: 'F', octave: 4, alter, display: 'courtesy' });
      choose(f, '#event-alteration', String(alter)); await frames(f);
      equal(value(f, '#event-pitch'), expected, `${alter}: choosing an absolute alteration preserves F and octave 4`);
      equal(recipe(f), { ...before.recipe, 'event-pitch': expected, 'event-alteration': String(alter) }, `${alter}: changing pitch alteration preserves every other entry setting`);
      unchanged(f, before, `${alter}: an entry recipe choice adds no Source or Undo change`);
      const future = recipe(f);
      await closePopovers(f);
      const id = await insert(f); inserted.push(id); const written = event(f, id);
      equal(written.kind, 'note', `${alter}: GUI insertion writes a single note`);
      equal(written.pitches.map(pitchText), [expected], `${alter}: accepted music retains the exact public pitch spelling`);
      equal([written.pitches[0].step, written.pitches[0].octave, written.pitches[0].alter, written.pitches[0].display], ['F', 4, alter, 'courtesy'], `${alter}: fractional pitch and accidental display remain separate properties`);
      equal([written.duration, written.dots, written.stem, written.beam, written.measureRest], ['quarter', 0, 'up', 'none', false], `${alter}: insertion preserves the written rhythm and engraving recipe`);
      equal(recipe(f), { ...future, 'insert-position': 'after' }, `${alter}: insertion advances its position without resetting the future recipe`);
    }
    equal(new Set(inserted).size, pitchCaseOrder.length, 'All nine GUI insertions retain distinct canonical event identities');
    await configure(f, { alter: 1.5 });
    const keyboardRecipe = recipe(f);
    const exact = await insert(f, true);
    equal(event(f, exact).pitches.map(pitchText), ['Ftqs4'], 'Enter on the score inserts the exact configured three-quarter-sharp recipe');
    equal(recipe(f), { ...keyboardRecipe, 'insert-position': 'after' }, 'Score Enter does not silently naturalize or reset the recipe');
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
    for (const letter of letters) {
      await mutate(f, () => key(f, field(f, '#score-editor'), letter), () => true, `${letter}: write the documented natural pitch from the score keyboard`);
      const id = (cursor(f) as { event: string | null }).event; assert(id, `${letter}: keyboard insertion needs a selected written event.`);
      const written = event(f, id);
      equal(written.pitches.map(pitchText), [pitchText({ step: letter, octave: 4, alter: 0, display: 'courtesy' })], `${letter}: A–G uses the recipe octave and an explicit natural pitch`);
      equal(written.pitches[0].display, 'courtesy', `${letter}: the natural-pitch keyboard policy does not erase accidental display`);
      equal(value(f, '#event-alteration'), '0', `${letter}: the entry alteration control reflects the natural keyboard recipe`);
    }
    const nativeBefore = snapshot(f);
    for (const selector of ['#event-kind', '#event-duration', '#entry-settings-trigger', '#insert-event']) pitchCaseUnclaimedKey(f, selector);
    await frames(f); unchanged(f, nativeBefore, 'Native choice fields and buttons retain Enter ownership');
    await popup(f, '#entry-settings-trigger', '#entry-settings');
    const textBefore = snapshot(f); pitchCaseUnclaimedKey(f, '#event-pitch'); await frames(f);
    unchanged(f, textBefore, 'Enter inside the pitch text field does not invoke score entry');
    assert(/A.?G.*natural/i.test(field(f, '#entry-keyboard-help').textContent ?? ''), 'The natural A–G policy must be stated beside entry controls.');
    assert(/Enter.*exact current recipe/i.test(field(f, '#entry-keyboard-help').textContent ?? ''), 'Entry help must state how to insert the exact accidental recipe.');
    const invalidBefore = snapshot(f); const invalid = 'F#';
    write(f, '#event-pitch', invalid); await frames(f);
    equal(value(f, '#event-pitch'), invalid, 'An incomplete pitch spelling stays exactly as typed');
    assert(field(f, '#event-pitch').getAttribute('aria-invalid') === 'true', 'Invalid pitch text receives its local invalid state.');
    const reason = field(f, '#event-alteration-status');
    assert(visible(f, reason) && /pitch.*kept/i.test(reason.textContent ?? ''), 'Invalid raw pitch needs a visible local explanation that its text was kept.');
    // Choosing while the text is incomplete must re-parse the live text, never substitute a natural pitch.
    if (!field<HTMLSelectElement>(f, '#event-alteration').disabled) choose(f, '#event-alteration', '-0.5');
    await frames(f); equal(value(f, '#event-pitch'), invalid, 'An alteration choice cannot guess a missing octave');
    unchanged(f, invalidBefore, 'Invalid entry spelling and rejected alteration preserve Source, cursor, Undo and Redo');
    write(f, '#event-pitch', 'Fqs4'); await closePopovers(f);
    const switchBefore = snapshot(f); choose(f, '#event-kind', 'rest');
    await popup(f, '#entry-settings-trigger', '#entry-settings');
    assert(!visible(f, field(f, '#event-alteration-field')), 'A rest recipe does not expose pitch alteration controls.');
    equal(value(f, '#event-pitch'), 'Fqs4', 'Switching to rests retains the future pitched spelling');
    await closePopovers(f); choose(f, '#event-kind', 'note');
    await popup(f, '#entry-settings-trigger', '#entry-settings');
    equal(value(f, '#event-alteration'), '0.5', 'Returning to notes recovers the retained quarter-sharp spelling');
    equal(field<HTMLInputElement>(f, '#event-measure-rest').checked, false, 'Switching notation kinds does not silently turn on full-measure rests');
    unchanged(f, switchBefore, 'Changing between rest and pitched recipes is not a musical edit');
    await closePopovers(f); await fillRests(f);
    equal(f.sourceSetups, 0, 'The entire alteration journey must be authored through GUI controls, never Source fixtures');
    return { detail: 'All nine alterations, exact-recipe Enter, seven natural A–G entries, invalid raw pitch, native key ownership and rest-recipe recovery are checked through Author.',
      metrics: { alterations: pitchCaseOrder, authoredNotes: inserted.length + 1 + letters.length, nativeChoices: nativeCount, sourceSetups: f.sourceSetups, commits: f.commits } };
  },
});

tests.push({
  gate: 'QUICK-ALTERATION / QUICK-REOPEN-FOCUS-VISIBLE / EDIT-DIRECT-ROUTES',
  name: 'All nine quick alterations are absolute, reversible and recipe-safe; accepted focus is revealed on desktop and short screens',
  async run() {
    const f = await mount('GUI quick editing: reversible accidentals and visible reopening');
    await template(f, 'blank');
    await configure(f, { kind: 'note', pitch: 'F4', duration: 'whole', dots: '0', position: 'after', continuation: false });
    await expose(f, '#event-accidental-display'); choose(f, '#event-accidental-display', 'courtesy'); choose(f, '#event-stem', 'down'); choose(f, '#event-beam', 'none');
    await closePopovers(f); const id = await insert(f); const original = event(f, id);
    await configure(f, { kind: 'chord', pitches: 'Bqf3 D#4 Fqs4', duration: 'eighth', dots: '2', position: 'before', continuation: false });
    const future = recipe(f); await quick(f, id);
    equal(recipe(f), future, 'Opening quick editing does not replace the distinct future chord recipe');
    nativeOptions(f, '#note-microtone', ['', '-1.5', '-0.5', '0.5', '1.5']);
    const nativeCount = nativeSelects(f);
    for (const alter of pitchCaseOrder) {
      const before = snapshot(f);
      if (alter === original.pitches[0].alter) {
        pitchCaseQuickChoice(f, alter); await frames(f); unchanged(f, before, 'Choosing the existing natural spelling is a no-op');
        assert(field<HTMLButtonElement>(f, '#note-editor-undo').disabled, 'A no-op never offers unrelated musical history as local Undo.');
      } else {
        await mutate(f, () => pitchCaseQuickChoice(f, alter), () => event(f, id).pitches[0].alter === alter, `Quick edit to absolute alteration ${alter}`);
        const written = event(f, id);
        equal(written.pitches.map(pitchText), [pitchText({ ...original.pitches[0], alter })], `${alter}: quick editing retains the exact public spelling`);
        equal({ ...written, pitches: original.pitches }, original, `${alter}: quick accidental editing preserves event identity, rhythm, ties, marks, and all non-pitch properties`);
        equal(written.pitches.map(pitch => ({ ...pitch, alter: original.pitches[0].alter })), original.pitches, `${alter}: changing alteration retains letter, octave and display`);
        equal(recipe(f), future, `${alter}: the future chord recipe remains independent`);
        const repeated = snapshot(f); pitchCaseQuickChoice(f, alter); await frames(f);
        unchanged(f, repeated, `${alter}: repeating an accepted quick value adds no second history step`);
        assert(field<HTMLButtonElement>(f, '#note-editor-undo').disabled === false, 'The one real quick edit remains locally undoable.');
        await undoQuick(f, before);
        assert(field<HTMLButtonElement>(f, '#note-editor-undo').disabled, `${alter}: one Undo exhausts precisely the one quick change.`);
        equal(event(f, id).pitches.map(pitchText), ['F4'], `${alter}: a single local Undo restores the original natural`);
      }
      equal(recipe(f), future, `${alter}: accepted, repeated and undone choices preserve future insertion settings`);
      assert(!visible(f, field(f, '#note-editor-error')), `${alter}: supported quick alteration must not report a musical error.`);
    }
    await closePopovers(f);
    const cases: { label: string; template: TemplateId; kind: string; pitch?: string; pitches?: string; direction?: PitchDirection; initial: string }[] = [
      { label: 'ordinary note', template: 'blank', kind: 'note', pitch: 'F4', initial: '#note-natural' },
      { label: 'quarter-tone note', template: 'blank', kind: 'note', pitch: 'Fqs4', initial: '#note-microtone' },
      { label: 'microtonal chord', template: 'blank', kind: 'chord', pitches: 'Cqf4 Etqs4 G4', initial: '#note-duration' },
      { label: 'rhythm note', template: 'rhythm', kind: 'rhythm', initial: '#note-duration' },
      { label: '3 roads note', template: 'three-roads', kind: 'road', direction: 'same', initial: '#note-direction' },
    ];
    const reopen: { label: string; width: number; height: number; overflow: boolean }[] = [];
    for (const scenario of cases) {
      await resize(f, 1180, 660); await template(f, scenario.template);
      await configure(f, { kind: scenario.kind, pitch: scenario.pitch, pitches: scenario.pitches, direction: scenario.direction,
        duration: 'whole', dots: '0', position: 'after', continuation: false });
      const target = await insert(f);
      equal(event(f, target).kind, scenario.kind, `${scenario.label}: the reopen fixture was created through the actual entry action`);
      const stableRecipe = recipe(f);
      for (const [width, height] of [[1180, 660], [390, 360]] as const) {
        await resize(f, width, height);
        reopen.push({ label: scenario.label, ...await pitchCaseReopen(f, target, scenario.initial, `${scenario.label}, ${width}×${height}`) });
        equal(recipe(f), stableRecipe, `${scenario.label}: viewport and editor journeys retain the future recipe`);
      }
    }
    assert(reopen.some(item => item.width === 390 && item.overflow), 'At least one short-screen reopen must exercise genuine internal overflow.');
    equal(f.sourceSetups, 0, 'Every quick-edit and reopen fixture must come from real GUI entry');
    return { detail: 'Five ordinary and four fractional alterations each preserve music and recipe, with no-op and one-Undo checks; five event types reopen with visible accepted focus on desktop and 390×360.',
      metrics: { alterations: pitchCaseOrder, quickEdits: pitchCaseOrder.filter(alter => alter !== 0).length, reopen, nativeChoices: nativeCount, sourceSetups: f.sourceSetups, commits: f.commits,
        qualification: 'Synthetic DOM actions check actual app behavior and geometry; native picker/assistive-technology interaction is not certified.' } };
  },
});

// Insert into authoring-notation-browser.ts after mixedFixture().
// Uses only that runner's GUI helpers, captured export bytes, public DOM/model,
// and each disposable fixture's own recovery record. No private page/controller hooks.

type PublicationPaper = 'letter' | 'a4';

function publicationSorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicationSorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, publicationSorted(item)]));
  }
  return value;
}

function publicationProjectValue(saved: AuthorProject): unknown {
  // Reopening intentionally writes a fresh save timestamp; every durable field
  // (including ID, metadata, columns, scopes, parts, and layouts) must survive.
  return publicationSorted(Object.fromEntries(Object.entries(saved).filter(([key]) => key !== 'updatedAt')));
}

function publicationRead(f: Fixture, html: string): Score {
  const parsed = readScore(sourceElement(f, html));
  const errors = parsed.diagnostics.filter(item => item.severity === 'error');
  assert(!errors.length, `Captured musical bytes must validate: ${errors.map(item => `${item.code}: ${item.message}`).join(' ')}`);
  return parsed.score;
}

function publicationExpected(f: Fixture, saved: AuthorProject, partId: string) {
  const canonicalScore = publicationRead(f, saved.sourceHtml);
  const part = saved.parts.find(item => item.id === partId);
  assert(partId === 'score' || part, `Missing canonical publication part ${partId}.`);
  const staves = canonicalScore.staves.filter(staff => !part || part.staffIds.includes(staff.id));
  assert(staves.length, 'Every publication target must contain a real staff.');
  const staffIds = new Set(staves.map(staff => staff.id));
  const writtenEvents = staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
  const children = writtenEvents.flatMap(owner => (owner.markings ?? []).map(mark => ({ mark, owner: owner.id })));
  const annotations = canonicalScore.staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations.map(annotation => ({ annotation, ownerStaff: staff.id }))))
    .filter(({ annotation, ownerStaff }) => {
      if (!part) return true;
      const recipients = saved.instructionScopes[annotation.id];
      return recipients === undefined ? staffIds.has(ownerStaff) : recipients === 'all' || recipients.includes(part.id);
    }).map(item => ({ ...item, displayedStaff: staffIds.has(item.ownerStaff) ? item.ownerStaff : staves[0].id }));
  return { staves, writtenEvents, children, annotations };
}

async function publicationPages(f: Fixture): Promise<void> {
  if (f.doc.body.dataset.view !== 'pages') click(f, '#view-pages');
  await waitFor(f, () => f.doc.body.dataset.view === 'pages' && f.doc.body.dataset.renderState === 'ready'
    && !!field(f, '#page-host').querySelector(':scope > .score-page'), 'Compose the actual physical Pages view');
  await settle(f); await frames(f);
}

async function publicationWritePart(f: Fixture, partId: string): Promise<void> {
  if (f.doc.body.dataset.view !== 'write') { click(f, '#view-write'); await settle(f); }
  await choosePart(f, partId); await tools(f, false);
}

function publicationPaintedInk(f: Fixture, svg: SVGSVGElement): Box[] {
  // SVG text getBBox() includes the music font's em box. Measure painted text
  // using the iframe's own font context; parent-realm instanceof checks would
  // incorrectly treat iframe SVGTextElements as ordinary shapes.
  const context = f.doc.createElement('canvas').getContext('2d');
  assert(context, 'The browser must expose real text measurements for page ink.');
  context.textAlign = 'left'; context.textBaseline = 'alphabetic';
  const boxes: Box[] = [];
  for (const leaf of svg.querySelectorAll<SVGGraphicsElement>('text,path,rect,line,circle,ellipse,polygon,polyline')) {
    const css = f.view.getComputedStyle(leaf);
    if (Number(css.opacity) === 0 || css.fill === 'none' && css.stroke === 'none') continue;
    let x: number, y: number, width: number, height: number;
    if (leaf.localName === 'text') {
      const text = leaf as SVGTextElement;
      context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const measured = context.measureText(text.textContent ?? '');
      const advance = css.textAnchor === 'middle' ? measured.width / 2 : css.textAnchor === 'end' ? measured.width : 0;
      x = (text.x.baseVal[0]?.value ?? 0) - advance - measured.actualBoundingBoxLeft;
      y = (text.y.baseVal[0]?.value ?? 0) - measured.actualBoundingBoxAscent;
      width = measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight;
      height = measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent;
    } else {
      const bounds = leaf.getBBox(); const stroke = css.stroke === 'none' ? 0 : (Number.parseFloat(css.strokeWidth) || 0) / 2;
      x = bounds.x - stroke; y = bounds.y - stroke; width = bounds.width + 2 * stroke; height = bounds.height + 2 * stroke;
    }
    assert([x, y, width, height].every(Number.isFinite), 'Every painted page glyph must have measurable finite geometry.');
    if (width <= 0 || height <= 0) continue;
    const transform = leaf.getScreenCTM(); assert(transform, 'Every page glyph needs its actual SVG screen transform.');
    const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]
      .map(([px, py]) => new DOMPoint(px, py).matrixTransform(transform));
    const left = Math.min(...corners.map(point => point.x)), right = Math.max(...corners.map(point => point.x));
    const top = Math.min(...corners.map(point => point.y)), bottom = Math.max(...corners.map(point => point.y));
    boxes.push({ left, right, top, bottom, width: right - left, height: bottom - top });
  }
  assert(boxes.length, 'A physical system must contain actual painted notation.');
  return boxes;
}

function publicationComposition(f: Fixture, saved: AuthorProject, partId: string, paper: PublicationPaper) {
  const host = field(f, '#page-host'), expected = publicationExpected(f, saved, partId);
  const sheets = [...host.querySelectorAll<HTMLElement>(':scope > .score-page')];
  assert(sheets.length >= 2, 'The explicit bar-five page boundary must produce a real physical turn.');
  assert(!host.querySelector('button,input,select,textarea,details,[popover],[role="tablist"],.pointer-tools,.author-overlays,.author-selection,.pointer-preview'), 'Composed pages must contain no editing chrome.');
  assert(!host.querySelector('rect[opacity="0"][pointer-events]'), 'Print systems must exclude transparent interactive hit targets.');
  const expectedEvents = expected.writtenEvents.map(item => item.id).sort();
  const eventGroups = [...host.querySelectorAll<SVGGElement>('g.vf-music-event[data-source-id]')];
  equal(eventGroups.map(group => group.dataset.sourceId).sort(), expectedEvents, 'Every selected-part event appears exactly once in actual page SVGs');
  const markingGroups = [...host.querySelectorAll<SVGGElement>('g.vf-music-marking[data-source-id]')];
  equal(markingGroups.map(group => group.dataset.sourceId).sort(), expected.children.map(item => item.mark.id).sort(), 'Every selected-part attachment appears exactly once in actual page SVGs');
  for (const { mark, owner } of expected.children) {
    const group = markingGroups.find(item => item.dataset.sourceId === mark.id)!;
    equal([group.dataset.eventId, group.closest<SVGGElement>('g.vf-music-event')?.dataset.sourceId], [owner, owner], 'A printed attachment retains its exact event owner');
  }
  const annotationGroups = [...host.querySelectorAll<SVGGElement>('g.vf-music-annotation[data-source-id]')];
  equal(annotationGroups.map(group => group.dataset.sourceId).sort(), expected.annotations.map(item => item.annotation.id).sort(), 'Shared instructions and the part-specific legend appear only for their intended recipients');
  for (const { annotation, displayedStaff } of expected.annotations) {
    const group = annotationGroups.find(item => item.dataset.sourceId === annotation.id)!;
    equal(group.dataset.kind, annotation.kind, 'The printed shared instruction keeps its musical family');
    equal(group.closest<SVGGElement>('g.vf-music-staff')?.dataset.staffId, displayedStaff, 'A shared instruction prints on the expected visible staff');
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const size = (element: Element) => { const bounds = box(element); return [round(bounds.width), round(bounds.height)]; };
  const expectedMm = paper === 'letter' ? [215.9, 279.4] : [210, 297];
  let nextSystem = 0, nextMeasure = 0, paintedLeaves = 0;
  const pages = sheets.map((sheet, pageIndex) => {
    equal(Number(sheet.dataset.pageIndex), pageIndex, 'Physical page indexes are contiguous');
    const content = sheet.querySelector<HTMLElement>(':scope > .page-content');
    const heading = content?.querySelector<HTMLElement>(':scope > .page-heading');
    const footer = content?.querySelector<HTMLElement>(':scope > .page-footer');
    assert(content && heading && footer, 'Each physical sheet needs its actual content, header, and footer.');
    const title = content.querySelector<HTMLElement>(':scope > .page-title');
    assert(pageIndex === 0 ? !!title : !title, 'Only the first physical page has the composition title.');
    const sheetBounds = box(sheet), contentBounds = box(content);
    assert(Math.abs(sheetBounds.width - expectedMm[0] * 96 / 25.4) <= .75
      && Math.abs(sheetBounds.height - expectedMm[1] * 96 / 25.4) <= .75, 'Pages use the actual requested physical paper dimensions.');
    assert(inside(contentBounds, sheetBounds) && inside(box(heading), contentBounds) && inside(box(footer), contentBounds), 'Page furniture stays within the physical margins.');
    if (title) assert(inside(box(title), contentBounds), 'The title stays inside the printable content.');
    let previousBottom = box(title ?? heading).bottom;
    const systems = [...content.querySelectorAll<HTMLElement>(':scope > .page-systems > .page-system')].map(system => {
      equal(Number(system.dataset.systemIndex), nextSystem++, 'Physical systems appear exactly once in their original order');
      equal(Number(system.dataset.start), nextMeasure, 'Page systems cover contiguous authored measures');
      nextMeasure = Number(system.dataset.end);
      equal(nextMeasure - Number(system.dataset.start), 1, 'The accepted one-measure-per-line choice is honored');
      const svg = system.querySelector<SVGSVGElement>(':scope > svg.notation-svg'); assert(svg, 'Every page system contains actual vector notation.');
      const systemBounds = box(system), svgBounds = box(svg);
      assert(systemBounds.width > 0 && systemBounds.height > 0 && inside(systemBounds, contentBounds)
        && systemBounds.top >= previousBottom - .75 && systemBounds.bottom <= box(footer).top + .75, 'Systems fit their content area without overlapping titles, neighboring systems, or the footer.');
      assert(inside(svgBounds, systemBounds), 'The real SVG viewport fits its physical system.');
      const ink = publicationPaintedInk(f, svg); paintedLeaves += ink.length;
      for (const painted of ink) assert(inside(painted, svgBounds) && inside(painted, contentBounds), 'Every painted glyph and path remains inside its vector viewport and printable margins.');
      previousBottom = systemBounds.bottom;
      return { index: Number(system.dataset.systemIndex), start: Number(system.dataset.start), end: nextMeasure,
        offset: [round(systemBounds.left - contentBounds.left), round(systemBounds.top - contentBounds.top)], size: size(system),
        svg: { size: size(svg), viewBox: svg.getAttribute('viewBox') }, paintedLeaves: ink.length,
        events: [...svg.querySelectorAll<SVGGElement>('g.vf-music-event[data-source-id]')].map(group => group.dataset.sourceId).sort(),
        attachments: [...svg.querySelectorAll<SVGGElement>('g.vf-music-marking[data-source-id]')].map(group => group.dataset.sourceId).sort() };
    });
    assert(systems.length, 'No title-only or empty physical page is introduced.');
    return { index: pageIndex, sheet: size(sheet), content: size(content), heading: size(heading), footer: size(footer), title: title ? size(title) : null, systems };
  });
  equal(nextMeasure, expected.staves[0].measures.length, 'Physical pages include the final authored bar');
  assert(pages.some(page => page.index > 0 && page.systems[0].start === 4), 'The fifth bar starts a new physical page.');
  return { paper, partId, pages, eventIds: expectedEvents, attachmentIds: expected.children.map(item => item.mark.id).sort(),
    instructionIds: expected.annotations.map(item => item.annotation.id).sort(), paintedLeaves };
}

tests.push({
  gate: 'GUI-NOTATION-EXPORT-REOPEN',
  name: 'GUI-authored mixed notation survives actual project and musical HTML export and file reopening',
  async run() {
    const mixed = await mixedFixture('Mixed notation: actual exports and guarded file reopening');
    const f = mixed.fixture; await publicationWritePart(f, 'score');
    equal(f.sourceSetups, 0, 'The exported mixed notation was created through the actual GUI, not Source injection');
    const original = await project(f), stableVoices = explicitVoiceIds(f);
    const originalModel = publicationRead(f, original.sourceHtml);
    const originalMeaning = meaning(originalModel, stableVoices);
    const backup = await exportPayload(f, 'project');
    const savedBytes = JSON.parse(backup.text) as AuthorProject;
    equal(publicationSorted(savedBytes), publicationSorted(original), 'The captured project payload contains the exact accepted project');
    equal(meaning(publicationRead(f, savedBytes.sourceHtml), stableVoices), originalMeaning, 'The actual JSON payload contains every pitch, road direction, rhythm, attachment, and instruction');
    const reopened = await mount('Reopen the actual captured mixed-notation project');
    const confirmations = reopened.confirmations.length; await openPayload(reopened, backup);
    equal(reopened.confirmations.length, confirmations + 1, 'Opening the captured project uses one real application confirmation');
    const reopenedProject = await project(reopened);
    equal(publicationProjectValue(reopenedProject), publicationProjectValue(original), 'Project reopening preserves every durable field, including all parts, scopes, layouts, and source');
    equal(meaning(score(reopened), stableVoices), originalMeaning, 'The reopened full-score projection preserves mixed musical meaning');
    assert(field<HTMLButtonElement>(reopened, '#undo').disabled && field<HTMLButtonElement>(reopened, '#redo').disabled, 'Opening a project starts a fresh history instead of inheriting another workspace’s edits.');
    equal(field<HTMLInputElement>(reopened, '#project-file').files?.length ?? 0, 0, 'The completed file route releases its selected file.');
    const projections: Record<string, unknown>[] = [];
    for (const [label, partId] of [['Full score', 'score'], ['Pitched', mixed.parts.pitched], ['Rhythm', mixed.parts.rhythm], ['Roads', mixed.parts.roads]]) {
      await publicationWritePart(f, partId); await publicationWritePart(reopened, partId);
      const expected = meaning(score(f), stableVoices);
      equal(meaning(score(reopened), stableVoices), expected, 'Reopening JSON preserves the exact original projection and its instruction recipients');
      const html = await exportPayload(f, 'html'), exported = publicationRead(f, html.text);
      equal(meaning(exported, stableVoices), expected, 'Actual musical HTML bytes preserve the selected projection, normalizing only originally implicit voices');
      const recipientExpectation = publicationExpected(f, original, partId);
      equal(exported.staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations.map(item => item.id))).sort(),
        recipientExpectation.annotations.map(item => item.annotation.id).sort(), 'Musical HTML includes shared tempo/rehearsal and only the selected part’s legend');
      const openedHtml = await mount(`Reopen captured ${label.toLowerCase()} musical HTML`);
      const beforeConfirmations = openedHtml.confirmations.length; await openPayload(openedHtml, html);
      equal(openedHtml.confirmations.length, beforeConfirmations + 1, 'Opening exported HTML uses the actual guarded file route once');
      equal(meaning(score(openedHtml), stableVoices), expected, 'Reopened musical HTML retains exact event and attachment IDs, owners, spelling, directions, and time');
      const recoveredHtml = await project(openedHtml);
      equal(meaning(publicationRead(openedHtml, recoveredHtml.sourceHtml), stableVoices), expected, 'The reopened musical HTML also survives actual local recovery');
      equal(openedHtml.sourceSetups, 0, 'Reopening uses captured file bytes rather than the Source setup helper');
      projections.push({ label, partId, htmlBytes: html.blob.size, reopenedWorkspace: openedHtml.workspace,
        staves: exported.staves.map(staff => staff.id), events: recipientExpectation.writtenEvents.length,
        attachments: recipientExpectation.children.length, instructions: recipientExpectation.annotations.map(item => item.annotation.id) });
    }
    equal(publicationProjectValue(await project(f)), publicationProjectValue(original), 'Exporting and inspecting all parts leaves the original accepted project unchanged');
    return { detail: 'The actual GUI-created mixed score exports to project JSON and full/part musical HTML. Captured bytes validate and reopen through the real guarded file input with exact music and attachment identities; JSON also preserves all parts, scopes, and layouts.',
      metrics: { sourceSetups: f.sourceSetups, guiCommits: f.commits, capturedProjectBytes: backup.blob.size, capturedDownloads: f.downloads.length,
        projectReopenedWorkspace: reopened.workspace, projections, importedFiles: 5, nativeDownloads: 0, trustedFilePickerQualified: false, savedPdfQualified: false } };
  },
});

tests.push({
  gate: 'GUI-NOTATION-PAGES-REVIEWS',
  name: 'Letter and A4 preserve mixed-part page identities and reviews until an actual attached-mark edit',
  async run() {
    const mixed = await mixedFixture('Mixed notation: physical pages, scoped instructions, and turn reviews');
    const f = mixed.fixture; await duplicateAllBars(f); await duplicateAllBars(f);
    equal(score(f).staves.map(staff => staff.measures.length), [8, 8, 8], 'Two real all-staff duplications produce eight bars without Source setup');
    equal(f.sourceSetups, 0, 'Physical-page fixtures remain entirely GUI-authored');
    const reports: Record<string, unknown>[] = [];
    for (const paper of ['letter', 'a4'] as const) for (const [label, partId] of [['Full score', 'score'], ['Pitched', mixed.parts.pitched], ['Rhythm', mixed.parts.rhythm], ['Roads', mixed.parts.roads]]) {
      await publicationWritePart(f, partId); await publicationPages(f);
      await expose(f, '#page-paper'); choose(f, '#page-paper', paper); write(f, '#page-max-measures', '1');
      await mutate(f, () => click(f, '#apply-pages'), () => !!field(f, '#page-host').querySelector('.score-page'), 'Apply the named paper and one-measure lines through Pages');
      let saved = await project(f);
      equal([saved.layouts[partId].paper, saved.layouts[partId].maxMeasures], [paper, 1], 'The selected part owns its accepted physical settings');
      const chosen = publicationExpected(f, saved, partId), barFive = chosen.staves[0].measures[4].id;
      const column = saved.columns.find(item => item.measureIds.includes(barFive)); assert(column, 'Bar five has its canonical aligned column.');
      await expose(f, '#page-measure-select'); choose(f, '#page-measure-select', barFive);
      if (saved.layouts[partId].breaks[column.id] !== 'page') {
        choose(f, '#layout-break', 'page');
        await mutate(f, () => click(f, '#apply-break'), () => !!field(f, '#page-host').querySelector('.page-system[data-start="4"]'), 'Accept the explicit page break before bar five');
        saved = await project(f);
      }
      equal(saved.layouts[partId].breaks[column.id], 'page', 'The accepted page boundary uses the real column identity');
      let composition = publicationComposition(f, saved, partId, paper);
      const expected = publicationExpected(f, saved, partId);
      equal(expected.annotations.filter(item => item.annotation.kind === 'tempo').length, 4, 'All four duplicated shared tempos reach this publication target');
      equal(expected.annotations.filter(item => item.annotation.kind === 'rehearsal').length, 4, 'All four duplicated rehearsal marks reach this publication target');
      equal(expected.annotations.filter(item => item.annotation.kind === 'direction').length, partId === 'score' || partId === mixed.parts.roads ? 4 : 0, 'Only the full score and roads part receive the four main-pitch legends');
      await expose(f, '#turn-boundary'); const boundary = [...field<HTMLSelectElement>(f, '#turn-boundary').options].find(option => option.value);
      assert(boundary, 'The actual physical plan offers a nonempty turn boundary.'); choose(f, '#turn-boundary', boundary.value);
      await mutate(f, () => click(f, '#mark-turn-reviewed'), () => /Reviewed for this layout/.test(field(f, '#turn-preview').textContent ?? ''), 'Record one review of the actual displayed page turn');
      const reviewed = await project(f), token = reviewed.layouts[partId].reviewedTurns[boundary.value];
      assert(token, 'The reviewed physical turn saves its real layout fingerprint.');
      composition = publicationComposition(f, reviewed, partId, paper); const passiveRevision = revision(f);
      await publicationWritePart(f, 'score'); await select(f, mixed.accent);
      equal(field(f, '#score-editor').dataset.activeMarkingId, mixed.accent, 'Passive Write selection identifies the actual attachment child');
      equal((cursor(f) as { event: string | null }).event, mixed.tieStart, 'The selected child retains its owning event cursor');
      await publicationWritePart(f, partId); await publicationPages(f);
      await expose(f, '#turn-boundary'); choose(f, '#turn-boundary', boundary.value);
      const afterPassive = await project(f);
      equal(revision(f), passiveRevision, 'Write/part/child-selection/Pages navigation adds no authored revision');
      equal(publicationProjectValue(afterPassive), publicationProjectValue(reviewed), 'Passive workspace navigation preserves all saved music, profiles, scopes, and review tokens');
      equal(afterPassive.layouts[partId].reviewedTurns[boundary.value], token, 'The real review token survives unchanged physical composition');
      equal(publicationComposition(f, afterPassive, partId, paper), composition, 'Recomposed physical pages retain exactly the same systems, events, children, and measured layout');
      assert(/Reviewed for this layout/.test(field(f, '#turn-preview').textContent ?? ''), 'The restored physical turn remains visibly reviewed.');
      await expose(f, '#ack-layout-warnings'); check(f, '#ack-layout-warnings', true);
      assert(!field<HTMLInputElement>(f, '#print-draft').checked, 'This complete mixed score must not rely on draft printing.');
      const beforePrint = f.prints, printRevision = revision(f); click(f, '#print-score');
      await waitFor(f, () => f.prints === beforePrint + 1, 'Intercept exactly one request from the real Pages print action');
      equal([f.doc.body.dataset.authorPrintReady, field(f, '#page-preflight').dataset.ready], ['true', 'true'], 'The print request passes current physical-page preflight');
      equal(revision(f), printRevision, 'Requesting print does not author a musical or layout edit');
      await publicationWritePart(f, 'score'); await attached(f, mixed.tieStart);
      const row = rowFor(f, mixed.accent), mark = event(f, mixed.tieStart).markings?.find(item => item.id === mixed.accent);
      assert(mark?.kind === 'articulation', 'The invalidation target remains the same accepted articulation.');
      const nextType = mark.type === 'accent' ? 'marcato' : 'accent';
      const expectedSource = sourceElement(f), expectedChild = [...expectedSource.querySelectorAll('[id]')].find(item => item.id === mixed.accent);
      assert(expectedChild, 'The canonical source owns the articulation selected for the real edit.'); expectedChild.setAttribute('type', nextType);
      chooseElement(f, rowControl<HTMLSelectElement>(row, 'type'), nextType);
      await applyMarks(f, mixed.tieStart, () => event(f, mixed.tieStart).markings?.some(item => item.id === mixed.accent && item.kind === 'articulation' && item.type === nextType) === true);
      equal(canonical(f, source(f)), canonical(f, expectedSource.outerHTML), 'The accepted GUI edit changes only the chosen articulation type, retaining every event and child identity');
      const edited = await project(f);
      for (const profile of Object.values(edited.layouts)) equal(profile.reviewedTurns, {}, 'An actual attachment edit invalidates every saved physical-turn review');
      equal(edited.parts, reviewed.parts, 'The attachment edit preserves all part definitions'); equal(edited.instructionScopes, reviewed.instructionScopes, 'The attachment edit preserves shared-instruction recipients');
      await publicationWritePart(f, partId); await publicationPages(f); await expose(f, '#turn-boundary');
      const freshBoundary = [...field<HTMLSelectElement>(f, '#turn-boundary').options].find(option => option.value); assert(freshBoundary, 'The edited score still has an inspectable physical turn.');
      choose(f, '#turn-boundary', freshBoundary.value); assert(/Unreviewed/.test(field(f, '#turn-preview').textContent ?? ''), 'The updated physical plan must not display the stale review.');
      const editedComposition = publicationComposition(f, edited, partId, paper);
      reports.push({ paper, label, partId, physicalPages: composition.pages.length, systems: composition.pages.reduce((count, page) => count + page.systems.length, 0),
        events: composition.eventIds.length, attachments: composition.attachmentIds.length, instructions: composition.instructionIds.length,
        paintedLeaves: composition.paintedLeaves, explicitPageColumn: column.id, reviewedBoundary: boundary.value, fingerprint: token,
        passiveTransactions: 0, invalidatingChild: mixed.accent, invalidatingType: nextType, attachmentEditTransactions: 1,
        editedPhysicalPages: editedComposition.pages.length, interceptedPrintRequests: f.prints - beforePrint });
    }
    return { detail: 'Letter and A4 full-score and part pages contain every intended event, attachment, and scoped instruction exactly once, with measured ink inside physical margins. Passive child selection preserves real review tokens; one accepted articulation edit clears them. Print requests are intercepted, not saved PDFs.',
      metrics: { sourceSetups: f.sourceSetups, authoredBarsPerStaff: 8, layouts: reports, interceptedPrintRequests: f.prints,
        nativePrintDialogs: 0, savedPdfQualified: false, physicalPrintingQualified: false, trustedInputQualified: false } };
  },
});

const limits = [
  'Actual Author routes, public notation APIs, visible controls, and isolated fixture-owned recovery only; no private controller calls.',
  'Input, clicks, keyboard events, and FileList reopening are synthetic. Trusted pointer, native picker, touch, IME, and assistive-technology interaction remain separate qualification.',
  'Download bytes and print-request boundaries are intercepted inside disposable fixtures. No native download, print dialog, saved PDF, or physical print is claimed.',
  'Source supplements are limited to explicit external-change/conflict scenarios; musical creation journeys use Author controls.',
];
function setBusy(value: boolean): void { busy = value; runButton.disabled = value; for (const button of visualButtons) button.disabled = value; }
function safeDiagnostic(f: Fixture | undefined): object {
  if (!f) return { fixture: null };
  const read = <T>(callback: () => T): T | string => { try { return callback(); } catch (error) { return String(error); } };
  return { workspace: f.workspace, url: `/author.html?workspace=${f.workspace}`, viewport: [f.view.innerWidth, f.view.innerHeight],
    state: read(() => ({ ...f.doc.body.dataset })), sourceCursor: read(() => cursor(f)), nextRecipe: read(() => recipe(f)),
    status: read(() => Object.fromEntries(['author-errors', 'author-status', 'source-error', 'event-alteration-status', 'event-markings-target', 'event-markings-draft-status', 'note-editor-error', 'page-preflight']
      .map(id => [id, findAuthorControl(f.doc, id)?.textContent?.trim().slice(0, 1800) ?? '']))),
    focus: read(() => ({ id: authorActiveElement(f.doc)?.id, row: authorActiveElement(f.doc)?.closest<HTMLElement>('[data-marking-row]')?.dataset.markingId })),
    notationViewport: read(() => scoreClip(f)), score: read(() => ({ staves: score(f).staves.map(staff => ({ id: staff.id, notation: staff.notation ?? 'pitched', bars: staff.measures.length })), events: events(f).length, childMarks: marks(f).length })),
    recentActions: f.actions.slice(-18), confirmations: f.confirmations.slice(-3), acceptedTransactions: f.commits, sourceSupplements: f.sourceSetups, boundaryErrors: f.boundaryErrors };
}
function jsonOutput(id: string, payload: unknown): void {
  let node = document.querySelector<HTMLScriptElement>(`#${id}`);
  if (!node) { node = document.createElement('script'); node.id = id; node.type = 'application/json'; document.body.append(node); }
  node.textContent = JSON.stringify(payload, null, 2);
}
function clearOwnedFixtures(): void {
  fixtureList.replaceChildren(); visualList.replaceChildren();
  for (const key of ownedKeys) localStorage.removeItem(key);
  ownedKeys.clear(); fixtures.clear(); latest = undefined; sequence = 0; runId = crypto.randomUUID();
}
function report(results: Result[], finished: boolean): void {
  const passed = results.filter(result => result.passed).length; const failed = results.length - passed;
  summary.dataset.state = finished ? failed ? 'failed' : 'passed' : 'running';
  summary.textContent = finished
    ? `${passed}/${tests.length} scripted notation journeys passed${failed ? `; ${failed} failed` : ''}. Fixtures remain below. Native input and saved PDF are not certified.`
    : `${results.length}/${tests.length} journeys completed: ${passed} passed${failed ? `, ${failed} failed` : ''}. Running actual Author fixtures…`;
  jsonOutput('author-notation-browser-results', { state: summary.dataset.state, total: tests.length, completed: results.length, passed, failed, limits,
    acceptedTransactions: [...fixtures.values()].reduce((total, f) => total + f.commits, 0),
    sourceSupplements: [...fixtures.values()].reduce((total, f) => total + f.sourceSetups, 0),
    downloadRequestsIntercepted: [...fixtures.values()].reduce((total, f) => total + f.downloads.length, 0),
    printRequestsIntercepted: [...fixtures.values()].reduce((total, f) => total + f.prints, 0), results,
    fixtures: [...fixtures.values()].map(f => ({ workspace: f.workspace, url: `/author.html?workspace=${f.workspace}`, transactions: f.commits, sourceSupplements: f.sourceSetups, actions: f.actions.length })) });
}
async function run(): Promise<void> {
  if (busy) return; setBusy(true); clearOwnedFixtures(); resultList.replaceChildren();
  visualStatus.dataset.state = 'idle'; visualStatus.textContent = 'No visual fixture opened in this run.';
  environment.textContent = `${navigator.userAgent}\nNative popover: ${'showPopover' in HTMLElement.prototype}; customizable select appearance: ${CSS.supports('appearance', 'base-select')}; native select picker: ${CSS.supports('selector(::picker(select))')}.\n${limits.join('\n')}`;
  const results: Result[] = []; report(results, false);
  try {
    for (const test of tests) {
      const item = document.createElement('li'); const heading = document.createElement('strong'); heading.textContent = `${test.gate} — ${test.name}`; item.append(heading); resultList.append(item);
      summary.textContent = `Running ${results.length + 1}/${tests.length}: ${test.name}`;
      try {
        const outcome = await test.run(); const result: Result = { gate: test.gate, name: test.name, passed: true, ...outcome }; results.push(result);
        item.dataset.state = 'passed'; const detail = document.createElement('p'); detail.textContent = outcome.detail; item.append(detail);
        if (outcome.metrics) { const metrics = document.createElement('pre'); metrics.textContent = JSON.stringify(outcome.metrics, null, 2); item.append(metrics); }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error); const metrics = { diagnostic: safeDiagnostic(latest) }; results.push({ gate: test.gate, name: test.name, passed: false, detail, metrics });
        item.dataset.state = 'failed'; const failure = document.createElement('pre'); failure.textContent = `${detail}\n${JSON.stringify(metrics, null, 2)}`; item.append(failure);
      }
      report(results, false);
    }
    report(results, true);
  } finally { setBusy(false); }
}
async function visual(which: 'mixed' | 'phone' | 'short'): Promise<void> {
  if (busy) return; setBusy(true); visualStatus.dataset.state = 'running'; visualStatus.textContent = 'Creating the actual notation through Author controls…';
  try {
    let f: Fixture; let target: string;
    if (which === 'mixed') {
      const mixed = await mixedFixture('Synthetic GUI setup · mixed desktop notation', visualList); f = mixed.fixture; target = mixed.intervals[0];
      await tools(f, false); await select(f, target); click(f, '#edit-selected-event'); await frames(f);
      equal(field(f, '#event-markings-editor').dataset.activeMarkingId, target, 'The desktop visual opens the exact interval’s row'); focusInToolViewport(f, 'Desktop visual attached row');
    } else {
      f = await mount(`Synthetic GUI setup · road notation at 390×${which === 'short' ? 360 : 660}`, 390, which === 'short' ? 360 : 660, visualList);
      const phrase = await roadPhrase(f); target = phrase.first;
      await attached(f, target, true); await addMark(f, 'articulation', 'accent'); await addMark(f, 'interval', '#11', 'above'); await applyMarks(f, target, () => event(f, target).markings?.length === 2);
      await tools(f, false); await select(f, target);
      if (which === 'short') { await quick(f, target); assert(inside(box(field(f, '#note-editor')), viewport(f)), 'The short-screen quick editor fits its actual viewport.'); }
      else { await enter(f, true); choose(f, '#event-direction', 'higher'); assert(inside(box(field(f, '#event-direction')), viewport(f)), 'The phone’s frequent direction choice is visible inline.'); }
    }
    await settle(f); await project(f); f.frame.scrollIntoView({ block: 'center', inline: 'nearest' }); await frames(f);
    const accepted = snapshot(f); assert(f.sourceSetups === 0, 'Visual notation must be created through actual GUI controls.');
    const state = { state: 'ready', scenario: which, setup: 'synthetic GUI actions; no private APIs or Source fixture', workspace: f.workspace,
      url: `/author.html?workspace=${f.workspace}`, viewport: [f.view.innerWidth, f.view.innerHeight], target, notationViewport: scoreClip(f),
      staves: score(f).staves.map(staff => ({ id: staff.id, notation: staff.notation ?? 'pitched', bars: staff.measures.length })),
      events: events(f).length, childMarks: marks(f).length, sourceSupplements: f.sourceSetups, acceptedTransactions: f.commits, revision: accepted.revision,
      nativePopover: f.doc.querySelector<HTMLElement>('[popover]:popover-open')?.id ?? null, limits };
    await frames(f); unchanged(f, accepted, 'Publishing a visual fixture does not edit accepted music');
    visualStatus.dataset.state = 'ready'; visualStatus.textContent = `Ready: ${which} actual Author fixture · ${f.view.innerWidth}×${f.view.innerHeight}. Setup used synthetic controls; this is not native-input or PDF qualification.\n${JSON.stringify(state)}`;
    jsonOutput('author-notation-visual-results', state);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error); const state = { state: 'failed', scenario: which, detail, diagnostic: safeDiagnostic(latest), limits };
    visualStatus.dataset.state = 'failed'; visualStatus.textContent = `Visual fixture failed: ${detail}\n${JSON.stringify(state)}`; jsonOutput('author-notation-visual-results', state);
  } finally { setBusy(false); }
}
runButton.addEventListener('click', () => { void run(); });
document.querySelector<HTMLButtonElement>('#show-mixed-desktop')!.addEventListener('click', () => { void visual('mixed'); });
document.querySelector<HTMLButtonElement>('#show-road-phone')!.addEventListener('click', () => { void visual('phone'); });
document.querySelector<HTMLButtonElement>('#show-road-short')!.addEventListener('click', () => { void visual('short'); });
