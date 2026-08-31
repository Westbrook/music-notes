import { phBookOpen, phFiles, phNotePencil } from '../../ui/icons/phosphor.js';
import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import type { ViewMode } from '../types.js';

export interface ViewRequestDetail {
  readonly mode: ViewMode;
}

export type ViewRequestEvent = CustomEvent<ViewRequestDetail>;

/**
 * Displays an accepted workspace mode and requests transitions through events.
 * The owner applies the transition, including focus and editing side effects,
 * before publishing the resulting mode. Native buttons retain keyboard behavior.
 * Inherited Author tokens and the group/button parts provide visual customization.
 */
export class AuthorViewSwitch extends LitElement {
  static override properties = { mode: { attribute: false } };

  static override styles = css`
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      font: inherit;
    }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    nav {
      display: inline-flex;
      align-items: center;
      padding: 0;
      border: 1px solid var(--author-divider, #c8cfd6);
      border-radius: 8px;
      background: var(--accent-soft, #dce3ea);
    }
    button {
      min-width: 60px;
      min-height: var(--author-control-size, max(44px, 2.75rem));
      max-width: 100%;
      padding: 3px 11px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--author-muted, #56616d);
      font: inherit;
      font-size: 0.77rem;
      font-weight: 550;
      line-height: 1.35;
      cursor: pointer;
    }
    button:hover {
      border-color: var(--author-border, #798794);
      background: var(--accent-soft, #dce3ea);
    }
    button[aria-pressed='true'] {
      border-color: var(--author-divider, #c8cfd6);
      background: var(--author-surface, #f7f8fa);
      color: var(--author-control-ink, #303942);
      box-shadow: 0 1px 2px #27362410;
    }
    button:focus-visible {
      outline: 3px solid var(--author-focus, #7037a0);
      outline-offset: 3px;
    }
    @media (max-width: 1099px) {
      button { min-width: 54px; padding-inline: 8px; }
    }
    @media (forced-colors: active) {
      nav { border-color: GrayText; background: Canvas; }
      button { color: ButtonText; }
      button:hover { border-color: ButtonText; }
      button[aria-pressed='true'] {
        border-color: Highlight;
        background: Canvas;
        color: ButtonText;
        box-shadow: none;
        outline: 2px solid Highlight;
        outline-offset: -3px;
      }
      button:focus-visible { outline: 3px solid Highlight; outline-offset: 3px; }
    }
    @media print { :host { display: none !important; } }
  `;

  /** Accepted state supplied by the owner; clicks only emit requests. */
  mode: ViewMode = 'write';

  private readonly requestWrite = (): void => this.requestMode('write');
  private readonly requestRead = (): void => this.requestMode('read');
  private readonly requestPages = (): void => this.requestMode('pages');

  private requestMode(mode: ViewMode): void {
    this.dispatchEvent(new CustomEvent<ViewRequestDetail>('view-request', {
      detail: { mode },
      bubbles: true,
      composed: true,
    }));
  }

  protected override render(): TemplateResult {
    return html`
      <nav part="group" aria-label="Workspace view">
        <button part="button" id="view-write" type="button" aria-pressed=${this.mode === 'write'} @click=${this.requestWrite}>${buttonContent(phNotePencil, 'Write')}</button>
        <button part="button" id="view-read" type="button" aria-pressed=${this.mode === 'read'} @click=${this.requestRead}>${buttonContent(phBookOpen, 'Read')}</button>
        <button part="button" id="view-pages" type="button" aria-pressed=${this.mode === 'pages'} @click=${this.requestPages}>${buttonContent(phFiles, 'Pages')}</button>
      </nav>
    `;
  }

  /** Synchronous first mount for composition and detached document fixtures. */
  mount(): void { this.performUpdate(); }
}

if (!customElements.get('music-view-switch')) customElements.define('music-view-switch', AuthorViewSwitch);

declare global {
  interface HTMLElementTagNameMap { 'music-view-switch': AuthorViewSwitch }
  interface HTMLElementEventMap { 'view-request': ViewRequestEvent }
}
