// @vitest-environment happy-dom
/**
 * Real AuthorWorkspace, WritingFrame, WorkspaceTools, MusicSurface scheduling,
 * and musical viewport restoration. Engraving and layout measurements are
 * explicit doubles. These tests do not qualify native geometry, CSS fit,
 * popovers, pointer capture, touch, or PDF output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult, EventGeometry, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import type { Score } from '../src/model/types.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));
import '../src/engraving/render.js';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { MusicSurface } from '../src/components/music-surface.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = `<music-system id="frame-score">${['upper', 'lower'].map((staff, staffIndex) =>
  `<music-staff id="${staff}" label="${staffIndex ? 'Lower piano' : 'Upper piano'}" clef="${staffIndex ? 'bass' : 'treble'}">${Array.from({ length: 64 }, (_, index) =>
    `<music-measure id="${staff}-bar-${index + 1}" number="${index + 1}"><music-voice id="${staff}-voice-${index + 1}"><music-note id="${staff}-note-${index + 1}" pitch="${staffIndex ? 'C3' : 'F4'}" duration="whole"></music-note></music-voice></music-measure>`).join('')}</music-staff>`).join('')}</music-system>`;

let app: AuthorWorkspace | undefined;
let workbenchWidth = 1400;
let contentHeight = 13000;
let sequence = 0;
let releaseEngraving: (() => void) | undefined;
const observers: ResizeObserverDouble[] = [];
const dimensionsBefore = new Map<string, PropertyDescriptor | undefined>();

class ResizeObserverDouble implements ResizeObserver {
  readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this); }
  observe(element: Element): void { this.targets.add(element); }
  unobserve(element: Element): void { this.targets.delete(element); }
  disconnect(): void { this.targets.clear(); }
  fire(): void {
    this.callback([...this.targets].map(target => ({ target, contentRect: target.getBoundingClientRect(),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] })), this);
  }
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element as T;
}
function surface(): MusicSurface {
  const element = el('score-host').shadowRoot!.querySelector('music-system');
  if (!(element instanceof MusicSurface)) throw new Error('The workspace did not mount its real MusicSurface.');
  return element;
}
function paperWidth(): number { return Number.parseFloat(el('author-workbench').style.getPropertyValue('--writing-frame-width')) || Math.min(960, workbenchWidth); }
function hostWidth(): number { return Math.max(1, paperWidth() - 20); }
function matrix(e: number, f: number): DOMMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e, f, inverse: () => matrix(-e, -f) } as DOMMatrix;
}
function dimensions(element: HTMLElement, width: () => number, height: () => number, rect: () => DOMRect,
  scrollWidth = width, scrollHeight = height): void {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: width }, clientWidth: { configurable: true, get: width },
    offsetHeight: { configurable: true, get: height }, clientHeight: { configurable: true, get: height },
    scrollWidth: { configurable: true, get: scrollWidth }, scrollHeight: { configurable: true, get: scrollHeight },
    getBoundingClientRect: { configurable: true, value: rect },
  });
}

/** Deterministic measured geometry with real source IDs and two tall staves. */
function draw(container: HTMLElement, score: Score, options: EngravingOptions): EngravingResult {
  const viewport = el('score-scroll');
  const perSystem = options.width >= 800 ? 2 : 1;
  const firstPitch = score.staves[0].measures[0].voices[0].events[0]?.pitches[0];
  // Explicitly simulate added first-system clearance from a high ledger note.
  // This makes later musical anchors move without claiming engine ink metrics.
  const addedClearance = firstPitch && firstPitch.octave >= 6 ? 80 : 0;
  const count = Math.ceil(score.staves[0].measures.length / perSystem);
  const systems: SystemGeometry[] = [];
  const rows: HTMLElement[] = [];
  contentHeight = count * 380 + addedClearance;
  dimensions(container, hostWidth, () => contentHeight,
    () => new DOMRect(24, 80 - viewport.scrollTop, hostWidth(), contentHeight));
  const wrapper = container.parentElement!;
  dimensions(wrapper, hostWidth, () => contentHeight,
    () => new DOMRect(24, 80 - viewport.scrollTop, hostWidth(), contentHeight));
  for (let index = 0; index < count; index++) {
    const start = index * perSystem, end = Math.min(start + perSystem, score.staves[0].measures.length);
    const top = index * 380 + (index ? addedClearance : 0);
    const height = 380 + (index ? 0 : addedClearance);
    const row = document.createElement('div'); row.className = 'system-row'; row.dataset.systemIndex = String(index); row.style.overflow = 'auto';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('notation-svg');
    svg.setAttribute('viewBox', `0 0 1800 ${height}`); svg.setAttribute('width', '1800'); svg.setAttribute('height', String(height));
    row.append(svg); rows.push(row);
    dimensions(row, hostWidth, () => height, () => new DOMRect(24 - viewport.scrollLeft, 80 + top - viewport.scrollTop, hostWidth(), height), () => 1800);
    Object.defineProperty(svg, 'getScreenCTM', { value: () => matrix(24 - viewport.scrollLeft - row.scrollLeft, 80 + top - viewport.scrollTop) });
    const events: EventGeometry[] = [], measures: MeasureGeometry[] = [];
    for (const [staffIndex, staff] of score.staves.entries()) for (let measureIndex = start; measureIndex < end; measureIndex++) {
      const measure = staff.measures[measureIndex], x = 200 + (measureIndex - start) * 800, topLine = 80 + staffIndex * 160;
      measures.push({ sourceId: measure.id, staffId: staff.id, system: index, measureIndex,
        x: x - 150, y: topLine - 30, width: 750, height: 130, topLine, bottomLine: topLine + 40,
        noteStartX: x - 20, noteEndX: x + 530 });
      for (const [voiceIndex, voice] of measure.voices.entries()) for (const [eventIndex, event] of voice.events.entries()) {
        const y = topLine + 10 + voiceIndex * 20;
        events.push({ sourceId: event.id, system: index, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
          x: x - 8, y: y - 20, width: 32, height: 50, onset: event.onset, anchorX: x, anchorY: topLine + 20,
          ink: { x: x - 8, y: y - 20, width: 32, height: 50 }, sharedSourceIds: [event.id],
          noteheads: event.pitches.map((_, pitchIndex) => ({ pitchIndex, x, y: y + pitchIndex * 10, width: 12, height: 10,
            centerX: x + 6, centerY: y + pitchIndex * 10 + 5 })) });
      }
    }
    systems.push({ index, start, end, width: 1800, height, viewBox: { x: 0, y: 0, width: 1800, height },
      ink: { x: 40, y: 40, width: 1680, height: height - 60 }, pageBreak: false, staves: [],
      measures, events, annotations: [], markings: [], tuplets: [], anchors: [] });
  }
  container.replaceChildren(...rows);
  return { systems: [], diagnostics: [], hitRegions: systems.flatMap(system => system.events), systemGeometry: systems };
}

