# Quarter-tone and rhythm notation

This increment expands the existing musical grammar in two bounded ways: quarter-tone pitch spelling in 24 equal divisions of the octave (24-EDO), and an independent, pitch-free rhythm staff with one line. It keeps exact musical time, readable custom elements, part identity, and the source DOM as the editable score. It does not implement playback, arbitrary tuning, or a general percussion instrument map.

The later [3 roads music extension](three-roads.md) adds the user's separate relative-pitch notation: prescribed slash rhythms on the original top, middle, and bottom staff lines. It does not replace the one-line rhythm staff or the existing improvisation slashes. The record below describes the original quarter-tone/rhythm increment; the linked record describes the three-roads contract and its verification.

The music engraver, composer, and performer reviews shaped the design. The engraver requires actual music glyphs and honest staff geometry; the composer requires explicit sound/rhythm intent without losing spelling or timing; the performer requires readable changes, intact instructions in parts, and an unambiguous distinction between a new attack and a tied continuation. These are acceptance criteria, not a claim that every possible score has been visually certified.

## Musical and source contract

| Area | Supported meaning |
| --- | --- |
| Quarter-tone spelling | `qf`, `qs`, `tqf`, and `tqs` suffixes before the octave: `Fqf4`, `Fqs4`, `Ftqf4`, `Ftqs4`. |
| Pitch alteration | Absolute offsets of −0.5, +0.5, −1.5, and +1.5 semitones from the named natural. Existing natural, flat/sharp, and double accidental spellings remain unchanged. |
| Long accidental names | `quarter-flat`, `quarter-sharp`, `three-quarter-flat`, and `three-quarter-sharp`; an explicit pitch suffix must agree with a separate accidental attribute. |
| Engraving vocabulary | Stein–Zimmermann quarter-tone signs, with the existing automatic, always, and courtesy display policies. No arbitrary Unicode replacement or appended text arrow. |
| Staff mode | `<music-staff notation="rhythm">`; one actual line, no printed pitched clef or key signature. Omission or `notation="pitched"` retains five-line notation. |
| Rhythm event | `<music-rhythm duration="eighth">`; ordinary written notehead/flag/beam semantics with no pitch. Valid only on a rhythm staff. |
| Other rhythm-staff events | Rests, rhythmic slashes, open slashes, voices, and nested tuplets retain their separate meanings. Pitched notes and chords are rejected. |
| Rhythm ties | Consecutive rhythm events in the same voice may tie across bars and systems. The continuation extends duration without requiring another attack. It does not specify an instrument, pitch, or sound-production technique. |
| Context | Meter and grouping remain musical context. System clef/key defaults do not pitch a rhythm staff; local clef/key attributes on the rhythm staff or its measures are errors. |
| Projection | Canonical HTML/model output, standalone staff rendering, accessible descriptions, and source mappings preserve notation mode and pitch-free event identity. |

