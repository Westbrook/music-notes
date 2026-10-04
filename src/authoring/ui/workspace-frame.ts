import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import type { ViewMode } from '../types.js';

export type ToolsPresentation = 'closed' | 'side' | 'sheet';

/**
 * Layout around complete caller-owned native regions. The host is the grid;
 * slots add no layout or scrolling boxes and never move or clone their content.
 * Width measurements and the existing score/pane scroll owners stay public.
 */
export class AuthorWorkspaceFrame extends LitElement {
  static override properties = {
    mode: { reflect: true },
    toolsPresentation: { attribute: 'tools-presentation', reflect: true },
  };

  mode: ViewMode = 'write';
  toolsPresentation: ToolsPresentation = 'closed';

  static override styles = css`
    :host {
      box-sizing: border-box;
      display: grid;
      position: relative;
      container: author-workbench / inline-size;
      flex: 1;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: "score" "dock";
      gap: 0;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      --tools-pane-width: 320px;
      --writing-frame-gap: 16px;
    }
    :host([hidden]), :host([mode="pages"]) { display: none !important; }
    slot { display: contents; }
    ::slotted([slot="score"]) {
      grid-area: score;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      justify-self: start;
      align-self: stretch;
      width: var(--writing-frame-width, min(960px, 100%));
      max-width: none;
      min-width: 0;
      min-height: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--author-divider, #c8cfd6);
      border-radius: 4px 4px 0 0;
      background: var(--author-paper, #fff);
      color: var(--author-ink, #20252b);
      box-shadow: none;
    }
    ::slotted([slot="score"]:focus-visible) { outline-offset: -3px; }
    ::slotted([slot="tools"]) { grid-area: score; justify-self: start; z-index: 1; }
    ::slotted([slot="palette"]), ::slotted([slot="listen"]), ::slotted([slot="read"]) { grid-area: dock; }
    /* The sheet hides its same-width paper without changing engraving width. */
    :host([tools-presentation="sheet"]) ::slotted([slot="score"]) { visibility: hidden; pointer-events: none; }
    :host([tools-presentation="side"]) ::slotted([slot="tools"]) {
      width: var(--tools-pane-width);
      margin-inline-start: calc(var(--writing-frame-width) + var(--writing-frame-gap));
    }
    :host([tools-presentation="sheet"]) ::slotted([slot="tools"]) { width: 100%; margin-inline-start: 0; }
    :host([tools-presentation="closed"]) ::slotted([slot="tools"]) { display: none !important; }
    :host([mode="listen"]) ::slotted([slot="score"]) { width: min(960px, 100%); }
    :host(:not([mode="write"])) ::slotted([slot="tools"]),
    :host(:not([mode="write"])) ::slotted([slot="palette"]) { display: none !important; }
    :host(:not([mode="listen"])) ::slotted([slot="listen"]) { display: none !important; }
    :host(:not([mode="read"])) ::slotted([slot="read"]) { display: none !important; }
    @media (forced-colors: active) {
      ::slotted([slot="score"]) { border-color: CanvasText; }
    }
    @media print { :host { display: none !important; } }
  `;

  protected override render(): TemplateResult {
    return html`<slot name="score"></slot><slot name="tools"></slot><slot name="palette"></slot><slot name="listen"></slot><slot name="read"></slot>`;
  }

  /** Commit initial slots before controller and fixture binding. */
  mount(): void { this.performUpdate(); }
}

if (!customElements.get('music-workspace-frame')) customElements.define('music-workspace-frame', AuthorWorkspaceFrame);

declare global {
  interface HTMLElementTagNameMap { 'music-workspace-frame': AuthorWorkspaceFrame }
}
