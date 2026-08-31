# Event markings and interval harmonies

Articulations, ornaments, and relative interval harmonies are children of the event they describe. They are musical data with their own source IDs, not free text positioned near a staff. They consume no additional time and do not generate playback or a chosen realization of a three-roads pitch.

```html
<music-note pitch="C5" duration="quarter">
  <music-articulation type="staccato"></music-articulation>
  <music-ornament type="trill"></music-ornament>
</music-note>

<music-road direction="same" duration="half">
  <music-interval value="5" placement="above"></music-interval>
  <music-interval value="b3" placement="below"></music-interval>
</music-road>
```

These are event fragments to place in the appropriate pitched or three-roads staff. Keep custom-element closing tags explicit. Markings belong directly inside their event; they do not declare separate `duration`, `dots`, `onset`, or tuplet membership.

## Articulations and ornaments

| Element | Supported types | Placement |
| --- | --- | --- |
| `music-articulation` | `accent`, `staccato`, `tenuto`, `marcato`, `staccatissimo`, `fermata` | Opposite the printed stem; above when there is no stem. |
| `music-ornament` | `trill`, `turn`, `inverted-turn`, `upper-mordent`, `lower-mordent` | Opposite the printed stem; above when there is no stem. |

This placement rule applies to every standard marking, including fermatas and ornaments, in every voice. An up stem places the marking below the head; a down stem places it above. The renderer uses the stem actually drawn, including beamed stems. Whole notes, rests, and other stemless events put standard markings above; hidden or virtual stems do not count. Harmony figures keep their independently authored direction, so a `b3` below a road does not pull its staccato or tenuto below the head.

Legacy `placement` attributes on articulations (`auto`, `above`, `below`) and ornaments (`above`, `below`) remain accepted and round-trip unchanged, but cannot override automatic engraving. Omit them in new markup. Author offers a type control and explains the automatic side; only interval figures need an above/below direction control.

Notes, chords, one-line rhythm notes, road events, and rhythmic slashes accept articulations. Rests and open improvisation slashes accept only a fermata: other articulations would imply a prescribed attack or release that those events do not carry. Ornaments need a single pitched note or a road event's chosen main pitch. A chord does not identify which of its pitches receives an ornament; use a separate pitched voice to make that target explicit.

Do not repeat the same articulation or ornament type on an event, even on opposite sides. Different types remain explicitly authored choices; the renderer does not decide whether a combination is appropriate for the intended performance. An unknown type or unsupported event/type combination is diagnosed rather than silently drawn as a substitute.

Staccato describes the performed release without shortening the written value or inserting a rest. A fermata does not change exact model time or assign a hold length. Ornaments are notation signs: the API does not supply auxiliary pitches/accidentals, grace-note realizations, trill speeds, delayed ornaments, or spanning trill lines. On a road event they refer to the chosen main pitch; their auxiliary tones never update the next road's reference or become new harmony anchors.

The adapter uses the bundled music font's actual [SMuFL articulation glyphs](https://smufl.formats.music/latest/tables/articulation.html) and [common ornament glyphs](https://smufl.formats.music/latest/tables/common-ornaments.html). In particular, inverted turn uses `ornamentTurnInverted` (U+E568), upper mordent uses the unbarred `ornamentShortTrill` (U+E56C), and lower mordent uses the barred `ornamentMordent` (U+E56D). These names avoid the ambiguity of an engraving engine's shorthand aliases. A staccato uses an articulation glyph, not an augmentation dot that could change the apparent rhythm. MusicXML likewise represents [articulations as note notation rather than rhythmic events](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/articulations/); this project does not implement MusicXML interchange.

## Interval figures on three-roads events

`music-interval` is valid only as a direct child of `music-road`. Its `value` is an interval number **1 through 13**, optionally prefixed by one `b` or `#`. Its `placement="above"` or `"below"` is required because it gives the musical direction from the main pitch, not just a display preference.