async function nextTask(): Promise<void> { await new Promise<void>(resolve => setTimeout(resolve, 0)); }
async function settled(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await nextTask();
    if (document.body.dataset.renderState === 'error') throw new Error(el('author-errors').textContent ?? 'Render failed.');
    if (document.body.dataset.renderState === 'ready' && surface().getLayoutGeometry()) return;
  }
  throw new Error(`The real Author render did not settle (${document.body.dataset.renderState}).`);
}
function workspaceObserver(): ResizeObserverDouble {
  const observer = observers.find(item => item.targets.has(el('author-workbench')) && item.targets.has(el('score-host')));
  if (!observer) throw new Error('Author did not observe the independent workbench.');
  return observer;
}
async function mount(width = 1400): Promise<void> {
  workbenchWidth = width;
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `writing-frame-workspace-${++sequence}`, writerId: 'frame-test',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Visible paper anchor'), recovery });
  const viewport = el('score-scroll'), mount = el('score-host').shadowRoot!.querySelector<HTMLElement>('.score-mount')!;
  dimensions(mount, hostWidth, () => contentHeight, () => new DOMRect(24, 80 - viewport.scrollTop, hostWidth(), contentHeight));
  await settled(); workspaceObserver().fire(); await settled();
}
function available(element: HTMLElement): boolean {
  return !element.closest('[hidden], [inert], [aria-hidden="true"]') && !element.matches(':disabled');
}
async function click(id: string): Promise<void> {
  expect(available(el(id)), `#${id} must be available`).toBe(true); el(id).click(); await nextTask();
}
async function select(id = 'upper-note-8'): Promise<void> {
  const sourceElement = surface().getSource(id); expect(sourceElement).toBeDefined();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } })); await nextTask(); expect(app!.session.selectionId).toBe(id);
}
function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision, selection: app!.session.selection,
    cursor: app!.session.cursor, undo: app!.session.canUndo, redo: app!.session.canRedo,
    layouts: structuredClone(app!.session.project.layouts), parts: structuredClone(app!.session.project.parts),
    recipe: Object.fromEntries(['event-kind', 'event-pitch', 'event-duration', 'event-dots', 'insert-position'].map(id => [id, el<HTMLInputElement>(id).value])) };
}
function rowFor(id = 'lower-note-48'): HTMLElement {
  const geometry = surface().getLayoutGeometry()!.systems.find(system => system.events.some(event => event.sourceId === id));
  if (!geometry) throw new Error(`Missing measured event ${id}.`);
  return surface().shadowRoot!.querySelector<HTMLElement>(`.screen .system-row[data-system-index="${geometry.index}"]`)!;
}
function point(id = 'lower-note-48') {
  const layout = surface().getLayoutGeometry()!;
  const system = layout.systems.find(item => item.events.some(event => event.sourceId === id))!;
  const head = system.events.find(event => event.sourceId === id)!.noteheads![0];
  const matrix = rowFor(id).querySelector('svg')!.getScreenCTM()!;
  const viewport = el('score-scroll').getBoundingClientRect();
  return { x: head.centerX + matrix.e - viewport.left, y: head.centerY + matrix.f - viewport.top };
}
function inspectLower48(): { x: number; y: number } {
  const row = rowFor(), viewport = el('score-scroll');
  const index = Number(row.dataset.systemIndex);
  viewport.scrollTop = index * 380 + 220; row.scrollLeft = 500;
  viewport.dispatchEvent(new Event('scroll')); row.dispatchEvent(new Event('scroll'));
  expect(point()).toEqual({ x: 506, y: 35 });
  return point();
}
function screenRenders(): number { return engine.render.mock.calls.filter(([container]) => container.classList.contains('screen')).length; }
function systemMembership(): string[][] { return surface().getLayoutGeometry()!.systems.map(system => system.measures.map(measure => measure.sourceId)); }
function deferEngraving(): void {
  const pending = new Promise<void>(resolve => { releaseEngraving = resolve; });
  engine.ready.mockImplementation(() => pending);
}
async function changeFirstPitch(pitch: string): Promise<void> {
  await click('source-trigger');
  const staged = app!.session.source.cloneNode(true) as Element; staged.querySelector('#upper-note-1')!.setAttribute('pitch', pitch);
  const input = el<HTMLTextAreaElement>('source-input'); input.value = staged.outerHTML;
  input.dispatchEvent(new Event('input', { bubbles: true })); await nextTask();
  await click('source-apply'); await click('close-source');
  expect(app!.session.project.pendingSource).toBeNull(); expect(app!.session.source.querySelector('#upper-note-1')!.getAttribute('pitch')).toBe(pitch);
}

