// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { moveInk, overlapsInkX, transformInk, unionInk } from '../src/engraving/geometry.js';
import type { InkBox } from '../src/engraving/geometry.js';

const identity = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
const box = (x: number, y: number, width: number, height: number): InkBox => ({ x, y, width, height });

describe('unionInk', () => {
  it('returns no bounds for an empty collection', () => {
    expect(unionInk([])).toBeUndefined();
  });

  it('preserves a single box, including a point with zero extent', () => {
    const source = Object.freeze(box(-12, -8, 4, 6));
    expect(unionInk([source])).toEqual(source);
    expect(unionInk([source])).not.toBe(source);
    expect(unionInk([box(-2, 5, 0, 0)])).toEqual(box(-2, 5, 0, 0));
  });

  it('unites separate boxes across negative and positive coordinates', () => {
    expect(unionInk([box(-10, 3, 4, 7), box(2, -8, 6, 3)])).toEqual(box(-10, -8, 18, 18));
  });

  it('does not enlarge an outer box for contained or touching boxes', () => {
    const outer = box(-4, -5, 10, 12);
    expect(unionInk([outer, box(-2, -3, 2, 4), box(4, 5, 2, 2)])).toEqual(outer);
    expect(unionInk([box(-4, -5, 5, 12), box(1, -5, 5, 12)])).toEqual(outer);
  });

  it('is independent of order and never mutates the collection or boxes', () => {
    const sources = Object.freeze([
      Object.freeze(box(-4, 2, 3, 6)),
      Object.freeze(box(10, -3, 7, 4)),
      Object.freeze(box(0, 0, 5, 5)),
    ]);
    const before = JSON.stringify(sources);
    expect(unionInk(sources)).toEqual(unionInk([...sources].reverse()));
    expect(JSON.stringify(sources)).toBe(before);
  });
});

describe('moveInk', () => {
  it('translates position without changing dimensions', () => {
    expect(moveInk(box(-8, 4, 12, 6), 3, -9)).toEqual(box(-5, -5, 12, 6));
    expect(moveInk(box(2, -3, 0, 0), -4, 8)).toEqual(box(-2, 5, 0, 0));
  });

  it('supports reversible translations and returns a fresh immutable-input result', () => {
    const source = Object.freeze(box(-2.5, 4.25, 7.5, 2));
    const moved = moveInk(source, 10.25, -3.5);
    expect(moveInk(moved, -10.25, 3.5)).toEqual(source);
    expect(moveInk(source, 0, 0)).toEqual(source);
    expect(moveInk(source, 0, 0)).not.toBe(source);
    expect(source).toEqual(box(-2.5, 4.25, 7.5, 2));
  });
});

describe('overlapsInkX', () => {
  it('detects horizontal overlap regardless of vertical separation', () => {
    const left = box(-10, -100, 8, 2);
    const right = box(-3, 100, 9, 2);
    expect(overlapsInkX(left, right, 0)).toBe(true);
    expect(overlapsInkX(right, left, 0)).toBe(true);
    expect(overlapsInkX(box(0, 0, 20, 2), box(5, 50, 2, 2), 0)).toBe(true);
  });

  it('treats touching edges as separated without a gutter, but protects the default gutter', () => {
    const left = box(-10, 0, 8, 4);
    const touching = box(-2, 0, 4, 4);
    expect(overlapsInkX(left, touching, 0)).toBe(false);
    expect(overlapsInkX(left, touching)).toBe(true);
    expect(overlapsInkX(left, box(0, 0, 4, 4))).toBe(true);
    expect(overlapsInkX(left, box(1, 0, 4, 4))).toBe(false);
    expect(overlapsInkX(left, box(2, 0, 4, 4))).toBe(false);
  });

  it('requires the full requested gutter in either order', () => {
    const left = Object.freeze(box(-4, 8, 10, 2));
    const right = Object.freeze(box(11, -2, 8, 2));
    expect(overlapsInkX(left, right, 5)).toBe(false);
    expect(overlapsInkX(right, left, 5)).toBe(false);
    expect(overlapsInkX(left, right, 6)).toBe(true);
    expect(overlapsInkX(right, left, 6)).toBe(true);
    expect(left).toEqual(box(-4, 8, 10, 2));
    expect(right).toEqual(box(11, -2, 8, 2));
  });
});

describe('transformInk', () => {
  it('preserves identity and agrees with moveInk for translation', () => {
    const source = Object.freeze(box(-3, -4, 7, 11));
    expect(transformInk(source, identity)).toEqual(source);
    expect(transformInk(source, identity)).not.toBe(source);
    expect(transformInk(source, { ...identity, e: 12, f: -9 })).toEqual(moveInk(source, 12, -9));
  });

  it('handles nonuniform positive scaling and negative coordinates', () => {
    expect(transformInk(box(-3, 2, 5, 4), { ...identity, a: 2, d: 3 })).toEqual(box(-6, 6, 10, 12));
  });

  it('uses minimum transformed coordinates under reflection instead of negative dimensions', () => {
    const source = box(2, 3, 4, 5);
    expect(transformInk(source, { ...identity, a: -1, e: 10 })).toEqual(box(4, 3, 4, 5));
    expect(transformInk(source, { ...identity, d: -2 })).toEqual(box(2, -16, 4, 10));
    expect(transformInk(source, { ...identity, a: -1, d: -1 })).toEqual(box(-6, -8, 4, 5));
  });

  it('swaps extents for a quarter turn, including a following translation', () => {
    const source = box(2, 3, 4, 5);
    const quarterTurn = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    expect(transformInk(source, quarterTurn)).toEqual(box(-8, 2, 5, 4));
    expect(transformInk(source, { ...quarterTurn, e: 10, f: -4 })).toEqual(box(2, -2, 5, 4));
  });

  it('encloses all four corners after a non-axis-aligned rotation', () => {
    const s = Math.SQRT1_2;
    const result = transformInk(box(0, 0, 4, 2), { a: s, b: s, c: -s, d: s, e: 3, f: -5 });
    expect(result.x).toBeCloseTo(3 - 2 * s, 12);
    expect(result.y).toBeCloseTo(-5, 12);
    expect(result.width).toBeCloseTo(6 * s, 12);
    expect(result.height).toBeCloseTo(6 * s, 12);
  });

  it('includes off-diagonal shear terms when finding the outer corners', () => {
    expect(transformInk(box(1, -2, 3, 4), { ...identity, c: 2 })).toEqual(box(-3, -2, 11, 4));
    expect(transformInk(box(1, -2, 3, 4), { ...identity, b: -2 })).toEqual(box(1, -10, 3, 10));
  });

  it('keeps point bounds and collapsed axes finite', () => {
    expect(transformInk(box(-2, 3, 0, 0), { a: -1, b: 2, c: 3, d: -4, e: 5, f: -6 })).toEqual(box(16, -22, 0, 0));
    expect(transformInk(box(-3, 2, 5, 4), { ...identity, a: 0, d: 2, e: 7 })).toEqual(box(7, 4, 0, 8));
  });

  it('never mutates the source box or the transform matrix', () => {
    const source = Object.freeze(box(-2, 5, 4, 7));
    const matrix = Object.freeze({ a: -2, b: 1, c: 3, d: 4, e: -6, f: 9 });
    const before = JSON.stringify({ source, matrix });
    transformInk(source, matrix);
    expect(JSON.stringify({ source, matrix })).toBe(before);
  });
});
