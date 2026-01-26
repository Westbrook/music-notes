import { css } from 'lit';

// Shared styles for music notation components
export const musicStyles = css`
  :host {
    display: inline-block;
    font-family: 'Bravura', 'Noto Music', 'Segoe UI Symbol', serif;
    --staff-line-color: #333;
    --note-color: #000;
    --staff-spacing: 8px;
    --line-thickness: 1px;
  }

  /* Staff line styles */
  .staff-lines {
    position: relative;
    height: calc(var(--staff-spacing) * 4);
  }

  .staff-line {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--line-thickness);
    background: var(--staff-line-color);
  }

  /* Note head shapes */
  .note-head {
    display: inline-block;
    width: 12px;
    height: 10px;
    border: 2px solid var(--note-color);
    border-radius: 50%;
    transform: rotate(-20deg);
  }

  .note-head.filled {
    background: var(--note-color);
  }

  /* Note stem */
  .note-stem {
    position: absolute;
    width: 2px;
    height: 28px;
    background: var(--note-color);
    right: -2px;
    bottom: 6px;
  }

  .note-stem.down {
    left: -2px;
    right: auto;
    top: 6px;
    bottom: auto;
  }

  /* Flags for eighth and sixteenth notes */
  .note-flag {
    position: absolute;
    right: -8px;
    top: 0;
    font-size: 24px;
    line-height: 1;
  }

  /* Beams */
  .beam {
    background: var(--note-color);
    height: 4px;
  }

  /* Ledger lines */
  .ledger-line {
    position: absolute;
    width: 16px;
    height: var(--line-thickness);
    background: var(--staff-line-color);
    left: 50%;
    transform: translateX(-50%);
  }

  /* Rest symbols (using Unicode music symbols) */
  .rest-symbol {
    font-size: 24px;
    line-height: 1;
  }

  /* Time signature */
  .time-signature {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-weight: bold;
    font-size: 18px;
    line-height: 1.2;
  }

  /* Dynamics */
  .dynamics {
    font-style: italic;
    font-weight: bold;
    font-size: 14px;
  }

  /* Tempo marking */
  .tempo {
    font-size: 12px;
    font-weight: bold;
  }

  /* Bar lines */
  .bar-line {
    width: 2px;
    background: var(--staff-line-color);
    height: 100%;
  }

  .bar-line.double {
    border-left: 2px solid var(--staff-line-color);
    width: 4px;
    margin-left: 2px;
  }

  .bar-line.final {
    border-left: 2px solid var(--staff-line-color);
    width: 6px;
    background: var(--staff-line-color);
  }
`;

// Note pitch positions (in staff-spacing units from bottom line)
export const pitchPositions: Record<string, number> = {
  'C4': -1, 'D4': -0.5, 'E4': 0, 'F4': 0.5, 'G4': 1, 'A4': 1.5, 'B4': 2,
  'C5': 2.5, 'D5': 3, 'E5': 3.5, 'F5': 4, 'G5': 4.5, 'A5': 5, 'B5': 5.5,
  'C6': 6
};

// Duration values in beats (quarter note = 1)
export const durationValues: Record<string, number> = {
  'whole': 4,
  'half': 2,
  'quarter': 1,
  'eighth': 0.5,
  'sixteenth': 0.25
};

