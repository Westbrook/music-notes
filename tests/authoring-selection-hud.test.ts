// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';
import type { EventGeometry, MarkingGeometry, SystemGeometry } from '../src/engraving/render.js';
import { transformInk, unionInk } from '../src/engraving/geometry.js';
import type { InkBox } from '../src/engraving/geometry.js';
import { rational } from '../src/model/index.js';
import { createSelectionHud } from '../src/authoring/selection-hud.js';
import type { SelectionHud, SelectionHudContext, SelectionHudDockReason, SelectionHudFloatingPlacement } from '../src/authoring/selection-hud.js';

const controllers: SelectionHud[] = [];
let observers: { fire: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(); disconnect = vi.fn();
    constructor(callback: ResizeObserverCallback) {
      observers.push({ fire: () => callback([], this as unknown as ResizeObserver), observe: this.observe, disconnect: this.disconnect });
    }
  });
});
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose());
  document.body.replaceChildren(); vi.unstubAllGlobals();
});

function event(extra: Partial<EventGeometry> = {}): EventGeometry {
  return { sourceId: 'note', system: 0, staffId: 'staff', measureId: 'bar', voiceId: 'voice', eventIndex: 0,
    x: 185, y: 110, width: 50, height: 75, onset: rational(0), anchorX: 205, anchorY: 40,
    ink: { x: 190, y: 130, width: 38, height: 45 }, sharedSourceIds: ['note'],
    noteheads: [{ pitchIndex: 0, x: 200, y: 155, width: 12, height: 10, centerX: 206, centerY: 160 }], ...extra };
}
function marking(id = 'accent', extra: Partial<MarkingGeometry> = {}): MarkingGeometry {
  return { sourceId: id, system: 0, eventId: 'note', staffId: 'staff', measureId: 'bar', voiceId: 'voice',
    kind: 'articulation', placement: 'above', x: 201, y: 130, width: 10, height: 12, ...extra };
}
function system(extra: Partial<SystemGeometry> = {}): SystemGeometry {
  return { index: 0, start: 0, end: 1, width: 1000, height: 400, viewBox: { x: 0, y: 0, width: 1000, height: 400 },
    ink: { x: 20, y: 120, width: 800, height: 120 }, pageBreak: false,
    staves: [], measures: [], events: [event()], annotations: [], markings: [], tuplets: [], anchors: [], ...extra };
}
interface Row { system: SystemGeometry; top: number; left?: number }

