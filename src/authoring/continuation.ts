import { readScore } from '../dom/index.js';
import {
  add, compare, durationTime, formatRational, meterTime, parsePitch, pitchText, rational, validatePitchDirection,
} from '../model/index.js';
import type { Barline, Rational, Score, Staff } from '../model/types.js';
import type { Cursor, EventInput } from './types.js';

export interface ContinuationInput {
  cursor: Cursor;
  value: EventInput;
  position: 'before' | 'after' | 'replace';
}

export interface ContinuationAnalysis {
  eligible: boolean;
  ending: boolean;
  reason: string;
  newMeasureLabel?: string;
  currentMeasureLabel?: string;
  affectedStaves: readonly {
    staffId: string;
    label: string;
    measureId: string;
    measureNumber: string;
    endBar: Barline;
    voiceCount: number;
  }[];
}

function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Check the event that would stand alone at the start of the new voice. */
function insertionTime(value: EventInput, staff: Staff): Rational {
  requireInput(value && ['note', 'chord', 'rest', 'slash', 'rhythm', 'road'].includes(value.kind),
    'Choose a note, chord, written rest, slash, rhythm note, or road event to insert.');
  requireInput(value.kind !== 'road' || staff.notation === 'three-roads',
    'A road event needs a 3 roads music staff. Choose that staff type before inserting a pitch direction.');
  requireInput(staff.notation !== 'three-roads' || value.kind === 'road' || value.kind === 'rest',
    'A 3 roads music staff accepts only road events and rests. Choose Higher, Same, or Lower instead of a fixed pitch or ordinary slash.');
  requireInput(value.kind !== 'rhythm' || staff.notation === 'rhythm',
    'Rhythm notes need a single-line rhythm staff. Choose a rhythm staff, or use a pitched note or slash here.');
  requireInput(staff.notation !== 'rhythm' || (value.kind !== 'note' && value.kind !== 'chord'),
    'A rhythm staff has no pitches. Choose Rhythm note, Rest, or Slash; use a pitched staff for notes and chords.');
  requireInput(typeof value.measureRest === 'boolean' && typeof value.rhythmic === 'boolean',
    'Choose valid full-measure rest and rhythmic slash settings.');
  if (value.kind === 'road') {
    requireInput(value.pitchDirection !== undefined, 'A 3 roads event needs an explicit higher, same, or lower direction.');
    validatePitchDirection(value.pitchDirection);
    requireInput(value.rhythmic === false, 'A 3 roads event already prescribes written rhythm; the rhythmic flag belongs only to slashes.');
  } else requireInput(value.pitchDirection === undefined, 'Pitch direction belongs only to a 3 roads event.');
  requireInput(!value.measureRest, 'Use Add measure to create a full-measure rest.');
  requireInput(Number.isSafeInteger(value.dots), 'Dots must be an integer from 0 to 3.');
  const time = durationTime(value.duration, value.dots);
  requireInput(['auto', 'always', 'courtesy'].includes(value.accidentalDisplay),
    'Choose Auto, Always, or Courtesy for accidental display.');
  requireInput(['auto', 'up', 'down'].includes(value.stem), 'Choose Auto, Up, or Down for the stem.');
  requireInput(value.beam === 'auto' || value.beam === 'none',
    'Choose Auto or None for the beam; one event cannot start, continue, or end an explicit beam in a new measure.');
  if (value.kind === 'note') parsePitch(value.pitch, undefined, value.accidentalDisplay);
  if (value.kind === 'chord') {
    requireInput(typeof value.pitches === 'string', 'Enter at least two explicitly spelled pitches for a chord.');
    const pitches = value.pitches.trim().split(/\s+/).filter(Boolean)
      .map(pitch => parsePitch(pitch, undefined, value.accidentalDisplay));
    requireInput(pitches.length >= 2, 'A chord needs at least two explicitly spelled pitches. Use a note for one pitch.');
    requireInput(new Set(pitches.map(pitchText)).size === pitches.length,
      'A chord cannot repeat the same spelled pitch.');
  }
  return time;
}