| Figure | Meaning |
| --- | --- |
| `5` above | A perfect fifth above the current main pitch. F can add C above. |
| `b3` below | A minor third below the current main pitch. Bb can add G below. |
| `#11` above | An augmented eleventh above, retaining its compound distance. |
| `13` below | A major thirteenth below, not a sixth within the same octave. |
| `1` | Explicit unison; above/below still chooses where the figure is printed. |

The F/C and Bb/G examples are possible realizations of the user's rule, not absolute pitches stored in a road event. A figure is an interval number, not a count of semitones. Unaltered 1, 4, 5, 8, 11, and 12 use perfect quality; the other supported numbers use major quality. `b` reduces the interval's magnitude by one semitone and `#` increases it by one, **before** applying the above/below direction. Thus `b3` below means a three-semitone descent; it does not flatten the destination note independently. Compound 13 retains its 21-semitone magnitude before alteration.

Unicode `♭` and `♯` prefixes are accepted aliases and canonicalize to `b` and `#`. Zero, signed integers, leading zeroes, values above 13, double alterations, and other quality aliases are rejected. `b1` is rejected because its negative magnitude would reverse the declared direction. Each interval element contains one figure; author several children for several harmony notes.

Every interval is measured **independently from this event's chosen main pitch**. They do not form a chain from one harmony note to another. Duplicate canonical figures on the same side are rejected; a figure above and the same figure below are distinct instructions. Differently spelled intervals are not collapsed merely because they can have equal semitone distances.

All added harmony notes share the road event's onset and written duration. They do not enter `MusicEvent.pitches`, acquire independent voices, or become the next road's melodic reference. After a road attack, retain its **main pitch** as that voice's reference; rests preserve it. The road movement between successive main pitches remains free, while the explicitly added harmony intervals are prescribed.

Figures are centered near the actual slash head on the declared side. Collision handling may move them farther outward or slightly away from an intersecting stem, but must preserve their association with that head and never flip an interval to the opposite side. They are not staff-wide directions. Existing `music-harmony` remains literal chord-symbol text; a string such as “5” there is not reinterpreted as an attached interval.

## Ties and performance meaning

Every tied road segment must explicitly carry the same complete interval set, including above/below placement. The validator compares musical values, not child IDs or their source order. Nothing is silently inherited. Adding, removing, or changing one interval halfway through the tie would require a separately modeled harmonic attack and is rejected. A tied road continuation must still use `direction="same"`; the main pitch and its harmony notes are held without another attack.

