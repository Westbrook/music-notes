import { phArrowDown, phArrowRight, phArrowUp, phMinus, phPlus, phX } from '../../ui/icons/phosphor.js';
import { bravuraAccidentalDoubleFlat, bravuraAccidentalDoubleSharp, bravuraAccidentalFlat, bravuraAccidentalNatural, bravuraAccidentalQuarterToneFlatStein, bravuraAccidentalQuarterToneSharpStein, bravuraAccidentalSharp, bravuraAccidentalThreeQuarterTonesFlatZimmermann, bravuraAccidentalThreeQuarterTonesSharpStein, bravuraArticAccentAbove, bravuraArticMarcatoAbove, bravuraArticStaccatissimoAbove, bravuraArticStaccatoAbove, bravuraArticTenutoAbove, bravuraFermataAbove, bravuraNote128thUp, bravuraNote16thUp, bravuraNote32ndUp, bravuraNote64thUp, bravuraNote8thUp, bravuraNoteDoubleWhole, bravuraNoteHalfUp, bravuraNoteQuarterUp, bravuraNoteWhole } from '../../ui/icons/bravura.js';
import { nativeOptionTemplate } from '../../ui/option-content.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Immediate written value and dot changes for the accepted selection. */
export function selectionValueChooser(): TemplateResult {
  return html`
    <section id="selection-value-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-value-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-value-heading">Written value</h2>
        <button id="close-selection-value" type="button" class="quiet-button" popovertarget="selection-value-chooser" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="selection-duration">Note value<select id="selection-duration" name="selection-duration" class="author-select" aria-describedby="selection-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
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
          <label class="field" for="selection-dots">Dots<select id="selection-dots" name="selection-dots" class="author-select" aria-describedby="selection-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <p id="selection-rhythm-help" class="field-help">Written values and augmentation dots retain their separate meanings. Changing one preserves the other and the next-entry recipe.</p>
        <p id="selection-value-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `;
}

/** Absolute pitch spelling and relative direction for selected events. */
export function selectionPitchChooser(): TemplateResult {
  return html`
    <section id="selection-pitch-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-pitch-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-pitch-heading">Pitch &amp; direction</h2>
        <button id="close-selection-pitch" type="button" class="quiet-button" popovertarget="selection-pitch-chooser" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields selection-pitch-components">
          <label id="selection-note-step-field" class="field" for="selection-note-step" hidden>Pitch letter<select id="selection-note-step" name="selection-note-step" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
              <option value="F">F</option>
              <option value="G">G</option>
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </label>
          <label id="selection-note-octave-field" class="field" for="selection-note-octave" hidden>Octave<select id="selection-note-octave" name="selection-note-octave" class="author-select" aria-describedby="selection-pitch-help" .value=${'4'}>
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="-1">-1</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4" selected>4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="9">9</option>
            </select>
          </label>
        </div>
        <div id="selection-chooser-accidentals" role="group" aria-label="Set absolute accidental" aria-describedby="selection-pitch-help" hidden>
          <button id="selection-chooser-flat" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalFlat, "Flat")}</button>
          <button id="selection-chooser-natural" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalNatural, "Natural")}</button>
          <button id="selection-chooser-sharp" type="button" aria-pressed="false">${buttonContent(bravuraAccidentalSharp, "Sharp")}</button>
        </div>
        <div class="field-grid">
          <label id="selection-alteration-field" class="field" for="selection-alteration">Absolute alteration<select id="selection-alteration" name="selection-alteration" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${nativeOptionTemplate({ value: "-2", label: "Double flat \u00b7 \u22122 semitones", icon: bravuraAccidentalDoubleFlat })}
              ${nativeOptionTemplate({ value: "-1.5", label: "Three-quarter flat \u00b7 \u22121.5 semitones", icon: bravuraAccidentalThreeQuarterTonesFlatZimmermann })}
              ${nativeOptionTemplate({ value: "-1", label: "Flat \u00b7 \u22121 semitone", icon: bravuraAccidentalFlat })}
              ${nativeOptionTemplate({ value: "-0.5", label: "Quarter flat \u00b7 \u22120.5 semitone", icon: bravuraAccidentalQuarterToneFlatStein })}
              ${nativeOptionTemplate({ value: "0", label: "Natural \u00b7 0 semitones", icon: bravuraAccidentalNatural })}
              ${nativeOptionTemplate({ value: "0.5", label: "Quarter sharp \u00b7 +0.5 semitone", icon: bravuraAccidentalQuarterToneSharpStein })}
              ${nativeOptionTemplate({ value: "1", label: "Sharp \u00b7 +1 semitone", icon: bravuraAccidentalSharp })}
              ${nativeOptionTemplate({ value: "1.5", label: "Three-quarter sharp \u00b7 +1.5 semitones", icon: bravuraAccidentalThreeQuarterTonesSharpStein })}
              ${nativeOptionTemplate({ value: "2", label: "Double sharp \u00b7 +2 semitones", icon: bravuraAccidentalDoubleSharp })}
            </select>
          </label>
          <label id="selection-direction-field" class="field" for="selection-direction">Relative pitch direction<select id="selection-direction" name="selection-direction" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${nativeOptionTemplate({ value: "higher", label: "Higher (top)", icon: phArrowUp })}
              ${nativeOptionTemplate({ value: "same", label: "Same (middle)", icon: phArrowRight })}
              ${nativeOptionTemplate({ value: "lower", label: "Lower (bottom)", icon: phArrowDown })}
            </select>
          </label>
        </div>
        <p id="selection-pitch-help" class="field-help">Alterations are relative to the natural letter, not increments. Road directions refer to this voice’s previous main pitch.</p>
        <p id="selection-pitch-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `;
}

