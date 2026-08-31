import type { LayoutGeometry, MusicSurface } from '../components/music-surface.js';
import type { EventGeometry, MeasureGeometry, SystemGeometry } from '../engraving/render.js';
import { transformInk, unionInk } from '../engraving/geometry.js';
import type { InkBox } from '../engraving/geometry.js';
import { composedContains, composedParent } from '../ui/composed-dom.js';

export interface MusicalViewportTarget {
  /** Exact source identity, including an attached marking's own child ID. */
  readonly sourceId: string;
  readonly staffId?: string;
  readonly measureId?: string;
  readonly voiceId?: string;
  /** Useful when a projection regenerates implicit voice IDs. */
  readonly voiceIndex?: number;
  readonly pitchIndex?: number;
}

export interface ViewportInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** A single-use musical position, independent of selection and system wrapping. */
export interface ViewportAnchorToken {
  readonly generation: number;
  readonly kind: 'notehead' | 'event' | 'measure';
  readonly sourceId: string;
  readonly staffId: string;
  readonly measureId: string;
  readonly voiceId?: string;
  readonly voiceIndex?: number;
  readonly pitchIndex?: number;
  /** Physical screen-pixel offsets from the usable score viewport's top-left. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scoreId: string;
  readonly projectionId: string;
  readonly renderRevision: number;
}

export interface ViewportAnchorOptions {
  readonly getSurface: () => MusicSurface | undefined;
  readonly getViewport: () => HTMLElement | undefined;
  /** Consulted only by explicit reveal/isVisible, never by capture. */
  readonly getSelection?: () => MusicalViewportTarget | undefined;
  /** Reserved overlay controls, in the viewport element's own CSS pixels. */
  readonly getInsets?: () => ViewportInsets;
  /** Include document, part and view identity when sources may reuse IDs. */
  readonly getContextKey?: () => string;
}

export interface ViewportAnchor {
  /** Call before a layout/source render; a newer capture supersedes an old one. */
  capture(): ViewportAnchorToken | undefined;
  /** Call after the current surface render settles. Clamping may limit offsets. */
  restore(token: ViewportAnchorToken | undefined): boolean;
  /** Cancel before explicit navigation, project/part/view changes, or disposal. */
  cancel(): void;
  /** Deliberate navigation only. Does not focus, select, or change musical data. */
  reveal(target?: MusicalViewportTarget): boolean;
  isVisible(target?: MusicalViewportTarget): boolean;
  dispose(): void;
}

interface Point { x: number; y: number }
interface Rect { left: number; top: number; right: number; bottom: number }
interface Frame { system: SystemGeometry; svg: SVGSVGElement; ancestors: readonly HTMLElement[] }
interface State {
  surface: MusicSurface;
  viewport: HTMLElement;
  layout: LayoutGeometry;
  frames: readonly Frame[];
  rect: Rect;
  context: string;
}
interface Reference {
  kind: ViewportAnchorToken['kind']; sourceId: string; staffId: string; measureId: string;
  voiceId?: string; voiceIndex?: number; pitchIndex?: number;
}
interface Located { frame: Frame; box: InkBox; reference: Reference }
interface RevealLocation { frame: Frame; box: InkBox; focus: InkBox }
interface ScrollPosition { left: number; top: number }
interface ScrollRecord extends ScrollPosition { maxLeft: number; maxTop: number }
interface Pending {
  token: ViewportAnchorToken; reference: Reference; xRatio: number; yRatio: number;
  viewport: HTMLElement; surface: MusicSurface; svg: SVGSVGElement; context: string;
  scrolls: ReadonlyMap<HTMLElement, ScrollRecord>;
  clamps: Map<HTMLElement, ScrollPosition>;
}

const EPSILON = 0.5;
const finite = (value: number): boolean => Number.isFinite(value);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const asRect = (box: InkBox): Rect => ({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });
const intersect = (a: Rect, b: Rect): Rect | undefined => {
  const result = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return result.right > result.left && result.bottom > result.top ? result : undefined;
};
const center = (box: InkBox): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const transformPoint = (point: Point, matrix: DOMMatrix): Point => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

function matrixFor(svg: SVGSVGElement): DOMMatrix | undefined {
  const matrix = svg.getScreenCTM();
  return matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(finite)
    && Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) > 1e-10 ? matrix : undefined;
}

