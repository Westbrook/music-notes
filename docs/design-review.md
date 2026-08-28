# Design review

This refactor treats the project as a notation library with an editable musical source, not as a collection of drawing commands. The scope is conventional pitched notation, extended meters and tuplets, readable parts, and clear instructions for improvisation. The [notation expansion review](notation-expansion.md) extends that foundation with bounded quarter-tone spelling and a pitch-free, single-line rhythm staff. It does not claim to replace a complete publishing or composition application.

## What needed to change

The review found musical errors, not just implementation complexity. A pitch such as `F#4` could be drawn without an accidental; accidental state and key cancellation were absent. The tenor clef glyph occupied a different line from the tenor pitch mapping. Triplet labels did not scale time. A single sixteenth note could cause an entire mixed group to receive a second beam. Equal measure widths did not align simultaneous attacks across instruments. Fixed drawing bounds could clip ledger notes and annotations, and wrapped lines lacked repeated clefs.

The same design made future authoring difficult: parsed data, coordinates, and rendering were intertwined; malformed input silently fell back to plausible notes; nested changes and container changes did not have one reliable update path. The DOM API itself was worth keeping because its notes, measures, and attributes were understandable without a specialized editor.

## Decisions

| Responsibility | Decision and reason |
| --- | --- |
| Musical meaning | A typed, serializable model independent of DOM and VexFlow. Pitch spelling, voices, written values, tuplets, and directions survive layout changes. |
| Musical time | Reduced rational fractions in whole-note units. Validation never depends on a floating-point tolerance or canvas positions. |
| Authoring | Readable custom elements remain the source. Structural tuplets and voices make nesting and simultaneity explicit. Legacy dot, accidental, beam, and triplet syntax has an adapter. |
| Engraving | Pinned VexFlow 5.0.0 and bundled Bravura/Academico fonts replace hand-drawn approximations. Local semantics still decide accidentals, grouping, and shared timing. |
| Systems | Plan measure ranges for all staves together. Respect minimum widths, distribute remaining space, and preserve author-supplied line/page choices. |
| Editing foundation | Stable source IDs, diagnostics, canonical serialization, and rendered hit regions connect the model back to authored elements. Generated SVG is disposable output. |
| Failure | Invalid or unsupported input produces diagnostics and a textual representation instead of a misleading successful engraving. Keep the original DOM available for correction. |

For every event, `time = writtenDuration × dotMultiplier × product(normal / actual)`. Each voice's onsets are prefix sums of those exact values. A full-measure rest derives its time from the meter. A tuplet's visible number and bracket are separate presentation choices. This reflects the distinction between [duration modification](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time-modification/) and [visible tuplet notation](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tuplet/) in MusicXML; this project does not yet import or export MusicXML.

## Specialist acceptance criteria

The music engraver's concern is that a performer must see the intended pitch and rhythm without correcting the score mentally. The modern jazz composer's concern is that explicit rhythm, harmonic intent, and freedom to improvise remain distinct. The performer's concern is continuity: common attacks line up, each new system provides context, and a layout change cannot lose a measure or split the ensemble inconsistently.

| Area | Checks that matter |
| --- | --- |
| Pitch | Key-aware accidentals; explicit natural cancellation; repeated-note state; octave distinction; courtesy policy; correct alto versus tenor placement; ties across barlines. |
| Meter | Complete 7/8 with 2+2+3, 15/8 with 3+3+3+3+3, and 5/4 with 3+2. Group totals must match the numerator. Printed additive signatures remain distinct from hidden grouping. |
| Tuplets | Three eighths at 3:2 total 1/4; quarter plus eighth at 3:2 also total 1/4; five sixteenths at 5:4 total 1/4; two eighths at 2:3 total 3/8. Rests and nested ratios retain exact time. |
| Rhythm | Dots change time and appearance; mixed beam levels follow actual written values; full-measure rests differ from whole-duration rests; pickups are explicit. |
| Ensemble | Parallel voices fill the same measure. Common onsets align across staves, not merely barlines. Clefs and key context repeat where needed. |
| Instructions | Directions, rehearsal labels, and chord-symbol text stay legible. Open beat slashes and stemmed rhythmic slashes communicate different commitments. |
| Layout | No missing or duplicated measures; consistent breaks for all parts; restrained short final systems; explicit line/page breaks; legible overflow for an oversized measure. |
| Authoring | Attribute changes, nested edits, and child replacement update the result. Invalid markup points to the responsible source. Supported scores survive serialize/read without changing musical values. |
| Browser lifecycle | Resize, reconnect, font loading, print transitions, and successive edits do not leave stale output or duplicate observers. |

