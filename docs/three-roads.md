# 3 roads music

Three-roads notation follows the user's definition: keep only the **top, middle, and bottom lines of an ordinary five-line staff**, at their original positions. The full outer staff span remains unchanged. There is no clef or key signature. Written rhythmic slashes indicate a relative pitch choice, not a fixed pitch or interval.

| Road | Required choice at a new attack |
| --- | --- |
| Top | Choose any pitch higher than the reference. |
| Middle | Use the same pitch as the reference. |
| Bottom | Choose any pitch lower than the reference. |

Choose a comfortable reference pitch before the first attack. After each new attack, its **main pitch** becomes that voice's reference. Rests keep the reference. Each voice has its own reference; another staff or voice does not supply it. Added harmony notes and ornament auxiliaries do not update this reference. The road itself does not constrain the size of the movement between main pitches, register, scale, or tuning; separately authored interval harmonies prescribe their own distances from the current main pitch. Any reset at a section or repeat must be stated explicitly rather than inferred from a barline.

## Source and model

```html
<music-staff notation="three-roads" meter="4/4" label="3 roads">
  <music-measure>
    <music-direction text="Compare with last main pitch"></music-direction>
    <music-direction text="Bottom: lower"></music-direction>
    <music-direction text="Top: higher · middle: same"></music-direction>
    <music-direction text="Choose a reference pitch first"></music-direction>
    <music-road direction="same" duration="quarter"></music-road>
    <music-road direction="higher" duration="eighth"></music-road>
    <music-road direction="higher" duration="eighth"></music-road>
    <music-road direction="same" duration="quarter"></music-road>
    <music-road direction="lower" duration="quarter"></music-road>
  </music-measure>
</music-staff>
```

`notation="three-roads"` belongs on `music-staff`. `music-road` requires `direction="higher"`, `"same"`, or `"lower"`; omission is an error, not an implicit middle road. Its written `duration`, `dots`, `stem`, `beam`, and enclosing tuplets retain their ordinary meanings and exact rational time. Road events and rests are the only event kinds on this staff. Use `music-road`, not a pitched note, a generic slash, or a one-line `music-rhythm` event with an implied position.

The model records `kind: 'road'`, `pitchDirection`, and `pitches: []`. No chosen realization is written back into the source. The empty pitch array means the exact pitch is chosen in performance; it does not mean the performer must use an unpitched sound. The staff's model compatibility clef/key fields must not be interpreted as musical pitch context. Inherited system clef/key settings are ignored here; local clef/key attributes are rejected.

The renderer uses actual slash noteheads for the written values, including distinct half/whole heads, stems, flags, dots, and beams. The three visible staff lines occupy indices 0, 2, and 4 of the usual five-line grid. Three adjacent lines compressed into half that height would express the wrong layout. Published staff geometry retains the full span; road events do not publish fabricated pitched notehead coordinates for a pitch editor.

## Attacks, ties, and silence

Two consecutive top-road attacks each move higher; their shared printed position does not mean the same pitch. An untied middle-road slash reattacks the last main pitch. Every slash carries a prescribed written rhythm, unlike an open improvisation slash whose nominal duration leaves attacks to the performer.

A tie continues the already chosen pitch without a new attack. A road tie may start on any road, but every `tie="continue"` or `tie="end"` event must be on the **same/middle** road. A higher/lower continuation would contradict holding the pitch and is rejected. Road ties remain within the same voice and may cross bars and systems; rests and other event kinds cannot become endpoints of a road tie.

When a road event has interval harmonies, every segment of its tie must explicitly carry the same complete interval set, including above/below placement. Child IDs and source order need not match, but there is no silent inheritance or implicit attack of a changed harmony. The tie holds the main pitch and those harmonies. Articulations and ornaments remain on the segment where they are authored; see [event markings and interval harmonies](event-markings.md) for placement advice and supported types.

The held pitch remains the reference after a tie or a rest. Rests retain exact written duration, including the distinction between a full-measure rest and a whole-duration rest. They are printed as silence rather than as an additional directional road. Rectangular rests need an actual supporting staff line or ledger; hiding an unused staff line must not leave a rest floating ambiguously.