/** Follow visible ancestry through slots and shadow hosts. */
function ancestorsOf(start: Element, viewport: HTMLElement): readonly HTMLElement[] {
  const result: HTMLElement[] = [];
  let element: Element | null = start;
  while (element && element !== viewport) {
    element = composedParent(element);
    if (element instanceof HTMLElement) result.push(element);
  }
  return element === viewport ? result : [];
}

function elementScale(element: HTMLElement): Point {
  const bounds = element.getBoundingClientRect();
  return { x: element.offsetWidth > 0 && bounds.width > 0 ? bounds.width / element.offsetWidth : 1,
    y: element.offsetHeight > 0 && bounds.height > 0 ? bounds.height / element.offsetHeight : 1 };
}

function clientRect(element: HTMLElement, insets: ViewportInsets = {}): Rect {
  const bounds = element.getBoundingClientRect();
  const scale = elementScale(element);
  const inset = (value: number | undefined): number => finite(value ?? 0) ? Math.max(0, value ?? 0) : 0;
  const left = bounds.left + element.clientLeft * scale.x;
  const top = bounds.top + element.clientTop * scale.y;
  return { left: left + inset(insets.left) * scale.x, top: top + inset(insets.top) * scale.y,
    right: left + (element.clientWidth - inset(insets.right)) * scale.x,
    bottom: top + (element.clientHeight - inset(insets.bottom)) * scale.y };
}

function overflow(element: HTMLElement): { x: string; y: string } {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return { x: style.overflowX || style.overflow || 'visible', y: style.overflowY || style.overflow || 'visible' };
}
const clips = (value: string): boolean => ['auto', 'scroll', 'hidden', 'clip'].includes(value);
const permitsScroll = (value: string): boolean => ['auto', 'scroll', 'hidden'].includes(value);
const scrollRecord = (element: HTMLElement): ScrollRecord => ({ left: element.scrollLeft, top: element.scrollTop,
  maxLeft: Math.max(0, element.scrollWidth - element.clientWidth), maxTop: Math.max(0, element.scrollHeight - element.clientHeight) });

function frameClip(frame: Frame, state: State): Rect | undefined {
  let rect: Rect | undefined = state.rect;
  for (const element of frame.ancestors) {
    if (element === state.viewport) break;
    const axes = overflow(element);
    if (!clips(axes.x) && !clips(axes.y)) continue;
    const inner = clientRect(element);
    rect = intersect(rect, { left: clips(axes.x) ? inner.left : -Infinity, right: clips(axes.x) ? inner.right : Infinity,
      top: clips(axes.y) ? inner.top : -Infinity, bottom: clips(axes.y) ? inner.bottom : Infinity });
    if (!rect) return undefined;
  }
  return rect;
}

function voiceIndex(surface: MusicSurface, event: EventGeometry): number | undefined {
  const index = surface.score?.staves.find(staff => staff.id === event.staffId)?.measures
    .find(measure => measure.id === event.measureId)?.voices.findIndex(voice => voice.events.some(item => item.id === event.sourceId));
  return index === undefined || index < 0 ? undefined : index;
}

function eventReference(surface: MusicSurface, event: EventGeometry): Reference {
  return { kind: 'event', sourceId: event.sourceId, staffId: event.staffId, measureId: event.measureId,
    voiceId: event.voiceId, voiceIndex: voiceIndex(surface, event) };
}

function measureReference(measure: MeasureGeometry): Reference {
  return { kind: 'measure', sourceId: measure.sourceId, staffId: measure.staffId, measureId: measure.sourceId };
}

/** Use a complete bound when it fits; otherwise reveal its meaningful local focus. */
function revealRect(box: Rect, focus: Rect, available: Rect): Rect {
  const wide = box.right - box.left > available.right - available.left;
  const tall = box.bottom - box.top > available.bottom - available.top;
  return { left: wide ? focus.left : box.left, right: wide ? focus.right : box.right,
    top: tall ? focus.top : box.top, bottom: tall ? focus.bottom : box.bottom };
}

function revealDelta(start: number, end: number, minimum: number, maximum: number): number {
  if (end - start > maximum - minimum) return start - minimum;
  return start < minimum ? start - minimum : end > maximum ? end - maximum : 0;
}