The original eight studies in `index.html` remain small, independent examples of these features. The ensemble appears twice, with automatic layout and authored overrides. The next three studies add quarter-tones with a single-line rhythm part, three-roads notation, and attached markings with interval harmonies, bringing the workbook to eleven studies and twelve score views. Gallery checks read the source and perform a canonical serialize/read comparison. The automated suites cover model arithmetic and validation, DOM behavior, engraving semantics, and deterministic system planning. Visual review remains necessary for spacing, collision avoidance, and the intended printed page.

## Notation references behind the choices

Time signatures can encode additive groups as well as a simple numerator/denominator. This is why the API preserves both `groups` and the printed signature. [MusicXML time signatures](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time/).

Beam levels are individual rhythmic information; the presence of one sixteenth does not make every note a sixteenth. Clefs carry a sign and line and normally recur at system starts. A measure rest is explicitly different from a generic duration-bearing rest. [MusicXML beams](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/beam/), [clefs](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/clef/), and [rests](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/rest/).

Conventional horizontal spacing is not a direct linear mapping from duration to pixels: it must allow room for symbols and optical relationships. This motivated separate minimum widths and stretchable system space. [LilyPond horizontal spacing](https://lilypond.org/doc/v2.24/Documentation/notation/horizontal-spacing-overview.html).

Annotations need an order of importance and clearance from nearby painted notation, not an empty band for every possible annotation kind. Harmony stays close to the staff; directions and navigation grow outward when they collide. [LilyPond outside-staff objects](https://lilypond.org/doc/v2.24/Documentation/learning/outside_002dstaff-objects).

Ordinary rests stay inside the staff despite high or low neighboring notes; polyphonic rests can be displaced to distinguish voices. Staff grouping and shared barlines are separate choices, so different barline meanings across parts must remain visible. [Dorico rest placement](https://www.steinberg.help/r/dorico-pro/6.1/en/dorico/topics/notation_reference/notation_reference_rests/notation_reference_rests_general_placement_conventions_c.html), [MusicXML group symbols](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/group-symbol/), and [group barlines](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/group-barline/).

Beat slashes and rhythmic slashes differ in whether the rhythm is prescribed; harmony symbols represent harmonic information rather than a compulsory voicing. Swing affects performance interpretation and must not silently rewrite the authored rhythm. [MusicXML slashes](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/slash/), [harmony](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harmony/), and [swing](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/swing/).

A good page break is not automatically a safe page turn. A turn requires enough time without playing, and that must account for the whole part, including concurrent voices. The current API leaves those choices to the author; automatic turn planning is a separate future feature. [LilyPond page breaking and page turning](https://lilypond.org/doc/v2.25/Documentation/notation/page-breaking).

## Boundaries and next work

The current grammar does not express independent polymeter, cross-staff beams, arbitrary tuning beyond its documented 24-EDO quarter-tone spellings, cross-bar tuplets, instrument transposition, general slurs, or arbitrary graphical notation. Its rhythm staff is one fixed line, not a configurable percussion kit map. It does not automatically rewrite awkward rhythms into tied groups. The [markings extension](event-markings.md) adds six articulations, five ornaments, and three-roads interval harmonies through 13; ornament realization and extension lines remain unsupported. Measure-level chord symbols are preserved text, not analyzed or transposed. Directions such as “solo until cue” express intent without inventing a repeat-playback program.

The renderer is an implementation of the supported grammar, not a guarantee of ideal engraving for every dense or extreme score. An individual measure wider than its container may overflow. Print width is fixed and configurable; paper size, margins, browser pagination, and the performer's available turning time still require review. There is no automatic safe-turn optimizer or fully validated publishing workflow.

An embedding editor can build commands, selection, undo/redo, and insertion previews around the model and source IDs. It should preserve exact musical time and explicit pitch spelling, make incomplete drafts visible, and keep layout preferences separate from note content. A future playback layer should introduce performed timing without replacing written timing.

Run `npm test`, `npm run typecheck`, and `npm run build` for automated verification. Inspect the workbook at desktop, narrow, and configured print widths; check the nested tuplets, accidental cancellations, common piano attacks, and the ensemble tie/page transitions before relying on a printed part.

The actual-browser regression page is `/tests/browser.html` on the development server. Select **Run browser regressions** to exercise font/SVG geometry, shared attack positions, reflow, source mutation, lifecycle behavior, and print preview. This page is a separate browser check, not part of the Node test run; use its reported results for the browser being tested.

## Verification and specialist review — 2026-08-27

The initial refactor passed 186 automated tests, TypeScript checking, a production build, and 21 checks in the Codex in-app Chromium browser. The specialists accepted the supported musical grammar and inspected examples, but the subsequent user review exposed excessive whitespace, misplaced ordinary rests, and concerns about ensemble wrapping. The earlier SVG containment checks did not establish good spacing or stable behavior at nearby wrap thresholds. That initial approval was too broad for the visual quality demonstrated.

The follow-up made those concerns explicit acceptance checks:

- **Visible spacing:** painted glyph bounds exclude transparent hit rectangles, hidden slash stems, and unused font extents. Harmony has an 8-pixel nominal clearance, other annotations stack only as needed, and staff gaps and outer padding follow the visible result. Nested tuplet labels receive at least 6 pixels of separation where their painted spans overlap.
- **Rhythm and continuity:** ordinary unbeamed rests in one voice retain conventional positions, including inside tuplets. System headers count only at actual system starts; incoming ties reserve 20 pixels after the header. Sparse nonfinal systems stop at 1.5 times preferred width, while `justify-last` remains an explicit full-width choice for the ending.
- **Polyphonic rests:** rests share a glyph only when their written value, dots, full-measure status, exact onset, and elapsed time agree. Unequal rests retain their own glyphs and dots, including different written values with equal tuplet-adjusted time. Sharing ink never combines the voices' source IDs or hit mappings.
- **Ensemble boundaries:** connectors fill only interstaff gaps. Different ending barlines or repeat starts remain separate with an `unjoined-barlines` warning. All staves share measure ranges and authored line/page choices.
- **Resize and print:** native width changes reflow the screen deterministically. The fixed print projection is cached across screen-only resizing, preserving its SVG, hit regions, and measure ranges; edits, options, or an explicit refresh rebuild it.

The follow-up passed **240 automated tests and 29 actual-browser checks** in the in-app Chromium browser. The browser run covered 40 engraving matrix cases and examined 3,021 visible-ink bounds across 283 rendered systems, including rerenders. Its checks include 20 ordinary-rest positions across four clefs, nested-label and incoming-tie clearance, annotation spacing, barline joins, source identity, and print-preview stability, alongside the existing timing and lifecycle cases. Five polyphonic fixtures verify 11 distinct rests, including dotted and tuplet values, a concurrent pitched voice, and full-measure versus ordinary whole rests. Separate checks confirm that equal rests in two or three voices can share ink while preserving every source ID and hit mapping.

The ensemble was exercised through **53 native ResizeObserver width changes**, including every integer width from 320 down to 278 pixels and a return to wider layouts. With the tested source and fonts, the pickup and bar 1 remain together at 290 pixels and split at 289; this is a fixture result, not an API threshold. The authored line before bar 2 and page before bar 3 remain in force, all parts stay synchronized, and returning to the same width restores the same grouping. The fixed print projection does not change during those screen resizes.

The final music engraver, modern jazz composer, and performer reviews inspected improvisation and ensemble views at desktop and phone widths, including the explicit page boundary and the restored polyphonic rests. Harmony, open versus rhythmic slashes, directions, corrected rests, and incoming ties are readable without changing their authored meaning. Unequal rests remain distinguishable, and the shared-rest rule preserves both written notation and exact timing. The model and DOM authoring reviewers independently confirmed exact timing, unchanged source content, and separate source identities and hit regions for both shared and distinct rests. All five reviewers approved the final changes within the documented scope; no concrete blocker remains in the reviewed examples and cases.

These reviews do not certify every browser, arbitrary dense scores, or physical pagination. The actual print dialog and printed/PDF page sequence were not tested. Authors must still review paper settings and page turns; automatic safe-turn planning remains outside this refactor.

## Automatic layout and optional overrides

The ensemble gallery now presents the same music at the same container width twice. The first version has no break attributes, keep hints, or measure-count limit. The second adds explicit pickup grouping, a line before bar 2, and a page before bar 3. Identical root options and a complete comparison of the parsed musical content ensure that only the layout instructions differ. The browser regression fixtures read these examples from the actual gallery HTML, so they cannot silently drift into different demonstration scores.

The comparison exposed an avoidable automatic break: at 300 pixels, the pickup was left alone even though it fitted beside bar 1. The renderer now derives a keep preference for a short opening pickup with a following bar. This changes only the system planner's input, not the source DOM, score data, or exact musical time. A later short measure or a full bar marked as a pickup does not acquire the preference. An explicit line/page boundary or measure limit takes precedence, and a pair too wide for its container may split.

The updated verification passes **244 automated tests and 32 browser checks**. The paired examples were compared through 16 native width changes in addition to the earlier 53-step resize sweep. At 960 pixels the automatic example shares one system while the manual example keeps three; at 336 pixels automatic layout uses two systems while the authored choices still require three. The opening pair stays together at 290 pixels and splits at 289 with these fonts and contents. Separate browser checks exercise explicit line/page overrides, a one-measure limit, and adding/removing the manual attributes while preserving source identities and rebuilding both screen and print projections.

All five specialists approved the completed comparison and pickup refinement. The engraver, composer, and performer reviewed the desktop and phone views; the model and authoring reviewers confirmed the narrow inference rule, override precedence, and preservation of musical data and source identities. Typecheck and the production build also pass.

Automatic layout means shared system wrapping. Ordinary printed pagination belongs to the browser, and fixed print width does not identify safe musical turning opportunities. The paired examples make that distinction explicit; physical pagination and playing time still require author review.

## Workbook controls and print verification

The earlier print checks exercised score projections, not the workbook toolbar. The checkbox selected each score's fixed-width SVG without showing physical pages. The print button waited for one snapshot of render promises and called `window.print()`. It could queue duplicate requests, proceed after a score error, or miss a newer edit to a score that had finished while another was still rendering.

The toolbar now calls a separate, tested controller. It rechecks the current score set and completion promises until they are stable, blocks error diagnostics from either projection, permits warnings with a notice, and prevents duplicate requests during preparation. Printing does not change the music or require the screen checkbox. The labels and nearby help distinguish **Use print layout on screen (680px)** from **Open print dialog…** and explain why short examples may look unchanged. Status reports a dialog request, never successful printing or PDF creation: the host may ignore a request, and return from the call does not prove an output was produced. [HTML printing steps](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#printing).

Verification now passes **275 automated tests and 34 browser checks**. The 31 controller tests cover readiness, changes to the score set, late edits, duplicate requests, diagnostics, repair, exceptions, and disposal. Two browser checks load the actual workbook in a same-origin frame, including its production bootstrap, stylesheet, and all nine scores. They click its real controls at 390/960 pixels, preserve musical source identities, compare identical print geometry with the checkbox off/on, and block an immediate invalid edit until it is repaired. These tests intercept only `window.print()`; they establish the request boundary, not a native dialog or paginated output.

The live print button was also clicked without interception. It returned to the page with the honest request status, but no paginated output was available through the browser connection for inspection. Native dialog handling, real print-media pagination, paper/PDF clipping, and cancellation recovery remain unverified. The print stylesheet now asks browsers to keep subsection headings and captions intact and with the following content; these constraints do not establish that a particular paper size will fit. [CSS fragmentation rules](https://www.w3.org/TR/css-break-3/).

All five specialists accepted the control behavior, source preservation, wording, and bounded CSS changes with that limitation explicit. Acceptance of the complete printing workflow still requires a real paginated PDF inspection: one copy of each score, intact systems, attached headings, no missing or clipped ink, and the manual final bar on a new page, with paper, margins, scale, and header/footer settings recorded.
