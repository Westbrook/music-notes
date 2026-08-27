# Authoring music

The light DOM is the editable source. A `music-staff` renders one part; a `music-system` contains parallel staves and renders their measures together. Measures belong directly to a staff. Notes and rests in a measure are sequential unless placed in separate `music-voice` containers.

```html
<music-system bracket="brace">
  <music-staff clef="treble" label="Piano">
    <music-measure meter="4/4">
      <music-chord pitches="C4 E4 G4" duration="whole"></music-chord>
    </music-measure>
  </music-staff>
  <music-staff clef="bass">
    <music-measure meter="4/4">
      <music-note pitch="C3" duration="whole"></music-note>
    </music-measure>
  </music-staff>
</music-system>
```

Custom HTML elements need explicit closing tags. XML-style `<music-note />` does not close a custom element in HTML and can swallow the following music. Ordinary whitespace, indentation, comments, and `data-*` metadata are welcome; raw prose belongs in an annotation element.

## Pitches, context, and durations

Set `clef`, `key`, and `meter` on the root, staff, or a measure. Changes on a measure continue into following measures of that staff. Defaults are treble clef, C major, and 4/4. A nested `music-meter` is another way to set the measure's meter; place it before any notes, rests, or voices.

| Attribute | Values and meaning |
| --- | --- |
| `clef` | `treble`, `bass`, `alto`, `tenor`. Alto puts middle C on the third line; tenor on the fourth. |
| `key` | Major/minor signatures such as `C`, `G`, `Bb`, `F#m`. This does not transpose authored pitches. |
| `pitch` | An explicit spelling and octave, such as `C4`, `F#4`, `Bb3`, `F##4`, or `Bbb3`. A note requires a pitch. |
| `pitches` | Space-separated chord pitches, such as `C4 E4 G4`. They share one rhythm. |
| `duration` | `breve`, `whole`, `half`, `quarter`, `eighth`, `sixteenth`, `thirty-second`, `sixty-fourth`, `128th`. Default: `quarter`. |
| `dots` | Integer `0`–`3`; legacy boolean `dotted` means one dot. |
| `accidental-display` | `auto` (default), `always`, or `courtesy`. Chords use one policy for all pitches. |
| `stem` | `auto` (default), `up`, or `down`. |
| `tie` | `start`, `continue`, or `end` on consecutive events with matching pitches; omitted means no tie. |

`F4` is F natural even in G major; write `F#4` when you mean F sharp. The renderer uses key and measure context to decide which accidental glyphs to show. It does not change the pitch's meaning. Legacy `pitch="F4" accidental="sharp"` remains accepted, but conflicting explicit spellings, such as `pitch="F#4" accidental="flat"`, are diagnosed.

A `music-rest` accepts the same duration and dot values as a note. `<music-rest measure></music-rest>` instead fills the current meter. It is not equivalent to `duration="whole"` in 3/4, 7/8, or 15/8. A measure rest cannot be dotted, scaled by tuplets, or combined with other events in its voice.

Ordinary unbeamed rests in one voice keep their conventional staff positions even beside high or low notes. Beamed and polyphonic rests may move to accommodate their voices and neighboring notation. Only a full-measure rest is centered in the measure; other rests occupy their rhythmic positions.

Boolean attributes use presence: `dotted`, `pickup`, `rhythmic`. Remove the attribute to disable it; do not write `dotted="false"`.

## Meter and beaming

Groups are expressed in the denominator's units. They must total the numerator. A printed 7/8 can therefore carry `groups="2+2+3"` without printing an additive numerator.

```html
<music-meter top="7" bottom="8" groups="2+2+3"></music-meter>
<music-meter top="15" bottom="8" groups="3+3+3+3+3"></music-meter>
<music-meter top="5" bottom="4" groups="3+2"></music-meter>
```

These are alternative signatures, not three elements to put in one bar. To print the grouping, use `top="2+2+3" bottom="8"`, or put `meter="2+2+3/8"` on the measure. A numeric meter can also be written as `meter="7/8" groups="2+2+3"`. Keep the signature and groups on the same element; do not combine a measure declaration with a `music-meter` child. On `music-meter`, an omitted `top` or `bottom` defaults independently to 4. Without any new declaration, the existing meter continues.

