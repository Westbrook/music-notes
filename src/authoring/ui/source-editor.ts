import { phArrowCounterClockwise, phCheck } from '../../ui/icons/phosphor.js';
import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import { activeElement } from '../../ui/composed-dom.js';
import { SourceFeedback } from '../source-feedback.js';

export interface SourceEditorState {
  readonly documentId: string;
  readonly value: string;
  readonly status: string;
  readonly readOnly: boolean;
}

export interface SourceValueDetail { readonly value: string }
export type SourceChangeEvent = CustomEvent<SourceValueDetail>;
export type SourceApplyEvent = CustomEvent<SourceValueDetail>;
export type SourceRevertEvent = CustomEvent<void>;

/**
 * A local native Source draft with explicit change/apply/revert intents. The
 * caller validates and persists music; this view never reads a session/store.
 * Labels, descriptions, controls, and feedback share one shadow root. Its outer
 * light-DOM popover body remains the owner of scrolling and dismissal.
 */
export class MusicSourceEditor extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 9px;
      min-width: 0;
      min-height: 0;
      color: var(--ink, var(--author-control-ink, #303942));
      font: inherit;
    }
    :host([hidden]), [hidden] { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    p { margin: 0; }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    .field-help {
      color: var(--muted, var(--author-muted, #56616d));
      font-size: 0.73rem;
      font-weight: 400;
      line-height: 1.45;
    }
    textarea {
      flex: 1;
      width: 100%;
      min-width: 0;
      min-height: 150px;
      max-width: 100%;
      margin: 0;
      padding: 11px;
      border: 1px solid var(--author-divider, #c8cfd6);
      border-radius: 7px;
      background: var(--author-surface, #f7f8fa);
      color: var(--author-control-ink, #303942);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.82rem;
      line-height: 1.5;
      tab-size: 2;
      white-space: pre;
      overflow-wrap: normal;
      overflow-x: auto;
      resize: none;
    }
    #source-error {
      flex: none;
      min-width: 0;
      max-height: none;
      overflow: visible;
      padding: 8px 10px;
      border-inline-start: 2px solid var(--author-warning, #a86a4b);
      background: var(--author-warning-surface, #fff2df);
      color: var(--error, #7d3027);
      font-size: 0.77rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    #source-status { font-size: 0.71rem; }
    .source-actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; }
    button {
      min-width: 44px;
      min-height: var(--author-control-size, 44px);
      max-width: 100%;
      padding: 8px 13px;
      border: 1px solid var(--author-border, #798794);
      border-radius: 6px;
      background: var(--surface, var(--author-surface, #f7f8fa));
      color: var(--ink, var(--author-control-ink, #303942));
      font: inherit;
      font-size: 0.84rem;
      font-weight: 550;
      line-height: 1.35;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--accent-soft, #dce3ea); }
    button:disabled { color: var(--author-muted, #56616d); cursor: not-allowed; background: var(--author-surface, #f7f8fa); }
    .primary-button { border-color: var(--accent, #325a3d); background: var(--accent, #325a3d); color: #fff; }
    .primary-button:hover:not(:disabled) { border-color: var(--accent-hover, #24462d); background: var(--accent-hover, #24462d); }
    .primary-button:disabled { border-color: var(--author-divider, #aab4a7); background: var(--author-divider, #aab4a7); color: #fff; }
    button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
      outline: 3px solid var(--focus, var(--author-focus, #7037a0));
      outline-offset: 3px;
    }
    @media (max-width: 760px) { textarea { font-size: 0.84rem; } }
    @media (max-height: 480px) {
      :host { gap: 8px; }
      textarea { min-height: 90px; }
      .source-description { display: none; }
    }
    @media (forced-colors: active) {
      textarea, button { border-color: ButtonText; background: Canvas; color: CanvasText; }
      #source-error { border-color: CanvasText; background: Canvas; color: CanvasText; }
      button:disabled, .primary-button:disabled { border-color: GrayText; background: Canvas; color: GrayText; }
      .primary-button { border-color: Highlight; background: Canvas; color: ButtonText; }
      button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline-color: Highlight; }
    }
    @media print { :host { display: none !important; } }
  `;

  private view: Omit<SourceEditorState, 'value'> = { documentId: '', status: '', readOnly: true };
  private input!: HTMLTextAreaElement;
  private feedback?: SourceFeedback;

  /** Synchronous first mount for composition and detached document fixtures. */
  mount(): void { this.performUpdate(); }

  /**
   * Publish accepted metadata while preserving a focused local text edit. The
   * owner uses forceValue for explicit replacement/revert, including reopening
   * a persisted document whose ID happens to be unchanged.
   */
  renderState(state: SourceEditorState, options: { readonly forceValue?: boolean } = {}): void {
    const changed = state.status !== this.view.status || state.readOnly !== this.view.readOnly;
    this.view = { documentId: state.documentId, status: state.status, readOnly: state.readOnly };
    if (changed) this.requestUpdate();
    this.mount();
    const focused = this.isConnected && activeElement(this) === this.input;
    if ((options.forceValue || !focused) && this.input.value !== state.value) this.input.value = state.value;
    this.feedback!.refresh(state.documentId, this.input.value);
  }

  get inputValue(): string { this.mount(); return this.input.value; }
  get failureMessage(): string { return this.feedback?.message ?? ''; }

  focusInput(): void { this.mount(); this.input.focus({ preventScroll: true }); }

  fail(documentId: string, draft: string, message: string): void {
    this.mount();
    this.feedback!.fail(documentId, draft, message);
  }

  clearFailure(): void { this.mount(); this.feedback!.clear(); }
  refreshFailure(documentId: string, draft: string): void { this.mount(); this.feedback!.refresh(documentId, draft); }

  protected override firstUpdated(): void {
    this.input = this.renderRoot.querySelector<HTMLTextAreaElement>('#source-input')!;
    // Feedback owns only this empty alert's contents/visibility and aria-invalid.
    // These properties deliberately have no competing Lit bindings.
    this.feedback = new SourceFeedback(this.renderRoot as ShadowRoot);
  }

  private readonly changeSource = (): void => {
    if (this.view.readOnly) return;
    const value = this.input.value;
    this.feedback!.refresh(this.view.documentId, value);
    this.dispatchEvent(new CustomEvent<SourceValueDetail>('source-change', { detail: { value }, bubbles: true, composed: true }));
  };

  private readonly applySource = (): void => {
    if (this.view.readOnly) return;
    this.dispatchEvent(new CustomEvent<SourceValueDetail>('source-apply', { detail: { value: this.input.value }, bubbles: true, composed: true }));
  };

  private readonly revertSource = (): void => {
    if (this.view.readOnly) return;
    this.dispatchEvent(new CustomEvent<void>('source-revert', { bubbles: true, composed: true }));
  };

  protected override render(): TemplateResult {
    return html`
      <p class="field-help source-description" part="description">Source is staged until Apply. Invalid drafts stay available without replacing accepted music.</p>
      <label class="visually-hidden" for="source-input">Musical HTML source</label>
      <textarea id="source-input" name="source-input" part="input" rows="15" spellcheck="false"
        autocapitalize="off" autocomplete="off" aria-describedby="source-status source-error"
        .readOnly=${this.view.readOnly} @input=${this.changeSource}></textarea>
      <p id="source-error" class="source-error" part="error" role="alert" tabindex="-1" hidden></p>
      <p id="source-status" class="field-help" part="status" role="status">${this.view.status}</p>
      <div class="button-row source-actions" part="actions">
        <button id="source-apply" class="primary-button" part="apply" type="button" .disabled=${this.view.readOnly} @click=${this.applySource}>${buttonContent(phCheck, 'Apply source')}</button>
        <button id="source-revert" part="revert" type="button" .disabled=${this.view.readOnly} @click=${this.revertSource}>${buttonContent(phArrowCounterClockwise, 'Revert to accepted score')}</button>
      </div>
    `;
  }
}

if (!customElements.get('music-source-editor')) customElements.define('music-source-editor', MusicSourceEditor);

declare global {
  interface HTMLElementTagNameMap { 'music-source-editor': MusicSourceEditor }
  interface HTMLElementEventMap {
    'source-change': SourceChangeEvent;
    'source-apply': SourceApplyEvent;
    'source-revert': SourceRevertEvent;
  }
}
