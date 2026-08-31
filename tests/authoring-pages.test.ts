import { describe, expect, it } from 'vitest';
import { CSS_PIXELS_PER_MM, pageDimensions, planPages } from '../src/authoring/pages.js';
import type { LayoutProfile, MeasuredSystem } from '../src/authoring/types.js';

function profile(changes: Partial<LayoutProfile> = {}): LayoutProfile {
  return { paper: 'letter', orientation: 'portrait', marginMm: 15, staffScale: 1,
    measureNumbers: 'system', maxMeasures: null, justifyLast: false,
    breaks: {}, keeps: {}, reviewedTurns: {}, ...changes };
}
const noReservations = { titleHeightPx: 0, headerHeightPx: 0, footerHeightPx: 0, systemGapPx: 0 };
function system(index: number, height: number, changes: Partial<MeasuredSystem> = {}): MeasuredSystem {
  return { index, start: index * 4, end: (index + 1) * 4, width: 600, height, pageBreak: false, ...changes };
}

describe('physical page dimensions', () => {
  it('uses Letter dimensions, physical margins, and explicit page reservations', () => {
    const dimensions = pageDimensions(profile());
    expect(dimensions.widthMm).toBe(215.9);
    expect(dimensions.heightMm).toBe(279.4);
    expect(dimensions.contentWidthPx).toBeCloseTo(185.9 * CSS_PIXELS_PER_MM);
    expect(dimensions.contentHeightPx).toBeCloseTo(249.4 * CSS_PIXELS_PER_MM);
    expect(dimensions.engravingWidthPx).toBe(Math.floor(dimensions.contentWidthPx));
    expect(dimensions.firstPageSystemHeightPx).toBeCloseTo(dimensions.contentHeightPx - 120);
    expect(dimensions.laterPageSystemHeightPx).toBeCloseTo(dimensions.contentHeightPx - 48);
    expect(dimensions.issues).toEqual([]);
  });

  it('rotates physical A4 dimensions without depending on a viewport', () => {
    const dimensions = pageDimensions(profile({ paper: 'a4', orientation: 'landscape', marginMm: 10 }));
    expect(dimensions.widthMm).toBe(297);
    expect(dimensions.heightMm).toBe(210);
    expect(dimensions.contentWidthPx).toBeCloseTo(277 * CSS_PIXELS_PER_MM);
    expect(dimensions.contentHeightPx).toBeCloseTo(190 * CSS_PIXELS_PER_MM);
  });

  it('changes intrinsic engraving width, not physical page reservations, with staff scale', () => {
    const small = pageDimensions(profile({ staffScale: 0.75 }));
    const large = pageDimensions(profile({ staffScale: 1.5 }));
    expect(large.contentWidthPx).toBe(small.contentWidthPx);
    expect(large.contentHeightPx).toBe(small.contentHeightPx);
    expect(large.engravingWidthPx).toBe(Math.floor(large.contentWidthPx / 1.5));
    expect(small.engravingWidthPx).toBe(Math.floor(small.contentWidthPx / 0.75));
    expect(large.firstPageSystemHeightPx).toBe(small.firstPageSystemHeightPx);
  });

  it('does not silently accept invalid margins, scale, or page reservations', () => {
    for (const changes of [{ marginMm: -1 }, { marginMm: NaN }, { marginMm: 150 }, { staffScale: 0 }, { staffScale: Infinity }]) {
      const settings = profile(changes);
      expect(pageDimensions(settings).issues.length).toBeGreaterThan(0);
      expect(planPages([system(0, 100)], settings).pages).toEqual([]);
    }
    expect(pageDimensions(profile(), { titleHeightPx: -1 }).issues).not.toEqual([]);
    expect(pageDimensions(profile(), { titleHeightPx: 2000 }).issues).not.toEqual([]);
    expect(pageDimensions(profile(), { systemGapPx: Infinity }).issues).not.toEqual([]);
  });

  it('reports unrecognized paper and orientation even while providing finite error-preview metrics', () => {
    const dimensions = pageDimensions(profile({ paper: 'other', orientation: 'sideways' } as unknown as Partial<LayoutProfile>));
    expect(dimensions.issues).toHaveLength(2);
    expect(Number.isFinite(dimensions.contentWidthPx)).toBe(true);
    expect(Number.isFinite(dimensions.contentHeightPx)).toBe(true);
  });
});

