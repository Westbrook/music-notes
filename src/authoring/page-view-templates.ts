import { html, nothing } from 'lit/html.js';
import type { TemplateResult } from 'lit/html.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { PageReservations } from './pages.js';
import type { AuthorProject, LayoutProfile, MeasuredSystem, PagePlan } from './types.js';

export const DRAFT_LABEL = 'DRAFT - not ready for performance';

type PageMetadata = Readonly<AuthorProject['metadata']>;

/** Presentation inputs only: pagination and engraving stay outside templates. */
export interface PageViewTemplateData {
  readonly metadata: PageMetadata;
  readonly label: string;
  readonly plan: PagePlan;
  readonly profile: LayoutProfile;
  readonly reservations: Required<PageReservations>;
  readonly measureNumbers: readonly string[];
  /** The engraving adapter owns these vector nodes; Lit mounts them unchanged. */
  readonly svgSystems: readonly SVGSVGElement[];
}

function titleTemplate(metadata: PageMetadata, label: string, heightPx?: number): TemplateResult {
  return html`<div class="page-title" style=${styleMap({ height: heightPx === undefined ? undefined : `${heightPx}px` })}>
    <h1>${metadata.title || 'Untitled composition'}</h1>
    ${metadata.composer ? html`<p class="page-composer">${metadata.composer}</p>` : nothing}
    ${metadata.subtitle ? html`<p class="page-subtitle">${metadata.subtitle}</p>` : nothing}
    <p class="page-part-label">${label}</p>
  </div>`;
}

function headerTemplate(metadata: PageMetadata, label: string, heightPx?: number): TemplateResult {
  return html`<div class="page-heading" style=${styleMap({ height: heightPx === undefined ? undefined : `${heightPx}px` })}>
    <span>${metadata.title || 'Untitled composition'}</span><span>${label}</span>
  </div>`;
}

function footerTemplate(pageLabel: string, draft: boolean, heightPx?: number): TemplateResult {
  return html`<div class="page-footer" style=${styleMap({ height: heightPx === undefined ? undefined : `${heightPx}px` })}>
    <span class="draft-stamp">${draft ? DRAFT_LABEL : ''}</span><span class="page-number">${pageLabel}</span>
  </div>`;
}

/** Measure exactly the same furniture that the physical pages will display. */
export function pageMeasurementTemplate(metadata: PageMetadata, label: string, pageLabel: string): TemplateResult {
  return html`${titleTemplate(metadata, label)}${headerTemplate(metadata, label)}${footerTemplate(pageLabel, true)}`;
}

function systemTemplate(system: MeasuredSystem, gapPx: number, data: PageViewTemplateData): TemplateResult {
  return html`<div class="page-system"
    data-system-index=${system.index} data-start=${system.start} data-end=${system.end}
    aria-label=${`Measures ${data.measureNumbers[system.start]} through ${data.measureNumbers[system.end - 1]}`}
    style=${styleMap({
      width: `${system.width * data.profile.staffScale}px`,
      height: `${system.height * data.profile.staffScale}px`,
      marginBottom: `${gapPx}px`,
    })}>${data.svgSystems[system.index]}</div>`;
}

/** Light DOM preserves shared print styles, native headings, and SVG geometry. */
export function physicalPagesTemplate(data: PageViewTemplateData, draft = false): TemplateResult {
  const { metadata, label, plan, profile, reservations } = data;
  return html`${plan.pages.map(page => html`<section class="score-page" data-page-index=${page.index}
    aria-label=${`Page ${page.index + 1} of ${plan.pages.length}`}
    style=${styleMap({
      '--paper-width': `${plan.widthMm}mm`, '--paper-height': `${plan.heightMm}mm`, '--page-margin': `${profile.marginMm}mm`,
    })}>
    <div class="page-content" style=${styleMap({ width: `${plan.contentWidthPx}px`, height: `${plan.contentHeightPx}px` })}>
      ${headerTemplate(metadata, label, reservations.headerHeightPx)}
      ${page.index === 0 ? titleTemplate(metadata, label, reservations.titleHeightPx) : nothing}
      <div class="page-systems">${page.systems.map((system, index) =>
        systemTemplate(system, index < page.systems.length - 1 ? reservations.systemGapPx : 0, data))}</div>
      ${footerTemplate(`${page.index + 1} / ${plan.pages.length}`, draft, reservations.footerHeightPx)}
    </div>
  </section>`)}`;
}

/** Strings remain text bindings, including metadata and diagnostic prose. */
export function pagePreflightTemplate(summary: string, notices: readonly string[]): TemplateResult {
  return html`<p>${summary}</p>${notices.length ? html`<ul>${notices.map(notice => html`<li>${notice}</li>`)}</ul>` : nothing}`;
}
