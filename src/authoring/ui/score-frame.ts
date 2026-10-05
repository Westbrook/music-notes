import { phBookOpen, phKeyboard, phListBullets } from '../../ui/icons/phosphor.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import './event-navigator.js';
import './score-viewport.js';

/** Stable projection host and keyboard-accessible score navigation. */
export function scoreFrame(): TemplateResult {
  return html`
    <section slot="score" id="score-editor" class="score-editor" tabindex="0" aria-label="Music score editor" aria-describedby="keyboard-help">
      <div id="score-scroll" class="score-scroll" tabindex="0" aria-label="Notation viewport">
        <music-score-viewport id="score-host" class="score-host"></music-score-viewport>
        <details id="navigator-panel" class="navigator-panel nonprinting"><summary>${buttonContent(phListBullets, 'Navigate the score as a list', { layout: 'inline' })}</summary>
          <music-event-navigator id="event-navigator" class="event-navigator" aria-label="Staff, measure, voice, and event navigation"></music-event-navigator>
        </details>
        <details id="keyboard-shortcuts" class="keyboard-shortcuts nonprinting"><summary id="keyboard-shortcuts-summary">${buttonContent(phKeyboard, 'Keyboard shortcuts', { layout: 'inline' })}</summary>
          <p id="keyboard-help" class="keyboard-help">With the score focused: in Write notes, N/R chooses a note or rest without inserting, Left/Right moves the writing point through existing music and bars, and Enter inserts the current recipe. A–G writes natural pitches in the configured octave on pitched staves. In Select, Left/Right selects music, Shift extends a range, Enter opens Properties, and Delete or Backspace removes the selection. Tap Select more in the palette, then tap notes to add or remove them. Range… selects a passage by its endpoints; Done keeps the selection. Escape cancels an active gesture or collection; when idle, it keeps the current mode. Command or Control + C copies selected notes; switch to Write notes and use Command or Control + V to paste at the writing cursor. Insertions continue through later bars as needed. Command or Control + Z undoes. Native fields and readable text keep their usual keys.</p>
        </details>
        <footer class="workspace-footer nonprinting"><a href=${`${import.meta.env.BASE_URL}index.html`}>${buttonContent(phBookOpen, 'Notation workbook', { layout: 'inline' })}</a>
          <span>Written in musical HTML</span>
        </footer>
      </div>
    </section>
  `;
}
