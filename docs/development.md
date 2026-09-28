# Music Notes development contracts

Read the sections relevant to the behavior being changed. [AGENTS.md](../AGENTS.md)
is the concise repository entry point; this guide preserves the detailed
contracts previously kept in `.augment-guidelines`.

This library treats readable custom HTML elements as authored musical data. Preserve that API and the source DOM; do not require coordinates, engine-specific strings, or generated graphics to author music.

## Architectural boundaries

- `src/model` is independent of the browser and engraving engine. Its readonly, serializable data uses exact rational time in whole-note units. Written values and dots remain separate from elapsed duration after tuplet ratios.
- `src/dom` parses and serializes the documented grammar. It resolves inherited musical context, gives source nodes stable identities, and reports invalid or unsupported input without guessing a replacement note. Canonical serialization preserves the model, not incidental HTML formatting or metadata.
- `src/engraving/semantics.ts` handles accidental state and beam membership. `layout.ts` chooses shared measure columns and complete system breaks. Both are pure and tested without SVG.
- `src/engraving/render.ts` adapts validated music to the pinned VexFlow SVG engine. It owns voice alignment, ties, annotations, and final bounds. `geometry.ts` measures painted text/shape bounds. Keep engine-specific behavior in the adapter.
- `src/components` provides native custom elements and property reflection. Only the outer music system/staff/measure renders; nested elements remain source data. One coordinator observes the complete source subtree, batches changes, handles async font races and reconnects, and exposes diagnostics, text descriptions, and source hit regions.

## Musical invariants

- Use rational arithmetic for onsets, meter capacity, dots, and nested tuplets. Never use floating-point equality for musical timing.
- Pitches are absolute spellings: F4 is natural even under a G-major key signature; F#4 is sharp. Legacy accidental attributes may specify an alteration but must not contradict a spelled suffix.
- Quarter-tone spellings use qf/qs/tqf/tqs for absolute alterations of -0.5/+0.5/-1.5/+1.5 semitones. Preserve the exact alteration through ties, edits, display state, and serialization; other tuning systems remain unsupported.
- A staff with notation="rhythm" has one line, no printed pitched clef/key, and pitch-free music-rhythm events. Do not fabricate a pitch or divide coincident top/bottom line coordinates to infer one. Rhythm ties continue duration in the same voice; open slashes still leave attacks improvised.
- A staff with notation="three-roads" paints only the original five-line staff's top, middle, and bottom lines, preserving the full span. music-road uses written slash-head rhythm and an explicit higher/same/lower direction relative to the last main pitch in its voice. Rests preserve that reference; harmony tones and ornament auxiliaries never replace it. Tied continuations must be same on the middle road and sustain without a new attack. It has no clef/key or absolute pitch geometry; never infer pitches from its full-height bounds.
- Event markings are structured children with stable source IDs, no elapsed time, and no separate tuplet membership. Articulations and ornaments use supported music glyphs; ordinary measure annotations remain separate. Rests/open slashes accept only fermata, pitch ornaments target a single note or road main pitch, and interval harmonies attach only to roads. Reject duplicate types or repeated interval/side pairs rather than dropping them.
- All standard articulations and ornaments go opposite the actual painted stem, or above a stemless event, even in multiple voices. Legacy standard-mark placement values remain source-compatible but never override engraving; only interval placement retains musical above/below direction. Hidden or virtual stem objects do not count as printed stems.
- Interval figures use major/perfect distances 1 through 13 with at most one b/#. Alter distance before applying above/below: b3 below is -3 semitones. Preserve compound intervals and written spelling. Above/below is musical direction and must never flip for layout. Each tied road segment must repeat the same complete interval set; order and IDs may differ, but changing its sonority under a tie is an error.
- Meter grouping is in denominator units and must sum to the numerator. The displayed signature and its beaming groups are related but distinct.
- Tuplet ratios do not prescribe the number of DOM children. Mixed durations, rests, chords, and nested groups must retain exact time.
- A written whole rest is different from a full-measure rest. Pickups and incomplete drafts are explicit; no measure may silently overflow.
- An empty voice is accepted only in an explicitly incomplete, non-pickup measure and carries an empty-voice warning. Keep its source container, voice index and onset-zero insertion anchor without inventing rest or ghost events. Pending ties cannot cross unwritten voices. Empty drafts cannot be approved as short endings or ordinarily published; visibly marked draft output may include them.
- Ordinary single-voice rests retain conventional staff positions, including inside unbeamed tuplets. A rest must not follow a neighboring high pitch simply to align with it. If the engine shares one printed rest between voices, preserve both source identities and map both hit regions to that ink.
- Simultaneous onsets share one horizontal timeline across staves and voices. All staves use the same line and page boundaries.
- Repeated clefs/key signatures, accidental cancellation, proper beam levels, and ties communicate musical meaning. Do not approximate them with generic text symbols or geometric substitutes.
- Invalid or unsupported music must produce actionable diagnostics. Do not render plausible-looking wrong notation or silently drop unsupported constructs.