class MusicalViewport implements ViewportAnchor {
  private generation = 0;
  private pending?: Pending;
  private disposed = false;
  private viewport?: HTMLElement;
  private removals: (() => void)[] = [];
  private readonly scrollListeners = new Map<EventTarget, () => void>();
  private expectedScrolls = new WeakMap<HTMLElement, ScrollPosition>();
  private applyingScroll = false;
  private readonly options: ViewportAnchorOptions;

  constructor(options: ViewportAnchorOptions) { this.options = options; this.bind(options.getViewport(), []); }

  private bind(viewport: HTMLElement | undefined, frames: readonly Frame[]): void {
    if (this.disposed) return;
    if (viewport !== this.viewport) {
      this.removals.forEach(remove => remove()); this.removals = [];
      this.scrollListeners.forEach(remove => remove()); this.scrollListeners.clear();
      this.viewport = viewport;
      if (viewport) {
        const intent = () => this.cancel();
        for (const name of ['wheel', 'touchstart', 'pointerdown']) {
          viewport.addEventListener(name, intent, { passive: true, capture: true });
          this.removals.push(() => viewport.removeEventListener(name, intent, true));
        }
        const navigate = (event: KeyboardEvent) => {
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
          const elements = event.composedPath().filter((node): node is Element => node instanceof Element);
          if (elements.some(element => element.matches('input,textarea,select,[contenteditable="true"]'))) return;
          const target = elements[0];
          if (target && (composedContains(viewport, target) || composedContains(target, viewport))) this.cancel();
        };
        viewport.ownerDocument.addEventListener('keydown', navigate, true);
        this.removals.push(() => viewport.ownerDocument.removeEventListener('keydown', navigate, true));
        viewport.addEventListener('notation-viewport-change', this.onScroll, { passive: true, capture: true });
        this.removals.push(() => viewport.removeEventListener('notation-viewport-change', this.onScroll, true));
      }
    }
    const targets = new Set<EventTarget>(viewport ? [viewport] : []);
    // A font wait or source invalidation must not leave the old, still-visible
    // shadow scrollers unobserved while a replacement projection is pending.
    if (this.pending && viewport === this.viewport && !frames.length) {
      for (const target of this.scrollListeners.keys()) targets.add(target);
    }
    for (const frame of frames) for (const ancestor of frame.ancestors) targets.add(ancestor);
    for (const [target, remove] of this.scrollListeners) if (!targets.has(target)) { remove(); this.scrollListeners.delete(target); }
    for (const target of targets) if (!this.scrollListeners.has(target)) {
      target.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
      this.scrollListeners.set(target, () => target.removeEventListener('scroll', this.onScroll, true));
    }
  }

  private readonly onScroll = (event: Event): void => {
    const element: unknown = event.type === 'notation-viewport-change'
      ? (event as CustomEvent<{ scroller: HTMLElement }>).detail?.scroller : event.target;
    if (this.applyingScroll || !this.pending || !(element instanceof HTMLElement)) return;
    const expected = this.expectedScrolls.get(element);
    if (expected && near(expected.left, element.scrollLeft) && near(expected.top, element.scrollTop)) return;
    if (this.layoutClamp(element, this.pending)) return;
    this.cancel();
  };

  private state(): State | undefined {
    if (this.disposed) return undefined;
    const viewport = this.options.getViewport();
    const surface = this.options.getSurface();
    if (!viewport?.isConnected || !surface?.isConnected) { this.bind(viewport, []); return undefined; }
    const projection = surface.getRenderedProjection();
    if (!projection || projection.layout.revision !== surface.renderRevision) { this.bind(viewport, []); return undefined; }
    const { layout } = projection;
    const rect = clientRect(viewport, this.options.getInsets?.());
    if (rect.right <= rect.left || rect.bottom <= rect.top) return undefined;
    const frames: Frame[] = [];
    for (const { system, svg } of projection.frames) {
      if (!matrixFor(svg)) continue;
      const ancestors = ancestorsOf(svg, viewport);
      if (ancestors.length) frames.push({ system, svg, ancestors });
    }
    this.bind(viewport, frames);
    return { viewport, surface, layout, rect, frames, context: this.options.getContextKey?.() ?? layout.scoreId };
  }