/** Validate the actual proposed column and read its label without allocating command IDs. */
function plannedMeasureLabel(source: Element, score: Score, selectedStaffIndex: number,
  input: ContinuationInput, time: Rational): string {
  const owner = source.ownerDocument.implementation.createHTMLDocument('');
  const planned = owner.importNode(source, true) as Element;
  const staves = planned.localName === 'music-staff' ? [planned]
    : [...planned.children].filter(child => child.localName === 'music-staff');
  const taken = new Set([planned, ...planned.querySelectorAll('[id]')].map(node => node.id).filter(Boolean));
  let sequence = 0;
  const create = (tag: string): Element => {
    const node = owner.createElement(tag);
    let id: string;
    do { id = `music-continuation-plan-${++sequence}`; } while (taken.has(id));
    taken.add(id);
    node.id = id;
    return node;
  };
  staves.forEach((staff, index) => {
    const measure = create('music-measure');
    // No number/context attributes: the reader resolves the same inheritance
    // and opening-pickup numbering as the real append command.
    for (const [voiceIndex] of score.staves[index].measures.at(-1)!.voices.entries()) {
      const voice = create('music-voice');
      if (index === selectedStaffIndex && voiceIndex === input.cursor.voiceIndex) {
        // Emit the same active recipe fields as event insertion, then let the
        // normal reader/model enforce rules such as supported chord clusters.
        // Dormant pitch fields are not musical data on rests or pitchless events.
        const value = input.value;
        const event = create(`music-${value.kind}`);
        if (value.kind === 'note') event.setAttribute('pitch', value.pitch.trim());
        if (value.kind === 'chord') event.setAttribute('pitches', value.pitches.trim().split(/\s+/).join(' '));
        if (value.kind === 'road') event.setAttribute('direction', value.pitchDirection!);
        event.setAttribute('duration', value.duration);
        if (value.dots) event.setAttribute('dots', String(value.dots));
        if ((value.kind === 'note' || value.kind === 'chord') && value.accidentalDisplay !== 'auto') {
          event.setAttribute('accidental-display', value.accidentalDisplay);
        }
        if (value.kind === 'slash' && value.rhythmic) event.setAttribute('rhythmic', '');
        if (value.stem !== 'auto') event.setAttribute('stem', value.stem);
        if (value.beam !== 'auto') event.setAttribute('beam', value.beam);
        voice.append(event);
        if (compare(time, meterTime(score.staves[index].measures.at(-1)!.meter)) < 0) {
          measure.setAttribute('incomplete', '');
        }
      } else {
        const rest = create('music-rest');
        rest.setAttribute('measure', '');
        voice.append(rest);
      }
      measure.append(voice);
    }
    staff.append(measure);
  });
  const parsed = readScore(planned);
  const error = parsed.diagnostics.find(diagnostic => diagnostic.severity === 'error');
  if (error) throw new Error(error.message);
  return parsed.score.staves[selectedStaffIndex].measures.at(-1)!.number;
}

/**
 * Inspect the canonical authored staff/system, not a filtered part projection.
 * This does not edit source or invoke commands; final barlines need a separate
 * explicit decision even when all other continuation conditions are satisfied.
 */
