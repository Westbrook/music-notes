import { phArrowDown, phArrowRight, phArrowUp, phHand, phMusicNotes, phSlidersHorizontal, phX } from '../../ui/icons/phosphor.js';
import { bravuraAccidentalDoubleFlat, bravuraAccidentalDoubleSharp, bravuraAccidentalFlat, bravuraAccidentalNatural, bravuraAccidentalQuarterToneFlatStein, bravuraAccidentalQuarterToneSharpStein, bravuraAccidentalSharp, bravuraAccidentalThreeQuarterTonesFlatZimmermann, bravuraAccidentalThreeQuarterTonesSharpStein, bravuraNote128thUp, bravuraNote16thUp, bravuraNote32ndUp, bravuraNote64thUp, bravuraNote8thUp, bravuraNoteDoubleWhole, bravuraNoteHalfUp, bravuraNoteQuarterUp, bravuraNoteWhole, bravuraNoteheadSlashHorizontalEnds, bravuraRestQuarter } from '../../ui/icons/bravura.js';
import { nativeOptionTemplate, nativeSelectDefault } from '../../ui/option-content.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Recipe controls used only when inserting new music. */
export function entrySettings(): TemplateResult {
  return html`
    <section id="entry-settings" class="surface-popover entry-settings nonprinting" popover="auto" aria-labelledby="entry-settings-heading">
      <div class="popover-heading">
        <h2 id="entry-settings-heading">New-note options</h2>
        <button id="close-entry-settings" type="button" class="quiet-button" popovertarget="entry-settings" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <p id="entry-options-help" class="field-help">These options belong to new music. Selecting or correcting an event leaves them unchanged.</p>
        <label class="field" for="event-kind">Event type<select id="event-kind" name="event-kind" class="author-select" >
            <button type="button"><selectedcontent></selectedcontent></button>
            ${nativeOptionTemplate({ value: "note", label: "Note", icon: bravuraNoteQuarterUp })}
            ${nativeOptionTemplate({ value: "chord", label: "Chord", icon: phMusicNotes })}
            ${nativeOptionTemplate({ value: "rhythm", label: "Rhythm note (no pitch)", icon: bravuraNoteQuarterUp })}
            ${nativeOptionTemplate({ value: "road", label: "3 roads note", icon: bravuraNoteheadSlashHorizontalEnds })}
            ${nativeOptionTemplate({ value: "rest", label: "Rest", icon: bravuraRestQuarter })}
            ${nativeOptionTemplate({ value: "rhythmic-slash", label: "Rhythmic slash", icon: bravuraNoteheadSlashHorizontalEnds })}
            ${nativeOptionTemplate({ value: "slash", label: "Open slash", icon: bravuraNoteheadSlashHorizontalEnds })}
          </select>
        </label>
        <p id="entry-placement-help" class="field-help">Choose a value, then point at the staff to place a single pitched note or an ordinary rest. Rest placement also works on rhythm and 3 roads staves. Insert here or Enter uses the exact writing destination; a full-measure rest remains an explicit whole-voice choice.</p>
        <label id="direction-field" class="field inline-road-direction" for="event-direction" hidden>Pitch direction<select id="event-direction" name="event-direction" class="author-select" aria-describedby="direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${nativeOptionTemplate({ value: "higher", label: "Higher (top)", icon: phArrowUp })}
            ${nativeOptionTemplate({ value: "same", label: "Same (middle)", icon: phArrowRight, selected: true })}
            ${nativeOptionTemplate({ value: "lower", label: "Lower (bottom)", icon: phArrowDown })}
            ${nativeSelectDefault('same')}
          </select>
        </label>
        <div class="field-grid two-fields">
          <label id="pitch-field" class="field pitch-field" for="event-pitch">Pitch &amp; octave<input id="event-pitch" name="event-pitch" type="text" value="C4" spellcheck="false" autocomplete="off" aria-describedby="pitch-help event-alteration-status">
          </label>
          <label id="pitches-field" class="field pitches-field" for="event-pitches" hidden="">Chord pitches<input id="event-pitches" name="event-pitches" type="text" value="C4 E4 G4" spellcheck="false" autocomplete="off" aria-describedby="pitch-help">
          </label>
          <label id="event-alteration-field" class="field" for="event-alteration">Pitch alteration<select id="event-alteration" name="event-alteration" class="author-select" aria-describedby="pitch-help event-alteration-status">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${nativeOptionTemplate({ value: "-2", label: "Double flat \u00b7 \u22122 semitones", icon: bravuraAccidentalDoubleFlat })}
              ${nativeOptionTemplate({ value: "-1.5", label: "Three-quarter flat \u00b7 \u22121.5 semitones", icon: bravuraAccidentalThreeQuarterTonesFlatZimmermann })}
              ${nativeOptionTemplate({ value: "-1", label: "Flat \u00b7 \u22121 semitone", icon: bravuraAccidentalFlat })}
              ${nativeOptionTemplate({ value: "-0.5", label: "Quarter flat \u00b7 \u22120.5 semitone", icon: bravuraAccidentalQuarterToneFlatStein })}
              ${nativeOptionTemplate({ value: "0", label: "Natural \u00b7 0 semitones", icon: bravuraAccidentalNatural, selected: true })}
              ${nativeOptionTemplate({ value: "0.5", label: "Quarter sharp \u00b7 +0.5 semitone", icon: bravuraAccidentalQuarterToneSharpStein })}
              ${nativeOptionTemplate({ value: "1", label: "Sharp \u00b7 +1 semitone", icon: bravuraAccidentalSharp })}
              ${nativeOptionTemplate({ value: "1.5", label: "Three-quarter sharp \u00b7 +1.5 semitones", icon: bravuraAccidentalThreeQuarterTonesSharpStein })}
              ${nativeOptionTemplate({ value: "2", label: "Double sharp \u00b7 +2 semitones", icon: bravuraAccidentalDoubleSharp })}
              ${nativeSelectDefault('0')}
            </select>
          </label>
          <label class="field" for="insert-position">Position
            <select id="insert-position" name="insert-position" class="author-select" aria-describedby="position-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="after">After target</option>
              <option value="before">Before target</option>
              <option value="replace">Replace target</option>
            </select>
          </label>
        </div>
        <p id="event-alteration-status" class="field-help entry-alteration-status" role="status" aria-live="polite"></p>
        <p id="direction-help" class="field-help" hidden>Choose any starting pitch on Same (middle). Higher, same, and lower then refer to the previous main pitch in this voice, including across rests and barlines. Harmony and ornament notes do not change that reference. Tied continuations use Same (middle).</p>
        <p id="entry-keyboard-help" class="field-help">With the score focused in Write notes, Enter inserts the exact current recipe. A–G writes natural pitches on pitched staves; it does not keep the chosen alteration. Fields and buttons keep their normal keys.</p>
        <p id="pitch-help" class="field-help">Spell pitches explicitly: F4 is natural, F#4 sharp, Fqs4 quarter-sharp, Fqf4 quarter-flat. Use tqf or tqs for three-quarter tones.</p>
        <p id="position-help" class="field-help">On the staff, point to the target. Insert uses your writing destination, which can differ from the selected music.</p>
        <label id="slash-field" class="check-field" for="event-rhythmic" hidden="">
          <input id="event-rhythmic" name="event-rhythmic" type="checkbox"> Write the rhythm with stems</label>
        <label class="check-field" for="event-measure-rest">
          <input id="event-measure-rest" name="event-measure-rest" type="checkbox"> Full-measure rest, rather than a written duration</label>
        <details class="sub-disclosure"><summary>New-event engraving</summary>
          <div class="field-grid two-fields">
            <label class="field" for="event-accidental-display">Show accidental<select id="event-accidental-display" name="event-accidental-display" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">When needed</option>
                <option value="always">Always</option>
                <option value="courtesy">Courtesy (parentheses)</option>
              </select>
              <span class="field-help">Changes the printed sign, not the pitch.</span>
            </label>
            <label class="field" for="event-stem">Stem<select id="event-stem" name="event-stem" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Automatic</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
            <label class="field" for="event-beam">Beam<select id="event-beam" name="event-beam" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Follow beat groups</option>
                <option value="start">Start beam</option>
                <option value="continue">Continue beam</option>
                <option value="end">End beam</option>
                <option value="none">No beam</option>
              </select>
            </label>
          </div>
        </details>
        <section class="subsection prepared-drag-options" aria-labelledby="entry-drag-heading">
          <h3 id="entry-drag-heading">Another way to place a note</h3>
          <p id="entry-drag-help" class="field-help">Prepare the drag handle, then drag it to a staff. It does not change the written value or infer an alteration. Escape or Done returns to ordinary writing.</p>
          <div class="button-row">
            <button id="prepare-entry-drag" type="button" aria-describedby="entry-drag-help">${buttonContent(phHand, html`<span data-control-label>Prepare note drag</span>`)}</button>
          </div>
        </section>
        <div class="subsection">
          <p class="field-help">Inserting notes continues into later bars automatically. Following notes move in order, and new measures are added when needed. One Undo restores the insertion and any moved music.</p>
        </div>
      </div>
    </section>
  `;
}

