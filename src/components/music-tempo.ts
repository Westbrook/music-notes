import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing a tempo marking.
 * 
 * @example
 * <music-tempo bpm="120" beat="quarter"></music-tempo>
 * <music-tempo marking="Allegro"></music-tempo>
 * <music-tempo marking="Andante" bpm="80" beat="quarter"></music-tempo>
 */
@customElement('music-tempo')
export class MusicTempo extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: bold;
      padding: 4px 0;
      --tempo-color: #000;
    }

    .tempo-container {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--tempo-color);
    }

    .marking {
      font-style: italic;
      font-size: 14px;
    }

    .metronome {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: monospace;
    }

    .note-symbol {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    /* Quarter note symbol */
    .note-quarter {
      display: inline-block;
      position: relative;
      width: 8px;
      height: 20px;
    }

    .note-quarter::before {
      content: '';
      position: absolute;
      bottom: 0;
      width: 8px;
      height: 6px;
      background: var(--tempo-color);
      border-radius: 50%;
      transform: rotate(-20deg);
    }

    .note-quarter::after {
      content: '';
      position: absolute;
      right: 0;
      bottom: 4px;
      width: 2px;
      height: 16px;
      background: var(--tempo-color);
    }

    /* Half note symbol */
    .note-half {
      display: inline-block;
      position: relative;
      width: 8px;
      height: 20px;
    }

    .note-half::before {
      content: '';
      position: absolute;
      bottom: 0;
      width: 8px;
      height: 6px;
      border: 2px solid var(--tempo-color);
      border-radius: 50%;
      transform: rotate(-20deg);
      box-sizing: border-box;
    }

    .note-half::after {
      content: '';
      position: absolute;
      right: 0;
      bottom: 4px;
      width: 2px;
      height: 16px;
      background: var(--tempo-color);
    }

    /* Dotted note */
    .dotted::after {
      content: '';
      position: absolute;
      right: -6px;
      bottom: 2px;
      width: 3px;
      height: 3px;
      background: var(--tempo-color);
      border-radius: 50%;
    }

    .equals {
      font-size: 14px;
    }

    .bpm {
      font-weight: bold;
      font-size: 14px;
    }
  `;

  /** Tempo marking text (e.g., "Allegro", "Andante", "Moderato") */
  @property({ type: String }) marking = '';

  /** Beats per minute */
  @property({ type: Number }) bpm = 0;

  /** The beat note value */
  @property({ type: String }) beat: 'quarter' | 'half' | 'dotted-quarter' | 'dotted-half' | 'eighth' = 'quarter';

  private get noteClass(): string {
    if (this.beat.includes('half')) return 'note-half';
    return 'note-quarter';
  }

  private get isDotted(): boolean {
    return this.beat.startsWith('dotted');
  }

  render() {
    return html`
      <div class="tempo-container">
        ${this.marking ? html`<span class="marking">${this.marking}</span>` : ''}
        ${this.bpm > 0 ? html`
          <span class="metronome">
            <span class="note-symbol">
              <span class="${this.noteClass} ${this.isDotted ? 'dotted' : ''}"></span>
            </span>
            <span class="equals">=</span>
            <span class="bpm">${this.bpm}</span>
          </span>
        ` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-tempo': MusicTempo;
  }
}

