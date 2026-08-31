import type { LayoutGeometry, MusicSurface } from '../components/music-surface.js';
import type { EventGeometry, SystemGeometry } from '../engraving/render.js';
import { transformInk, unionInk } from '../engraving/geometry.js';
import type { InkBox } from '../engraving/geometry.js';
import type { MusicEvent } from '../model/types.js';
import type { ViewMode } from './types.js';

interface TargetScope {
  readonly sourceId: string;
  readonly staffId?: string;
  readonly measureId?: string;
  readonly voiceId?: string;
}

export type SelectionHudTarget =
  | (TargetScope & { readonly kind: 'event'; readonly eventKind: MusicEvent['kind'] })
  | (TargetScope & { readonly kind: 'marking'; readonly eventId: string });

export interface SelectionHudContext {
  readonly documentEpoch: string | number;
  readonly selectionVersion: number;
  /** The application's accepted musical revision, independent of surface rendering. */
  readonly revision: number;
  readonly partId?: string;
  readonly mode?: ViewMode;
  /** True only for a current, settled, single selection in Write · Select. */
  readonly allowFloating: boolean;
  /** Omit for event sets, measures, annotations, tuplets and other structural tools. */
  readonly target?: SelectionHudTarget;
}

export type SelectionHudDockReason = 'disabled' | 'missing-target' | 'stale-geometry' | 'offscreen'
  | 'no-space' | 'invalid-size' | 'unsafe-placement' | 'target-changed' | 'interaction' | 'disposed';

export interface SelectionHudFloatingPlacement {
  readonly kind: 'floating';
  /** Physical CSS pixels in the same viewport coordinate space as getBoundingClientRect(). */
  readonly box: InkBox;
  readonly anchor: InkBox;
  readonly anchorKind: 'notehead' | 'chord' | 'event' | 'marking';
  readonly sourceId: string;
  readonly eventId: string;
  readonly documentEpoch: string | number;
  readonly selectionVersion: number;
  readonly revision: number;
  readonly geometryRevision: number;
  readonly projectionId: string;
  /** Hidden without moving its box if an interaction has not yet released capture. */
  readonly suspended: boolean;
}

export type SelectionHudPlacement = { readonly kind: 'dock'; readonly reason: SelectionHudDockReason }
  | SelectionHudFloatingPlacement;

export interface SelectionHudOptions {
  /** One existing HTML control surface in a permanently reserved, in-flow dock. */
  readonly element: HTMLElement;
  readonly getSurface: () => MusicSurface | undefined;
  readonly getViewport: () => HTMLElement | undefined;
  readonly getContext: () => SelectionHudContext;
  /** Other independent controls, in physical viewport pixels; exclude this surface and its own chooser. */
  readonly getObstacles?: () => readonly InkBox[];
  /** Includes pointer presses, keyboard operations and open native choice surfaces. */
  readonly isInteracting: () => boolean;
  /** Synchronously invalidate activation, dismiss choices and release capture before returning. */
  readonly cancelInteraction: (reason: SelectionHudDockReason) => void;
  /** Maximum distance from the musical anchor to a clear gutter. Defaults to 160 CSS px. */
  readonly maxDistance?: number;
}

export interface SelectionHud {
  readonly placement: SelectionHudPlacement;
  /** Call after settled rendering, both scroll axes, viewport changes and selection changes. */
  refresh(): SelectionHudPlacement;
  dispose(): void;
}

interface Frame {
  readonly system: SystemGeometry;
  readonly matrix: DOMMatrix;
  readonly clip: InkBox;
  readonly ink: InkBox;
}
interface Anchor {
  readonly box: InkBox;
  readonly kind: SelectionHudFloatingPlacement['anchorKind'];
  readonly eventId: string;
}
interface Snapshot {
  readonly context: SelectionHudContext;
  readonly key: string;
  readonly surface: MusicSurface;
  readonly viewport: HTMLElement;
  readonly layout: LayoutGeometry;
  readonly available: InkBox;
  readonly frames: readonly Frame[];
  readonly obstacles: readonly InkBox[];
  readonly anchor: Anchor;
  readonly size: { readonly width: number; readonly height: number };
}

