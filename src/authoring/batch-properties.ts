import { durationTime, pitchText, validateAlteration, validateArticulationType, validateOrnamentType } from '../model/index.js';
import type { MusicEvent, Score } from '../model/types.js';
import type { EventPropertyChange } from './types.js';

interface Member { event: MusicEvent; staffId: string; voiceIndex: number }
interface Mutation {
  eventId: string;
  rhythmChanged: boolean;
  attributes?: readonly (readonly [string, string | null])[];
  addMark?: { kind: 'articulation' | 'ornament'; type: string };
  removeMarkIds?: readonly string[];
}
interface Plan { members: readonly Member[]; mutations: readonly Mutation[] }

export interface EventPropertyAnalysis {
  readonly eligible: boolean;
  readonly reason?: string;
  /** Exact changed members, in the caller's order; an empty list is a semantic no-op. */
  readonly changedEventIds: readonly string[];
}

export interface AppliedEventProperty {
  readonly changedEventIds: readonly string[];
  readonly rhythmChangedEventIds: readonly string[];
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function selectMembers(score: Score, eventIds: readonly string[]): Member[] {
  requireCondition(Array.isArray(eventIds) && eventIds.length > 0
    && eventIds.every(id => typeof id === 'string' && id.length > 0)
    && new Set(eventIds).size === eventIds.length,
  'Select one or more distinct musical event IDs for the shared property.');
  const requested = new Set(eventIds);
  const matches = new Map<string, Member[]>();
  for (const staff of score.staves) for (const measure of staff.measures) {
    measure.voices.forEach((voice, voiceIndex) => {
      for (const event of voice.events) {
        if (!requested.has(event.id)) continue;
        const locations = matches.get(event.id) ?? [];
        locations.push({ event, staffId: staff.id, voiceIndex });
        matches.set(event.id, locations);
      }
    });
  }
  const members = eventIds.map(id => {
    const locations = matches.get(id);
    requireCondition(locations?.length === 1, 'The selected event "' + id + '" is missing or ambiguous. Select the existing music again.');
    return locations[0];
  });
  const first = members[0];
  requireCondition(members.every(member => member.staffId === first.staffId && member.voiceIndex === first.voiceIndex),
    'Shared properties currently require events in one staff and voice. Keep the exact selection within that voice.');
  return members;
}

function validateChange(change: EventPropertyChange): void {
  requireCondition(change && typeof change === 'object' && !Array.isArray(change),
    'Choose one shared event property and its explicit value.');
  switch (change.property) {
    case 'duration':
      requireCondition(typeof change.value === 'string', 'Choose a written duration by its supported name.');
      durationTime(change.value);
      break;
    case 'dots':
      requireCondition(Number.isSafeInteger(change.value) && change.value >= 0 && change.value <= 3,
        'Dots must be an integer from 0 to 3.');
      break;
    case 'stem':
      requireCondition(['auto', 'up', 'down'].includes(change.value), 'Choose an auto, up, or down stem direction.');
      break;
    case 'accidentalDisplay':
      requireCondition(['auto', 'always', 'courtesy'].includes(change.value), 'Choose auto, always, or courtesy accidental display.');
      break;
    case 'alter':
      requireCondition(change.ties === 'reject', 'Shared accidental editing never changes or clears tied chains.');
      validateAlteration(change.value);
      break;
    case 'articulation':
      validateArticulationType(change.value);
      requireCondition(typeof change.present === 'boolean', 'Choose explicitly whether to add or remove this articulation.');
      break;
    case 'ornament':
      validateOrnamentType(change.value);
      requireCondition(typeof change.present === 'boolean', 'Choose explicitly whether to add or remove this ornament.');
      break;
    case 'attacks':
      requireCondition(change.value === 'none', 'Choose None to clear articulations and ornaments.');
      break;
    default: throw new Error('Choose a shared duration, dot count, stem, accidental display, alteration, or articulation presence.');
  }
}

function mutationFor(event: MusicEvent, change: EventPropertyChange): Mutation | undefined {
  const named = 'Event "' + event.id + '": ';
  switch (change.property) {
    case 'duration':
    case 'dots': {
      requireCondition(!event.measureRest,
        named + 'a full-measure rest follows the meter. Convert it to a written rest before changing its value or dots.');
      requireCondition(event.kind !== 'slash' || event.rhythmic,
        named + 'an open slash does not prescribe attacks. Edit its nominal span separately or explicitly choose written rhythm.');
      // Each member retains its own other rhythm field, even in a mixed selection.
      durationTime(change.property === 'duration' ? change.value : event.duration,
        change.property === 'dots' ? change.value : event.dots);
      if (event[change.property] === change.value) return undefined;
      return {
        eventId: event.id, rhythmChanged: true,
        attributes: change.property === 'duration' ? [['duration', change.value]]
          : [['dotted', null], ['dots', change.value === 0 ? null : String(change.value)]],
      };
    }
    case 'stem':
      requireCondition(!event.measureRest && event.kind !== 'rest' && (event.kind !== 'slash' || event.rhythmic)
        && event.duration !== 'whole' && event.duration !== 'breve',
      named + 'shared stem controls require written, stem-bearing notes or slashes (half notes or shorter), not rests or open slashes.');
      return event.stem === change.value ? undefined : {
        eventId: event.id, rhythmChanged: false,
        attributes: [['stem', change.value === 'auto' ? null : change.value]],
      };
    case 'accidentalDisplay':
      requireCondition((event.kind === 'note' || event.kind === 'chord') && event.pitches.length > 0,
        named + 'accidental display applies only to pitched notes and chords.');
      return event.pitches.every(pitch => pitch.display === change.value) ? undefined : {
        eventId: event.id, rhythmChanged: false,
        attributes: [['accidental-display', change.value === 'auto' ? null : change.value]],
      };
    case 'alter':
      requireCondition(event.kind === 'note' && event.pitches.length === 1,
        named + 'shared accidental changes require single pitched notes. Edit chord pitches explicitly; never choose an arbitrary tone.');
      // Admission applies to every member, including members whose value matches.
      requireCondition(event.tie === 'none',
        named + 'shared accidental changes require untied notes. Clear the connected tie chain explicitly before changing its pitch.');
      return event.pitches[0].alter === change.value ? undefined : {
        eventId: event.id, rhythmChanged: false,
        attributes: [['pitch', pitchText({ ...event.pitches[0], alter: change.value })], ['accidental', null]],
      };
    case 'articulation':
    case 'ornament': {
      if (change.present && change.property === 'articulation') requireCondition(change.value === 'fermata'
        || event.kind !== 'rest' && (event.kind !== 'slash' || event.rhythmic),
      named + 'rests and open slashes accept only a fermata. Choose written rhythm before adding an attack or release articulation.');
      if (change.present && change.property === 'ornament') requireCondition(event.kind === 'note' || event.kind === 'road',
        named + 'ornaments require a single pitched note or road event.');
      const matches = (event.markings ?? []).filter(mark => mark.kind === change.property && mark.type === change.value);
      requireCondition(matches.length <= 1, named + 'the same articulation is repeated. Resolve the duplicate source markings before editing their presence.');
      if (change.present) return matches.length ? undefined
        : { eventId: event.id, rhythmChanged: false, addMark: { kind: change.property, type: change.value } };
      // Removal is meaningful even when another selected event cannot receive this
      // articulation: an absent mark stays absent, without changing event kind.
      return matches.length ? { eventId: event.id, rhythmChanged: false, removeMarkIds: [matches[0].id] } : undefined;
    }
    case 'attacks': {
      const ids = (event.markings ?? []).filter(mark => mark.kind === 'articulation' || mark.kind === 'ornament').map(mark => mark.id);
      return ids.length ? { eventId: event.id, rhythmChanged: false, removeMarkIds: ids } : undefined;
    }
  }
}

function planChange(score: Score, eventIds: readonly string[], change: EventPropertyChange): Plan {
  validateChange(change);
  const members = selectMembers(score, eventIds);
  const mutations: Mutation[] = [];
  for (const { event } of members) {
    const mutation = mutationFor(event, change);
    if (mutation) mutations.push(mutation);
  }
  return { members, mutations };
}

/**
 * Read-only domain/scope admission against an accepted Score. Eligibility is not
 * a promise that a duration fits, or that a beam or pickup remains valid: only
 * the final complete staged score can authorize the musical transaction.
 */
export function analyzeEventPropertyChange(
  score: Score, eventIds: readonly string[], change: EventPropertyChange,
): EventPropertyAnalysis {
  try {
    const plan = planChange(score, eventIds, change);
    return { eligible: true, changedEventIds: plan.mutations.map(mutation => mutation.eventId) };
  } catch (error) {
    return { eligible: false, reason: error instanceof Error ? error.message : String(error), changedEventIds: [] };
  }
}

/**
 * Prepare every source operation before mutating the caller's isolated tree.
 * The EditorSession owns the single whole-score validation and history commit.
 */
export function applyEventPropertyChange(
  score: Score, sources: ReadonlyMap<string, Element>, eventIds: readonly string[],
  change: EventPropertyChange, create: (tag: string) => Element,
): AppliedEventProperty {
  const plan = planChange(score, eventIds, change);
  for (const { event } of plan.members) {
    requireCondition(sources.get(event.id)?.localName === 'music-' + event.kind,
      'The source for event "' + event.id + '" no longer matches its accepted kind. Select the music again.');
  }
  const prepared = plan.mutations.map(mutation => {
    const owner = sources.get(mutation.eventId)!;
    const attributes = (mutation.attributes ?? []).filter(([name, value]) => owner.getAttribute(name) !== value);
    const remove = (mutation.removeMarkIds ?? []).map(id => {
      const mark = sources.get(id);
      requireCondition(mark && ['music-articulation', 'music-ornament'].includes(mark.localName) && mark.parentElement === owner,
        'The named marking must remain a direct child of event "' + mutation.eventId + '". Select its current source again.');
      return mark;
    });
    return { mutation, owner, attributes, remove };
  });
  const changedEventIds: string[] = [];
  const rhythmChangedEventIds: string[] = [];
  for (const { mutation, owner, attributes, remove } of prepared) {
    if (!attributes.length && !remove.length && !mutation.addMark) continue;
    for (const [name, value] of attributes) {
      if (value === null) owner.removeAttribute(name);
      else owner.setAttribute(name, value);
    }
    remove.forEach(mark => mark.remove());
    if (mutation.addMark) {
      const mark = create(`music-${mutation.addMark.kind}`);
      mark.setAttribute('type', mutation.addMark.type);
      // Standard placement is automatic. Do not add a legacy override or rewrite
      // existing marks merely because they carry old placement attributes.
      owner.append(mark);
    }
    changedEventIds.push(mutation.eventId);
    if (mutation.rhythmChanged) rhythmChangedEventIds.push(mutation.eventId);
  }
  return { changedEventIds, rhythmChangedEventIds };
}