Articulations and ornaments remain on exactly the tied segment where the author puts them. They are not automatically moved, copied to all segments, or turned into new attacks. Review the performance meaning: put force markings such as accent/marcato at the attack, duration/release markings at the end of the tied sound, and a fermata where the hold is intended. The [Dorico engraving discussion of tied-note articulations](https://blog.dorico.com/2014/12/development-diary-part-nine/) explains that useful distinction; this implementation leaves the placement explicit instead of automatically relocating it. A mark on a tied continuation does not cancel the tie.

The workbook's study 11 deliberately puts an accent on the road tie's first event and a tenuto on its final event. Both ends explicitly repeat the same `5` above and `b3` below, with their child order reversed to show that order is not harmonic meaning.

## Identity, editing, and accessibility

`MusicEvent.markings` is an optional array of articulation, ornament, and interval records. Each has an `id` and `kind`; articulations/ornaments carry their supported `type`, while an interval carries `{ number, alter }` plus its required direction. Omitted or empty markings mean none. Markings do not add elapsed time or alter onset arithmetic, including inside nested tuplets.

Canonical HTML preserves marking values and child source IDs. Attribute/property edits follow the same parsing path. A bad marking produces a diagnostic tied to its source instead of leaving plausible but wrong notation. Parts retain the complete markings attached to their retained events, regardless of where a staff-wide legend was originally written.

Rendered marking groups carry their source ID and owning event ID. `getSource()` resolves the child to its original element. Event hit regions remain event-based; the completed system's separate marking geometry exposes the child ink for inspection and selection. Selecting a marking must preserve its own identity while allowing Author to identify the event it modifies.

On `music-system`, the SVG and all its descendants have `pointer-events: none`. For a fitting score, pointer inspection reaches the source system host instead of a generated glyph or hit rectangle. The component resolves score clicks using current projection geometry and still emits `notation-select` with the precise source ID. A handled coordinate click is default-prevented so Author does not replace it with a blank-measure selection. Text disclosures and overflowing rows retain pointer events for native controls and horizontal scrolling. Standalone staff and measure surfaces retain their existing SVG selection targets.

Accessible text names each articulation/ornament without announcing an obsolete legacy placement value, and describes interval quality and above/below direction relative to the main pitch. It must distinguish the main road choice from its harmonies and from an ornament's unmodeled auxiliaries. Attach the main-reference rule and any required performance instructions to the relevant staff or explicitly scope them to extracted parts.

## Verification

Study 11 adds one mixed pitched/three-roads score; the workbook now has **11 studies and 12 score views**. The first ten examples retain their music; study 10's prose now says “last main pitch” to remove ambiguity when harmonies or ornaments are present.

With the development server running, open `/tests/event-markings-browser.html` and select **Run event marking checks**. Its visible fixtures and `#event-markings-browser-results` output check actual glyph mappings, interval placement on all three roads, marking/source identity, dense combinations with beams/tuplets/ties, exact timing, roundtrips, live mutations, parts, and responsive/fixed-print geometry. The tied-harmony fixture must reject a changed or missing interval and recover after repair.

Run `npm test`, `npm run typecheck`, and `npm run build` for the model, DOM, components, Author integration, and adapter. Inspect the workbook and dense fixtures at wide, narrow, and fixed print widths. Containment alone does not establish readable relationships: review the distance from each figure to its head, accidental/number spacing, articulation order, ornament clearance, and tie continuity.

Verified on **2026-08-28**, after the stem-placement and pointer-inspection changes, with the bundled fonts and the in-app browser:

- The full suite passed **2,444 tests in 58 files**; TypeScript checking and the production build passed.
- All **60 browser checks** passed: event markings **8/8**, foundation **35/35**, quarter-tone/rhythm **10/10**, and three-roads **7/7**. The foundation run covered 40 matrix cases and 4,342 visible-ink bounds comparisons across 383 rendered systems.
- Placement checks use actual painted stems, including beamed notes. Contradictory legacy placement attributes do not override the rule; stemless whole notes and full-measure rests place marks above in both voices. The workbook's second road staccato and final road tenuto both appear above their downward stems while lower harmony figures stay below. The completed study was also reviewed visually.
- Pointer checks verify that every generated system SVG descendant is inert and that browser hit testing reaches the host, or an interactive overflow row. Geometry still selects precise event and marking source IDs once per click. Disclosures, horizontal scrolling, fixed print preview, cached print geometry, resize recovery, and invalid-source recovery also pass. These checks dispatch synthetic clicks after browser hit testing; they do not qualify trusted operating-system input.

An earlier production Author check on the same date rejected an invalid `14` interval, applied four attached markings as one change with Undo/Redo, changed an articulation to staccato, and retained markings in canonical source. A composed synthetic click through both score shadow roots selected an interval's owning event and populated its editing controls. That earlier check used the previous SVG pointer targets; the current geometry-routing regression replaces that pointer assumption. Direct browser-bridge inputs reported `isTrusted=false` and were not qualified as native pointer input.

There is no ornament realization, automatic harmonic voicing, playback, retuning, independent timing for harmony notes, or automatic articulation relocation across ties. Browser checks do not certify native printing, saved PDFs, physical page turns, every dense score, or every browser. Record actual run results separately from these acceptance requirements.