const CLEARANCE = 8;
const EPSILON = 0.25;
const finite = (value: number): boolean => Number.isFinite(value);
const valid = (box: InkBox): boolean => [box.x, box.y, box.width, box.height].every(finite) && box.width > 0 && box.height > 0;
const right = (box: InkBox): number => box.x + box.width;
const bottom = (box: InkBox): number => box.y + box.height;
const overlaps = (a: InkBox, b: InkBox): boolean => a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
const contains = (outer: InkBox, inner: InkBox): boolean => inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;
const sameBox = (a: InkBox, b: InkBox): boolean => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const sameTransform = (a: DOMMatrix, b: DOMMatrix): boolean => (['a', 'b', 'c', 'd', 'e', 'f'] as const)
  .every(key => Math.abs(a[key] - b[key]) <= 1e-8);
const grow = (box: InkBox, amount: number): InkBox => ({ x: box.x - amount, y: box.y - amount, width: box.width + amount * 2, height: box.height + amount * 2 });
const plain = (box: InkBox): InkBox => ({ x: box.x, y: box.y, width: box.width, height: box.height });
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function intersection(a: InkBox, b: InkBox): InkBox | undefined {
  const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y);
  const box = { x, y, width: Math.min(right(a), right(b)) - x, height: Math.min(bottom(a), bottom(b)) - y };
  return valid(box) ? box : undefined;
}

function clientBox(element: HTMLElement): InkBox {
  const bounds = element.getBoundingClientRect();
  const scaleX = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight > 0 ? bounds.height / element.offsetHeight : 1;
  return { x: bounds.x + element.clientLeft * scaleX, y: bounds.y + element.clientTop * scaleY,
    width: element.clientWidth * scaleX, height: element.clientHeight * scaleY };
}

function parentOf(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

function clippedBy(element: HTMLElement, box: InkBox): InkBox | undefined {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const clipsX = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX || style.overflow);
  const clipsY = ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY || style.overflow);
  if (!clipsX && !clipsY) return box;
  const bounds = clientBox(element);
  return intersection(box, { x: clipsX ? bounds.x : box.x, y: clipsY ? bounds.y : box.y,
    width: clipsX ? bounds.width : box.width, height: clipsY ? bounds.height : box.height });
}

function visibleViewport(element: HTMLElement): InkBox | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) return undefined;
  let box = intersection(clientBox(element), { x: 0, y: 0, width: view.innerWidth, height: view.innerHeight });
  const visual = view.visualViewport;
  if (box && visual) box = intersection(box, { x: visual.offsetLeft, y: visual.offsetTop, width: visual.width, height: visual.height });
  for (let parent = parentOf(element); parent && box; parent = parentOf(parent)) {
    if (parent instanceof HTMLElement) box = clippedBy(parent, box);
  }
  return box;
}

/** Account for horizontal pan and clipping inside MusicSurface's open shadow tree. */
function frameClip(svg: SVGSVGElement, viewport: HTMLElement, available: InkBox): InkBox | undefined {
  let clip: InkBox | undefined = available;
  let element: Element | null = svg;
  while (element && element !== viewport) {
    element = parentOf(element);
    if (!(element instanceof HTMLElement) || element === viewport) continue;
    clip = clippedBy(element, clip);
    if (!clip) return undefined;
  }
  return element === viewport ? clip : undefined;
}

function contextKey(context: SelectionHudContext): string {
  const target = context.target;
  return JSON.stringify([context.documentEpoch, context.selectionVersion, context.revision, context.partId, context.mode,
    context.allowFloating, target?.kind, target?.sourceId, target?.staffId, target?.measureId, target?.voiceId,
    target?.kind === 'event' ? target.eventKind : target?.eventId]);
}

function matches(event: EventGeometry, target: TargetScope): boolean {
  return (target.staffId === undefined || target.staffId === event.staffId)
    && (target.measureId === undefined || target.measureId === event.measureId)
    && (target.voiceId === undefined || target.voiceId === event.voiceId);
}

