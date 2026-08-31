import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Measure editing, structural commands, and empty-voice completion. */
export function measureTools(): TemplateResult {
  return html`
    <section id="measure-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-measure" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Measure</h2>
        <p>Changes apply here. Following measures keep their context; meter and pickup changes align across staves.</p>
      </div>
      <div class="draft-notice">
        <p id="measure-draft-status" class="draft-status" role="status" aria-live="polite"></p>
        <div class="draft-actions">
          <button id="discard-measure-draft" type="button" class="quiet-button" hidden="">Discard &amp; reload</button>
          <button id="return-measure-draft" type="button" class="quiet-button" hidden="">Return to target</button>
          <button id="review-measure-draft" type="button" class="quiet-button" hidden="">Review current changes</button>
        </div>
      </div>
      <div class="field-grid">
        <label class="field" for="measure-meter">Meter<input id="measure-meter" name="measure-meter" type="text" value="4/4" placeholder="7/8 or 2+2+3/8">
        </label>
        <label class="field" for="measure-groups">Beat groups<input id="measure-groups" name="measure-groups" type="text" placeholder="Automatic, or 2+2+3">
        </label>
        <label class="field" for="measure-key">Key signature<input id="measure-key" name="measure-key" type="text" value="C" placeholder="C, Bb, F#m">
        </label>
        <label class="field" for="measure-clef">Clef<select id="measure-clef" name="measure-clef" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="treble">Treble</option>
            <option value="bass">Bass</option>
            <option value="alto">Alto</option>
            <option value="tenor">Tenor</option>
          </select>
        </label>
        <label class="field" for="measure-end-bar">Ending barline<select id="measure-end-bar" name="measure-end-bar" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="final">Final</option>
            <option value="repeat-end">Repeat end</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <div class="check-row">
        <label class="check-field" for="measure-pickup">
          <input id="measure-pickup" name="measure-pickup" type="checkbox"> Pickup</label>
        <label class="check-field" for="measure-incomplete">
          <input id="measure-incomplete" name="measure-incomplete" type="checkbox"> Incomplete draft</label>
        <label class="check-field" for="measure-repeat-start">
          <input id="measure-repeat-start" name="measure-repeat-start" type="checkbox"> Start repeat</label>
      </div>
      <div class="button-row">
        <button id="apply-measure" type="button" class="primary-button">Apply measure settings</button>
        <button id="add-voice" type="button">Add voice</button>
      </div>
      <div class="subsection">
        <p id="short-ending-help" class="field-help">A deliberate short ending must be reviewed before publishing; marking a draft does not approve it.</p>
        <p id="short-ending-empty-help" class="field-help" hidden>This measure has unwritten voices. Write each empty voice or use Fill remainder with rests below before approving a short ending.</p>
        <div class="button-row">
          <button id="review-short-measure" type="button" aria-describedby="measure-draft-status short-ending-help">Approve intentional short ending</button>
          <button id="clear-short-review" type="button" class="quiet-button">Clear approval</button>
        </div>
      </div>
      <div class="subsection button-row">
        <button id="move-measure-earlier" type="button">Move measure earlier</button>
        <button id="move-measure-later" type="button">Move measure later</button>
        <button id="remove-measure" type="button" class="danger-button">Remove measure</button>
      </div>
      <section class="subsection" aria-labelledby="duplicate-bars-heading">
        <h3 id="duplicate-bars-heading">Duplicate a section</h3>
        <div class="field-grid two-fields">
          <label class="field" for="duplicate-from-measure">From bar<select id="duplicate-from-measure" name="duplicate-from-measure" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Selected bar</option>
            </select>
          </label>
          <label class="field" for="duplicate-through-measure">Through bar<select id="duplicate-through-measure" name="duplicate-through-measure" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Selected bar</option>
            </select>
          </label>
        </div>
        <p class="field-help">Copies the aligned bars across the score, including hidden staves.</p>
        <button id="duplicate-measures" type="button">Duplicate selected measures</button>
      </section>
      <section class="subsection" aria-labelledby="measure-rests-heading">
        <h3 id="measure-rests-heading">Complete this voice</h3>
        <p class="field-help">Add explicit rests only after reviewing the current voice’s remaining time.</p>
        <button id="fill-rests" type="button">Fill remainder with rests</button>
      </section>
    </section>
  `;
}
