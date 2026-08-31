import { harmonyIntervalText, parseHarmonyInterval, validateArticulationType, validateOrnamentType } from '../model/index.js';
import type { EventMarking, IntervalMarking, MarkingPlacement, MusicEvent, Score, TiePolicy } from '../model/types.js';
import type { EventInput, EventMarkingEdit, EventMarkingField, EventMarkingInput } from './types.js';

const FIELDS = new Set<EventMarkingField>(['type', 'value', 'placement']);

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A rejected conversion can offer a route to the exact attached source mark. */
export class EventMarkingCompatibilityError extends Error {
  readonly eventId: string;
  readonly markingId: string;

  constructor(eventId: string, markingId: string, message: string) {
    super(message);
    this.name = 'EventMarkingCompatibilityError';
    this.eventId = eventId; this.markingId = markingId;
  }
}

/** Kind changes keep compatible attached source data, never silently drop it. */
export function assertEventMarkingsCompatible(event: MusicEvent, next: Pick<EventInput, 'kind' | 'rhythmic'>): void {
  for (const marking of event.markings ?? []) {
    const allowed = marking.kind === 'interval' ? next.kind === 'road'
      : marking.kind === 'ornament' ? next.kind === 'note' || next.kind === 'road'
        : marking.type === 'fermata' || next.kind !== 'rest' && (next.kind !== 'slash' || next.rhythmic);
    if (!allowed) throw new EventMarkingCompatibilityError(event.id, marking.id,
      `The attached ${marking.kind === 'interval' ? 'harmony interval' : marking.type} cannot be kept on this event kind. Remove the incompatible marking explicitly before converting the event.`);
  }
}

export interface RoadTieInterval {
  readonly id: string;
  /** Canonical written figure, not a semitone distance or a chosen absolute pitch. */
  readonly value: string;
  readonly placement: MarkingPlacement;
}

export interface RoadTieChainMember {
  readonly eventId: string;
  readonly measureId: string;
  readonly measureNumber: string;
  readonly voiceId: string;
  readonly tie: TiePolicy;
  readonly intervals: readonly RoadTieInterval[];
}

export interface RoadTieChainInspection {
  readonly eventId: string;
  readonly staffId: string;
  readonly voiceIndex: number;
  readonly tied: boolean;
  /** Musical order, beginning with the attack even when a continuation is selected. */
  readonly members: readonly RoadTieChainMember[];
}

interface RoadLocation { event: MusicEvent; measureId: string; measureNumber: string; voiceId: string }

function intervalKey(value: Pick<RoadTieInterval, 'value' | 'placement'>): string { return `${value.placement}:${value.value}`; }
function intervalData(marking: IntervalMarking): RoadTieInterval {
  requireCondition(marking.placement === 'above' || marking.placement === 'below', 'A tied harmony interval needs an explicit above or below direction.');
  return { id: marking.id, value: harmonyIntervalText(marking.interval), placement: marking.placement };
}
function eventIntervals(event: MusicEvent): IntervalMarking[] {
  return (event.markings ?? []).filter((marking): marking is IntervalMarking => marking.kind === 'interval');
}

/**
 * Inspect the complete sustained sound without reading or mutating DOM. Voice
 * identity across bars is its staff-local index, as in the model's tie validator.
 * An existing empty voice carries a pending tie; a missing voice breaks it.
 */
