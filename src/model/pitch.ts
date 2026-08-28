import type { AccidentalDisplay, Clef, Pitch, PitchAlteration, Step } from './types';

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const CLEF_BOTTOM: Readonly<Record<Clef, number>> = { treble: 30, bass: 18, alto: 24, tenor: 22 };
const ACCIDENTALS: Readonly<Record<string, number>> = {
  none: 0, natural: 0, n: 0, '♮': 0,
  sharp: 1, '#': 1, '♯': 1,
  flat: -1, b: -1, '♭': -1,
  'double-sharp': 2, '##': 2, x: 2, '♯♯': 2, '𝄪': 2,
  'double-flat': -2, bb: -2, '♭♭': -2, '𝄫': -2,
  'quarter-flat': -0.5, qf: -0.5,
  'quarter-sharp': 0.5, qs: 0.5,
  'three-quarter-flat': -1.5, tqf: -1.5,
  'three-quarter-sharp': 1.5, tqs: 1.5,
};

const PITCH_SUFFIXES: ReadonlyMap<number, string> = new Map([
  [-2, 'bb'], [-1.5, 'tqf'], [-1, 'b'], [-0.5, 'qf'], [0, ''],
  [0.5, 'qs'], [1, '#'], [1.5, 'tqs'], [2, '##'],
]);
const MICROTONAL_NAMES: ReadonlyMap<number, string> = new Map([
  [-1.5, 'three-quarter-flat'], [-0.5, 'quarter-flat'],
  [0.5, 'quarter-sharp'], [1.5, 'three-quarter-sharp'],
]);

const KEY_SIGNATURES: Readonly<Record<string, number>> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7,
  Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6, Abm: -7,
};

/** Parse absolute spelling: F4 is natural in every key; F#4 must be written explicitly. */
export function parsePitch(
  text: string,
  accidental?: string,
  display: AccidentalDisplay = 'auto',
): Pitch {
  if (typeof text !== 'string') throw new TypeError('Pitch must contain a letter and octave, such as C4 or Bb3.');
  // Keep an octave mandatory so that authoring does not depend on prior notes or key context.
  const parts = /^([a-gA-G])(tq[fs]|q[fs]|bb|##|♭♭|♯♯|[#bxn♭♯♮𝄪𝄫])?(-?\d+)$/u.exec(text.trim());
  if (!parts) throw new RangeError(`Invalid pitch "${text}". Use a letter, optional accidental, and octave, such as F#4.`);
  const octave = Number(parts[3]);
  if (!Number.isSafeInteger(octave) || octave < -1 || octave > 9) {
    throw new RangeError('Pitch octave must be an integer from -1 to 9.');
  }
  if (!['auto', 'always', 'courtesy'].includes(display)) {
    throw new RangeError(`Unsupported accidental display "${display}".`);
  }
  const suffix = parts[2];
  const separate = accidental?.trim().toLowerCase();
  if (separate !== undefined && !Object.hasOwn(ACCIDENTALS, separate)) {
    throw new RangeError(`Unsupported accidental "${accidental}". Use natural, sharp, flat, double-sharp, double-flat, quarter-sharp, quarter-flat, three-quarter-sharp, or three-quarter-flat.`);
  }
  if (suffix && separate !== undefined && ACCIDENTALS[suffix] !== ACCIDENTALS[separate]) {
    throw new RangeError('The accidental in the pitch conflicts with the accidental attribute.');
  }
  return {
    step: parts[1].toUpperCase() as Step,
    octave,
    alter: ACCIDENTALS[suffix ?? separate ?? 'natural'],
    display,
  };
}

/** Half-semitone values are exactly representable; arbitrary tuning is not implied. */
export function validateAlteration(alter: number): PitchAlteration {
  if (typeof alter !== 'number' || !PITCH_SUFFIXES.has(alter)) {
    throw new RangeError('Pitch alteration must be a multiple of 0.5 semitones from -2 to 2. Other microtonal tunings are not supported.');
  }
  return alter as PitchAlteration;
}

function checkPitch(pitch: Pitch): void {
  if (!pitch || !STEPS.includes(pitch.step)) throw new RangeError('Pitch step must be C, D, E, F, G, A, or B.');
  if (!Number.isSafeInteger(pitch.octave) || pitch.octave < -1 || pitch.octave > 9) {
    throw new RangeError('Pitch octave must be an integer from -1 to 9.');
  }
  validateAlteration(pitch.alter);
  if (!['auto', 'always', 'courtesy'].includes(pitch.display)) {
    throw new RangeError('Accidental display must be auto, always, or courtesy.');
  }
}

export function pitchText(pitch: Pitch): string {
  checkPitch(pitch);
  return `${pitch.step}${PITCH_SUFFIXES.get(pitch.alter)}${pitch.octave}`;
}

/** Read microtonal spellings in words instead of exposing an unfamiliar ASCII suffix. */
export function pitchDescription(pitch: Pitch): string {
  const spelling = pitchText(pitch);
  const name = MICROTONAL_NAMES.get(pitch.alter);
  return name ? `${pitch.step} ${name} ${pitch.octave}` : spelling;
}

/** Diatonic staff steps above the bottom line; each line is two steps. */
export function pitchPosition(pitch: Pitch, clef: Clef = 'treble'): number {
  checkPitch(pitch);
  return pitch.octave * 7 + STEPS.indexOf(pitch.step) - CLEF_BOTTOM[validateClef(clef)];
}

export function validateClef(text: string): Clef {
  if (typeof text !== 'string') throw new TypeError('Clef must be treble, bass, alto, or tenor.');
  const clef = text.trim().toLowerCase();
  if (!Object.hasOwn(CLEF_BOTTOM, clef)) throw new RangeError(`Unsupported clef "${text}". Use treble, bass, alto, or tenor.`);
  return clef as Clef;
}

/** The standard major/minor signatures with at most seven sharps or flats. */
export function validateKey(text: string): string {
  if (typeof text !== 'string') throw new TypeError('Key must name a major or minor key, such as Bb or F#m.');
  const value = text.trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  const match = /^([a-gA-G])([#b]?)(?:\s*(m|minor|major))?$/.exec(value);
  if (!match) throw new RangeError(`Unsupported key "${text}". Use a major or minor key, such as Bb or F#m.`);
  const key = match[1].toUpperCase() + match[2] + (match[3] === 'm' || match[3] === 'minor' ? 'm' : '');
  if (!Object.hasOwn(KEY_SIGNATURES, key)) {
    throw new RangeError(`Unsupported key "${text}". Signatures with more than seven accidentals are not supported.`);
  }
  return key;
}

export function keyAlterations(key: string): Readonly<Record<Step, number>> {
  const count = KEY_SIGNATURES[validateKey(key)];
  const result: Record<Step, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const order: readonly Step[] = count < 0 ? ['B', 'E', 'A', 'D', 'G', 'C', 'F'] : ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  for (const step of order.slice(0, Math.abs(count))) result[step] = count < 0 ? -1 : 1;
  return result;
}