beforeEach(async () => {
  workbenchWidth = 1400; contentHeight = 13000; releaseEngraving = undefined; observers.length = 0;
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  for (const [name, value] of Object.entries({ innerWidth: 1440, innerHeight: 720 })) {
    dimensionsBefore.set(name, Object.getOwnPropertyDescriptor(window, name)); Object.defineProperty(window, name, { configurable: true, value });
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverDouble);
  vi.stubGlobal('DOMPoint', class {
    readonly x: number;
    readonly y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    matrixTransform(value: DOMMatrix) { return { x: this.x * value.a + this.y * value.c + value.e, y: this.x * value.b + this.y * value.d + value.f }; }
  });
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const realStyle = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = realStyle(element, pseudo);
    return element.classList.contains('surface') ? new Proxy(computed, { get(target, property) {
      return property === 'width' ? `${hostWidth()}px` : Reflect.get(target, property, target);
    } }) : computed;
  });
  const viewport = el('score-scroll'); viewport.style.overflow = 'auto';
  dimensions(el('author-workbench'), () => workbenchWidth, () => 448, () => new DOMRect(14, 80, workbenchWidth, 448));
  dimensions(el('score-editor'), paperWidth, () => 400, () => new DOMRect(14, 80, paperWidth(), 400));
  dimensions(viewport, hostWidth, () => 400, () => new DOMRect(24, 80, hostWidth(), 400), hostWidth, () => contentHeight);
  dimensions(el('score-host'), hostWidth, () => contentHeight, () => new DOMRect(24, 80 - viewport.scrollTop, hostWidth(), contentHeight));
  dimensions(el('workspace-dock'), () => workbenchWidth, () => 48, () => new DOMRect(14, 480, workbenchWidth, 48));
  engine.ready.mockReset().mockResolvedValue(); engine.render.mockReset().mockImplementation(draw);
  // Match component lifecycle tests: dynamic imports must use the same adapter double.
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready); vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
});
afterEach(async () => {
  app?.dispose(); app = undefined; releaseEngraving?.(); document.body.replaceChildren(); await nextTask();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of dimensionsBefore) if (descriptor) Object.defineProperty(window, name, descriptor);
  dimensionsBefore.clear();
});

