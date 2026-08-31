# Author layout review — 2026-08-28

The revised writing surface is implemented. The [writing-surface checkpoint](#writing-surface-implementation-and-resumed-browser-review--2026-08-28) records its resumed browser review; the [Document-menu checkpoint](#document-menu-positioning--2026-08-29) records the latest correction. The preceding layout audit and cycle entries retain their historical measurements and permission state; they do not describe the current interface or access status. The ledger locks requirements before fixes and distinguishes code, browser, device and publication evidence.

The full specialist review puts composing tasks ahead of the tool taxonomy. The Golden Krishna analytical lens pushed for removing routine setup and navigation, computing known musical context, and remembering the musician's working state. This applies the book's [published principles](https://www.nointerface.com/) to this editor; it is not participation or endorsement by the author. The engraver, composer, performer, design lead, IA specialist, editor-state reviewer, and browser-test reviewer contributed the safeguards and task criteria below.

## What the original layout cost

The audit used the actual Author page in the existing isolated eight-measure visual fixture. The page was returned to its document top, the note popover was closed, and no tool disclosure was open unless stated. Measurements are CSS pixels, taken from DOM bounds; they are not inferred from a screenshot.

| Viewport and state | Top of notation container | Consequence |
| --- | ---: | --- |
| 1180 × 660, all inspectors closed | 711.5 px | No notation appears in the initial viewport. |
| 1180 × 660, Measure inspector open | 1321.3 px | Opening one tool moves the notation another 609.8 px down. |
| 390 × 660, all inspectors closed | 1265.8 px | The initial phone screen is entirely controls. |

At desktop width the header takes 106 px, composition details 84 px, and the writing-tools box 205 px. Inside the score container, another 87 px of gesture tools and 71 px of navigation precede the caption and notation. On the phone the writing-tools box alone takes 618 px. Exact values depend on text, viewport, and current state; this is one reproducible baseline, not a browser-wide performance result.

The problem is hierarchy, not the size of the staff. Opening several disclosures can amplify it indefinitely. Replacing them with tabs in the same position would prevent stacking, but would still leave a large form between the musician and the score.

## Recommended arrangement

Keep a compact application header with the composition title, Write/Read/Pages, Undo/Redo, recovery status, and Document. Move extended metadata editing and score setup into Document; keep the title readable. Ordinary composing, correcting, and inspecting must work in Write without changing to Read just to see the music.

Put the score next, with one integrated control area at its edge. This replaces the current entry strip, entry help, gesture tools, navigation, and repeated selection captions; it is not an additional row on top of them.

| Working state | Visible local controls |
| --- | --- |
| Select | Select / Enter notes, one labelled location control, scoped capacity, Tools, and Edit note when one event is selected. Show pitch drag only for an eligible note, not an inert placeholder. |
| Enter notes | Mode, native Write kind and note value, a compact next-event control showing pitch/alteration, dots and insertion position, one primary Insert action, location/capacity, and Tools. Keep deliberate drag available without a duplicate row of help and controls. |
| Full final voice | When eligible, the explicit Add measure and insert action occupies the primary Insert slot; it does not become another permanently displayed button. Enabled continuation keeps the destination visible in the same area. |
| Working in a tool panel | Explicitly enter Select, park the insertion settings/location, and collapse entry-only controls. The panel shows its target and relevant fields. Selecting another bar does not close it. |
| Browsing away from selection | Keep the selected location named. Show Return to selection only when it is offscreen. Scrolling never retargets an edit. |

One location control exposes staff/bar/voice navigation and local musical actions; do not keep three expanded selectors in the strip. Use a plain label when there is only one staff or voice. Keep active score/part identity visible. Add measure remains reachable from this local context, including while a tool panel is open. Consequential nondefault settings such as dots and Before/Replace must not disappear behind an ambiguous preset label.

Prototype these rendered limits, rather than treating the table as permission to display every item: at most two desktop rows within approximately 104 px; phone Enter controls within approximately 144 px including context; short-phone Select within approximately 104 px. Preserve usable 44 px targets. Remove duplication and irrelevant controls before wrapping into another row or shrinking text.

The score takes the main column. On wide screens, the optional tool dock takes approximately 320 px on the right and scrolls internally. Allow it to remain open throughout a deep session. Opening or closing it may reflow the score once; switching tabs must not change score width or cause further wrapping. The exact scroll-restoration contract is below.

Only pin the dock when approximately 720 px of score width remains. On narrower screens, use a persistent, bounded bottom tool pane in the workspace layout, initially closed. It occupies a reserved viewport region, not the end of the entire long document; score and form content scroll independently. The pane reserves space rather than covering notation and stays open while another bar is selected. Four tabs and Hide remain reachable above its scrolling content. Do not squeeze a permanent sidebar beside phone notation or shrink the music.

On short screens or with the software keyboard present, allow deliberate Expand task / Return to score while preserving the draft and musical position. Do not promise that an entire ensemble, form, and keyboard can fit together. Document, entry settings, and quick Edit note remain transient native popovers. Persistent tools are not an auto popover: clicking the score would dismiss it and force repeated reopening. This distinction follows the [native popover behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover). Every dropdown still uses the customizable native-select contract and ordinary-select fallback.

An unfinished voice is normal writing state, not a fresh alarm after every note. Show one concise capacity/issue summary and its useful next action. Pending Source and recovery failures remain visible; detailed diagnostics open through a reachable Review action. Do not duplicate warnings across multiple banners or allow their details to recreate a permanent wall above the score.

## Primary composing tasks

The tabs organize secondary capabilities. They must not become a prerequisite for these tasks:

- **Write a phrase:** configure once, then enter pitches repeatedly with note value directly reachable. The native Write choice exposes Note, Chord, Rest, Rhythmic slash, and Open slash, mapping to the existing grammar. Their distinction is not hidden behind an unrelated checkbox. Changing it affects the next entry only; passage conversion remains explicit.
- **Correct and resume:** Select note → Edit note → change accidental remains the three-activation route. Selection through the staff, list, or arrows must not copy that event into the insertion recipe. Retain the independent previous insertion point. After correcting bar 2 while writing bar 8, the existing Enter control can offer **Resume at bar 8**, with staff/voice named before entry. Resuming and starting at the newly selected location are deliberate choices, not a hidden guess. If the old point no longer exists, ask for a new location without losing the recipe.
- **Write harmony:** a score-local Add chord symbol action opens the same Markings panel directly, with the selected staff, bar, and exact onset supplied. It bypasses Tools → tab → Kind setup. Show only chord-symbol fields; tempo BPM, beat, and dots appear only for tempo. Keep kind, placement, and recipients during a pass through the score. Add & next bar or Apply & next bar commits first, advances only to an existing bar, and focuses the text field again. Failure neither advances nor clears text. At the final bar it stays there; it does not append music. Editing an existing annotation uses its ID; adding does not silently overwrite one at the same onset.
- **Place an instruction:** At bar start and Use selected note's current position avoid asking the musician to calculate an onset the model already knows. The latter captures an exact fixed onset; it is not an attachment that follows future note movement. Keep exact fractions available for other positions. Reuse explicit scope choices; never infer instrumentation, harmonic content, or improvisational duration.
- **Work on a form:** selecting another musical location leaves the active tab unchanged. Pristine fields follow the appropriate target; unfinished fields retain their original target. Immediate discrete choices remain immediate and reversible; grouped changes can retain Apply without a preliminary Load step.
- **Extend a composed section:** place whole-column duplication under Measure with a bar-range operation such as Duplicate bars 1–8 across the score. Do not require two event-list selections to express a measure range. This uses the existing structural command; it does not generate an arrangement or interpret a vamp cue.

## Tool families and tab behavior

The revised recommendation is four editing tabs, with descriptive headings inside the panels:

| Tab | Panel contents |
| --- | --- |
| Edit | Advanced selection editing: the selected event's own fields, accidental display, stems, beams, and removal. |
| Rhythm | Passage selection, ties, tuplets, conversions, and explicit rest filling. |
| Markings | Harmony and instructions: chord symbols, directions, rehearsal marks, dynamics, and tempo. |
| Measure | Meter, grouping, key, clef, barlines, voices, pickups, and measure operations. |

Score-wide staves, instrument labels, and part definitions move to Document → Score setup. Contextual setup actions may open the relevant section directly, while the active viewed part remains visible beside the score. Passage and tuplets belong together under Rhythm. Small inline disclosures can remain inside a panel for optional detail; they no longer control the primary workspace layout. Four tabs are a ceiling for the present work, not a reason to add content.

Implement actual linked `tablist`, `tab`, and `tabpanel` semantics, not roles added to independently expandable disclosures. There is one active tab and one visible panel. Use roving tab focus, Left/Right and Home/End navigation, Enter/Space activation, and normal Tab movement into panel content. Manual activation keeps arrowing across lengthy forms predictable; keep the panels mounted and ready. Native fields retain their normal keys. This follows the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

Show/Hide tools is independent: hiding the pane must not leave all tabs unselected. Remember the chosen tab, pane visibility, and each panel's scroll position during the session, including a return from Read/Pages. Returning to Write restores its prior persistent pane state but no transient popover or gesture, and starts in Select. Passive selection must not open the pane or switch tabs; an explicit Add chord symbol action may intentionally open Markings.

Show tools focuses the active tab; a direct task action focuses its primary field. Hide returns focus to the invoker without scrolling or discarding drafts. Apply stays at the working control. Return to selection deliberately reveals and focuses the named music; it is not the same action as Hide. If a focused control becomes unavailable, move focus to a visible related control. Reasons for blocked actions and their recovery routes must not depend on a tooltip or an unfocusable disabled button.

## Deep-session editing safety

Advanced Edit must own its event fields rather than sending the user to the insertion form elsewhere. `syncPanels()` currently refreshes several fields on selection/session updates; replacing disclosures must not introduce remounts or further resets.

| Form state | Required behavior |
| --- | --- |
| Pristine | Bind automatically to explicit selection and refresh accepted values. No routine Load action. |
| Dirty, another target selected | Keep the draft and name its original target; never quietly retarget it. Provide Return to target and explicit Discard/start here when needed. |
| Unrelated source or metadata change | Preserve the draft. Revalidate its target and relevant dependencies; do not require reload merely because a global revision changed. |
| Edited field or relevant musical context changed | Keep the draft, explain the local conflict, and require review before applying. If safety cannot be established, fail conservatively. |
| Apply | Validate against the current source and revision, apply only the intended dirty fields, and preserve untouched accepted properties. Commit one transaction. |

This is dependency-aware validation, not removal of identity/revision guards. Bind drafts to the document identity as well as source IDs, since different projects may reuse IDs. Immediate note edits and transient gestures retain strict bindings. The quick note editor's local Undo must never consume a foreign metadata or musical history action; close/reset that local scope when another accepted transaction intervenes. Long-lived form drafts do not grant stale handlers permission to commit.

Tab choice, panel scroll, pane visibility, and the continuation preference are workspace preferences, not musical history. They must not alter document revision, Redo availability, or recovery status. Cancel transient gestures before geometry changes; never commit them during layout restoration. An open dirty tool pane survives a wide-to-narrow layout change as the same working session; closed tools never open merely because the viewport changed. Source remains reachable without scrolling through the score, with its pending indicator and Apply/Revert protections. Pending Source blocks musical mutations, not inspection or recovery.

Initially, inspector field drafts are preserved within the open editor session; do not imply that local recovery or a downloaded project includes them. Mark them as unapplied/not saved, warn before discarding them on project replacement or page exit, and distinguish them from accepted music and the already recoverable Source draft. Cross-reload inspector-draft recovery is a separate enhancement unless explicitly implemented and tested.

## Scrolling and musical context

Selection, insertion position, and the music currently in view are separate state. If bar 8 is selected while the musician inspects bar 48, opening, switching, or hiding tools must retain bar 48 and its visible staff, while selection and Add measure still target bar 8. Only an explicit navigation/Return/Resume action or accepted entry that needs revealing may move to the edit destination.

For a layout change, capture a visible event or staff/measure source anchor and its horizontal and vertical viewport offset. Restore after the current renderer geometry settles, accounting for reserved controls. A system-row ID alone is insufficient for a lower staff in a tall ensemble or a high ledger note. A newer user scroll, navigation, or render supersedes pending restoration; no delayed jump may undo the user's movement. Preserve readable minimum engraving dimensions, and allow contained horizontal scrolling for a dense bar or vertical scrolling for a tall system instead of shrinking either.

## Capacity and Add measure beside the music

Move `#remaining-time` and `#add-measure` into the existing selected-location area, immediately adjacent to the score. Do not scatter controls over noteheads or barlines. A future end-of-bar action would need a separately reserved gutter and source-column binding; it must not cover ledger lines, ties, harmony, or printed ink.

Fix the status scope while moving it. The current calculation sums only the selected voice, so “Measure complete” is too broad. Use a local label such as **Selected: Flute · bar 12 · voice 2 — full**, or **Quarter note remaining** when the exact value has a familiar name. Preserve exact whole-note fractions for values that need them; do not call every denominator unit a beat. A pickup shows its written length rather than implying that the unused nominal meter is unfinished work. A sole full-measure rest retains its explicit replacement explanation.

Keep these operations distinct:

- **Next measure** navigates to an existing measure without changing the music or history.
- **Add measure after 12** inserts an aligned column across all staves, including hidden parts. Keep that scope discoverable in the label/help, and retain the selected staff and voice.
- **Add measure and insert** creates the next column and enters the pending event in one action when continuation is eligible.

These controls follow the selected musical location, not whichever measure happens to be passing through the viewport. Scrolling alone must never retarget an edit.

## Optional continuation

Do not use “Extend current measures”: that suggests changing meter or lengthening existing bars. The first setting is **Continue with Insert and keyboard**, initially off, with **At the end of the score** stated immediately beside it. Put it in entry settings rather than permanent chrome. Do not call it universal automatic continuation while pointer placement behaves differently. The relevant choice is discoverable before a first full-bar error.

Offer **Add measure and insert [value]** as the explicit alternative to a bare full-bar error. For Insert, this can occupy the primary action slot with its destination visible. For a rejected pointer placement, offer a separate deliberate action such as **Add bar 13 and place F♯5 quarter**. The rejected gesture ends without committing; this new action confirms a new destination. Capture the attempted pitch, rhythm, staff/voice, target, and revision rather than rereading changed palette fields. Invalidate that offer on a changed recipe, selection, or source and revalidate before confirmation.

Continuation is triggered by the next attempted entry after a full voice, not by the entry that merely completes it. When enabled and eligible, show the destination before committing, such as **Next note starts bar 13**. Resolve its label from the planned measure, not by incrementing a potentially custom label. An explicit cursor at the end of the voice is equivalent to selecting its last event; do not require an extra click on that note.

| Situation | Behavior |
| --- | --- |
| Entry exactly fills the remaining time | Insert normally; do not create an empty trailing measure. |
| Active voice is already exactly full; After its final event in the final score column | Add one aligned measure column and insert at onset zero in the same staff and voice. |
| A note is too long for a partly filled voice | Reject locally. Do not fill a gap, split the note, invent a tie, or skip unused time. |
| Before, Replace, or After an interior event | Retain strict existing semantics. |
| Later measures already exist | Do not insert ahead of them or jump into their rests. Offer navigation or explicit Add measure. |
| A sole full-measure rest | Preserve existing replacement behavior before testing fullness. |
| Entry exceeds even a new measure's capacity | Reject the whole action; no empty measure or undo entry remains. |
| Pickup, tuplet-bound anchor, outgoing unresolved tie, or authored final/repeat ending | Require explicit structural action; do not reinterpret or move the boundary. A completed incoming tie or an earlier tuplet does not disqualify an otherwise ordinary end-of-voice cursor. |

Use exact rational elapsed time, including tuplets; an `incomplete` attribute alone cannot determine fullness. Inspect structural restrictions across the canonical affected column, including hidden parts; a visible staff cannot override another staff's pickup, ending, or repeat boundary. An ordinary double bar is not a final barline. New columns preserve each staff's effective clef, key, meter/grouping, and voice count. Replace only the target voice's newly generated rest. Other new voices keep the same explicit silent placeholders as Add measure. Do not complete existing unfinished voices, copy harmony/instructions, or invent page decisions.

One outer transaction must stage append plus insertion, validate the resulting score, and commit once. Internally re-read the appended source before locating its new events; the current command context contains the original source map. Two separate history transactions would leave a blank bar after a failed insertion and require two Undos. Stale targets, validation failure, pending Source, and non-Write modes must leave accepted source and selection unchanged. One Undo restores the full prior cursor, including staff and voice even when its old selection was measure-only.

Regular Add-and-insert and automatic continuation share these eligibility rules. All populated templates currently end with a final barline, so that restriction needs a useful local decision rather than a repeated dead end. Offer a separate **Continue this piece…** action at the final canonical column. Its confirmation names the current bar, every affected staff including hidden parts, the destination staff/voice, and the pending event. **Change final barlines to single and start bar 13** explicitly authorizes changing only those final barlines, appending the column, and inserting the event in one transaction. Retain every other continuation guard and reject repeat semantics. Recheck the captured revision on confirmation. Failure changes nothing; one Undo restores the ending, column, entry, and selection. This action never turns on future automatic continuation by itself.

Contextual structural alternatives may insert before the existing ending without changing that ending, or deliberately add after it while clearly retaining its final barline. They remain distinct from automatic continuation. For tuplets, retain deliberate Add measure → Insert in the same staff and voice of the new measure; no extra Add voice action is needed. Defer a dedicated “continue outside this tuplet” shortcut. A ratio does not independently declare its intended completed span.

Pointer placement itself remains strict until it can preview the destination in a new measure. A ghost in the old measure never commits somewhere else. The separately confirmed recovery action and plain Add measure remain available alongside the notation. Automatic pointer continuation needs new destination geometry in a later step, not an exception to the preview contract.

## Suggested implementation order

1. Prototype the per-state score shell at the measured sizes, including warnings and the persistent narrow task pane. Require readable music and complete basic entry/correction loops before filling in every tool family.
2. Implement independent entry/selection/viewport state, self-contained clean/dirty forms, four accessible tabs, and direct sustained harmony entry. Move score setup to Document. Validate correction/resume, draft preservation, focus, and reflow before adding continuation.
3. Implement one explicit Add-and-insert command, captured-pointer recovery, the narrowly named optional continuation, and the separately authorized final-ending decision. Test all as detached, atomic musical operations.
4. Run existing suites plus the journeys and musical fixtures below. Repeat design/IA/Golden, engraver, composer, performer, and technical review on actual results. Only then refresh the production build.

## Acceptance criteria

These are proposed gates, not results from an implemented redesign. A passing geometry check cannot substitute for completing the musical task.

| Journey | Required outcome |
| --- | --- |
| Write eight bars from Blank | After choosing quarter notes and supported continuation once, enter 32 notes into eight 4/4 bars with zero Tools/Read visits, zero manual Add actions, and no trailing ninth bar. Repeat with sixteen bars. Explicit continuation needs one named action per eligible boundary. |
| Correct and resume | Starting in Select, select → Edit note → Sharp takes three primary activations and no Load/Apply. Then test writing bar 48 → correcting bar 8 → explicitly resuming bar 48 with the same kind, pitch/alteration, duration, dots, voice, and named insertion point. |
| Enter or revise harmony | Open chord-symbol entry once for eight existing bars, then use text plus commit/advance without reopening, reselecting kind/scope, or calculating ordinary onsets. Include two changes in one bar, an existing symbol, and a Solo until cue direction. No accidental duplicates or implicit overwrites. |
| Preserve multiple drafts | Draft Measure settings for bar 2 and a marking for bar 4; edit a note in bar 6 and change the title. Both drafts remain available without forced reload. Change a relevant target property: preserve the draft and show the local conflict. Delete a target or switch documents with reused IDs: never redirect it. |
| Work through a long session | Use a 64-bar ensemble with hidden parts and multiple voices; perform a twenty-minute mixed-task walkthrough and ten tool switches. No lost drafts, recipe resets, history pollution, or involuntary jumps. Select bar 8, inspect bar 48, toggle tools, resize, and scroll before rendering finishes: the newer visible anchor wins. |
| Extend a populated template | Make one explicit final-ending decision locally, with affected hidden staves stated. Approved barline change, new column, and entry undo together. Repeat boundaries do not receive the same exception. |
| Build a written/improvised form | Duplicate an existing bar range before its vamp, preserving the vamp/cue identities. Switch the next-entry kind between notes, rhythmic slashes, and open slashes without changing existing music or interpreting a direction as playback. |
| Work on a constrained screen | Complete entry, correction, overflow recovery, and a harmony pass at 390 × 660, 390 × 360, and 1180 × 360, including pending Source and long diagnostic states. Repeat with a software keyboard. The relevant target/context and action remain usable; the tool pane does not dismiss on each score selection. |

Retain the hierarchy targets: first actual notation by roughly y240 with at least 400 px of score space at 1180 × 660; by roughly y260 at 390 × 660; at least 180 px of useful score space in a deep working position at 390 × 360 with tools closed. These are layout budgets, not permission to scale music down or count blank/occluded SVG space. Compare measured staff-line spacing and notehead size with the baseline. A complete ordinary lead-sheet system and both piano staves should be readable together when they physically fit. For a taller ensemble, keep the active staff and musical context reachable at the same engraving size. Warnings remain visible but summarized; test that their presence does not make Write permanently unusable.

Test both sides of the dock threshold with dense piano, not just sparse measures. Include nested 3:2/5:4 tuplets, opposite stems, lower-voice chords, high/low ledger notes, courtesy accidentals, long harmony, a wide dense bar, pickups, and an intentional short final system. Preserve the renderer's readable minimums and natural short-line spacing. Verify that toolbar edges never hide the active accidental, ledger line, or annotation.

Musical regressions cover exact fullness versus partial overflow, existing later music, Before/Replace, tuplets, additive meter, full-measure-rest replacement, completed versus outgoing ties, hidden-staff pickup/final/repeat boundaries, custom bar labels, oversized values, invalid notation settings, pending Source, and Read/Pages. Full voice 1 with unfinished voice 2 must never report an unqualified complete measure. Validate event, cursor, source identities, and one-step Undo/Redo, not only bar counts. Gestures cancel safely on geometry changes, and their previews still match their committed destinations.

With source, part, fonts, and paper settings unchanged, pane/tab changes must leave source layout attributes, saved profiles, physical PagePlan, and reviewed-turn fingerprint unchanged. Write may rewrap; it must not author line/page breaks, change staff scale, or silently refit Read. Test print exclusion with tools, quick note editor, Source, and a native picker open, including no blank space reserved for hidden controls. Retain the raw-print guard and separate notation-workbook entry.

Actual keyboard, native picker dismissal/focus, touch/pen capture, software-keyboard occlusion, and saved PDF/printed output need their own qualification. Synthetic browser routing cannot establish those results. The existing 791-unit/98-browser passing result belongs to the previous implementation, not this redesign. New implementation evidence is tracked separately in the cycle ledger.

## Full-team review outcome — 2026-08-28

All eight reviewers accepted the revised plan after the challenge and revision cycle; no concrete plan blocker remains. Their acceptance is limited to the proposal and its required verification.

| Reviewer | Change required by the review, now included |
| --- | --- |
| Golden Krishna analytical lens | Judge complete composing tasks; remove routine Load/setup, repeated form reopening, irrelevant controls, and unnecessary reloads. Keep the eight-bar, correction, harmony, long-session, and phone journeys mandatory. |
| Design lead | Four editing tabs, explicit per-state control limits, global score setup under Document, and a persistent reserved phone pane instead of an auto-dismissed tool overlay. |
| IA specialist | Direct entry to musical tasks, clean forms that follow selection, dirty forms that retain their target, and honest continuation scope. |
| Performer | Independent insertion recipe/position, deliberate Resume, visible musical anchor ownership, predictable focus, and useful notation with constrained screens and warnings. |
| Music engraver | Actual ink and staff-size checks, all-staff structural guards, explicit final-ending authorization, and invariant print profiles/page plans/turn reviews. |
| Modern jazz composer | Sustained harmony entry, visible slash semantics, measure-range duplication, useful continuation at template endings, and no inferred tuplet completion. |
| Editor-state reviewer | Document-aware draft validation, no history changes from UI preferences, protected local Undo ownership, and atomic continuation with full cursor restoration. |
| Browser/task reviewer | Complete task journeys and real musical fixtures alongside geometry, with native-input, software-keyboard, and print limitations stated separately. |

The final wording also makes clear that continuing after a deliberately added measure uses the same staff and voice; it does not require an extra Add voice operation. That earlier plan-review cycle changed no application files and claimed no new test results. Subsequent implementation is tracked below.

## Implementation cycle ledger

The subsequent notation-coverage cycle is recorded in [Author coverage of the notation language](authoring-notation-coverage.md). Its 2026-08-28 checkpoint reports 2,462 passing automated tests and rebuilt production/review sites, with all tracked code findings closed. At that checkpoint, browser access was permission-blocked; the later resumed review below records the new browser evidence without qualifying device input or PDF output.

Before changing behavior for a review finding, record the failure, the invariant to preserve, and its named regression here. Then implement the fix, run its focused tests and relevant regressions, and attach the results and limitations. Do not relax a locked threshold, remove a difficult fixture, or substitute a container measurement for actual notation to make a gate pass. An aggregate passing count alone does not close a task or engraving gate.

### Cycle 1 — locked task and engraving contracts

**Status: OPEN — implementation and verification in progress.** The following contracts translate the accepted plan into explicit checks from the Golden Krishna analytical lens and music engraver. Controller tests and browser journeys are being implemented; these rows do not claim that the complete editor has passed them.

| Contract | Locked requirement |
| --- | --- |
| `UX-8BAR` | With continuation chosen once, 32 quarter-note entries produce eight 4/4 bars and 64 produce sixteen. No ninth/seventeenth trailing bar, Tools/Read visit, or manual Add action. |
| `UX-CORRECT-RESUME` | Select → Edit note → Sharp takes three primary activations. Every selection route preserves the independent insertion recipe and bookmark. |
| `UX-HARMONY-PASS / EXISTS / NOOP` | One panel opening supports eight bars. Load an existing symbol by its unique ID; ambiguity requires a choice. Unchanged Apply & next bar advances with zero musical history. |
| `UX-DRAFT` | Named Measure-bar-2 and Markings-bar-4 drafts survive a note edit in bar 6 and a title edit. Relevant conflicts retain the draft; reused source IDs in another document never redirect it. |
| `UX-VIEW` | Bar 8 can remain selected while bar 48 remains visible. Tool changes and render restoration preserve that distinction; a newer user scroll wins. |
| `UX-PANE` | The narrow persistent pane reserves space, supports independent score/form scrolling, and stays open across score selections. |
| `UX-UI-NONMUSICAL` | UI preferences do not change source, document revision, Redo availability, or recovery status. |
| `UX-CONTINUATION-RECOVERY` | A rejected gesture writes nothing. Recovery is a separate captured confirmation; changed state invalidates it. A successful confirmed continuation takes one Undo. |
| `UX-RESUME-DIRECT` | Resume is directly reachable and visibly names its retained musical destination before entry resumes. |
| `UX-LOCAL-ACTIONS-DISCOVERY` | The location control communicates that it contains actions; its action row is reachable first at 390 × 360. |
| `ENG-INK-BUDGET` | First actual ink is at or above y241 at 1180 × 660 and y261 at 390 × 660. Usable score clipping height is at least 399 px on that desktop and 179 px at 390 × 360. The local strip is at most 105 px on desktop and 145 px on phone. Blank or occluded SVG space does not count. |
| `ENG-SCALE` | Against a neutral rendering of the same source, staff spacing differs by at most 0.1 px, notehead dimensions by at most 0.25 px, and the screen transform by at most 1%. |
| `ENG-DENSE-PIANO` | Include nested 3:2/5:4 tuplets, opposing stems, and inner chord tones. Tab switches retain width within 0.5 px and exactly the same system assignments. |
| `ENG-ANCHOR-LOWER64 / RACE` | In a 64-bar fixture, restore the visible lower staff at bar 48 within 2 px where bounds permit. A newer user action supersedes queued restoration. |
| `ENG-LEDGER / WIDE-BAR` | Cover C7/C2, courtesy accidentals, long harmony, and sixteen sixteenth notes. Keep readable engraving and contained scrolling, without document-level horizontal overflow. |
| `ENG-SHORT-SYSTEM` | Preserve natural pickup and isolated final-bar spacing; do not stretch or shrink them merely to occupy the workspace. |
| `ENG-PRINT-INVARIANCE` | Compare actual Letter/A4/part page DOM and the saved page-turn review token before and after UI changes. Native PDF, print, and hardware qualification remain separate. |

The public Select interface intentionally has no note-entry tile. Choose **Enter notes** first to expose **Drag note to staff**. Legacy interaction journeys must enter that mode explicitly; this visibility change does not relax measured targeting, preview/commit agreement, one-gesture/one-transaction behavior, cancellation, or stale-state rejection. Pitch dragging in Select remains a separate eligible-note action.

The actual twenty-minute mixed-task walkthrough on a 64-bar score must log elapsed time separately. A fast synthetic loop does not satisfy that session-duration requirement. Cycle 1 remains open until its required task, engraving, state, and accessibility evidence is recorded.

### Cycle 2 — locked findings from strict implementation review

**Status: code and unit fixes accepted; integration remains OPEN.** Requirements were locked before fixes. The initial Markings unit run reported **47 tests: 41 passed and 6 failed**. Those failures were repaired and independently reviewed; the current verification checkpoint below records the passing suite. The open rows still require their current browser integration evidence. The regressions are in [the Markings editor tests](../tests/authoring-markings-editor.test.ts); advanced-event and neighbor-dependency checks belong in [the inspector form tests](../tests/authoring-inspector-forms.test.ts) and their command tests where applicable.

| Finding | Required fix and regression | Status |
| --- | --- | --- |
| `MARK-PATCH-UNTOUCHED` | An annotation edit applies only intended dirty fields. Changing placement must preserve untouched literal prose, onset, source attributes, and authored omissions; do not normalize unrelated source through a full rewrite. | OPEN |
| `MARK-SCOPE-ONLY` | Changing recipients changes only the instruction scope in one transaction, without rewriting musical HTML. An unchanged Apply & next bar must leave source, revision, Redo, and musical history unchanged while permitting navigation to an existing bar. | OPEN |
| `MARK-CONCURRENT-NEW` | If another matching annotation arrives at the same position while a new-symbol draft is held, retain the draft and require the explicit **Keep draft as New** choice. Never overwrite the arrival or silently create a duplicate. | OPEN |
| `MARK-CLEAN-WHITESPACE` | Pristine Apply & next bar with authored whitespace advances with zero revision/history change and preserves literal source. A trimmed form value is not evidence that the user edited the text. | OPEN |
| `MARK-LATEST-INTENT` | A later explicit Edit request supersedes an earlier pending Add request. Resolving the pending action must honor the latest named target and operation. | OPEN |
| `MARK-NEW-RECIPE` | Explicit New retains the last displayed kind, placement, and recipient scope. It must not silently reset a sustained marking-entry pass to defaults. | OPEN |
| `EVENT-PATCH-UNTOUCHED / MIXED-CHORD` | Advanced duration or stem changes preserve unrelated event source, child/source identities, and each chord tone's accidental-display policy. A mixed chord must not acquire one normalized display setting merely because another property was edited. | OPEN |
| `DRAFT-KEEP-NEIGHBOR` | A dirty Keep with next relationship between canonical columns A and B depends on B's identity. Deleting or moving B must cause a retained-draft conflict, not silently apply the relationship to A and C. Add this neighbor dependency for the keep field only, not unrelated draft fields. | OPEN |

Each row stays open until its named regression and relevant integration evidence are recorded after the fix. These findings tighten verification of the accepted preservation and intent contracts; they do not broaden the approved feature scope. No browser acceptance is claimed by this ledger update.

### Cycle 3 — integration review, locked before revision

The first fixed-build browser pass passed Author 22/22, note editing 13/13, pointer 15/19, and workspace journeys 11/16. Unit tests passed 1,540/1,540. Test-only failures must be distinguished from application defects: responsive `display: contents` has no wrapper box; navigation intentionally parks entry; Source fixtures must retain scoped annotation identities. Neither musical validation nor geometry thresholds may be relaxed.

| Finding | Requirement before implementation |
| --- | --- |
| `UX-DIRTY-STRUCTURAL-TARGET` | Remove, Move, Add voice, and short-measure review cannot mutate selection B while their form retains and names draft A. Disable with a target explanation and guard stale delivery; require Return or Discard first. |
| `UX-MARKING-NOOP-REVEAL` | An unchanged Apply & next consumes its navigation intent immediately. Later tool changes cannot reveal the old selection. New scrolling also cancels a pending explicit reveal. |
| `UX-CONTINUE-FORECAST / LOCAL` | Before full-voice continuation, visible feedback names the planned bar, staff, and voice. Select's local Continue action opens the same guarded ending confirmation. Opening/cancelling changes no music or preferences. |
| `UX-HARMONY-CHOOSER-SCOPE` | Matching native options distinguish Above/Below and staff/all/explicit named recipients before the musician chooses. |
| `UX-RECIPE-MEASURE-REST` | A full-measure rest is named explicitly in the collapsed recipe; ordinary value/dot controls cannot imply that it is a quarter note. |
| `UX-RESUME-MISSING` | A removed bookmark preserves the recipe and visibly asks for a new named location; do not silently imply that Enter resumes it. |
| `UX-SCORE-FIRST / CONSTRAINED` | At 390 × 360, restore at least 179 px of ordinary usable score without shrinking engraving. Warnings must remain readable without stale errors occupying the score after a successful edit. |
| `ENG-WIDE-BAR-RETURN` | Horizontal inner-system scrolling updates the visible Return-to-selection action, not just the selection outline. |

These remain open until focused regressions and the next fixed-build browser pass establish the result. Native hardware, software keyboard, PDF output, and the elapsed long-session walkthrough remain distinct qualifications.

### Cycle 4 — confirmations and follow-up review

The user added a requirement to avoid browser `alert()`, `prompt()`, and similar blocking decision APIs. All seven former `window.confirm()` call sites now use the authoring UI's native HTML dialog: New/Open composition, Remove measure/part, Convert passage, Fill with rests, and Approve short ending. Existing continuation and pointer-recovery decisions remain native popovers. The page-exit protection for unsaved work remains a browser-owned navigation warning, not an in-app decision API.

The review requirements below were set in the specialists' follow-up findings. Code acceptance is recorded separately from browser evidence; a passing controller test cannot establish layout, native focus behavior, or a long composing session.

| Finding | Required behavior and regression | Current evidence |
| --- | --- | --- |
| `CONFIRM-EXPLICIT / STALE / CANCEL` | Only the named confirmation button authorizes the captured action. Cancel, Escape, close, disposal, and concurrent requests cannot authorize it. Check document, revision, selection, cursor, view, and form/range intent immediately before acceptance and again after awaiting it. Keep stale decisions open with a visible reason and a safe exit. | ActionConfirmation has 31 passing controller tests. Root integration reviewed; current browser Cancel/focus/short-screen/stale-state journeys are still pending. |
| `CONFIRM-METADATA / FALLBACK` | Flush already typed metadata before capturing the decision so its own debounce cannot invalidate it. When native dialog support is absent, use explicit in-flow controls; edits made while that fallback remains open invalidate the old decision. Never fall back to alert/prompt/confirm. | Implemented; raw form/range snapshot added. Browser fallback-intent stress check is being added. |
| `CONFIRM-STALE-VISIBLE` | A stale-context reason in a long confirmation remains reachable without scrolling the music or document behind it. Confirm stays disabled; Close and review remains usable. | Controller regression passed after the dialog-body-only scrolling fix. Native rendering remains to verify. |
| `CONFIRM-RETURN-VISIBLE` | Resolve a focus destination before closing transient surfaces. Cancelling Remove part or an import returns to the visible Document trigger, never a control inside the closed Score setup/Document surface or the hidden file input. A persistent Measure-panel action returns to its own control with `preventScroll`. Test the actual shell with the in-flow surface fallback, not only a detached button. | IA found this integration gap during the second confirmation review. Requirement locked before the resolver and regression fix. |
| `UX-FULL-REST-DORMANT-DOTS` | Full-measure entry uses the meter even when the dormant recipe has quarter duration, two dots, and an explicit beam start. Commit a valid full rest while retaining ordinary-entry preferences for later. | Golden lens accepted the entry-only normalization. Public-DOM regression uses a sole whole note and Replace, verifies the actual commit and one Undo. Not yet run. |
| `UX-REVIEW-PART-DRAFT` | Review a part-only draft by opening Score setup and focusing Part name; preserve the draft and accepted source. Do not target an absent panel. | Golden lens accepted the corrected route. Browser regression pending. |
| `ENG-INNER-SCROLL-SELECTION` | Listen to the actual inner notation scroller across its shadow boundary. Panning updates the selection outline and Return visibility; Return reveals the same source without musical history. Dispose obsolete listeners. | Engraver accepted the shadow-root listener and cleanup. Current wide-bar browser regression pending. |
| `CONT-FINAL-CONFIRM-CONTENT` | Identify each affected final ending even with missing or duplicate staff labels; name the destination and complete captured event, including chord pitches, dots, rest or direction semantics. State hidden-staff scope and one Undo. | Engraver accepted the complete description and staff-name qualification. Prompt-only dotted-chord/hidden-staff regression pending. |
| `MARK-IDENTICAL-CHOICE` | If completed instruction option labels still collide after position, placement, and recipients are included, append each annotation's source ID only to those colliding labels. Choosing either identifies its exact existing source without changing music or history. Ordinary choices remain uncluttered. | Requirement locked for the next bounded fix and focused regression. |

**Browser review is blocked by permission.** The fixed local review site at `http://127.0.0.1:4176` was denied. No alternate browser, port, or access mechanism is being used to bypass that denial. Approval has been requested; code fixes and local tests can continue in the meantime. The earlier fixed-build results do not cover the latest warning layout or confirmation changes. The started 64-bar walkthrough was interrupted before its mixed-task journey; elapsed idle time does not satisfy the twenty-minute requirement.

### Cycle 5 — stricter context and recovery checks

The next read-only design and composer reviews found the cases below. They are locked before their fixes. This cycle checks the actual control that remains visible, complete preview changes rather than only inserted notes, and precise part identity across every choice. Tests must distinguish deliberate sequential cursor advancement from accidental changes to a retained recipe.

| Finding | Required behavior and regression |
| --- | --- |
| `RECIPE-STRUCTURAL-INVARIANCE` | Add measure preserves the full-measure-rest choice and dormant duration/dots/beam preferences. Its visible controls agree immediately with the retained recipe. Test an actual Add measure and Resume. Successful Insert may deliberately advance Position from Replace to After; assert that separately instead of freezing the complete palette. |
| `SOURCE-LOCAL-FAILURE` | Failed Apply keeps the Source surface open, retains the draft and accepted music, and displays/announces its full diagnostic inside that surface. Review → Source does not erase the unresolved reason. Associate the error with the field; clear stale diagnostic text and invalid state after a changed/resolved draft, successful Apply, Revert, or project replacement. |
| `UX-RESUME-MISSING-SHORT` | At 390 × 360, show a missing insertion point and the named Start action within the existing 44 px mode control. Do not add a seventh flex item or a second Select row. Keep the recipe and full accessible staff/bar/voice description. Clean score height remains at least 179 px. |
| `MARK-RECIPIENT-IDENTITY` | Duplicate part names receive their IDs; unnamed parts fall back to an ID. Use the same display policy in recipient checkboxes, existing-instruction labels, part navigation, and part confirmation context. Completed labels must also be unique when an authored name already resembles a generated label or the built-in **Full score** choice; preserve ordinary unique names and make disambiguation stable under part reordering. Display labels never rewrite musical source or authored part names. Test two same-named parts on different staves, an unnamed part, and authored/generated/reserved label collisions. |
| `REST-FILL-COMPLETION` | Compare the whole rest-fill preview with accepted source. If no rests are added but an exactly full bar loses an obsolete `incomplete` flag, offer an explicit **Mark this full bar complete** decision and commit the same command once. A truly unchanged full bar remains a no-op. Cancel changes nothing; one Undo restores the draft flag. |
| `CONFIRM-FILE-INTENT` | Replacing the selected import file while a fallback decision remains open invalidates the old import. Capture file identities as well as ordinary form values; a later file choice cannot authorize an earlier composition. No file contents are copied into diagnostic output. |
| `UX-FILE-READ-SUPERSESSION` | Claim the selected file before awaiting its text. If file B supersedes a pending read of A, A must never open a decision, report an obsolete read error, or clear B's input. Only the current request owns cleanup; recheck ownership after confirmation and invalidate it on disposal. Lock deferred A/B reads, reversed resolution, cancellation, and stale cleanup before fixing this final Golden-lens finding. |

All native layout, focus, and composing-session evidence remains pending the permitted fixed-build browser run. These added checks do not relax earlier geometry, history, source-preservation, or printing gates.

### Verification checkpoint — 2026-08-28

All recorded code findings through Cycle 5 are implemented. Golden's final bounded review accepted file-read ownership and found no remaining blocker in that fix; the earlier Source, recipe, completion, focus, and exact-recipient fixes also received bounded specialist acceptance. The design lead accepted the authored shell with 32 static checks. These dispositions do not mean the team has approved the unobserved native browser experience.

- **Full unit suite:** 51 files, **1,968 tests passed**, in the run starting at 09:42:01. Typechecking and `git diff --check` passed.
- **Native decisions and context:** 180 focused tests cover confirmation, return focus, asynchronous file ownership, native surfaces, persistent tabs, and the policy prohibiting direct alert/prompt/confirm calls. Source feedback has 29 additional focused tests. Markings and shared part-label checks pass 68 tests.
- **Stricter regressions:** file ownership first failed 16 of 24 tests; visible focus return first failed 28 of 36; Source feedback first failed 22 of 29. The corresponding fixes passed their complete suites before review acceptance. No musical validator or geometry threshold was relaxed.
- **Fixture alignment:** one old Select assertion counted hidden caption text as visible button text; it now checks the displayed label and hidden reason separately. The gallery inventory now includes the event-marking study already added by concurrent work, increasing its explicit count to twelve. All 78 DOM/workbook checks pass, including validation, round-trip preservation, and controls over every score.
- **Production build:** `npm run build` passed. The existing server on `127.0.0.1:4174` still runs from this repository and serves the refreshed build; its Author asset is `author-BRMAMRea.js` with `author-C3t8WxSS.css`.
- **Fixed review build:** rebuilt successfully in `/private/tmp/music-notes-layout-review-dist`, with Author asset `author-6Nt_-UwZ.js`, the same Author CSS, and workspace journeys `journeys-CEzErSsO.js`. Its existing preview server remains on `127.0.0.1:4176`. The workspace harness retains 20 grouped journeys and explicitly labels synthetic file, pointer, and source stress cases.

**Current browser verification has not run.** Permission for the fixed review site remains denied, and no alternate access was attempted. The earlier 22/22 Author, 13/13 note-editor, 15/19 pointer, and 11/16 workspace results belong to Cycle 1, not this rebuilt snapshot. Short-screen useful score area, constrained tasks, native focus/input behavior, the actual twenty-minute mixed composing session, and PDF/paper output still require their stated evidence before full implementation acceptance.

### Selection editing — implementation and stricter review cycles

This checkpoint follows the approved [selection editing plan](author-selection-ui-plan.md). It supersedes the older Edit-tab and note-popup workflow descriptions, not the open native/device/publication requirements above. The [workspace guide](author-workspace.md) now describes the current routes.

Common accepted-value corrections live in the fixed footer below the score. More opens untabbed Properties; Other tools exposes Relationships, Instructions and Measure in the same pane. Exact multi-selection, independent inspection and writing targets, retained drafts, nine alterations, road directions, attached marks and open-slash nominal spans share the same guarded command model. The optional note-relative HUD is implemented but remains disabled by default.

Each return to implementation tightened the reproduction and acceptance requirement:

| Cycle | Findings and strengthened proof |
| --- | --- |
| Integration | Separate whole-set selection and writing history; sustain entry without retargeting Properties; use actual primary/range membership, not a focus-only event or implied endpoints; restore the held pane in one action. Tests run the actual workspace/session/controllers rather than a substitute editor. |
| Correction and access | Re-select the same note after an overflow rejection, not merely another note. Exercise three actual phone actions instead of assigning a select value. Open and apply a visible nominal-span form while preserving an open slash's identities, marks and unwritten rhythm. Check structural result navigation against the independent writer and the actual staff form. |
| Longer sessions and keyboard ownership | Redo while writing is parked, then Resume and insert; assert the exact resulting order. Undo while parked must keep the restored point resumable. Dispatch Escape from the still-focused More, Value, Spelling and drag controls, including pending Space/pointer activation and a late click. Cancellation must be quiet, with native fields and innermost native popovers retaining their Escape behavior. |
| Placement and focus | Drive outer/inner scrolling, visual viewport changes, pending Source and deferred rendering through the real workspace and MusicSurface. Preserve explicit voice scope while resolving implicit projected identities. Cancel a focused chooser, dock safely, and retain a newly focused Source field rather than taking focus back. |

The minimalism reviewer closed the same-note retry and phone action-depth findings. The composer approved exact batch semantics and the restored open-slash route. The performer approved parked history and writing-bookmark restoration. The engraver approved conservative placement and the fixed default. Design and IA approved the authored shell and navigation structure. Accessibility closed the focused-button Escape and cancellation-focus findings. These are bounded code reviews by the agent team; the Golden Krishna persona remains an analytical lens, not the real author's endorsement.

One suspected caret problem was rejected rather than “fixed” against an invented score: literal empty voices cannot enter accepted Author source, including in incomplete bars. The added checks confirm rejection of empty first, second and implicit voices and valid caret behavior for silent voices represented by full-measure rests. No production geometry or musical validation was changed to accommodate an invalid fixture.

### Selection verification checkpoint — 2026-08-28, 13:27 EDT

All tracked selection-cycle code findings are closed. The final aggregate run started at **13:27:21 EDT** and passed **3,086 tests in 70 files**, with no failed or pending tests. `npm run typecheck`, `npm run build` and `git diff --check` passed.

| Evidence | What it establishes, and its limit |
| --- | --- |
| 86 [workspace tests](../tests/authoring-selection-workspace.test.ts) | Actual selection, command, draft, Properties, entry, recovery, phone-action and history flows. Rendering is stubbed; these are not native geometry measurements. |
| 80 [selection-control tests](../tests/authoring-selection-controls.test.ts) and 12 [Escape workspace tests](../tests/authoring-selection-escape.test.ts) | Exact binding, mixed values, explicit actions, stale/cancelled activation, focus recovery and native-input routing. Declarative popover test boundaries establish routing, not actual browser dismissal or screen-reader behavior. |
| 49 [selection reducer tests](../tests/authoring-selection.test.ts), 50 [selection/history tests](../tests/authoring-selection-history.test.ts) and 97 [batch-property tests](../tests/authoring-batch-properties.test.ts) | Exact membership and scope, independent cursor snapshots, structural navigation, all-target admission, atomic validation, preservation and no-op history semantics. |
| 26 [open-slash tests](../tests/authoring-open-slash-span.test.ts) and 43 [inspection-context tests](../tests/authoring-inspection-context.test.ts) | Visible staged nominal spans, exact timing, held target ownership, captions, conflict recovery, unchanged source and one-step Undo. |
| 42 [HUD module tests](../tests/authoring-selection-hud.test.ts) and 23 [HUD workspace tests](../tests/authoring-selection-hud-workspace.test.ts) | Placement guards and event wiring. The latter run real workspace rendering and MusicSurface with engraving/font readiness and DOM measurements controlled by the fixture. They do not establish real ink clearance or native capture. |
| 58 [layout markup tests](../tests/authoring-layout-markup.test.ts) and 26 [select tests](../tests/authoring-select.test.ts) | Three general tabs plus untabbed Properties, declared row/target sizes, programmatic focus targets and labelled customizable native selects. Static CSS checks do not establish actual screen fit. |

The new production build is in this repository's `dist`. Its Author assets are `author-BIEoV4ac.js` and `author--tBcl9VQ.css`. The existing preview process, PID **46308**, remains listening on **127.0.0.1:4174** with this repository as its working directory. The authoring page is available at `http://127.0.0.1:4174/author.html`; reload an already open page to load this build. No new external service was published.

**Native acceptance remains open.** Permission for the designated review site at `http://127.0.0.1:4176` has not been granted. No browser, alternate port, HTTP client, automation driver or other access path was used to bypass that restriction. The fixed review snapshot was not rebuilt or accessed during this selection cycle; its old results do not qualify this production build. Native customizable-select/popover behavior, responsive ink/target measurements, zoom and software keyboards, actual touch/capture, assistive technology, the timed composing session and saved PDF/paper output still require their own evidence. Keep `contextualHud` false until those placement/input gates pass.

### Dock and menu refinement — locked review findings

This cycle implements the user's request for Written value beside its trigger, stationary More controls that toggle the pane, and a common location for Enter notes and Select. It supersedes the prior arrangement with entry above the score and selection controls inside the score column. The new final workbench child spans the complete width below the score and reserved pane. Both modes share its bottom-left mode slot; existing entry controls occupy its upper row. Variable status messages precede the workbench so they cannot push its bottom dock upward.

Each new finding was reduced to a specific regression before accepting its implementation:

| Finding | Locked behavior and evidence boundary |
| --- | --- |
| Pane movement and mode location | One final dock outside both scroll areas, unchanged control IDs and 44 px targets, the same mode slot, and no duplicate upper entry strip. Static CSS/DOM checks establish structure, not measured stationary coordinates. |
| More was open-only | The first press closes its already visible destination, even with scalar and attached-mark drafts held for different events. Reopening retains fields, targets, saved scroll, writing recipe, source and history. Specific Edit mark, Pitches, Nominal span, Enter and double-click routes remain open-only. |
| Written value inherited corner placement | All three selection choosers and the small Location/Next entry popovers use their actual invoker for each native opening. The shared Pitch chooser follows Properties' Spelling button when that opens it. Placement flips/clamps, preserves menu scroll and restores temporary styles/listeners on close; it does not position ordinary fallback sections. Controlled measurements and lifecycle stubs do not qualify the native top layer. |
| Focus after an invoker disappears | Close only that chooser and return focus to a valid related control or score only while it still owns focus. A field chosen during closure must keep focus. No new musical action is generated. |
| Short-screen fixed pane height clipped the dock | Fund the dock first; divide remaining short-screen space between notation and the bounded tools pane. Scroll the complete task in that pane, with explicit Expand separate. This does not promise a full staff when the remaining area is too small. |
| Programmatic focus in the new outer scrollport | Reveal explicit marking and form targets through the actual owned pane, never the score or document. A restored scrolled general tool retains saved scroll and uses a visible external focus destination when its tab is clipped; deliberate tab navigation reveals the tab. A stricter second review adds a 44 px tab inside a 30 px clip on each axis: the entire tab must fit, while a large Properties region may cover the smaller clip. |
| Relocated pointer controls | Both drag handles retain admission and keyboard cancellation. A release over the complete dock, including its entry row and shared edge, cannot insert into notation; preview labels avoid actual dock bounds without treating a bottom toolbar as a top boundary. |

Three earlier workspace journeys assumed More always opened an already visible pane. They now explicitly close it, assert that the held buffers/source/history are unchanged, and then reopen it before their original draft and target assertions. The shared test helper does not hide a second click. All 86 existing journeys pass under that revised user contract.

The design, performer, engraver and composer reviewers accepted the bounded code changes. The minimalism review closed both short-pane focus findings after inspecting their final implementations and regression cases. The IA suite passed 95 tests, including the two initially failing clipped-tab cases. The shared form helper passed 244 focused tests: 12 attached-mark cases and all six property/instruction journeys first failed against their old focus behavior. The accessibility review accepted the native-surface lifecycle and focus recovery at the controlled test boundary. No remaining code blocker is recorded for this scope. Native review permission was requested again and remains pending; no browser or alternate access path has been used.

### Dock verification checkpoint — 2026-08-28, 15:14 EDT

The final aggregate run started at **15:14:28 EDT** and passed **3,223 tests in 74 files**, with no failed or pending tests. `npm run typecheck`, `npm run build` and `git diff --check` passed. The changed HTML also had three whitespace-only lines removed before the production build.

The added coverage includes 17 actual workspace journeys for More, retained drafts and relocated controls; 32 controlled popover-position cases; 15 positioned-surface lifecycle cases; and 21 tool-pane focus journeys. The existing selection workflow suite retains all 86 journeys, with explicit close/reopen steps where the user's new toggle contract supersedes open-only behavior. The selection controller passes 83 tests, the persistent pane 95, and authored layout/select contracts 90. These counts overlap the aggregate run and are not additional native-browser evidence.

The refreshed production build is in `dist`, with Author assets **`author-rEW-p_mu.js`** and **`author-Bd9yHM_9.css`**. The existing preview process, PID **46308**, remains listening on **127.0.0.1:4174** from this repository. Reload `http://127.0.0.1:4174/author.html` to load it. No external deployment or new server process was needed.

**Native visual acceptance remains pending permission.** No local browser, HTTP client, alternate port or automation driver was used. The review snapshot on port 4176 was neither rebuilt nor inspected, and its older results do not qualify this build. Actual menu-to-trigger distance, stationary button coordinates, short-screen fit, native focus/select behavior, device input and PDF output require their own checks. The optional note-relative toolbar still defaults to `contextualHud: false`; positioning the small native menus near their buttons is enabled independently.

### Delete shortcut — implementation and review

Delete and Backspace now remove the actual selected music from focused Write/Select notation. The shortcut does not click the inspector's Remove button or reuse its held draft target. It removes an exact event set in one transaction, preserves gaps in a disjoint selection, and removes only the child when an attached mark is selected. The existing Remove control uses the same new removal command for its explicitly bound event; the legacy `remove-event` command retains its previous API contract.

The engraver's review required a usable last-note case: an emptied ordinary voice receives one fresh full-measure rest, without carrying over the removed events' marks. Existing sole full-measure rests remain unchanged. Partial voices gain no invented rests. Ties, pickup-emptying, and deletion of legacy triplet boundaries with surviving members reject safely; ordinary wrapper tuplets and annotation anchoring retain their existing semantics. The transaction validates the whole score, retains the independent writing cursor, and restores source identities and the exact event selection with one Undo.

Input review tightened the shortcut to actual score/viewport/surface focus or a validated notation glyph. Generic focusable prose is not enough. Native fields and controls, modifiers, composition, Read/Pages, entry mode, active gestures and open popovers remain outside its scope; held key repeats cannot cascade into the next selected note. An unprevented browser text-selection gesture relinquishes only score-container focus. A deliberate note selection reacquires it. No browser Range is cleared, and an old Range cannot veto a fresh application selection.

The 48 workspace regressions run the actual shell, session and controllers with engraving dispatch stubbed. Four ordinary-note/held-draft cases were first red before routing existed; the generic-prose ownership gap was also reproduced before its guard changed. The command has 53 focused cases, including exact sets, fresh/no-op silence, multiple voices and bars, annotation and tuplet preservation, rollback and history. Bounded input and musical reviews are accepted. Synthetic events, controlled focus and DOM Ranges do not establish native device/browser qualification.

The aggregate run on **2026-08-28 at 16:11:32 EDT** passed **3,324 tests in 76 files**. A final test review tightened three refusal assertions to match actionable tie/pickup messages; all three passed again. `npm run typecheck`, `npm run build` and `git diff --check` passed. The refreshed production assets are **`author-ClR7qFFl.js`** and **`author-Bd9yHM_9.css`**. Preview PID **46308** remains listening on **127.0.0.1:4174**; reload `http://127.0.0.1:4174/author.html` to load the shortcut. Native browser permission remains pending, and no alternate access path was used. These source, test and build checks do not qualify native keyboard or device behavior.

### Rest deletion and renewed surface review — 2026-08-28

The user's rest-deletion correction supersedes the preceding placeholder policy. Delete and Backspace now remove the exact selected notes **and rests**, including a sole full-measure rest. Emptying an ordinary voice retains its source container and voice index and marks the measure incomplete, without adding replacement music. Attached marks disappear with their event; independent annotations, comments, meter, other voices and exact selection/history semantics remain protected. Emptying a pickup and removing tied members still reject safely. The legacy single-event command retains its earlier API contract; Author's removal routes use `remove-events`.

This needed a small shared-notation change, not merely a shortcut adjustment. An empty non-pickup voice in an explicitly incomplete measure carries an actionable `empty-voice` warning. Complete empty voices, empty pickups, absent voices, empty tuplets and ties across unwritten voices remain errors. The renderer keeps the original model voices and their indices but omits empty engine voices from formatting, avoiding extra spacing beside written music. It draws the staff and context with no rest and publishes the existing onset-zero anchor. Readable score text now distinguishes an empty draft from written silence.

Author names the cleared voice as **Empty draft · Voice …**. Before/After Insert and single-note pointer entry can start it, using its actual canonical-to-projected voice identity rather than another voice's coincident anchor. Replace refuses with a specific route to Next entry → Position → Before/After. Explicit Fill rests remains a separate confirmed transaction. Ordinary publication and short-ending approval cannot turn an unwritten voice into approved silence; marked Draft output can include it. Project recovery retains the empty draft and drops obsolete short-ending approvals.

The stricter recovery review found that a disabled short-ending button needed a visible explanation, and that a held Measure draft must not recommend filling an unrelated current location. The explanation now follows the bound Measure: Return to target first when held elsewhere, choose its empty voice when needed, and offer the adjacent Fill action only when its context matches. The new workspace regression retains the dirty measure fields, source and history through that return. The misleading statement that Insert follows selection was also corrected; it follows the independent writing destination.

The focused evidence includes 59 removal/entry command cases, 56 actual-shell Delete journeys, 31 new model/DOM/renderer cases, 49 added pointer-target/interaction cases, and 30 HUD/workspace journeys. Source rejection coverage was retained with overfull input while new tests accept explicitly empty drafts. A separate failing regression proved that the old caret chose voice 1's coincident anchor when starting empty voice 2. Four new component cases check meaningful empty-voice text. These counts overlap the aggregate run. Rendering tests use real VexFlow with controlled font and painted-bounds measurements; workspace/pointer cases use synthetic DOM input and controlled geometry. None establishes native touch, visual fit or saved PDF output.

The team also reviewed the surface without claiming visual qualification. Direct placement is still limited to single pitched notes, including configured quarter-tone alterations. The entry drag handle is now hidden in Select; controller admission for that mode is not an exposed user route. Rest, chord, rhythm, road and slash placement still uses Insert/Enter. The [new proposals](author-writing-surface-proposals.md) separate visual/action hierarchy, a stable compact writing palette and paper frame, and later direct note/rest expansion. The broad redesign is proposed for user review, not shipped by this correction.

### Rest correction verification checkpoint — 2026-08-28, 16:56 EDT

The final aggregate run started at **16:56:25 EDT** and passed **3,439 tests in 78 files**, with no failed or pending tests. `npm run typecheck`, `npm run build` and `git diff --check` passed. The earlier aggregate run found one select-contract test still asserting the incorrect Insert/selection sentence; that assertion now enforces the corrected writing-destination wording. No musical or native-input assertion was relaxed to clear it.

The refreshed production build is in `dist`, with Author assets **`author-B1UuXwEq.js`** and **`author-Bd9yHM_9.css`**. The existing preview process, PID **46308**, remains listening on **127.0.0.1:4174**; reload `http://127.0.0.1:4174/author.html`. No new server process or external deployment was needed.

**Native review remains pending permission.** Permission to inspect the designated review page at port 4176 was requested again during this cycle. No page, alternate port, HTTP client or automation driver was used to bypass the pending request. Actual click/drag behavior, visual hierarchy, stationary coordinates, native input/accessibility, device behavior and saved PDF/paper output remain separately unverified. The new proposal's measurable gates are requirements for the next prototype, not results established by this build. The optional note-relative toolbar remains off by default.

The design and Golden-inspired reviews required a second proposal pass: a writing frame independent of More, one unambiguous Write/Select policy, a concrete compact control map, separate pointer and keyboard composing journeys, and a visual-understanding gate. Those amendments are incorporated, including an actual untied F4-to-F#4 correction rather than a possible no-op. The proposal is ready for user review. This acceptance concerns the proposed contract; it does not approve an unbuilt redesign or replace native qualification.

### Writing-surface implementation and resumed browser review — 2026-08-28

The approved [writing-surface proposal](author-writing-surface-proposals.md) is implemented. Browser access to the designated review build on **127.0.0.1:4176** became available during the resumed review. The earlier denied-access records above remain historical. All activity used isolated review workspaces; no user's composition was replaced.

The fixed Write notes / Select palette, independent writing bookmark, compact recipe and selected-note controls, ordinary-rest gestures, empty starter templates, complete Pitch chooser, dedicated road Direction, and deliberate More pane retain their documented musical boundaries. The native review exposed the following additional issues. Each fix kept the stricter source, history, target and geometry requirements instead of weakening those assertions.

| Finding | Implemented correction and acceptance |
| --- | --- |
| Rest clicks on a staff root could select the bar | Root staff and measure components now use the current clipped event geometry, as systems already did. Actual rest click → Delete → Undo removed and restored the exact event. Native prose, controls and modifier intent remain protected. |
| Completing a bar removed an in-flow notice strip and moved the ink | Author sends ordinary notation notices to Review and suppresses only its owned surface's nonfatal panel. The measured SVG top was **79px** through full bar → Delete/incomplete → Undo, replacing the observed **51.5px** jump. Fatal panels, workbook diagnostics and publication checks remain. |
| Long help and enlarged labels crowded the writing surface | Keyboard shortcuts is a closed inline disclosure. Container rules retain the normal compact strip or use a deliberate taller layout for larger text. More and musical controls keep their positions; notation does not shrink to accommodate them. |
| Opening instruction More could reveal an earlier selected bar | Opening the already selected instruction no longer navigates the score. Explicit navigation still does. The current viewport and delayed-render scroll guards pass the strict browser journey. |
| Stale writing guidance and old refusals hid the current action | Writing-only hints clear in Select/Read. Active previews lead with pitch or rest value and outrank an earlier refusal or draft; recovery and unapplied Source stay above them. Review retains full details. |
| An unchanged drag of unselected B left controls on A | A completed pitch gesture explicitly selects its actual target after the accepted command. No-op drops preserve Source, revision and Redo; changed drops undo once. Four integration cases also retain writer C and dirty Properties A. |
| The continuation caption clipped, and pointer completion hid the forecast | Add + insert uses one-line **Bar N** inside the unchanged button. Full staff/bar/voice context remains in the header and accessible label. The final review required forecast priority over ordinary completion, but below previews, errors and drafts. A fourth direct rest click and pointer leave now retain **Next with Insert: bar 2 · Rhythm · voice 1**, with exactly one musical transaction. |
| Missing writing-location recovery lacked a named destination | Location now says Writing at or Selected followed by the actual staff, bar and voice before Start writing here. The missing-bookmark browser journey passes without substituting another event. |

The final aggregate run started at **19:25:28 EDT** and passed **3,896 tests in 89 files**, with no failed or skipped tests. Typecheck, the designated review build, the production build and `git diff --check` passed. A recovery-test race was corrected by explicitly testing the real load-failure → save-failure transition at the 300ms autosave boundary; musical-state and feedback assertions were retained.

Current Chromium browser results on review asset **`author-kLtUUvWv.js`**:

| Harness | Result | Scope |
| --- | --- | --- |
| Author | **23/23** | Actual controls, local recovery, parts, 62 native-select elements and 12 physically sized page elements containing 36 complete systems. Print requests are intercepted; this is not saved output. |
| Staff interaction | **20/20** | Notes and ordinary rests, real SVG geometry, detached previews, exact source/history, voice ownership, cancellation and no-op target selection. Synthetic pointer routing uses fixture-local capture bookkeeping except its explicit native-capture rejection case. |
| Workspace | **21/21** | Composing/harmony passes, continuation, source/draft guards, missing bookmarks, stable palette/paper, instruction More, late-scroll ownership and unchanged print profiles. These are scripted journeys, not a timed human session. |

Direct browser-controlled review additionally exercised ordinary rest placement and a prepared rest drag, rest selection/Delete/Undo, selected quarter-tone correction, More toggling, and compact native-popover placement. At **1500 × 900**, **390 × 660** and **390 × 360**, the normal palette measured **48px** with controls at least **44px**. The short-screen notation viewport retained **209px** of height. Pitch and Value ended **8px** above their trigger; scrolling the short Pitch panel did not scroll the score. A separate **20px CSS text** fixture used two palette rows of about **118px** with **55px** controls. This fixture does not qualify OS text settings or page zoom.

The engraver, composer, performer, design lead, IA specialist and Golden-inspired reviewer accepted the bounded implementation and the evidence supplied for their findings. The design lead closed the final forecast-priority finding after its corrected screenshot and regression. This is not personal endorsement by Golden Krishna or a substitute for user testing.

Remaining qualification includes hardware touch and pen, software-keyboard occlusion, OS text scaling/page zoom, assistive technology, native-picker keyboard/focus behavior, the timed mixed-task composing review, an actually saved PDF with font/clipping inspection, and physical printing/page-turn rehearsal. The optional note-relative toolbar remains off by default. Browser-controlled actions and synthetic capture fixtures do not certify those unperformed checks.

The production build in `dist` uses **`author-DFtkn0DU.js`** and **`author-BbXlk0TR.css`**. The existing preview process, PID **46308**, serves **http://127.0.0.1:4174/author.html**; reload to use the new implementation. No additional production server or external deployment was created.

### Document menu positioning — 2026-08-29

Document was omitted from the shared native positioning manager. Its older CSS anchor rule was overridden by the later generic corner inset, so the menu covered its trigger. The pre-fix browser measurement put the menu at **y=12px** while its button occupied **y=7.5–51.5px**.

Document now uses the same managed native positioning, toggle and cleanup lifecycle as the other compact menus. Its content has the shared scroll-body marker; its heading and Close button remain outside that body. The obsolete Document anchor styles were removed. Browsers without native popovers retain visible Document/Close triggers for the managed in-flow section. File actions use the manager to close either presentation. No musical command or keyboard-dismissal override was added.

Acceptance required an **8px gap below the header trigger**, an uncovered stationary button, unchanged score geometry, internally scrolling short-screen content, native declarative toggle/Close ownership, and preserved drafts, selection, writing destination and Undo/Redo. Twelve new actual-Author integration cases cover the lifecycle and state contracts with explicit native/positioning test boundaries. Three older workspace fixtures now open Document before Score setup, and two CSS tests assert the shared surface contract instead of requiring the removed anchor path; no state or availability assertions were relaxed.

The strengthened Author browser suite passes **23/23**, including exact gap, trigger hit-testing, containment and unchanged layout at **1180 × 760**, **390 × 760**, **390 × 360** and **1180 × 360**. A separate browser-controlled check at **390 × 360** measured Document at **y=54px**, below a button ending at **46px**; its **229px** content viewport scrolled **408px** while the score remained at scroll position zero. Trigger toggling and nested Score setup/Close did not change the musical revision. Browser-controlled Escape and outside-click attempts did not establish native dismissal in this session; those actions remain browser-owned and require a trusted manual check, not a claimed pass.

The final aggregate passes **3,908 tests in 90 files**, with no failures or skipped tests. Typecheck, review and production builds, and the whitespace check pass. Review assets are **`author-BoH9_Xpj.js`**, **`author-BL68HK6X.css`** and **`authorTests-DKhpfGCh.js`**; production uses **`author-DnrJX0DH.js`** with the same CSS. Both existing local sites have been rebuilt: **http://127.0.0.1:4176/author.html** for review and **http://127.0.0.1:4174/author.html** for production preview.
