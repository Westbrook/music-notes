/** A measure column shared by every staff; base sizes describe an interior bar. */
export interface MeasureColumn {
  readonly minimum: number;
  readonly preferred: number;
  readonly breakBefore: 'auto' | 'line' | 'page';
  readonly keepWithNext: boolean;
  /** Relative share of surplus beyond preferred width; header widths need not stretch. */
  readonly stretchWeight?: number;
  /** Fixed additional header width when this column starts a system. */
  readonly startExtra?: number;
}

export interface SystemLayout {
  readonly start: number;
  /** Exclusive end index into the original measure columns. */
  readonly end: number;
  readonly widths: readonly number[];
  readonly width: number;
  /** This system begins at an explicitly requested page break. */
  readonly pageBreak: boolean;
  /** Minimum readable spacing cannot fit the available width. */
  readonly overflow: boolean;
}

export interface LayoutOptions {
  readonly maxMeasures?: number;
  readonly justifyLast?: boolean;
  /** Maximum nonfinal system width / preferred width. Omit for full justification. */
  readonly maxStretch?: number;
}

const MINIMUM_SIZE = 1;

function positiveSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(MINIMUM_SIZE, value) : fallback;
}

/** Saturating addition keeps malformed, extremely large pixel sizes finite. */
function addSize(a: number, b: number): number {
  return Math.min(Number.MAX_VALUE, a + b);
}

function normalizeColumn(column: MeasureColumn): MeasureColumn {
  const minimum = positiveSize(column.minimum, MINIMUM_SIZE);
  const weight = column.stretchWeight;
  const startExtra = column.startExtra;
  return {
    minimum,
    preferred: Math.max(minimum, positiveSize(column.preferred, minimum)),
    breakBefore: column.breakBefore === 'line' || column.breakBefore === 'page'
      ? column.breakBefore : 'auto',
    keepWithNext: column.keepWithNext === true,
    ...(weight !== undefined && Number.isFinite(weight) && weight >= 0 ? { stretchWeight: weight } : {}),
    ...(startExtra !== undefined && Number.isFinite(startExtra) && startExtra >= 0 ? { startExtra } : {}),
  };
}

function columnWidth(column: MeasureColumn, preferred: boolean, first: boolean): number {
  return addSize(preferred ? column.preferred : column.minimum, first ? column.startExtra ?? 0 : 0);
}

/** Check before addition so overflowing or rounded giant sums cannot falsely fit. */
function fitsAddition(occupied: number, addition: number, width: number): boolean {
  return occupied <= width && (occupied < width || addition === 0)
    && (addition < width || occupied === 0)
    && addition <= width - occupied && Number.isFinite(occupied + addition);
}

function columnFits(occupied: number, column: MeasureColumn, first: boolean, width: number): boolean {
  const header = first ? column.startExtra ?? 0 : 0;
  return fitsAddition(occupied, header, width)
    && fitsAddition(addSize(occupied, header), column.minimum, width);
}

/**
 * Keep chains are indivisible when they fit an otherwise empty system. Forced
 * breaks and the measure limit take precedence. Oversized chains become soft
 * preferences so they cannot force arbitrary amounts of music off the page.
 */
function protectedBoundaries(
  columns: readonly MeasureColumn[], width: number, maxMeasures: number,
): readonly boolean[] {
  const protectedAt = Array<boolean>(columns.length + 1).fill(false);
  for (let start = 0; start < columns.length;) {
    let end = start + 1;
    let fits = columnFits(0, columns[start], true, width);
    let minimum = columnWidth(columns[start], false, true);
    while (end < columns.length && columns[end - 1].keepWithNext
      && columns[end].breakBefore === 'auto') {
      fits = fits && columnFits(minimum, columns[end], false, width);
      minimum = addSize(minimum, columns[end].minimum);
      end++;
    }
    if (fits && end - start <= maxMeasures) {
      for (let boundary = start + 1; boundary < end; boundary++) protectedAt[boundary] = true;
    }
    start = end;
  }
  return protectedAt;
}

/** Penalties compare musical density without depending on the pixel scale. */
function rowCost(preferred: number, width: number, count: number, last: boolean, maxStretch?: number): number {
  const target = !last && maxStretch !== undefined ? Math.min(width, preferred * maxStretch) : width;
  const ratio = Math.min(32, preferred / target);
  const compression = Math.max(0, ratio - 1);
  const unused = Math.max(0, 1 - ratio);
  // A modest cost per row discourages needless fragmentation. Compression costs
  // more than stretching; the final line can remain naturally shorter.
  const spacing = 8 * compression ** 2 + (last ? 0.15 : 1.4) * unused ** 2;
  const orphan = last && count === 1 && ratio < 0.5 ? 0.45 * (1 - ratio) : 0;
  return 1 + spacing + orphan;
}

/** Allocate extra space by normalized weights, avoiding oversized products. */
function distribute(base: readonly number[], weights: readonly number[], target: number): number[] {
  const total = base.reduce(addSize, 0);
  const extra = Math.max(0, target - total);
  const maximumWeight = weights.reduce((maximum, weight) => Math.max(maximum, weight), 0);
  if (extra === 0 || maximumWeight === 0) return [...base];
  const normalized = weights.map(weight => weight / maximumWeight);
  const weightTotal = normalized.reduce((sum, weight) => sum + weight, 0);
  const widths = base.map((size, index) => size + extra * (normalized[index] / weightTotal));

  // Put rounding residue into an expandable column, not an unrelated measure.
  const actual = widths.reduce(addSize, 0);
  let lastWeighted = normalized.length - 1;
  while (normalized[lastWeighted] === 0) lastWeighted--;
  widths[lastWeighted] = Math.max(base[lastWeighted], widths[lastWeighted] + (target - actual));
  return widths;
}

