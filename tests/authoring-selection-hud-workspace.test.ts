// @vitest-environment happy-dom
/**
 * Real AuthorWorkspace dispatch/render lifecycle, MusicSurface scheduling/source
 * maps, and SelectionControls. Only engraving readiness/SVG measurements are
 * mocked. This is not native layout, popover, pointer-capture or browser evidence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult, EventGeometry, InsertionAnchor, MarkingGeometry, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import type { Score } from '../src/model/types.js';
import { add, compare, formatRational, rational } from '../src/model/rational.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));
import '../src/engraving/render.js';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { SelectionControls } from '../src/authoring/selection-controls.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { MusicSurface } from '../src/components/music-surface.js';
import type { LayoutGeometry } from '../src/components/music-surface.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const events = `<music-note id="note" pitch="F4" duration="half"><music-articulation id="accent" type="accent"></music-articulation></music-note>
  <music-note id="next" pitch="G4" duration="half"></music-note>`;
const source = (explicit: boolean): string => `<music-system id="hud-score"><music-staff id="staff" label="Flute"><music-measure id="bar">
  ${explicit ? `<music-voice id="authored-voice">${events}</music-voice>` : events}
  </music-measure></music-staff></music-system>`;
const silentEvent = '<music-rest id="silent" measure></music-rest>';
const silentVoiceSource = (voiceIndex: number, implicit = false): string => `<music-system id="hud-score"><music-staff id="staff" label="Flute"><music-measure id="bar">
  ${implicit ? silentEvent : [0, 1].map(index => `<music-voice id="voice-${index + 1}">${index === voiceIndex ? silentEvent : events}</music-voice>`).join('')}
  </music-measure></music-staff></music-system>`;
const silentVoices = [
  { name: 'second explicit voice', voiceIndex: 1, implicit: false },
  { name: 'first explicit voice', voiceIndex: 0, implicit: false },
  { name: 'implicit voice', voiceIndex: 0, implicit: true },
];

let app: AuthorWorkspace | undefined;
let hostWidth = 900;
let pageScroll = 0;
let sequence = 0;
let visual: VisualViewportDouble;
let releaseEngraving: (() => void) | undefined;
const dimensionDescriptors = new Map<string, PropertyDescriptor | undefined>();
const observers: ResizeObserverDouble[] = [];

class ResizeObserverDouble implements ResizeObserver {
  readonly targets = new Set<Element>();
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this); }
  observe(target: Element): void { this.targets.add(target); }
  unobserve(target: Element): void { this.targets.delete(target); }
  disconnect(): void { this.targets.clear(); }
  fire(): void {
    this.callback([...this.targets].map(target => ({ target, contentRect: new DOMRect(0, 0, hostWidth, 1000),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] })), this);
  }
}
class VisualViewportDouble extends EventTarget {
  offsetLeft = 0; offsetTop = 0; width = 1180; height = 660;
}
function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id); if (!element) throw new Error(`Missing Author control #${id}`); return element as T;
}
function surface(): MusicSurface {
  const element = control('score-host').shadowRoot!.querySelector('music-system');
  if (!(element instanceof MusicSurface)) throw new Error('The real workspace did not mount its MusicSurface.'); return element;
}
function dimensions(element: HTMLElement, width: () => number, height: () => number, rect: () => DOMRect): void {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: width }, clientWidth: { configurable: true, get: width },
    offsetHeight: { configurable: true, get: height }, clientHeight: { configurable: true, get: height },
    scrollWidth: { configurable: true, get: () => Math.max(1200, width()) }, scrollHeight: { configurable: true, get: () => Math.max(1000, height()) },
    getBoundingClientRect: { configurable: true, value: rect },
  });
}
function matrix(e: number, f: number): DOMMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e, f, inverse: () => matrix(-e, -f) } as DOMMatrix;
}

/** The adapter double retains every real model/source/voice ID it receives. */
function draw(container: HTMLElement, score: Score): EngravingResult {
  const viewport = control('score-scroll');
  const row = document.createElement('div'); row.className = 'system-row'; row.style.overflow = 'auto';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('notation-svg');
  svg.setAttribute('viewBox', '0 0 1200 1000'); svg.setAttribute('width', '1200'); svg.setAttribute('height', '1000');
  row.append(svg); container.replaceChildren(row);
  dimensions(row, () => hostWidth, () => 1000, () => new DOMRect(40 - viewport.scrollLeft, 80 - pageScroll - viewport.scrollTop, hostWidth, 1000));
  Object.defineProperty(svg, 'getScreenCTM', { value: () => matrix(40 - viewport.scrollLeft - row.scrollLeft, 80 - pageScroll - viewport.scrollTop) });
  const eventGeometry: EventGeometry[] = []; const measures: MeasureGeometry[] = []; const markings: MarkingGeometry[] = [];
  const anchors: InsertionAnchor[] = [];
  for (const [staffIndex, staff] of score.staves.entries()) for (const [measureIndex, measure] of staff.measures.entries()) {
    const topLine = 140 + staffIndex * 160;
    // Like the real adapter, all voices share one exact onset timeline. Distinct
    // coordinates for equal-onset voices would manufacture an impossible bug.
    const onsets = [...new Map([rational(0), ...measure.voices.flatMap(voice => voice.events.flatMap(event => [event.onset, add(event.onset, event.time)]))]
      .map(onset => [formatRational(onset), onset])).values()].sort(compare);
    const onsetX = (onset: InsertionAnchor['onset']) => 200 + onsets.findIndex(candidate => compare(candidate, onset) === 0) * 120;
    measures.push({ sourceId: measure.id, staffId: staff.id, system: 0, measureIndex,
      x: 20, y: topLine - 20, width: 1160, height: 140, topLine, bottomLine: topLine + 40, noteStartX: 180, noteEndX: 1100 });
    for (const [voiceIndex, voice] of measure.voices.entries()) for (const [eventIndex, event] of voice.events.entries()) {
      const x = onsetX(event.onset); const y = 155 + staffIndex * 160 + voiceIndex * 35;
      eventGeometry.push({ sourceId: event.id, system: 0, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
        x: x - 10, y: y - 25, width: 38, height: 50, onset: event.onset, anchorX: x, anchorY: topLine + 20,
        ink: { x: x - 10, y: y - 25, width: 38, height: 50 }, sharedSourceIds: [event.id],
        noteheads: event.pitches.map((_, pitchIndex) => ({ pitchIndex, x, y: y + pitchIndex * 10, width: 12, height: 10, centerX: x + 6, centerY: y + pitchIndex * 10 + 5 })) });
      for (const [index, mark] of (event.markings ?? []).entries()) markings.push({ sourceId: mark.id, eventId: event.id,
        staffId: staff.id, measureId: measure.id, voiceId: voice.id, system: 0, kind: mark.kind, placement: 'above',
        x: x + index * 18, y: y - 25, width: 12, height: 12 });
    }
    for (const voice of measure.voices) for (let eventIndex = 0; eventIndex <= voice.events.length; eventIndex++) {
      const before = voice.events[eventIndex]; const after = voice.events[eventIndex - 1];
      const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
      anchors.push({ sourceId: voice.id, system: 0, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
        ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}),
        onset, x: onsetX(onset), y: topLine, height: 40 });
    }
  }
  const geometry: SystemGeometry = { index: 0, start: 0, end: score.staves[0].measures.length, width: 1200, height: 1000,
    viewBox: { x: 0, y: 0, width: 1200, height: 1000 }, ink: { x: 20, y: 120, width: 1160, height: score.staves.length * 160 },
    pageBreak: false, staves: [], measures, events: eventGeometry, markings, annotations: [], tuplets: [], anchors };
  return { systems: [], hitRegions: eventGeometry, diagnostics: [], systemGeometry: [geometry] };
}

