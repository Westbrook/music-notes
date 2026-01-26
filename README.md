# Music Notes - Web Component Library

A music notation system built with Lit web components that can be used directly in HTML pages.

## Overview

This library provides custom HTML elements for rendering musical notation, including notes, rests, measures, time signatures, tempo markings, dynamics, and beamed note groups.

## Installation

```bash
npm install
npm run dev
```

## Usage

Include the components in your HTML and use them declaratively:

```html
<script type="module" src="/src/components/index.ts"></script>

<music-staff clef="treble">
  <music-meter top="4" bottom="4"></music-meter>
  
  <music-measure>
    <music-note pitch="B4" duration="quarter"></music-note>
    <music-note pitch="A4" duration="quarter"></music-note>
    <music-note pitch="G4" duration="half"></music-note>
  </music-measure>
  
  <music-measure>
    <music-beam>
      <music-note pitch="G4" duration="eighth"></music-note>
      <music-note pitch="G4" duration="eighth"></music-note>
      <music-note pitch="A4" duration="eighth"></music-note>
      <music-note pitch="A4" duration="eighth"></music-note>
    </music-beam>
  </music-measure>
</music-staff>
```

## Components

### `<music-staff>`
Container for staff lines and measures. Renders 5 staff lines with treble clef.

### `<music-measure>`
Contains notes/rests with bar lines.
- `end-bar`: Set to "final" for double bar line at end

### `<music-note>`
Renders a musical note positioned on the staff based on pitch.
- `pitch`: Note pitch (e.g., "C4", "E5", "G#4", "Bb3")
- `duration`: "whole" | "half" | "quarter" | "eighth" | "sixteenth"
- `dotted`: Boolean for dotted notes
- `accidental`: "sharp" | "flat" | "natural"
- `beamed`: Boolean (set automatically by music-beam)
- `stem-down`: Boolean to force stem direction

### `<music-beam>`
Groups notes together with connecting beams.
- `beams`: Number of beams (1 for eighth, 2 for sixteenth)
- `stem-direction`: "up" | "down" | "auto"

### `<music-rest>`
Renders a rest symbol.
- `duration`: "whole" | "half" | "quarter" | "eighth"

### `<music-meter>`
Time signature display.
- `top`: Upper number (beats per measure)
- `bottom`: Lower number (beat unit)

### `<music-tempo>`
Tempo marking display.
- `marking`: Text marking (e.g., "Moderato", "Allegro")
- `bpm`: Beats per minute
- `beat`: Beat unit ("quarter", "half", etc.)

### `<music-dynamics>`
Dynamic level marking.
- `level`: "pp" | "p" | "mp" | "mf" | "f" | "ff"

## Pitch System

Notes are positioned on a treble clef staff:
- **E4** (position 0): Bottom line of staff
- **B4** (position 4): Middle line of staff (center reference)
- **F5** (position 8): Top line of staff

Supported pitch range: E3 to E6

### Ledger Lines
- Notes at C4 and below automatically render ledger lines below the staff
- Notes at A5 and above automatically render ledger lines above the staff

### Stem Direction
- Notes on or above B4 (position >= 4): stems point down
- Notes below B4 (position < 4): stems point up
- Beamed groups use average pitch to determine uniform stem direction

## Technical Details

### Dimensions
- Staff height: 72px
- Line spacing: 8px (5 lines = 32px)
- Note head: 12px × 9px
- Stem height: 28px
- Beam thickness: 4px

### Positioning
- Each pitch position = 4px vertical offset (half of line spacing)
- Notes use `transform: translateY()` for pitch-based positioning
- Beams calculate position from stem element bounding rectangles

## Development

```bash
npm run dev      # Start development server
npm run build    # Build for production
npx tsc --noEmit # Type check
```

## Browser Support

Requires modern browsers with support for:
- Custom Elements v1
- Shadow DOM v1
- CSS Custom Properties
- ES Modules

