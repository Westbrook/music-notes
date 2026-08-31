import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Accessible note editor with immediate changes and undo controls. */
export function noteEditor(): TemplateResult {
  return html`
    <section id="note-editor" class="note-editor nonprinting" popover="auto" aria-labelledby="note-editor-heading" aria-describedby="note-editor-context" hidden>
      <div class="note-editor-heading">
        <h2 id="note-editor-heading">Edit note</h2>
        <button id="close-note-editor" type="button" class="quiet-button" popovertarget="note-editor" popovertargetaction="hide">Close</button>
      </div>
      <div class="note-editor-body">
        <p id="note-editor-context" class="note-editor-context">Select a note on the staff.</p>
        <label id="note-direction-field" class="field" for="note-direction" hidden>Pitch direction<select id="note-direction" name="note-direction" class="author-select" aria-describedby="note-direction-help" .value=${'same'}>
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="higher">Higher (top)</option>
            <option value="same" selected>Same (middle)</option>
            <option value="lower">Lower (bottom)</option>
          </select>
        </label>
        <div class="note-rhythm-fields">
          <label class="field" for="note-duration">Note value<select id="note-duration" name="note-duration" class="author-select" aria-describedby="note-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="breve">Breve</option>
              <option value="whole">Whole</option>
              <option value="half">Half</option>
              <option value="quarter">Quarter</option>
              <option value="eighth">Eighth</option>
              <option value="sixteenth">Sixteenth</option>
              <option value="thirty-second">32nd</option>
              <option value="sixty-fourth">64th</option>
              <option value="128th">128th</option>
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
              <button id="note-double-flat" type="button" aria-pressed="false"><span class="accidental-sign" aria-hidden="true">♭♭</span><span>Double flat</span></button>
              <button id="note-flat" type="button" aria-pressed="false"><span class="accidental-sign" aria-hidden="true">♭</span><span>Flat</span></button>
              <button id="note-natural" type="button" aria-pressed="false"><span class="accidental-sign" aria-hidden="true">♮</span><span>Natural</span></button>
              <button id="note-sharp" type="button" aria-pressed="false"><span class="accidental-sign" aria-hidden="true">♯</span><span>Sharp</span></button>
              <button id="note-double-sharp" type="button" aria-pressed="false"><span class="accidental-sign" aria-hidden="true">𝄪</span><span>Double sharp</span></button>
            </div>
          </fieldset>
          <label class="field" for="note-microtone">Quarter-tone accidental<select id="note-microtone" name="note-microtone" class="author-select" aria-describedby="note-accidental-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Choose a quarter-tone alteration…</option>
              <option value="-1.5">Three-quarter flat · −1.5 semitones</option>
              <option value="-0.5">Quarter flat · −0.5 semitone</option>
              <option value="0.5">Quarter sharp · +0.5 semitone</option>
              <option value="1.5">Three-quarter sharp · +1.5 semitones</option>
            </select>
          </label>
          <p id="note-accidental-help" class="field-help">Sets the spelling; the printed sign follows the key and engraving settings.</p>
        </div>
        <p id="note-editor-error" class="note-editor-error" role="alert" hidden=""></p>
        <p id="note-editor-feedback" class="note-editor-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="note-editor-routes">
          <button id="note-attached-marks" type="button">Attached marks…</button>
          <button id="note-advanced-edit" type="button" class="quiet-button">Advanced properties…</button>
        </div>
        <p id="note-direction-help" class="field-help" hidden>Higher, same, and lower refer to this voice’s previous main pitch. Tied continuations stay on Same. Direction changes preserve written rhythm and attached marks.</p>
        <p id="note-rhythm-help" class="field-help">Written values move following notes within this voice. No rests are added automatically.</p>
      </div>
      <div class="note-editor-footer">
        <button id="note-editor-undo" type="button" disabled="">Undo change</button>
        <p class="field-help">Changes apply immediately.<br>Undo restores each change.</p>
      </div>
    </section>
  `;
}