/** Written value for the next event, independent of accepted selection. */
export function entryValueChooser(): TemplateResult {
  return html`
    <section id="entry-value-chooser" class="surface-popover selection-chooser entry-value-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="entry-value-heading" aria-describedby="entry-destination">
      <div class="popover-heading">
        <h2 id="entry-value-heading">Value for new notes</h2>
        <button id="close-entry-value" type="button" class="quiet-button" popovertarget="entry-value-chooser" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="event-duration">
            <span id="entry-value-field-label">Written value</span>
            <select id="event-duration" name="event-duration" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${nativeOptionTemplate({ value: "breve", label: "Breve", icon: bravuraNoteDoubleWhole })}
              ${nativeOptionTemplate({ value: "whole", label: "Whole", icon: bravuraNoteWhole })}
              ${nativeOptionTemplate({ value: "half", label: "Half", icon: bravuraNoteHalfUp })}
              ${nativeOptionTemplate({ value: "quarter", label: "Quarter", icon: bravuraNoteQuarterUp, selected: true })}
              ${nativeOptionTemplate({ value: "eighth", label: "Eighth", icon: bravuraNote8thUp })}
              ${nativeOptionTemplate({ value: "sixteenth", label: "Sixteenth", icon: bravuraNote16thUp })}
              ${nativeOptionTemplate({ value: "thirty-second", label: "32nd", icon: bravuraNote32ndUp })}
              ${nativeOptionTemplate({ value: "sixty-fourth", label: "64th", icon: bravuraNote64thUp })}
              ${nativeOptionTemplate({ value: "128th", label: "128th", icon: bravuraNote128thUp })}
              ${nativeSelectDefault('quarter')}
            </select>
          </label>
          <label class="field dots-field" for="event-dots">Dots
            <select id="event-dots" name="event-dots" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <p id="entry-value-help" class="field-help">These choices affect the next event, not selected music. Full-measure rests follow the meter; an open slash uses a nominal span without prescribing attacks.</p>
      </div>
    </section>
  `;
}

