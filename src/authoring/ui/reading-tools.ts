import { phArrowLeft, phArrowRight, phArrowsOut } from '../../ui/icons/phosphor.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';

/** Native navigation controls for the reading view. */
export function readingTools(): TemplateResult {
  return html`
    <section slot="read" id="read-tools" class="read-tools nonprinting" aria-label="Reading controls" hidden="">
      <div>
        <p class="panel-kicker">Stay with the music</p>
        <p id="read-location" class="field-help" role="status">Reading at authored pitch.</p>
      </div>
      <div class="read-navigation">
        <button id="read-previous" type="button">${buttonContent(phArrowLeft, 'Previous')}</button>
        <label class="field" for="read-measure">Go to measure<select id="read-measure" name="read-measure" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Choose a measure</option>
          </select>
        </label>
        <button id="read-go" type="button">${buttonContent(phArrowRight, 'Go')}</button>
        <button id="read-next" type="button">${buttonContent(phArrowRight, 'Next')}</button>
        <button id="read-refit" type="button" class="quiet-button">${buttonContent(phArrowsOut, 'Refit this window')}</button>
      </div>
    </section>
  `;
}
