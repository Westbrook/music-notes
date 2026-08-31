import type { LayoutProfile, MeasuredSystem, PagePlan } from './types.js';

/** Physical CSS pixels, independent of the score's engraving or screen zoom. */
export const CSS_PIXELS_PER_MM = 96 / 25.4;

export interface PageReservations {
  /** Additional space on the first page only. */
  titleHeightPx?: number;
  /** Running header and footer space on every page. */
  headerHeightPx?: number;
  footerHeightPx?: number;
  /** Physical space between systems; not multiplied by staffScale. */
  systemGapPx?: number;
}

export const DEFAULT_PAGE_RESERVATIONS = Object.freeze({
  titleHeightPx: 72, headerHeightPx: 24, footerHeightPx: 24, systemGapPx: 16,
});

export interface PageDimensions {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  /** Entire printable box after margins, in physical CSS pixels. */
  contentWidthPx: number;
  contentHeightPx: number;
  /** Render SVG at this unscaled width, then apply staffScale once on paper. */
  engravingWidthPx: number;
  staffScale: number;
  titleHeightPx: number;
  headerHeightPx: number;
  footerHeightPx: number;
  systemGapPx: number;
  firstPageSystemHeightPx: number;
  laterPageSystemHeightPx: number;
  issues: string[];
}

/**
 * Page settings never depend on window size, device pixels, or browser zoom.
 * Invalid settings are diagnosed; finite fallback metrics only permit an error
 * preview and must not be treated as permission to publish.
 */
export function pageDimensions(profile: LayoutProfile, options: PageReservations = {}): PageDimensions {
  const issues: string[] = [];
  if (profile.paper !== 'letter' && profile.paper !== 'a4') issues.push('Choose Letter or A4 paper.');
  if (profile.orientation !== 'portrait' && profile.orientation !== 'landscape') {
    issues.push('Choose portrait or landscape page orientation.');
  }
  const paper = profile.paper === 'a4' ? [210, 297] : [215.9, 279.4];
  const [widthMm, heightMm] = profile.orientation === 'landscape' ? [paper[1], paper[0]] : paper;
  const validMargin = Number.isFinite(profile.marginMm) && profile.marginMm >= 0;
  if (!validMargin) issues.push('Page margins must be a finite, nonnegative number of millimeters.');
  const marginMm = validMargin ? profile.marginMm : 15;
  const contentWidthPx = Math.max(0, widthMm - 2 * marginMm) * CSS_PIXELS_PER_MM;
  const contentHeightPx = Math.max(0, heightMm - 2 * marginMm) * CSS_PIXELS_PER_MM;
  if (contentWidthPx <= 0 || contentHeightPx <= 0) issues.push('Page margins leave no printable area.');
  const validScale = Number.isFinite(profile.staffScale) && profile.staffScale > 0;
  if (!validScale) issues.push('Staff scale must be a finite number greater than zero.');
  const staffScale = validScale ? profile.staffScale : 1;
  const rawEngravingWidth = contentWidthPx / staffScale;
  const engravingWidthPx = Number.isFinite(rawEngravingWidth) ? Math.floor(rawEngravingWidth) : 0;
  if (engravingWidthPx < 1) issues.push('The page settings leave no usable engraving width at this staff scale.');

  const reservation = (key: keyof PageReservations, description: string): number => {
    const value = options[key] ?? DEFAULT_PAGE_RESERVATIONS[key];
    if (!Number.isFinite(value) || value < 0) {
      issues.push(`${description} must be a finite, nonnegative number of CSS pixels.`);
      return DEFAULT_PAGE_RESERVATIONS[key];
    }
    return value;
  };
  const titleHeightPx = reservation('titleHeightPx', 'Title space');
  const headerHeightPx = reservation('headerHeightPx', 'Header space');
  const footerHeightPx = reservation('footerHeightPx', 'Footer space');
  const systemGapPx = reservation('systemGapPx', 'Space between systems');
  const laterPageSystemHeightPx = Math.max(0, contentHeightPx - headerHeightPx - footerHeightPx);
  const firstPageSystemHeightPx = Math.max(0, laterPageSystemHeightPx - titleHeightPx);
  if (firstPageSystemHeightPx <= 0) issues.push('Title, header, and footer reservations leave no room for music on the first page.');
  if (laterPageSystemHeightPx <= 0) issues.push('Header and footer reservations leave no room for music.');
  return {
    widthMm, heightMm, marginMm, contentWidthPx, contentHeightPx, engravingWidthPx, staffScale,
    titleHeightPx, headerHeightPx, footerHeightPx, systemGapPx,
    firstPageSystemHeightPx, laterPageSystemHeightPx, issues,
  };
}

