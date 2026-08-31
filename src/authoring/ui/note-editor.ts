import { phArrowDown, phArrowRight, phArrowUUpLeft, phArrowUp, phSlidersHorizontal, phX } from '../../ui/icons/phosphor.js';
import { bravuraAccidentalDoubleFlat, bravuraAccidentalDoubleSharp, bravuraAccidentalFlat, bravuraAccidentalNatural, bravuraAccidentalQuarterToneFlatStein, bravuraAccidentalQuarterToneSharpStein, bravuraAccidentalSharp, bravuraAccidentalThreeQuarterTonesFlatZimmermann, bravuraAccidentalThreeQuarterTonesSharpStein, bravuraArticAccentAbove, bravuraNote128thUp, bravuraNote16thUp, bravuraNote32ndUp, bravuraNote64thUp, bravuraNote8thUp, bravuraNoteDoubleWhole, bravuraNoteHalfUp, bravuraNoteQuarterUp, bravuraNoteWhole } from '../../ui/icons/bravura.js';
import { nativeOptionTemplate, nativeSelectDefault } from '../../ui/option-content.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Accessible note editor with immediate changes and undo controls. */
export function noteEditor(): TemplateResult {
  return html`
    <section id="note-editor" class="note-editor nonprinting" popover="auto" aria-labelledby="note-editor-heading" aria-describedby="note-editor-context" hidden>
      <div class="note-editor-heading">
        <h2 id="note-editor-heading">Edit note</h2>
        <button id="close-note-editor" type="button" class="quiet-button" popovertarget="note-editor" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="note-editor-body">
        <p id="note-editor-context" class="note-editor-context">Select a note on the staff.</p>
        <label id="note-direction-field" class="field" for="note-direction" hidden>Pitch direction<select id="note-direction" name="note-direction" class="author-select" aria-describedby="note-direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${nativeOptionTemplate({ value: "higher", label: "Higher (top)", icon: phArrowUp })}
            ${nativeOptionTemplate({ value: "same", label: "Same (middle)", icon: phArrowRight, selected: true })}
            ${nativeOptionTemplate({ value: "lower", label: "Lower (bottom)", icon: phArrowDown })}
            ${nativeSelectDefault('same')}
          </select>
        </label>
        <div class="note-rhythm-fields">
          <label class="field" for="note-duration">Note value<select id="note-duration" name="note-duration" class="author-select" aria-describedby="note-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${nativeOptionTemplate({ value: "breve", label: "Breve", icon: bravuraNoteDoubleWhole })}
              ${nativeOptionTemplate({ value: "whole", label: "Whole", icon: bravuraNoteWhole })}
              ${nativeOptionTemplate({ value: "half", label: "Half", icon: bravuraNoteHalfUp })}
              ${nativeOptionTemplate({ value: "quarter", label: "Quarter", icon: bravuraNoteQuarterUp })}
              ${nativeOptionTemplate({ value: "eighth", label: "Eighth", icon: bravuraNote8thUp })}
              ${nativeOptionTemplate({ value: "sixteenth", label: "Sixteenth", icon: bravuraNote16thUp })}
              ${nativeOptionTemplate({ value: "thirty-second", label: "32nd", icon: bravuraNote32ndUp })}
              ${nativeOptionTemplate({ value: "sixty-fourth", label: "64th", icon: bravuraNote64thUp })}
              ${nativeOptionTemplate({ value: "128th", label: "128th", icon: bravuraNote128thUp })}
            </select>
          </label>
          <label class="field" for="note-dots">Dots<select id="note-dots" name="note-dots" class="author-select" aria-describedby="note-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <div id="note-pitch-controls" class="note-pitch-controls">
          <fieldset class="note-accidentals" aria-describedby="note-accidental-help">
            <legend>Set accidental</legend>
            <div class="accidental-choices">
              <button id="note-double-flat" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalDoubleFlat, html`<span>Double flat</span>`)}</button>
              <button id="note-flat" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalFlat, html`<span>Flat</span>`)}</button>
              <button id="note-natural" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalNatural, html`<span>Natural</span>`)}</button>
              <button id="note-sharp" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalSharp, html`<span>Sharp</span>`)}</button>
              <button id="note-double-sharp" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalDoubleSharp, html`<span>Double sharp</span>`)}</button>
            </div>
          </fieldset>
          <label class="field" for="note-microtone">Quarter-tone accidental<select id="note-microtone" name="note-microtone" class="author-select" aria-describedby="note-accidental-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Choose a quarter-tone alteration…</option>
              ${nativeOptionTemplate({ value: "-1.5", label: "Three-quarter flat \u00b7 \u22121.5 semitones", icon: bravuraAccidentalThreeQuarterTonesFlatZimmermann })}
              ${nativeOptionTemplate({ value: "-0.5", label: "Quarter flat \u00b7 \u22120.5 semitone", icon: bravuraAccidentalQuarterToneFlatStein })}
              ${nativeOptionTemplate({ value: "0.5", label: "Quarter sharp \u00b7 +0.5 semitone", icon: bravuraAccidentalQuarterToneSharpStein })}
              ${nativeOptionTemplate({ value: "1.5", label: "Three-quarter sharp \u00b7 +1.5 semitones", icon: bravuraAccidentalThreeQuarterTonesSharpStein })}
            </select>
          </label>
          <p id="note-accidental-help" class="field-help">Sets the spelling; the printed sign follows the key and engraving settings.</p>
        </div>
        <p id="note-editor-error" class="note-editor-error" role="alert" hidden=""></p>
        <p id="note-editor-feedback" class="note-editor-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="note-editor-routes">
          <button id="note-attached-marks" type="button">${buttonContent(bravuraArticAccentAbove, html`<span data-control-label>Attached marks…</span>`)}</button>
          <button id="note-advanced-edit" type="button" class="quiet-button">${buttonContent(phSlidersHorizontal, html`<span data-control-label>Advanced properties…</span>`)}</button>
        </div>
        <p id="note-direction-help" class="field-help" hidden>Higher, same, and lower refer to this voice’s previous main pitch. Tied continuations stay on Same. Direction changes preserve written rhythm and attached marks.</p>
        <p id="note-rhythm-help" class="field-help">Written values move following notes within this voice. No rests are added automatically.</p>
      </div>
      <div class="note-editor-footer">
        <button id="note-editor-undo" type="button" disabled="">${buttonContent(phArrowUUpLeft, "Undo change")}</button>
        <p class="field-help">Changes apply immediately.<br>Undo restores each change.</p>
      </div>
    </section>
  `;
}
