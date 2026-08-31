import { phArrowCounterClockwise, phArrowUUpLeft, phCheck, phCode, phDownloadSimple, phEye, phFilePlus, phFolderOpen, phPlus, phSlidersHorizontal, phTrash, phX } from '../../ui/icons/phosphor.js';
import { bravuraCClef, bravuraFClef, bravuraGClef } from '../../ui/icons/bravura.js';
import { nativeOptionTemplate } from '../../ui/option-content.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import './source-editor.js';

/** Composition metadata and portable project file actions. */
export function documentMenu(): TemplateResult {
  return html`
    <section id="document-menu" class="document-menu surface-popover nonprinting" popover="auto" aria-labelledby="document-menu-heading">
      <div class="document-menu-heading">
        <h2 id="document-menu-heading">Document</h2>
        <button id="close-document-menu" class="document-menu-close quiet-button" type="button" popovertarget="document-menu" popovertargetaction="hide">${buttonContent(phX, 'Close', { layout: 'inline' })}</button>
      </div>
      <div class="document-menu-content popover-body">
        <label class="field" for="project-title">Composition title<input id="project-title" name="project-title" type="text" value="" maxlength="240" placeholder="Untitled composition" autocomplete="off" />
        </label>
        <label class="field" for="project-composer">Composer<input id="project-composer" name="project-composer" type="text" value="" maxlength="160" placeholder="Composer" autocomplete="off" />
        </label>
        <label class="field" for="project-subtitle">Subtitle<input id="project-subtitle" name="project-subtitle" type="text" maxlength="240" placeholder="Optional performance note">
        </label>
        <button id="score-setup-trigger" type="button" popovertarget="score-setup">${buttonContent(phSlidersHorizontal, 'Score setup…', { layout: 'inline' })}</button>
        <div class="menu-divider"></div>
        <label class="field" for="new-template">Start with
          <select id="new-template" name="new-template" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="blank">Single staff</option>
            <option value="rhythm">Single-line rhythm staff</option>
            <option value="three-roads">3 roads music</option>
            <option value="lead">Lead sheet study</option>
            <option value="piano">Piano</option>
            <option value="ensemble">Ensemble</option>
          </select>
        </label>
        <button id="new-project" type="button">${buttonContent(phFilePlus, 'New composition', { layout: 'inline' })}</button>
        <button id="open-project" type="button">${buttonContent(phFolderOpen, 'Open project or musical HTML…', { layout: 'inline' })}</button>
        <input id="project-file" type="file" accept=".json,.html,.htm,application/json,text/html" hidden="">
        <button id="download-project" type="button">${buttonContent(phDownloadSimple, 'Download project', { layout: 'inline' })}</button>
        <button id="export-html" type="button">${buttonContent(phCode, 'Export musical HTML', { layout: 'inline' })}</button>
        <p class="field-help">Local recovery stays on this device. Download a project for a portable copy.</p>
      </div>
    </section>
  `;
}