const PIXEL_TOLERANCE = 1e-7;

/**
 * Input widths/heights are intrinsic SVG CSS pixels at staffScale=1. The caller
 * engraves at pageDimensions(...).engravingWidthPx. Each system is retained whole
 * and scaled exactly once for the physical page. usedHeight includes title,
 * header, footer, and between-system gaps, in physical CSS pixels.
 *
 * Overflow is reported, not hidden by shrinking or splitting notation. A first
 * system that cannot coexist with the title stays on the first page with an
 * issue; the planner never creates a surprise title-only page to conceal it.
 */
export function planPages(
  systems: readonly MeasuredSystem[], profile: LayoutProfile, options: PageReservations = {},
): PagePlan {
  const dimensions = pageDimensions(profile, options);
  const { widthMm, heightMm, contentWidthPx, contentHeightPx } = dimensions;
  const issues = [...dimensions.issues];
  const result: PagePlan = { widthMm, heightMm, contentWidthPx, contentHeightPx, pages: [], issues };
  if (issues.length) return result;

  const indices = new Set<number>();
  for (const [position, system] of systems.entries()) {
    if (!Number.isFinite(system.width) || system.width <= 0
      || !Number.isFinite(system.height) || system.height <= 0
      || !Number.isFinite(system.width * dimensions.staffScale)
      || !Number.isFinite(system.height * dimensions.staffScale)) {
      issues.push(`System ${position + 1} has invalid measured dimensions; measure the completed engraving again.`);
    }
    if (!Number.isSafeInteger(system.index) || system.index < 0 || indices.has(system.index)
      || !Number.isSafeInteger(system.start) || !Number.isSafeInteger(system.end)
      || system.start < 0 || system.end <= system.start
      || (position > 0 && system.start !== systems[position - 1].end)) {
      issues.push(`System ${position + 1} has inconsistent measure ranges or identity; rebuild the projection before printing.`);
    }
    indices.add(system.index);
  }
  if (issues.length) return result;

  const createPage = () => {
    const index = result.pages.length;
    const page: PagePlan['pages'][number] = {
      index, systems: [],
      usedHeight: dimensions.headerHeightPx + dimensions.footerHeightPx + (index === 0 ? dimensions.titleHeightPx : 0),
    };
    result.pages.push(page);
    return page;
  };
  let page: PagePlan['pages'][number] | undefined;
  for (const system of systems) {
    const height = system.height * dimensions.staffScale;
    const width = system.width * dimensions.staffScale;
    if (!page) page = createPage();
    const gap = page.systems.length ? dimensions.systemGapPx : 0;
    if (page.systems.length && (system.pageBreak || page.usedHeight + gap + height > contentHeightPx + PIXEL_TOLERANCE)) {
      page = createPage();
    }
    const available = contentHeightPx - page.usedHeight;
    const between = page.systems.length ? dimensions.systemGapPx : 0;
    if (width > contentWidthPx + PIXEL_TOLERANCE) {
      issues.push(`System ${system.index + 1} is wider than the printable area at the selected staff scale; use a wider page or revise its notation/layout.`);
    }
    if (height + between > available + PIXEL_TOLERANCE) {
      issues.push(`System ${system.index + 1} is too tall for page ${page.index + 1}; reduce page reservations or revise the layout. The system has not been split or shrunk.`);
    }
    page.systems.push({ ...system });
    page.usedHeight += between + height;
  }
  return result;
}
