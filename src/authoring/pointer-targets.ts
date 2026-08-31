import { add, equals, pitchPosition, rational } from '../model/index.js';
import type { Clef, Measure, MusicEvent, Pitch, Rational, Score, Staff, Step, Voice } from '../model/types.js';
import type { EventGeometry, InsertionAnchor, MeasureGeometry, SystemGeometry } from '../engraving/render.js';
import type { Cursor } from './types.js';

export type PointerPosition = 'before' | 'after' | 'replace';
export type PointerEntryKind = 'note' | 'rest';
type StaffLines = Pick<MeasureGeometry, 'topLine' | 'bottomLine' | 'notation'>;

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const C_ZERO: Pitch = { step: 'C', octave: 0, alter: 0, display: 'auto' };
const MAX_LEDGER_MARGIN = 40;

function halfSpace(geometry: StaffLines): number {
  if ((geometry.notation ?? 'pitched') !== 'pitched') {
    throw new RangeError('Pitch placement requires a pitched staff; rhythm and 3 roads notation have no fixed pitches.');
  }
  const value = (geometry.bottomLine - geometry.topLine) / 8;
  if (!Number.isFinite(geometry.topLine) || !Number.isFinite(geometry.bottomLine)
    || !Number.isFinite(value) || value <= 0) {
    throw new RangeError('Pitch placement requires measured, ordered staff lines with positive spacing.');
  }
  return value;
}

/**
 * Snap to a diatonic line/space using the measure's resolved clef. The existing
 * pitchPosition function supplies the clef reference; no second clef table or
 * key-signature inference lives in the interaction layer. Halfway points choose
 * the higher diatonic position. Alteration and display policy remain explicit.
 */
export function pitchAtStaffY(
  y: number, measure: Pick<Measure, 'clef'>, geometry: StaffLines, spelling: Pitch,
): Pitch {
  if (!Number.isFinite(y)) throw new RangeError('The pointer pitch must have a finite staff position.');
  const stepHeight = halfSpace(geometry);
  // Validate the supplied spelling as well as the clef before preserving it.
  pitchPosition(spelling, measure.clef);
  const position = Math.round((geometry.bottomLine - y) / stepHeight);
  const absolute = position - pitchPosition(C_ZERO, measure.clef);
  if (!Number.isSafeInteger(absolute) || absolute < -7 || absolute > 9 * 7 + 6) {
    throw new RangeError('The selected pitch is outside the supported octave range -1 through 9. Move it back toward the staff.');
  }
  const octave = Math.floor(absolute / 7);
  return { ...spelling, step: STEPS[absolute - octave * 7], octave };
}

/** Intrinsic SVG y, before any screen transform or printed staff scale. */
export function staffPitchY(pitch: Pitch, clef: Clef, geometry: StaffLines): number {
  const stepHeight = halfSpace(geometry);
  const y = geometry.bottomLine - pitchPosition(pitch, clef) * stepHeight;
  if (!Number.isFinite(y)) throw new RangeError('The pitch cannot be positioned within these measured staff lines.');
  return y;
}

function usableLane(system: SystemGeometry, geometry: MeasureGeometry, x: number, entryKind: PointerEntryKind): boolean {
  const notation = geometry.notation ?? 'pitched';
  const singleLine = notation === 'rhythm';
  const restLane = entryKind === 'rest' && ['pitched', 'rhythm', 'three-roads'].includes(notation);
  return geometry.system === system.index && Number.isSafeInteger(geometry.measureIndex)
    && geometry.measureIndex >= system.start && geometry.measureIndex < system.end
    && [geometry.topLine, geometry.bottomLine, geometry.noteStartX, geometry.noteEndX].every(Number.isFinite)
    && (restLane ? singleLine
      ? geometry.bottomLine === geometry.topLine && Number.isFinite(geometry.staffSpace) && geometry.staffSpace! > 0
      : geometry.bottomLine > geometry.topLine : notation === 'pitched' && geometry.bottomLine > geometry.topLine)
    && geometry.noteEndX > geometry.noteStartX
    && x >= geometry.noteStartX && x <= geometry.noteEndX;
}

/**
 * Staff lines, not annotation/event ink, define the writing lane. A staff's own
 * five-line band wins over a neighboring staff's ledger extension. Otherwise
 * overlapping ledger lanes are ambiguous and are refused, not guessed. Ledger
 * reach is at most one staff height and never more than 40 intrinsic SVG units.
 * Rest entry also admits pitchless staves. A rhythm staff uses its measured
 * staffSpace for a one-space core and two-space reach; coincident line bounds
 * are never divided to invent a pitch or an unmeasured interaction area.
 */
