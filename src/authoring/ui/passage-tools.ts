import { phArrowCounterClockwise, phArrowUUpLeft, phCheck, phLink, phLinkBreak, phMagnifyingGlass, phSwap, phTrash } from '../../ui/icons/phosphor.js';
import { bravuraTuplet3 } from '../../ui/icons/bravura.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Ties, conversions, tuplets, and per-event beam policy. */
export function passageTools(): TemplateResult {
  return html`
    <section id="passage-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-rhythm" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Relationships &amp; passages</h2>
        <p>Choose events in one voice. Each operation stays together in one undo step.</p>
      </div>
      <div class="field-grid two-fields">
        <label class="field" for="range-start">From event<select id="range-start" name="range-start" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Current selection</option>
          </select>
        </label>
        <label class="field" for="range-end">Through event<select id="range-end" name="range-end" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Current selection</option>
          </select>
        </label>
      </div>
      <p id="range-status" class="field-help" role="status" tabindex="-1">Select events from one voice for ties, tuplets, or conversion.</p>
      <div class="button-row">
        <button id="tie-events" type="button">${buttonContent(phLink, 'Tie selected notes')}</button>
        <button id="clear-ties" type="button">${buttonContent(phLinkBreak, html`<span id="clear-ties-label" data-control-label>Clear connected ties</span>`)}</button>
      </div>
      <div class="subsection">
        <div class="field-grid">
          <label class="field" for="convert-kind">Convert passage to<select id="convert-kind" name="convert-kind" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="slash">Improvisation slashes</option>
              <option value="rest">Rests</option>
              <option value="note">Written notes</option>
              <option value="rhythm">Rhythm notes (rhythm staff)</option>
              <option value="road">3 roads notes (3 roads staff)</option>
            </select>
          </label>
          <label class="field" for="convert-pitch">Pitch for written notes<input id="convert-pitch" name="convert-pitch" type="text" value="C4" spellcheck="false">
          </label>
          <label class="field" for="convert-direction" hidden>Pitch direction<select id="convert-direction" name="convert-direction" class="author-select" .value=${'same'}>
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="higher">Higher (top)</option>
              <option value="same" selected="">Same (middle)</option>
              <option value="lower">Lower (bottom)</option>
            </select>
          </label>
          <label class="check-field align-end" for="convert-rhythmic">
            <input id="convert-rhythmic" name="convert-rhythmic" type="checkbox"> Specify slash rhythm</label>
        </div>
        <p id="conversion-help" class="field-help">Rhythm notes prescribe durations without pitches; 3 roads notes prescribe relative pitch direction and duration. To switch between pitched and rhythm staves, use rhythmic slashes to preserve the written attacks, change the staff notation, then convert to the intended events. Open slashes leave attacks improvised. Remove incompatible attached marks deliberately; a failed conversion changes nothing.</p>
        <button id="convert-events" type="button">${buttonContent(phSwap, 'Review conversion…')}</button>
      </div>
      <section id="tuplet-inspector" class="subsection tuplet-section" aria-label="Tuplets">
        <div class="panel-heading">
          <h2>Tuplets</h2>
          <p>Written values retain their exact ratio, including nested groups.</p>
        </div>
        <div class="draft-notice">
          <p id="tuplet-draft-status" class="draft-status" role="status" aria-live="polite"></p>
          <div class="draft-actions">
            <button id="discard-tuplet-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-tuplet-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
            <button id="return-tuplet-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-tuplet-draft-label" data-control-label>Return to target</span>`)}</button>
            <button id="review-tuplet-draft" type="button" class="quiet-button" hidden="">${buttonContent(phMagnifyingGlass, 'Review current changes')}</button>
          </div>
        </div>
        <label class="field" for="tuplet-select">Existing group<select id="tuplet-select" name="tuplet-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">New tuplet around selection</option>
          </select>
        </label>
        <div class="field-grid">
          <label class="field" for="tuplet-actual">Written units<input id="tuplet-actual" name="tuplet-actual" type="number" value="3" min="2" max="64" step="1">
          </label>
          <label class="field" for="tuplet-normal">In the time of<input id="tuplet-normal" name="tuplet-normal" type="number" value="2" min="1" max="64" step="1">
          </label>
          <label class="field" for="tuplet-bracket">Bracket<select id="tuplet-bracket" name="tuplet-bracket" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="auto">Automatic</option>
              <option value="yes">Show</option>
              <option value="no">Hide</option>
            </select>
          </label>
        </div>
        <label class="check-field" for="tuplet-ratio">
          <input id="tuplet-ratio" name="tuplet-ratio" type="checkbox"> Print the full ratio</label>
        <div class="button-row">
          <button id="wrap-tuplet" type="button" class="primary-button">${buttonContent(bravuraTuplet3, 'Make tuplet')}</button>
          <button id="update-tuplet" type="button">${buttonContent(phCheck, 'Apply group settings')}</button>
          <button id="unwrap-tuplet" type="button" class="danger-button">${buttonContent(phTrash, 'Remove tuplet grouping')}</button>
        </div>
      </section>
      <details id="beam-membership" class="sub-disclosure"><summary>Per-event beam membership</summary>
        <div class="sub-disclosure-content">
          <p id="beam-target-context" class="target-context">Uses the event held in Properties.</p>
          <label class="field" for="selected-beam">Per-event beam marker<select id="selected-beam" name="selected-beam" class="author-select" aria-describedby="beam-target-context beam-membership-help" >
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="auto">Follow beat groups</option>
              <option value="start">Start beam</option>
              <option value="continue">Continue beam</option>
              <option value="end">End beam</option>
              <option value="none">No beam</option>
            </select>
          </label>
          <p id="beam-membership-help" class="field-help">This marker applies immediately to the named event. It is not a whole-group beaming command. Return to Properties to change or review the held target.</p>
        </div>
      </details>
    </section>
  `;
}