/** Relative pitch direction chooser for new three-roads music. */
export function entryDirectionChooser(): TemplateResult {
  return html`
    <section id="entry-direction-chooser" class="surface-popover selection-chooser entry-direction-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="entry-direction-heading" aria-describedby="direction-help entry-destination">
      <div class="popover-heading">
        <h2 id="entry-direction-heading">Direction for the next note</h2>
        <button id="close-entry-direction" type="button" class="quiet-button" popovertarget="entry-direction-chooser" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <div class="entry-direction-choices" role="group" aria-label="Choose a relative pitch direction">
          <button id="entry-direction-higher" type="button" aria-pressed="false" data-direction="higher">${buttonContent(phArrowUp, "Higher (top)")}</button>
          <button id="entry-direction-same" type="button" aria-pressed="true" data-direction="same">${buttonContent(phArrowRight, "Same (middle)")}</button>
          <button id="entry-direction-lower" type="button" aria-pressed="false" data-direction="lower">${buttonContent(phArrowDown, "Lower (bottom)")}</button>
        </div>
        <p class="field-help">Relative to the previous main pitch in this voice, including across rests and barlines. A tied continuation stays Same.</p>
        <button id="entry-direction-options" type="button" class="quiet-button" popovertarget="entry-settings">${buttonContent(phSlidersHorizontal, "Other note options\u2026")}</button>
      </div>
    </section>
  `;
}
