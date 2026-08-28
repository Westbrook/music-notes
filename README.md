# Music Notes

Music notation written in readable HTML, rendered as SVG in the browser. Custom elements are the source data; a separate score model preserves musical structure and exact timing. VexFlow 5.0.0 supplies engraving primitives and locally bundled music fonts. No font CDN is required.

This is a source project, not a published npm package. It displays and validates music written in HTML. A visual editing application and playback are outside this notation-library scope.

The [third-party notices](THIRD_PARTY_NOTICES.md) preserve the renderer and bundled font licenses. Production builds include a copy as `THIRD_PARTY_NOTICES.txt`.

## Run

Use Node 22.12 or newer on a supported even-numbered Node release.

```sh
npm install
npm run dev
```

Open `/index.html` for the notation workbook.

The workbook contains eleven original studies: pitch spelling, 7/8, 15/8, 5/4, mixed and nested tuplets, improvisation notation, piano voices, ensemble layout, quarter-tones with a single-line rhythm part, **3 roads music**, and articulations with relative interval harmonies. The ensemble shows the same music twice: first with automatic wrapping, then with optional author-chosen line and page breaks, for twelve score views in total.

## Write a measure

```html
<script type="module" src="/src/components/index.ts"></script>

<music-staff clef="treble">
  <music-measure>
    <music-meter top="7" bottom="8" groups="2+2+3"></music-meter>
    <music-tempo marking="Even eighths" bpm="144" beat="eighth"></music-tempo>
    <music-note pitch="D4" duration="quarter"></music-note>
    <music-note pitch="F4" duration="quarter"></music-note>
    <music-note pitch="A4" duration="quarter" dots="1"></music-note>
  </music-measure>
  <music-measure end-bar="final">
    <music-rest measure></music-rest>
  </music-measure>
</music-staff>
```

Always close custom elements explicitly: `<music-note ...></music-note>`, not `<music-note ... />`. The second measure inherits the meter. Its `measure` rest fills 7/8; a `duration="whole"` rest instead lasts one whole note.

## Supported foundation

- Treble, bass, alto, and tenor clefs; major/minor key signatures; explicit pitch spelling, accidental cancellation, dots, rests, ties, and chords.
- Quarter-tone and three-quarter-tone accidentals in 24-EDO, with readable `qf`, `qs`, `tqf`, and `tqs` pitch suffixes and Stein–Zimmermann glyphs.
- Simple, compound, and additive meters with declared beat groups. Durations from breve through 128th; exact tuplet ratios with mixed values, rests, and nesting.
- A pitch-free, single-line staff using `music-staff notation="rhythm"` and `music-rhythm`, including ordinary noteheads, beams, tuplets, rests, and ties across bars or systems.
- **3 roads music** using `music-staff notation="three-roads"` and `music-road direction="higher|same|lower"`: prescribed slash-head rhythm on the original staff's top, middle, and bottom lines, with performer-chosen relative pitches and no clef or key.
- Note-attached accents, staccato, tenuto, marcato, staccatissimo, and fermatas; trills, turns, inverted turns, and upper/lower mordents on single pitches and road events.
- Three-roads interval harmonies `1`–`13`, optionally flat or sharp, above or below the chosen main pitch: `5` above F adds C; `b3` below B♭ adds G. Each figure belongs to its notehead, and harmony tones do not change the next road's reference.
- Independent voices, aligned staves, braces/brackets, tempo and dynamics, rehearsal marks, harmony text, directions, and beat or rhythmic slashes.
- Automatic responsive systems, optional line/page breaks, measure numbering, configurable print width, a textual score representation, diagnostics, and source IDs for integration with editing tools.

Invalid or unsupported notation is diagnosed rather than presented as a successful engraving. See the [authoring guide](docs/authoring.md) for grammar, defaults, and the browser API, and the [design review](docs/design-review.md) for the acceptance criteria and limits.

Automatic wrapping is the default: no break attributes or measure-count limit are needed. All parts wrap together as the available width changes. A short opening pickup stays with the following bar when they fit, without adding a layout instruction to the source.

Set `max-measures` only to impose an upper limit; it does not promise that many measures will fit. A measure's `break-before="line"` or `break-before="page"` forces that boundary even when more music could fit. `keep-with-next` adds an author's preference for neighboring measures. Explicit breaks, a measure limit, or insufficient space take precedence over both that preference and automatic pickup grouping.

The demo's print controls have separate jobs:

- **Use print layout on screen (680px)** switches the scores to their fixed print width. It changes score wrapping, not zoom or paper size. Short examples may look unchanged because they already fit; narrow windows can scroll the fixed layout. Uncheck it to restore responsive wrapping.
- **Open print dialog…** requests browser printing of the whole workbook: all twelve score views, including both ensemble layouts, with headings and explanations. It waits for rendering and blocks the request if a score reports an error. It uses the fixed print layouts whether the checkbox is checked or not. The toolbar, source snippets, and score transcripts are omitted from print.

For your own page, `print-preview` selects the fixed layout on screen and `print-width` sets its width in CSS pixels (default 680). This is not a preview of physical paper pages. A print request cannot confirm that a dialog appeared or that pages were produced correctly. If no dialog opens, open the workbook in a browser with printing support and use its Print command once the notation has finished loading and errors are resolved.

## Architecture

```text
Authored DOM
       ↓
DOM reader → typed score + source map + diagnostics
       ↓
Exact musical validation → system planning → VexFlow SVG
```

`src/model` owns pitch, meter, rational durations, and validation without depending on a browser or renderer. `src/dom` reads and serializes the authoring grammar. `src/engraving` handles notation and system layout. `src/components` observes source changes and manages rendering, accessibility, and browser lifecycle.

Edit source attributes or component properties to change music. Do not edit the generated SVG. Canonical score serialization keeps musical values and IDs, not original HTML formatting or application metadata; save those separately if an embedding editor needs them.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Tests cover musical semantics, DOM parsing/serialization, layout, components, and source identity. The workbook supplies visual cases to inspect at desktop, narrow, and print widths. Automated checks do not establish that every possible score has ideal engraving or page turns.

With the dev server running, open `/tests/browser.html` on the same origin and select **Run browser regressions**. This checks visible-ink spacing, rests, ties, nested tuplets, ensemble joins, native resize boundaries, source edits, lifecycle behavior, and fixed print preview; it is separate from `npm test`.

Open `/tests/notation-browser.html` and select **Run notation expansion checks** for actual quarter-tone glyphs, one-line rhythm engraving, rests, beams, tuplets, ties, mixed-staff alignment, and resize/print projection checks. The fixtures remain visible for review; the [notation expansion record](docs/notation-expansion.md) states the supported scope and performer checks.

Open `/tests/three-roads-browser.html` for the three-road line spacing, slash heads, relative directions, ties, rests, accessibility, and responsive/print checks. Choose a starting reference pitch before playing; rests preserve it, and tied middle-road continuations sustain it.

Open `/tests/event-markings-browser.html` and select **Run event marking checks** for articulation and ornament glyphs, head-relative harmony figures, dense combinations, source edits, ties, standalone staff rendering, and responsive/print geometry. The [markings guide](docs/event-markings.md) explains the notation and its limits; the final workbook study shows the new HTML elements in use.

Current limits include playback, instrument transposition, cross-staff beams, independent polymeter, arbitrary microtonal tuning beyond the supported quarter-tone spellings, tuplets spanning barlines, general slurs, arbitrary graphical notation, and automatic page-turn optimization. The workbook uses native browser printing, not a direct PDF generator. Inspect final pages with the intended paper, margins, and playing tempo before performing.