export function findMeasureLane(system: SystemGeometry, x: number, y: number, entryKind: PointerEntryKind = 'note'): MeasureGeometry | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !['note', 'rest'].includes(entryKind)) return undefined;
  const candidates = system.measures.filter(geometry => usableLane(system, geometry, x, entryKind));
  const onStaff = candidates.filter(geometry => {
    const margin = geometry.notation === 'rhythm' ? Math.min(MAX_LEDGER_MARGIN, geometry.staffSpace!) : 0;
    return y >= geometry.topLine - margin && y <= geometry.bottomLine + margin;
  });
  if (onStaff.length) return onStaff.length === 1 ? onStaff[0] : undefined;
  const withLedgers = candidates.filter(geometry => {
    const margin = Math.min(MAX_LEDGER_MARGIN, geometry.notation === 'rhythm' ? 2 * geometry.staffSpace! : geometry.bottomLine - geometry.topLine);
    return y >= geometry.topLine - margin && y <= geometry.bottomLine + margin;
  });
  return withLedgers.length === 1 ? withLedgers[0] : undefined;
}

export interface InsertionTargetOptions {
  readonly system: SystemGeometry;
  readonly score: Score;
  readonly x: number;
  readonly y: number;
  readonly voiceIndex: number;
  readonly position: PointerPosition;
  /** Ordinary rest entry has no pitch mapping and also accepts reduced staves. */
  readonly entryKind?: PointerEntryKind;
  /** Canonical → projected identity, verified against both source DOMs by the caller.
   * Needed only when an empty voice has no adjacent event IDs. A supplied map
   * with no entry refuses that target; it never falls back to another voice. */
  readonly projectedVoiceIds?: ReadonlyMap<string, string>;
}

export interface PointerInsertionTarget {
  readonly staff: Staff;
  readonly measure: Measure;
  readonly voice: Voice;
  readonly geometry: MeasureGeometry;
  readonly cursor: Cursor;
  readonly position: PointerPosition;
  readonly anchorX: number;
  readonly onset: Rational;
  readonly scopeLabel: string;
  readonly starterRest: boolean;
}

function scopeOf(event: MusicEvent, voice: Voice): string | undefined {
  if (!event.tupletIds.length) return 'voice';
  const ratios: string[] = [];
  for (const id of event.tupletIds) {
    const tuplet = voice.tuplets.find(candidate => candidate.id === id);
    if (!tuplet) return undefined;
    ratios.push(`${tuplet.actual}:${tuplet.normal}`);
  }
  return `${ratios.length === 1 ? 'tuplet' : 'tuplets'} ${ratios.join(' → ')}`;
}

function withinNoteInterval(x: number, geometry: MeasureGeometry): boolean {
  return Number.isFinite(x) && x >= geometry.noteStartX && x <= geometry.noteEndX;
}

/** Match adjacent source identities, never a generated implicit voice ID. */
function anchorInVoice(anchor: InsertionAnchor, voice: Voice, geometry: MeasureGeometry): boolean {
  if (anchor.system !== geometry.system || anchor.staffId !== geometry.staffId || anchor.measureId !== geometry.sourceId
    || !Number.isSafeInteger(anchor.eventIndex) || anchor.eventIndex < 0 || anchor.eventIndex > voice.events.length
    || !withinNoteInterval(anchor.x, geometry)) return false;
  const before = voice.events[anchor.eventIndex];
  const after = voice.events[anchor.eventIndex - 1];
  if (anchor.beforeId !== before?.id || anchor.afterId !== after?.id || (!before && !after)) return false;
  const onset = before?.onset ?? add(after.onset, after.time);
  return equals(anchor.onset, onset);
}

function eventInVoice(event: EventGeometry, voice: Voice, geometry: MeasureGeometry): boolean {
  return event.system === geometry.system && event.staffId === geometry.staffId && event.measureId === geometry.sourceId
    && Number.isSafeInteger(event.eventIndex) && event.eventIndex >= 0
    && voice.events[event.eventIndex]?.id === event.sourceId
    && withinNoteInterval(event.anchorX, geometry)
    && equals(event.onset, voice.events[event.eventIndex].onset);
}

/** Equal-distance ties select the earlier boundary/event, deterministically. */
function nearest<T>(items: readonly T[], x: number, position: (item: T) => number, order: (item: T) => number): T | undefined {
  let chosen: T | undefined;
  let distance = Infinity;
  for (const item of items) {
    const candidateDistance = Math.abs(position(item) - x);
    if (candidateDistance < distance || (candidateDistance === distance && chosen !== undefined && order(item) < order(chosen))) {
      chosen = item;
      distance = candidateDistance;
    }
  }
  return chosen;
}

