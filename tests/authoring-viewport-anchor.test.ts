// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';
import type { EventGeometry, MarkingGeometry, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import type { Score } from '../src/model/types.js';
import { parseMeter, parsePitch, rational } from '../src/model/index.js';
import { createViewportAnchor } from '../src/authoring/viewport-anchor.js';
import type { MusicalViewportTarget, ViewportAnchor, ViewportInsets } from '../src/authoring/viewport-anchor.js';

const controllers: ViewportAnchor[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); document.body.replaceChildren(); });

function matrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): DOMMatrix {
  return { a, b, c, d, e, f, inverse: () => {
    const determinant = a * d - b * c;
    return matrix(d / determinant, -b / determinant, -c / determinant, a / determinant,
      (c * f - d * e) / determinant, (b * e - a * f) / determinant);
  } } as DOMMatrix;
}

function event(id = 'note', x = 100, y = 100, extra: Partial<EventGeometry> = {}): EventGeometry {
  return { sourceId: id, system: 0, staffId: 'staff', measureId: 'bar', voiceId: 'voice', eventIndex: 0,
    x: x - 10, y: y - 25, width: 32, height: 45, onset: rational(0), anchorX: x, anchorY: 60,
    ink: { x: x - 10, y: y - 25, width: 32, height: 45 }, sharedSourceIds: [id],
    noteheads: [{ pitchIndex: 0, x, y, width: 12, height: 10, centerX: x + 6, centerY: y + 5 }], ...extra };
}
function measure(id = 'bar', staffId = 'staff', extra: Partial<MeasureGeometry> = {}): MeasureGeometry {
  return { sourceId: id, staffId, system: 0, measureIndex: 0, x: 20, y: 20, width: 1000, height: 900,
    topLine: 40, bottomLine: 80, noteStartX: 70, noteEndX: 1000, ...extra };
}
function marking(id = 'mark', extra: Partial<MarkingGeometry> = {}): MarkingGeometry {
  return { sourceId: id, eventId: 'note', staffId: 'staff', measureId: 'bar', voiceId: 'voice', system: 0,
    kind: 'articulation', placement: 'above', x: 110, y: 60, width: 18, height: 12, ...extra };
}
function system(events = [event()], measures = [measure()], extra: Partial<SystemGeometry> = {}): SystemGeometry {
  return { index: 0, start: 0, end: 1, width: 1200, height: 1000,
    viewBox: { x: 0, y: 0, width: 1200, height: 1000 }, ink: { x: 10, y: 10, width: 1180, height: 980 },
    pageBreak: false, staves: [], measures, events, annotations: [], tuplets: [], anchors: [], ...extra };
}
interface Row { system: SystemGeometry; top: number; left?: number }

function model(rows: readonly Row[]): Score {
  const staves = new Map<string, Map<string, MeasureGeometry>>();
  for (const { system } of rows) for (const measure of system.measures) {
    const staff = staves.get(measure.staffId) ?? new Map(); staff.set(measure.sourceId, measure); staves.set(measure.staffId, staff);
  }
  return { id: 'score', label: 'Read-only geometry fixture', bracket: 'none', staves: [...staves].map(([id, measures]) => ({
    id, label: id, clef: 'treble', key: 'C', measures: [...measures.values()].map(measure => {
      const events = rows.flatMap(row => row.system.events).filter(event => event.measureId === measure.sourceId);
      const voiceIds = [...new Set(events.map(event => event.voiceId))];
      return { id: measure.sourceId, number: measure.sourceId, clef: 'treble', key: 'C', meter: parseMeter(),
        pickup: false, incomplete: false, keepWithNext: false, breakBefore: 'auto', endBar: 'single', repeatStart: false, annotations: [],
        voices: voiceIds.map(id => ({ id, tuplets: [], events: events.filter(event => event.voiceId === id).map(event => ({
          id: event.sourceId, kind: 'note', pitches: [parsePitch('C4')], duration: 'quarter', dots: 0, onset: rational(0), time: rational(1, 4),
          tupletIds: [], beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: false,
        })) })),
      };
    }),
  })) };
}

