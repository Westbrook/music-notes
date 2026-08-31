# Authoring music

For the separate visual composition workspace, open `author.html` and read the [Author workspace guide](author-workspace.md). This document describes the musical DOM grammar shared by Author and the notation workbook.

Author's fixed **Write notes / Select** controls separate entering music from correcting it. Write notes resumes the saved writing point, independently of the selection and retained form drafts; **Location & actions → Start writing here** deliberately chooses another point. New-event **Options** and **Value** use separate native popovers, and **Insert here / Enter** applies the configured recipe. In writing, N/R chooses the note/rest tool and Left/Right moves the writing point without editing music. The selected **Pitch** chooser supports letter, octave and absolute alteration for an eligible untied single note.

The writing frame is independent of **More**: a persistent task uses spare side space or a sheet with **Return to score**, without shrinking notation or rewrapping its systems. A compact header summary and **Review** carry editing feedback; the optional note-relative toolbar remains off by default. The 48px normal-palette CSS target is not a measured native result. See the [writing-surface implementation status](author-writing-surface-proposals.md#implementation-status--28-august-2026) for focused evidence and pending native, accessibility and publication qualification; this grammar document does not assert current aggregate or final team acceptance.

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

Set `clef`, `key`, and `meter` on the root, staff, or a measure. Changes on a measure continue into following measures of that staff. Pitched notation defaults to treble clef, C major, and 4/4. A nested `music-meter` is another way to set the measure's meter; place it before any notes, rests, or voices. Use `notation="rhythm"` for a pitch-free single line, or `notation="three-roads"` for written rhythm with performer-chosen relative pitch directions, as described below.

| Attribute | Values and meaning |
| --- | --- |
| `clef` | `treble`, `bass`, `alto`, `tenor`. Alto puts middle C on the third line; tenor on the fourth. |
| `key` | Major/minor signatures such as `C`, `G`, `Bb`, `F#m`. This does not transpose authored pitches. |
| `pitch` | An explicit spelling and octave, such as `C4`, `F#4`, `Bb3`, `F##4`, `Bbb3`, or `Fqs4`. A pitched note requires a pitch. |
| `pitches` | Space-separated chord pitches, such as `C4 E4 G4`. They share one rhythm. |
| `duration` | `breve`, `whole`, `half`, `quarter`, `eighth`, `sixteenth`, `thirty-second`, `sixty-fourth`, `128th`. Default: `quarter`. |
| `dots` | Integer `0`–`3`; legacy boolean `dotted` means one dot. |
| `accidental-display` | `auto` (default), `always`, or `courtesy`. Chords use one policy for all pitches. |
| `stem` | `auto` (default), `up`, or `down`. |
| `tie` | `start`, `continue`, or `end` in the same voice. Match pitched notes, sustain rhythm notes, or continue a road event with `direction="same"`; omitted means no tie. |

`F4` is F natural even in G major; write `F#4` when you mean F sharp. The renderer uses key and measure context to decide which accidental glyphs to show. It does not change the pitch's meaning. Legacy `pitch="F4" accidental="sharp"` remains accepted, but conflicting explicit spellings, such as `pitch="F#4" accidental="flat"`, are diagnosed.

### Quarter-tone accidentals

The supported microtonal vocabulary is quarter-tone notation in 24 equal divisions of the octave (24-EDO), using one Stein–Zimmermann accidental family. Alterations are absolute offsets from the named natural, in semitones; they are not added to the key signature or the previous accidental.

| Spelling | Accidental attribute | Alteration from the natural |
| --- | --- | --- |
| `Fqf4` | `quarter-flat` | −0.5 semitone (−50 cents) |
| `Fqs4` | `quarter-sharp` | +0.5 semitone (+50 cents) |
| `Ftqf4` | `three-quarter-flat` | −1.5 semitones (−150 cents) |
| `Ftqs4` | `three-quarter-sharp` | +1.5 semitones (+150 cents) |

For example, `<music-note pitch="F4" accidental="quarter-sharp"></music-note>` and `<music-note pitch="Fqs4"></music-note>` have the same pitch. Chords use the same suffixes, such as `pitches="C4 Eqs4 G4"`. Short `qf`, `qs`, `tqf`, and `tqs` accidental values are also accepted. An explicit suffix must agree with a separately supplied accidental. Canonical serialization uses the suffix spellings.

A chord may contain at most two pitches at the same letter and octave, such as `Fqf4 Fqs4`; their heads remain distinct. Three or more at one staff position produce `unsupported-chord-cluster` instead of hiding a pitch. Use musically appropriate distinct spellings/staff positions or separate staves for a larger cluster. This limit applies to ordinary and quarter-tone alterations alike.

Quarter-tone accidentals follow the same octave-specific, measure-local state and `accidental-display` policy as ordinary accidentals. A natural cancels the complete alteration. A tie preserves the exact spelling, including its quarter-tone alteration. A continued tie does not silently change the accidental state of later, untied attacks in a new bar. Text descriptions name these accidentals in words.

Include a short legend in the performer's part, especially when mixing conventions from other scores. The workbook uses “24-EDO; quarter-tone signs”; its accompanying explanation gives the cent values. The library does not implement arbitrary cents, just-intonation ratios, nonstandard key signatures, selectable accidental systems, retuning, or playback. A text direction cannot add those musical capabilities. See the [notation expansion review](notation-expansion.md).

### Single-line rhythm staff

```html
<music-staff notation="rhythm" label="Claps" meter="7/8" groups="2+2+3">
  <music-measure>
    <music-direction text="Clap the written rhythm"></music-direction>
    <music-rhythm duration="quarter"></music-rhythm>
    <music-rest duration="quarter"></music-rest>
    <music-rhythm duration="quarter" dots="1"></music-rhythm>
  </music-measure>
  <music-measure end-bar="final">
    <music-rest measure></music-rest>
  </music-measure>
</music-staff>
```

`notation="rhythm"` creates one actual staff line with ordinary duration-bearing noteheads, not a pitched staff with hidden notes. `music-rhythm` is valid only on a rhythm staff and has no pitch or accidental; its `duration`, `dots`, `stem`, `beam`, and `tie` describe a prescribed rhythm. Use the staff label or a direction to say what action or sound is intended. A rhythm staff does not imply a particular percussion instrument or MIDI sound.

The staff retains meter, grouping, voices, tuplets, rests, annotations, barlines, and synchronized layout with pitched staves. It has no printed clef or key signature. Inherited system clef/key settings do not give it pitch; explicit `clef` or `key` attributes on the rhythm staff or its measures are diagnosed. Pitched `music-note` and `music-chord` events are rejected on it. Omitting `notation`, or using `notation="pitched"`, preserves the ordinary five-line staff. Changing an existing staff's notation never silently removes its pitches.

To convert an existing untied passage in Author, first convert its pitched notes/chords to **rhythmic slashes**, then change the staff's notation to **Rhythm**, and finally convert those slashes to **rhythm notes** if ordinary heads are wanted. Rhythmic slashes are valid in both staff modes and preserve prescribed attacks; open slashes do not. The staff change removes obsolete local clef/key settings only after no pitched events remain. For a tied passage, edit the complete source as one validated change, replacing its pitched events with rhythm events and changing the staff mode together while preserving the intended tie chain; the visual conversion controls will not silently clear ties.

Rests keep their written values. A whole-duration rest still lasts one whole note; a full-measure rest still follows the meter. `music-slash rhythmic` prescribes attacks with slash heads, while an open `music-slash` leaves attacks to the performer. Neither is a synonym for an ordinary rhythm note. Rhythm notes may tie to consecutive rhythm notes in the same voice, including across bars and systems: the continuation is not a new attack. They cannot tie to pitched notes, rests, or slashes.

The text representation identifies the single-line rhythm staff and pitch-free rhythm events. Pitched notehead coordinates and pitch editing do not apply to rhythm notes. Part projections retain the staff's notation and event identities; put each required instruction on its own staff or explicitly include the part in Author's instruction scope.

A `music-rest` accepts the same duration and dot values as a note. `<music-rest measure></music-rest>` instead fills the current meter. It is not equivalent to `duration="whole"` in 3/4, 7/8, or 15/8. A measure rest cannot be dotted, scaled by tuplets, or combined with other events in its voice.

Ordinary unbeamed rests in one voice keep their conventional staff positions even beside high or low notes. Beamed and polyphonic rests may move to accommodate their voices and neighboring notation. Only a full-measure rest is centered in the measure; other rests occupy their rhythmic positions.

Boolean attributes use presence: `dotted`, `pickup`, `rhythmic`. Remove the attribute to disable it; do not write `dotted="false"`.

### 3 roads music

```html
<music-staff notation="three-roads" label="3 roads music" meter="4/4">
  <music-measure>
    <music-direction text="Choose a reference pitch; top higher, middle same, bottom lower."></music-direction>
    <music-road direction="same" duration="quarter"></music-road>
    <music-road direction="higher" duration="eighth"></music-road>
    <music-road direction="higher" duration="eighth"></music-road>
    <music-road direction="same" duration="quarter"></music-road>
    <music-road direction="lower" duration="quarter"></music-road>
  </music-measure>
</music-staff>
```

This graphic scoring approach keeps the original five-line staff's **top, middle, and bottom lines**, at their original spacing. It has no clef or key. Every `music-road` prescribes its written rhythm using duration-specific slash heads, stems, flags, beams, and dots. Its required `direction` is one of:

| Direction | Staff line | Performer instruction |
| --- | --- | --- |
| `higher` | Top | Choose any pitch higher than the previous main pitch. |
| `same` | Middle | Use the same pitch as the previous main pitch. |
| `lower` | Bottom | Choose any pitch lower than the previous main pitch. |

Choose a comfortable reference pitch before the first attack, separately for each voice. An opening `same` sounds that reference. Higher/lower instructions compare with the last **main pitch** in that voice, including through rests and barlines; two successive top-road events ask for two upward moves. Added harmony tones and ornament auxiliaries never replace that reference. The roads do not specify absolute register, interval size, tuning, or scale. Author an explicit direction if a section or repeat should reset the reference. Place the legend and any performance restrictions on the staff so they remain in extracted parts.

Only `music-road`, rests, tuplets, voices, and annotations belong on this staff. An ordinary pitched note, a single-line rhythm note, or an open improvisation slash would omit or contradict a road instruction and is rejected. Inherited system clef/key settings are ignored; explicit local clef/key attributes are errors. Rests keep their exact rhythm but do not choose a new reference pitch. The example in the workbook remains distinct from both “Clapped pulse” and “Room to improvise.”

A tie can start on any road, but every `tie="continue"` or `tie="end"` must use **`direction="same"` on the middle line**. It sustains the previously chosen pitch without another attack. Untied middle-road events do reattack. Tying into `higher` or `lower` is an error, even if the previous head used that road. Ties remain in one voice and may cross bars or systems; rests cannot interrupt a tie.

When a road carries interval harmonies, the tie sustains the entire sonority. Repeat exactly the same interval values and above/below directions on every tied segment. Source IDs and child order may differ; adding, dropping, or changing an interval inside the tie is rejected. There is no implicit inheritance from the first segment.

Author has an empty **3 roads music** starter with its performance legend, a staff notation choice, and direction controls for entry and selected-event editing. The dedicated next-note **Direction** chooser prepares Higher, Same or Lower; **Insert here / Enter** writes that recipe. Other note options remains reachable from the chooser. This does not enable road-note pointer entry. Changing an occupied staff to a different notation rejects incompatible events rather than guessing a conversion. Use an empty incomplete or all-rest staff, or apply a complete, valid Source change. Duration edits preserve direction; direction edits preserve timing. Pitch dragging, A–G pitch entry, and accidental controls do not apply to road events.

## Articulations, ornaments, and interval harmonies

Attach markings as direct children of their event. They share that event's onset, consume no additional time, and keep their own source IDs. They are not measure annotations or separate tuplet members.

```html
<music-note pitch="F4" duration="quarter">
  <music-articulation type="accent"></music-articulation>
  <music-articulation type="staccato"></music-articulation>
</music-note>
<music-note pitch="G4" duration="half">
  <music-ornament type="trill"></music-ornament>
</music-note>
```

| Element | Vocabulary | Placement and scope |
| --- | --- | --- |
| `music-articulation` | `accent`, `staccato`, `tenuto`, `marcato`, `staccatissimo`, `fermata` | Opposite the printed stem, or above a stemless event; notes, chords, rhythm notes, road events, and rhythmic slashes. Rests and open slashes accept only `fermata`. |
| `music-ornament` | `trill`, `turn`, `inverted-turn`, `upper-mordent`, `lower-mordent` | Opposite the printed stem, or above a stemless event; a single pitched note or a road's main pitch. Chords need a separate pitched voice identifying the ornamented tone. |
| `music-interval` | Required `value`: `1` through `13`, optionally prefixed by `b` or `#` | Required `placement="above"` or `"below"`; road events only. This side is musical meaning, never changed to avoid a collision. |

All standard markings follow the stem actually drawn: up stem → below, down stem → above, no stem → above. This includes beamed notes, multiple voices, ornaments, and fermatas. A harmony figure's side has no effect on this rule. Legacy articulation `placement="auto|above|below"` and ornament `placement="above|below"` attributes remain valid source data and round-trip unchanged, but no longer override the engraved side. Omit them in new markup; interval placement remains required and meaningful.

Different articulation types may combine, such as accent plus staccato. Repeating the same articulation or ornament type on one event is an error, even on opposite sides. Markings stay on their authored tie segment. Put an attack accent at the start, a release mark at the end, and a fermata where the hold is intended; markings do not break ties, invent attacks, or change exact written time. Ornaments use standard symbols but do not generate auxiliary pitches or playback. Supply a performance instruction when the upper/lower neighbor, tuning, starting note, or speed matters, especially on an unkeyed road staff.

```html
<music-road direction="same" duration="quarter">
  <music-interval value="5" placement="above"></music-interval>
</music-road>
<music-road direction="higher" duration="quarter">
  <music-interval value="b3" placement="below"></music-interval>
</music-road>
```

Each interval refers independently to that event's chosen **main pitch**. A `5` above F adds C above; a `b3` below B♭ adds G below. Figures use major/perfect distances: `1`–`13` represent 0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, and 21 semitones. `b` reduces the distance by one semitone and `#` increases it by one; only then does above/below determine the direction. Thus `b3` below is −3 semitones, while an unaltered `3` below is −4. Compound intervals keep their octave: `13` is not reduced to `6`. These figures specify distances, not key-relative scale degrees or chord-symbol extensions.

Multiple figures may appear on either side. An identical interval on the same side is rejected; the same value on opposite sides is allowed. Distinct spellings such as `#4` and `b5` remain distinct. Unicode `♭`/`♯` and surrounding whitespace are accepted; canonical HTML uses `b`/`#`. Explicit `1` means unison. `b1` is rejected because it reverses the declared side. Values above 13, leading zeros, signs, double alterations, quality prefixes such as `m3`, and quarter-tone interval figures are not supported.

The model stores an optional `MusicEvent.markings` array of `ArticulationMarking`, `OrnamentMarking`, and `IntervalMarking` values. An interval contains `{ number, alter }`, not a realized pitch. `parseHarmonyInterval`, `harmonyIntervalText`, `harmonyIntervalSemitones`, `harmonyIntervalOffset`, and `harmonyIntervalDescription` expose the same rules without a renderer. Existing `music-harmony` remains free-text chord-symbol notation anchored in a measure; it is not converted to these event-relative figures. See the [markings review](event-markings.md) for performer guidance and verification.

In Author's **Select** mode, select the event and choose **Marks**, or open **More → Properties → Attached marks**. Selecting an existing printed mark and choosing **Edit mark** reaches that exact child row. The marking rows form a separate draft: add or remove rows, choose standard marking types or interval values/directions, then apply them together as one undoable transaction. Standard marking placement is automatic. Ordinary duration, stem, and direction edits preserve existing children. Compatible event conversions preserve them too; incompatible conversions require removing the conflicting marking explicitly. Source edits, project saves, duplication, and extracted parts preserve supported markings and their identity relationships.

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

The second group is valid with two children: its quarter plus eighth represent three written eighth-note units. `actual` is not a required child count. Use `bracket="auto"`, `"yes"`, or `"no"`; boolean `ratio` requests the full ratio label. Pitched notes/chords, rhythm notes, road events, and rests retain their written values inside tuplets, subject to the containing staff's notation; wrappers may nest. The model keeps each wrapper and multiplies its timing ratio exactly. Supported counts are `actual` 2–64 and `normal` 1–64, with a nesting limit of 16; extreme inputs can exceed safe arithmetic or practical engraving limits and are diagnosed.

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

An `incomplete` ordinary measure may contain an empty voice, including an implicit voice in `<music-measure incomplete></music-measure>`. This means rhythm has not yet been written. The renderer retains the staff, barlines and context without inserting a rest; the `empty-voice` warning identifies the unfinished voice. Explicit empty `music-voice` containers retain their order and identities beside other voices. Empty complete voices, empty pickups, missing voices and empty tuplets remain errors. A tie cannot skip an unwritten voice. In Author, empty voices block ordinary publication and cannot be approved as short endings; visibly marked Draft output may include them. Write explicit rests to specify silence.

Only Author's blank pitched, rhythm and three-roads starters begin with empty incomplete voices; composed studies keep their authored music, and **Add measure** still writes explicit full-measure rests. Deleting the last event in an ordinary voice leaves it empty rather than inserting silence. In Write notes, a staff click or prepared-handle drop can enter an ordinary written rest on all three staff modes, using the chosen duration and dots at an existing musical boundary. Rest height has no pitch meaning. **Options → Prepare rest drag** exposes the handle; **Done** cancels preparation. Full-measure rests remain an explicit Insert here/Enter choice. This input behavior does not change the DOM distinction between unwritten time, an ordinary rest and a full-measure rest.

Ties use `tie="start"` and `tie="end"`, or `tie="continue"` in the middle of a chain. They connect the same pitches, consecutive pitch-free rhythm notes, or road events with `same` continuations, within the same voice and may cross measures and line breaks. Keep voice containers in consistent order across those measures: the first voice continues the first voice, regardless of its element ID. For pitched ties, write the full pitch spelling on both ends, including ordinary or quarter-tone accidentals. Chord ties connect the complete set of pitches. A rhythm tie carries the duration without prescribing another attack; it does not acquire a pitch. A road tie holds the performer's chosen pitch, with its continuation on the middle road. Rest/slash ties and ties between these different notation kinds are unsupported. A tie is not a slur, and the current API does not provide general slurs.

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

Automatic wrapping is the default. Without break attributes or a measure-count limit, the renderer chooses systems from the notation's spacing needs and the available width. Measures stay in source order; all parts use the same line breaks. Pitched clefs repeat at new systems, rhythm staves remain one line without a clef, and authored ties continue across breaks. Automatic layout does not add these choices to the source DOM.

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
- **Open print dialog…** requests printing of all twelve score views and their headings and explanations, including both versions of the ensemble, the quarter-tone/rhythm study, 3 roads music, and the markings/harmony study. Printing uses each root's fixed print projection regardless of the checkbox. The toolbar, HTML source snippets, and score transcripts are excluded from print. This is the workbook's printing scope; an embedding application controls its own surrounding page content.

The button waits for the current score renders to settle and blocks the request on any reported error; warnings are reported but do not block printing. Repeated clicks while it prepares do not issue duplicate requests. Its status confirms only that printing was requested, not that a native dialog opened or pages were produced correctly. If no dialog appears, open the workbook in a browser that supports printing and use its Print command after the notation is ready and errors are resolved. The current test workflow verifies fixed print projections, but has not verified native dialogs or the resulting PDF/paper pagination.

There is no automatic search for safe page turns. Without an authored page break, the browser handles ordinary pagination; paper size, margins, and print scaling also affect the result. Even a requested page break after rests needs a human check against the playing tempo and the final printed or PDF pages. The on-screen print layout cannot provide that check.

## Read, edit, and serialize

After loading the components, the rendering root exposes `score`, `diagnostics`, `renderComplete`, `renderRevision`, `toJSON()`, `toHTML()`, `getSource(id)`, `getHitRegions()`, and `getLayoutGeometry()`. `score` is the latest model snapshot and is undefined before the first render. `toJSON()` returns a validated `Score` clone. Wait for `renderComplete` after changing the source before inspecting rendered geometry.

```js
const staff = document.querySelector('#pitch-study');
await staff.renderComplete;

const note = staff.getSource('editable-note');
note.setAttribute('pitch', 'G4'); // Or: note.pitch = 'G4'.
await staff.renderComplete;

const html = staff.toHTML();
const json = JSON.stringify(staff.toJSON(), null, 2);
```

`notation-render` announces a completed render, `notation-diagnostics` reports validation results, and `notation-select` identifies a selected notation event. Hit regions connect bounds in each system's SVG viewBox to source IDs for the displayed screen or print-preview layout. The separate Author workspace uses these integration points for selection; the components themselves remain independent of its editor. Mutate source attributes, supported component properties, or child elements. Do not use generated SVG as the source of truth.

The `music-system` drawing is inert to pointer inspection: its SVG and every SVG descendant have `pointer-events: none`, so a fitting score targets the source system host. Click selection still works through measured event, marking, annotation, and tuplet geometry, including fixed print preview. The component prevents the default of a handled coordinate click; embedding editors should check `event.defaultPrevented` before applying their own blank-space selection fallback. Transcript/diagnostic disclosures and rows that actually overflow remain interactive for native controls and scrolling. Standalone `music-staff` and `music-measure` surfaces retain their existing SVG pointer targets.

`getLayoutGeometry()` returns the completed projection's identity, revision, score ID, and system geometry, or `undefined` while rendering is pending or invalid. Systems expose complete SVG dimensions, visible ink, measure ranges (end exclusive), staff/measure lanes, event/annotation/tuplet bounds, and insertion anchors with exact rational onsets. Coordinates belong to each system's SVG viewBox; transform them through that SVG's screen matrix for overlays. Generated implicit voice IDs are not persistent edit addresses: retain actual staff, measure, and event IDs plus the voice's position. Recheck projection identity and revision before using geometry after an edit or resize.

The renderer also exposes each attached marking in `SystemGeometry.markings`, with its own `sourceId`, owning `eventId`, final bounds, and resolved placement. Its SVG group carries those two identities. `getSource(markingId)` resolves the child element, but `getHitRegions()` still contains rhythmic events only; marking children are not extra attacks. Author resolves a selected marking to its owning event.

Rendered events also expose `noteheads`: painted head bounds and centers in original `MusicEvent.pitches` order, including displaced chord seconds. Rhythm notes, road events, rests, and slashes have no pitched heads. These bounds exclude stems, flags, dots, and accidentals; `anchorY` remains the staff center and must not be mistaken for a note's pitch. Check `notation` before interpreting staff geometry: a rhythm staff has coincident top/bottom lines; a three-roads staff has a full five-line span but still has no absolute pitch positions. Its underlying `staffSpace` is 10px, so adjacent visible roads are 20px apart. The Author workspace uses this geometry for its separate pointer controller. The notation elements themselves remain source/rendering components and acquire no editing gestures.

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

Check `Staff.notation` before interpreting its clef/key fields. For compatibility, rhythm and three-roads models retain neutral `clef: 'treble'` and `key: 'C'` defaults, but these do not describe a printed clef, a pitch mapping, or a tuning reference. Canonical HTML omits that irrelevant pitch context. A rhythm event has `kind: 'rhythm'` and `pitches: []`. A road event has `kind: 'road'`, `pitches: []`, and required `pitchDirection: 'higher' | 'same' | 'lower'`; no other event kind may carry `pitchDirection`. Its `rhythmic` flag stays false, as that flag belongs only to slash events. `validatePitchDirection` validates the explicit vocabulary, without substituting a direction.

Serialization emits canonical, explicitly closed HTML with model IDs, voices, and tuplet structure. It preserves supported musical data, not original indentation, comments, application metadata, CSS, or root layout preferences. Save those separately if your editor needs them. It throws when a programmatic model cannot be serialized without losing musical information.

Errors include malformed values, unknown notation, conflicting attributes, unbalanced groups, and incorrect measure duration. The root retains a textual representation and diagnostics when engraving would be misleading. Each diagnostic has a `sourceId` that can be resolved back to the authored element. Fix errors before treating the result as a performable score; short drafts should be marked `incomplete` deliberately.

## Scope

Quarter-tone notation is limited to the documented 24-EDO spellings and one accidental family; the rhythm staff is a fixed single-line, pitch-free part. The three-roads staff is a specific graphic scoring vocabulary for prescribed rhythm and relative pitch direction, not a general drawing surface. Articulations, ornaments, and relative harmony figures are limited to the vocabulary above; ornament accidentals, trill extension lines, and realized ornament playback are not implemented. The system does not yet implement arbitrary tuning systems or cent values, instrument transposition, independent polymeter, cross-staff beams, cross-bar tuplets, general slurs, other arbitrary graphical scores, automatic rhythm rewriting, or playback. The separate [Author workspace](author-workspace.md) provides visual editing of the supported grammar. Chord symbols remain authored text, not analyzed or transposed automatically. The [design review](design-review.md), [notation expansion review](notation-expansion.md), and [markings review](event-markings.md) record the reasoning and acceptance checks.