function fixture(initial: Row[] = [{ system: system(), top: 0 }], config: {
  width?: number; height?: number; controlWidth?: number; controlHeight?: number;
  a?: number; b?: number; c?: number; d?: number; maxDistance?: number;
} = {}) {
  let rows = initial; let width = config.width ?? 900; let height = config.height ?? 500;
  let controlWidth = config.controlWidth ?? 220; let controlHeight = config.controlHeight ?? 44;
  let fixedWidth: number | undefined; let fixedShift = 0; let collapseDock = false;
  let fixedHook: (() => void) | undefined;
  let layout: LayoutGeometry | undefined; let revision = 0; let busy = false;
  let obstacles: InkBox[] = [];
  let context: SelectionHudContext = { documentEpoch: 1, selectionVersion: 1, revision: 1, partId: 'score', mode: 'write', allowFloating: true,
    target: { kind: 'event', sourceId: 'note', eventKind: 'note', staffId: 'staff', measureId: 'bar', voiceId: 'voice' } };
  const editor = document.createElement('main');
  const viewport = document.createElement('div'); viewport.style.overflow = 'auto'; viewport.id = 'score-scroll';
  const surface = document.createElement('music-system') as unknown as MusicSurface;
  surface.innerHTML = '<music-staff id="staff"><music-measure id="bar"><music-note id="note" pitch="C4"></music-note></music-measure></music-staff>';
  const shadow = surface.attachShadow({ mode: 'open' }); const screen = document.createElement('div'); screen.className = 'screen'; shadow.append(screen);
  const dock = document.createElement('div'); dock.id = 'selection-controls-dock';
  const controls = document.createElement('div'); controls.id = 'selection-controls'; controls.style.position = 'relative';
  controls.style.left = '2px'; controls.style.top = '3px'; controls.style.color = 'green';
  const button = document.createElement('button'); button.textContent = 'Sharp'; controls.append(button); dock.append(controls);
  viewport.append(surface); editor.append(viewport, dock); document.body.append(editor);
  const scrollTo = vi.fn(); Object.defineProperty(viewport, 'scrollTo', { value: scrollTo });
  const viewportHeight = () => height + (collapseDock && controls.style.position === 'fixed' ? controlHeight : 0);
  Object.defineProperties(viewport, {
    offsetWidth: { get: () => width }, offsetHeight: { get: () => viewportHeight() },
    clientWidth: { get: () => width }, clientHeight: { get: () => viewportHeight() },
    getBoundingClientRect: { value: () => new DOMRect(40, 80, width, viewportHeight()) },
  });
  Object.defineProperties(surface, { getLayoutGeometry: { value: () => layout }, renderRevision: { get: () => revision } });
  Object.defineProperty(controls, 'getBoundingClientRect', { value: () => {
    if (controls.style.position === 'fixed') {
      const hook = fixedHook; fixedHook = undefined; hook?.();
      return new DOMRect(Number.parseFloat(controls.style.left) + fixedShift, Number.parseFloat(controls.style.top), fixedWidth ?? controlWidth, controlHeight);
    }
    return new DOMRect(140, 590, controlWidth, controlHeight);
  } });
  const svgs: SVGSVGElement[] = []; const rowElements: HTMLElement[] = [];
  const update = (next: Row[]) => {
    rows = next; revision++; screen.replaceChildren(); svgs.length = 0; rowElements.length = 0;
    for (const row of rows) {
      const element = document.createElement('div'); element.className = 'system-row'; element.style.overflow = 'auto';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('notation-svg');
      element.append(svg); screen.append(element);
      Object.defineProperties(element, {
        offsetWidth: { get: () => width }, offsetHeight: { get: () => row.system.height },
        clientWidth: { get: () => width }, clientHeight: { get: () => row.system.height }, scrollTo: { value: vi.fn() },
        getBoundingClientRect: { value: () => new DOMRect(40 + (row.left ?? 0), 80 + row.top - viewport.scrollTop, width, row.system.height) },
      });
      Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ({
        a: config.a ?? 1, b: config.b ?? 0, c: config.c ?? 0, d: config.d ?? 1,
        e: 40 + (row.left ?? 0) - element.scrollLeft - viewport.scrollLeft, f: 80 + row.top - viewport.scrollTop,
      }) as DOMMatrix });
      svgs.push(svg); rowElements.push(element);
    }
    layout = { projection: 'screen', projectionId: `screen-${revision}`, revision, scoreId: 'score', systems: rows.map(row => row.system) };
  };
  update(initial);
  // The selection controls own activation cancellation; placement must not add
  // another gate that would consume a second, deliberate click-only action.
  let canceledActivation = false;
  controls.addEventListener('click', event => {
    if (!canceledActivation) return;
    canceledActivation = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  for (const type of ['pointerdown', 'keydown']) controls.addEventListener(type, () => { canceledActivation = false; }, true);
  let cancelAction: (reason: SelectionHudDockReason) => void = () => { busy = false; };
  const cancel = vi.fn((reason: SelectionHudDockReason) => { canceledActivation = true; cancelAction(reason); });
  const controller = createSelectionHud({ element: controls, getSurface: () => surface, getViewport: () => viewport,
    getContext: () => context, getObstacles: () => obstacles, isInteracting: () => busy, cancelInteraction: cancel, maxDistance: config.maxDistance });
  controllers.push(controller);
  return { controller, controls, button, dock, editor, viewport, surface, scrollTo, cancel, update, svgs, rowElements,
    context: () => context, setContext: (next: Partial<SelectionHudContext>) => { context = { ...context, ...next }; },
    setBusy: (value: boolean) => { busy = value; }, cancelWith: (action: typeof cancelAction) => { cancelAction = action; },
    setObstacles: (value: InkBox[]) => { obstacles = value; }, setSize: (w: number, h: number) => { width = w; height = h; },
    setControlSize: (w: number, h: number) => { controlWidth = w; controlHeight = h; },
    setFixedWidth: (w: number) => { fixedWidth = w; }, setFixedShift: (value: number) => { fixedShift = value; },
    setCollapseDock: () => { collapseDock = true; }, onFixedMeasure: (action: () => void) => { fixedHook = action; },
    invalidate: () => { layout = undefined; }, stale: () => { revision++; },
    print: () => { layout = { ...layout!, projection: 'print' }; },
  };
}

function floating(controller: SelectionHud): SelectionHudFloatingPlacement {
  const result = controller.refresh(); expect(result.kind, JSON.stringify(result)).toBe('floating');
  if (result.kind !== 'floating') throw new Error(`Expected floating placement, got ${result.reason}`);
  return result;
}
function clears(a: InkBox, b: InkBox, gap = 8): boolean {
  return a.x + a.width <= b.x - gap || a.x >= b.x + b.width + gap || a.y + a.height <= b.y - gap || a.y >= b.y + b.height + gap;
}
function clip(element: HTMLElement, box: InkBox): void {
  element.style.overflow = 'hidden';
  Object.defineProperties(element, {
    offsetWidth: { get: () => box.width }, offsetHeight: { get: () => box.height },
    clientWidth: { get: () => box.width }, clientHeight: { get: () => box.height },
    getBoundingClientRect: { value: () => new DOMRect(box.x, box.y, box.width, box.height) },
  });
}

describe('selection HUD musical anchors and conservative gutters', () => {
  it('starts in its ordinary dock and anchors a single pitched note to actual painted head geometry', () => {
    const f = fixture(); expect(f.controller.placement.kind).toBe('dock'); expect(f.controls.style.position).toBe('relative');
    const placed = floating(f.controller);
    expect(placed).toMatchObject({ anchorKind: 'notehead', sourceId: 'note', eventId: 'note', documentEpoch: 1,
      selectionVersion: 1, revision: 1, geometryRevision: 1, projectionId: 'screen-1', suspended: false });
    expect(placed.anchor).toEqual({ x: 240, y: 235, width: 12, height: 10 });
    expect(placed.box).toEqual({ x: 136, y: 148, width: 220, height: 44 });
    expect(f.controls.parentElement).toBe(f.dock); expect(f.controls.dataset.selectionPlacement).toBe('floating');
  });

  it('anchors a chord to its complete displaced head group, never an arbitrary chord tone', () => {
    const heads = [
      { pitchIndex: 2, x: 220, y: 155, width: 12, height: 10, centerX: 226, centerY: 160 },
      { pitchIndex: 0, x: 200, y: 200, width: 12, height: 10, centerX: 206, centerY: 205 },
      { pitchIndex: 1, x: 200, y: 160, width: 12, height: 10, centerX: 206, centerY: 165 },
    ];
    const f = fixture([{ system: system({ events: [event({ noteheads: heads })] }), top: 0 }]);
    f.setContext({ target: { kind: 'event', sourceId: 'note', eventKind: 'chord' } });
    const placed = floating(f.controller);
    expect(placed.anchorKind).toBe('chord'); expect(placed.anchor).toEqual(transformInk(unionInk(heads)!, f.svgs[0].getScreenCTM()!));
    expect(placed.sourceId).toBe('note');
  });

  it.each(['rest', 'slash', 'rhythm', 'road'] as const)('anchors %s to painted event ink without inferring pitches', eventKind => {
    const source = event({ noteheads: [] }); const f = fixture([{ system: system({ events: [source] }), top: 0 }]);
    f.setContext({ target: { kind: 'event', sourceId: 'note', eventKind } });
    const placed = floating(f.controller);
    expect(placed.anchorKind).toBe('event'); expect(placed.anchor).toEqual(transformInk(source.ink, f.svgs[0].getScreenCTM()!));
  });

  it('keeps exact child identity and rejects missing or differently owned marks', () => {
    const marks = [marking(), marking('turn', { kind: 'ornament', x: 203, y: 210, width: 20, height: 15 })];
    const f = fixture([{ system: system({ markings: marks }), top: 0 }]);
    f.setContext({ target: { kind: 'marking', sourceId: 'turn', eventId: 'note', staffId: 'staff', measureId: 'bar', voiceId: 'voice' } });
    const placed = floating(f.controller);
    expect(placed.anchorKind).toBe('marking'); expect(placed.sourceId).toBe('turn');
    expect(placed.anchor).toEqual(transformInk(marks[1], f.svgs[0].getScreenCTM()!));
    f.setContext({ target: { kind: 'marking', sourceId: 'turn', eventId: 'different-owner' } });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'missing-target' });
    f.setContext({ target: { kind: 'marking', sourceId: 'removed', eventId: 'note' } });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'missing-target' });
  });

  it('follows new measured ledger positions after clef/layout changes without using the staff-center anchor', () => {
    const high = event({ anchorY: 240,
      noteheads: [{ pitchIndex: 0, x: 200, y: 10, width: 12, height: 10, centerX: 206, centerY: 15 }] });
    const f = fixture([{ system: system({ events: [high], ink: { x: 20, y: 5, width: 800, height: 220 } }), top: 80 }]);
    expect(floating(f.controller).anchor.y).toBe(170);
    const low = event({ anchorY: 40,
      noteheads: [{ pitchIndex: 0, x: 200, y: 370, width: 12, height: 10, centerX: 206, centerY: 375 }] });
    f.update([{ system: system({ events: [low], ink: { x: 20, y: 180, width: 800, height: 220 } }), top: 0 }]);
    const placed = floating(f.controller); expect(placed.anchor.y).toBe(450); expect(placed.geometryRevision).toBe(2);
    expect(placed.box.y).toBe(488); expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('protects full ink of every visible system, including beams, ties, labels and adjacent staves', () => {
    const first = system();
    const other = system({ index: 1, events: [], ink: { x: 0, y: 25, width: 900, height: 90 } });
    const f = fixture([{ system: first, top: 0 }, { system: other, top: 0 }]);
    const placed = floating(f.controller);
    expect(placed.box.y).toBe(328);
    for (const [index, current] of [first, other].entries()) expect(clears(placed.box, transformInk(current.ink, f.svgs[index].getScreenCTM()!))).toBe(true);
  });

  it('docks in dense music instead of manufacturing space or choosing a distant gutter', () => {
    const f = fixture([{ system: system({ ink: { x: 0, y: 0, width: 900, height: 500 }, height: 500 }), top: 0 }]);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'no-space' });
    const bounded = fixture(undefined, { maxDistance: 20 });
    expect(bounded.controller.refresh()).toEqual({ kind: 'dock', reason: 'no-space' });
  });

  it('avoids independent controls with eight CSS pixels of clearance', () => {
    const f = fixture(); const obstacle = { x: 100, y: 130, width: 280, height: 60 }; f.setObstacles([obstacle]);
    const placed = floating(f.controller); expect(clears(placed.box, obstacle)).toBe(true);
    expect(placed.box.x).toBeGreaterThanOrEqual(48); expect(placed.box.y).toBeGreaterThanOrEqual(88);
    expect(placed.box.x + placed.box.width).toBeLessThanOrEqual(932);
  });

  it('uses current SVG transforms and nested scroll positions without changing music or focus', () => {
    const source = event({ noteheads: [{ pitchIndex: 0, x: 750, y: 155, width: 12, height: 10, centerX: 756, centerY: 160 }] });
    const f = fixture([{ system: system({ events: [source] }), top: 100 }], { a: 1.1, b: .05, c: .1, d: 1.2 });
    f.rowElements[0].scrollLeft = 500; f.viewport.scrollTop = 50; f.button.focus();
    const sourceBefore = f.surface.outerHTML; const transform = f.svgs[0].getScreenCTM()!;
    const placed = floating(f.controller);
    expect(placed.anchor).toEqual(transformInk(source.noteheads![0], transform));
    // The transformed ink edge is 466.0000000000001, not exactly 466.
    // CSS left serialization must not eat any of the eight-pixel clearance.
    expect(clears(placed.box, transformInk(system().ink, transform))).toBe(true);
    expect(f.svgs[0].getScreenCTM()).toEqual(transform); expect(f.surface.outerHTML).toBe(sourceBefore);
    expect(document.activeElement).toBe(f.button); expect(f.viewport.scrollTop).toBe(50); expect(f.rowElements[0].scrollLeft).toBe(500);
    expect(f.scrollTo).not.toHaveBeenCalled(); expect(f.rowElements[0].scrollTo).not.toHaveBeenCalled();
  });

  it('respects the visual viewport when a keyboard or zoom leaves less visible space', () => {
    vi.stubGlobal('visualViewport', { offsetLeft: 10, offsetTop: 90, width: 400, height: 300 });
    const f = fixture(); const placed = floating(f.controller);
    expect(placed.box.x).toBeGreaterThanOrEqual(48); expect(placed.box.x + placed.box.width).toBeLessThanOrEqual(402);
    expect(placed.box.y).toBeGreaterThanOrEqual(98); expect(placed.box.y + placed.box.height).toBeLessThanOrEqual(382);
  });

  it('does not float for a note clipped by an ancestor above the score viewport', () => {
    const f = fixture(); clip(f.editor, { x: 40, y: 80, width: 900, height: 100 });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'offscreen' });
    expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the entire gutter inside clipping ancestors across a shadow boundary', () => {
    const f = fixture(); const outer = document.createElement('section');
    outer.attachShadow({ mode: 'open' }).append(f.editor); document.body.append(outer);
    clip(outer, { x: 80, y: 180, width: 700, height: 220 });
    const placed = floating(f.controller);
    expect(placed.box.x).toBeGreaterThanOrEqual(88); expect(placed.box.y).toBeGreaterThanOrEqual(188);
    expect(placed.box.x + placed.box.width).toBeLessThanOrEqual(772);
    expect(placed.box.y + placed.box.height).toBeLessThanOrEqual(392);
  });

  it('preserves complete clearance across dense, narrow and fractional transform boundaries', () => {
    let floated = 0; let docked = 0;
    for (let index = 0; index < 32; index++) {
      const dense = index % 4 === 0;
      const first = system({ height: 600, ink: dense ? { x: 0, y: 0, width: 1600, height: 600 }
        : { x: 20.03, y: 119.97, width: 799.99, height: 120.01 } });
      const second = system({ index: 1, events: [], ink: { x: 10.1, y: 5.03, width: 880.07, height: 40.02 } });
      const f = fixture([{ system: first, top: 0 }, { system: second, top: 360 }], {
        width: index % 2 ? 900 : 370, height: 500, controlWidth: 200 + index % 3 * .125,
        a: .8 + index % 5 * .11, b: index % 3 * .013, c: index % 4 * .019, d: .9 + index % 3 * .075,
      });
      const obstacle = { x: 40.07, y: 80.03, width: 44.17, height: 44.01 }; f.setObstacles([obstacle]);
      const source = f.surface.outerHTML; const result = f.controller.refresh();
      if (result.kind === 'dock') { docked++; continue; }
      floated++;
      expect(result.box.x).toBeGreaterThanOrEqual(48); expect(result.box.y).toBeGreaterThanOrEqual(88);
      expect(result.box.x + result.box.width).toBeLessThanOrEqual(40 + f.viewport.clientWidth - 8);
      expect(result.box.y + result.box.height).toBeLessThanOrEqual(572);
      expect(clears(result.box, obstacle)).toBe(true);
      for (const [frame, current] of [first, second].entries()) {
        const ink = transformInk(current.ink, f.svgs[frame].getScreenCTM()!);
        expect(clears(result.box, ink), `Case ${index}, system ${frame}`).toBe(true);
      }
      const rect = f.controls.getBoundingClientRect();
      expect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).toEqual(result.box);
      expect(f.surface.outerHTML).toBe(source); expect(f.scrollTo).not.toHaveBeenCalled();
    }
    expect(floated).toBeGreaterThan(0); expect(docked).toBeGreaterThan(0);
  });
});

