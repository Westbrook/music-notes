import { html, nothing } from 'lit/html.js';
import type { TemplateResult } from 'lit/html.js';
import type { Diagnostic } from '../model/types.js';
import style from './music-surface.css?inline';

/** Presentation data only; source observation and engraving belong to the coordinator. */
export interface SurfaceView {
  /** Allocate the full shell only after this element has owned a root projection. */
  readonly initialized: boolean;
  readonly visible: boolean;
  readonly loading: boolean;
  readonly label: string;
  readonly description: string;
  readonly diagnostics: readonly Diagnostic[];
  /** Embedders may present notices elsewhere; errors always remain visible. */
  readonly diagnosticsPresentation: 'all' | 'errors';
}

function surfaceContents(view: SurfaceView): TemplateResult {
  const errors = view.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const summary = errors ? `Notation needs attention (${errors} error${errors === 1 ? '' : 's'})`
    : `${view.diagnostics.length} notation notice${view.diagnostics.length === 1 ? '' : 's'}`;
  // The engraving adapter exclusively owns the children of these static,
  // unbound mounts. Lit updates never clear or replace their measured SVGs.
  // An unchanged open binding preserves the user's native disclosure choice;
  // entering an error state opens the diagnostic panel for the new problem.
  return html`
    <div class="loading" role="status" ?hidden=${!view.loading}>Preparing notation…</div>
    <details class="diagnostics" part="diagnostics" ?hidden=${view.diagnostics.length === 0 || (view.diagnosticsPresentation === 'errors' && errors === 0)} ?data-errors=${errors > 0} ?open=${errors > 0}>
      <summary>${summary}</summary>
      <ul>${view.diagnostics.map(diagnostic => html`<li data-source-id=${diagnostic.sourceId}>${diagnostic.message} [${diagnostic.sourceId}]</li>`)}</ul>
    </details>
    <div class="screen" part="screen"></div>
    <div class="print" part="print"></div>
    <details class="transcript" part="transcript"><summary>Read score as text</summary><pre>${view.description}</pre></details>
  `;
}

/** A stable Lit shell; nested source elements keep only the hidden outer shell. */
export function surfaceTemplate(view: SurfaceView): TemplateResult {
  return html`
    <style>${style}</style>
    <div class="surface" part="surface" role="group" aria-label=${view.label} ?hidden=${!view.visible}>
      ${view.initialized ? surfaceContents(view) : nothing}
    </div>
    <slot hidden></slot>
  `;
}