  private current(state: State, generation: number): boolean {
    return !this.disposed && generation === this.generation && this.options.getViewport() === state.viewport
      && this.options.getSurface() === state.surface && state.surface.getRenderedProjection()?.layout === state.layout
      && state.surface.renderRevision === state.layout.revision
      && (this.options.getContextKey?.() ?? state.layout.scoreId) === state.context;
  }

  private candidates(state: State): Located[] {
    const events: Located[] = [];
    const measures: Located[] = [];
    const visible = (location: Located): boolean => {
      const clip = frameClip(location.frame, state); const matrix = matrixFor(location.frame.svg);
      return !!(clip && matrix && intersect(clip, asRect(transformInk(location.box, matrix))));
    };
    for (const frame of state.frames) {
      for (const event of frame.system.events) {
        const reference = eventReference(state.surface, event);
        const heads = (event.noteheads ?? []).map(head => ({ frame, box: head,
          reference: { ...reference, kind: 'notehead' as const, pitchIndex: head.pitchIndex } })).filter(visible);
        if (heads.length) events.push(...heads);
        else { const location = { frame, box: event.ink, reference }; if (visible(location)) events.push(location); }
      }
      for (const measure of frame.system.measures) {
        const location = { frame, box: measure, reference: measureReference(measure) };
        if (visible(location)) measures.push(location);
      }
    }
    return events.length ? events : measures;
  }

  capture(): ViewportAnchorToken | undefined {
    if (this.disposed) return undefined;
    const previous = this.pending;
    const generation = ++this.generation;
    const state = this.state();
    if (!state) {
      // A newer render can supersede an unfinished render without losing its
      // original musical anchor. Any intervening user intent already canceled it.
      if (previous && previous.viewport === this.options.getViewport() && previous.viewport.isConnected
        && (this.options.getContextKey ? this.options.getContextKey() === previous.context : this.options.getSurface() === previous.surface)
        && !this.changedScroll(previous)) {
        const token = Object.freeze({ ...previous.token, generation });
        this.pending = { ...previous, token };
        return token;
      }
      this.pending = undefined;
      return undefined;
    }
    this.pending = undefined;
    const candidates = this.candidates(state).map(location => {
      const matrix = matrixFor(location.frame.svg)!;
      const visible = intersect(frameClip(location.frame, state)!, asRect(transformInk(location.box, matrix)))!;
      return { location, matrix, visible };
    }).sort((a, b) => a.visible.top - b.visible.top || a.visible.left - b.visible.left);
    const chosen = candidates[0];
    if (!chosen) return undefined;
    const { location, matrix, visible } = chosen;
    const middle = transformPoint(center(location.box), matrix);
    const point = { x: clamp(middle.x, visible.left, visible.right), y: clamp(middle.y, visible.top, visible.bottom) };
    const local = transformPoint(point, matrix.inverse());
    const token: ViewportAnchorToken = Object.freeze({ generation, ...location.reference,
      offsetX: point.x - state.rect.left, offsetY: point.y - state.rect.top,
      scoreId: state.layout.scoreId, projectionId: state.layout.projectionId, renderRevision: state.layout.revision });
    this.pending = { token, reference: location.reference,
      xRatio: clamp((local.x - location.box.x) / location.box.width, 0, 1),
      yRatio: clamp((local.y - location.box.y) / location.box.height, 0, 1),
      viewport: state.viewport, surface: state.surface, svg: location.frame.svg, context: state.context,
      scrolls: new Map(location.frame.ancestors.map(element => [element, scrollRecord(element)])), clamps: new Map() };
    return token;
  }

  private locate(state: State, reference: Reference): Located | undefined {
    for (const frame of state.frames) {
      if (reference.kind === 'measure') {
        const measure = frame.system.measures.find(item => item.sourceId === reference.sourceId && item.staffId === reference.staffId);
        if (measure) return { frame, box: measure, reference };
      } else {
        const event = frame.system.events.find(item => item.sourceId === reference.sourceId && item.staffId === reference.staffId);
        if (!event) continue;
        const box = reference.kind === 'notehead' ? event.noteheads?.find(head => head.pitchIndex === reference.pitchIndex) : event.ink;
        if (box) return { frame, box, reference };
      }
    }
    return undefined;
  }