describe('stable writing frame through actual workspace task transitions', () => {
  it.each([[1400, 'side'], [1180, 'sheet']] as const)('More at %spx uses %s without asking for new engraving or changing horizontal paper and music state', async (width, placement) => {
    await mount(width); await select(); const anchor = inspectLower48(), before = accepted();
    const frame = paperWidth(), rendered = screenRenders(), members = systemMembership();
    const paperLeft = el('score-editor').getBoundingClientRect().left;
    for (let cycle = 0; cycle < 3; cycle++) {
      await click('edit-selected-event'); expect(document.body.dataset.toolsPresentation).toBe(placement);
      workspaceObserver().fire(); await nextTask();
      expect(paperWidth()).toBe(frame); expect(el('score-editor').getBoundingClientRect().left).toBe(paperLeft);
      expect(screenRenders()).toBe(rendered); expect(systemMembership()).toEqual(members); expect(accepted()).toEqual(before);
      await click('edit-selected-event'); expect(document.body.dataset.toolsPresentation).toBe('closed');
      expect(point()).toEqual(anchor); expect(rowFor().scrollLeft).toBe(500); expect(screenRenders()).toBe(rendered); expect(accepted()).toEqual(before);
    }
  });

  it('Return from a scrolled task sheet restores visible lower bar 48 rather than selected upper bar 8', async () => {
    await mount(1180); await select(); const anchor = inspectLower48(), before = accepted();
    await click('edit-selected-event'); expect(el('score-editor').inert).toBe(true);
    const panel = el('selection-inspector'); panel.scrollTop = 173;
    await click('tools-expand'); expect(document.body.dataset.toolsPresentation).toBe('closed');
    expect(el('score-editor').inert).toBe(false); expect(document.activeElement).toBe(el('score-editor'));
    expect(point()).toEqual(anchor); expect(rowFor().scrollLeft).toBe(500); expect(accepted()).toEqual(before);
    await click('edit-selected-event'); expect(panel.scrollTop).toBe(173); expect(accepted()).toEqual(before);
  });

  it.each([false, true])('defers sheet Return until edited geometry settles, retaining its anchor through superseding render=%s', async supersede => {
    await mount(1180); await select(); const anchor = inspectLower48();
    await click('edit-selected-event'); deferEngraving(); await changeFirstPitch('F6');
    expect(document.body.dataset.renderState).toBe('rendering'); expect(surface().getLayoutGeometry()).toBeUndefined();
    await click('tools-expand'); expect(document.body.dataset.toolsPresentation).toBe('closed');
    if (supersede) await changeFirstPitch('G6');
    const edited = accepted(); releaseEngraving!(); await settled();
    expect(point()).toEqual(anchor); expect(rowFor().scrollLeft).toBe(500);
    expect(app!.session.selectionId).toBe('upper-note-8'); expect(accepted()).toEqual(edited);
  });

  it('a newer score scroll cancels deferred sheet restoration instead of jumping back after the edit settles', async () => {
    await mount(1180); await select(); inspectLower48();
    await click('edit-selected-event'); deferEngraving(); await changeFirstPitch('F6'); await click('tools-expand');
    const viewport = el('score-scroll'); viewport.scrollTop += 57;
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); viewport.dispatchEvent(new Event('scroll'));
    const userTop = viewport.scrollTop, edited = accepted(); releaseEngraving!(); await settled();
    expect(viewport.scrollTop).toBe(userTop); expect(accepted()).toEqual(edited);
  });

  it('a genuine workbench resize can choose a new frame while an open task keeps the visible paper anchor', async () => {
    await mount(1400); await select(); const anchor = inspectLower48(), before = accepted();
    await click('edit-selected-event'); expect(document.body.dataset.toolsPresentation).toBe('side');
    const initialRenders = screenRenders();
    workbenchWidth = 1180; workspaceObserver().fire(); await nextTask();
    expect(document.body.dataset.toolsPresentation).toBe('sheet'); expect(paperWidth()).toBe(960); expect(screenRenders()).toBe(initialRenders);
    workbenchWidth = 900; workspaceObserver().fire(); await settled();
    expect(paperWidth()).toBe(900); expect(screenRenders()).toBeGreaterThan(initialRenders);
    expect(engine.render.mock.calls.filter(([container]) => container.classList.contains('screen')).at(-1)![2].width).toBe(880);
    await click('tools-expand'); expect(point()).toEqual(anchor); expect(rowFor().scrollLeft).toBe(500); expect(accepted()).toEqual(before);
  });

  it('sheet input guards reject synthetic score keys, selection and pointer attempts while preserving writing intent', async () => {
    await mount(1180); await click('toggle-entry'); await settled();
    await click('tools-toggle'); expect(document.body.dataset.toolsPresentation).toBe('sheet');
    expect(el('score-editor').inert).toBe(true); expect(el('score-editor').getAttribute('aria-hidden')).toBe('true');
    expect(document.body.dataset.entryMode).toBe('true'); const before = accepted();
    for (const key of ['Enter', 'a', 'ArrowRight', 'Delete']) el('score-editor').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const id = 'lower-note-48';
    el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
      sourceId: id, sourceElement: surface().getSource(id), clickCount: 1, pointerType: 'mouse',
    } }));
    for (const type of ['pointerdown', 'pointerup']) el('score-host').dispatchEvent(new PointerEvent(type, {
      bubbles: true, composed: true, cancelable: true, pointerId: 4, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0,
      isPrimary: true, clientX: 224, clientY: 170,
    }));
    await nextTask(); expect(accepted()).toEqual(before); expect(document.body.dataset.entryMode).toBe('true');
    await click('tools-expand'); expect(el('score-editor').inert).toBe(false); expect(document.body.dataset.entryMode).toBe('true'); expect(accepted()).toEqual(before);
  });
});
