import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Event properties retain independent staged form controls. */
export function eventProperties(): TemplateResult {
  return html`
    <section id="selection-inspector" class="tool-panel properties-panel" role="region" aria-labelledby="properties-heading" tabindex="0">
      <p id="event-form-context" class="target-context">Select an event to edit its values.</p>
      <div class="draft-notice">
        <p id="selected-draft-status" class="draft-status" role="status" aria-live="polite" tabindex="-1"></p>
        <div class="draft-actions">
          <button id="load-event-values" type="button" class="quiet-button" hidden>Discard &amp; reload</button>
          <button id="return-selected-draft" type="button" class="quiet-button" hidden>Return to target</button>
          <button id="review-selected-draft" type="button" class="quiet-button" hidden>Review current changes</button>
        </div>
      </div>
      <div class="properties-actions">
        <button id="properties-pitch" type="button" popovertarget="selection-pitch-chooser" aria-label="Pitch spelling and quarter-tone alterations" disabled>Spelling…</button>
        <button id="selection-prepare-drag" type="button" disabled>Prepare pitch drag</button>
      </div>
      ${eventMarkings()}
      <details id="event-details" class="sub-disclosure event-details"><summary>Event details</summary>
        <div class="sub-disclosure-content">
          <p class="field-help">Changes here are staged. Apply event details when ready; common selection controls apply immediately.</p>
          <div class="field-grid two-fields">
            <label class="field" for="selected-kind">Event type<select id="selected-kind" name="selected-kind" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="note">Note</option>
                <option value="chord">Chord</option>
                <option value="rhythm">Rhythm note (no pitch)</option>
                <option value="road">3 roads note</option>
                <option value="rest">Rest</option>
                <option value="rhythmic-slash">Rhythmic slash</option>
                <option value="slash">Open slash</option>
              </select>
            </label>
            <label id="selected-pitch-field" class="field" for="selected-pitch">Pitch &amp; octave<input id="selected-pitch" name="selected-pitch" type="text" value="C4" autocomplete="off" spellcheck="false" aria-describedby="selected-pitch-help" />
            </label>
            <label id="selected-pitches-field" class="field" for="selected-pitches" hidden>Chord pitches<input id="selected-pitches" name="selected-pitches" type="text" value="C4 E4 G4" autocomplete="off" spellcheck="false" aria-describedby="selected-pitch-help" />
            </label>
          </div>
          <p id="selected-pitch-help" class="field-help">Spell pitches explicitly: F4 is natural, F#4 sharp, Fqs4 quarter-sharp, and Fqf4 quarter-flat. Use tqf or tqs for three-quarter tones, including in chord pitches. These are alterations from the natural letter, not increments from the current spelling.</p>
          <fieldset id="selected-nominal-span" aria-describedby="selected-nominal-help" hidden>
            <legend>Nominal span (open slash)</legend>
            <div class="field-grid two-fields">
              <label class="field" for="selected-duration">Nominal value<select id="selected-duration" name="selected-duration" class="author-select" aria-describedby="selected-nominal-help" .value=${'quarter'}>
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="breve">Breve</option>
                  <option value="whole">Whole</option>
                  <option value="half">Half</option>
                  <option value="quarter" selected>Quarter</option>
                  <option value="eighth">Eighth</option>
                  <option value="sixteenth">Sixteenth</option>
                  <option value="thirty-second">32nd</option>
                  <option value="sixty-fourth">64th</option>
                  <option value="128th">128th</option>
                </select>
              </label>
              <label class="field" for="selected-dots">Nominal dots<select id="selected-dots" name="selected-dots" class="author-select" aria-describedby="selected-nominal-help">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="0">None</option>
                  <option value="1">1 dot</option>
                  <option value="2">2 dots</option>
                  <option value="3">3 dots</option>
                </select>
              </label>
            </div>
            <p id="selected-nominal-help" class="field-help">The time reserved by this open slash; its rhythm stays unwritten. Apply event details to accept the span.</p>
          </fieldset>
          <label class="check-field" for="selected-measure-rest" id="selected-measure-rest-field" hidden>
            <input id="selected-measure-rest" name="selected-measure-rest" type="checkbox" />Full-measure rest</label>
          <button id="update-event" type="button" class="primary-button" disabled>Apply event details</button>
        </div>
      </details>
      <details id="event-engraving" class="sub-disclosure"><summary>Engraving</summary>
        <div class="sub-disclosure-content">
          <div class="field-grid two-fields">
            <label class="field" for="selected-accidental-display">Show accidental<select id="selected-accidental-display" name="selected-accidental-display" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">When needed</option>
                <option value="always">Always</option>
                <option value="courtesy">Courtesy (parentheses)</option>
              </select>
            </label>
            <label class="field" for="selected-stem">Stem<select id="selected-stem" name="selected-stem" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Automatic</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
          </div>
          <p class="field-help">
            <span id="selected-accidental-help">Show accidental changes the printed sign, not the spelling. </span>These choices apply immediately; Undo restores each change.</p>
        </div>
      </details>
      <div id="selected-common-compat" hidden>
        <label id="selected-direction-field" class="field" for="selected-direction" hidden>Pitch direction<select id="selected-direction" name="selected-direction" class="author-select" aria-describedby="selected-direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="higher">Higher (top)</option>
            <option value="same">Same (middle)</option>
            <option value="lower">Lower (bottom)</option>
          </select>
        </label>
        <p id="selected-direction-help" class="field-help" hidden>Higher, same, and lower refer to the previous main pitch in this voice, including across rests and barlines. Harmony and ornament notes do not change that reference. Tied continuations use Same (middle). Changing direction does not change the written rhythm.</p>
        <label id="selected-slash-field" class="check-field compatibility-field" for="selected-rhythmic" hidden>
          <input id="selected-rhythmic" name="selected-rhythmic" type="checkbox" />Write slash rhythm</label>
      </div>
      <div class="button-row panel-actions">
        <button id="remove-event" type="button" class="danger-button">Remove event</button>
      </div>
    </section>
  `;
}