  private layoutClamp(element: HTMLElement, pending: Pending): boolean {
    const before = pending.scrolls.get(element);
    if (!before) return false;
    const now = scrollRecord(element);
    const accepted = pending.clamps.get(element);
    if (accepted && near(accepted.left, now.left) && near(accepted.top, now.top)) return true;
    const replaced = !pending.svg.isConnected;
    const clamped = (previous: number, current: number, maximum: number) => near(previous, current)
      || (previous > maximum && near(current, maximum)) || (replaced && previous > 0 && near(current, 0));
    if (clamped(before.left, now.left, now.maxLeft) && clamped(before.top, now.top, now.maxTop)) {
      pending.clamps.set(element, now);
      return true;
    }
    return false;
  }

  private changedScroll(pending: Pending): boolean {
    for (const [element, before] of pending.scrolls) {
      if (!element.isConnected || (near(element.scrollLeft, before.left) && near(element.scrollTop, before.top))) continue;
      const expected = this.expectedScrolls.get(element);
      if (expected && near(expected.left, element.scrollLeft) && near(expected.top, element.scrollTop)) continue;
      if (!this.layoutClamp(element, pending)) return true;
    }
    return false;
  }

  private scroll(element: HTMLElement, x: number, y: number, viewport: HTMLElement): void {
    const axes = overflow(element); const range = scrollRecord(element); const scale = elementScale(element);
    const left = element === viewport || permitsScroll(axes.x) ? clamp(range.left + x / scale.x, 0, range.maxLeft) : range.left;
    const top = element === viewport || permitsScroll(axes.y) ? clamp(range.top + y / scale.y, 0, range.maxTop) : range.top;
    if (near(left, range.left) && near(top, range.top)) return;
    this.applyingScroll = true;
    try {
      if (typeof element.scrollTo === 'function') element.scrollTo({ left, top, behavior: 'instant' });
      else { element.scrollLeft = left; element.scrollTop = top; }
      this.expectedScrolls.set(element, { left: element.scrollLeft, top: element.scrollTop });
    } finally { this.applyingScroll = false; }
  }

  restore(token: ViewportAnchorToken | undefined): boolean {
    const pending = this.pending;
    if (!token || !pending || pending.token !== token || this.disposed) return false;
    const state = this.state();
    if (!state) return false;
    if (pending.viewport !== state.viewport || pending.context !== state.context || token.scoreId !== state.layout.scoreId || this.changedScroll(pending)) {
      this.cancel(); return false;
    }
    const location = this.locate(state, pending.reference);
    this.pending = undefined;
    if (!location) return false;
    const goal = { x: state.rect.left + token.offsetX, y: state.rect.top + token.offsetY };
    for (const element of location.frame.ancestors) {
      if (!this.current(state, token.generation)) return false;
      const matrix = matrixFor(location.frame.svg); if (!matrix) return false;
      const point = transformPoint({ x: location.box.x + location.box.width * pending.xRatio,
        y: location.box.y + location.box.height * pending.yRatio }, matrix);
      const rect = element === state.viewport ? state.rect : clientRect(element);
      this.scroll(element, point.x - clamp(goal.x, rect.left, rect.right), point.y - clamp(goal.y, rect.top, rect.bottom), state.viewport);
    }
    return this.current(state, token.generation);
  }

  cancel(): void { this.generation++; this.pending = undefined; this.expectedScrolls = new WeakMap(); }