Denominators must be powers of two through 128; numerators are positive integers through 128. Common simple and compound meters receive default groups. Irregular groupings are musically ambiguous: declare them rather than rely on a default, and check grouping warnings.

Automatic beams follow the meter groups and tuplets. For an explicit group use `beam="start"` on the first note and `beam="end"` on the last; intervening notes are members. `beam="continue"` makes continuation explicit; `beam="none"` prevents automatic beaming. Group boundaries must be balanced within one voice and measure. Rests and longer values may require brackets or separate beams; a beam is not itself a duration modifier.

## Tuplets

A tuplet scales written durations by `normal / actual`. Three eighths in a `3:2` group last one quarter; five sixteenths in a `5:4` group also last one quarter. A duplet with `actual="2" normal="3"` lengthens two eighths to one dotted-quarter beat.

```html
<music-measure meter="2/4">
  <music-tuplet actual="5" normal="4" ratio bracket="yes">
    <music-note pitch="D4" duration="sixteenth"></music-note>
    <music-note pitch="F4" duration="sixteenth"></music-note>
    <music-rest duration="sixteenth"></music-rest>
    <music-note pitch="Ab4" duration="sixteenth"></music-note>
    <music-note pitch="C5" duration="sixteenth"></music-note>
  </music-tuplet>
  <music-tuplet actual="3" normal="2">
    <music-note pitch="B4" duration="quarter"></music-note>
    <music-note pitch="A4" duration="eighth"></music-note>
  </music-tuplet>
</music-measure>
```

The second group is valid with two children: its quarter plus eighth represent three written eighth-note units. `actual` is not a required child count. Use `bracket="auto"`, `"yes"`, or `"no"`; boolean `ratio` requests the full ratio label. Notes, rests, and chords may be mixed, and wrappers may nest. The model keeps each wrapper and multiplies its timing ratio exactly. Supported counts are `actual` 2–64 and `normal` 1–64, with a nesting limit of 16; extreme inputs can exceed safe arithmetic or practical engraving limits and are diagnosed.

Legacy `triplet="start"` / `triplet="end"` remains available for a 3:2 group in one container. Prefer wrappers for new music: their boundaries are visible in the HTML and cannot accidentally extend into the next measure. Cross-bar tuplets are not supported.

## Voices, pickups, and ties

Each voice starts at the beginning of its measure. If a measure contains any `music-voice`, put **all** of its rhythm inside voices. Every voice must fill the same meter; use explicit rests for gaps.

```html
<music-measure meter="4/4">
  <music-voice id="melody-bar-1">
    <music-note pitch="G5" duration="half"></music-note>
    <music-note pitch="E5" duration="half"></music-note>
  </music-voice>
  <music-voice id="harmony-bar-1">
    <music-chord pitches="C4 E4" duration="whole"></music-chord>
  </music-voice>
</music-measure>
```

IDs identify source elements, so keep them unique in the score, including separate voice containers in successive bars. An omitted ID receives a stable model ID while that DOM element exists; parsing does not add attributes to your HTML.

Mark a short opening measure `pickup`; it defaults to measure number 0, followed by full bars 1, 2, and so on. Use `incomplete` for a deliberate short ending or an unfinished draft. These flags permit short duration, not overflowing measures. A full score still needs matching measure counts and compatible timing across staves.

Ties use `tie="start"` and `tie="end"`, or `tie="continue"` in the middle of a chain. They connect the same pitches within the same voice and may cross measures and line breaks. Keep voice containers in consistent order across those measures: the first voice continues the first voice, regardless of its element ID. Write the full pitch spelling on both ends, including sharps or flats. Chord ties connect the complete set of pitches. A tie is not a slur, and the current API does not provide general slurs.

## Directions, harmony, and improvisation

| Element | Authoring values |
| --- | --- |
| `music-tempo` | `marking="Flowing" bpm="76" beat="quarter" dots="1"`; omit `bpm` for words alone. |
| `music-dynamics` | `level="mp"`, `level="ff"`, or dynamic text. An empty element defaults to `mf`; explicitly empty text is invalid. |
| `music-direction` | `text="Swing; solo until cue"`, or plain text content. |
| `music-harmony` | `text="Cmaj9/E"`, `text="G7alt"`, or `text="N.C."`. |
| `music-rehearsal` | `text="A"` or another rehearsal label. |
| `music-slash` | A nominal `duration` without pitch. Add boolean `rhythmic` for a specified rhythm with stems. |

