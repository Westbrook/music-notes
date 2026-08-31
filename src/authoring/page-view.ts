import { nothing, render } from 'lit/html.js';
import type { RootPart, TemplateResult } from 'lit/html.js';
import type { Diagnostic } from '../model/types.js';
import { unionInk, visibleInk } from '../engraving/geometry.js';
import { buildProjection, publicationPreflight, turnFingerprint } from './projection.js';
import { CSS_PIXELS_PER_MM, DEFAULT_PAGE_RESERVATIONS, pageDimensions, planPages } from './pages.js';
import type { PageReservations } from './pages.js';
import type { AuthorProject, LayoutProfile, MeasuredSystem, PagePlan, ProjectionResult } from './types.js';
import { pageMeasurementTemplate, pagePreflightTemplate, physicalPagesTemplate } from './page-view-templates.js';
import type { PageViewTemplateData } from './page-view-templates.js';

export interface PageViewResult {
  projection: ProjectionResult;
  plan: PagePlan;
  diagnostics: readonly Diagnostic[];
  fingerprint: string;
  reservations: PageReservations;
  /** Rechecked against the mounted page DOM immediately before publication. */
  containmentIssues?: readonly string[];
}

// CSS layout rounds fractional physical pixels; this is not a musical tolerance.
const DOM_TOLERANCE = 0.75;

interface TemplateMount { boundary: Comment; part: RootPart }
const templateMounts = new WeakMap<HTMLElement, TemplateMount>();
const mountedPages = new WeakMap<HTMLElement, { data: PageViewTemplateData; view: PageViewResult }>();

function currentMount(host: HTMLElement): TemplateMount | undefined {
  const mount = templateMounts.get(host);
  return mount?.boundary.parentNode === host && mount.part.startNode?.parentNode === host ? mount : undefined;
}

/** Own one synchronous Lit range, including when a caller has cleared the host. */
function renderTemplate(host: HTMLElement, template: TemplateResult): void {
  const mount = currentMount(host);
  if (mount) {
    render(template, host, { renderBefore: mount.boundary });
    return;
  }
  templateMounts.get(host)?.part.setConnected(false);
  host.replaceChildren();
  const boundary = document.createComment('page-view');
  host.append(boundary);
  const part = render(template, host, { renderBefore: boundary });
  templateMounts.set(host, { boundary, part });
}

function measuredHeight(element: HTMLElement, minimum: number, description: string): number {
  const bounds = element.getBoundingClientRect();
  if (!Number.isFinite(bounds.height) || bounds.height <= 0 || !Number.isFinite(bounds.width) || bounds.width <= 0) {
    throw new Error(`The ${description} could not be measured. Show the page preview and wait for its styles before printing.`);
  }
  return Math.max(minimum, Math.ceil(bounds.height));
}