MusicXML expresses [pitch alteration in semitones, including fractional values](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/alter/), separately from its [notated accidental vocabulary](https://www.w3.org/2021/06/musicxml40/musicxml-reference/data-types/accidental-value/). This project adopts a smaller vocabulary with one explicit interpretation. The four chosen symbols are [SMuFL Stein–Zimmermann accidentals U+E280–U+E283](https://smufl.formats.music/latest/tables/stein-zimmermann-accidentals-24-edo.html). Their font availability does not establish support for other tuning systems.

Staff appearance and pitch meaning are also separate. MusicXML provides [staff line count](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/staff-lines/) and [unpitched events](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/unpitched/) independently; [LilyPond's rhythm staff](https://lilypond.org/doc/v2.26/Documentation/notation/displaying-staves.html) retains written durations on one line. Here the explicit rhythm event prevents a fabricated pitch from leaking into editing, accessibility, serialization, or a future playback layer.

## What a performer needs to read

Quarter-tone signs must be distinguishable from ordinary flats/sharps, including in chords, repeated notes, courtesy parentheses, and narrow systems. A natural cancels the complete alteration. Barline reset, octave distinction, simultaneous conflicting voices, and ties keep the existing accidental-state rules. A continuation tied across a barline must not suppress an accidental needed by a later untied attack.

Two different alterations at the same chord position retain separate heads, with their original pitch identities. The adapter cannot represent three or more pitches at the same letter and octave without losing readable head assignment; `unsupported-chord-cluster` therefore rejects that case for ordinary and quarter-tone pitches alike. Use musically appropriate distinct spellings/staff positions or separate staves for larger clusters.

The score should name its convention. The workbook's pitched part carries the short instruction “24-EDO; quarter-tone signs.” The nearby explanation specifies ±50 and ±150 cents relative to the natural. The rhythm staff is labeled “Claps” and its demonstration is untied; a separate rhythm-reading fixture demonstrates held durations and ties. A single line by itself is not a percussion sound assignment.

Each part must retain its own required instructions. When rendering a staff on its own, retain its local instructions. If a required legend was written on another staff, include it explicitly in the standalone source. A legend appearing only in the full-score heading does not establish that a separately printed part is self-contained.

Ordinary rhythm notes prescribe attacks and durations. Rhythmic slashes prescribe rhythm with slash heads; open beat slashes leave the attacks to the performer. A tie is a continuation, not a repeated attack or a slur. Rests still mean written silence, with whole-duration rests distinguished from full-measure rests. In 7/8, a full-measure rest lasts exactly 7/8; a whole-duration rest lasts one whole note and overflows a complete bar.

The accessible text should identify a “single-line rhythm staff” and “rhythm note,” not a treble clef or a placeholder B4. Quarter-tone pitches need names in words, while exact onset, elapsed duration, tuplets, and tie status remain available. Pitch controls must not act on rhythm notes. A one-line staff's top and bottom coordinates coincide; geometry consumers must not divide that zero height to infer pitch.

Changing a pitched staff to rhythm notation requires an explicit source edit that keeps every event valid for the resulting staff. A notation-mode change does not silently convert pitches. Tied passages need a complete validated source edit that changes staff/event kinds together without dropping the chain. Model consumers must inspect `Staff.notation`: neutral treble/C compatibility fields on a rhythm staff do not give its events pitch.

## Demonstration and exact time

Study 09 in `index.html`, “Quarter-tones and a clapped pulse,” added one mixed two-staff score without altering the original eight studies or the paired ensemble comparison, bringing that increment to nine studies and ten score views. Three-roads music followed as study 10, and [event markings with interval harmonies](event-markings.md) as study 11. The current workbook has eleven studies and twelve score views.

Both parts use 7/8 grouped 2+2+3. The upper part moves among F natural, F quarter-sharp, F sharp, F quarter-flat, then demonstrates three-quarter alterations. The lower part shows ordinary pitch-free heads, silence, mixed beam levels, and a mixed-value 3:2 tuplet. Its second bar contains:

| Group | Written events | Elapsed time in whole notes |
| --- | --- | --- |
| First 2 eighths | Sixteenth attack + sixteenth attack + eighth rest | `1/16 + 1/16 + 1/8 = 1/4` |
| Second 2 eighths | Quarter attack + eighth rest inside 3:2 | `(1/4 + 1/8) × 2/3 = 1/4` |
| Final 3 eighths | Dotted-quarter attack | `3/8` |
| Complete measure | All three groups | `1/4 + 1/4 + 3/8 = 7/8` |

The tuplet deliberately has two children: the ratio counts written units, not DOM children. Both parts end with full-measure rests, and their simultaneous onsets must align wherever they coincide. Tuplets retain exact rational arithmetic; there is no second timing system for rhythm staves.

## Acceptance matrix

| Review | Required evidence |
| --- | --- |
| Engraver: symbols | All four quarter-tone glyphs are actual bundled music-font glyphs; ordinary natural cancellation and courtesy signs remain readable. |
| Engraver: one line | Each rhythm measure draws one staff line, no pitch clef/key, ordinary heads on the line, and stems/flags/dots/beams that match written values. |
| Engraver: rests and bars | Whole rests hang below and half rests sit above the sole line; full-measure rests are centered. Barlines have visible extent above/below the line and repeat dots straddle it. |
| Composer: semantics | Pitch suffixes and aliases agree; unsupported alterations and pitched/rhythm mixing fail with actionable diagnostics. No conversion silently erases pitches. |
| Composer: time | Written values/dots survive; mixed-value and nested tuplets retain exact ratios; measure capacity, pickups, and simultaneous voices remain exact. |
| Composer: ties | Pitch-free tie chains preserve all source identities and voice order, including both halves at a system boundary; incompatible tie endpoints are rejected. |
| Performer: continuity | Pitched and rhythm staves share system ranges and common onset positions. A line break does not lose a tie, annotation, or measure. |
| Performer: parts | When rendering selected staves, retain their notation, source order, relevant legend/action instruction, and exact events. Pitch spelling is not transposed. |
| Performer: accessible score | Transcript names accidentals and rhythm notes without implying pitch on a rhythm event; invalid source produces a diagnostic. |
| Layout and publication | Narrow → wide → narrow rendering is deterministic; screen-only resize does not change cached print geometry or source identities. Final pages still require human review. |

## Verification workflow and limits

Run `npm test`, `npm run typecheck`, and `npm run build` for the model, grammar, components, and adapter contracts. With the development server running, open `/tests/notation-browser.html` and select **Run notation expansion checks**. Its ten checks use visible fixtures for actual glyphs and SVG geometry, conflicting microtonal voices and same-position chords, source coverage, rests, ties, tuplets, common onsets, source edits, and fixed print projection stability across native container resizes. The page exposes a machine-readable report in `#notation-browser-results`.

Inspect the visible fixtures and study 09 at desktop, narrow, and fixed print widths. Check accidental legibility, rest orientation, tie lengths, line/meter alignment, annotation spacing, and the standalone staves' instructions. A passing geometry assertion is evidence for that fixture, not proof of good optical spacing for every score. The browser suite does not open a native print dialog or certify a saved PDF, physical paper, page turns, all browsers, or all dense polyphony.

### Recorded browser checkpoint — 2026-08-28

The in-app Chromium checkpoint included distinct-head assertions for conflicting microtonal voices and a same-position chord, as well as the displaced dotted/plain half-rest case. This is historical browser evidence; rerun the checks above for this snapshot.

The music engraver visually reviewed the workbook and focused fixtures at 1280 × 720. The four accidental signs, mixed-staff alignment, ordinary rhythm heads, one-line rest orientation, barlines/repeat dots, both halves of a held rhythm tie, mixed tuplets, and separate slash meanings were accepted in those examples. Displaced rectangular rests retain supporting ledgers and their dots sit away from those ledgers.

The review also caught two hazards that simple glyph-presence tests miss. Differently altered pitches in simultaneous voices must not share one head; the adapter preserves separate heads for those conflicting spellings. Two heads on one chord stem may meet at the stem: the reviewed half-note heads have 12px painted widths and 11.05px center separation, a 0.95px overlap at that shared join. The assertion permits at most one stem width of overlap for the chord, while retaining the stricter independent-voice check. Three or more pitches at one chord position remain explicitly unsupported.

This evidence covers the stated fixtures with the bundled fonts. It does not certify arbitrary dense music, other accidental systems/fonts, native printing, saved PDFs, paper output, or page turns. The supported contract and its validation evidence must remain distinct when extending the system further.

Future work may model other equal temperaments, explicit tuning ratios, alternative accidental families, percussion instrument/position maps, other staff line counts, or playback interpretation. Those need their own model and engraving decisions. They are not enabled by passing arbitrary numbers or symbols through the current API.
