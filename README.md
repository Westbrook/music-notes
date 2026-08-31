# Music Notes

Music notation written in readable HTML, rendered as SVG in the browser. Custom elements are the source data; a separate score model preserves musical structure and exact timing. VexFlow 5.0.0 supplies engraving primitives and locally bundled music fonts. No font CDN is required.

This is a source project, not a published npm package. The notation workbook demonstrates the renderer; a separate **Author** workspace supports composition, reading, and page preparation using the same musical DOM and engraving system. Playback is not implemented.

The [third-party notices](THIRD_PARTY_NOTICES.md) preserve the renderer and bundled font licenses. Production builds include a copy as `THIRD_PARTY_NOTICES.txt`.

## Run

Use Node 22.12 or newer on a supported even-numbered Node release.

```sh
npm install
npm run dev
```

Open `/index.html` for the notation workbook or `/author.html` for Author. They are separate entry points: the workbook does not load the authoring application.

The workbook contains eleven original studies: pitch spelling, 7/8, 15/8, 5/4, mixed and nested tuplets, improvisation notation, piano voices, ensemble layout, quarter-tones with a single-line rhythm part, **3 roads music**, and articulations with relative interval harmonies. The ensemble shows the same music twice: first with automatic wrapping, then with optional author-chosen line and page breaks, for twelve score views in total.

Author opens recovered local work or a blank staff. **Write** offers explicit pitch and rhythm entry, voices, tuplets, harmony, performance instructions, and undo/redo. **Read** hides entry controls and holds the reading width until you refit it. **Pages** composes the selected score or part into paper-sized pages with independent layout settings and human page-turn review. Parts retain authored pitches; no transposition is implied. See the [Author workspace guide](docs/author-workspace.md) for the controls, recovery, source editing, and printing workflow.

In Write, the fixed **Write notes / Select** controls share a compact palette. **Write notes** resumes the saved writing destination without replacing the selected music or an unapplied Properties draft. Click the staff to place a single pitched note or an ordinary rest; prepare the drag handle in note options when you want to drag instead. Ordinary rests work on pitched, rhythm and three-roads staves without inventing a pitch. Full-measure rests, chords, rhythm notes, road notes and slashes retain explicit Insert / Enter routes. The preview and musical boundary are validated before one undoable edit.

To change an existing note, choose **Select**, click it, then use **Pitch** or **Value**. Pitch covers letter, octave and all nine supported alterations; desktop Flat / Natural / Sharp shortcuts remain available. Notes and rests both delete with Delete or Backspace. Shared values apply to the exact selected set, while attached marks and relationships have separate routes. Native popovers and customizable native selects keep these edits independent of the next-entry recipe.

**More** uses spare space beside the chosen writing frame or opens a deliberate task sheet. It does not shrink the paper or change its wrapping. Return restores the visible musical position, independently of selection. With the score focused, N / R chooses a note or ordinary rest, Enter writes the recipe, and Left / Right moves the writing destination through existing events and bars. The blank, rhythm and three-roads starter templates begin with an unwritten draft bar; Add measure remains an explicit creation of written silence.

Routine notation notices stay in **Review**, so completing a bar does not move the staff. Pointer feedback starts with the proposed pitch or rest value, and **Keyboard shortcuts** keeps longer help out of the writing surface until needed. Eligible **Add + insert** names its new bar before creating it.

The selected-event editor also offers **Attached marks**. Add or remove articulations, ornaments, and three-roads interval harmonies, then apply the draft as one undoable change. These children stay with their event through duplication, source edits, and compatible event conversions.

Author attempts local recovery saves after a short pause in editing. Saves use Web Locks to coordinate cooperating tabs; browsers without that coordination do not silently fall back to unsafe autosaving. Storage failures and conflicts remain visible. **Download project** keeps a portable copy, including layout settings and unapplied source drafts. Browser storage is not a backup.

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
- Automatic responsive systems, optional line/page breaks, measure numbering, configurable print width, a textual score representation, diagnostics, and source IDs used by Author's selection and editing commands.

Invalid or unsupported notation is diagnosed rather than presented as a successful engraving. See the [authoring guide](docs/authoring.md) for grammar, defaults, and the browser API, and the [design review](docs/design-review.md) for the acceptance criteria and limits.

Automatic wrapping is the default: no break attributes or measure-count limit are needed. All parts wrap together as the available width changes. A short opening pickup stays with the following bar when they fit, without adding a layout instruction to the source.

Set `max-measures` only to impose an upper limit; it does not promise that many measures will fit. A measure's `break-before="line"` or `break-before="page"` forces that boundary even when more music could fit. `keep-with-next` adds an author's preference for neighboring measures. Explicit breaks, a measure limit, or insufficient space take precedence over both that preference and automatic pickup grouping.

The demo's print controls have separate jobs:

- **Use print layout on screen (680px)** switches the scores to their fixed print width. It changes score wrapping, not zoom or paper size. Short examples may look unchanged because they already fit; narrow windows can scroll the fixed layout. Uncheck it to restore responsive wrapping.
- **Open print dialog…** requests browser printing of the whole workbook: all twelve score views, including both ensemble layouts, with headings and explanations. It waits for rendering and blocks the request if a score reports an error. It uses the fixed print layouts whether the checkbox is checked or not. The toolbar, source snippets, and score transcripts are omitted from print.

For your own page, `print-preview` selects the fixed layout on screen and `print-width` sets its width in CSS pixels (default 680). This is not a preview of physical paper pages. A print request cannot confirm that a dialog appeared or that pages were produced correctly. If no dialog opens, open the workbook in a browser with printing support and use its Print command once the notation has finished loading and errors are resolved.