interface Bounds { left: number; top: number; right: number; bottom: number; width: number; height: number }
function measurable(bounds: Bounds): boolean {
  return [bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0 && bounds.height > 0;
}
function contains(outer: Bounds, inner: Bounds): boolean {
  return inner.left >= outer.left - DOM_TOLERANCE && inner.top >= outer.top - DOM_TOLERANCE
    && inner.right <= outer.right + DOM_TOLERANCE && inner.bottom <= outer.bottom + DOM_TOLERANCE;
}
function close(actual: number, expected: number): boolean { return Math.abs(actual - expected) <= DOM_TOLERANCE; }

/**
 * Verify the real mounted output, including text that a measured-system planner
 * cannot see. Missing browser geometry is a failed check, never evidence of fit.
 * This is deliberately synchronous so the final preflight has no async gap.
 */
export function inspectPageContainment(
  host: HTMLElement, plan: PagePlan, profile: LayoutProfile, reservations: PageReservations = {},
): string[] {
  const issues = new Set<string>();
  const settings = pageDimensions(profile, reservations);
  const sheets = [...host.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('score-page'));
  if (sheets.length !== plan.pages.length || !sheets.length) {
    issues.add('The physical page preview is incomplete. Rebuild Pages before printing.');
    return [...issues];
  }
  if (document.fonts && document.fonts.status !== 'loaded') issues.add('Page fonts are still loading. Wait for the completed page layout before printing.');
  for (const [index, page] of plan.pages.entries()) {
    const sheet = sheets[index];
    const paperBox = sheet.getBoundingClientRect();
    const content = sheet.querySelector<HTMLElement>(':scope > .page-content');
    const pageName = `Page ${index + 1}`;
    if (!content || !measurable(paperBox)) { issues.add(`${pageName} cannot be measured. Show the current page preview before printing.`); continue; }
    if (sheet.dataset.pageIndex !== String(page.index)
      || !close(paperBox.width, plan.widthMm * CSS_PIXELS_PER_MM) || !close(paperBox.height, plan.heightMm * CSS_PIXELS_PER_MM)) {
      issues.add(`${pageName} does not match its selected physical paper dimensions. Rebuild Pages without scaling the page boxes.`);
    }
    const contentBox = content.getBoundingClientRect();
    if (!measurable(contentBox) || !contains(paperBox, contentBox)
      || !close(contentBox.width, plan.contentWidthPx) || !close(contentBox.height, plan.contentHeightPx)
      || !close(contentBox.left - paperBox.left, profile.marginMm * CSS_PIXELS_PER_MM)
      || !close(contentBox.top - paperBox.top, profile.marginMm * CSS_PIXELS_PER_MM)) {
      issues.add(`${pageName}'s printable area does not match its paper margins. Rebuild the page layout before printing.`);
    }
    const header = content.querySelector<HTMLElement>(':scope > .page-heading');
    const footer = content.querySelector<HTMLElement>(':scope > .page-footer');
    const title = content.querySelector<HTMLElement>(':scope > .page-title');
    const furniture: [HTMLElement | null, number, string][] = [
      [header, settings.headerHeightPx, 'header'], [footer, settings.footerHeightPx, 'footer'],
      ...(index === 0 ? [[title, settings.titleHeightPx, 'title'] as [HTMLElement | null, number, string]] : []),
    ];
    for (const [block, expectedHeight, name] of furniture) {
      const bounds = block?.getBoundingClientRect();
      if (!block || !bounds || !measurable(bounds) || !contains(contentBox, bounds) || !close(bounds.height, expectedHeight)) {
        issues.add(`${pageName}'s ${name} exceeds or differs from its reserved space. Rebuild the page layout.`);
        continue;
      }
      for (const text of block.querySelectorAll<HTMLElement>('h1,p,span')) {
        if (!text.textContent?.trim()) continue;
        try {
          const range = document.createRange();
          range.selectNodeContents(text);
          const lines = [...range.getClientRects()].filter(line => line.width > 0 || line.height > 0);
          if (!lines.length || lines.some(line => !contains(bounds, line) || !contains(contentBox, line))) {
            issues.add(`${pageName}'s ${name} text does not fit its reserved area. Shorten the text or allow more page space.`);
          }
        } catch {
          issues.add(`${pageName}'s ${name} text could not be measured in this browser. Use a browser with page measurement support.`);
        }
      }
    }
    if (header && !close(header.getBoundingClientRect().top, contentBox.top)) issues.add(`${pageName}'s header is displaced from the printable area.`);
    if (footer && !close(footer.getBoundingClientRect().bottom, contentBox.bottom)) issues.add(`${pageName}'s footer is displaced from the printable area.`);
    if (title && header && !close(title.getBoundingClientRect().top, header.getBoundingClientRect().bottom)) issues.add(`${pageName}'s title overlaps or separates unexpectedly from its header.`);
    const rows = [...content.querySelectorAll<HTMLElement>(':scope > .page-systems > .page-system')];
    if (rows.length !== page.systems.length) issues.add(`${pageName} has missing or duplicated systems. Rebuild Pages before printing.`);
    let top = contentBox.top + settings.headerHeightPx + (index === 0 ? settings.titleHeightPx : 0);
    const musicBottom = contentBox.bottom - settings.footerHeightPx;
    for (const [position, system] of page.systems.entries()) {
      const row = rows[position];
      const box = row?.getBoundingClientRect();
      const systemName = `System ${system.index + 1} on page ${index + 1}`;
      if (!row || !box || !measurable(box)) { issues.add(`${systemName} cannot be measured. Rebuild its engraving.`); continue; }
      if (row.dataset.systemIndex !== String(system.index) || row.dataset.start !== String(system.start) || row.dataset.end !== String(system.end)) {
        issues.add(`${systemName} has stale measure identities. Rebuild Pages before printing.`);
      }
      if (!contains(contentBox, box) || !close(box.left, contentBox.left) || !close(box.top, top)
        || box.bottom > musicBottom + DOM_TOLERANCE
        || !close(box.width, system.width * profile.staffScale) || !close(box.height, system.height * profile.staffScale)) {
        issues.add(`${systemName} does not fit its planned physical bounds. Adjust paper, staff size, or layout and rebuild Pages.`);
      }
      const svg = row.querySelector<SVGSVGElement>(':scope > svg.notation-svg');
      const svgBox = svg?.getBoundingClientRect();
      if (!svg || !svgBox || !measurable(svgBox) || !contains(box, svgBox) || !close(svgBox.width, box.width) || !close(svgBox.height, box.height)) {
        issues.add(`${systemName}'s vector notation differs from its measured system. Rebuild Pages before printing.`);
      } else {
        try {
          const ink = unionInk(visibleInk(svg));
          const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
          if (!ink || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0
            || ink.x < viewBox[0] - DOM_TOLERANCE || ink.y < viewBox[1] - DOM_TOLERANCE
            || ink.x + ink.width > viewBox[0] + viewBox[2] + DOM_TOLERANCE
            || ink.y + ink.height > viewBox[1] + viewBox[3] + DOM_TOLERANCE) {
            issues.add(`${systemName} has notation outside its vector viewport. Rebuild or revise the engraving before printing.`);
          }
        } catch {
          issues.add(`${systemName}'s visible notation could not be verified in this browser. Rebuild Pages in a browser with SVG measurement support.`);
        }
      }
      top += system.height * profile.staffScale + settings.systemGapPx;
    }
  }
  return [...issues];
}

/** Actual SVG systems and physical page boxes are shared by the preview and print. */
export async function renderPageView(
  host: HTMLElement,
  project: AuthorProject,
  partId: string,
  isCurrent: () => boolean = () => true,
): Promise<PageViewResult> {
  const projection = buildProjection(project, partId);
  const dimensions = pageDimensions(projection.profile);
  if (projection.diagnostics.some(item => item.severity === 'error') || dimensions.issues.length) {
    throw new Error([...projection.diagnostics.filter(item => item.severity === 'error').map(item => item.message), ...dimensions.issues].join('\n'));
  }
  const staging = document.createElement('div');
  staging.className = 'page-measurement';
  staging.style.width = `${dimensions.contentWidthPx}px`;
  staging.setAttribute('aria-hidden', 'true');
  document.body.append(staging);
  let measurement: RootPart | undefined;
  try {
    const engraving = await import('../engraving/render.js');
    await engraving.engravingReady();
    if (document.fonts) await document.fonts.ready;
    if (!isCurrent()) throw new DOMException('A newer layout replaced this request.', 'AbortError');
    // There cannot be more pages than measures: no system is split and no
    // title-only page is invented. Reserve for the widest number of that length.
    const pageDigits = String(Math.max(1, projection.score.staves[0].measures.length)).length;
    const widestNumber = '8'.repeat(pageDigits);
    const metadata = { ...project.metadata };
    measurement = render(pageMeasurementTemplate(metadata, projection.label, `${widestNumber} / ${widestNumber}`), staging);
    if (document.fonts) await document.fonts.ready;
    if (!isCurrent()) throw new DOMException('A newer layout replaced this request.', 'AbortError');
    const title = staging.querySelector<HTMLElement>('.page-title')!;
    const header = staging.querySelector<HTMLElement>('.page-heading')!;
    const footer = staging.querySelector<HTMLElement>('.page-footer')!;
    const titleHeightPx = measuredHeight(title, DEFAULT_PAGE_RESERVATIONS.titleHeightPx, 'page title');
    const reservations = {
      ...DEFAULT_PAGE_RESERVATIONS, titleHeightPx,
      headerHeightPx: measuredHeight(header, DEFAULT_PAGE_RESERVATIONS.headerHeightPx, 'running header'),
      footerHeightPx: measuredHeight(footer, DEFAULT_PAGE_RESERVATIONS.footerHeightPx, 'draft footer'),
    };
    render(nothing, staging);
    const rendered = engraving.renderScore(staging, projection.score, {
      width: dimensions.engravingWidthPx,
      maxMeasures: projection.profile.maxMeasures ?? undefined,
      justifyLast: projection.profile.justifyLast,
      measureNumbers: projection.profile.measureNumbers,
    });
    const geometry = rendered.systemGeometry;
    if (!geometry || geometry.length !== rendered.systems.length) throw new Error('The renderer did not return complete page geometry.');
    const systems: MeasuredSystem[] = geometry.map(system => ({
      index: system.index, start: system.start, end: system.end,
      width: system.width, height: system.height, pageBreak: system.pageBreak,
    }));
    const plan = planPages(systems, projection.profile, reservations);
    const diagnostics = [...projection.diagnostics, ...rendered.diagnostics];
    if (diagnostics.some(item => item.severity === 'error')) throw new Error(diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('\n'));
    const svgSystems = [...staging.querySelectorAll<SVGSVGElement>('svg.notation-svg')];
    if (svgSystems.length !== systems.length) throw new Error('The engraved systems and page plan disagree. Refresh before printing.');
    // Only the engraving adapter mutates SVG. Lit owns the surrounding page DOM
    // and mounts each measured vector node without serializing or cloning it.
    for (const system of systems) {
      const svg = svgSystems[system.index];
      if (!svg) throw new Error('The engraved systems and page plan disagree. Refresh before printing.');
      svg.querySelectorAll('rect[opacity="0"][pointer-events]').forEach(target => target.remove());
      svg.style.width = `${system.width * projection.profile.staffScale}px`;
      svg.style.height = `${system.height * projection.profile.staffScale}px`;
    }
    if (!isCurrent()) throw new DOMException('A newer layout replaced this request.', 'AbortError');
    const data: PageViewTemplateData = {
      metadata, label: projection.label, plan, profile: projection.profile, reservations, svgSystems,
      measureNumbers: projection.score.staves[0].measures.map(measure => measure.number),
    };
    // A completed engraving replaces the complete page snapshot, repairing any
    // removed page DOM. Only preflight changes reuse this snapshot's Lit parts.
    templateMounts.get(host)?.part.setConnected(false);
    templateMounts.delete(host);
    renderTemplate(host, physicalPagesTemplate(data));
    let pageStyle = document.getElementById('author-page-size');
    if (!pageStyle) { pageStyle = document.createElement('style'); pageStyle.id = 'author-page-size'; document.head.append(pageStyle); }
    pageStyle.textContent = `@page { size: ${plan.widthMm}mm ${plan.heightMm}mm; margin: 0; }`;
    const view = { projection, plan, diagnostics, reservations, fingerprint: turnFingerprint(project, partId, plan),
      containmentIssues: inspectPageContainment(host, plan, projection.profile, reservations) };
    mountedPages.set(host, { data, view });
    return view;
  } finally { measurement?.setConnected(false); staging.remove(); }
}

export function updatePagePreflight(
  host: HTMLElement, output: HTMLElement, project: AuthorProject, view: PageViewResult,
  draft: boolean, acknowledgeLayoutWarnings: boolean,
): boolean {
  // Both footer states were budgeted before pagination. Apply the chosen state
  // before checking real bounds, so switching to Draft cannot bypass fit checks.
  const mounted = mountedPages.get(host);
  const isMounted = mounted?.view === view && currentMount(host) !== undefined;
  if (isMounted) renderTemplate(host, physicalPagesTemplate(mounted.data, draft));
  host.classList.toggle('draft-pages', draft);
  view.containmentIssues = [
    ...(!isMounted ? ['The physical page preview is incomplete. Rebuild Pages before printing.'] : []),
    ...inspectPageContainment(host, view.plan, view.projection.profile, view.reservations),
  ];
  const hardLayoutErrors = [...view.plan.issues, ...view.containmentIssues];
  const preflight = publicationPreflight(project, view.projection.score, view.diagnostics, {
    draft, acknowledgeLayoutWarnings, layoutIssues: hardLayoutErrors,
  });
  // A page box that does not contain its music cannot be made printable by
  // acknowledging a warning. Preserve the preview so its cause can be fixed.
  const errors = [...new Set([...preflight.errors, ...hardLayoutErrors])];
  const canPublish = preflight.canPublish && hardLayoutErrors.length === 0 && view.plan.pages.length > 0;
  const summary = canPublish
    ? draft ? 'Draft pages prepared. Every page will be marked as unfinished.' : `${view.plan.pages.length} page${view.plan.pages.length === 1 ? '' : 's'} prepared. Inspect the music and intended turns before printing.`
    : 'Resolve these checks before printing:';
  const notices = [...errors, ...preflight.warnings.filter(warning => !errors.includes(warning))];
  renderTemplate(output, pagePreflightTemplate(summary, notices));
  output.dataset.ready = String(canPublish);
  document.body.dataset.authorPrintReady = String(canPublish);
  return canPublish;
}

/** Pending composition metadata invalidates publication without replacing Lit's mount. */
export function setPagePreflightMessage(output: HTMLElement, message: string): void {
  renderTemplate(output, pagePreflightTemplate(message, []));
  output.dataset.ready = 'false';
  document.body.dataset.authorPrintReady = 'false';
}