Measure notation after flags, dots, accidentals, beams, and ties have acquired their positions. SVG text bounds include unused font space; use actual canvas text ink metrics and native path/shape bounds, excluding transparent hit rectangles. Annotation clearances depend on overlapping horizontal spans. Charge repeated headers and incoming tie space only to the first measure of a system; connectors join final staff coordinates within that system.

Position interval figures relative to their own notehead before placing other markings and measure annotations. Include all marking ink in width, staff clearance, and final SVG/page bounds. Expose child marking geometry separately, retaining owning event IDs; getHitRegions remains an event-only rhythmic contract.

Keep music-system's generated drawing pointer-inert, including SVG descendants with engine hit-target attributes. Resolve score clicks at the host using current projection geometry and mark handled coordinate clicks as default-prevented. Author must not overwrite them with its blank-measure fallback. Preserve native disclosure controls and horizontal scrolling on rows that actually overflow.

## Authoring and lifecycle

Every documented property setter reflects its attribute, so HTML and programmatic edits take the same parsing path. Preserve properties assigned before element upgrade. Source changes include unknown attribute removal, text edits, insertion, removal, reordering, and ancestor context changes.

Keep callbacks and observers bounded and clean them up on disconnection. A stale asynchronous render must never overwrite newer data or resolve a newer render's completion promise. Await `renderComplete` for source edits and `refresh()` when changing containing layout and needing an immediate result.

Use the untransformed content width, normalized to whole CSS pixels. Viewport-only resizing may reuse the fixed print projection; source/options changes, refresh, reconnect, and errors must invalidate it. Responsive breaks remain deterministic for a given width, without history-dependent freezing.

System wrapping is automatic unless the author adds layout constraints. Infer a keep preference for a short opening pickup with a following bar, without changing the model or source attributes; explicit breaks, measure limits, and actual fit still take precedence. Do not infer new phrases or page turns from later short measures. Keep the automatic and author-directed gallery examples musically identical and free of unrelated layout differences.

Keep workbook controls in the demo controller, separate from score components. Before requesting printing, wait for a stable set of current roots and completion promises, inspect all diagnostics, and leave no asynchronous gap before the request. Errors block the request; warnings remain notices. A returned `window.print()` call proves neither an open dialog nor a printed or saved document.