describe('selection HUD docking and stale geometry', () => {
  it.each(['read', 'pages'] as const)('never floats editing controls in %s', mode => {
    const f = fixture(); f.setContext({ mode }); expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'disabled' });
  });

  it('keeps multiple/structural tools, entry, source drafts and armed gestures in their dock', () => {
    const f = fixture(); f.setContext({ allowFloating: false });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'disabled' });
    f.setContext({ allowFloating: true, target: undefined });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'missing-target' });
  });

  it('requires current screen geometry, connected targets and actual pitched heads', () => {
    const f = fixture(); f.invalidate(); expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    f.update([{ system: system(), top: 0 }]); f.stale(); expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    f.update([{ system: system(), top: 0 }]); f.print(); expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    f.update([{ system: system({ events: [event({ noteheads: undefined })] }), top: 0 }]);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'missing-target' });
    f.update([{ system: system(), top: 0 }]); f.surface.remove();
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
  });

  it('docks for missing or singular transforms and invalid HTML measurements', () => {
    const f = fixture(); Object.defineProperty(f.svgs[0], 'getScreenCTM', { value: () => null });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    f.update([{ system: system(), top: 0 }]);
    Object.defineProperty(f.svgs[0], 'getScreenCTM', { value: () => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    f.update([{ system: system(), top: 0 }]); f.setControlSize(0, 44);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'invalid-size' });
  });

  it('does not reveal an offscreen target or substitute the visible part of a chord', () => {
    const f = fixture(); f.rowElements[0].scrollLeft = 500;
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'offscreen' });
    expect(f.rowElements[0].scrollLeft).toBe(500); expect(f.scrollTo).not.toHaveBeenCalled();
    f.update([{ system: system({ events: [event({ noteheads: [event().noteheads![0],
      { pitchIndex: 1, x: 200, y: 600, width: 12, height: 10, centerX: 206, centerY: 605 }] })],
      height: 650, ink: { x: 20, y: 120, width: 800, height: 500 } }), top: 0 }]);
    f.setContext({ target: { kind: 'event', sourceId: 'note', eventKind: 'chord' } });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'offscreen' });
  });

  it('rejects incomplete system ink instead of placing controls over unprotected musical glyphs', () => {
    const f = fixture([{ system: system({ ink: { x: 20, y: 300, width: 800, height: 30 } }), top: 0 }]);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' });
    expect(f.controls.style.position).toBe('relative');
  });

  it('checks the actual fixed box rather than trusting CSS placement under transforms or wrapping', () => {
    const f = fixture(); f.setFixedShift(20);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'unsafe-placement' });
    f.setFixedShift(0); f.setFixedWidth(300);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'unsafe-placement' });
    expect(f.controls.style.position).toBe('relative'); expect(f.controls.style.left).toBe('2px'); expect(f.controls.style.top).toBe('3px');
  });

  it('refuses floating if the dock fails to preserve the notation viewport size', () => {
    const f = fixture(); f.setCollapseDock(); const before = f.viewport.getBoundingClientRect();
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'unsafe-placement' });
    expect(f.viewport.getBoundingClientRect()).toEqual(before);
  });

  it('rejects a same-ID document replacement during placement measurement', () => {
    const f = fixture(); f.onFixedMeasure(() => f.setContext({ documentEpoch: 2 }));
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'unsafe-placement' });
    expect(f.controls.style.position).toBe('relative');
  });

  it('does not let an older measurement overwrite a newer placement generation', () => {
    const f = fixture();
    f.onFixedMeasure(() => { f.setContext({ selectionVersion: 2 }); f.controller.refresh(); });
    const result = floating(f.controller);
    expect(result.selectionVersion).toBe(2); expect(f.controls.dataset.selectionPlacement).toBe('floating');
  });
});