export function inspectRoadTieChain(score: Score, eventId: string): RoadTieChainInspection {
  const matches = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap((voice, voiceIndex) =>
    voice.events.filter(event => event.id === eventId).map(event => ({ staff, voiceIndex, event })))));
  requireCondition(matches.length === 1, 'Choose one existing road event to inspect its complete tied sound.');
  const selected = matches[0];
  requireCondition(selected.event.kind === 'road' && selected.staff.notation === 'three-roads',
    'Complete tied-sound interval editing applies only to road events on a three-roads staff.');
  const timeline: (RoadLocation | null)[] = selected.staff.measures.flatMap(measure => {
    const voice = measure.voices[selected.voiceIndex];
    return voice ? voice.events.map(event => ({ event, measureId: measure.id, measureNumber: measure.number, voiceId: voice.id })) : [null];
  });
  const selectedIndex = timeline.findIndex(location => location?.event.id === eventId);
  const outgoing = (location: RoadLocation | null | undefined) => location?.event.tie === 'start' || location?.event.tie === 'continue';
  const incoming = (location: RoadLocation | null | undefined) => location?.event.tie === 'end' || location?.event.tie === 'continue';
  const incomplete = 'The road tie chain is incomplete or changed. Keep every connected segment in the same voice before editing its harmony.';
  requireCondition(selectedIndex >= 0, incomplete);
  let start = selectedIndex;
  while (incoming(timeline[start])) {
    const previous = timeline[start - 1];
    requireCondition(previous?.event.kind === 'road' && outgoing(previous), incomplete);
    start--;
  }
  requireCondition(!outgoing(timeline[start - 1]), incomplete);
  let end = start;
  while (outgoing(timeline[end])) {
    const following = timeline[end + 1];
    requireCondition(following?.event.kind === 'road' && incoming(following), incomplete);
    end++;
  }
  requireCondition(selectedIndex <= end && !incoming(timeline[end + 1]), incomplete);
  const chain = timeline.slice(start, end + 1);
  requireCondition(chain.length > 0 && chain.every(location => location?.event.kind === 'road'), incomplete);
  const ids = new Set<string>();
  let harmony: string | undefined;
  const members = chain.map((location, index): RoadTieChainMember => {
    const { event, measureId, measureNumber, voiceId } = location!;
    requireCondition(!ids.has(event.id), 'A road tie chain needs distinct source identities.'); ids.add(event.id);
    const policy: TiePolicy = chain.length === 1 ? 'none' : index === 0 ? 'start' : index === chain.length - 1 ? 'end' : 'continue';
    requireCondition(event.tie === policy, incomplete);
    requireCondition(index === 0 ? event.pitchDirection === 'higher' || event.pitchDirection === 'same' || event.pitchDirection === 'lower'
      : event.pitchDirection === 'same', 'Every road tie continuation must keep direction="same"; do not imply a new attack or pitch change.');
    const intervals = eventIntervals(event).map(intervalData);
    const keys = intervals.map(intervalKey);
    requireCondition(new Set(keys).size === keys.length, 'A road event cannot repeat the same harmony interval on the same side.');
    for (const interval of intervals) {
      requireCondition(interval.id && !ids.has(interval.id), 'Every tied harmony interval needs its own source identity.'); ids.add(interval.id);
    }
    const signature = JSON.stringify([...keys].sort());
    requireCondition(harmony === undefined || harmony === signature,
      'A road tie sustains its complete harmony. Every segment must already declare the same interval figures and sides; no harmony is inherited or repaired implicitly.');
    harmony = signature;
    return { eventId: event.id, measureId, measureNumber, voiceId, tie: event.tie, intervals };
  });
  return { eventId, staffId: selected.staff.id, voiceIndex: selected.voiceIndex, tied: members.length > 1, members };
}

function validatePlacement(kind: EventMarking['kind'], placement: EventMarkingInput['placement']): void {
  requireCondition(placement === 'above' || placement === 'below' || kind === 'articulation' && placement === 'auto',
    kind === 'articulation' ? 'Choose automatic, above, or below placement for the articulation.'
      : kind === 'interval' ? 'Choose above or below for the harmony interval; direction is part of its musical meaning.'
        : 'Choose above or below placement for the ornament.');
}

function newMarkingAttributes(value: EventMarkingInput): Map<string, string> {
  requireCondition(value && ['articulation', 'ornament', 'interval'].includes(value.kind),
    'Choose an articulation, ornament, or harmony interval.');
  validatePlacement(value.kind, value.placement);
  const attributes = new Map<string, string>();
  if (value.kind === 'articulation') attributes.set('type', validateArticulationType(value.type));
  else if (value.kind === 'ornament') attributes.set('type', validateOrnamentType(value.type));
  else attributes.set('value', harmonyIntervalText(parseHarmonyInterval(value.value)));
  attributes.set('placement', value.placement);
  return attributes;
}