describe('complete-system pagination', () => {
  it('fits exact boundaries and never adds a trailing system gap', () => {
    const settings = profile();
    const dimensions = pageDimensions(settings, noReservations);
    const height = (dimensions.contentHeightPx - 16) / 2;
    const plan = planPages([system(0, height), system(1, height)], settings, { ...noReservations, systemGapPx: 16 });
    expect(plan.issues).toEqual([]);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].usedHeight).toBeCloseTo(dimensions.contentHeightPx);
  });

  it('wraps whole systems when the next one cannot fit', () => {
    const plan = planPages([system(0, 350), system(1, 350), system(2, 350)], profile());
    expect(plan.issues).toEqual([]);
    expect(plan.pages.map(page => page.systems.map(value => value.index))).toEqual([[0, 1], [2]]);
    expect(plan.pages[0].usedHeight).toBe(120 + 350 + 16 + 350);
    expect(plan.pages[1].usedHeight).toBe(48 + 350);
  });

  it('honors explicit page choices without creating an empty first page', () => {
    const plan = planPages([
      system(0, 100, { pageBreak: true }), system(1, 100), system(2, 100, { pageBreak: true }),
      system(3, 100, { pageBreak: true }),
    ], profile());
    expect(plan.pages.map(page => page.systems.map(value => value.index))).toEqual([[0, 1], [2], [3]]);
    expect(plan.pages.map(page => page.index)).toEqual([0, 1, 2]);
    expect(plan.issues).toEqual([]);
  });

  it('reserves title only on page one and running header/footer on every page', () => {
    const plan = planPages([system(0, 200), system(1, 600), system(2, 150)], profile(), {
      titleHeightPx: 100, headerHeightPx: 30, footerHeightPx: 40, systemGapPx: 10,
    });
    expect(plan.pages.map(page => page.systems.map(value => value.index))).toEqual([[0], [1, 2]]);
    expect(plan.pages[0].usedHeight).toBe(100 + 30 + 40 + 200);
    expect(plan.pages[1].usedHeight).toBe(30 + 40 + 600 + 10 + 150);
  });

  it('scales intrinsic SVG dimensions once while retaining physical gaps', () => {
    const settings = profile({ staffScale: 2 });
    const width = pageDimensions(settings).engravingWidthPx;
    const plan = planPages([system(0, 180, { width }), system(1, 180, { width }), system(2, 180, { width })], settings);
    expect(plan.issues).toEqual([]);
    expect(plan.pages.map(page => page.systems.map(value => value.index))).toEqual([[0, 1], [2]]);
    expect(plan.pages[0].usedHeight).toBe(120 + 360 + 16 + 360);
    expect(plan.pages[0].systems[0].height).toBe(180);
  });

  it('retains a too-tall system intact on its page and reports overflow', () => {
    const input = [system(0, 1200), system(1, 100)];
    const plan = planPages(input, profile());
    expect(plan.pages.map(page => page.systems.map(value => value.index))).toEqual([[0], [1]]);
    expect(plan.pages[0].systems[0]).toEqual(input[0]);
    expect(plan.pages[0].usedHeight).toBe(1320);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toContain('too tall');
    expect(plan.issues[0]).toContain('not been split or shrunk');
  });

  it('does not create a title-only page when its first system fits only on a later page', () => {
    const settings = profile();
    const dimensions = pageDimensions(settings);
    const height = (dimensions.firstPageSystemHeightPx + dimensions.laterPageSystemHeightPx) / 2;
    const plan = planPages([system(0, height)], settings);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].systems).toHaveLength(1);
    expect(plan.issues[0]).toContain('too tall for page 1');
  });

  it('diagnoses horizontal overflow at physical staff scale', () => {
    const settings = profile({ staffScale: 1.25 });
    const dimensions = pageDimensions(settings);
    const plan = planPages([system(0, 100, { width: dimensions.contentWidthPx / 1.25 + 1 })], settings);
    expect(plan.pages).toHaveLength(1);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]).toContain('wider than the printable area');
  });

  it('does not mutate input systems or settings and is deterministic', () => {
    const settings = Object.freeze(profile());
    const input = Object.freeze([Object.freeze(system(0, 200)), Object.freeze(system(1, 500))]);
    const before = JSON.stringify({ settings, input });
    const first = planPages(input, settings);
    expect(planPages(input, settings)).toEqual(first);
    expect(JSON.stringify({ settings, input })).toBe(before);
    first.pages[0].systems[0].height = 10;
    expect(input[0].height).toBe(200);
  });

  it('returns no invented page when there are no systems', () => {
    expect(planPages([], profile()).pages).toEqual([]);
    expect(planPages([], profile()).issues).toEqual([]);
  });

  it('fails closed for stale ranges, duplicated identity, and invalid measured geometry', () => {
    for (const input of [
      [system(0, NaN)], [system(0, 0)], [system(0, 100, { width: Infinity })],
      [system(0, 100), system(0, 100, { start: 4, end: 8 })],
      [system(0, 100), system(1, 100, { start: 5, end: 8 })],
      [system(0, 100, { start: 4, end: 4 })],
    ]) {
      const plan = planPages(input, profile());
      expect(plan.issues.length).toBeGreaterThan(0);
      expect(plan.pages).toEqual([]);
    }
  });
});