/** Attached event markings and their explicit draft actions. */
export function eventMarkings(): TemplateResult {
  return html`
    <section id="event-markings-editor" class="subsection" aria-labelledby="event-markings-heading">
      <div class="panel-heading">
        <h3 id="event-markings-heading">Attached marks</h3>
        <p>These marks belong to this event and add no written duration. Chord symbols and instructions at a musical position stay in Instructions.</p>
      </div>
      <p id="event-markings-target" class="target-context">Select one event to edit its attached marks.</p>
      <div class="draft-notice">
        <p id="event-markings-draft-status" class="draft-status" role="status" aria-live="polite" tabindex="-1"></p>
        <div class="draft-actions">
          <button id="discard-event-markings" type="button" class="quiet-button" hidden>Discard changes</button>
          <button id="return-event-markings" type="button" class="quiet-button" hidden>Return to target</button>
          <button id="review-event-markings" type="button" class="quiet-button" hidden>Review current changes</button>
        </div>
      </div>
      <div id="event-markings-tie-options" class="event-markings-tie-options" hidden>
        <label class="check-field" for="event-markings-tie-scope">
          <input id="event-markings-tie-scope" name="event-markings-tie-scope" type="checkbox" aria-describedby="event-markings-tie-help">Apply interval edits to the complete tie chain</label>
        <p id="event-markings-tie-help" class="field-help">This scope changes harmony intervals across the complete connected tie chain in one edit. Articulations and ornaments stay on the selected segment. Leave it off to edit this segment only; no intervals are inherited automatically.</p>
      </div>
      <p id="event-markings-empty" class="field-help">No marks attached to this event.</p>
      <div id="event-markings-rows"></div>
      <div class="button-row">
        <button id="add-event-articulation" type="button">Add articulation</button>
        <button id="add-event-ornament" type="button">Add ornament</button>
        <button id="add-event-interval" type="button">Add harmony interval</button>
      </div>
      <p id="event-markings-availability" class="field-help"></p>
      <p id="event-markings-placement-help" class="field-help">Articulations and ornaments are placed automatically opposite the drawn stem, or above when there is no stem. Harmony direction stays above or below the main pitch.</p>
      <p id="event-markings-interval-help" class="field-help" hidden>Use intervals 1–13 with optional b or #. For example, 5 above F is C; b3 below B♭ is G. Alter the interval’s distance before applying above or below. Every tied road segment must list the same full set of harmony intervals; nothing is inherited.</p>
      <p id="event-markings-ornament-help" class="field-help" hidden>Ornaments are printed instructions, not written auxiliary notes. In 3 roads music, choose ornament notes freely. Harmony and ornament notes never replace the main pitch used by higher, same, and lower.</p>
      <div class="button-row panel-actions">
        <button id="apply-event-markings" type="button" class="primary-button" disabled>Apply attached marks</button>
      </div>
    </section>
  `;
}