/** Validate only named fields; unrelated unfinished controls are not consumed. */
function markingPatch(accepted: EventMarking, value: EventMarkingInput, fields?: readonly EventMarkingField[]): Map<string, string> {
  const names = fields ?? (accepted.kind === 'interval' ? ['value', 'placement'] : ['type', 'placement']);
  requireCondition(Array.isArray(names) && names.every(field => FIELDS.has(field as EventMarkingField)),
    'Choose supported marking fields: type, value, or placement.');
  const selected = new Set(names);
  const attributes = new Map<string, string>();
  if (!selected.size) return attributes;
  requireCondition(value && value.kind === accepted.kind,
    'A marking keeps its own family. Remove it and explicitly add another family instead.');
  if (selected.has('type')) {
    requireCondition(accepted.kind !== 'interval' && value.kind !== 'interval',
      'A harmony interval uses a value, not an articulation or ornament type.');
    const next = accepted.kind === 'articulation' ? validateArticulationType(value.type) : validateOrnamentType(value.type);
    if (next !== accepted.type) attributes.set('type', next);
  }
  if (selected.has('value')) {
    requireCondition(accepted.kind === 'interval' && value.kind === 'interval',
      'Only a harmony interval has an interval value.');
    const next = parseHarmonyInterval(value.value);
    if (next.number !== accepted.interval.number || next.alter !== accepted.interval.alter) {
      attributes.set('value', harmonyIntervalText(next));
    }
  }
  if (selected.has('placement')) {
    validatePlacement(accepted.kind, value.placement);
    if (value.placement !== accepted.placement) attributes.set('placement', value.placement);
  }
  return attributes;
}

/**
 * Prepare every edit before touching the event. The session validates the complete
 * detached score once, so a batch is one transaction, including tie-harmony checks.
 */
function prepareEventMarkingEdits(
  owner: Element, event: MusicEvent, sources: ReadonlyMap<string, Element>, edits: readonly EventMarkingEdit[],
  create: (tag: string) => Element,
): (() => void)[] {
  requireCondition(owner.localName === `music-${event.kind}`,
    'The selected source no longer matches the accepted event.');
  requireCondition(Array.isArray(edits), 'Provide an ordered list of attached marking edits.');
  const actions: (() => void)[] = [];
  const touched = new Set<string>();
  for (const edit of edits) {
    requireCondition(edit && ['add', 'update', 'remove'].includes(edit.type), 'Choose add, update, or remove for the marking edit.');
    if (edit.type === 'add') {
      const attributes = newMarkingAttributes(edit.value);
      actions.push(() => {
        const node = create(`music-${edit.value.kind}`);
        for (const [name, value] of attributes) node.setAttribute(name, value);
        owner.append(node);
      });
      continue;
    }
    requireCondition(!touched.has(edit.markingId), 'Each existing marking can be edited only once in one Apply.');
    touched.add(edit.markingId);
    const accepted = event.markings?.find(marking => marking.id === edit.markingId);
    requireCondition(accepted, 'Choose an attached marking belonging to this event.');
    const node = sources.get(accepted.id);
    requireCondition(node && node.parentElement === owner && node.localName === `music-${accepted.kind}`,
      'The marking must be a direct child of its named event.');
    if (edit.type === 'remove') actions.push(() => node.remove());
    else {
      const attributes = markingPatch(accepted, edit.value, edit.fields);
      if (attributes.size) actions.push(() => {
        for (const [name, value] of attributes) node.setAttribute(name, value);
      });
    }
  }
  return actions;
}

export function applyEventMarkingEdits(
  owner: Element, event: MusicEvent, sources: ReadonlyMap<string, Element>, edits: readonly EventMarkingEdit[],
  create: (tag: string) => Element,
): boolean {
  const actions = prepareEventMarkingEdits(owner, event, sources, edits, create);
  for (const action of actions) action();
  return actions.length > 0;
}

interface IntervalIntent {
  value: string;
  placement: MarkingPlacement;
  /** The accepted figure+side before any row in this batch was edited. */
  originalKey?: string;
  order: number;
}

/**
 * Edit an explicitly scoped sustained harmony as a semantic set. Existing final
 * matches win over row provenance; equivalent swaps and remove/add pairs keep
 * their literal source, IDs and order. Only this scope uses set reconciliation.
 */
