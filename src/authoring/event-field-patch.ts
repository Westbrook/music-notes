import { durationTime, parsePitch, pitchText, validatePitchDirection } from '../model/index.js';
import type { MusicEvent, Pitch } from '../model/types.js';
import type { EventInput } from './types.js';

const FIELDS = new Set<keyof EventInput>([
  'kind', 'pitch', 'pitches', 'duration', 'dots', 'rhythmic', 'measureRest',
  'accidentalDisplay', 'stem', 'beam', 'pitchDirection',
]);

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameSpelling(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.octave === b.octave && a.alter === b.alter;
}

/** Validate scope before the caller chooses an intentional kind replacement. */
export function validateEventPatchFields(fields: readonly (keyof EventInput)[]): void {
  requireCondition(Array.isArray(fields) && fields.every(field => FIELDS.has(field)), 'Choose supported event fields to update.');
}

/**
 * Patch an accepted event without serializing its unrelated musical or source data.
 * The caller owns kind replacement and whole-score validation on a detached source.
 */
export function patchEventFields(
  element: Element,
  event: MusicEvent,
  value: EventInput,
  fields: readonly (keyof EventInput)[],
): { changed: boolean; rhythmChanged: boolean } {
  validateEventPatchFields(fields);
  const selected = new Set(fields);
  if (!selected.size) return { changed: false, rhythmChanged: false };
  requireCondition(element.localName === `music-${event.kind}`, 'The selected source no longer matches the accepted event kind.');
  if (selected.has('kind')) {
    requireCondition(value.kind === event.kind, 'Changing the event kind requires an explicit event replacement.');
  }

  // Validate every named field before writing any attribute. Unrelated pending
  // form values are deliberately neither read nor validated.
  const attributes = new Map<string, string | null>();
  let rhythmChanged = false;

  if (selected.has('pitchDirection')) {
    requireCondition(event.kind === 'road', 'Pitch direction can only be changed on a 3 roads event.');
    requireCondition(value.pitchDirection !== undefined, 'A 3 roads event needs an explicit higher, same, or lower direction.');
    const direction = validatePitchDirection(value.pitchDirection);
    requireCondition((event.tie !== 'continue' && event.tie !== 'end') || direction === 'same',
      'A tied road continuation must stay Same (middle). Clear its connected tie chain before choosing Higher or Lower.');
    if (direction !== event.pitchDirection) attributes.set('direction', direction);
  }

  if (selected.has('pitch')) {
    requireCondition(event.kind === 'note' && event.pitches.length === 1, 'Pitch edits require a single note. Use chord pitches to edit a chord.');
    const next = parsePitch(value.pitch);
    if (!sameSpelling(event.pitches[0], next)) {
      attributes.set('pitch', pitchText(next));
      attributes.set('accidental', null);
    }
  }

  if (selected.has('pitches')) {
    requireCondition(event.kind === 'chord', 'Chord pitches can only be changed on a chord.');
    requireCondition(typeof value.pitches === 'string', 'A chord needs space-separated, explicitly spelled pitches.');
    const pitches = value.pitches.trim().split(/\s+/).filter(Boolean).map(text => parsePitch(text));
    requireCondition(pitches.length >= 2, 'A chord needs at least two explicitly spelled pitches. Use a note for one pitch.');
    requireCondition(new Set(pitches.map(pitchText)).size === pitches.length, 'A chord cannot repeat the same spelled pitch.');
    if (pitches.length !== event.pitches.length || pitches.some((pitch, index) => !sameSpelling(pitch, event.pitches[index]))) {
      attributes.set('pitches', pitches.map(pitchText).join(' '));
    }
  }

  if (selected.has('accidentalDisplay')) {
    requireCondition(event.kind === 'note' || event.kind === 'chord', 'Accidental display can only be changed on notes and chords.');
    requireCondition(['auto', 'always', 'courtesy'].includes(value.accidentalDisplay), 'Choose auto, always, or courtesy accidental display.');
    // An explicit display edit applies uniformly. Every other field leaves even
    // mixed model display policies alone; the first chord tone is not a default.
    if (!event.pitches.every(pitch => pitch.display === value.accidentalDisplay)) {
      attributes.set('accidental-display', value.accidentalDisplay === 'auto' ? null : value.accidentalDisplay);
    }
  }

  if (selected.has('stem')) {
    requireCondition(['auto', 'up', 'down'].includes(value.stem), 'Choose an auto, up, or down stem direction.');
    if (value.stem !== event.stem) attributes.set('stem', value.stem === 'auto' ? null : value.stem);
  }

  if (selected.has('beam')) {
    requireCondition(['auto', 'start', 'continue', 'end', 'none'].includes(value.beam), 'Choose auto, start, continue, end, or none for the beam.');
    const remainsMeasureRest = selected.has('measureRest') ? value.measureRest : event.measureRest;
    const retainedBeam = element.hasAttribute('beam') ? event.beam : remainsMeasureRest ? 'none' : 'auto';
    if (value.beam !== retainedBeam) {
      // A meter-rest defaults to none; an explicit request for auto must survive
      // that parser default. Other events express auto by omitting the attribute.
      attributes.set('beam', value.beam === 'auto' && !remainsMeasureRest ? null : value.beam);
    }
  }

  if (selected.has('rhythmic')) {
    requireCondition(typeof value.rhythmic === 'boolean', 'The rhythmic slash flag must be true or false.');
    requireCondition(!value.rhythmic || event.kind === 'slash', 'Only a slash can use the rhythmic slash flag.');
    if (value.rhythmic !== event.rhythmic) attributes.set('rhythmic', value.rhythmic ? '' : null);
  }

  if (selected.has('measureRest')) {
    requireCondition(typeof value.measureRest === 'boolean', 'The full-measure rest flag must be true or false.');
    requireCondition(!value.measureRest || event.kind === 'rest', 'Only a rest can fill an entire measure.');
  }
  if (selected.has('duration')) durationTime(value.duration, event.dots);
  if (selected.has('dots')) {
    requireCondition(Number.isSafeInteger(value.dots) && value.dots >= 0 && value.dots <= 3, 'Dots must be an integer from 0 to 3.');
    durationTime(event.duration, value.dots);
  }

  const measureRest = selected.has('measureRest') ? value.measureRest : event.measureRest;
  if (measureRest) {
    requireCondition(!selected.has('duration') || value.duration === 'whole',
      'A full-measure rest follows the meter. Explicitly turn off full-measure rest before choosing a written duration.');
    requireCondition(!selected.has('dots') || value.dots === 0, 'A full-measure rest cannot have dots. Explicitly turn off full-measure rest first.');
  }

  if (measureRest !== event.measureRest) {
    attributes.set('measure', measureRest ? '' : null);
    rhythmChanged = true;
    if (measureRest) {
      // Choosing the meter-rest glyph authorizes only its required written-value
      // cleanup. Ties, beams, and tuplet membership remain for score validation.
      if (event.duration !== 'whole') attributes.set('duration', null);
      attributes.set('dots', null);
      attributes.set('dotted', null);
    } else if (!selected.has('duration') && !element.hasAttribute('duration')) {
      // Without this explicit whole, removing measure would default to quarter.
      attributes.set('duration', event.duration);
    }
  }

  if (!measureRest) {
    if (selected.has('duration') && value.duration !== event.duration) {
      attributes.set('duration', value.duration);
      rhythmChanged = true;
    } else if (selected.has('duration') && event.measureRest && !element.hasAttribute('duration')) {
      attributes.set('duration', value.duration);
    }
    if (selected.has('dots') && value.dots !== event.dots) {
      attributes.set('dotted', null);
      attributes.set('dots', value.dots ? String(value.dots) : null);
      rhythmChanged = true;
    }
  }

  let changed = false;
  for (const [name, next] of attributes) {
    if (element.getAttribute(name) === next) continue;
    if (next === null) element.removeAttribute(name);
    else element.setAttribute(name, next);
    changed = true;
  }
  return { changed, rhythmChanged: changed && rhythmChanged };
}