async function nextTask(): Promise<void> { await new Promise<void>(resolve => setTimeout(resolve, 0)); }
async function settled(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await nextTask();
    if (document.body.dataset.renderState === 'error') throw new Error(control('author-errors').textContent ?? 'Render error');
    if (document.body.dataset.renderState === 'ready' && surface().getLayoutGeometry()) return;
  }
  throw new Error(`Author rendering did not settle: ${document.body.dataset.renderState}`);
}
async function mount(explicit = true, contextualHud = true, html = source(explicit)): Promise<void> {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `hud-workspace-${++sequence}`, writerId: 'hud-workspace-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(html, 'HUD workspace boundary'), recovery, contextualHud });
  const viewport = control('score-scroll');
  const mount = control('score-host').shadowRoot!.querySelector<HTMLElement>('.score-mount')!;
  dimensions(mount, () => hostWidth, () => 1000, () => new DOMRect(40, 80 - pageScroll - viewport.scrollTop, hostWidth, 1000));
  await settled();
  // Prime only AuthorWorkspace's observer. Surface and HUD observers remain real
  // registrations but do not receive synthetic size notifications accidentally.
  workspaceObserver().fire(); await settled();
}
function workspaceObserver(): ResizeObserverDouble {
  const observer = observers.find(item => item.targets.has(control('score-host')));
  if (!observer) throw new Error('AuthorWorkspace did not observe its score host.'); return observer;
}
async function select(id = 'note'): Promise<void> {
  const sourceElement = surface().getSource(id); expect(sourceElement).toBeDefined();
  control('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } }));
  await nextTask();
  expect(app!.session.selectionId).toBe(id === 'accent' ? 'note' : id);
}
function expectFloating(): void {
  expect(control('selection-controls').dataset.selectionPlacement).toBe('floating');
  expect(control('selection-controls').style.position).toBe('fixed');
}
function expectDocked(): void {
  expect(control('selection-controls').dataset.selectionPlacement).toBe('dock');
  expect(control('selection-controls').style.position).not.toBe('fixed');
}
function press(): void {
  const button = control('selection-sharp'); expect(button.matches(':disabled')).toBe(false);
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true }));
}
function openPicker(): void {
  control('selection-value').click(); expect(control('selection-value-chooser').hidden).toBe(false);
}
function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision, selection: app!.session.selection,
    undo: app!.session.canUndo, redo: app!.session.canRedo, cursor: app!.session.cursor,
    layouts: structuredClone(app!.session.project.layouts) };
}
function noEdit(before: ReturnType<typeof accepted>): void {
  expect(accepted()).toEqual(before);
}
function replaceProjected(score: Score, layout: LayoutGeometry): void {
  vi.spyOn(surface(), 'score', 'get').mockReturnValue(score);
  vi.spyOn(surface(), 'getLayoutGeometry').mockReturnValue(layout);
}

