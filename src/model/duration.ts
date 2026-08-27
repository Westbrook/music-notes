import { multiply, rational } from './rational';
import type { Duration, Rational } from './types';

const DURATIONS: Readonly<Record<Duration, Rational>> = {
  breve: rational(2),
  whole: rational(1),
  half: rational(1, 2),
  quarter: rational(1, 4),
  eighth: rational(1, 8),
  sixteenth: rational(1, 16),
  'thirty-second': rational(1, 32),
  'sixty-fourth': rational(1, 64),
  '128th': rational(1, 128),
};

const ALIASES: Readonly<Record<string, Duration>> = {
  'double-whole': 'breve',
  '2/1': 'breve',
  '1': 'whole',
  '1/1': 'whole',
  '2': 'half',
  '1/2': 'half',
  '4': 'quarter',
  '1/4': 'quarter',
  '8': 'eighth',
  '1/8': 'eighth',
  '8th': 'eighth',
  '16': 'sixteenth',
  '1/16': 'sixteenth',
  '16th': 'sixteenth',
  '32': 'thirty-second',
  '1/32': 'thirty-second',
  '32nd': 'thirty-second',
  '64': 'sixty-fourth',
  '1/64': 'sixty-fourth',
  '64th': 'sixty-fourth',
  '128': '128th',
  '1/128': '128th',
};

export function parseDuration(text: string): Duration {
  if (typeof text !== 'string') throw new TypeError('Duration must be a name or a numeric string.');
  const value = text.trim().toLowerCase();
  if (Object.hasOwn(DURATIONS, value)) return value as Duration;
  if (Object.hasOwn(ALIASES, value)) return ALIASES[value];
  throw new RangeError(`Unsupported duration "${text}". Use breve through 128th, or a denominator such as 4 or 8.`);
}

/** Written duration before any tuplet multipliers, in whole notes. */
export function durationTime(duration: Duration, dots = 0): Rational {
  if (!Object.hasOwn(DURATIONS, duration)) throw new RangeError(`Unsupported duration "${duration}".`);
  if (!Number.isSafeInteger(dots) || dots < 0 || dots > 3) {
    throw new RangeError('Dots must be an integer from 0 to 3.');
  }
  return multiply(DURATIONS[duration], rational(2 ** (dots + 1) - 1, 2 ** dots));
}
