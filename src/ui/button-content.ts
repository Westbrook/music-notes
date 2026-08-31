import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { iconGraphic } from './icon-graphics.js';
import type { IconDefinition } from './icon-definition.js';

export type { IconDefinition } from './icon-definition.js';
export type ButtonLayout = 'stacked' | 'inline' | 'icon-only';

/** Icon and label presentation inside a caller-owned native button or link. */
export class MusicButtonContent extends LitElement {
  static override properties = {
    icon: { attribute: false },
    layout: { type: String, reflect: true },
  };

  static override styles = css`
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--music-button-gap, 2px);
      max-width: 100%;
      min-width: 0;
      vertical-align: middle;
      font: inherit;
      color: inherit;
      pointer-events: none;
    }
    :host([hidden]) { display: none !important; }
    svg {
      display: block;
      width: var(--music-icon-size, 1.25rem);
      height: var(--music-icon-size, 1.25rem);
      flex: none;
    }
    .label {
      min-width: 0;
      max-width: 100%;
      font-size: var(--music-button-label-size, 0.72rem);
      line-height: 1.15;
      text-align: inherit;
    }
    :host([layout='inline']) {
      flex-direction: row;
      gap: var(--music-button-inline-gap, 0.4em);
    }
    :host([layout='icon-only']) .label {
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
  `;

  icon?: IconDefinition;
  layout: ButtonLayout = 'stacked';

  protected override render(): TemplateResult {
    return html`${iconGraphic(this.icon)}<span class="label" part="label"><slot></slot></span>`;
  }
}

if (!customElements.get('music-button-content')) customElements.define('music-button-content', MusicButtonContent);

/** Labels stay in light DOM, including explicitly unbound controller mounts. */
export function buttonContent(
  icon: IconDefinition,
  label: string | TemplateResult,
  options: { readonly layout?: ButtonLayout } = {},
): TemplateResult {
  return html`<music-button-content .icon=${icon} layout=${options.layout ?? 'stacked'}>${label}</music-button-content>`;
}

declare global {
  interface HTMLElementTagNameMap { 'music-button-content': MusicButtonContent }
}