beforeEach(async () => {
  hostWidth = 900; pageScroll = 0; observers.length = 0; releaseEngraving = undefined;
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  for (const [name, value] of Object.entries({ innerWidth: 1180, innerHeight: 660 })) {
    dimensionDescriptors.set(name, Object.getOwnPropertyDescriptor(window, name)); Object.defineProperty(window, name, { configurable: true, value });
  }
  visual = new VisualViewportDouble(); vi.stubGlobal('visualViewport', visual); vi.stubGlobal('ResizeObserver', ResizeObserverDouble);
  vi.stubGlobal('DOMPoint', class {
    readonly x: number; readonly y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    matrixTransform(m: DOMMatrix) { return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f }; }
  });
  for (const element of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(element, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const style = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = style(element, pseudo);
    return element.classList.contains('surface') ? new Proxy(computed, { get(target, property) {
      return property === 'width' ? `${hostWidth}px` : Reflect.get(target, property, target);
    } }) : computed;
  });
  const viewport = control('score-scroll'); viewport.style.overflow = 'auto';
  dimensions(viewport, () => 900, () => 500, () => new DOMRect(40, 80 - pageScroll, 900, 500));
  dimensions(control('score-host'), () => hostWidth, () => 1000, () => new DOMRect(40, 80 - pageScroll - viewport.scrollTop, hostWidth, 1000));
  const controls = control('selection-controls');
  Object.defineProperty(controls, 'getBoundingClientRect', { configurable: true, value: () => controls.style.position === 'fixed'
    ? new DOMRect(Number.parseFloat(controls.style.left), Number.parseFloat(controls.style.top), 260, 44)
    : new DOMRect(140, 592 - pageScroll, 260, 44) });
  engine.ready.mockReset().mockResolvedValue(); engine.render.mockReset().mockImplementation(draw);
  // Match the existing component lifecycle fixture's dynamic-import safeguard.
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready); vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
});
afterEach(async () => {
  app?.dispose(); app = undefined; document.body.replaceChildren(); releaseEngraving?.(); await nextTask();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of dimensionDescriptors) if (descriptor) Object.defineProperty(window, name, descriptor);
  dimensionDescriptors.clear();
});

