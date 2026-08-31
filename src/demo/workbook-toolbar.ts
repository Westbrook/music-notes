import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { SignalController } from '../ui/signal-controller.js';
import type { WorkbookState, WorkbookView } from './workbook-state.js';

export interface WorkbookToolbarOptions {
  readonly idPrefix?: string;
  readonly printWidth?: number;
  readonly scoreCount?: number;
  readonly sourceHref?: string;
  readonly exampleHref?: string;
}

export interface WorkbookToolbarActions {
  readonly preview: (event: Event) => void;
  readonly print: () => void;
}

const unboundView: WorkbookView = {
  preview: false,
  disabled: true,
  preparing: false,
  status: 'Loading score controls…',
};

/** Shared native view; standalone renderers do not require shadow slots. */
export function workbookToolbarTemplate(
  view: WorkbookView,
  actions: WorkbookToolbarActions,
  options: WorkbookToolbarOptions = {},
  slotted = false,
): TemplateResult {
  const id = (name: string): string => `${options.idPrefix ?? ''}${name}`;
  const width = options.printWidth && Number.isFinite(options.printWidth) && options.printWidth > 0
    ? ` (${options.printWidth}px)` : '';
  const count = options.scoreCount && Number.isInteger(options.scoreCount) && options.scoreCount > 0
    ? `all ${options.scoreCount} scores` : 'all scores';
  const sourceLink = options.sourceHref
    ? html`<a class="source-link" part="link" href=${options.sourceHref}>Read the markup</a>` : nothing;

  return html`
    <div class="toolbar" part="controls" role="group" aria-label="Score display controls">
      <label><input id=${id('print-preview')} part="preview" type="checkbox"
        aria-describedby=${id('print-layout-help')} .checked=${view.preview}
        @change=${actions.preview} /> Use print layout on screen${width}</label>
      <button id=${id('print-scores')} part="print-button" type="button" aria-describedby=${id('print-dialog-help')}
        .disabled=${view.disabled} @click=${actions.print}>Open print dialog…</button>
      ${slotted ? html`<slot name="actions"></slot><slot name="links">${sourceLink}</slot>` : sourceLink}
    </div>
    <p id=${id('print-layout-help')} class="toolbar-help" part="help">The checkbox fixes score wrapping at the print width; it does not show paper pages. Short scores may look unchanged.${options.exampleHref
      ? html` Try the <a part="link" href=${options.exampleHref}>automatic ensemble</a> in a narrow window to see the difference.` : nothing}</p>
    <p id=${id('print-dialog-help')} class="toolbar-help" part="help">Printing includes ${count} and their explanations, without source snippets or text transcripts. It always uses the print layout, whether the checkbox is on or off. Choose paper and margins in your browser’s dialog, then Print or Save as PDF if offered. If no dialog opens here, use a browser with printing support.</p>
    <p id=${id('workbook-status')} class="workbook-status" part="status" role="status" aria-live="polite" aria-atomic="true">${view.status}</p>
  `;
}

let nextToolbarId = 0;

/**
 * Native workbook controls, labels, help, and status share one shadow root.
 * Optional caller-owned actions and links follow the preview and print controls
 * in that order. Direct slotted buttons/links receive default control styles;
 * nested content keeps its caller's styles, native semantics, and listeners.
 * State and print readiness live in WorkbookState; disconnect cancels printing.
 */
export class MusicWorkbookToolbar extends LitElement {
  static override styles = css`
    :host { display: block; min-width: 0; font: inherit; }
    :host([hidden]), [hidden], ::slotted([hidden]) { display: none !important; }
    *, *::before, *::after, ::slotted(*) { box-sizing: border-box; }
    button, input, ::slotted(button), ::slotted(input), ::slotted(select) { font: inherit; }
    button, input, ::slotted(button), ::slotted(input) { accent-color: var(--workbook-accent, #714a37); }
    a, ::slotted(a) { color: var(--workbook-accent, #714a37); text-underline-offset: 0.2em; }
    button:focus-visible, input:focus-visible, a:focus-visible, ::slotted(:focus-visible) {
      outline: 3px solid var(--workbook-focus, #96613e);
      outline-offset: 4px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 24px;
      margin-top: 24px;
      padding: 15px 0;
      border-block: 1px solid var(--workbook-border, #dedfd5);
      font-size: 0.9rem;
    }
    label { display: flex; align-items: center; gap: 9px; cursor: pointer; min-width: 0; }
    .toolbar input { width: 1.1rem; height: 1.1rem; margin: 0; flex-shrink: 0; }
    button, ::slotted(button) {
      color: var(--workbook-button-color, #fffefa);
      background: var(--workbook-button-background, #3e493e);
      border: 1px solid var(--workbook-button-background, #3e493e);
      padding: 7px 14px;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover, ::slotted(button:hover) { background: var(--workbook-button-hover, #293529); }
    button:disabled, ::slotted(button:disabled) { opacity: 0.65; cursor: wait; }
    slot { display: contents; }
    .source-link, ::slotted([slot="links"]) { margin-inline-start: auto; }
    ::slotted(*) { max-width: 100%; }
    .toolbar-help { margin: 10px 0 0; max-width: 90ch; color: var(--workbook-muted, #52564d); font-size: 0.85rem; }
    .workbook-status { margin: 12px 0 0; color: var(--workbook-muted, #52564d); font-size: 0.85rem; }
    @media (max-width: 600px) {
      .toolbar { gap: 12px 18px; }
      .source-link, ::slotted([slot="links"]) { margin-inline-start: 0; }
    }
    @media (forced-colors: active) {
      .toolbar { border-color: CanvasText; }
      button, ::slotted(button) { border-color: ButtonText; }
      button:focus-visible, input:focus-visible, a:focus-visible, ::slotted(:focus-visible) { outline-color: Highlight; }
    }
    @media print { :host { display: none !important; } }
  `;

  static properties = {
    model: { attribute: false, noAccessor: true },
    idPrefix: { attribute: 'id-prefix' },
    printWidth: { type: Number, attribute: 'print-width' },
    scoreCount: { type: Number, attribute: 'score-count' },
    sourceHref: { attribute: 'source-href' },
    exampleHref: { attribute: 'example-href' },
  };

  idPrefix = `workbook-${++nextToolbarId}-`;
  printWidth?: number;
  scoreCount?: number;
  sourceHref = '';
  exampleHref = '';

  private currentModel?: WorkbookState;
  private readonly signals = new SignalController(this, () => this.model?.view.get() ?? unboundView);
  private readonly actions: WorkbookToolbarActions = {
    preview: event => this.model?.setPreview((event.currentTarget as HTMLInputElement).checked),
    print: () => { void this.model?.requestPrint(); },
  };

  get model(): WorkbookState | undefined { return this.currentModel; }
  set model(value: WorkbookState | undefined) {
    if (value === this.currentModel) return;
    const previous = this.currentModel;
    previous?.cancelPendingPrint();
    this.currentModel = value;
    this.signals.refresh();
    this.requestUpdate('model', previous);
  }

  override disconnectedCallback(): void {
    this.model?.cancelPendingPrint();
    super.disconnectedCallback();
  }

  protected override render(): TemplateResult {
    return workbookToolbarTemplate(this.signals.value, this.actions, this, true);
  }
}

if (!customElements.get('music-workbook-toolbar')) customElements.define('music-workbook-toolbar', MusicWorkbookToolbar);

declare global {
  interface HTMLElementTagNameMap {
    'music-workbook-toolbar': MusicWorkbookToolbar;
  }
}