export function analyzeContinuation(source: Element, input: ContinuationInput): ContinuationAnalysis {
  let details: Pick<ContinuationAnalysis, 'affectedStaves' | 'currentMeasureLabel'> = { affectedStaves: [] };
  const blocked = (reason: string): ContinuationAnalysis => ({ eligible: false, ending: false, reason, ...details });
  if (!['music-system', 'music-staff'].includes(source.localName)) {
    return blocked('Open a music-system or music-staff authoring source before adding a measure.');
  }
  try {
    const parsed = readScore(source);
    const error = parsed.diagnostics.find(diagnostic => diagnostic.severity === 'error');
    if (error) return blocked(`Fix the score before continuing: ${error.message}`);
    const { score } = parsed;
    const cursor = input?.cursor;
    if (!cursor) return blocked('Choose an existing staff, measure, and voice for insertion.');
    const staffIndex = score.staves.findIndex(staff => staff.id === cursor.staffId);
    if (staffIndex < 0) return blocked('Choose an existing staff for insertion.');
    const staff = score.staves[staffIndex];
    const measureIndex = staff.measures.findIndex(measure => measure.id === cursor.measureId);
    if (measureIndex < 0) return blocked('Choose a measure belonging to the selected staff.');
    const measure = staff.measures[measureIndex];
    const column = score.staves.map(member => ({ staff: member, measure: member.measures[measureIndex] }));
    details = {
      currentMeasureLabel: measure.number,
      affectedStaves: column.map(member => ({
        staffId: member.staff.id, label: member.staff.label,
        measureId: member.measure.id, measureNumber: member.measure.number,
        endBar: member.measure.endBar, voiceCount: member.measure.voices.length,
      })),
    };
    if (!Number.isInteger(cursor.voiceIndex) || cursor.voiceIndex < 0 || !measure.voices[cursor.voiceIndex]) {
      return blocked('Choose an existing voice in the selected measure.');
    }
    const voice = measure.voices[cursor.voiceIndex];
    const selected = cursor.eventId === undefined ? undefined : voice.events.find(event => event.id === cursor.eventId);
    if (cursor.eventId !== undefined && !selected) return blocked('Choose an event in the selected measure and voice.');
    if (!voice.events.length) return blocked('Write in this empty voice before continuing into a new measure. Choose Before or After to enter at its start.');
    if (voice.events.length === 1 && voice.events[0].measureRest) {
      return blocked('Insert here to replace the existing full-measure rest; a new measure is not needed.');
    }
    if (input.position !== 'after') return blocked('Choose Insert after at the end of the voice to continue into a new measure.');
    const last = voice.events.at(-1)!;
    if (selected && selected.id !== last.id) return blocked('Select the last event in this voice before continuing into a new measure.');
    if (last.tupletIds.length) {
      return blocked('This voice ends inside a tuplet. Use Add measure explicitly; continuation does not leave or carry a tuplet across a barline.');
    }
    if (last.tie === 'start' || last.tie === 'continue') {
      return blocked('Finish or clear the outgoing tie chain before adding a measure at this boundary.');
    }
    if (column.some(member => member.measure.pickup)) {
      return blocked('Use Add measure explicitly after a pickup; its intended length cannot be inferred from the meter.');
    }
    if (column.some(member => member.measure.repeatStart || member.measure.endBar === 'repeat-end')) {
      return blocked('Use Add measure explicitly at a repeat boundary; automatic continuation does not change repeats.');
    }
    if (score.staves.some(member => measureIndex !== member.measures.length - 1)) {
      return blocked('Select the final measure of the score; continuation does not insert ahead of or replace existing later measures.');
    }
    const capacity = meterTime(measure.meter);
    const total = voice.events.reduce((sum, event) => add(sum, event.time), rational(0));
    if (compare(total, capacity) !== 0) {
      return blocked(`Finish this voice before continuing: it contains ${formatRational(total)} of ${formatRational(capacity)} whole notes. Use Add measure explicitly for an intentional short bar.`);
    }
    const time = insertionTime(input.value, staff);
    if (compare(time, capacity) > 0) {
      return blocked(`Choose a shorter event: its written duration is ${formatRational(time)}, but the new ${measure.meter.display} measure holds ${formatRational(capacity)} whole notes. Continuation does not split events.`);
    }
    const newMeasureLabel = plannedMeasureLabel(source, score, staffIndex, input, time);
    const ending = column.some(member => member.measure.endBar === 'final');
    return {
      ...details, newMeasureLabel, eligible: !ending, ending,
      reason: ending ? 'A final barline ends this score. Choose explicitly how to continue beyond it before adding the measure.'
        : `Continue in measure ${newMeasureLabel}; a new aligned measure will be added to every staff.`,
    };
  } catch (error) {
    return blocked(`Cannot continue yet: ${error instanceof Error ? error.message : String(error)}`);
  }
}