describe('HUD-OUTER-VIEWPORT: real workspace event wiring', () => {
  it.each(['press', 'picker'] as const)('outer score scrolling cancels an unsafe %s and docks without musical history', async interaction => {
    await mount(); await select(); expectFloating();
    const before = accepted(); const cancel = vi.spyOn(SelectionControls.prototype, 'cancel');
    if (interaction === 'press') press(); else openPicker();
    cancel.mockClear();
    control('score-scroll').scrollTop = 10;
    control('score-scroll').dispatchEvent(new Event('scroll')); // Native scroll does not bubble from an ancestor into score-mount.
    expectDocked(); expect(cancel).toHaveBeenCalledOnce();
    if (interaction === 'picker') expect(control('selection-value-chooser').hidden).toBe(true);
    else control('selection-sharp').click(); // The canceled press's delivered activation must not edit.
    noEdit(before); expect(control('score-scroll').scrollTop).toBe(10);
  });

  it.each(['resize', 'scroll'] as const)('visualViewport %s cancels an unsafe open chooser without waiting for a window event', async type => {
    await mount(); await select(); expectFloating(); openPicker(); const before = accepted();
    const cancel = vi.spyOn(SelectionControls.prototype, 'cancel');
    if (type === 'resize') visual.width = 350; else visual.offsetTop = 200;
    visual.dispatchEvent(new Event(type));
    expectDocked(); expect(cancel).toHaveBeenCalledOnce(); expect(control('selection-value-chooser').hidden).toBe(true); noEdit(before);
  });

  it('window scrolling rechecks the live SVG transform during a press', async () => {
    await mount(); await select(); expectFloating(); press(); const before = accepted();
    pageScroll = 10; window.dispatchEvent(new Event('scroll'));
    expectDocked(); control('selection-sharp').click(); noEdit(before);
  });

  it('keeps the real inner-system scroll listener connected through MusicSurface shadow DOM', async () => {
    await mount(); await select(); expectFloating(); press(); const before = accepted();
    const row = surface().shadowRoot!.querySelector<HTMLElement>('.screen .system-row')!;
    row.scrollLeft = 500; row.dispatchEvent(new Event('scroll'));
    expectDocked(); control('selection-sharp').click(); noEdit(before);
  });

  it('returns focused Value chooser input to a usable related control when unsafe outer scroll docks it', async () => {
    await mount(); await select(); expectFloating(); openPicker();
    control('selection-duration').focus(); expect(document.activeElement).toBe(control('selection-duration'));
    const before = accepted(); const cancel = vi.spyOn(SelectionControls.prototype, 'cancel');
    control('score-scroll').scrollTop = 10; control('score-scroll').dispatchEvent(new Event('scroll'));
    expectDocked(); expect(cancel).toHaveBeenCalledOnce(); expect(control('selection-value-chooser').hidden).toBe(true);
    await Promise.resolve();
    const focused = document.activeElement as HTMLElement;
    expect(focused).toBe(control('selection-value')); expect(focused.isConnected).toBe(true);
    expect(focused.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull(); expect(focused.matches(':disabled')).toBe(false);
    noEdit(before); expect(control('score-scroll').scrollTop).toBe(10);
  });

  it('does not steal newly focused native Source input during the post-dock focus microtask', async () => {
    await mount(); await select(); expectFloating(); openPicker(); control('selection-duration').focus();
    const before = accepted();
    control('score-scroll').scrollTop = 10; control('score-scroll').dispatchEvent(new Event('scroll'));
    expectDocked(); expect(control('selection-value-chooser').hidden).toBe(true);
    control('source-trigger').click(); control('source-input').focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(control('source-input')); expect(control('source-panel').hidden).toBe(false);
    noEdit(before); expect(control('score-scroll').scrollTop).toBe(10);
  });
});

describe('HUD-RENDER-START: current geometry is revoked before asynchronous engraving', () => {
  it.each(['press', 'picker'] as const)('starting an observed relayout docks an active %s before fonts settle', async interaction => {
    await mount(); await select(); expectFloating();
    if (interaction === 'press') press(); else openPicker();
    const before = accepted(); const cancel = vi.spyOn(SelectionControls.prototype, 'cancel');
    const waiting = new Promise<void>(resolve => { releaseEngraving = resolve; }); engine.ready.mockImplementation(() => waiting);
    hostWidth = 820; workspaceObserver().fire();
    expect(document.body.dataset.renderState).toBe('rendering');
    expectDocked(); expect(cancel).toHaveBeenCalledOnce();
    if (interaction === 'picker') expect(control('selection-value-chooser').hidden).toBe(true);
    else control('selection-sharp').click();
    noEdit(before); await nextTask(); expect(document.body.dataset.renderState).toBe('rendering');
    releaseEngraving!(); await settled(); noEdit(before);
  });
});

describe('HUD-SOURCE-DRAFT: accepted geometry does not keep editing controls floating', () => {
  it('docks immediately when real Source input creates an unapplied draft, without waiting for scroll or render', async () => {
    await mount(); await select(); expectFloating();
    control('source-trigger').click(); expectFloating();
    const before = accepted(); const geometry = surface().getLayoutGeometry(); const renderCount = engine.render.mock.calls.length;
    const draft = before.source.replace('pitch="F4"', 'pitch="F#4"'); expect(draft).not.toBe(before.source);
    const input = control<HTMLTextAreaElement>('source-input'); input.value = draft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(app!.session.project.pendingSource).toBe(draft);
    expect(control('selection-sharp').matches(':disabled')).toBe(true);
    expectDocked();
    expect(surface().getLayoutGeometry()).toEqual(geometry); expect(engine.render).toHaveBeenCalledTimes(renderCount);
    expect(accepted()).toEqual({ ...before, revision: before.revision + 1 });
    expect(control('score-scroll').scrollLeft).toBe(0); expect(control('score-scroll').scrollTop).toBe(0);
  });
});

describe('ENTRY-VOICE: accepted source and the current insertion anchor', () => {
  it.each(silentVoices)('rejects an overfull $name at Source Apply, even with an incomplete measure', async ({ voiceIndex, implicit }) => {
    await mount(!implicit, true, silentVoiceSource(voiceIndex, implicit)); await select('silent');
    const before = accepted(); const geometry = surface().getLayoutGeometry(); const renderCount = engine.render.mock.calls.length;
    const template = document.createElement('template'); template.innerHTML = before.source;
    const invalid = document.createElement('music-note'); invalid.id = 'overfull'; invalid.setAttribute('pitch', 'F4'); invalid.setAttribute('duration', 'breve');
    template.content.querySelector('#silent')!.replaceWith(invalid); template.content.querySelector('music-measure')!.setAttribute('incomplete', '');
    const draft = template.innerHTML;
    control('source-trigger').click(); const input = control<HTMLTextAreaElement>('source-input'); input.value = draft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    control('source-apply').click();
    expect(control('source-error').hidden).toBe(false);
    expect(control('source-error').textContent).toContain('Voice contains 2 whole notes');
    expect(control('source-error').textContent).toContain('this meter allows 1');
    expect(app!.session.project.pendingSource).toBe(draft);
    expect(app!.session.score.staves[0].measures[0].voices[voiceIndex].events).toMatchObject([{ id: 'silent', measureRest: true }]);
    expect(accepted()).toEqual({ ...before, revision: before.revision + 1 });
    expect(surface().getLayoutGeometry()).toEqual(geometry); expect(engine.render).toHaveBeenCalledTimes(renderCount);
  });

  it.each(silentVoices)('accepts an explicitly unfinished empty $name through Source and restores its rest with Undo', async ({ voiceIndex, implicit }) => {
    await mount(!implicit, true, silentVoiceSource(voiceIndex, implicit)); await select('silent');
    const before = accepted(); const columns = structuredClone(app!.session.project.columns);
    const template = document.createElement('template'); template.innerHTML = before.source;
    template.content.querySelector('#silent')!.remove(); template.content.querySelector('music-measure')!.setAttribute('incomplete', '');
    control('source-trigger').click(); const input = control<HTMLTextAreaElement>('source-input'); input.value = template.innerHTML;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    control('source-apply').click(); await settled();
    expect(control('source-error').hidden).toBe(true);
    expect(app!.session.project.pendingSource).toBeNull();
    const measure = app!.session.score.staves[0].measures[0];
    expect(measure.incomplete).toBe(true); expect(measure.voices).toHaveLength(implicit ? 1 : 2);
    expect(measure.voices[voiceIndex].events).toEqual([]);
    expect(app!.session.source.querySelector('#silent')).toBeNull();
    expect(surface().getLayoutGeometry()!.systems[0].events.some(event => event.sourceId === 'silent')).toBe(false);
    expect(app!.session.project.columns).toEqual(columns); expectDocked();
    control('undo').click(); await settled();
    expect(app!.session.project.sourceHtml).toBe(before.source);
    expect(app!.session.score.staves[0].measures[0].voices[voiceIndex].events).toMatchObject([{ id: 'silent', measureRest: true }]);
  });

  it.each(silentVoices)('starts writing in the empty $name at that projected voice’s zero anchor', async ({ voiceIndex, implicit }) => {
    const blank = silentVoiceSource(voiceIndex, implicit).replace(silentEvent, '').replace('<music-measure id="bar">', '<music-measure id="bar" incomplete>');
    await mount(!implicit, true, blank);
    const before = app!.session.project.sourceHtml;
    control('location-trigger').click();
    const voiceControl = control<HTMLSelectElement>('event-voice'); voiceControl.value = String(voiceIndex);
    voiceControl.dispatchEvent(new Event('change', { bubbles: true }));
    control('start-entry-here').click(); await settled();
    expect(app!.session.cursor).toMatchObject({ staffId: 'staff', measureId: 'bar', voiceIndex });
    expect(app!.session.cursor!.eventId).toBeUndefined();
    const projected = surface().score!.staves[0].measures[0].voices[voiceIndex];
    expect(projected.events).toEqual([]);
    const matching = surface().getLayoutGeometry()!.systems[0].anchors.filter(anchor => anchor.measureId === 'bar' && anchor.voiceId === projected.id);
    expect(matching).toHaveLength(1);
    const anchor = matching[0]; expect(anchor.eventIndex).toBe(0); expect(anchor.onset).toEqual(rational(0));
    expect(anchor.beforeId).toBeUndefined(); expect(anchor.afterId).toBeUndefined();
    const caret = control('score-host').shadowRoot!.querySelector<HTMLElement>('.author-caret'); expect(caret).not.toBeNull();
    expect(caret!.dataset.sourceId).toBe(projected.id);
    const svg = surface().shadowRoot!.querySelector<SVGSVGElement>('.screen svg.notation-svg')!;
    const point = new DOMPoint(anchor.x, anchor.y - 8).matrixTransform(svg.getScreenCTM()!);
    const host = control('score-host').getBoundingClientRect();
    expect(Number.parseFloat(caret!.style.left)).toBeCloseTo(point.x - host.left - 3, 6);
    expect(Number.parseFloat(caret!.style.top)).toBeCloseTo(point.y - host.top - 3, 6);
    expect(control('score-host').shadowRoot!.querySelectorAll('.author-caret')).toHaveLength(1);
    expect(control('remaining-time').textContent).toContain('Empty draft');
    control('tools-toggle').click(); control('tool-tab-measure').click(); await settled();
    expect(control('workspace-tools').hidden).toBe(false); expect(control('measure-inspector').hidden).toBe(false);
    expect(control<HTMLButtonElement>('review-short-measure').disabled).toBe(true);
    expect(control('short-ending-empty-help').hidden).toBe(false);
    expect(control('short-ending-empty-help').closest('[hidden]')).toBeNull();
    expect(control('short-ending-empty-help').textContent).toContain('Fill remainder with rests');
    expect(control('review-short-measure').getAttribute('aria-describedby')).toContain('short-ending-empty-help');
    expect(app!.session.project.sourceHtml).toBe(before); expect(app!.session.canUndo).toBe(false);
  });

  it('names Return to target before offering Fill for an empty held measure elsewhere', async () => {
    const html = '<music-system id="hud-score"><music-staff id="staff" label="Flute"><music-measure id="bar" incomplete><music-voice id="empty"></music-voice></music-measure><music-measure id="later"><music-note id="later-note" pitch="G4" duration="whole"></music-note></music-measure></music-staff></music-system>';
    await mount(true, false, html);
    control('score-editor').focus();
    control('score-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
    await settled(); expect(control('measure-inspector').hidden).toBe(false);
    const groups = control<HTMLInputElement>('measure-groups'); groups.value = '2+2';
    groups.dispatchEvent(new Event('input', { bubbles: true }));
    await select('later-note');
    const before = app!.session.project.sourceHtml;
    expect(groups.value).toBe('2+2'); expect(control('return-measure-draft').hidden).toBe(false);
    const help = control('short-ending-empty-help');
    expect(help.hidden).toBe(false); expect(help.textContent).toContain('Return to target');
    expect(help.textContent).not.toContain('rests below');
    control('return-measure-draft').click(); await settled();
    expect(app!.session.selectionId).toBe('bar'); expect(groups.value).toBe('2+2');
    expect(help.textContent).toContain('Fill remainder with rests below');
    expect(app!.session.project.sourceHtml).toBe(before); expect(app!.session.canUndo).toBe(false);
  });

  it.each(silentVoices)('shows the valid $name full-rest entry caret at its projected source anchor', async ({ voiceIndex, implicit }) => {
    await mount(!implicit, true, silentVoiceSource(voiceIndex, implicit));
    const sourceBefore = app!.session.project.sourceHtml; const layoutBefore = structuredClone(app!.session.project.layouts);
    control('location-trigger').click();
    const voiceControl = control<HTMLSelectElement>('event-voice'); voiceControl.value = String(voiceIndex);
    voiceControl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app!.session.selectionId).toBe('silent');
    const position = control<HTMLSelectElement>('insert-position'); position.value = 'before';
    position.dispatchEvent(new Event('change', { bubbles: true }));
    control('start-entry-here').click(); await settled();
    expect(app!.session.cursor).toMatchObject({ staffId: 'staff', measureId: 'bar', voiceIndex, eventId: 'silent' });
    const projected = surface().score!.staves[0].measures[0].voices[voiceIndex];
    if (implicit) expect(projected.id).not.toBe(app!.session.score.staves[0].measures[0].voices[voiceIndex].id);
    const layout = surface().getLayoutGeometry()!;
    const matching = layout.systems[0].anchors.filter(anchor => anchor.measureId === 'bar' && anchor.beforeId === 'silent');
    expect(matching).toHaveLength(1);
    const anchor = matching[0]; expect(anchor.voiceId).toBe(projected.id); expect(anchor.eventIndex).toBe(0);
    // Equal onset means equal staff coordinates, irrespective of voice identity.
    for (const other of layout.systems[0].anchors.filter(candidate => compare(candidate.onset, anchor.onset) === 0)) {
      expect({ x: other.x, y: other.y }).toEqual({ x: anchor.x, y: anchor.y });
    }
    const svg = surface().shadowRoot!.querySelector<SVGSVGElement>(`.${layout.projection} svg.notation-svg`)!;
    const caret = control('score-host').shadowRoot!.querySelector<HTMLElement>('.author-caret'); expect(caret).not.toBeNull();
    const point = new DOMPoint(anchor.x, anchor.y - 8).matrixTransform(svg.getScreenCTM()!);
    const host = control('score-host').getBoundingClientRect();
    expect(Number.parseFloat(caret!.style.left)).toBeCloseTo(point.x - host.left - 3, 6);
    expect(Number.parseFloat(caret!.style.top)).toBeCloseTo(point.y - host.top - 3, 6);
    expect(control('score-host').shadowRoot!.querySelectorAll('.author-caret')).toHaveLength(1);
    expect(app!.session.project.sourceHtml).toBe(sourceBefore); expect(app!.session.project.layouts).toEqual(layoutBefore);
    expect(app!.session.revision).toBe(0); expect(app!.session.canUndo).toBe(false); expectDocked();
  });
});

describe('HUD-IMPLICIT-VOICE: stable source membership with projected voice identities', () => {
  it.each(['note', 'accent'])('maps %s through the real projected model when its implicit voice alias changes', async id => {
    await mount(false);
    const canonicalVoice = app!.session.score.staves[0].measures[0].voices[0];
    const projectedVoice = surface().score!.staves[0].measures[0].voices[0];
    expect(projectedVoice.id).not.toBe(canonicalVoice.id);
    expect(surface().getSource(projectedVoice.id)?.localName).toBe('music-measure');
    expect(surface().getLayoutGeometry()!.systems[0].events.find(event => event.sourceId === 'note')!.voiceId).toBe(projectedVoice.id);
    const sourceBefore = app!.session.project.sourceHtml; await select(id); expectFloating();
    expect(app!.session.project.sourceHtml).toBe(sourceBefore); expect(app!.session.revision).toBe(0); expect(app!.session.canUndo).toBe(false);
  });

  it('retains authored voice IDs rather than accepting an unrelated explicit voice with the same event ID', async () => {
    await mount(); await select(); expectFloating(); const before = accepted();
    const score = surface().score!; const layout = surface().getLayoutGeometry()!;
    replaceProjected({ ...score, staves: score.staves.map(staff => ({ ...staff, measures: staff.measures.map(measure => ({ ...measure,
      voices: measure.voices.map(voice => ({ ...voice, id: 'unrelated-explicit-voice' })) })) })) },
    { ...layout, systems: layout.systems.map(system => ({ ...system,
      events: system.events.map(event => ({ ...event, voiceId: 'unrelated-explicit-voice' })),
      markings: system.markings?.map(mark => ({ ...mark, voiceId: 'unrelated-explicit-voice' })) })) });
    window.dispatchEvent(new Event('resize')); expectDocked(); noEdit(before);
  });

  it('rejects wrong staff membership instead of finding the stable ID in another staff', async () => {
    await mount(false); await select(); expectFloating(); const before = accepted();
    const score = surface().score!; const layout = surface().getLayoutGeometry()!;
    replaceProjected({ ...score, staves: score.staves.map(staff => ({ ...staff, id: 'unrelated-staff' })) },
      { ...layout, systems: layout.systems.map(system => ({ ...system,
        events: system.events.map(event => ({ ...event, staffId: 'unrelated-staff' })),
        markings: system.markings?.map(mark => ({ ...mark, staffId: 'unrelated-staff' })) })) });
    window.dispatchEvent(new Event('resize')); expectDocked(); noEdit(before);
  });

  it('rejects inconsistent geometric voice ownership even when the projected model still contains the event', async () => {
    await mount(false); await select(); expectFloating(); const before = accepted();
    const layout = surface().getLayoutGeometry()!;
    vi.spyOn(surface(), 'getLayoutGeometry').mockReturnValue({ ...layout, systems: layout.systems.map(system => ({ ...system,
      events: system.events.map(event => ({ ...event, voiceId: 'wrong-geometry-voice' })) })) });
    window.dispatchEvent(new Event('resize')); expectDocked(); noEdit(before);
  });

  it('preserves the default-off production gate even with current, measurable geometry', async () => {
    await mount(false, false); await select(); expectDocked(); expect(surface().getLayoutGeometry()).toBeDefined();
    expect(control('selection-controls').hidden).toBe(false);
  });
});
