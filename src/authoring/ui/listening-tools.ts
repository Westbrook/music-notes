import { html } from 'lit';
import type { TemplateResult } from 'lit';

export function listeningTools(): TemplateResult {
  return html`
    <section slot="listen" id="listen-tools" class="listen-tools nonprinting" aria-label="Listening controls" hidden>
      <div class="listen-transport">
        <button id="listen-play" type="button" disabled>Play</button>
        <button id="listen-stop" type="button" disabled>Stop</button>
        <output id="listen-time" aria-label="Playback position" aria-live="off">0:00 / 0:00</output>
        <label class="field" for="listen-tempo"><span>Starting tempo<br>♩ / min</span>
          <input id="listen-tempo" type="number" min="20" max="300" step="1" value="80" inputmode="numeric" aria-describedby="listen-tempo-help">
        </label>
        <button id="listen-score-tempo" type="button" class="quiet-button">Use score tempo</button>
        <button id="listen-download" type="button" disabled>Download WAV</button>
      </div>
      <div class="listen-feedback">
        <p id="listen-status" class="field-help" role="status">Preparing Listen…</p>
        <p id="listen-notices" class="field-help"></p>
        <details class="listen-details"><summary>Playback details</summary>
          <p id="listen-tempo-help">Tempo changes keep their proportions. Without a written tempo, playback starts at 80 BPM. Tempo controls affect playback only.</p>
          <p>Plays the current score or selected part using a synthesized brass-like sound. WAV downloads contain the same audio. Sound stays in this browser.</p>
        </details>
      </div>
    </section>
  `;
}
