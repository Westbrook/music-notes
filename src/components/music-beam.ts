import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Pitch positions for treble clef (same as music-note)
const TREBLE_CLEF_POSITIONS: Record<string, number> = {
  'E3': -7, 'F3': -6, 'G3': -5, 'A3': -4, 'B3': -3,
  'C4': -2, 'D4': -1, 'E4': 0, 'F4': 1, 'G4': 2, 'A4': 3, 'B4': 4,
  'C5': 5, 'D5': 6, 'E5': 7, 'F5': 8, 'G5': 9, 'A5': 10, 'B5': 11,
  'C6': 12, 'D6': 13, 'E6': 14
};

/**
 * A custom element that groups notes together with beams.
 * Beams connect eighth notes and smaller values.
 *
 * Uses CSS custom properties set once from stem positions, then pure CSS
 * for positioning. This minimizes JS calculations compared to using
 * getBoundingClientRect on every render.
 *
 * @example
 * <music-beam>
 *   <music-note pitch="G4" duration="eighth"></music-note>
 *   <music-note pitch="G4" duration="eighth"></music-note>
 *   <music-note pitch="G4" duration="eighth"></music-note>
 *   <music-note pitch="G4" duration="eighth"></music-note>
 * </music-beam>
 */
@customElement('music-beam')
export class MusicBeam extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      height: 72px;
      --note-color: #000;
      --beam-thickness: 4px;
    }

    .beam-container {
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;
      height: 100%;
    }

    /*
     * Beam line positioned using CSS custom properties.
     * --beam-left, --beam-width, --beam-top are set by JS once during setup.
     */
    .beam-line {
      position: absolute;
      height: var(--beam-thickness);
      background: var(--note-color);
      z-index: 10;
      pointer-events: none;
      left: var(--beam-left, 0);
      width: var(--beam-width, 50px);
      top: var(--beam-top, 50%);
    }

    /* Hide flags on beamed notes - they get beams instead */
    ::slotted(music-note) {
      --hide-flags: 1;
    }
  `;

  /** Number of beams (1 for eighth notes, 2 for sixteenth) */
  @property({ type: Number }) beams = 1;

  /** Force stem direction: up, down, or auto */
  @property({ type: String, attribute: 'stem-direction' })
  stemDirection: 'up' | 'down' | 'auto' = 'auto';

  @state() private stemDir: 'up' | 'down' = 'up';
  @state() private isReady = false;

  // Cached beam position values (set once)
  private beamLeft = 0;
  private beamWidth = 50;
  private beamTop = 36;

  firstUpdated() {
    // First frame: set up notes (stem direction, beamed attribute)
    requestAnimationFrame(() => {
      this.setupNotes();
      // Second frame: wait for notes to re-render with new stem direction
      requestAnimationFrame(() => {
        this.calculateBeamPosition();
        this.isReady = true;
      });
    });
  }

  private handleSlotChange() {
    this.setupNotes();
    // Wait two frames for notes to re-render with new attributes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.calculateBeamPosition();
        this.requestUpdate();
      });
    });
  }

  private get notes(): HTMLElement[] {
    const slot = this.shadowRoot?.querySelector('slot');
    if (!slot) return [];
    return slot.assignedElements().filter(
      (el): el is HTMLElement => el.tagName.toLowerCase() === 'music-note'
    );
  }

  private setupNotes() {
    const notes = this.notes;
    if (notes.length < 2) return;

    // Get pitch positions to determine stem direction
    const positions = notes.map(note => {
      const pitch = note.getAttribute('pitch') || 'C4';
      const basePitch = pitch.replace(/[#b]/, '');
      return TREBLE_CLEF_POSITIONS[basePitch] ?? 0;
    });

    // Determine stem direction based on average pitch
    const avgPosition = positions.reduce((a, b) => a + b, 0) / positions.length;
    this.stemDir = this.stemDirection === 'auto'
      ? (avgPosition >= 4 ? 'down' : 'up')
      : this.stemDirection;

    // Set stem direction and beamed attribute on all notes
    notes.forEach(note => {
      if (this.stemDir === 'down') {
        note.setAttribute('stem-down', '');
      } else {
        note.removeAttribute('stem-down');
      }
      note.setAttribute('beamed', '');
    });
  }

  /**
   * Calculate beam position once from stem elements.
   * This is the only JS calculation needed - after this, CSS takes over.
   *
   * For notes at different pitches, the beam connects at the extremes:
   * - Stems up: beam at the highest (minimum Y) stem top
   * - Stems down: beam at the lowest (maximum Y) stem bottom
   */
  private calculateBeamPosition() {
    const notes = this.notes;
    if (notes.length < 2) return;

    // Get all stem elements
    const stems: Element[] = [];
    for (const note of notes) {
      const stem = note.shadowRoot?.querySelector('.note-stem');
      if (stem) stems.push(stem);
    }
    if (stems.length < 2) return;

    const containerRect = this.getBoundingClientRect();
    const beamContainerEl = this.shadowRoot?.querySelector('.beam-container');
    const beamContainerRect = beamContainerEl?.getBoundingClientRect() ?? containerRect;

    const stemRects = stems.map(s => s.getBoundingClientRect());

    const firstRect = stemRects[0];
    const lastRect = stemRects[stemRects.length - 1];

    // Calculate horizontal position (from first to last stem center)
    this.beamLeft = firstRect.left - beamContainerRect.left + firstRect.width / 2;
    this.beamWidth = (lastRect.left + lastRect.width / 2) - (firstRect.left + firstRect.width / 2);

    // Calculate vertical position based on stem direction
    // For stems up: find the highest stem top (minimum Y value)
    // For stems down: find the lowest stem bottom (maximum Y value)
    if (this.stemDir === 'up') {
      const minTop = Math.min(...stemRects.map(r => r.top));
      this.beamTop = minTop - beamContainerRect.top;
    } else {
      const maxBottom = Math.max(...stemRects.map(r => r.bottom));
      this.beamTop = maxBottom - beamContainerRect.top - 4; // 4px beam thickness
    }

    // Debug logging
    console.log('Beam calculation:', {
      stemDir: this.stemDir,
      beamContainerRect: { top: beamContainerRect.top, bottom: beamContainerRect.bottom, height: beamContainerRect.height },
      stemRects: stemRects.map(r => ({ top: r.top, bottom: r.bottom, left: r.left })),
      beamTop: this.beamTop,
      beamLeft: this.beamLeft,
      beamWidth: this.beamWidth
    });
  }

  render() {
    if (!this.isReady || this.notes.length < 2) {
      return html`
        <div class="beam-container">
          <slot @slotchange=${this.handleSlotChange}></slot>
        </div>
      `;
    }

    const beamThickness = 4;
    const beamGap = 2;

    // Create beam lines using cached CSS custom property values
    const beamLines = [];
    for (let i = 0; i < this.beams; i++) {
      const offset = this.stemDir === 'up'
        ? i * (beamThickness + beamGap)
        : -i * (beamThickness + beamGap);

      beamLines.push(html`
        <div
          class="beam-line"
          style="
            --beam-left: ${this.beamLeft}px;
            --beam-width: ${this.beamWidth}px;
            --beam-top: ${this.beamTop + offset}px;
          "
        ></div>
      `);
    }

    return html`
      <div class="beam-container">
        <slot @slotchange=${this.handleSlotChange}></slot>
        ${beamLines}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-beam': MusicBeam;
  }
}