/** A real shadow tree with deterministic DOM measurements and synchronous scrolling. */
function fixture(initial: Row[] = [{ system: system(), top: 0 }], config: {
  width?: number; height?: number; scale?: number; svgA?: number; svgB?: number; svgC?: number; svgD?: number; border?: number;
  slotted?: boolean;
} = {}) {
  let width = config.width ?? 400; let height = config.height ?? 220;
  const scale = config.scale ?? 1; const border = config.border ?? 0;
  let rows = initial; let contentHeight = 0; let customHeight: number | undefined;
  let layout: LayoutGeometry | undefined; let revision = 0; let score: Score;
  let context = 'project:score:write'; let insets: ViewportInsets = {};
  let selection: MusicalViewportTarget | undefined = { sourceId: 'note', staffId: 'staff' };
  let available = true; let projectionAvailable = true;
  const editor = document.createElement('section'); editor.tabIndex = 0;
  const viewport = document.createElement('div'); viewport.id = 'score-scroll'; viewport.style.overflow = 'auto';
  const host = document.createElement('div'); host.id = 'score-host';
  const mount = document.createElement('div'); host.attachShadow({ mode: 'open' }).append(mount);
  const surfaceElement = document.createElement('music-system'); surfaceElement.id = 'score';
  surfaceElement.innerHTML = '<music-note id="source-note" pitch="C4"></music-note>';
  const shadow = surfaceElement.attachShadow({ mode: 'open' });
  const screen = document.createElement('div'); shadow.append(screen);
  if (config.slotted) {
    const slot = document.createElement('slot'); viewport.append(slot);
    mount.append(viewport); host.append(surfaceElement); editor.append(host);
    // Happy DOM supplies slot assignment but does not expose Element.assignedSlot.
    Object.defineProperty(surfaceElement, 'assignedSlot', {
      get: () => slot.assignedElements().includes(surfaceElement) ? slot : null,
    });
  } else {
    mount.append(surfaceElement); viewport.append(host); editor.append(viewport);
  }
  document.body.append(editor);
  const surface = surfaceElement as unknown as MusicSurface;
  Object.defineProperties(surface, {
    getLayoutGeometry: { value: () => layout }, renderRevision: { get: () => revision }, score: { get: () => score },
    getRenderedProjection: { value: (): ReturnType<MusicSurface['getRenderedProjection']> => projectionAvailable && layout ? {
      surface, renderRevision: revision, layout,
      frames: rows.map((row, index) => ({ system: row.system, svg: svgs[index], row: rowElements[index] })),
    } : undefined },
  });
  // Inner native scroll does not cross a shadow boundary; the surface publishes
  // the originating scroller so consumers can recognize their own scrolls.
  shadow.addEventListener('scroll', event => {
    if (!(event.target instanceof HTMLElement)) return;
    surface.dispatchEvent(new CustomEvent('notation-viewport-change', {
      bubbles: true, composed: true, detail: { scroller: event.target, layout },
    }));
  }, { capture: true, passive: true });
  const rect = (left: number, top: number, w: number, h: number) => new DOMRect(left, top, w, h);
  const position = (element: HTMLElement, widths: () => { width: number; height: number; contentWidth: number; contentHeight: number }, bounds: () => DOMRect) => {
    let left = 0; let top = 0;
    Object.defineProperties(element, {
      clientLeft: { get: () => element === viewport ? border : 0 }, clientTop: { get: () => element === viewport ? border : 0 },
      clientWidth: { get: () => widths().width }, clientHeight: { get: () => widths().height },
      offsetWidth: { get: () => widths().width + (element === viewport ? border * 2 : 0) },
      offsetHeight: { get: () => widths().height + (element === viewport ? border * 2 : 0) },
      scrollWidth: { get: () => widths().contentWidth }, scrollHeight: { get: () => widths().contentHeight },
      scrollLeft: { get: () => left = Math.max(0, Math.min(left, widths().contentWidth - widths().width)),
        set: (value: number) => { left = Math.max(0, Math.min(value, widths().contentWidth - widths().width)); } },
      scrollTop: { get: () => top = Math.max(0, Math.min(top, widths().contentHeight - widths().height)),
        set: (value: number) => { top = Math.max(0, Math.min(value, widths().contentHeight - widths().height)); } },
      getBoundingClientRect: { value: bounds },
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      if (options.left !== undefined) element.scrollLeft = options.left;
      if (options.top !== undefined) element.scrollTop = options.top;
    });
    Object.defineProperty(element, 'scrollTo', { configurable: true, value: scrollTo });
    return scrollTo;
  };
  const scrollTo = position(viewport, () => ({ width, height, contentWidth: width, contentHeight: customHeight ?? contentHeight }),
    () => rect(50, 100, (width + border * 2) * scale, (height + border * 2) * scale));
  const rowElements: HTMLElement[] = [];
  const svgs: SVGSVGElement[] = [];
  const update = (next: Row[]) => {
    rows = next; revision++; rowElements.length = 0; svgs.length = 0; screen.replaceChildren();
    contentHeight = Math.max(0, ...rows.map(row => row.top + row.system.height * (config.svgD ?? 1))) + 100;
    for (const row of rows) {
      const element = document.createElement('div'); element.style.overflowX = 'auto'; element.style.overflowY = 'hidden';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      element.append(svg); screen.append(element);
      position(element, () => ({ width, height: row.system.height * (config.svgD ?? 1),
        contentWidth: row.system.width * (config.svgA ?? 1), contentHeight: row.system.height * (config.svgD ?? 1) }),
      () => rect(50 + border * scale + ((row.left ?? 0) - viewport.scrollLeft) * scale,
        100 + border * scale + (row.top - viewport.scrollTop) * scale, width * scale, row.system.height * (config.svgD ?? 1) * scale));
      Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => matrix(
        (config.svgA ?? 1) * scale, (config.svgB ?? 0) * scale, (config.svgC ?? 0) * scale, (config.svgD ?? 1) * scale,
        50 + border * scale + ((row.left ?? 0) - viewport.scrollLeft - element.scrollLeft) * scale,
        100 + border * scale + (row.top - viewport.scrollTop - element.scrollTop) * scale,
      ) });
      rowElements.push(element); svgs.push(svg);
    }
    layout = { projection: 'screen', projectionId: `projection-${revision}`, revision, scoreId: 'score', systems: rows.map(row => row.system) };
    score = model(rows);
  };
  update(initial);
  const getSelection = vi.fn(() => selection);
  const controller = createViewportAnchor({ getSurface: () => available ? surface : undefined, getViewport: () => viewport,
    getSelection, getInsets: () => insets, getContextKey: () => context });
  controllers.push(controller);
  const headPoint = (sourceId: string, pitchIndex = 0) => {
    const rowIndex = rows.findIndex(row => row.system.events.some(event => event.sourceId === sourceId));
    const event = rows[rowIndex].system.events.find(event => event.sourceId === sourceId)!;
    const head = event.noteheads!.find(head => head.pitchIndex === pitchIndex)!;
    const m = svgs[rowIndex].getScreenCTM()!;
    return { x: m.a * head.centerX + m.c * head.centerY + m.e,
      y: m.b * head.centerX + m.d * head.centerY + m.f };
  };
  const offsets = (sourceId: string, pitchIndex = 0) => {
    const point = headPoint(sourceId, pitchIndex);
    return { x: point.x - 50 - (border + (insets.left ?? 0)) * scale,
      y: point.y - 100 - (border + (insets.top ?? 0)) * scale };
  };
  return { controller, viewport, editor, surface, rowElements, svgs, scrollTo, getSelection, update, headPoint, offsets,
    setSelection(value: MusicalViewportTarget) { selection = value; }, setContext(value: string) { context = value; },
    setInsets(value: ViewportInsets) { insets = value; }, setHeight(value?: number) { customHeight = value; },
    invalidate() { layout = undefined; }, staleRevision() { revision++; }, setAvailable(value: boolean) { available = value; },
    setProjectionAvailable(value: boolean) { projectionAvailable = value; },
    resize(w: number, h: number) { width = w; height = h; },
  };
}