  private target(state: State, target: MusicalViewportTarget): RevealLocation | undefined {
    for (const frame of state.frames) {
      const staffMatches = (staffId: string) => target.staffId === undefined || target.staffId === staffId;
      const voiceMatches = (event: EventGeometry): boolean => (target.voiceId === undefined || target.voiceId === event.voiceId)
        && (target.voiceIndex === undefined || target.voiceIndex === voiceIndex(state.surface, event));
      const event = frame.system.events.find(item => item.sourceId === target.sourceId && staffMatches(item.staffId) && voiceMatches(item));
      if (event) {
        const head = event.noteheads?.find(item => item.pitchIndex === (target.pitchIndex ?? 0));
        if (target.pitchIndex !== undefined && !head) return undefined;
        return { frame, box: event.ink, focus: head ?? event.ink };
      }
      const child = frame.system.markings?.find(item => item.sourceId === target.sourceId);
      if (child) {
        const owner = frame.system.events.find(item => item.sourceId === child.eventId
          && item.staffId === child.staffId && item.measureId === child.measureId && item.voiceId === child.voiceId);
        if (!owner || !staffMatches(child.staffId) || !voiceMatches(owner)
          || (target.measureId !== undefined && target.measureId !== child.measureId)) return undefined;
        // Association validates the target; only this child's painted ink is
        // revealed. A visible owner or sibling cannot stand in for a hidden mark.
        return { frame, box: child, focus: child };
      }
      const marking = [...frame.system.annotations, ...frame.system.tuplets].find(item => item.sourceId === target.sourceId && staffMatches(item.staffId));
      if (marking) return { frame, box: marking, focus: marking };
      const measure = frame.system.measures.find(item => staffMatches(item.staffId)
        && (item.sourceId === target.sourceId || (item.staffId === target.sourceId && (target.measureId === undefined || item.sourceId === target.measureId))));
      if (!measure) continue;
      const events = frame.system.events.filter(item => item.measureId === measure.sourceId && voiceMatches(item));
      if ((target.voiceId !== undefined || target.voiceIndex !== undefined) && !events.length) {
        const voices = state.surface.score?.staves.find(staff => staff.id === measure.staffId)?.measures.find(item => item.id === measure.sourceId)?.voices;
        if (!voices?.some((voice, index) => (target.voiceId === undefined || voice.id === target.voiceId) && (target.voiceIndex === undefined || index === target.voiceIndex))) return undefined;
      }
      const staff = { x: measure.x, y: measure.topLine - 4, width: measure.width, height: measure.bottomLine - measure.topLine + 8 };
      const box = unionInk([staff, ...events.map(item => item.ink)])!;
      const first = events[0];
      const focus = first?.noteheads?.[0] ?? first?.ink
        ?? { x: measure.noteStartX, y: measure.topLine, width: 1, height: measure.bottomLine - measure.topLine };
      return { frame, box, focus };
    }
    return undefined;
  }

  reveal(target = this.options.getSelection?.()): boolean {
    this.cancel();
    const state = this.state(); if (!state || !target) return false;
    const location = this.target(state, target); if (!location) return false;
    const generation = this.generation;
    for (const element of location.frame.ancestors) {
      if (!this.current(state, generation)) return false;
      const matrix = matrixFor(location.frame.svg); if (!matrix) return false;
      const available = element === state.viewport ? { left: state.rect.left + 8, top: state.rect.top + 8, right: state.rect.right - 8, bottom: state.rect.bottom - 8 }
        : clientRect(element);
      if (available.right <= available.left || available.bottom <= available.top) continue;
      const box = revealRect(asRect(transformInk(location.box, matrix)), asRect(transformInk(location.focus, matrix)), available);
      this.scroll(element, revealDelta(box.left, box.right, available.left, available.right),
        revealDelta(box.top, box.bottom, available.top, available.bottom), state.viewport);
    }
    return this.current(state, generation);
  }

  isVisible(target = this.options.getSelection?.()): boolean {
    const state = this.state(); if (!state || !target) return false;
    const location = this.target(state, target); if (!location) return false;
    const matrix = matrixFor(location.frame.svg); const available = frameClip(location.frame, state);
    if (!matrix || !available) return false;
    const box = revealRect(asRect(transformInk(location.box, matrix)), asRect(transformInk(location.focus, matrix)), available);
    return box.left >= available.left - EPSILON && box.right <= available.right + EPSILON
      && box.top >= available.top - EPSILON && box.bottom <= available.bottom + EPSILON;
  }

  dispose(): void {
    this.cancel(); this.disposed = true;
    this.removals.forEach(remove => remove()); this.removals = [];
    this.scrollListeners.forEach(remove => remove()); this.scrollListeners.clear();
  }
}

/** Scroll restoration only: no focus, selection, source mutation, or music scaling. */
export function createViewportAnchor(options: ViewportAnchorOptions): ViewportAnchor {
  return new MusicalViewport(options);
}
