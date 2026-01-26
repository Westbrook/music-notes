import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Pitch positions for treble clef (semitones from E4, which is the bottom line)
// Each step is half a line-spacing (4px by default)
const TREBLE_CLEF_POSITIONS: Record<string, number> = {
  'E3': -7, 'F3': -6, 'G3': -5, 'A3': -4, 'B3': -3,
  'C4': -2, 'D4': -1, 'E4': 0, 'F4': 1, 'G4': 2, 'A4': 3, 'B4': 4,
  'C5': 5, 'D5': 6, 'E5': 7, 'F5': 8, 'G5': 9, 'A5': 10, 'B5': 11,
  'C6': 12, 'D6': 13, 'E6': 14
};

/**
 * A custom element representing a musical note.
 * The note is positioned vertically based on its pitch relative to the staff.
 *
 * @example
 * <music-note pitch="E5" duration="quarter"></music-note>
 * <music-note pitch="D5" duration="half"></music-note>
 */
@customElement('music-note')
export class MusicNote extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      min-width: 20px;
      height: 72px;
      --note-color: #000;
      --line-spacing: 8px;
    }

    .note-container {
      position: absolute;
      display: inline-block;
    }

    .note-head {
      display: block;
      width: 12px;
      height: 9px;
      border: 2px solid var(--note-color);
      border-radius: 50%;
      transform: rotate(-20deg);
      box-sizing: border-box;
    }

    .note-head.filled {
      background: var(--note-color);
    }

    .note-stem {
      position: absolute;
      width: 2px;
      height: 28px;
      background: var(--note-color);
    }

    .note-stem.up {
      right: -1px;
      bottom: 4px;
    }

    .note-stem.down {
      left: -1px;
      top: 4px;
    }

    .note-flags {
      position: absolute;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .note-flags.up {
      right: -1px;
      top: -28px;
    }

    .note-flags.down {
      left: -1px;
      bottom: -28px;
      transform: scaleY(-1);
    }

    .flag-beam {
      width: 8px;
      height: 3px;
      background: var(--note-color);
      transform: skewY(15deg);
    }

    .dot {
      position: absolute;
      right: -10px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--note-color);
    }

    .accidental {
      position: absolute;
      left: -14px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
      font-weight: bold;
      line-height: 1;
    }

    .ledger-line {
      position: absolute;
      width: 18px;
      height: 1px;
      background: var(--note-color);
      /* Center on the note head (12px wide) */
      left: 6px;
      transform: translateX(-50%);
    }
  `;

  /** The pitch of the note (e.g., "C4", "E5", "G#4") */
  @property({ type: String }) pitch = 'C4';

  /** The duration of the note (whole, half, quarter, eighth, sixteenth) */
  @property({ type: String }) duration: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' = 'quarter';

  /** Whether the note is dotted */
  @property({ type: Boolean }) dotted = false;

  /** Accidental: sharp, flat, or natural */
  @property({ type: String }) accidental: 'sharp' | 'flat' | 'natural' | '' = '';

  /** Whether this note is part of a beam group (hides flags) */
  @property({ type: Boolean, reflect: true }) beamed = false;

  /** Force stem direction down */
  @property({ type: Boolean, reflect: true, attribute: 'stem-down' }) stemDown = false;

  private get isFilled(): boolean {
    return this.duration !== 'whole' && this.duration !== 'half';
  }

  private get hasStem(): boolean {
    return this.duration !== 'whole';
  }

  private get flagCount(): number {
    if (this.duration === 'eighth') return 1;
    if (this.duration === 'sixteenth') return 2;
    return 0;
  }

  private get accidentalSymbol(): string {
    switch (this.accidental) {
      case 'sharp': return '♯';
      case 'flat': return '♭';
      case 'natural': return '♮';
      default: return '';
    }
  }

  /** Get the base pitch without accidentals */
  private get basePitch(): string {
    // Remove sharp/flat from pitch string (e.g., "G#4" -> "G4")
    return this.pitch.replace(/[#b]/, '');
  }

  /** Get vertical position in pixels (positive = up from center) */
  private get pitchOffset(): number {
    const position = TREBLE_CLEF_POSITIONS[this.basePitch] ?? 0;
    // E4 is position 0 (bottom line of staff)
    // Staff center is at B4 (position 4), so offset from center
    // Each position step is half a line-spacing (4px)
    const centerPosition = 4; // B4 is the middle line
    return (position - centerPosition) * 4;
  }

  /** Determine if stem should go up or down based on pitch or stemDown property */
  private get stemDirection(): 'up' | 'down' {
    // If stemDown is explicitly set, use that
    if (this.stemDown) return 'down';

    const position = TREBLE_CLEF_POSITIONS[this.basePitch] ?? 0;
    // Notes on or above B4 (middle line) have stems down
    return position >= 4 ? 'down' : 'up';
  }

  /** Whether to show flags (hidden when beamed) */
  private get showFlags(): boolean {
    return this.flagCount > 0 && !this.beamed;
  }

  /** Get ledger lines needed for notes outside the staff */
  private get ledgerLines(): number[] {
    const position = TREBLE_CLEF_POSITIONS[this.basePitch] ?? 0;
    const lines: number[] = [];

    // Below staff: E4 is position 0 (bottom line)
    // C4 at position -2 needs a ledger line at position -2
    // D4 at position -1 is in a space, no ledger line needed
    // Notes at -2 or below need ledger lines at even positions
    if (position <= -2) {
      for (let p = -2; p >= position; p -= 2) {
        lines.push(p);
      }
    }

    // Above staff: F5 is position 8 (top line)
    // G5 at position 9 is in a space above, no ledger line
    // A5 at position 10 needs a ledger line at position 10
    if (position >= 10) {
      for (let p = 10; p <= position; p += 2) {
        lines.push(p);
      }
    }

    return lines;
  }

  /** Get the pixel position for a ledger line */
  private getLedgerLineOffset(linePosition: number): number {
    // Convert position to pixels relative to note head center
    const centerPosition = 4; // B4
    return (linePosition - centerPosition) * 4;
  }

  render() {
    const offset = this.pitchOffset;
    const stemDir = this.stemDirection;

    return html`
      <div class="note-container" style="transform: translateY(${-offset}px)">
        ${this.ledgerLines.map(linePos => {
          const lineOffset = this.getLedgerLineOffset(linePos);
          // Position relative to note head (which is at center of container)
          const topOffset = -lineOffset + offset;
          return html`<div class="ledger-line" style="top: calc(50% + ${topOffset}px - 4px)"></div>`;
        })}
        ${this.accidental ? html`<span class="accidental">${this.accidentalSymbol}</span>` : ''}
        <span class="note-head ${this.isFilled ? 'filled' : ''}"></span>
        ${this.hasStem ? html`<span class="note-stem ${stemDir}"></span>` : ''}
        ${this.showFlags ? html`
          <div class="note-flags ${stemDir}">
            ${Array(this.flagCount).fill(0).map(() => html`<div class="flag-beam"></div>`)}
          </div>
        ` : ''}
        ${this.dotted ? html`<span class="dot"></span>` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-note': MusicNote;
  }
}

