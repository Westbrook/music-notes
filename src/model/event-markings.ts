import type { ArticulationType, HarmonyInterval, IntervalNumber, MarkingPlacement, OrnamentType } from './types';

export const ARTICULATION_TYPES: readonly ArticulationType[] = Object.freeze([
  'accent', 'staccato', 'tenuto', 'marcato', 'staccatissimo', 'fermata',
]);
export const ORNAMENT_TYPES: readonly OrnamentType[] = Object.freeze([
  'trill', 'turn', 'inverted-turn', 'upper-mordent', 'lower-mordent',
]);

export function validateArticulationType(value: string): ArticulationType {
  if (ARTICULATION_TYPES.includes(value as ArticulationType)) return value as ArticulationType;
  throw new RangeError(`Articulation type must be ${ARTICULATION_TYPES.join(', ')}.`);
}

export function validateOrnamentType(value: string): OrnamentType {
  if (ORNAMENT_TYPES.includes(value as OrnamentType)) return value as OrnamentType;
  throw new RangeError(`Ornament type must be ${ORNAMENT_TYPES.join(', ')}.`);
}

const SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21] as const;
const PERFECT_NUMBERS = new Set([1, 4, 5, 8, 11, 12]);
const INTERVAL_NAMES = ['unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth'] as const;

export function validateHarmonyInterval(interval: HarmonyInterval): HarmonyInterval {
  if (!interval || typeof interval !== 'object' || Array.isArray(interval)
    || !Number.isInteger(interval.number) || interval.number < 1 || interval.number > 13
    || (interval.alter !== -1 && interval.alter !== 0 && interval.alter !== 1)) {
    throw new RangeError('A harmony interval needs a number from 1 to 13 and an alteration of -1, 0, or 1.');
  }
  if (interval.number === 1 && interval.alter === -1) {
    throw new RangeError('A lowered unison (b1) reverses the declared direction. Use an above or below interval with a nonnegative distance.');
  }
  return interval;
}

/** Readable interval figures, independent of key, chosen main pitch, or rendering. */
export function parseHarmonyInterval(value: string): HarmonyInterval {
  const match = typeof value === 'string' && /^([b#]?)([1-9]|1[0-3])$/.exec(value.trim().replaceAll('♭', 'b').replaceAll('♯', '#'));
  if (!match) throw new RangeError('A harmony interval must be 1 through 13, optionally prefixed by b or #, such as 5, b3, or #11.');
  return validateHarmonyInterval({ number: Number(match[2]) as IntervalNumber, alter: match[1] === 'b' ? -1 : match[1] === '#' ? 1 : 0 });
}

export function harmonyIntervalText(interval: HarmonyInterval): string {
  validateHarmonyInterval(interval);
  return `${interval.alter === -1 ? 'b' : interval.alter === 1 ? '#' : ''}${interval.number}`;
}

/** Compound intervals retain their octave: 13 is 21 semitones, not 9. */
export function harmonyIntervalSemitones(interval: HarmonyInterval): number {
  validateHarmonyInterval(interval);
  return SEMITONES[interval.number - 1] + interval.alter;
}

/** Alter the distance first, then apply its sign: b3 below is -3, not -5. */
export function harmonyIntervalOffset(interval: HarmonyInterval, placement: MarkingPlacement): number {
  if (placement !== 'above' && placement !== 'below') throw new RangeError('Harmony direction must be above or below.');
  const distance = harmonyIntervalSemitones(interval);
  return placement === 'above' || distance === 0 ? distance : -distance;
}

export function harmonyIntervalDescription(interval: HarmonyInterval): string {
  validateHarmonyInterval(interval);
  const quality = interval.alter === 1 ? 'augmented' : PERFECT_NUMBERS.has(interval.number)
    ? interval.alter === -1 ? 'diminished' : 'perfect'
    : interval.alter === -1 ? 'minor' : 'major';
  return `${quality} ${INTERVAL_NAMES[interval.number - 1]}`;
}