function anchorFor(frame: Frame, target: SelectionHudTarget): Anchor | undefined {
  if (target.kind === 'marking') {
    const mark = frame.system.markings?.find(item => item.sourceId === target.sourceId && item.eventId === target.eventId);
    const owner = mark && frame.system.events.find(item => item.sourceId === mark.eventId && item.staffId === mark.staffId
      && item.measureId === mark.measureId && item.voiceId === mark.voiceId && matches(item, target));
    return mark && owner && valid(mark) ? { box: transformInk(mark, frame.matrix), kind: 'marking', eventId: owner.sourceId } : undefined;
  }
  const event = frame.system.events.find(item => item.sourceId === target.sourceId && matches(item, target));
  if (!event) return undefined;
  if (target.eventKind === 'note' || target.eventKind === 'chord') {
    const heads = event.noteheads;
    if (!heads?.length || heads.some(head => !valid(head)) || (target.eventKind === 'note' && heads.length !== 1)) return undefined;
    return { box: transformInk(unionInk(heads)!, frame.matrix), kind: target.eventKind === 'note' ? 'notehead' : 'chord', eventId: event.sourceId };
  }
  return valid(event.ink) ? { box: transformInk(event.ink, frame.matrix), kind: 'event', eventId: event.sourceId } : undefined;
}

function safe(box: InkBox, snapshot: Snapshot): boolean {
  return valid(box) && contains(snapshot.available, box) && !snapshot.obstacles.some(obstacle => overlaps(box, obstacle));
}

/** Search clear gutters, never create space by changing the score. */
function solve(snapshot: Snapshot, maxDistance: number): InkBox | undefined {
  const { width, height } = snapshot.size; const { available, anchor, obstacles } = snapshot;
  if (width > available.width || height > available.height) return undefined;
  // CSS serialization can round a value just inside an ink edge. Use exact
  // quarter-pixel positions for HTML only, testing both sides of each boundary.
  const lower = (value: number): number => Math.floor(value * 4) / 4;
  const upper = (value: number): number => Math.ceil(value * 4) / 4;
  const minimumX = upper(available.x); const maximumX = lower(right(available) - width);
  const minimumY = upper(available.y); const maximumY = lower(bottom(available) - height);
  if (maximumX < minimumX || maximumY < minimumY) return undefined;
  const centerX = anchor.box.x + anchor.box.width / 2; const centerY = anchor.box.y + anchor.box.height / 2;
  const xs = new Set([centerX - width / 2, anchor.box.x - CLEARANCE - width, right(anchor.box) + CLEARANCE, available.x, right(available) - width]);
  const ys = new Set([anchor.box.y - CLEARANCE - height, bottom(anchor.box) + CLEARANCE, centerY - height / 2, available.y, bottom(available) - height]);
  for (const obstacle of obstacles) {
    xs.add(obstacle.x - width); xs.add(right(obstacle));
    ys.add(obstacle.y - height); ys.add(bottom(obstacle));
  }
  let best: { box: InkBox; distance: number; alignment: number } | undefined;
  const positions = (values: ReadonlySet<number>): number[] => [...new Set([...values].flatMap(value => [lower(value), upper(value)]))];
  for (const y of positions(ys)) for (const x of positions(xs)) {
    const box = { x: clamp(x, minimumX, maximumX), y: clamp(y, minimumY, maximumY), width, height };
    if (!safe(box, snapshot)) continue;
    const distance = (centerX - clamp(centerX, box.x, right(box))) ** 2 + (centerY - clamp(centerY, box.y, bottom(box))) ** 2;
    if (distance > maxDistance ** 2) continue;
    const alignment = (centerX - box.x - width / 2) ** 2 + (centerY - box.y - height / 2) ** 2;
    if (!best || distance < best.distance || (near(distance, best.distance) && alignment < best.alignment)) best = { box, distance, alignment };
  }
  return best?.box;
}

class MusicalSelectionHud implements SelectionHud {
  private value: SelectionHudPlacement = Object.freeze({ kind: 'dock', reason: 'disabled' });
  private binding?: Snapshot;
  private disposed = false;
  private canceling = false;
  private pendingDock?: SelectionHudDockReason;
  private generation = 0;
  private readonly observer?: ResizeObserver;
  private readonly removals: (() => void)[] = [];
  private readonly original: ReadonlyMap<string, { value: string; priority: string }>;
  private readonly originalPlacement: string | null;
  private readonly options: SelectionHudOptions;