Directions and harmony are text, not a harmonic parser or a playback program. “Swing” does not convert written eighths into triplets. A chord symbol does not generate a chord. Plain slashes indicate open rhythm; their durations provide positions in the measure, not a demand to play those exact attacks. Use rhythmic slashes when the written rhythm matters.

Annotations take `placement="above"` or `"below"`. In a sequential passage they attach at the current musical position. To place one explicitly, use `at="1/2"`: this means half a whole note from the start, or the third quarter-note beat in 4/4. It is not a pixel offset. Direct annotations beside explicit voices default to the start of the measure; annotations within a voice follow that voice's position. Dynamics default below; other annotations default above.

Harmony sits nearest the staff, with a shared baseline where symbols fit beside one another. Overlapping directions, tempo text, and rehearsal marks stack farther away. Spacing follows painted glyphs and local collisions, so an unused annotation row or an invisible slash stem does not reserve blank space. Nearby high notes or other notation can still require more room.

## Systems and paper

Automatic wrapping is the default. Without break attributes or a measure-count limit, the renderer chooses systems from the notation's spacing needs and the available width. Measures stay in source order; all parts use the same line breaks. Clefs repeat at new systems, and authored ties continue across breaks. Automatic layout does not add these choices to the source DOM.

A short opening `pickup` stays with the following bar when they fit together. This automatic preference applies only at the start of the score; a later short measure does not imply a new phrase. It does not change `keep-with-next` in the DOM or model. Explicit breaks and measure limits still win, and a pair that cannot fit may split.

Optional layout attributes belong on the rendering root: a standalone staff or the system containing the staves.

| Attribute | Effect |
| --- | --- |
| `max-measures="4"` | Optional upper limit on measures per line, including a pickup. Omit for no measure-count cap; fewer measures may fit. |
| `justify-last` | Stretch the last system; omit to keep a short ending restrained. |
| `measure-numbers="all"` | `all`, `system` (default), or `none`. A measure's `number` overrides its label. |
| `print-width="680"` | Score layout width in CSS pixels for print; default 680. It does not select paper size or margins. |
| `print-preview` | Use the fixed print layout on screen. It does not open a print dialog or display physical paper pages. |

On a measure, `break-before="line"` forces a new system and `break-before="page"` forces a new system with a requested printed page break. These boundaries remain even when a wider container could fit more music. They are optional author choices for a phrase, a reading cue, or an intended page boundary; they are not required for wrapping.

`keep-with-next` adds an author's preference to keep neighboring measures together, including other phrase groupings or an explicit reminder for the opening pickup. Forced breaks and an explicit measure limit win over that preference; a group too wide for a line may split. An individual measure that cannot fit remains readable and reports overflow instead of being squeezed indefinitely.