/**
 * Resolve an existing musical boundary. Pixel distances select among published
 * anchors; they never become beat fractions. Before and after use their own
 * adjacent reference at the closest boundary, which also determines the actual
 * DOM/tuplet scope. A missing reference rejects the target instead of skipping
 * to a distant boundary with a different scope. A lone
 * full-measure rest is explicitly replaced for any requested position.
 *
 * Staff/measure/event IDs and event indices connect canonical and projected
 * scores even when their generated implicit voice IDs differ. An unavailable
 * active voice or stale geometry returns no target, never another voice. An
 * existing empty draft voice uses its one published zero anchor for Before or
 * After; Replace still requires an event.
 */
export function insertionTarget(options: InsertionTargetOptions): PointerInsertionTarget | undefined {
  const { system, score, x, y, voiceIndex, position } = options;
  if (!['before', 'after', 'replace'].includes(position) || !Number.isSafeInteger(voiceIndex) || voiceIndex < 0) return undefined;
  const entryKind = options.entryKind ?? 'note';
  const geometry = findMeasureLane(system, x, y, entryKind);
  if (!geometry) return undefined;
  const staff = score.staves.find(candidate => candidate.id === geometry.staffId);
  const measure = staff?.measures[geometry.measureIndex];
  if (!staff || !measure || measure.id !== geometry.sourceId) return undefined;
  const notation = staff.notation ?? 'pitched';
  if ((entryKind === 'note' && notation !== 'pitched') || !['pitched', 'rhythm', 'three-roads'].includes(notation)
    || (geometry.notation !== undefined && geometry.notation !== notation)) return undefined;
  const voice = measure.voices[voiceIndex];
  if (!voice) return undefined;
  if (!voice.events.length) {
    if (!measure.incomplete || measure.pickup || voice.tuplets.length || position === 'replace') return undefined;
    const projectedId = options.projectedVoiceIds ? options.projectedVoiceIds.get(voice.id) : voice.id;
    if (!projectedId) return undefined;
    const anchors = system.anchors.filter(anchor => anchor.system === system.index && anchor.staffId === staff.id
      && anchor.measureId === measure.id && anchor.sourceId === projectedId && anchor.voiceId === projectedId
      && anchor.eventIndex === 0 && anchor.beforeId === undefined && anchor.afterId === undefined
      && withinNoteInterval(anchor.x, geometry) && Number.isFinite(anchor.y) && Number.isFinite(anchor.height)
      && (notation === 'rhythm' ? anchor.height === 0 : anchor.height > 0)
      && equals(anchor.onset, rational(0)));
    if (anchors.length !== 1) return undefined;
    return { staff, measure, voice, geometry, cursor: { staffId: staff.id, measureId: measure.id, voiceIndex },
      position, anchorX: anchors[0].x, onset: anchors[0].onset, scopeLabel: 'voice', starterRest: false };
  }
  const starterRest = voice.events.length === 1 && voice.events[0].kind === 'rest' && voice.events[0].measureRest;
  let reference: MusicEvent;
  let anchorX: number;
  let onset: Rational;
  let resolvedPosition = position;
  if (position === 'replace' || starterRest) {
    const target = nearest(system.events.filter(event => eventInVoice(event, voice, geometry)), x,
      event => event.anchorX, event => event.eventIndex);
    if (!target) return undefined;
    reference = voice.events[target.eventIndex];
    anchorX = target.anchorX;
    onset = reference.onset;
    resolvedPosition = 'replace';
  } else {
    const target = nearest(system.anchors.filter(anchor => anchorInVoice(anchor, voice, geometry)), x,
      anchor => anchor.x, anchor => anchor.eventIndex);
    if (!target || (position === 'before' ? target.beforeId === undefined : target.afterId === undefined)) return undefined;
    reference = voice.events[position === 'before' ? target.eventIndex : target.eventIndex - 1];
    anchorX = target.x;
    onset = position === 'before' ? reference.onset : add(reference.onset, reference.time);
  }
  const scopeLabel = scopeOf(reference, voice);
  if (scopeLabel === undefined) return undefined;
  return {
    staff, measure, voice, geometry,
    cursor: { staffId: staff.id, measureId: measure.id, voiceIndex, eventId: reference.id },
    position: resolvedPosition, anchorX, onset, scopeLabel, starterRest,
  };
}
