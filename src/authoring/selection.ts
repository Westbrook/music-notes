import type { MusicEvent, Score } from '../model/types.js';

/** UI state only: it is never serialized into the authored musical document. */
export interface SelectionState {
  readonly documentId: string;
  readonly documentEpoch: number;
  readonly partId: string;
  /** Unique complete event IDs in musical order, not the interval between endpoints. */
  readonly ids: readonly string[];
  readonly primaryId?: string;
  readonly anchorId?: string;
  /** Select-more keyboard focus may name an unselected event. */
  readonly focusId?: string;
  /** An authored structural or instruction singleton; the session rejects generated model IDs. */
  readonly sourceId?: string;
  readonly staffId?: string;
  readonly voiceIndex?: number;
  readonly version: number;
}

export interface SelectionContext {
  readonly score: Score;
  readonly documentId: string;
  readonly documentEpoch: number;
  readonly partId: string;
  readonly visibleStaffIds?: readonly string[];
}

export type SelectionAction =
  | { readonly type: 'replace' | 'toggle' | 'range' | 'focus' | 'source'; readonly id: string }
  | { readonly type: 'clear' }
  | { readonly type: 'set'; readonly ids: readonly string[]; readonly primaryId?: string;
      readonly anchorId?: string; readonly focusId?: string };

export interface SelectionTransition {
  readonly state: SelectionState;
  readonly changed: boolean;
  /** A rejected intent or a reduced scope needs a visible explanation. */
  readonly reason?: string;
}

export interface SelectionPruning {
  readonly previousScore?: Score;
  /** The session supplies source-ownership checks that a Score alone cannot establish. */
  readonly allowedIds?: ReadonlySet<string>;
}

interface EventPlace { readonly event: MusicEvent; readonly staffId: string; readonly voiceIndex: number; readonly order: number }
interface SourcePlace { readonly staffId?: string }
interface Index {
  readonly events: Map<string, EventPlace>;
  readonly marks: Map<string, string>;
  readonly sources: Map<string, SourcePlace>;
}

function indexScore(score: Score): Index {
  const events = new Map<string, EventPlace>(), marks = new Map<string, string>(), sources = new Map<string, SourcePlace>();
  sources.set(score.id, {});
  for (const staff of score.staves) {
    sources.set(staff.id, { staffId: staff.id });
    const orders = new Map<number, number>();
    for (const measure of staff.measures) {
      sources.set(measure.id, { staffId: staff.id });
      for (const annotation of measure.annotations) sources.set(annotation.id, { staffId: staff.id });
      for (const [voiceIndex, voice] of measure.voices.entries()) {
        sources.set(voice.id, { staffId: staff.id });
        for (const tuplet of voice.tuplets) sources.set(tuplet.id, { staffId: staff.id });
        for (const event of voice.events) {
          const order = orders.get(voiceIndex) ?? 0;
          events.set(event.id, { event, staffId: staff.id, voiceIndex, order });
          orders.set(voiceIndex, order + 1);
          for (const mark of event.markings ?? []) marks.set(mark.id, event.id);
        }
      }
    }
  }
  return { events, marks, sources };
}

const visible = (place: SourcePlace, context: SelectionContext): boolean => !place.staffId
  || !context.visibleStaffIds || context.visibleStaffIds.includes(place.staffId);
const sameScope = (a: EventPlace, b: EventPlace): boolean => a.staffId === b.staffId && a.voiceIndex === b.voiceIndex;
const canonical = (ids: readonly string[], index: Index): string[] => [...new Set(ids)]
  .sort((a, b) => index.events.get(a)!.order - index.events.get(b)!.order);
const copy = (state: SelectionState): SelectionState => ({ ...state, ids: [...state.ids] });
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\s\0]/.test(value);
const contentKey = (state: SelectionState): string => JSON.stringify([
  state.documentId, state.documentEpoch, state.partId, state.ids, state.primaryId, state.anchorId,
  state.focusId, state.sourceId, state.staffId, state.voiceIndex,
]);

export function selectionFingerprint(state: SelectionState): string {
  return JSON.stringify([state.version, contentKey(state)]);
}