Author's **Pages** view is separate from this workbook control. It lays out complete SVG systems on Letter or A4 pages and uses those page elements for **Print / Save as PDF**. Choose matching paper and orientation in the browser dialog, 100% scale, no additional browser margins, and no browser headers or footers. Unapplied Source changes, musical errors, and physical fit errors block printing; incomplete music requires correction, an applicable intentional-short-measure review, or explicitly marked draft output. Review the final PDF or paper before use; a print request does not verify it.

## Architecture

```text
Authored DOM
       ↓
DOM reader → typed score + source map + diagnostics
       ↓
Exact musical validation → system planning → VexFlow SVG
```

`src/model` owns pitch, meter, rational durations, and validation without depending on a browser or renderer. `src/dom` reads and serializes the authoring grammar. `src/engraving` handles notation and system layout. `src/components` observes source changes and manages rendering, accessibility, and browser lifecycle, with Lit templates for score presentation and stable mounts for engraved SVG.

`src/authoring` adds commands, session history, portable projects, local recovery, part projections, and page composition. Its accepted light DOM remains the editable musical source; model snapshots, SVG, and page previews are projections. Visual commands and **Apply source** validate changes before committing them.

Author's Lit components live in `src/authoring/ui`; its entry point is `src/authoring/bootstrap.ts`. The workbook toolbar, view switch, Source editor, navigator, and score viewport own shadow roots with explicit properties and events. Workspace and panel frames arrange complete caller-owned regions through named slots. The top-level shell, Properties/shared selection controls, musical source, and physical pages retain their native logical boundaries.

Editor transactions, workspace choices, form drafts, and workbook controls use independent `signal-polyfill` and `signal-utils` stores with readonly selectors. `SignalController` connects views and releases subscriptions on disconnect. `ControlScope` registers only owned control roots; composed focus/geometry helpers and public score projection snapshots preserve interaction across slots and shadow roots. Native controls and measured score nodes retain their identities across updates. See [UI and state architecture](docs/ui-state-architecture.md) for component APIs and reuse. Initial delivery is about **48.3 kB gzip for the workbook** and **606.5 kB for Author**, within the **50 kB / 630 kB** build budgets.

When embedding the notation library, edit source attributes or component properties to change music. Do not edit the generated SVG. Canonical score serialization keeps musical values and IDs, not the original HTML formatting or all application metadata; download an Author project to retain the complete document.

## Verify

```sh
npm test
npm run typecheck
npm run check:icons
npm run build
npm run check:bundle
```

Tests cover musical semantics, DOM parsing/serialization, layout, authoring commands and history, projects and recovery, part projections, page planning, and native select enhancement. The workbook supplies visual cases to inspect at desktop, narrow, and print widths. Automated checks do not establish that every possible score has ideal engraving or page turns.

With the dev server running, open `/tests/browser.html` on the same origin and select **Run browser regressions**. This checks visible-ink spacing, rests, ties, nested tuplets, ensemble joins, native resize boundaries, source edits, lifecycle behavior, and fixed print preview; it is separate from `npm test`.

Open `/tests/authoring-browser.html` and select **Run Author regressions** for the actual Author controls, recovery, native selects, parts, and physical page composition. Its fixtures use separate recovery slots and intercept print requests; they do not establish that a native dialog appeared, a PDF was saved, fonts were embedded, or paper output matched the preview.

Open `/tests/shadow-dom-browser.html` and select **Run shadow component checks** for independent component state, slots, native labels/descriptions and form behavior, composed focus and scrolling, popover placement, Source return focus, and isolated score IDs. These are DOM/native-API checks, not screen-reader or trusted keyboard/touch qualification.

Open `/tests/icon-options-browser.html` to check synchronous Phosphor/Bravura SVG delivery through native select cloning, accessible labels, form values, and icon opacity. `npm run check:icons` separately verifies that standalone production bundles remove unused icon definitions and have no deferred icon or font dependencies. The [UI architecture guide](docs/ui-state-architecture.md#icons-and-control-content) describes icon imports and control layouts.

Open `/tests/notation-browser.html` and select **Run notation expansion checks** for actual quarter-tone glyphs, one-line rhythm engraving, rests, beams, tuplets, ties, mixed-staff alignment, and resize/print projection checks. The fixtures remain visible for review; the [notation expansion record](docs/notation-expansion.md) states the supported scope and performer checks.

Open `/tests/three-roads-browser.html` for the three-road line spacing, slash heads, relative directions, ties, rests, accessibility, and responsive/print checks. In Author, start with the **3 roads music** template or change an all-rest staff to that notation, then enter road events with **Higher (top)**, **Same (middle)**, or **Lower (bottom)**. Choose a starting reference pitch before playing; rests preserve it, and tied middle-road continuations sustain it.

Open `/tests/event-markings-browser.html` and select **Run event marking checks** for articulation and ornament glyphs, head-relative harmony figures, dense combinations, source edits, ties, parts, and responsive/print geometry. The [markings guide](docs/event-markings.md) explains the notation and its limits; the final workbook study shows the new HTML elements in use.

Current limits include playback, instrument transposition, cross-staff beams, independent polymeter, arbitrary microtonal tuning beyond the supported quarter-tone spellings, tuplets spanning barlines, general slurs, arbitrary graphical notation, and automatic page-turn optimization. Author uses native browser printing, not a direct PDF generator. Inspect final pages with the intended paper, margins, and playing tempo before performing.