/** Shared selection properties and articulation actions. */
export function selectionSharedChooser(): TemplateResult {
  return html`
    <section id="selection-shared-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-shared-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-shared-heading">Shared properties</h2>
        <button id="close-selection-shared" type="button" class="quiet-button" popovertarget="selection-shared-chooser" popovertargetaction="hide">${buttonContent(phX, "Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="selection-shared-duration">Note value<select id="selection-shared-duration" name="selection-shared-duration" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
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
          <label class="field" for="selection-shared-dots">Dots<select id="selection-shared-dots" name="selection-shared-dots" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
          <label class="field" for="selection-stem">Stem policy<select id="selection-stem" name="selection-stem" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="auto">Automatic</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </label>
          <label class="field" for="selection-accidental-display">Show accidental<select id="selection-accidental-display" name="selection-accidental-display" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="auto">When needed</option>
              <option value="always">Always</option>
              <option value="courtesy">Courtesy (parentheses)</option>
            </select>
          </label>
          <label class="field" for="selection-shared-alteration">Absolute alteration<select id="selection-shared-alteration" name="selection-shared-alteration" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${nativeOptionTemplate({ value: "-2", label: "Double flat \u00b7 \u22122 semitones", icon: bravuraAccidentalDoubleFlat })}
              ${nativeOptionTemplate({ value: "-1.5", label: "Three-quarter flat \u00b7 \u22121.5 semitones", icon: bravuraAccidentalThreeQuarterTonesFlatZimmermann })}
              ${nativeOptionTemplate({ value: "-1", label: "Flat \u00b7 \u22121 semitone", icon: bravuraAccidentalFlat })}
              ${nativeOptionTemplate({ value: "-0.5", label: "Quarter flat \u00b7 \u22120.5 semitone", icon: bravuraAccidentalQuarterToneFlatStein })}
              ${nativeOptionTemplate({ value: "0", label: "Natural \u00b7 0 semitones", icon: bravuraAccidentalNatural })}
              ${nativeOptionTemplate({ value: "0.5", label: "Quarter sharp \u00b7 +0.5 semitone", icon: bravuraAccidentalQuarterToneSharpStein })}
              ${nativeOptionTemplate({ value: "1", label: "Sharp \u00b7 +1 semitone", icon: bravuraAccidentalSharp })}
              ${nativeOptionTemplate({ value: "1.5", label: "Three-quarter sharp \u00b7 +1.5 semitones", icon: bravuraAccidentalThreeQuarterTonesSharpStein })}
              ${nativeOptionTemplate({ value: "2", label: "Double sharp \u00b7 +2 semitones", icon: bravuraAccidentalDoubleSharp })}
            </select>
          </label>
        </div>
        <p id="selection-shared-help" class="field-help">Mixed means the selected events differ. An eligible change applies to the exact selection in one Undo, or changes nothing.</p>
        <div class="subsection">
          <h3>Articulation presence</h3>
          <label class="field" for="selection-articulation">Articulation<select id="selection-articulation" name="selection-articulation" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${nativeOptionTemplate({ value: "accent", label: "Accent", icon: bravuraArticAccentAbove })}
              ${nativeOptionTemplate({ value: "staccato", label: "Staccato", icon: bravuraArticStaccatoAbove })}
              ${nativeOptionTemplate({ value: "tenuto", label: "Tenuto", icon: bravuraArticTenutoAbove })}
              ${nativeOptionTemplate({ value: "marcato", label: "Marcato", icon: bravuraArticMarcatoAbove })}
              ${nativeOptionTemplate({ value: "staccatissimo", label: "Staccatissimo", icon: bravuraArticStaccatissimoAbove })}
              ${nativeOptionTemplate({ value: "fermata", label: "Fermata", icon: bravuraFermataAbove })}
            </select>
          </label>
          <div class="button-row">
            <button id="selection-add-articulation" type="button">${buttonContent(phPlus, html`<span data-control-label>Add to selection</span>`)}</button>
            <button id="selection-remove-articulation" type="button">${buttonContent(phMinus, html`<span data-control-label>Remove from selection</span>`)}</button>
          </div>
          <p class="field-help">Add only missing marks; preserve existing identities. Placement follows the drawn stem automatically.</p>
        </div>
        <p id="selection-shared-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `;
}
