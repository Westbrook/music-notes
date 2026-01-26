import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing a time signature (meter).
 * 
 * @example
 * <music-meter top="4" bottom="4"></music-meter>
 * <music-meter top="3" bottom="4"></music-meter>
 * <music-meter symbol="common"></music-meter>
 */
@customElement('music-meter')
export class MusicMeter extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      --meter-color: #000;
    }

    .time-signature {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 20px;
      line-height: 1;
      color: var(--meter-color);
      font-family: 'Times New Roman', serif;
    }

    .time-signature span {
      display: block;
    }

    .symbol {
      font-size: 28px;
      font-weight: normal;
    }

    /* Common time (C) */
    .common::before {
      content: 'C';
      font-size: 28px;
    }

    /* Cut time (C with line) */
    .cut {
      position: relative;
    }

    .cut::before {
      content: 'C';
      font-size: 28px;
    }

    .cut::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--meter-color);
      transform: translateX(-50%);
    }
  `;

  /** The top number of the time signature (beats per measure) */
  @property({ type: Number }) top = 4;

  /** The bottom number of the time signature (note value for one beat) */
  @property({ type: Number }) bottom = 4;

  /** Special symbol: 'common' for 4/4, 'cut' for 2/2 */
  @property({ type: String }) symbol: 'common' | 'cut' | '' = '';

  render() {
    if (this.symbol === 'common') {
      return html`<div class="time-signature"><span class="symbol common"></span></div>`;
    }
    
    if (this.symbol === 'cut') {
      return html`<div class="time-signature"><span class="symbol cut"></span></div>`;
    }

    return html`
      <div class="time-signature">
        <span>${this.top}</span>
        <span>${this.bottom}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-meter': MusicMeter;
  }
}