The [paired ensemble demo](../index.html#ensemble-heading) uses the same music and root layout settings twice. The automatic version has no break attributes, keep hints, or measure limit. The authored version adds `keep-with-next` to the pickup, a line before bar 2, and a page before bar 3. Only the layout instructions differ.

Short nonfinal systems stop stretching at 1.5 times their preferred width; a forced short line need not fill its container. The final system retains its preferred width unless `justify-last` explicitly stretches it. Header space is reserved where a system actually starts, and incoming ties receive room after the repeated clef and signatures. A pickup's header does not give it the rhythmic spacing of a full bar. Staff gaps and outer margins follow visible notation rather than unused drawing bounds.

Screen layout responds to the available width and may add automatic line breaks, but it preserves authored line and page boundaries. With unchanged source, fonts, and options, returning to the same width restores the same grouping. Print and `print-preview` use a separate projection at `print-width`: screen-only resizing reuses its SVG and hit regions without changing its measure ranges. Source edits, layout-option changes, or `refresh()` rebuild that projection.

`end-bar` accepts `single`, `double`, `final`, `repeat-end`, or `none`; `repeat-start` adds a starting repeat barline. In a braced or bracketed system, compatible barlines join across the gaps between staves. Different ending barlines or repeat-start choices remain separate and report an `unjoined-barlines` warning. These are notation, not playback navigation.

In the supplied workbook, the controls have distinct effects:

- **Use print layout on screen (680px)** toggles `print-preview` on all score roots. It fixes their wrapping width without zooming the notation. Short examples can look unchanged when they fit at both widths; a narrow window can scroll the fixed layout. Turning this off restores responsive wrapping and does not disable printing.
- **Open print dialog…** requests printing of all nine score views and their headings and explanations, including both versions of the ensemble. Printing uses each root's fixed print projection regardless of the checkbox. The toolbar, HTML source snippets, and score transcripts are excluded from print. This is the workbook's printing scope; an embedding application controls its own surrounding page content.

The button waits for the current score renders to settle and blocks the request on any reported error; warnings are reported but do not block printing. Repeated clicks while it prepares do not issue duplicate requests. Its status confirms only that printing was requested, not that a native dialog opened or pages were produced correctly. If no dialog appears, open the workbook in a browser that supports printing and use its Print command after the notation is ready and errors are resolved. The current test workflow verifies fixed print projections, but has not verified native dialogs or the resulting PDF/paper pagination.

There is no automatic search for safe page turns. Without an authored page break, the browser handles ordinary pagination; paper size, margins, and print scaling also affect the result. Even a requested page break after rests needs a human check against the playing tempo and the final printed or PDF pages. The on-screen print layout cannot provide that check.

## Read, edit, and serialize

After loading the components, the rendering root exposes `score`, `diagnostics`, `renderComplete`, `toJSON()`, `toHTML()`, `getSource(id)`, and `getHitRegions()`. `score` is the latest model snapshot and is undefined before the first render. `toJSON()` returns a validated `Score` clone. Wait for `renderComplete` after changing the source before inspecting rendered geometry.

```js
const staff = document.querySelector('#pitch-study');
await staff.renderComplete;

const note = staff.getSource('editable-note');
note.setAttribute('pitch', 'G4'); // Or: note.pitch = 'G4'.
await staff.renderComplete;

const html = staff.toHTML();
const json = JSON.stringify(staff.toJSON(), null, 2);
```

`notation-render` announces a completed render, `notation-diagnostics` reports validation results, and `notation-select` identifies a selected notation event. Hit regions connect bounds in each system's SVG viewBox to source IDs for the displayed screen or print-preview layout. They are an integration point for a future editing UI, not an editor themselves. Mutate source attributes, supported component properties, or child elements. Do not use generated SVG as the source of truth.

`renderComplete` is a `Promise<void>` and picks up pending source edits. For a container-width change that must be laid out immediately, use `await staff.refresh()`; otherwise the resize observer schedules layout when it observes the new size. `refresh()` also returns a `Promise<void>`.

For a reader independent of the custom-element lifecycle:

```js
import { readScore, serializeScore } from '/src/dom/index.ts';
import { add, rational } from '/src/model/index.ts';

const result = readScore(document.querySelector('music-staff'));
if (!result.diagnostics.some((entry) => entry.severity === 'error')) {
  const html = serializeScore(result.score);
}
const threeEighths = add(rational(1, 8), rational(1, 4));
```

Model time is a reduced `{ numerator, denominator }` fraction in **whole-note units**. An event's `duration` and `dots` are written values; `time` includes its tuplet ratios and `onset` gives its position in the voice. Keep these exact until a display or playback boundary. The model does not depend on a DOM or VexFlow.

Serialization emits canonical, explicitly closed HTML with model IDs, voices, and tuplet structure. It preserves supported musical data, not original indentation, comments, application metadata, CSS, or root layout preferences. Save those separately if your editor needs them. It throws when a programmatic model cannot be serialized without losing musical information.

Errors include malformed values, unknown notation, conflicting attributes, unbalanced groups, and incorrect measure duration. The root retains a textual representation and diagnostics when engraving would be misleading. Each diagnostic has a `sourceId` that can be resolved back to the authored element. Fix errors before treating the result as a performable score; short drafts should be marked `incomplete` deliberately.

## Scope

The system does not yet implement instrument transposition, microtonal tuning, independent polymeter, cross-staff beams, cross-bar tuplets, general slurs, articulations/ornaments, arbitrary graphical scores, automatic rhythm rewriting, playback, or a visual editing surface. Harmony is authored text, not analyzed or transposed automatically. The [design review](design-review.md) records the reasoning and acceptance checks for the supported foundation.