/** Staff and part forms with separate recoverable drafts. */
export function scoreSetup(): TemplateResult {
  return html`
    <section id="score-setup" class="surface-popover score-setup nonprinting" popover="auto" aria-labelledby="score-setup-heading">
      <div class="popover-heading">
        <h2 id="score-setup-heading">Score setup</h2>
        <button id="close-score-setup" type="button" class="quiet-button" popovertarget="score-setup" popovertargetaction="hide">${buttonContent(phX, 'Close', { layout: 'inline' })}</button>
      </div>
      <div class="popover-body">
        <section id="staff-inspector" class="setup-section" aria-label="Staves and parts">
          <div class="panel-heading">
            <h2>Staves</h2>
            <p>Keep players together. Parts may include several staves; pitches stay as authored.</p>
          </div>
          <div class="draft-notice">
            <p id="staff-draft-status" class="draft-status" role="status" aria-live="polite"></p>
            <div class="draft-actions">
              <button id="discard-staff-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-staff-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
              <button id="return-staff-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-staff-draft-label" data-control-label>Return to target</span>`)}</button>
              <button id="review-staff-draft" type="button" class="quiet-button" hidden="">${buttonContent(phEye, 'Review current changes')}</button>
            </div>
          </div>
          <div class="field-grid">
            <label class="field" for="staff-label">Staff label<input id="staff-label" name="staff-label" type="text" placeholder="Flute, piano upper…">
            </label>
            <label class="field" for="staff-notation">Notation<select id="staff-notation" name="staff-notation" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="pitched">Pitched · five lines</option>
                <option value="rhythm">Rhythm · one line</option>
                <option value="three-roads">3 roads music · three lines</option>
              </select>
            </label>
            <label class="field" for="staff-clef">Initial clef<select id="staff-clef" name="staff-clef" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                ${nativeOptionTemplate({ value: "treble", label: "Treble", icon: bravuraGClef })}
                ${nativeOptionTemplate({ value: "bass", label: "Bass", icon: bravuraFClef })}
                ${nativeOptionTemplate({ value: "alto", label: "Alto", icon: bravuraCClef })}
                ${nativeOptionTemplate({ value: "tenor", label: "Tenor", icon: bravuraCClef })}
              </select>
            </label>
            <label class="field" for="staff-key">Initial key<input id="staff-key" name="staff-key" type="text" value="C">
            </label>
          </div>
          <p id="staff-notation-help" class="field-help">Rhythm uses one line; 3 roads uses three lines for higher, same, or lower than the previous main pitch. Both omit clef and key. Changing notation does not convert existing events. For pitched ↔ rhythm, use rhythmic slashes to preserve prescribed attacks; remove incompatible attached marks deliberately. 3 roads needs authored directions, not inferred pitches.</p>
          <div class="button-row">
            <button id="apply-staff" type="button">${buttonContent(phCheck, 'Apply to current staff')}</button>
            <button id="add-staff" type="button">${buttonContent(phPlus, 'Add new staff')}</button>
          </div>
          <div class="subsection">
            <div class="draft-notice">
              <p id="part-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-part-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowCounterClockwise, html`<span id="discard-part-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-part-draft" type="button" class="quiet-button" hidden="">${buttonContent(phArrowUUpLeft, html`<span id="return-part-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-part-draft" type="button" class="quiet-button" hidden="">${buttonContent(phEye, 'Review current changes')}</button>
              </div>
            </div>
            <h3>Parts</h3>
            <label class="field" for="part-label">Part name<input id="part-label" name="part-label" type="text" placeholder="Piano, rhythm section…">
            </label>
            <fieldset class="plain-fieldset">
              <legend>Staves in this part</legend>
              <div id="part-staves" class="check-row"></div>
            </fieldset>
            <div class="button-row">
              <button id="add-part" type="button" class="primary-button">${buttonContent(phPlus, 'Create part')}</button>
              <button id="update-part" type="button">${buttonContent(phCheck, 'Update selected part')}</button>
              <button id="remove-part" type="button" class="danger-button">${buttonContent(phTrash, 'Remove part')}</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}

/** Unapplied musical HTML remains an explicit native text draft. */
export function sourcePanel(): TemplateResult {
  return html`
    <section id="source-panel" class="surface-popover source-panel nonprinting" popover="auto" aria-labelledby="source-heading">
      <music-panel-frame>
        <div slot="header" class="popover-heading">
          <h2 id="source-heading">Musical HTML</h2>
          <button id="close-source" type="button" class="quiet-button" popovertarget="source-panel" popovertargetaction="hide">${buttonContent(phX, 'Close', { layout: 'inline' })}</button>
        </div>
        <div slot="body" class="source-content popover-body">
          <music-source-editor id="source-editor"></music-source-editor>
        </div>
      </music-panel-frame>
    </section>
  `;
}