  constructor(options: SelectionHudOptions) {
    this.options = options;
    this.original = new Map(['position', 'left', 'top', 'visibility'].map(name => [name,
      { value: options.element.style.getPropertyValue(name), priority: options.element.style.getPropertyPriority(name) }]));
    this.originalPlacement = options.element.getAttribute('data-selection-placement');
    options.element.dataset.selectionPlacement = 'dock';
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { if (!this.disposed) this.refresh(); });
      this.observer.observe(options.element);
    }
  }

  get placement(): SelectionHudPlacement { return this.value; }

  private read(): Snapshot | SelectionHudDockReason {
    const context = this.options.getContext();
    if (!context.allowFloating || (context.mode !== undefined && context.mode !== 'write')) return 'disabled';
    if (!context.target) return 'missing-target';
    const surface = this.options.getSurface(); const viewport = this.options.getViewport();
    if (!surface?.isConnected || !viewport?.isConnected || !this.options.element.isConnected) return 'stale-geometry';
    const layout = surface.getLayoutGeometry();
    if (!layout || layout.projection !== 'screen' || layout.revision !== surface.renderRevision) return 'stale-geometry';
    const clip = visibleViewport(viewport);
    if (!clip) return 'offscreen';
    const available = grow(clip, -CLEARANCE);
    if (!valid(available)) return 'no-space';
    const bounds = this.options.element.getBoundingClientRect();
    if (this.options.element.hidden || !valid(bounds)) return 'invalid-size';
    const svgs = [...(surface.shadowRoot?.querySelectorAll<SVGSVGElement>('.screen svg.notation-svg') ?? [])];
    const frames: Frame[] = []; const obstacles: InkBox[] = [];
    let anchor: Anchor | undefined; let foundTarget = false;
    for (const system of layout.systems) {
      const svg = svgs[system.index]; const matrix = svg?.getScreenCTM();
      if (!svg?.isConnected || !matrix || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(finite)
        || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-10 || !valid(system.ink)) return 'stale-geometry';
      const ink = transformInk(system.ink, matrix);
      const localClip = frameClip(svg, viewport, clip);
      // A clipped-out system is not an obstacle, but its target cannot float.
      const frame = { system, matrix, ink, clip: localClip ?? { x: 0, y: 0, width: 0, height: 0 } };
      frames.push(frame);
      if (localClip && overlaps(ink, localClip)) obstacles.push(grow(ink, CLEARANCE));
      const local = anchorFor(frame, context.target);
      if (local) {
        foundTarget = true;
        if (!contains(ink, local.box)) return 'stale-geometry';
        if (localClip && contains(localClip, local.box)) anchor = local;
      }
    }
    if (!anchor) return foundTarget ? 'offscreen' : 'missing-target';
    for (const obstacle of this.options.getObstacles?.() ?? []) {
      if (!valid(obstacle)) continue;
      const padded = grow(obstacle, CLEARANCE);
      if (overlaps(padded, clip)) obstacles.push(padded);
    }
    return { context, key: contextKey(context), surface, viewport, layout, available, frames, obstacles, anchor,
      size: { width: bounds.width, height: bounds.height } };
  }

  private current(snapshot: Snapshot): boolean {
    return !this.disposed && contextKey(this.options.getContext()) === snapshot.key && this.options.getSurface() === snapshot.surface
      && this.options.getViewport() === snapshot.viewport && snapshot.surface.getLayoutGeometry() === snapshot.layout
      && snapshot.surface.renderRevision === snapshot.layout.revision;
  }

  private restoreStyle(name: string): void {
    const original = this.original.get(name)!;
    if (original.value) this.options.element.style.setProperty(name, original.value, original.priority);
    else this.options.element.style.removeProperty(name);
  }

  private dock(reason: SelectionHudDockReason): SelectionHudPlacement {
    if (this.canceling) return this.value;
    if (this.options.isInteracting() && this.value.kind === 'floating') {
      if (!this.pendingDock) {
        this.canceling = true;
        try { this.options.cancelInteraction(reason); } finally { this.canceling = false; }
      }
      if (this.options.isInteracting()) {
        // The activation owner has canceled the action. A late capture release
        // must still not move a pressed button; hide its unchanged box meanwhile.
        this.pendingDock = this.disposed ? 'disposed' : reason; this.options.element.style.visibility = 'hidden';
        this.watchRelease();
        this.value = Object.freeze({ ...this.value, suspended: true });
        return this.value;
      }
    }
    this.pendingDock = undefined;
    this.removals.splice(0).forEach(remove => remove());
    for (const name of this.original.keys()) this.restoreStyle(name);
    this.options.element.dataset.selectionPlacement = 'dock';
    this.binding = undefined;
    this.value = Object.freeze({ kind: 'dock', reason: this.disposed ? 'disposed' : reason });
    if (this.disposed) this.finishDisposal();
    return this.value;
  }

  private floating(box: InkBox, snapshot: Snapshot): SelectionHudFloatingPlacement {
    return Object.freeze({ kind: 'floating', box: Object.freeze(plain(box)), anchor: Object.freeze(plain(snapshot.anchor.box)),
      anchorKind: snapshot.anchor.kind, sourceId: snapshot.context.target!.sourceId, eventId: snapshot.anchor.eventId,
      documentEpoch: snapshot.context.documentEpoch, selectionVersion: snapshot.context.selectionVersion, revision: snapshot.context.revision,
      geometryRevision: snapshot.layout.revision, projectionId: snapshot.layout.projectionId, suspended: false });
  }

  refresh(): SelectionHudPlacement {
    if (this.canceling) return this.value;
    if (this.disposed) {
      if (this.pendingDock && !this.options.isInteracting()) this.dock('disposed');
      return this.value;
    }
    const generation = ++this.generation;
    if (this.pendingDock) {
      if (this.options.isInteracting()) return this.value;
      return this.dock(this.pendingDock);
    }
    const snapshot = this.read();
    if (typeof snapshot === 'string') return this.dock(snapshot);
    if (!this.current(snapshot)) return this.dock('stale-geometry');
    if (this.options.isInteracting()) {
      if (this.value.kind !== 'floating') return this.dock('interaction');
      if (!this.binding || this.binding.key !== snapshot.key) return this.dock('target-changed');
      if (this.binding.layout !== snapshot.layout || this.binding.surface !== snapshot.surface || this.binding.viewport !== snapshot.viewport) return this.dock('stale-geometry');
      const actual = plain(this.options.element.getBoundingClientRect());
      if (!sameBox(this.value.box, actual) || !safe(actual, snapshot)) return this.dock('unsafe-placement');
      this.value = this.floating(actual, snapshot); this.binding = snapshot;
      return this.value;
    }
    const requestedDistance = this.options.maxDistance ?? 160;
    const maxDistance = finite(requestedDistance) ? Math.max(0, requestedDistance) : 160;
    const box = solve(snapshot, maxDistance);
    if (!box) return this.dock('no-space');
    const element = this.options.element;
    element.style.position = 'fixed'; element.style.left = `${box.x}px`; element.style.top = `${box.y}px`;
    element.dataset.selectionPlacement = 'floating';
    // Fixed positioning can have a transformed containing block or a different
    // shrink-to-fit width. Verify the real HTML box and unchanged score geometry.
    const actual = plain(element.getBoundingClientRect()); const after = this.read();
    if (generation !== this.generation) return this.value;
    if (!this.current(snapshot) || typeof after === 'string'
      || !sameBox(actual, box) || !sameBox(after.available, snapshot.available) || !safe(actual, after)
      || after.frames.length !== snapshot.frames.length || after.frames.some((frame, index) => !sameBox(frame.ink, snapshot.frames[index].ink)
        || !sameBox(frame.clip, snapshot.frames[index].clip) || !sameTransform(frame.matrix, snapshot.frames[index].matrix))) return this.dock('unsafe-placement');
    this.value = this.floating(actual, after); this.binding = after;
    return this.value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.dock('disposed'); this.disposed = true; this.generation++;
    this.observer?.disconnect();
    // Finish a late release before returning the pressed control to its dock.
    if (!this.pendingDock && !this.canceling) this.finishDisposal();
  }

  private watchRelease(): void {
    if (this.removals.length) return;
    const released = () => queueMicrotask(() => { if (this.pendingDock) this.refresh(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) {
      this.options.element.ownerDocument.addEventListener(type, released, { passive: true, capture: true });
      this.removals.push(() => this.options.element.ownerDocument.removeEventListener(type, released, true));
    }
  }

  private finishDisposal(): void {
    this.removals.splice(0).forEach(remove => remove());
    if (this.originalPlacement === null) this.options.element.removeAttribute('data-selection-placement');
    else this.options.element.setAttribute('data-selection-placement', this.originalPlacement);
  }
}

/** Optional placement only; never selects, focuses, scrolls, reparents or edits music. */
export function createSelectionHud(options: SelectionHudOptions): SelectionHud {
  return new MusicalSelectionHud(options);
}