function ensemble(columns: number): Row[] {
  const rows: Row[] = [];
  for (let start = 0; start < 64; start += columns) {
    const index = rows.length; const events: EventGeometry[] = []; const measures: MeasureGeometry[] = [];
    for (const [staffIndex, staffId] of ['upper', 'middle', 'lower'].entries()) for (let column = 0; column < columns && start + column < 64; column++) {
      const bar = start + column + 1; const measureId = `${staffId}-${bar}`; const top = 40 + staffIndex * 130;
      measures.push(measure(measureId, staffId, { system: index, measureIndex: bar - 1, x: 20 + column * 450,
        y: top - 30, width: 430, height: 100, topLine: top, bottomLine: top + 40, noteStartX: 70 + column * 450, noteEndX: 440 + column * 450 }));
      for (const voice of [1, 2]) events.push(event(`${measureId}-v${voice}`, 100 + column * 450, top + (voice === 1 ? 5 : 50), {
        system: index, staffId, measureId, voiceId: `${measureId}-voice-${voice}`,
      }));
    }
    rows.push({ top: index * 520, system: system(events, measures, { index, start, end: Math.min(64, start + columns), width: 450 * columns, height: 500 }) });
  }
  return rows;
}

describe('musical viewport preservation', () => {
  it('ENG-ANCHOR-LOWER64 preserves visible lower-staff bar 48, independently of selected bar 8', () => {
    const f = fixture(ensemble(1), { height: 120 });
    f.setSelection({ sourceId: 'upper-8-v1', staffId: 'upper', voiceIndex: 0 });
    f.viewport.scrollTop = 47 * 520 + 340;
    f.rowElements[47].scrollLeft = 25;
    const source = f.surface.outerHTML;
    const token = f.controller.capture()!;
    expect(token).toMatchObject({ sourceId: 'lower-48-v2', staffId: 'lower', measureId: 'lower-48', voiceIndex: 1, pitchIndex: 0 });
    expect(f.getSelection).not.toHaveBeenCalled();
    f.update(ensemble(2));
    expect(f.controller.restore(token)).toBe(true);
    const after = f.offsets(token.sourceId);
    expect(after.x).toBeCloseTo(token.offsetX, 6); expect(after.y).toBeCloseTo(token.offsetY, 6);
    expect(f.rowElements[23].scrollLeft).toBeGreaterThan(400);
    expect(f.viewport.scrollLeft).toBe(0);
    expect(f.surface.outerHTML).toBe(source);
    expect(f.controller.restore(token)).toBe(false);
  });

  it('ENG-CHORD-ANCHOR keeps the visible original pitch index through reflow', () => {
    const chord = event('chord', 100, 100, { ink: { x: 80, y: 70, width: 45, height: 350 },
      noteheads: [0, 1, 2].map(pitchIndex => ({ pitchIndex, x: 100 + pitchIndex * 12, y: 100 + pitchIndex * 150,
        width: 12, height: 10, centerX: 106 + pitchIndex * 12, centerY: 105 + pitchIndex * 150 })) });
    const f = fixture([{ system: system([chord]), top: 0 }], { height: 100 });
    f.viewport.scrollTop = 380;
    const token = f.controller.capture()!;
    expect(token.kind).toBe('notehead'); expect(token.pitchIndex).toBe(2);
    f.update([{ system: system([{ ...chord, noteheads: [...chord.noteheads!].reverse() }]), top: 180 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.offsets('chord', 2).y).toBeCloseTo(token.offsetY, 6);
  });

  it('falls back to the visible staff/measure source when there is no visible event', () => {
    const f = fixture([{ system: system([], [measure('empty', 'lower', { x: 20, y: 500, width: 300, height: 70, topLine: 510, bottomLine: 550 })]), top: 0 }]);
    f.viewport.scrollTop = 480;
    const token = f.controller.capture()!;
    expect(token).toMatchObject({ kind: 'measure', sourceId: 'empty', staffId: 'lower', measureId: 'empty' });
    f.update([{ system: system([], [measure('empty', 'lower', { x: 20, y: 700, width: 300, height: 70, topLine: 710, bottomLine: 750 })]), top: 0 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.viewport.scrollTop).toBe(680);
  });

  it('preserves horizontal position through an independently scrolling dense measure', () => {
    const f = fixture([{ system: system([event('wide', 900, 100)]), top: 0 }]);
    f.rowElements[0].scrollLeft = 800;
    const token = f.controller.capture()!;
    f.update([{ system: system([event('wide', 1100, 100)], [measure()], { width: 1600 }), top: 0 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.rowElements[0].scrollLeft).toBe(1000);
    expect(f.offsets('wide').x).toBeCloseTo(token.offsetX, 6);
    expect(f.viewport.scrollLeft).toBe(0);
  });

  it('preserves a slotted surface through its row scroller and enclosing shadow viewport', () => {
    const f = fixture([{ system: system([event('note', 900, 600)]), top: 0 }], { height: 180, slotted: true });
    expect(f.surface.assignedSlot).toBeInstanceOf(HTMLSlotElement);
    expect(f.viewport.getRootNode()).toBeInstanceOf(ShadowRoot);
    f.viewport.scrollTop = 550; f.rowElements[0].scrollLeft = 800;
    const token = f.controller.capture()!;
    expect(token).toMatchObject({ sourceId: 'note', pitchIndex: 0 });
    f.update([{ system: system([event('note', 1100, 700)], [measure()], { width: 1600 }), top: 200 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.viewport.scrollTop).toBe(850); expect(f.rowElements[0].scrollLeft).toBe(1000);
    const after = f.offsets('note');
    expect(after.x).toBeCloseTo(token.offsetX, 6); expect(after.y).toBeCloseTo(token.offsetY, 6);
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
  });

  it('uses current SVG transforms and physical offsets without scaling music', () => {
    const f = fixture([{ system: system([event('scaled', 90, 200)]), top: 300 }],
      { scale: 1.5, svgA: 1.25, svgB: .1, svgC: .2, svgD: .9, border: 2, height: 300 });
    f.viewport.scrollTop = 370;
    f.setInsets({ top: 24, left: 12 });
    const token = f.controller.capture()!;
    const transformBefore = f.svgs[0].getScreenCTM()!;
    const source = f.surface.outerHTML;
    f.update([{ system: system([event('scaled', 90, 200)]), top: 580 }]);
    expect(f.controller.restore(token)).toBe(true);
    const after = f.offsets('scaled');
    expect(after.x).toBeCloseTo(token.offsetX, 5); expect(after.y).toBeCloseTo(token.offsetY, 5);
    const transformAfter = f.svgs[0].getScreenCTM()!;
    expect([transformAfter.a, transformAfter.b, transformAfter.c, transformAfter.d])
      .toEqual([transformBefore.a, transformBefore.b, transformBefore.c, transformBefore.d]);
    expect(f.surface.outerHTML).toBe(source);
  });

  it('uses the nearest reachable location when a new page edge prevents the original offset', () => {
    const f = fixture([{ system: system([event('edge', 100, 400)]), top: 0 }], { height: 600 });
    const token = f.controller.capture()!;
    f.update([{ system: system([event('edge', 100, 40)]), top: 0 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.viewport.scrollTop).toBe(0);
    expect(f.controller.isVisible({ sourceId: 'edge' })).toBe(true);
    expect(f.offsets('edge').y).toBeLessThan(token.offsetY);
  });

  it('does not guess another event or system when its anchored source disappears', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.update([{ system: system([event('different', 100, 700)]), top: 0 }]);
    expect(f.controller.restore(token)).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });

  it('does not accept a copied token in place of its latest captured token', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.update([{ system: system(), top: 300 }]);
    expect(f.controller.restore({ ...token })).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
    expect(f.controller.restore(token)).toBe(true);
  });

  it('does not make a scroll request when the musical point is already at its saved offset', () => {
    const f = fixture(); const token = f.controller.capture()!;
    expect(f.controller.restore(token)).toBe(true);
    expect(f.scrollTo).not.toHaveBeenCalled();
  });
});

describe('newer user intent and render races', () => {
  it.each(['wheel', 'touchstart', 'pointerdown'])('ENG-ANCHOR-RACE: %s cancels a pending restoration', type => {
    const f = fixture(); const token = f.controller.capture()!;
    f.viewport.dispatchEvent(new Event(type, { bubbles: true }));
    f.update([{ system: system(), top: 400 }]);
    expect(f.controller.restore(token)).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });

  it('keyboard navigation from the score editor cancels, while a form arrow key does not', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(f.controller.restore(token)).toBe(false);
    const input = document.createElement('input'); f.viewport.append(input);
    const next = f.controller.capture()!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    f.update([{ system: system(), top: 200 }]);
    expect(f.controller.restore(next)).toBe(true);
  });

  it('keyboard panning from a focused inner shadow scroller cancels before its scroll event', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.rowElements[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
    f.update([{ system: system(), top: 300 }]);
    expect(f.controller.restore(token)).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });

  it('a native inner-shadow scroll cancels even while current geometry is unavailable', () => {
    const f = fixture(); const first = f.controller.capture()!;
    f.invalidate(); const next = f.controller.capture()!;
    expect(next.generation).toBeGreaterThan(first.generation);
    f.rowElements[0].scrollLeft = 50;
    f.rowElements[0].dispatchEvent(new Event('scroll'));
    f.update([{ system: system(), top: 400 }]);
    expect(f.controller.restore(next)).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });

  it('detects user scrolling before its queued scroll event is delivered', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.viewport.scrollTop = 80;
    expect(f.controller.restore(token)).toBe(false);
    expect(f.viewport.scrollTop).toBe(80);
  });

  it('a newer capture invalidates an old render token', () => {
    const f = fixture(); const old = f.controller.capture()!; const current = f.controller.capture()!;
    f.update([{ system: system(), top: 400 }]);
    expect(f.controller.restore(old)).toBe(false); expect(f.viewport.scrollTop).toBe(0);
    expect(f.controller.restore(current)).toBe(true); expect(f.viewport.scrollTop).toBe(400);
  });

  it('carries an unconsumed musical anchor into a newer render without accepting the old token', () => {
    const f = fixture(); const old = f.controller.capture()!;
    f.invalidate(); const current = f.controller.capture()!;
    expect(current).toMatchObject({ sourceId: old.sourceId, offsetX: old.offsetX, offsetY: old.offsetY });
    expect(f.controller.restore(old)).toBe(false); expect(f.controller.restore(current)).toBe(false);
    f.update([{ system: system(), top: 300 }]);
    expect(f.controller.restore(current)).toBe(true); expect(f.viewport.scrollTop).toBe(300);
  });

  it.each(['other-project:score:write', 'project:part:write', 'project:score:read'])('rejects a changed document/part/view context %s', context => {
    const f = fixture(); const token = f.controller.capture()!;
    f.setContext(context); f.update([{ system: system(), top: 500 }]);
    expect(f.controller.restore(token)).toBe(false); expect(f.viewport.scrollTop).toBe(0);
  });

  it('refuses stale geometry until the current render revision is published', () => {
    const f = fixture(); const token = f.controller.capture()!;
    f.staleRevision(); expect(f.controller.restore(token)).toBe(false);
    f.update([{ system: system(), top: 200 }]);
    expect(f.controller.restore(token)).toBe(true); expect(f.viewport.scrollTop).toBe(200);
  });

  it('tolerates a renderer teardown clamp without confusing it with a new user scroll', () => {
    const f = fixture([{ system: system([event('note', 100, 600)]), top: 0 }]);
    f.viewport.scrollTop = 550; const token = f.controller.capture()!;
    f.setHeight(100); expect(f.viewport.scrollTop).toBe(0);
    f.update([{ system: system([event('note', 100, 700)]), top: 0 }]); f.setHeight();
    f.viewport.dispatchEvent(new Event('scroll'));
    expect(f.controller.restore(token)).toBe(true); expect(f.viewport.scrollTop).toBe(650);
  });

  it('still lets a user wheel cancel during a renderer teardown clamp', () => {
    const f = fixture([{ system: system([event('note', 100, 600)]), top: 0 }]);
    f.viewport.scrollTop = 550; const token = f.controller.capture()!;
    f.setHeight(100); expect(f.viewport.scrollTop).toBe(0);
    f.viewport.dispatchEvent(new Event('wheel'));
    f.update([{ system: system([event('note', 100, 700)]), top: 0 }]); f.setHeight();
    expect(f.controller.restore(token)).toBe(false); expect(f.viewport.scrollTop).toBe(0);
  });

  it('ignores its own delayed scroll event after a subsequent capture', () => {
    const f = fixture([{ system: system([event('note', 100, 600)]), top: 0 }]);
    expect(f.controller.reveal({ sourceId: 'note' })).toBe(true);
    const token = f.controller.capture()!;
    f.viewport.dispatchEvent(new Event('scroll'));
    f.update([{ system: system([event('note', 100, 700)]), top: 0 }]);
    expect(f.controller.restore(token)).toBe(true);
  });

  it('stops an old restoration if a scroll callback starts a newer navigation', () => {
    const f = fixture([{ system: system([event('note', 900, 100)]), top: 0 }]);
    f.rowElements[0].scrollLeft = 800; const token = f.controller.capture()!;
    f.update([{ system: system([event('note', 1100, 100)], [measure()], { width: 1600 }), top: 500 }]);
    const original = f.rowElements[0].scrollTo.bind(f.rowElements[0]);
    Object.defineProperty(f.rowElements[0], 'scrollTo', { value: (options: ScrollToOptions) => { original(options); f.controller.cancel(); } });
    expect(f.controller.restore(token)).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });
});

describe('explicit musical reveal and visibility', () => {
  it('ENG-LEDGER reveals actual high/low event ink below reserved controls, not anchorY', () => {
    const high = event('C7', 100, 15, { ink: { x: 90, y: 5, width: 40, height: 55 }, anchorY: 60 });
    const low = event('C2', 100, 715, { staffId: 'lower', measureId: 'low-bar', voiceId: 'low-voice',
      ink: { x: 90, y: 700, width: 40, height: 60 }, anchorY: 420 });
    const f = fixture([{ system: system([high, low], [measure(), measure('low-bar', 'lower', { topLine: 400, bottomLine: 440 })]), top: 100 }], { height: 180 });
    f.setInsets({ top: 48 }); f.viewport.scrollTop = 300;
    expect(f.controller.isVisible({ sourceId: 'C2', staffId: 'lower' })).toBe(false);
    expect(f.controller.reveal({ sourceId: 'C2', staffId: 'lower', voiceIndex: 0 })).toBe(true);
    expect(f.viewport.scrollTop).toBe(688);
    expect(f.controller.isVisible({ sourceId: 'C2', staffId: 'lower' })).toBe(true);
    expect(f.headPoint('C2').y).toBeGreaterThan(148);
    expect(f.controller.reveal({ sourceId: 'C7' })).toBe(true);
    expect(f.viewport.scrollTop).toBe(49);
    expect(f.controller.isVisible({ sourceId: 'C7' })).toBe(true);
    for (const [options] of f.scrollTo.mock.calls) expect(options.behavior).toBe('instant');
  });

  it('reveals the selected measure voice in a tall staff without retargeting to voice one', () => {
    const first = event('voice-one', 100, 400, { voiceId: 'voice-one' });
    const second = event('voice-two', 100, 800, { voiceId: 'voice-two' });
    const f = fixture([{ system: system([first, second], [measure('bar', 'staff', { topLine: 400, bottomLine: 440 })]), top: 0 }]);
    expect(f.controller.reveal({ sourceId: 'bar', staffId: 'staff', voiceIndex: 1 })).toBe(true);
    expect(f.headPoint('voice-two').y).toBeGreaterThanOrEqual(108);
    expect(f.headPoint('voice-two').y).toBeLessThanOrEqual(312);
    expect(f.headPoint('voice-one').y).toBeLessThan(100);
    const before = f.viewport.scrollTop;
    expect(f.controller.reveal({ sourceId: 'bar', voiceIndex: 9 })).toBe(false);
    expect(f.viewport.scrollTop).toBe(before);
  });

  it('explicit reveal cancels pending preservation and does not itself change selection or source', () => {
    const f = fixture([{ system: system([event('visible', 100, 100), event('selected', 100, 700)]), top: 0 }]);
    f.setSelection({ sourceId: 'selected', staffId: 'staff' });
    const source = f.surface.outerHTML; const token = f.controller.capture()!;
    expect(token.sourceId).toBe('visible'); expect(f.controller.isVisible()).toBe(false);
    expect(f.controller.reveal()).toBe(true); expect(f.controller.isVisible()).toBe(true);
    expect(f.controller.restore(token)).toBe(false);
    expect(f.getSelection).toHaveBeenCalled(); expect(f.surface.outerHTML).toBe(source);
  });

  it('uses current source identity when an implicit voice ID changes between projections', () => {
    const f = fixture([{ system: system([event('note', 100, 100, { voiceId: 'old-implicit-voice' })]), top: 0 }]);
    const token = f.controller.capture()!;
    f.update([{ system: system([event('note', 100, 100, { voiceId: 'new-implicit-voice' })]), top: 300 }]);
    expect(f.controller.restore(token)).toBe(true);
    expect(f.controller.reveal({ sourceId: 'note', voiceIndex: 0 })).toBe(true);
    expect(f.controller.reveal({ sourceId: 'note', voiceId: 'old-implicit-voice' })).toBe(false);
  });

  it('does not reveal a different head when an explicit source pitch index no longer exists', () => {
    const f = fixture([{ system: system([event('note', 100, 700)]), top: 0 }]);
    expect(f.controller.reveal({ sourceId: 'note', pitchIndex: 2 })).toBe(false);
    expect(f.viewport.scrollTop).toBe(0);
  });

  it('does not use hidden, detached, singular or missing geometry', () => {
    const f = fixture();
    Object.defineProperty(f.svgs[0], 'getScreenCTM', { value: () => matrix(0, 0, 0, 0) });
    expect(f.controller.capture()).toBeUndefined(); expect(f.controller.reveal()).toBe(false);
    f.update([{ system: system(), top: 0 }]); f.resize(400, 0);
    expect(f.controller.capture()).toBeUndefined(); expect(f.controller.isVisible()).toBe(false);
    f.resize(400, 220); f.setAvailable(false);
    expect(f.controller.capture()).toBeUndefined();
    f.setAvailable(true); f.viewport.remove(); expect(f.controller.reveal()).toBe(false);
  });

  it('requires a published projection even while cached layout geometry remains current', () => {
    const f = fixture();
    const layout = f.surface.getLayoutGeometry(); const revision = f.surface.renderRevision;
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
    f.setProjectionAvailable(false);
    expect(f.surface.getLayoutGeometry()).toBe(layout); expect(f.surface.renderRevision).toBe(revision);
    expect(f.controller.capture()).toBeUndefined(); expect(f.controller.isVisible({ sourceId: 'note' })).toBe(false);
    expect(f.controller.reveal({ sourceId: 'note' })).toBe(false); expect(f.scrollTo).not.toHaveBeenCalled();
    f.setProjectionAvailable(true);
    expect(f.controller.capture()).toMatchObject({ sourceId: 'note', projectionId: layout!.projectionId, renderRevision: revision });
    expect(f.surface.getLayoutGeometry()).toBe(layout); expect(f.surface.renderRevision).toBe(revision);
  });

  it('disposes pending work and listeners without changing scroll or musical data', () => {
    const f = fixture(); const token = f.controller.capture()!; const source = f.surface.outerHTML;
    f.controller.dispose(); f.viewport.dispatchEvent(new Event('wheel'));
    f.update([{ system: system(), top: 500 }]);
    expect(f.controller.capture()).toBeUndefined(); expect(f.controller.restore(token)).toBe(false);
    expect(f.controller.reveal()).toBe(false); expect(f.viewport.scrollTop).toBe(0);
    expect(f.surface.outerHTML).toBe(source);
  });
});

describe('AUTHOR-MARKING-IDENTITY: exact attached marking reveal', () => {
  it('distinguishes two marks on one visible owner without changing source, model, selection or revision', () => {
    const near = marking('accent');
    const far = marking('turn', { kind: 'ornament', x: 940, y: 730, width: 36, height: 18 });
    const f = fixture([{ system: system([event()], [measure()], { markings: [near, far] }), top: 0 }]);
    const selected = { sourceId: far.sourceId, staffId: 'staff', measureId: 'bar', voiceIndex: 0 };
    f.setSelection(selected);
    const source = f.surface.outerHTML; const score = structuredClone(f.surface.score);
    const layout = f.surface.getLayoutGeometry(); const revision = f.surface.renderRevision;
    const token = f.controller.capture()!;
    expect(token.sourceId).toBe('note'); expect(f.getSelection).not.toHaveBeenCalled();
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
    expect(f.controller.isVisible({ sourceId: near.sourceId })).toBe(true);
    expect(f.controller.isVisible()).toBe(false);
    expect(f.controller.reveal()).toBe(true); expect(f.controller.isVisible()).toBe(true);
    expect(f.controller.isVisible({ sourceId: near.sourceId })).toBe(false);
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(false);
    expect(f.rowElements[0].scrollLeft).toBe(576); expect(f.viewport.scrollTop).toBe(536);
    expect(f.viewport.scrollLeft).toBe(0);
    expect(f.controller.restore(token)).toBe(false);
    expect(f.controller.reveal({ sourceId: near.sourceId })).toBe(true);
    expect(f.controller.isVisible({ sourceId: near.sourceId })).toBe(true);
    expect(f.controller.isVisible()).toBe(false);
    expect(f.getSelection()).toBe(selected);
    expect(f.surface.outerHTML).toBe(source); expect(f.surface.score).toEqual(score);
    expect(f.surface.getLayoutGeometry()).toBe(layout); expect(f.surface.renderRevision).toBe(revision);
  });

  it('reveals complete child ink across nested horizontal scrolling and tall ledger extents below controls', () => {
    const child = marking('low-mark', { x: 900, y: 690, width: 54, height: 78, placement: 'below' });
    const f = fixture([{ system: system([event()], [measure()], { markings: [child] }), top: 120 }],
      { width: 400, height: 180, scale: 1.25, border: 2, svgA: 1.1, svgD: 1.2 });
    f.setInsets({ top: 48 }); f.setSelection({ sourceId: child.sourceId, staffId: child.staffId, voiceIndex: 0 });
    const before = f.svgs[0].getScreenCTM()!;
    expect(f.controller.isVisible()).toBe(false);
    expect(f.controller.reveal()).toBe(true); expect(f.controller.isVisible()).toBe(true);
    const after = f.svgs[0].getScreenCTM()!;
    expect(after.d * child.y + after.f).toBeGreaterThanOrEqual(100 + (2 + 48) * 1.25);
    expect(after.d * (child.y + child.height) + after.f).toBeLessThanOrEqual(100 + (2 + 180) * 1.25);
    expect(after.a * child.x + after.e).toBeGreaterThanOrEqual(50 + 2 * 1.25);
    expect(after.a * (child.x + child.width) + after.e).toBeLessThanOrEqual(50 + (2 + 400) * 1.25);
    expect(f.rowElements[0].scrollLeft).toBeGreaterThan(0); expect(f.viewport.scrollTop).toBeGreaterThan(0);
    expect([after.a, after.b, after.c, after.d]).toEqual([before.a, before.b, before.c, before.d]);
  });

  it.each([
    { staffId: 'other-staff' }, { measureId: 'other-bar' }, { voiceId: 'voice-one' }, { voiceIndex: 0 },
  ])('respects the child owner association and rejects a mismatched target %j', mismatch => {
    const child = marking('voice-two-mark', { eventId: 'second', voiceId: 'voice-two', y: 700 });
    const f = fixture([{ system: system([event('first', 100, 100, { voiceId: 'voice-one' }),
      event('second', 150, 100, { voiceId: 'voice-two' })], [measure()], { markings: [child] }), top: 0 }]);
    const target = { sourceId: child.sourceId, staffId: child.staffId, measureId: child.measureId, voiceId: child.voiceId, voiceIndex: 1 };
    expect(f.controller.isVisible({ ...target, ...mismatch })).toBe(false);
    expect(f.controller.reveal({ ...target, ...mismatch })).toBe(false);
    expect(f.viewport.scrollTop).toBe(0); expect(f.scrollTo).not.toHaveBeenCalled();
    expect(f.controller.reveal(target)).toBe(true); expect(f.controller.isVisible(target)).toBe(true);
  });

  it('rejects missing or inconsistent owner geometry without borrowing another event or sibling', () => {
    const valid = marking('child', { y: 700 });
    const sibling = marking('sibling', { y: 600 });
    const f = fixture([{ system: system([event()], [measure()], { markings: [valid, sibling] }), top: 0 }]);
    const target = { sourceId: valid.sourceId };
    expect(f.controller.reveal(target)).toBe(true);
    for (const mismatch of [{ eventId: 'removed-owner' }, { staffId: 'other-staff' }, { measureId: 'other-bar' }, { voiceId: 'other-voice' }]) {
      f.update([{ system: system([event()], [measure()], { markings: [{ ...valid, ...mismatch }, sibling] }), top: 0 }]);
      f.viewport.scrollTop = 0; f.scrollTo.mockClear();
      expect(f.controller.isVisible(target)).toBe(false); expect(f.controller.reveal(target)).toBe(false);
      expect(f.viewport.scrollTop).toBe(0); expect(f.scrollTo).not.toHaveBeenCalled();
      expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
    }
  });

  it('uses the same child after reflow and implicit voice regeneration, not another mark on its owner', () => {
    const first = marking('accent', { voiceId: 'old-implicit' });
    const second = marking('turn', { kind: 'ornament', voiceId: 'old-implicit', y: 700 });
    const f = fixture([{ system: system([event('note', 100, 100, { voiceId: 'old-implicit' })], [measure()],
      { markings: [first, second] }), top: 0 }]);
    const target = { sourceId: second.sourceId, staffId: 'staff', voiceIndex: 0 };
    expect(f.controller.reveal(target)).toBe(true);
    f.update([{ system: system([event('note', 100, 100, { voiceId: 'new-implicit' })], [measure()],
      { markings: [{ ...second, voiceId: 'new-implicit', y: 600 }, { ...first, voiceId: 'new-implicit' }] }), top: 200 }]);
    expect(f.controller.reveal(target)).toBe(true); expect(f.controller.isVisible(target)).toBe(true);
    expect(f.controller.isVisible({ sourceId: first.sourceId })).toBe(false);
    expect(f.viewport.scrollTop).toBe(600);
    expect(f.controller.reveal({ ...target, voiceId: 'old-implicit' })).toBe(false);
  });

  it('does not reveal the owner or a surviving sibling after the selected child is removed', () => {
    const child = marking('removed', { y: 700 }); const sibling = marking('survivor');
    const f = fixture([{ system: system([event()], [measure()], { markings: [child, sibling] }), top: 0 }]);
    f.setSelection({ sourceId: child.sourceId, staffId: 'staff', measureId: 'bar', voiceIndex: 0 });
    expect(f.controller.reveal()).toBe(true);
    f.update([{ system: system([event()], [measure()], { markings: [sibling] }), top: 0 }]);
    f.viewport.scrollTop = 0; f.scrollTo.mockClear();
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
    expect(f.controller.isVisible({ sourceId: sibling.sourceId })).toBe(true);
    expect(f.controller.isVisible()).toBe(false); expect(f.controller.reveal()).toBe(false);
    expect(f.viewport.scrollTop).toBe(0); expect(f.scrollTo).not.toHaveBeenCalled();
    expect(f.getSelection()?.sourceId).toBe(child.sourceId);
  });

  it('cannot reveal a child excluded from the current part or restore the previous part anchor', () => {
    const child = marking('lower-mark', { eventId: 'lower-note', staffId: 'lower', measureId: 'lower-bar', voiceId: 'lower-voice', y: 700 });
    const upper = event('upper-note');
    const lower = event('lower-note', 100, 700, { staffId: 'lower', measureId: 'lower-bar', voiceId: 'lower-voice' });
    const f = fixture([{ system: system([upper, lower], [measure(), measure('lower-bar', 'lower')], { markings: [child] }), top: 0 }]);
    f.setSelection({ sourceId: child.sourceId, staffId: 'lower', measureId: 'lower-bar', voiceIndex: 0 });
    expect(f.controller.reveal()).toBe(true);
    const token = f.controller.capture()!;
    f.setContext('project:upper-part:write');
    f.update([{ system: system([upper], [measure()], { markings: [] }), top: 0 }]);
    f.viewport.scrollTop = 0; f.scrollTo.mockClear();
    expect(f.controller.restore(token)).toBe(false);
    expect(f.controller.isVisible()).toBe(false); expect(f.controller.reveal()).toBe(false);
    expect(f.viewport.scrollTop).toBe(0); expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('fails safely with older adapters that do not publish child marking geometry', () => {
    const f = fixture();
    expect(f.surface.getLayoutGeometry()!.systems[0].markings).toBeUndefined();
    expect(f.controller.isVisible({ sourceId: 'note' })).toBe(true);
    expect(f.controller.isVisible({ sourceId: 'unpublished-child' })).toBe(false);
    expect(f.controller.reveal({ sourceId: 'unpublished-child' })).toBe(false);
    expect(f.scrollTo).not.toHaveBeenCalled();
  });
});
