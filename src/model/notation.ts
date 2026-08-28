import type { PitchDirection } from './types';

/** Directions are explicit instructions, never guessed from a missing value or a pitch. */
export function validatePitchDirection(value: string): PitchDirection {
  if (value === 'higher' || value === 'same' || value === 'lower') return value;
  throw new RangeError('A 3 roads event requires direction="higher", "same", or "lower".');
}
