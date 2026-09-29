import { phBookOpen, phFiles, phMusicNotes, phNotePencil } from '../../ui/icons/phosphor.js';
import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import '../../ui/design-tokens.css';
import type { ViewMode } from '../types.js';

export interface ViewRequestDetail {
  readonly mode: ViewMode;
}

export type ViewRequestEvent = CustomEvent<ViewRequestDetail>;

/**
 * Displays an accepted workspace mode and requests transitions through events.
 * The owner applies the transition, including focus and editing side effects,
 * before publishing the resulting mode. Native buttons retain keyboard behavior.
 * Inherited UI tokens and the group/button parts provide visual customization.
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
      gap: var(--music-ui-group-gap);
      padding: var(--music-ui-group-padding);
      border-radius: var(--music-ui-group-radius);
      background: var(--music-ui-color-paper);
      box-shadow: inset 0 0 0 var(--music-ui-border-width) var(--music-ui-color-divider);
    }
    button {
      flex: none;
      min-width: var(--music-ui-control-size);
      min-height: var(--music-ui-control-size);
      max-width: 100%;
      padding: var(--music-ui-control-padding-block) var(--music-ui-control-padding-inline);
      border: var(--music-ui-border-width) solid transparent;
      border-radius: var(--music-ui-control-radius);
      background: transparent;
      color: var(--music-ui-color-ink);
      font: inherit;
      font-size: var(--music-ui-label-size);
      font-weight: var(--music-ui-control-weight);
      line-height: var(--music-ui-label-line-height);
      cursor: pointer;
    }
    button:hover {
      border-color: var(--music-ui-color-border);
      background: var(--music-ui-color-active);
    }
    button[aria-pressed='true'] {
      border-color: var(--music-ui-color-ink);
      background: var(--music-ui-color-active);
      color: var(--music-ui-color-ink);
    }
    button:focus-visible {
      outline: var(--music-ui-focus-width) solid var(--music-ui-color-focus);
      outline-offset: calc(-1 * var(--music-ui-focus-width));
    }
    @media (forced-colors: active) {
      nav {
        background: Canvas;
        box-shadow: none;
        outline: var(--music-ui-border-width) solid GrayText;
        outline-offset: calc(-1 * var(--music-ui-border-width));
      }
      button { color: ButtonText; }
      button:hover { border-color: ButtonText; }
      button[aria-pressed='true'] {
        border-color: Highlight;
        background: Canvas;
        color: ButtonText;
        outline: 2px solid Highlight;
        outline-offset: calc(-1 * var(--music-ui-focus-width));
      }
      button:focus-visible { outline: var(--music-ui-focus-width) dashed Highlight; }
    }
    @media print { :host { display: none !important; } }
  `;

  /** Accepted state supplied by the owner; clicks only emit requests. */
  mode: ViewMode = 'write';

  private readonly requestWrite = (): void => this.requestMode('write');
  private readonly requestRead = (): void => this.requestMode('read');
  private readonly requestListen = (): void => this.requestMode('listen');
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
        <button part="button" id="view-listen" type="button" aria-pressed=${this.mode === 'listen'} @click=${this.requestListen}>${buttonContent(phMusicNotes, 'Listen')}</button>
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
