import { css, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { iconGraphic } from './icon-graphics.js';
import type { IconDefinition } from './icon-definition.js';

export type { IconDefinition } from './icon-definition.js';

/** Decorative synchronous SVG. Its native control owns the accessible name. */
export class MusicIcon extends LitElement {
  static override properties = { icon: { attribute: false } };

  static override styles = css`
    :host {
      display: inline-block;
      width: var(--music-icon-size, 1.25rem);
      height: var(--music-icon-size, 1.25rem);
      flex: none;
      line-height: 0;
      vertical-align: -0.15em;
      color: inherit;
      pointer-events: none;
    }
    :host([hidden]) { display: none !important; }
    svg { display: block; width: 100%; height: 100%; }
  `;

  icon?: IconDefinition;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-hidden', 'true');
  }

  protected override render(): TemplateResult { return iconGraphic(this.icon); }
}

if (!customElements.get('music-icon')) customElements.define('music-icon', MusicIcon);

declare global {
  interface HTMLElementTagNameMap { 'music-icon': MusicIcon }
}