## Performer instructions and parts

Keep the road legend and reference rule with the part. The workbook's study 10 carries short directions on its own staff: choose a reference, identify the three roads, compare with the last main pitch, and retain the reference through rests. These directions survive part extraction; a legend only in surrounding website text would not be sufficient for an isolated part.

Use concise local instructions to avoid making the first measure needlessly wide. Longer explanations can accompany the score. Accessible text must identify three-roads notation, name each event's higher/same/lower instruction and written rhythm, and distinguish a tied hold from a new attack. It must not announce an invented pitch, key, or clef.

The original demonstration in study 10 starts with a middle quarter, two higher eighths, a middle quarter, and a lower quarter. Its second bar uses a lower quarter, a quarter rest, a middle quarter, and a higher quarter. This makes repeated upward motion and the unchanged reference through silence audible in a realization without prescribing one. Later bars add a triplet and a tied middle-road hold. “Room to improvise” and the quarter-tone/clapped-pulse study remain unchanged.

Study 11 adds event articulations, ornaments, and interval figures centered above or below individual road heads. A `5` above adds a fifth above that event's main pitch; `b3` below adds a minor third below. For example, F with `5` above can produce C above, and Bb with `b3` below can produce G below. These are possible realizations, not absolute pitches stored in the road model. Several figures are all measured independently from the main pitch. They do not reinterpret generic `music-harmony` chord-symbol text.

## Acceptance and verification

Open `/tests/three-roads-browser.html` with the development server running and select **Run three-roads checks**. The seven checks, visible fixtures, and `#three-roads-browser-results` report cover:

- Exactly three staff paths at the original top/middle/bottom positions and the full outer span.
- Direction-bearing slash heads, written values, flags, dots, beams, exact tuplets, and rests with support lines.
- Same-road reattacks versus tied middle-road holds, including both tie halves at a system break and rejection of contradictory endpoints.
- No printed clef/key or invented absolute-pitch geometry; meaningful accessible descriptions and retained part instructions.
- Direction edits, canonical source/model preservation, mixed-staff alignment, and responsive/fixed-print projections.

Run `npm test`, `npm run typecheck`, and `npm run build` for the underlying model, DOM, component, Author, and adapter checks. Browser fixtures must be executed and visually reviewed; merely adding them does not establish acceptance. Inspect the actual workbook and extracted part at desktop, narrow, and fixed print widths. Review head positions, stem/beam direction, tie endpoints, rest placement, and legend spacing.

### Verification — 2026-08-28

The in-app Chromium run passed **7/7 three-roads checks**, including actual road positions, written slash glyphs, both lower-to-same and higher-to-same ties across systems, supported rests, direction edits, extracted instructions, and native resize/print-projection stability. The foundation suite passed **34/34** and the quarter-tone/one-line suite passed **10/10**. The actual workbook study was inspected with three full-span lines, readable slashes, no clef/key, and no notation diagnostics. Its legend places the starting-reference instruction above the road mapping.

The final full test run passed **1,719 tests across 43 suites**, along with TypeScript checking and the production build. A focused sweep of notation, components, Author commands, projections, page labels, and pitch-geometry guards passed **398 tests across 13 suites**. An earlier actual Author browser checkpoint passed **22/22 checks**; further concurrent Author shell edits repeatedly restarted that development-page harness, so that checkpoint is not claimed as a final run of the later shell.

The production Author build was separately exercised through its native controls: create the three-roads template, enter a complete same/higher/higher/lower phrase, change a lower half note to same without changing its duration, and undo back to lower. The template and complete phrase fit one physical preview page without notation notices. Full-score and extracted-part headings identify three-roads notation without claiming authored pitches, and the four short performance instructions remain in the part. Native print dialogs, saved PDFs, and physical output were not tested.

This is a specific relative-pitch notation system, not an import of another tradition or a generic configurable staff engine. There is no playback or automatic realization of the pitch choices. Native printing, saved PDFs, physical output, page turns, and arbitrary dense scores still require separate review.