describe('selection HUD interaction freezing and cancellation', () => {
  it('freezes a safe placement during a picker or press, then follows the anchor after release', () => {
    const f = fixture(); f.viewport.scrollTop = 20; const before = floating(f.controller);
    f.setBusy(true); f.viewport.scrollTop = 15; const held = floating(f.controller);
    expect(held.box).toEqual(before.box); expect(held.anchor.y).toBe(before.anchor.y + 5); expect(f.cancel).not.toHaveBeenCalled();
    f.setBusy(false); const after = floating(f.controller); expect(after.box.y).toBe(before.box.y + 5);
  });

  it('asks the activation owner to cancel before moving the pressed button back to its dock', () => {
    const f = fixture(); floating(f.controller); f.setBusy(true);
    const order: string[] = []; f.cancelWith(() => { order.push(f.controls.style.position); f.setBusy(false); });
    f.viewport.scrollTop = 10;
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'unsafe-placement' });
    expect(order).toEqual(['fixed']); expect(f.controls.style.position).toBe('relative');
    const activate = vi.fn(); f.button.addEventListener('click', activate); f.button.click(); expect(activate).not.toHaveBeenCalled();
    f.button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); f.button.click(); expect(activate).toHaveBeenCalledOnce();
  });

  it('uses one activation cancellation so the next deliberate click-only action still works', () => {
    const f = fixture(); floating(f.controller); f.setBusy(true); f.viewport.scrollTop = 10; f.controller.refresh();
    const activate = vi.fn(); f.button.addEventListener('click', activate);
    f.button.click(); expect(activate).not.toHaveBeenCalled();
    f.button.click(); expect(activate).toHaveBeenCalledOnce();
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it.each([{ documentEpoch: 2 }, { selectionVersion: 2 }, { revision: 2 }, { partId: 'other-part' }])('invalidates a held interaction when its identity changes: %j', change => {
    const f = fixture(); floating(f.controller); f.setBusy(true); f.setContext(change);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'target-changed' });
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalledWith('target-changed');
  });

  it('cancels when a settled render replaces the geometry, even if the old rectangle still fits', () => {
    const f = fixture(); floating(f.controller); f.setBusy(true); f.update([{ system: system(), top: 0 }]);
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'stale-geometry' }); expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('does not start floating while docked controls are being operated', () => {
    const f = fixture(); f.setBusy(true); expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'interaction' });
    expect(f.cancel).not.toHaveBeenCalled(); f.setBusy(false); floating(f.controller);
  });

  it('cancels control-size changes during a press; idle ResizeObserver updates can safely re-place', () => {
    const f = fixture(); const before = floating(f.controller); f.setControlSize(280, 44); observers[0].fire();
    expect(f.controller.placement.kind).toBe('floating');
    if (f.controller.placement.kind === 'floating') expect(f.controller.placement.box.width).toBe(280);
    f.setBusy(true); f.setControlSize(300, before.box.height); observers[0].fire();
    expect(f.controller.placement).toEqual({ kind: 'dock', reason: 'unsafe-placement' }); expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('does not refloat reentrantly from chooser dismissal while cancellation is in progress', () => {
    const f = fixture(); floating(f.controller); f.setBusy(true);
    f.cancelWith(() => { f.setBusy(false); f.controller.refresh(); }); f.setContext({ selectionVersion: 2 });
    expect(f.controller.refresh()).toEqual({ kind: 'dock', reason: 'target-changed' }); expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('hides an unsafe box without moving it until capture is actually released', async () => {
    const f = fixture(); const before = floating(f.controller); f.setBusy(true); f.cancelWith(() => {}); f.viewport.scrollTop = 10;
    const pending = f.controller.refresh(); expect(pending.kind).toBe('floating');
    if (pending.kind === 'floating') { expect(pending.suspended).toBe(true); expect(pending.box).toEqual(before.box); }
    expect(f.controls.style.position).toBe('fixed'); expect(f.controls.style.visibility).toBe('hidden');
    const activate = vi.fn(); f.button.addEventListener('click', activate); f.button.click(); expect(activate).not.toHaveBeenCalled();
    f.setBusy(false); f.button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await Promise.resolve();
    expect(f.controller.placement).toEqual({ kind: 'dock', reason: 'unsafe-placement' }); expect(f.controls.style.visibility).toBe('');
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('completes disposal after a delayed capture release without leaving controls fixed or hidden', async () => {
    const f = fixture(); floating(f.controller); f.setBusy(true); f.cancelWith(() => {});
    f.controller.dispose(); expect(f.controls.style.position).toBe('fixed'); expect(f.controls.style.visibility).toBe('hidden');
    f.setBusy(false); f.button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await Promise.resolve();
    expect(f.controller.placement).toEqual({ kind: 'dock', reason: 'disposed' });
    expect(f.controls.style.position).toBe('relative'); expect(f.controls.style.visibility).toBe('');
    expect(f.controls.hasAttribute('data-selection-placement')).toBe(false); expect(observers[0].disconnect).toHaveBeenCalledOnce();
    const activate = vi.fn(); f.button.addEventListener('click', activate);
    f.button.click(); expect(activate).not.toHaveBeenCalled();
    f.button.click(); expect(activate).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('leaves trailing activation invalidation with its owner when disposal releases capture synchronously', () => {
    const f = fixture(); floating(f.controller); f.setBusy(true); f.controller.dispose();
    expect(f.controller.placement).toEqual({ kind: 'dock', reason: 'disposed' });
    const activate = vi.fn(); f.button.addEventListener('click', activate);
    f.button.click(); expect(activate).not.toHaveBeenCalled();
    f.button.click(); expect(activate).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('restores its inline baseline and disconnects observers without selection, focus, layout or source mutations', () => {
    const f = fixture(); f.button.focus(); const source = f.surface.outerHTML; const layout = f.surface.getLayoutGeometry();
    floating(f.controller); f.controller.dispose();
    expect(f.controller.placement).toEqual({ kind: 'dock', reason: 'disposed' }); expect(f.controls.style.position).toBe('relative');
    expect(f.controls.style.left).toBe('2px'); expect(f.controls.style.top).toBe('3px'); expect(f.controls.style.color).toBe('green');
    expect(f.controls.hasAttribute('data-selection-placement')).toBe(false); expect(f.controls.parentElement).toBe(f.dock);
    expect(observers[0].disconnect).toHaveBeenCalledOnce(); observers[0].fire(); expect(f.controller.refresh().kind).toBe('dock');
    expect(f.surface.outerHTML).toBe(source); expect(f.surface.getLayoutGeometry()).toBe(layout); expect(document.activeElement).toBe(f.button);
    expect(f.scrollTo).not.toHaveBeenCalled();
  });
});
