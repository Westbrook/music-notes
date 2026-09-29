import { describe, expect, it } from 'vitest';
import { planSystems } from '../src/engraving/layout.js';
import type { MeasureColumn } from '../src/engraving/layout.js';

function column(minimum = 100, preferred = 140, extra: Partial<MeasureColumn> = {}): MeasureColumn {
  return { minimum, preferred, breakBefore: 'auto', keepWithNext: false, ...extra };
}

describe('planSystems', () => {
  it('returns no systems for no measures', () => {
    expect(planSystems([], 800)).toEqual([]);
  });

  it('uses the opening indent only once and fits more measures on continuation systems', () => {
    const columns = Array.from({ length: 5 }, () => column(100, 100));
    const rows = planSystems(columns, 320, { firstSystemIndent: 120, justifyLast: true });
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 2], [2, 5]]);
    expect(rows.map(row => row.width)).toEqual([200, 320]);
    expect(rows.every(row => !row.overflow)).toBe(true);
  });

  it('fits keep chains against the width of the system they can start on', () => {
    const laterKeep = planSystems([column(100, 100), column(120, 120, { keepWithNext: true }), column(120, 120)],
      300, { firstSystemIndent: 120 });
    expect(laterKeep.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 3]]);
    const openingKeep = planSystems([column(100, 100, { keepWithNext: true }), column(100, 100)],
      300, { firstSystemIndent: 120 });
    expect(openingKeep.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2]]);
    expect(openingKeep.every(row => !row.overflow)).toBe(true);
  });

  it('reports opening overflow without charging the indent again after line or page breaks', () => {
    const rows = planSystems([column(240, 240), column(240, 240, { breakBefore: 'line' }), column(240, 240, { breakBefore: 'page' })],
      300, { firstSystemIndent: 100, justifyLast: true });
    expect(rows.map(row => row.width)).toEqual([240, 300, 300]);
    expect(rows.map(row => row.overflow)).toEqual([true, false, false]);
    expect(rows.map(row => row.pageBreak)).toEqual([false, false, true]);
  });

  it('ignores invalid indentation and keeps oversized indentation finite', () => {
    const columns = [column(100, 100), column(100, 100)];
    for (const firstSystemIndent of [undefined, 0, -1, NaN, Infinity]) {
      expect(planSystems(columns, 300, { firstSystemIndent })).toEqual(planSystems(columns, 300));
    }
    const rows = planSystems(columns, 300, { firstSystemIndent: 500 });
    expect(rows.map(row => row.overflow)).toEqual([true, false]);
    expect(rows.every(row => Number.isFinite(row.width))).toBe(true);
  });

  it('covers every shared measure column exactly once without shrinking minima', () => {
    const columns = [column(110), column(170, 220), column(90), column(200, 240), column(80)];
    const rows = planSystems(columns, 480);
    expect(rows[0].start).toBe(0);
    expect(rows.at(-1)?.end).toBe(columns.length);
    for (const [index, row] of rows.entries()) {
      if (index) expect(row.start).toBe(rows[index - 1].end);
      expect(row.widths).toHaveLength(row.end - row.start);
      row.widths.forEach((width, offset) => expect(width).toBeGreaterThanOrEqual(columns[row.start + offset].minimum));
      expect(row.width).toBeCloseTo(row.widths.reduce((a, b) => a + b, 0));
      expect(row.width).toBeLessThanOrEqual(480 + 1e-8);
      expect(row.overflow).toBe(false);
    }
  });

  it('honors line and page breaks without inserting an empty system', () => {
    const rows = planSystems([
      column(80, 100, { breakBefore: 'page' }),
      column(80, 100, { breakBefore: 'line' }),
      column(80, 100),
      column(80, 100, { breakBefore: 'page' }),
      column(80, 100, { breakBefore: 'line' }),
    ], 800);
    expect(rows.map(({ start, end, pageBreak }) => ({ start, end, pageBreak }))).toEqual([
      { start: 0, end: 1, pageBreak: true },
      { start: 1, end: 3, pageBreak: false },
      { start: 3, end: 4, pageBreak: true },
      { start: 4, end: 5, pageBreak: false },
    ]);
  });

  it('moves a fitting keep group intact onto the next line', () => {
    const rows = planSystems([
      column(180, 190), column(100, 110, { keepWithNext: true }), column(100, 110),
    ], 310);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 3]]);
  });

  it('keeps an entire fitting chain together', () => {
    const rows = planSystems([
      column(170, 170), column(70, 70, { keepWithNext: true }),
      column(70, 70, { keepWithNext: true }), column(70, 70),
    ], 250);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 4]]);
  });

  it('lets explicit breaks override keep-with-next', () => {
    const rows = planSystems([
      column(80, 100, { keepWithNext: true }), column(80, 100, { breakBefore: 'page' }),
    ], 800);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2]]);
    expect(rows[1].pageBreak).toBe(true);
  });

  it('splits oversized keep chains without shrinking or overflowing fitting measures', () => {
    const rows = planSystems([
      column(90, 100, { keepWithNext: true }), column(90, 100, { keepWithNext: true }), column(90, 100),
    ], 190);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.width <= 190 && !row.overflow)).toBe(true);
    expect(rows.flatMap(row => row.widths).every(width => width >= 90)).toBe(true);
  });

  it('preserves an oversized measure and reports only that line as overflow', () => {
    const rows = planSystems([column(100, 140), column(500, 600), column(100, 140)], 320);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(rows.map(row => row.overflow)).toEqual([false, true, false]);
    expect(rows[1].widths).toEqual([500]);
  });

  it('can balance the last measures instead of leaving a short orphan', () => {
    const rows = planSystems(Array.from({ length: 5 }, () => column(100, 140)), 450);
    expect(rows.map(row => row.end - row.start)).toEqual([3, 2]);
  });

  it('charges only the first column header and restores the same layout after resize', () => {
    const columns = Array.from({ length: 3 }, () => column(100, 120, { startExtra: 60 }));
    const wide = planSystems(columns, 450);
    expect(wide).toHaveLength(1);
    expect(wide[0].widths).toEqual([180, 120, 120]);
    const narrow = planSystems(columns, 250);
    expect(narrow.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(narrow.every(row => row.widths[0] >= 160 && !row.overflow)).toBe(true);
    expect(planSystems(columns, 450)).toEqual(wide);
  });

  it('uses each actual starting column header at forced line and page boundaries', () => {
    const rows = planSystems([
      column(80, 100, { startExtra: 30 }),
      column(80, 100, { startExtra: 90, breakBefore: 'line' }),
      column(80, 100, { startExtra: 50, breakBefore: 'page' }),
    ], 500, { maxStretch: 1 });
    expect(rows.map(row => row.width)).toEqual([130, 190, 150]);
    expect(rows.map(row => row.pageBreak)).toEqual([false, false, true]);
  });

  it('keeps a fitting pickup pair without charging the internal repeated-clef header', () => {
    const rows = planSystems([
      column(120, 140, { startExtra: 10 }),
      column(70, 80, { startExtra: 60, keepWithNext: true }),
      column(70, 80, { startExtra: 60 }),
    ], 220);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 3]]);
    expect(rows[1].widths).toEqual([140, 80]);
    expect(rows.every(row => !row.overflow)).toBe(true);
  });

  it('protects a derived opening-pickup preference only while the pair fits and no author override intervenes', () => {
    // The renderer derives this keep from an opening pickup without changing
    // the score. The planner must treat it like any other keep preference.
    const opening = Object.freeze(column(110, 130, { startExtra: 30, keepWithNext: true }));
    const following = Object.freeze(column(150, 180));
    const columns = Object.freeze([opening, following]);
    const before = JSON.stringify(columns);
    for (const width of [300, 290]) {
      const rows = planSystems(columns, width);
      expect(rows.map(row => [row.start, row.end])).toEqual([[0, 2]]);
      expect(rows[0].width).toBeLessThanOrEqual(width);
      expect(rows[0].overflow).toBe(false);
    }
    const narrow = planSystems(columns, 289);
    expect(narrow.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2]]);
    expect(narrow.every(row => !row.overflow)).toBe(true);
    expect(planSystems(columns, 600, { maxMeasures: 1 }).map(row => [row.start, row.end]))
      .toEqual([[0, 1], [1, 2]]);
    for (const breakBefore of ['line', 'page'] as const) {
      const rows = planSystems([opening, { ...following, breakBefore }], 600);
      expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2]]);
      expect(rows[1].pageBreak).toBe(breakBefore === 'page');
    }
    expect(JSON.stringify(columns)).toBe(before);
  });

  it('includes the starting header in minimum-width overflow decisions', () => {
    const rows = planSystems([
      column(80, 100, { startExtra: 200, keepWithNext: true }),
      column(80, 100),
    ], 250);
    expect(rows.map(row => [row.start, row.end])).toEqual([[0, 1], [1, 2]]);
    expect(rows.map(row => row.overflow)).toEqual([true, false]);
    expect(rows[0].widths).toEqual([280]);
  });

  it('caps sparse nonfinal systems, including a single bar before a page break', () => {
    const columns = [column(100, 120, { startExtra: 20 }), column(80, 100, { breakBefore: 'page' })];
    for (const available of [500, 1000]) {
      const rows = planSystems(columns, available, { maxStretch: 1.5 });
      expect(rows.map(row => row.width)).toEqual([210, 100]);
      expect(rows.map(row => row.pageBreak)).toEqual([false, true]);
    }
    const compressed = planSystems(columns, 135, { maxStretch: 1.5 });
    expect(compressed[0].width).toBe(135);
    expect(compressed[0].widths[0]).toBeGreaterThanOrEqual(120);
    expect(compressed[0].overflow).toBe(false);
  });

  it('keeps final-line justification explicit and preserves uncapped defaults', () => {
    const columns = [column(100, 140, { startExtra: 20 })];
    expect(planSystems(columns, 900, { maxStretch: 1.5 })[0].width).toBe(160);
    expect(planSystems(columns, 900, { maxStretch: 1.5, justifyLast: true })[0].width).toBe(900);
    const forced = [...columns, column(80, 100, { breakBefore: 'line' })];
    expect(planSystems(forced, 900)[0].width).toBe(900);
    for (const maxStretch of [0, 0.9, -1, Number.NaN, Infinity]) {
      expect(planSystems(forced, 900, { maxStretch })).toEqual(planSystems(forced, 900));
    }
  });

  it('normalizes invalid header extras and diagnoses giant headed measures without infinite geometry', () => {
    const base = [column(80, 100)];
    for (const startExtra of [-1, Number.NaN, Infinity]) {
      expect(planSystems([column(80, 100, { startExtra })], 500)).toEqual(planSystems(base, 500));
    }
    for (const startExtra of [1, Number.MAX_VALUE]) {
      const rows = planSystems([
        column(Number.MAX_VALUE, Number.MAX_VALUE, { startExtra, keepWithNext: true }),
        column(10, 20, { startExtra: 2 }),
      ], Number.MAX_VALUE, { maxStretch: 1.5 });
      expect(rows).toHaveLength(2);
      expect(rows[0].overflow).toBe(true);
      expect(rows[1].overflow).toBe(false);
      expect(rows.every(row => Number.isFinite(row.width) && row.widths.every(Number.isFinite))).toBe(true);
    }
  });

  it('does not grossly stretch a final one-measure line unless requested', () => {
    const columns = [column(80, 100)];
    expect(planSystems(columns, 900)[0].width).toBe(100);
    expect(planSystems(columns, 900, { justifyLast: true })[0].width).toBe(900);
  });

  it('gives a pickup less surplus than a held full bar even when the pickup has a wide header', () => {
    const rows = planSystems([
      column(160, 180, { stretchWeight: 0.5 }),
      column(80, 100, { stretchWeight: 1 }),
    ], 580, { justifyLast: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].widths).toEqual([280, 300]);
    expect(rows[0].widths[0] - 180).toBeLessThan(rows[0].widths[1] - 100);
    expect(rows[0].width).toBe(580);
  });

  it('preserves weighted minima, totals, break choices, and compression across widths', () => {
    const columns = [
      column(90, 120, { stretchWeight: 0.5 }),
      column(100, 160, { stretchWeight: 1 }),
      column(120, 150, { stretchWeight: 2, breakBefore: 'line' }),
    ];
    for (const available of [200, 420, 800]) {
      const rows = planSystems(columns, available, { justifyLast: true });
      const unweighted = planSystems(columns.map(({ stretchWeight: _weight, ...rest }) => rest), available, { justifyLast: true });
      expect(rows.map(({ start, end }) => [start, end])).toEqual(unweighted.map(({ start, end }) => [start, end]));
      for (const row of rows) {
        expect(row.width).toBeCloseTo(available);
        expect(row.widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(available);
        row.widths.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(columns[row.start + index].minimum));
      }
    }
    const compressed = [column(120, 180, { stretchWeight: 20 }), column(80, 100, { stretchWeight: 0.1 })];
    expect(planSystems(compressed, 250)[0].widths).toEqual([157.5, 92.5]);
  });

  it('keeps the previous sizing when weights are omitted or unusable', () => {
    const columns = [column(100, 200), column(100, 100)];
    const previous = planSystems(columns, 600, { justifyLast: true });
    expect(previous[0].widths).toEqual([400, 200]);
    expect(planSystems(columns.map(value => ({ ...value, stretchWeight: undefined })), 600, { justifyLast: true })).toEqual(previous);
    expect(planSystems(columns.map(value => ({ ...value, stretchWeight: Number.NaN })), 600, { justifyLast: true })).toEqual(previous);
    expect(planSystems(columns.map(value => ({ ...value, stretchWeight: 0 })), 600, { justifyLast: true })).toEqual(previous);
  });

  it('justifies earlier rows and distributes compression without violating minima', () => {
    const columns = [column(120, 180), column(80, 100), column(90, 110, { breakBefore: 'line' })];
    const rows = planSystems(columns, 250);
    expect(rows[0].width).toBeCloseTo(250);
    expect(rows[0].widths[0]).toBeCloseTo(157.5);
    expect(rows[0].widths[1]).toBeCloseTo(92.5);
    expect(rows[1].width).toBeCloseTo(110);
  });

  it('applies a hard maximum measure count even to keep groups', () => {
    const columns = Array.from({ length: 5 }, () => column(50, 60, { keepWithNext: true }));
    const rows = planSystems(columns, 800, { maxMeasures: 2 });
    expect(rows.every(row => row.end - row.start <= 2)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it.each([0, -1, Number.NaN, Infinity, -Infinity])('handles an invalid container width %s', width => {
    const rows = planSystems([column(50, 60), column(50, 60)], width);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.width === 50 && row.overflow)).toBe(true);
  });

  it('normalizes invalid sizes and preferred widths below the minimum', () => {
    const rows = planSystems([
      column(Number.NaN, Infinity), column(-20, -30), column(20, 5), column(0, 0),
    ], 100);
    expect(rows).toHaveLength(1);
    expect(rows[0].widths).toEqual([1, 1, 20, 1]);
    expect(rows[0].width).toBe(23);
  });

  it('handles extremely large finite sizes without nonfinite geometry', () => {
    const rows = planSystems([
      column(Number.MAX_VALUE, Number.MAX_VALUE), column(Number.MAX_VALUE, Number.MAX_VALUE),
    ], Number.MAX_VALUE);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => Number.isFinite(row.width) && row.width === Number.MAX_VALUE)).toBe(true);
  });

  it('is deterministic, does not mutate inputs, and can reflow both directions', () => {
    const columns = Object.freeze(Array.from({ length: 12 }, (_, index) => Object.freeze(
      column(80 + index % 3 * 10, 120 + index % 4 * 10),
    )));
    const wide = planSystems(columns, 800);
    const narrow = planSystems(columns, 320);
    expect(narrow.length).toBeGreaterThan(wide.length);
    for (let repeat = 0; repeat < 4; repeat++) {
      expect(planSystems(columns, 800)).toEqual(wide);
      expect(planSystems(columns, 320)).toEqual(narrow);
    }
  });

  it('preserves layout invariants across varied densities, breaks, and keep hints', () => {
    let seed = 0x6d757369;
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    for (let example = 0; example < 150; example++) {
      const available = 30 + random(770);
      const maxMeasures = 1 + random(8);
      const columns = Array.from({ length: 1 + random(30) }, () => {
        const minimum = 10 + random(240);
        return column(minimum, minimum + random(150), {
          breakBefore: random(10) === 0 ? 'page' : random(10) === 0 ? 'line' : 'auto',
          keepWithNext: random(3) === 0,
          startExtra: random(70),
        });
      });
      const rows = planSystems(columns, available, { maxMeasures, maxStretch: 1.5 });
      let expectedStart = 0;
      for (const row of rows) {
        expect(row.start).toBe(expectedStart);
        expect(row.end).toBeGreaterThan(row.start);
        expect(row.end - row.start).toBeLessThanOrEqual(maxMeasures);
        expect(row.widths).toHaveLength(row.end - row.start);
        expect(row.pageBreak).toBe(columns[row.start].breakBefore === 'page');
        for (let index = row.start; index < row.end; index++) {
          if (index > row.start) expect(columns[index].breakBefore).toBe('auto');
          expect(row.widths[index - row.start]).toBeGreaterThanOrEqual(columns[index].minimum + (index === row.start ? columns[index].startExtra ?? 0 : 0));
        }
        if (row.overflow) {
          expect(row.end - row.start).toBe(1);
          expect(columns[row.start].minimum + (columns[row.start].startExtra ?? 0)).toBeGreaterThan(available);
        } else {
          expect(row.width).toBeLessThanOrEqual(available + 1e-8);
        }
        expectedStart = row.end;
      }
      expect(expectedStart).toBe(columns.length);
    }
  });
});
