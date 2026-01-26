import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing a musical staff.
 * Contains measures and displays the 5-line staff and clef.
 *
 * The staff uses an 8px line spacing, with 5 lines spanning 32px total.
 * Notes are positioned relative to the center of the staff (B4 in treble clef).
 *
 * @example
 * <music-staff clef="treble">
 *   <music-meter top="4" bottom="4"></music-meter>
 *   <music-measure>
 *     <music-note pitch="E5" duration="quarter"></music-note>
 *   </music-measure>
 * </music-staff>
 */
@customElement('music-staff')
export class MusicStaff extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      padding: 40px 20px 40px;
      min-height: 120px;
      --staff-color: #333;
      --line-spacing: 8px;
    }

    .staff-container {
      position: relative;
      display: flex;
      align-items: center;
      min-height: 72px;
    }

    /* Staff lines: 5 lines with 8px spacing = 32px total height */
    /* Centered vertically in the container */
    .staff-lines {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      height: calc(var(--line-spacing) * 4);
      pointer-events: none;
    }

    .staff-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--staff-color);
    }

    /* Line positions from top: F5, D5, B4 (center), G4, E4 */
    .staff-line:nth-child(1) { top: 0; }           /* F5 */
    .staff-line:nth-child(2) { top: 8px; }         /* D5 */
    .staff-line:nth-child(3) { top: 16px; }        /* B4 - center */
    .staff-line:nth-child(4) { top: 24px; }        /* G4 */
    .staff-line:nth-child(5) { top: 32px; }        /* E4 */

    .clef {
      font-size: 56px;
      line-height: 1;
      margin-right: 8px;
      position: relative;
      z-index: 2;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      height: 72px;
    }

    .clef-treble::before {
      content: '𝄞';
    }

    .clef-bass::before {
      content: '𝄢';
    }

    .clef-alto::before {
      content: '𝄡';
    }

    .clef-tenor::before {
      content: '𝄡';
    }

    .content {
      display: flex;
      align-items: center;
      position: relative;
      z-index: 2;
      flex-wrap: wrap;
      gap: 4px;
      height: 72px;
    }

    /* Title/tempo area above staff */
    .header {
      position: absolute;
      top: 0;
      left: 20px;
      display: flex;
      gap: 20px;
      align-items: center;
    }

    ::slotted(music-tempo) {
      position: relative;
      z-index: 3;
    }

    ::slotted(music-dynamics) {
      position: relative;
      z-index: 3;
    }
  `;

  /** The clef to display: treble, bass, alto, tenor */
  @property({ type: String }) clef: 'treble' | 'bass' | 'alto' | 'tenor' = 'treble';

  /** Whether to hide the clef */
  @property({ type: Boolean, attribute: 'hide-clef' }) hideClef = false;

  render() {
    return html`
      <div class="staff-container">
        <div class="staff-lines">
          <div class="staff-line"></div>
          <div class="staff-line"></div>
          <div class="staff-line"></div>
          <div class="staff-line"></div>
          <div class="staff-line"></div>
        </div>

        ${!this.hideClef ? html`<span class="clef clef-${this.clef}"></span>` : ''}

        <div class="content">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-staff': MusicStaff;
  }
}