export function applyRoadTieIntervalEdits(
  score: Score, eventId: string, sources: ReadonlyMap<string, Element>, edits: readonly EventMarkingEdit[],
  create: (tag: string) => Element,
): boolean {
  const chain = inspectRoadTieChain(score, eventId);
  const byId = new Map(score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice =>
    voice.events.map(event => [event.id, event] as const)))));
  const selected = byId.get(eventId)!;
  const owner = sources.get(eventId);
  requireCondition(owner?.localName === 'music-road', 'The selected source no longer matches the accepted road event.');
  requireCondition(Array.isArray(edits), 'Provide an ordered list of attached marking edits.');
  const finalById = new Map(eventIntervals(selected).map(marking => {
    const data = intervalData(marking);
    return [marking.id, { value: data.value, placement: data.placement, originalKey: intervalKey(data), order: -1 } satisfies IntervalIntent];
  }));
  const added: IntervalIntent[] = [];
  const actions: { order: number; apply: () => void }[] = [];
  const touched = new Set<string>();
  for (const [order, edit] of edits.entries()) {
    requireCondition(edit && ['add', 'update', 'remove'].includes(edit.type), 'Choose add, update, or remove for the marking edit.');
    if (edit.type === 'add') {
      const attributes = newMarkingAttributes(edit.value);
      if (edit.value.kind === 'interval') added.push({ value: attributes.get('value')!, placement: edit.value.placement, order });
      else actions.push(...prepareEventMarkingEdits(owner, selected, sources, [edit], create).map(apply => ({ order, apply })));
      continue;
    }
    requireCondition(!touched.has(edit.markingId), 'Each existing marking can be edited only once in one Apply.');
    touched.add(edit.markingId);
    const accepted = selected.markings?.find(marking => marking.id === edit.markingId);
    requireCondition(accepted, 'Choose an attached marking belonging to this event.');
    const node = sources.get(accepted.id);
    requireCondition(node?.parentElement === owner && node.localName === `music-${accepted.kind}`,
      'The marking must be a direct child of its named event.');
    if (accepted.kind !== 'interval') {
      actions.push(...prepareEventMarkingEdits(owner, selected, sources, [edit], create).map(apply => ({ order, apply })));
    } else if (edit.type === 'remove') finalById.delete(accepted.id);
    else {
      const attributes = markingPatch(accepted, edit.value, edit.fields);
      const intent = finalById.get(accepted.id)!;
      if (attributes.has('value')) intent.value = attributes.get('value')!;
      if (attributes.has('placement')) intent.placement = attributes.get('placement')! as MarkingPlacement;
      intent.order = order;
    }
  }
  const final = [...finalById.values(), ...added];
  const finalKeys = new Set(final.map(intervalKey));
  requireCondition(finalKeys.size === final.length,
    'Do not repeat the same written harmony interval on the same side of a road event. Review the complete requested interval set.');

  for (const member of chain.members) {
    const event = byId.get(member.eventId)!;
    const parent = sources.get(member.eventId);
    requireCondition(parent?.localName === 'music-road', 'A tied source segment no longer matches its accepted road event.');
    const existing = new Map(eventIntervals(event).map(marking => {
      const node = sources.get(marking.id);
      requireCondition(node?.parentElement === parent && node.localName === 'music-interval',
        'Every tied interval must remain a direct child of its named road event.');
      const data = intervalData(marking);
      return [intervalKey(data), { data, node }];
    }));
    const available = [...existing].filter(([key]) => !finalKeys.has(key));
    const used = new Set<Element>();
    const pending = final.filter(intent => !existing.has(intervalKey(intent))).map(intent => ({
      intent, previous: undefined as (typeof available)[number] | undefined,
    }));
    // Preserve an explicit update's old node where possible, after protecting
    // every node that already represents a requested final figure and side.
    for (const item of pending) {
      item.previous = available.find(([key, candidate]) => key === item.intent.originalKey && !used.has(candidate.node));
      if (item.previous) used.add(item.previous[1].node);
    }
    for (const item of pending) {
      item.previous ??= available.find(([, candidate]) => !used.has(candidate.node));
      if (item.previous) {
        const { data, node } = item.previous[1]; used.add(node);
        const attributes = new Map<string, string>();
        if (data.value !== item.intent.value) attributes.set('value', item.intent.value);
        if (data.placement !== item.intent.placement) attributes.set('placement', item.intent.placement);
        actions.push({ order: item.intent.order, apply: () => {
          for (const [name, value] of attributes) node.setAttribute(name, value);
        } });
      } else actions.push({ order: item.intent.order, apply: () => {
        const node = create('music-interval'); node.setAttribute('value', item.intent.value); node.setAttribute('placement', item.intent.placement);
        parent.append(node);
      } });
    }
    for (const [, candidate] of available) if (!used.has(candidate.node)) {
      actions.push({ order: edits.length, apply: () => candidate.node.remove() });
    }
  }
  // Preparing the entire chain first prevents late stale IDs or invalid input
  // from mutating even the detached command source. Full score validation still
  // belongs to the outer EditorSession transaction.
  for (const action of actions.sort((a, b) => a.order - b.order)) action.apply();
  return actions.length > 0;
}
