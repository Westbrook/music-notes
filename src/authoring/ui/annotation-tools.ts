import { phArrowCounterClockwise, phArrowRight, phArrowUUpLeft, phCheck, phCursor, phMagnifyingGlass, phPlus, phSkipBack, phTrash } from '../../ui/icons/phosphor.js';
import { bravuraNote128thUp, bravuraNote16thUp, bravuraNote32ndUp, bravuraNote64thUp, bravuraNote8thUp, bravuraNoteDoubleWhole, bravuraNoteHalfUp, bravuraNoteQuarterUp, bravuraNoteWhole } from '../../ui/icons/bravura.js';
import { nativeOptionTemplate, nativeSelectDefault } from '../../ui/option-content.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Instructions retain exact musical position and publication scope. */
export function annotationTools(): TemplateResult {
  return html`
    <section id="annotation-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-markings" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Harmony &amp; instructions</h2>
        <p>Write a chord symbol or direction at an exact musical position.</p>
      </div>
      <div class="draft-notice">
        <p id="annotation-draft-status" class="draft-status" role="status" aria-live="polite"></p>
        <div class="draft-actions">
          <button id="discard-annotation-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-annotation-draft-label" data-control-label>Discard/start here</span>`)}</button>
          <button id="return-annotation-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-annotation-draft-label" data-control-label>Return to target</span>`)}</button>
          <button id="review-annotation-draft" type="button" class="quiet-button" hidden="">${buttonContent(phMagnifyingGlass, 'Review current changes')}</button>
        </div>
      </div>
      <p id="annotation-draft-target" class="target-context">Choose a musical location.</p>
      <div class="field-grid">
        <label class="field" for="annotation-select">Existing instruction<select id="annotation-select" name="annotation-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">New instruction</option>
          </select>
        </label>
        <label class="field" for="annotation-kind">Kind<select id="annotation-kind" name="annotation-kind" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="harmony">Chord symbol</option>
            <option value="direction">Performance direction</option>
            <option value="rehearsal">Rehearsal mark</option>
            <option value="dynamics">Dynamics</option>
            <option value="tempo">Tempo</option>
          </select>
        </label>
        <label class="field" for="annotation-placement">Placement<select id="annotation-placement" name="annotation-placement" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="above">Above staff</option>
            <option value="below">Below staff</option>
          </select>
        </label>
      </div>
      <label class="field" for="annotation-text">Printed text<textarea id="annotation-text" name="annotation-text" rows="2" placeholder="Dm9, softly, or Solo until cue…"></textarea>
      </label>
      <div class="field-grid annotation-position-fields">
        <div class="onset-actions">
          <button id="annotation-at-start" type="button" class="quiet-button">${buttonContent(phSkipBack, 'At bar start')}</button>
          <button id="annotation-at-selection" type="button" class="quiet-button">${buttonContent(phCursor, 'Use selected position')}</button>
        </div>
        <label class="field" for="annotation-at">Position in whole notes<input id="annotation-at" name="annotation-at" type="text" value="0" placeholder="0, 1/4, 1/2…" aria-describedby="annotation-position-help">
        </label>
      </div>
      <div id="annotation-tempo-fields" class="field-grid tempo-fields" hidden="">
        <label class="field" for="annotation-bpm">Tempo BPM<input id="annotation-bpm" name="annotation-bpm" type="number" min="1" max="1000" step="1" placeholder="Optional">
        </label>
        <label class="field" for="annotation-beat">Tempo beat<select id="annotation-beat" name="annotation-beat" class="author-select">
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
        <label class="field" for="annotation-dots">Tempo beat dots<select id="annotation-dots" name="annotation-dots" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="0">None</option>
            <option value="1">1 dot</option>
            <option value="2">2 dots</option>
            <option value="3">3 dots</option>
          </select>
        </label>
      </div>
      <p id="annotation-position-help" class="field-help">0 is the start of the bar; 1/2 is beat 3 in 4/4. Position is musical time, never a pixel offset.</p>
      <details class="sub-disclosure"><summary>Who sees this instruction?</summary>
        <div class="sub-disclosure-content">
          <label class="field" for="annotation-scope">Include in<select id="annotation-scope" name="annotation-scope" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="staff">This staff only</option>
              <option value="all">Score and all relevant parts</option>
              <option value="parts">Chosen parts</option>
            </select>
          </label>
          <div id="annotation-part-scopes" class="check-row"></div>
        </div>
      </details>
      <div class="button-row panel-actions annotation-actions">
        <button id="add-annotation" type="button" class="primary-button">${buttonContent(phPlus, 'Add instruction')}</button>
        <button id="add-annotation-next" type="button">${buttonContent(phArrowRight, 'Add & next bar')}</button>
        <button id="update-annotation" type="button" hidden="">${buttonContent(phCheck, 'Apply changes')}</button>
        <button id="update-annotation-next" type="button" hidden="">${buttonContent(phArrowRight, 'Apply & next bar')}</button>
        <button id="new-annotation" type="button" class="quiet-button" hidden="">${buttonContent(phPlus, html`<span id="new-annotation-label" data-control-label>New instruction</span>`)}</button>
        <button id="remove-annotation" type="button" class="danger-button" hidden="">${buttonContent(phTrash, 'Remove instruction')}</button>
      </div>
    </section>
  `;
}
