import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * Reusable framing for caller-owned native surfaces. Header/body/footer stay in
 * light DOM; in particular the assigned body remains the scrolling element.
 * This component has no focus stops, input state, or popover/dialog behavior.
 */
export class AuthorPanelFrame extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      max-height: inherit;
      box-sizing: border-box;
    }
    :host([hidden]) { display: none !important; }
    slot { display: contents; }
    ::slotted([slot="header"]), ::slotted([slot="footer"]) { flex: none; }
    ::slotted([slot="body"]) { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
    ::slotted([slot="footer"]) { padding: 0 14px 12px; }
    @media (max-width: 760px) { ::slotted([slot="footer"]) { padding: 0 11px 12px; } }
    @media (max-height: 480px) { ::slotted([slot="footer"]) { padding-bottom: 7px; } }
  `;

  protected override render(): TemplateResult {
    return html`<slot name="header" part="header"></slot><slot name="body" part="body"></slot><slot name="footer" part="footer"></slot>`;
  }

  mount(): void { this.performUpdate(); }
}

if (!customElements.get('music-panel-frame')) customElements.define('music-panel-frame', AuthorPanelFrame);

declare global {
  interface HTMLElementTagNameMap { 'music-panel-frame': AuthorPanelFrame }
}