Use safe text bindings for user-supplied prose; do not inject score text as HTML. Use `textContent` only in explicitly unbound, controller-owned mounts, never to replace a Lit-owned range. Follow the [UI ownership contracts](ui-state-architecture.md#ownership). SVG and its source map are projections, not the editable source of truth.

## Authoring application

Keep author.html and src/authoring separate from the notation workbook. Both use the same DOM grammar, exact model, and engraving adapter. Stage musical commands, validate the whole score, and commit one reversible transaction; preserve source identities and reject unsafe edits without changing accepted music. Unapplied source drafts remain recoverable and visibly distinct from accepted notation.

Use customizable native selects for every dropdown choice: real select/option elements with explicit values, a first-child button/selectedcontent, and appearance: base-select for both select and ::picker(select) inside feature queries. Preserve native accessible labels, keyboard behavior, form submission, and ordinary-select fallback. Do not introduce a scripted combobox replacement. Dynamic selectors use the same enhancement helper.

Use native popover="auto" with popovertarget buttons for nonmodal overlay menus. Keep details/summary for inline disclosures only. Preserve native dismissal and focus behavior; do not emulate a menu with a positioned disclosure or assign role="menu" to mixed form controls. Apply visible display styles only to :popover-open, bound overlays to the viewport, and provide an in-flow fallback when popovers are unsupported.

Direct staff editing belongs only to Author. Use measured per-notehead geometry, the effective measure clef, exact insertion anchors, and the active voice; never derive musical time by dividing pixel width or infer pitch from an event's staff-center anchor. Keep source unchanged during an engraved preview, validate a detached command, and commit once on release. Pitch drags preserve timing and explicit alteration. Cancellation, stale geometry, and no-op gestures add no musical history. Keep normal touch scrolling on the score; touch-action:none belongs only to deliberate drag handles. Synthetic routing/capture tests must not be reported as native touch or operating-system capture qualification.

Selected-note controls read accepted event properties independently of insertion fields. Accidental actions set absolute alteration while preserving letter/octave and display policy; rhythm actions preserve unrelated notation and exact tuplet ratios. Keep the selected source ID and revision explicit, reject stale actions, and show validation failures next to the control. Quick property changes are one undo step, no-ops are none, and unsupported tied/chord pitch edits must not guess or clear ties. Advanced Apply must bind its loaded values to a source ID and revision rather than silently reuse an earlier selection's form.

Authoring page preview and printing share measured SVG systems and a physical page plan. Page overflow and unapplied source block printing; unresolved musical drafts require an explicit marked draft print. A successful print request does not establish saved PDF output. Parts share source IDs and explicitly scoped instructions. Clear musical/page-turn reviews when relevant source or layout changes.

## Verification

Use the [root verification sequence](../AGENTS.md#setup-and-checks) for implementation changes, with a fresh production build before checking bundle budgets. Documentation-only edits need content and link checks. The [README verification guide](../README.md#verify) maps browser fixtures to behavior, including Author, shadow components, icons, notation, and Listen; these checks are separate from the unit suite.

For engraving changes, exercise the relevant `/tests/browser.html`, `/tests/notation-browser.html`, `/tests/three-roads-browser.html`, and `/tests/event-markings-browser.html` fixtures with the development server for real fonts/SVG, mutations, responsive layout, and print projections. Inspect affected workbook studies and ensemble layouts visually, including narrow widths and print preview. For Author or UI changes, use the applicable Author, shadow-component, native-option, or Listen fixtures listed in the README. Browser scripts require a separately running development server; use the repository's pinned Playwright package, matching browsers, and isolated recovery fixtures.

Containment tests alone do not establish readable spacing. Check harmony-to-staff distance, nested tuplet clearance, incoming tie length, rest positions, exact connector gaps, fractional-width scrollbars, and width A→B→A geometry. Fixed print geometry and source identities must survive native viewport-only resize events.

Exercise the actual workbook toolbar with all twelve scores as well as individual component fixtures. Intercepting `window.print()` tests only the request boundary. Print projections, a screen checkbox, and print CSS declarations do not replace visual inspection of real paginated PDF output.

Add regressions at the layer where a bug originates. Keep the supported scope and limitations in `docs/authoring.md` and the specialist acceptance records in `docs/design-review.md` and `docs/notation-expansion.md` accurate. Automatic page-turn optimization, polymeter, cross-staff beams, cross-bar tuplets, tuning beyond the supported quarter-tone vocabulary, and arbitrary graphical notation require separate model and engraving work; do not imply that a text direction implements them.