export function createSelection(context: SelectionContext, version = 0): SelectionState {
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('A selection version must be a nonnegative safe integer.');
  return { documentId: context.documentId, documentEpoch: context.documentEpoch, partId: context.partId, ids: [], version };
}

function finish(before: SelectionState, after: SelectionState, reason?: string): SelectionTransition {
  const changed = contentKey(before) !== contentKey(after);
  return { state: { ...copy(after), version: before.version + Number(changed) }, changed, ...(reason ? { reason } : {}) };
}
function reject(state: SelectionState, reason: string): SelectionTransition { return { state: copy(state), changed: false, reason }; }
function eventState(context: SelectionContext, ids: readonly string[], index: Index,
  primaryId?: string, anchorId?: string, focusId?: string): SelectionState {
  const scope = ids.length ? index.events.get(ids[0])! : undefined;
  return { ...createSelection(context), ids: [...ids], ...(primaryId ? { primaryId } : {}),
    ...(anchorId ? { anchorId } : {}), ...(focusId ? { focusId } : {}),
    ...(scope ? { staffId: scope.staffId, voiceIndex: scope.voiceIndex } : {}) };
}
function nearest(ids: readonly string[], targetId: string | undefined, current: Index, previous = current): string | undefined {
  if (!ids.length) return undefined;
  const target = targetId ? previous.events.get(targetId) ?? current.events.get(targetId) : undefined;
  if (!target) return ids[0];
  return [...ids].sort((a, b) => {
    const left = previous.events.get(a) ?? current.events.get(a)!;
    const right = previous.events.get(b) ?? current.events.get(b)!;
    return Math.abs(left.order - target.order) - Math.abs(right.order - target.order) || left.order - right.order;
  })[0];
}

/** Reconcile only existing identities; no neighboring unselected event becomes selected. */
export function pruneSelection(state: SelectionState, context: SelectionContext, options: SelectionPruning = {}): SelectionTransition {
  if (state.documentId !== context.documentId || state.documentEpoch !== context.documentEpoch) {
    return finish(state, createSelection(context), 'The composition changed. Select the music again.');
  }
  const index = indexScore(context.score), previous = options.previousScore ? indexScore(options.previousScore) : index;
  const allowed = (id: string): boolean => !options.allowedIds || options.allowedIds.has(id);
  if (state.sourceId) {
    const place = index.sources.get(state.sourceId);
    const kept = place && visible(place, context) && allowed(state.sourceId);
    return finish(state, { ...createSelection(context), ...(kept ? { sourceId: state.sourceId } : {}) },
      kept ? undefined : 'The selected instruction or structure moved, was removed, or is not visible in this part.');
  }
  const original = state.ids.length ? previous.events.get(state.ids[0]) : undefined;
  const staffId = state.staffId ?? original?.staffId, voiceIndex = state.voiceIndex ?? original?.voiceIndex;
  const admissible = (id: string): boolean => {
    const place = index.events.get(id);
    return !!place && visible(place, context) && allowed(id)
      && (!state.ids.length || place.staffId === staffId && place.voiceIndex === voiceIndex);
  };
  const ids = canonical(state.ids.filter(admissible), index);
  const primaryId = state.primaryId && ids.includes(state.primaryId) ? state.primaryId : nearest(ids, state.primaryId, index, previous);
  const anchorId = state.anchorId && ids.includes(state.anchorId) ? state.anchorId : ids[0];
  const focusId = state.focusId && admissible(state.focusId) ? state.focusId : primaryId;
  return finish(state, eventState(context, ids, index, primaryId, anchorId, focusId),
    ids.length !== state.ids.length ? 'Some selected events moved, were removed, or are not visible in this part. Only surviving selected events are kept.' : undefined);
}

