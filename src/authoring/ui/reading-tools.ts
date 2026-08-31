import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Native navigation controls for the reading view. */
export function readingTools(): TemplateResult {
  return html`
    <section id="read-tools" class="read-tools mode-panel nonprinting" aria-label="Reading controls" hidden="">
      <div>
        <p class="panel-kicker">Stay with the music</p>
        <p id="read-location" class="field-help" role="status">Reading at authored pitch.</p>
      </div>
      <div class="read-navigation">
        <button id="read-previous" type="button">Previous</button>
        <label class="field" for="read-measure">Go to measure<select id="read-measure" name="read-measure" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Choose a measure</option>
          </select>
        </label>
        <button id="read-go" type="button">Go</button>
        <button id="read-next" type="button">Next</button>
        <button id="read-refit" type="button" class="quiet-button">Refit this window</button>
      </div>
    </section>
  `;
}
