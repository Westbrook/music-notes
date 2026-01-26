import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing dynamic markings.
 * 
 * @example
 * <music-dynamics level="mf"></music-dynamics>
 * <music-dynamics level="p"></music-dynamics>
 * <music-dynamics type="crescendo"></music-dynamics>
 */
@customElement('music-dynamics')
export class MusicDynamics extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      --dynamics-color: #000;
    }

    .dynamics-text {
      font-family: 'Times New Roman', Georgia, serif;
      font-style: italic;
      font-weight: bold;
      font-size: 16px;
      color: var(--dynamics-color);
    }

    /* Crescendo/decrescendo hairpins */
    .hairpin {
      display: inline-block;
      width: var(--hairpin-width, 40px);
      height: 12px;
      position: relative;
    }

    .crescendo::before,
    .crescendo::after {
      content: '';
      position: absolute;
      left: 0;
      width: 100%;
      height: 1px;
      background: var(--dynamics-color);
      transform-origin: left center;
    }

    .crescendo::before {
      top: 0;
      transform: rotate(8deg);
    }

    .crescendo::after {
      bottom: 0;
      transform: rotate(-8deg);
    }

    .decrescendo::before,
    .decrescendo::after {
      content: '';
      position: absolute;
      right: 0;
      width: 100%;
      height: 1px;
      background: var(--dynamics-color);
      transform-origin: right center;
    }

    .decrescendo::before {
      top: 0;
      transform: rotate(-8deg);
    }

    .decrescendo::after {
      bottom: 0;
      transform: rotate(8deg);
    }

    /* Special markings */
    .sfz, .sfp, .fp, .rf, .rfz {
      font-weight: bold;
    }

    .accent {
      font-size: 20px;
    }
  `;

  /** Dynamic level: ppp, pp, p, mp, mf, f, ff, fff */
  @property({ type: String }) level: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | '' = '';

  /** Dynamic type for hairpins: crescendo, decrescendo */
  @property({ type: String }) type: 'crescendo' | 'decrescendo' | '' = '';

  /** Special dynamic markings: sfz, sfp, fp, rf, rfz */
  @property({ type: String }) special: 'sfz' | 'sfp' | 'fp' | 'rf' | 'rfz' | 'accent' | '' = '';

  /** Width of hairpin in pixels (for crescendo/decrescendo) */
  @property({ type: Number }) width = 40;

  render() {
    if (this.type) {
      return html`
        <div 
          class="hairpin ${this.type}" 
          style="--hairpin-width: ${this.width}px"
        ></div>
      `;
    }

    if (this.special) {
      if (this.special === 'accent') {
        return html`<span class="dynamics-text accent">></span>`;
      }
      return html`<span class="dynamics-text ${this.special}">${this.special}</span>`;
    }

    if (this.level) {
      return html`<span class="dynamics-text">${this.level}</span>`;
    }

    return html`<span class="dynamics-text"><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-dynamics': MusicDynamics;
  }
}