function sizeRow(columns: readonly MeasureColumn[], target: number): readonly number[] {
  const minimum = columns.map((column, index) => columnWidth(column, false, index === 0));
  const preferred = columns.map((column, index) => columnWidth(column, true, index === 0));
  const preferredTotal = preferred.reduce(addSize, 0);
  if (target <= preferredTotal) {
    return distribute(minimum, preferred.map((value, index) => value - minimum[index]), target);
  }
  const weights = columns.map(column => column.stretchWeight ?? column.preferred);
  // Zero can make a column rigid. If every weight is zero, retain the previous
  // proportional behavior so a requested justified system still fills its width.
  return distribute(preferred, weights.some(weight => weight > 0) ? weights : columns.map(column => column.preferred), target);
}

/**
 * Choose shared system ranges and measure widths without reading or changing DOM.
 *
 * Each column is rendered exactly once; systems break only between columns.
 * Forced line/page breaks override keep hints. A keep chain that cannot fit is
 * split at as few boundaries as practical; an oversized individual measure is
 * placed alone and reported as overflow, never shrunk below its minimum.
 *
 * Each system includes only its first column's fixed `startExtra` header width;
 * this is charged in fitting, keep groups, and spacing, never to interior bars.
 * Nonfinal systems fill the available width unless `maxStretch` (a factor >= 1)
 * caps their expansion beyond preferred width. The final system keeps its
 * preferred width unless `justifyLast` is true; that explicit choice overrides
 * the nonfinal stretch cap. Invalid/nonpositive dimensions become one
 * pixel and preferred sizes below their minimum are raised to the minimum. This
 * also gives predictable results while a browser container has not been measured.
 * Optional nonnegative `stretchWeight` values distribute only the space beyond
 * preferred widths; compression continues to use each preferred-minus-minimum
 * allowance. An omitted/invalid weight uses that column's preferred width, as
 * before. Supply all weights when using a shared musical density scale.
 *
 * Dynamic programming balances the whole sequence instead of greedily leaving a
 * tiny final system. Work is O(n²) in the worst case, normally bounded by how many
 * measure minima can fit on a line. No input objects are mutated.
 */
export function planSystems(
  input: readonly MeasureColumn[],
  availableWidth: number,
  options: LayoutOptions = {},
): readonly SystemLayout[] {
  if (input.length === 0) return [];
  const columns = input.map(normalizeColumn);
  const width = positiveSize(availableWidth, MINIMUM_SIZE);
  const maximum = options.maxMeasures;
  const maxMeasures = maximum !== undefined && Number.isFinite(maximum) && maximum > 0
    ? Math.max(1, Math.floor(maximum)) : columns.length;
  const maxStretch = options.maxStretch !== undefined && Number.isFinite(options.maxStretch) && options.maxStretch >= 1
    ? options.maxStretch : undefined;
  const protectedAt = protectedBoundaries(columns, width, maxMeasures);
  const costs = Array<number>(columns.length + 1).fill(Infinity);
  const next = Array<number>(columns.length);
  costs[columns.length] = 0;

  for (let start = columns.length - 1; start >= 0; start--) {
    let minimum = 0;
    let preferred = 0;
    const limit = Math.min(columns.length, start + maxMeasures);
    for (let end = start + 1; end <= limit; end++) {
      const column = columns[end - 1];
      if (end > start + 1 && column.breakBefore !== 'auto') break;
      const first = end === start + 1;
      const fits = columnFits(minimum, column, first, width);
      if (!first && !fits) break;
      minimum = addSize(minimum, columnWidth(column, false, first));
      preferred = addSize(preferred, columnWidth(column, true, first));
      if (protectedAt[end]) continue;

      const last = end === columns.length;
      const breaksKeep = !last && columns[end - 1].keepWithNext
        && columns[end].breakBefore === 'auto';
      const cost = rowCost(preferred, width, end - start, last, maxStretch)
        + (breaksKeep ? 12 : 0) + costs[end];
      // A tie favors the earlier, fuller line and is deterministic across runs.
      if (cost <= costs[start]) {
        costs[start] = cost;
        next[start] = end;
      }
      if (!fits) break;
    }
  }

  const systems: SystemLayout[] = [];
  for (let start = 0; start < columns.length;) {
    const end = next[start];
    const row = columns.slice(start, end);
    const minimum = row.reduce((sum, column, index) => addSize(sum, columnWidth(column, false, index === 0)), 0);
    const preferred = row.reduce((sum, column, index) => addSize(sum, columnWidth(column, true, index === 0)), 0);
    const last = end === columns.length;
    const available = !last && maxStretch !== undefined ? Math.min(width, preferred * maxStretch) : width;
    const target = Math.max(minimum, last && !options.justifyLast ? Math.min(width, preferred) : available);
    const widths = sizeRow(row, target);
    systems.push({
      start,
      end,
      widths,
      width: widths.reduce(addSize, 0),
      pageBreak: columns[start].breakBefore === 'page',
      // Every multi-column candidate already passed a fit check. A single bar
      // can overflow even when an unrepresentable giant sum saturates its width.
      overflow: row.length === 1 && !columnFits(0, row[0], true, width),
    });
    start = end;
  }
  return systems;
}
