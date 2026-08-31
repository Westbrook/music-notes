import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Native location selectors and actions at the current musical destination. */
export function locationPanel(): TemplateResult {
  return html`
    <section id="location-panel" class="surface-popover location-panel nonprinting" popover="auto" aria-labelledby="location-heading">
      <div class="popover-heading">
        <h2 id="location-heading">Location & actions</h2>
        <button id="close-location" type="button" class="quiet-button" popovertarget="location-panel" popovertargetaction="hide">Close</button>
      </div>
      <div class="popover-body">
        <p id="location-context" class="target-context">Actions use the selected staff, bar, and voice.</p>
        <p class="field-help" id="entry-mode-reason" hidden>Can’t resume</p>
        <span id="entry-destination" class="entry-destination target-context" hidden></span>
        <span id="remaining-time" class="remaining-time" role="status"></span>
        <div class="local-action-grid">
          <button id="next-measure" type="button" >Next measure</button>
          <button id="add-measure" type="button" class="quiet-button">Add measure</button>
          <button id="add-chord-symbol" type="button" class="primary-button">Add chord symbol</button>
          <button id="start-entry-here" type="button" >Start writing here</button>
          <button id="resume-entry" type="button" class="quiet-button" hidden>Resume writing</button>
          <button id="selection-range" type="button" class="selection-action" hidden>Range…</button>
          <button id="selection-review" type="button" class="quiet-button" popovertarget="workspace-review" hidden>Review</button>
          <button id="continue-piece" type="button" hidden>Continue this piece…</button>
          <button id="selection-select-more" type="button" aria-describedby="selection-context">Select more</button>
          <button id="return-to-selection" type="button" class="quiet-button" aria-label="Return to selection" hidden>Return to selection</button>
          <button id="selection-review-history" type="button" class="quiet-button" popovertarget="workspace-review" hidden>Review last editing problem</button>
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
