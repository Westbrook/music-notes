import { phArrowCounterClockwise, phArrowUUpLeft, phCheck, phCheckCircle, phEraser, phMagnifyingGlass, phPrinter } from '../../ui/icons/phosphor.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Paper, page layout, and publication review controls. */
export function pageTools(): TemplateResult {
  return html`
    <section id="pages-tools" class="pages-tools nonprinting" aria-label="Paper and publishing" hidden="">
      <div class="page-controls">
        <button id="print-score" type="button" class="primary-button">${buttonContent(phPrinter, 'Print / Save as PDF')}</button>
      </div>
      <div class="tool-disclosures page-disclosures">
        <details id="paper-inspector" class="inspector"><summary>Paper &amp; spacing</summary>
          <div class="inspector-content">
            <div class="draft-notice">
              <p id="page-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-page-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-page-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-page-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-page-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-page-draft" type="button" class="quiet-button" hidden="">${buttonContent(phMagnifyingGlass, 'Review current changes')}</button>
              </div>
            </div>
            <div class="field-grid">
              <label class="field" for="page-paper">Paper<select id="page-paper" name="page-paper" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="letter">US Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label class="field" for="page-orientation">Orientation<select id="page-orientation" name="page-orientation" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label class="field" for="page-margin">Margins (mm)<input id="page-margin" name="page-margin" type="number" value="15" min="5" max="50" step="1">
              </label>
              <label class="field" for="page-scale">Staff scale<input id="page-scale" name="page-scale" type="number" value="1" min="0.5" max="2" step="0.05">
              </label>
              <label class="field" for="page-max-measures">Max. measures per line<input id="page-max-measures" name="page-max-measures" type="number" min="1" max="32" step="1" placeholder="Automatic">
              </label>
              <label class="field" for="page-measure-numbers">Measure numbers<select id="page-measure-numbers" name="page-measure-numbers" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="system">Start of system</option>
                  <option value="all">Every measure</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
            <label class="check-field" for="page-justify-last">
              <input id="page-justify-last" name="page-justify-last" type="checkbox"> Stretch the final system to the available width</label>
            <button id="apply-pages" type="button" class="primary-button">${buttonContent(phCheck, 'Apply page settings')}</button>
          </div>
        </details>
        <details id="break-inspector" class="inspector"><summary>Lines &amp; page boundaries</summary>
          <div class="inspector-content">
            <div class="draft-notice">
              <p id="boundary-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-boundary-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-boundary-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-boundary-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-boundary-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-boundary-draft" type="button" class="quiet-button" hidden="">${buttonContent(phMagnifyingGlass, 'Review current changes')}</button>
              </div>
            </div>
            <label class="field" for="page-measure-select">Measure boundary<select id="page-measure-select" name="page-measure-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a measure</option>
              </select>
            </label>
            <p id="page-selection-context" class="page-selection-context field-help" role="status">Choose the measure where this line or page should begin.</p>
            <div class="field-grid two-fields">
              <label class="field" for="layout-break">Start this measure<select id="layout-break" name="layout-break" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="auto">Automatically</option>
                  <option value="line">On a new line</option>
                  <option value="page">On a new page</option>
                </select>
              </label>
              <label class="check-field align-end" for="layout-keep">
                <input id="layout-keep" name="layout-keep" type="checkbox"> Prefer to keep with the next measure</label>
            </div>
            <p class="field-help">A keep preference can yield to fit or an explicit break. A page break does not certify a safe turn.</p>
            <button id="apply-break" type="button" class="primary-button">${buttonContent(phCheck, 'Apply boundary choices')}</button>
          </div>
        </details>
        <details id="turn-inspector" class="inspector"><summary>Review a page turn</summary>
          <div class="inspector-content">
            <label class="field" for="turn-boundary">Page boundary<select id="turn-boundary" name="turn-boundary" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a page boundary</option>
              </select>
            </label>
            <div id="turn-preview" class="turn-preview"></div>
            <p class="field-help">Check both sides of the turn for the whole part. Open improvisation and one resting voice do not establish time to turn.</p>
            <div class="button-row">
              <button id="mark-turn-reviewed" type="button">${buttonContent(phCheckCircle, 'Mark reviewed')}</button>
              <button id="clear-turn-review" type="button" class="quiet-button">${buttonContent(phEraser, 'Clear review')}</button>
            </div>
          </div>
        </details>
      </div>
      <section class="preflight-panel" aria-label="Publication checks">
        <div id="page-preflight" role="status"></div>
        <details class="print-options"><summary>Print options</summary>
          <label class="check-field" for="ack-layout-warnings">
            <input id="ack-layout-warnings" name="ack-layout-warnings" type="checkbox"> I have inspected the reported layout warnings on these pages.</label>
          <label class="check-field" for="print-draft">
            <input id="print-draft" name="print-draft" type="checkbox"> Print a clearly marked draft if musical work remains</label>
          <p class="field-help">A print request opens the browser dialog; it does not confirm that a PDF was saved. Match the preview’s paper settings and turn off browser headers and footers.</p>
        </details>
      </section>
    </section>
  `;
}
