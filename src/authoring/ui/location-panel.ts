import { phArrowRight, phArrowUUpLeft, phEye, phListChecks, phPencilSimple, phPlus, phSelection, phX } from '../../ui/icons/phosphor.js';
import { bravuraNoteheadBlack } from '../../ui/icons/bravura.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Native location selectors and actions at the current musical destination. */
export function locationPanel(): TemplateResult {
  return html`
    <section id="location-panel" class="surface-popover location-panel nonprinting" popover="auto" aria-labelledby="location-heading">
      <div class="popover-heading">
        <h2 id="location-heading">Location & actions</h2>
        <button id="close-location" type="button" class="quiet-button" popovertarget="location-panel" popovertargetaction="hide">${buttonContent(phX, 'Close', { layout: 'inline' })}</button>
      </div>
      <div class="popover-body">
        <p id="location-context" class="target-context">Actions use the selected staff, bar, and voice.</p>
        <p class="field-help" id="entry-mode-reason" hidden>Your previous writing location was removed or changed. Choose Start writing here to use the location shown, or choose another staff, measure, or voice below.</p>
        <span id="entry-destination" class="entry-destination target-context" hidden></span>
        <span id="remaining-time" class="remaining-time" role="status"></span>
        <div class="local-action-grid">
          <button id="next-measure" type="button" >${buttonContent(phArrowRight, 'Next measure')}</button>
          <button id="add-measure" type="button" class="quiet-button">${buttonContent(phPlus, html`<span id="add-measure-label" data-control-label>Add measure</span>`)}</button>
          <button id="add-chord-symbol" type="button" class="primary-button">${buttonContent(bravuraNoteheadBlack, 'Add chord symbol')}</button>
          <button id="start-entry-here" type="button" >${buttonContent(phPencilSimple, 'Start writing here')}</button>
          <button id="resume-entry" type="button" class="quiet-button" hidden>${buttonContent(phPencilSimple, html`<span id="resume-entry-label" data-control-label>Resume writing</span>`)}</button>
          <button id="selection-range" type="button" class="selection-action" hidden>${buttonContent(phSelection, 'Range…')}</button>
          <button id="selection-review" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${buttonContent(phEye, 'Review')}</button>
          <button id="continue-piece" type="button" hidden>${buttonContent(phArrowRight, 'Continue this piece…')}</button>
          <button id="selection-select-more" type="button" aria-describedby="selection-context">${buttonContent(phSelection, 'Select more')}</button>
          <button id="return-to-selection" type="button" class="quiet-button" aria-label="Return to selection" hidden>${buttonContent(phArrowUUpLeft, 'Return to selection')}</button>
          <button id="selection-review-history" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${buttonContent(phListChecks, 'Review last editing problem')}</button>
        </div>
        <label class="field part-picker" for="part-select">Viewing
          <select id="part-select" name="part-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="score">Full score</option>
          </select>
          <span class="field-help">Pitched parts keep their authored pitches; 3 roads parts keep their directions.</span>
        </label>
        <div id="selection-toolbar" class="selection-toolbar">
          <div class="cursor-controls">
            <label class="field" for="staff-select">Staff<select id="staff-select" name="staff-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a staff</option>
              </select>
            </label>
            <label class="field" for="measure-select">Measure<select id="measure-select" name="measure-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a measure</option>
              </select>
            </label>
            <label class="field" for="event-voice">Voice<select id="event-voice" name="event-voice" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="0">Voice 1</option>
              </select>
            </label>
          </div>
        </div>
        <p class="field-help">Add measure inserts an aligned bar across all staves, including hidden parts.</p>
      </div>
    </section>
  `;
}
