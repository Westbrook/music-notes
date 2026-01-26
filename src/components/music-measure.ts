import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A custom element representing a musical measure (bar).
 * Contains notes and rests, and displays bar lines.
 * 
 * @example
 * <music-measure>
 *   <music-note pitch="E5" duration="quarter"></music-note>
 *   <music-note pitch="D5" duration="quarter"></music-note>
 *   <music-note pitch="C5" duration="half"></music-note>
 * </music-measure>
 */
@customElement('music-measure')
export class MusicMeasure extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      position: relative;
      padding: 0 8px;
      height: 72px;
      --bar-color: #333;
      --staff-color: #666;
    }

    .measure-content {
      display: flex;
      align-items: center;
      gap: 16px;
      position: relative;
      z-index: 1;
      padding: 0 8px;
      height: 100%;
    }

    .bar-line {
      width: 2px;
      height: 33px;
      background: var(--bar-color);
      flex-shrink: 0;
    }

    .bar-line.double {
      width: 2px;
      border-right: 4px solid var(--bar-color);
      margin-left: 2px;
    }

    .bar-line.final {
      width: 4px;
      border-left: 2px solid var(--bar-color);
      margin-left: 4px;
    }

    .bar-line.start-repeat {
      width: 4px;
      border-right: 2px solid var(--bar-color);
      margin-right: 4px;
      position: relative;
    }

    .bar-line.start-repeat::after {
      content: '••';
      position: absolute;
      right: -12px;
      font-size: 10px;
      display: flex;
      flex-direction: column;
      letter-spacing: -2px;
    }

    .bar-line.end-repeat {
      width: 4px;
      border-left: 2px solid var(--bar-color);
      margin-left: 4px;
      position: relative;
    }

    .bar-line.end-repeat::before {
      content: '••';
      position: absolute;
      left: -12px;
      font-size: 10px;
      display: flex;
      flex-direction: column;
      letter-spacing: -2px;
    }

    /* Staff lines behind the content */
    .staff-lines {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      height: 32px;
      pointer-events: none;
    }

    .staff-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--staff-color);
    }

    ::slotted(*) {
      position: relative;
      z-index: 2;
    }
  `;

  /** Type of ending bar line */
  @property({ type: String, attribute: 'end-bar' }) 
  endBar: 'single' | 'double' | 'final' | 'repeat' | 'none' = 'single';

  /** Type of starting bar line */
  @property({ type: String, attribute: 'start-bar' }) 
  startBar: 'none' | 'repeat' = 'none';

  /** Whether to show staff lines */
  @property({ type: Boolean, attribute: 'show-staff' }) 
  showStaff = false;

  render() {
    return html`
      ${this.showStaff ? html`
        <div class="staff-lines">
          <div class="staff-line" style="top: 0"></div>
          <div class="staff-line" style="top: 8px"></div>
          <div class="staff-line" style="top: 16px"></div>
          <div class="staff-line" style="top: 24px"></div>
          <div class="staff-line" style="top: 32px"></div>
        </div>
      ` : ''}
      
      ${this.startBar === 'repeat' ? html`<div class="bar-line start-repeat"></div>` : ''}
      
      <div class="measure-content">
        <slot></slot>
      </div>
      
      ${this.endBar !== 'none' ? html`
        <div class="bar-line ${this.endBar === 'double' ? 'double' : ''} ${this.endBar === 'final' ? 'final' : ''} ${this.endBar === 'repeat' ? 'end-repeat' : ''}"></div>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'music-measure': MusicMeasure;
  }
}