/** Exact event selection in one staff/voice; range construction is an explicit action. */
export function reduceSelection(state: SelectionState, action: SelectionAction, context: SelectionContext): SelectionTransition {
  if (state.documentId !== context.documentId || state.documentEpoch !== context.documentEpoch) {
    return reject(state, 'This selection belongs to an earlier composition. Select the music again.');
  }
  const index = indexScore(context.score);
  const current = pruneSelection(state, context).state;
  if (action.type === 'clear') return finish(state, createSelection(context));
  if (action.type === 'set') {
    // Array iteration must visit holes: map/some alone would accept a sparse array.
    if (!Array.isArray(action.ids) || ![...action.ids].every(validId)
      || [action.primaryId, action.anchorId, action.focusId].some(id => id !== undefined && !validId(id))) {
      return reject(state, 'Every selection target must be a complete, nonempty source ID.');
    }
    const places = action.ids.map(id => index.events.get(id));
    if (places.some(place => !place)) return reject(state, 'Choose complete events that still exist in this composition.');
    if (places.some(place => !visible(place!, context))) return reject(state, 'Every selected event must be visible in the current part.');
    if (places.some(place => !sameScope(place!, places[0]!))) return reject(state, 'Select events in one staff and voice. The previous selection is unchanged.');
    const ids = canonical(action.ids, index);
    const primaryId = action.primaryId ?? ids[0], anchorId = action.anchorId ?? primaryId, focusId = action.focusId ?? primaryId;
    if (primaryId !== undefined && !ids.includes(primaryId) || anchorId !== undefined && !ids.includes(anchorId)) {
      return reject(state, 'The primary event and range anchor must belong to the exact selection.');
    }
    const focus = focusId ? index.events.get(focusId) : undefined;
    if (focusId !== undefined && (!focus || !visible(focus, context) || places.length && !sameScope(focus, places[0]!))) {
      return reject(state, 'Keyboard focus must name an existing visible event in this staff and voice.');
    }
    return finish(state, eventState(context, ids, index, primaryId, anchorId, focusId));
  }
  const ownerId = index.marks.get(action.id) ?? action.id;
  const hit = index.events.get(ownerId);
  if (action.type === 'source' && !hit) {
    const place = index.sources.get(action.id);
    if (!place) return reject(state, 'That instruction or structure is no longer in this composition.');
    if (!visible(place, context)) return reject(state, 'That instruction or structure is not visible in the current part.');
    return finish(state, { ...createSelection(context), sourceId: action.id });
  }
  if (!hit) return reject(state, 'Choose a complete musical event. The previous selection is unchanged.');
  if (!visible(hit, context)) return reject(state, 'That event is not visible in the current part.');
  const scope = current.ids.length ? index.events.get(current.ids[0])! : undefined;
  if (!['replace', 'source'].includes(action.type) && scope && !sameScope(scope, hit)) {
    return reject(state, 'This selection stays in one staff and voice. Select the other event without a selection modifier to start a new selection.');
  }
  if (action.type === 'replace' || action.type === 'source') {
    return finish(state, eventState(context, [ownerId], index, ownerId, ownerId, ownerId));
  }
  if (action.type === 'focus') return finish(state,
    eventState(context, current.ids, index, current.primaryId, current.anchorId, ownerId));
  if (action.type === 'range') {
    const anchorId = current.anchorId ?? current.primaryId ?? ownerId;
    const anchor = index.events.get(anchorId)!;
    if (!sameScope(anchor, hit)) return reject(state, 'A range must stay in the anchor’s staff and voice.');
    const lower = Math.min(anchor.order, hit.order), upper = Math.max(anchor.order, hit.order);
    const ids = [...index.events.values()].filter(place => sameScope(place, hit) && place.order >= lower && place.order <= upper)
      .sort((a, b) => a.order - b.order).map(place => place.event.id);
    return finish(state, eventState(context, ids, index, ownerId, anchorId, ownerId));
  }
  const removing = current.ids.includes(ownerId);
  const ids = canonical(removing ? current.ids.filter(id => id !== ownerId) : [...current.ids, ownerId], index);
  const primaryId = removing
    ? current.primaryId && ids.includes(current.primaryId) ? current.primaryId : nearest(ids, current.primaryId, index)
    : ownerId;
  const anchorId = current.anchorId && ids.includes(current.anchorId) ? current.anchorId : ids[0];
  return finish(state, eventState(context, ids, index, primaryId, anchorId, ownerId));
}
