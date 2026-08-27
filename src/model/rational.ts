import type { Rational } from './types';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function integer(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
  return BigInt(value);
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduced(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError('A rational denominator cannot be zero.');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > MAX_SAFE || numerator < -MAX_SAFE || denominator > MAX_SAFE) {
    throw new RangeError('This musical time exceeds the safe integer range.');
  }
  return { numerator: Number(numerator), denominator: Number(denominator) };
}

function parts(value: Rational): readonly [bigint, bigint] {
  if (!value || typeof value !== 'object') throw new TypeError('Expected a rational number.');
  const numerator = integer(value.numerator, 'The numerator');
  const denominator = integer(value.denominator, 'The denominator');
  if (denominator === 0n) throw new RangeError('A rational denominator cannot be zero.');
  return denominator < 0n ? [-numerator, -denominator] : [numerator, denominator];
}

/** Reduced, JSON-safe exact time. All public numerator/denominator values are safe integers. */
export function rational(numerator: number, denominator = 1): Rational {
  return reduced(integer(numerator, 'The numerator'), integer(denominator, 'The denominator'));
}

export function add(a: Rational, b: Rational): Rational {
  const [an, ad] = parts(a);
  const [bn, bd] = parts(b);
  return reduced(an * bd + bn * ad, ad * bd);
}

export function subtract(a: Rational, b: Rational): Rational {
  const [an, ad] = parts(a);
  const [bn, bd] = parts(b);
  return reduced(an * bd - bn * ad, ad * bd);
}

export function multiply(a: Rational, b: Rational): Rational {
  const [an, ad] = parts(a);
  const [bn, bd] = parts(b);
  return reduced(an * bn, ad * bd);
}

export function divide(a: Rational, b: Rational): Rational {
  const [an, ad] = parts(a);
  const [bn, bd] = parts(b);
  if (bn === 0n) throw new RangeError('Cannot divide musical time by zero.');
  return reduced(an * bd, ad * bn);
}

/** Compare without converting to floating point or overflowing intermediate products. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const [an, ad] = parts(a);
  const [bn, bd] = parts(b);
  const difference = an * bd - bn * ad;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function equals(a: Rational, b: Rational): boolean {
  return compare(a, b) === 0;
}

/** Only convert at display/layout boundaries; musical validation uses exact fractions. */
export function toNumber(value: Rational): number {
  const [numerator, denominator] = parts(value);
  return Number(numerator) / Number(denominator);
}

export function formatRational(value: Rational): string {
  const [numerator, denominator] = parts(value);
  const normalized = reduced(numerator, denominator);
  return normalized.denominator === 1
    ? String(normalized.numerator)
    : `${normalized.numerator}/${normalized.denominator}`;
}
