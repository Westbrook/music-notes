import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing a musical rest.
 * 
 * @example
 * <music-rest duration="quarter"></music-rest>
 * <music-rest duration="half"></music-rest>
 */
@customElement('music-rest')
export class MusicRest extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 80px;
      --rest-color: #000;
    }

    .rest-symbol {
      font-size: 24px;
      line-height: 1;
      color: var(--rest-color);
    }

    /* Whole rest - rectangle hanging from line */
    .rest-whole {
      width: 12px;
      height: 6px;
      background: var(--rest-color);
      position: relative;
      top: -8px;
    }

    /* Half rest - rectangle sitting on line */
    .rest-half {
      width: 12px;
      height: 6px;
      background: var(--rest-color);
      position: relative;
      top: 2px;
    }

    /* Quarter rest - squiggly shape */
    .rest-quarter {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
    }

    .rest-quarter-part {
      width: 8px;
      height: 8px;
      border: 2px solid var(--rest-color);
      border-radius: 0 50% 50% 0;
      transform: rotate(45deg);
    }

    .rest-quarter-part:nth-child(2) {
      transform: rotate(-135deg);
      margin-top: -4px;
    }

    /* Eighth rest - flag with stem */
    .rest-eighth {
      position: relative;
      width: 10px;
      height: 20px;
    }

    .rest-eighth::before {
      content: '';
      position: absolute;
      width: 6px;
      height: 6px;
      background: var(--rest-color);
      border-radius: 50%;
      top: 0;
      left: 0;
    }

    .rest-eighth::after {
      content: '';
      position: absolute;
      width: 2px;
      height: 16px;
      background: var(--rest-color);
      top: 4px;
      left: 4px;
      transform: rotate(20deg);
    }

    /* Sixteenth rest - two flags with stem */
    .rest-sixteenth {
      position: relative;
      width: 10px;
      height: 24px;
    }

    .rest-sixteenth-dot {
      position: absolute;
      width: 5px;
      height: 5px;
      background: var(--rest-color);
      border-radius: 50%;
      left: 0;
    }

    .rest-sixteenth-dot:first-child {
      top: 0;
    }

    .rest-sixteenth-dot:nth-child(2) {
      top: 8px;
    }

    .rest-sixteenth-stem {
      position: absolute;
      width: 2px;
      height: 20px;
      background: var(--rest-color);
      top: 4px;
      left: 4px;
      transform: rotate(20deg);
    }
  `;

  /** The duration of the rest (whole, half, quarter, eighth, sixteenth) */
  @property({ type: String }) duration: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' = 'quarter';

  render() {
    switch (this.duration) {
      case 'whole':
        return html`<div class="rest-whole"></div>`;
      case 'half':
        return html`<div class="rest-half"></div>`;
      case 'quarter':
        return html`
          <div class="rest-quarter">
            <div class="rest-quarter-part"></div>
            <div class="rest-quarter-part"></div>
          </div>
        `;
      case 'eighth':
        return html`<div class="rest-eighth"></div>`;
      case 'sixteenth':
        return html`
          <div class="rest-sixteenth">
            <div class="rest-sixteenth-dot"></div>
            <div class="rest-sixteenth-dot"></div>
            <div class="rest-sixteenth-stem"></div>
          </div>
        `;
      default:
        return html`<div class="rest-quarter">?</div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-rest': MusicRest;
  }
}

