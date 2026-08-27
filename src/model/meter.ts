import { add, rational } from './rational';
import type { Meter, Rational } from './types';

const MAX_METER_UNITS = 128;

function positiveInteger(value: number | string, name: string): number {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_METER_UNITS) {
    throw new RangeError(`${name} must be an integer from 1 to ${MAX_METER_UNITS}.`);
  }
  return number;
}

function readGroups(groups: readonly number[] | string): number[] {
  let values: readonly (number | string)[];
  if (typeof groups === 'string') {
    const text = groups.trim();
    if (/^\d+(?:\s*\+\s*\d+)+$/.test(text)) values = text.split(/\s*\+\s*/);
    else if (/^\d+(?:\s*,\s*\d+)+$/.test(text)) values = text.split(/\s*,\s*/);
    else if (/^\d+(?:\s+\d+)*$/.test(text)) values = text.split(/\s+/);
    else throw new RangeError('Meter groups must be positive integers, such as 2+2+3.');
  } else if (Array.isArray(groups)) values = groups;
  else throw new TypeError('Meter groups must be an array or a list such as 2+2+3.');
  if (values.length === 0 || values.length > MAX_METER_UNITS) {
    throw new RangeError(`Specify between 1 and ${MAX_METER_UNITS} meter groups.`);
  }
  return values.map(value => positiveInteger(value, 'Each meter group'));
}

function defaultGroups(numerator: number, denominator: number): number[] {
  if (numerator <= 4) {
    if (denominator >= 8) return numerator === 4 ? [2, 2] : [numerator];
    return Array<number>(numerator).fill(1);
  }
  if (numerator % 3 === 0) return Array<number>(numerator / 3).fill(3);
  // Irregular meters are ambiguous. Validation exposes this assumption as a warning.
  if (numerator % 2 === 0) return Array<number>(numerator / 2).fill(2);
  return [...Array<number>((numerator - 3) / 2).fill(2), 3];
}

/** Numeric signatures and additive numerators; groups are denominator units. */
export function parseMeter(
  top: number | string = 4,
  bottom: number | string = 4,
  groups?: readonly number[] | string,
): Meter {
  const denominator = positiveInteger(bottom, 'The meter denominator');
  if (!Number.isInteger(Math.log2(denominator))) {
    throw new RangeError('The meter denominator must be a power of two from 1 to 128.');
  }
  let additive: number[] | undefined;
  let numerator: number;
  if (typeof top === 'string' && top.includes('+')) {
    if (!/^\d+(?:\s*\+\s*\d+)+$/.test(top.trim())) {
      throw new RangeError('An additive numerator must contain positive integers, such as 2+2+3.');
    }
    additive = readGroups(top);
    numerator = positiveInteger(additive.reduce((sum, value) => sum + value, 0), 'The meter numerator');
  } else numerator = positiveInteger(top, 'The meter numerator');
  const explicit = groups === undefined ? additive : readGroups(groups);
  if (explicit && explicit.reduce((sum, value) => sum + value, 0) !== numerator) {
    throw new RangeError(`Meter groups must sum to ${numerator}.`);
  }
  if (additive && explicit && (additive.length !== explicit.length || additive.some((value, index) => value !== explicit[index]))) {
    throw new RangeError('The additive numerator conflicts with the explicit meter groups.');
  }
  return {
    numerator,
    denominator,
    groups: explicit ? [...explicit] : defaultGroups(numerator, denominator),
    explicitGroups: explicit !== undefined,
    display: `${additive ? additive.join('+') : numerator}/${denominator}`,
  };
}

export function meterTime(meter: Meter): Rational {
  // Validate externally constructed models without changing their declared grouping.
  parseMeter(meter.numerator, meter.denominator, meter.groups);
  return rational(meter.numerator, meter.denominator);
}

/** Cumulative group endings, including the bar end and excluding the initial zero. */
export function meterBoundaries(meter: Meter): Rational[] {
  meterTime(meter);
  let current = rational(0);
  return meter.groups.map(group => {
    current = add(current, rational(group, meter.denominator));
    return current;
  });
}
