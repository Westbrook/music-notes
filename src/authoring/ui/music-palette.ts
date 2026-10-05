import { phArrowDown, phArrowRight, phArrowUp, phArrowsVertical, phCheck, phCursor, phDotsThree, phHand, phLink, phMapPin, phMusicNotesPlus, phPencilSimple, phPlus, phSelection, phSlidersHorizontal, phTrash } from '../../ui/icons/phosphor.js';
import { bravuraArticAccentAbove, bravuraGClef, bravuraNoteQuarterUp, bravuraRestQuarter } from '../../ui/icons/bravura.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import '../../ui/toggle-button-group.js';
import { ENTRY_ACCIDENTAL_OPTIONS, ENTRY_ATTACK_OPTIONS, ENTRY_DOTS_OPTIONS, ENTRY_DURATION_OPTIONS } from '../entry-palette.js';

/** Persistent palette for entry recipes and accepted selection actions. */
export function musicPalette(): TemplateResult {
  return html`
    <section slot="palette" id="workspace-dock" class="workspace-dock nonprinting" aria-label="Music palette">
      <div id="palette-musical-slots" class="palette-musical-slots">
        <div id="entry-toolbar" class="entry-toolbar" aria-label="New notes">
          <section id="write-tools" class="entry-tools" aria-label="New-note recipe">
            <div class="entry-quick-tools" data-toggle-group-row aria-label="Quick choices for new notes">
              <music-toggle-button-group id="entry-kind" label="Note or rest" .options=${[{ value: 'note', label: 'Note', icon: bravuraNoteQuarterUp }, { value: 'rest', label: 'Rest', icon: bravuraRestQuarter }]} .buttonIds=${{ note: 'entry-choose-note', rest: 'entry-choose-rest' }} value="note" overflow-at="2"></music-toggle-button-group>
              <music-toggle-button-group id="entry-accidentals" label="Accidentals" .options=${ENTRY_ACCIDENTAL_OPTIONS} value="0" overflow-at="3" aria-describedby="event-alteration-status"></music-toggle-button-group>
              <music-toggle-button-group id="entry-duration" label="Duration" .options=${ENTRY_DURATION_OPTIONS} value="quarter" overflow-at="4"></music-toggle-button-group>
              <music-toggle-button-group id="entry-dots" label="Dots" .options=${ENTRY_DOTS_OPTIONS} value="0" overflow-at="1" toggle-off-value="0"></music-toggle-button-group>
              <music-toggle-button-group id="entry-attack" label="Attack" .options=${ENTRY_ATTACK_OPTIONS} value="none" overflow-at="2" toggle-off-value="none" aria-describedby="entry-attack-status"></music-toggle-button-group>
            </div>
            <p id="entry-attack-status" class="visually-hidden" role="status" aria-live="polite"></p>
            <div id="entry-slot-options" class="palette-slot">
              <button id="entry-settings-trigger" type="button" class="entry-settings-trigger palette-action" popovertarget="entry-settings" aria-label="New note options" aria-describedby="entry-options-help entry-destination">${buttonContent(bravuraNoteQuarterUp, html`<span id="entry-settings-label" class="control-caption">Note</span><span id="entry-recipe">C4</span>`, { layout: "inline" })}</button>
              <button id="entry-direction-trigger" type="button" class="palette-action" popovertarget="entry-direction-chooser" aria-label="Direction for the next 3 roads note" aria-describedby="direction-help" hidden>${buttonContent(phArrowRight, html`<span data-control-label>Same (middle)</span>`)}</button>
            </div>
            <div id="entry-slot-value" class="palette-slot">
              <button id="entry-value-trigger" type="button" class="palette-action entry-value-trigger" popovertarget="entry-value-chooser" aria-label="Written value for new notes">${buttonContent(bravuraNoteQuarterUp, html`<span id="entry-value-label">Quarter</span><span id="entry-value-dots" class="control-caption">No dots</span>`, { layout: "inline" })}</button>
              <button id="cancel-entry-drag" type="button" class="quiet-button palette-action" aria-label="Cancel prepared note drag" hidden>${buttonContent(phCheck, "Done")}</button>
            </div>
            <div id="entry-slot-action" class="palette-slot">
              <button id="insert-event" type="button" class="quiet-button palette-action" aria-describedby="entry-destination">${buttonContent(phPlus, html`<span id="insert-event-label">Insert here</span><span id="insert-event-destination" class="control-caption" hidden></span>`, { layout: "inline" })}</button>
              <button id="drag-entry" type="button" hidden class="gesture-handle entry-drag-handle palette-action" aria-label="Drag the configured note to the staff" aria-describedby="pointer-help pitch-help position-help" title="Drag the next note to the staff">${buttonContent(phHand, html`<span data-control-label>Drag note</span><span id="drag-entry-value" class="visually-hidden">C4 quarter note</span>`)}</button>
            </div>
          </section>
        </div>
        <div id="pointer-tools" class="pointer-tools" data-selection-state="none" aria-label="Selected music">
          <div id="selection-controls-dock" class="selection-controls-dock">
            <div id="selection-controls" class="selection-controls" role="toolbar" aria-label="Selected music" aria-describedby="selection-controls-context" data-selection-placement="dock" data-selection-state="none" data-has-error="false">
              <div id="selection-quick-tools" class="selection-quick-tools" data-toggle-group-row aria-label="Quick choices for selected notes">
                <music-toggle-button-group id="selection-kind" label="Note or rest" overflow-at="2"></music-toggle-button-group>
                <music-toggle-button-group id="selection-accidentals" label="Accidentals" .buttonIds=${{ '-1': 'selection-flat', '0': 'selection-natural', '1': 'selection-sharp' }} overflow-at="3"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-duration" label="Duration" overflow-at="4"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-dots" label="Dots" overflow-at="1" toggle-off-value="0"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-attack" label="Attack" overflow-at="2" aria-describedby="selection-attack-help"></music-toggle-button-group>
              </div>
              <p id="selection-attack-help" class="visually-hidden">Toggle each articulation or ornament independently. A mixed choice applies it to all selected events; None clears attacks and ornaments.</p>
              <div id="selection-actions" class="selection-actions">
                <div id="selection-slot-1" class="palette-slot selection-pitch-slot">
                  <button id="selection-pitch" type="button" class="selection-action selection-pitch-action" popovertarget="selection-pitch-chooser" hidden>${buttonContent(bravuraGClef, html`<span data-control-label>Pitch</span>`)}</button>
                  <button id="selection-shared" type="button" class="selection-action" popovertarget="selection-shared-chooser" hidden>${buttonContent(phSlidersHorizontal, html`<span data-control-label>Shared properties</span>`)}</button>
                  <button id="selection-mark-edit" type="button" class="selection-action" hidden>${buttonContent(phPencilSimple, html`<span data-control-label>Edit mark</span>`)}</button>
                  <div class="selection-direct-choices">
                    <div id="selection-road-directions" class="selection-shortcuts" role="radiogroup" aria-label="Relative pitch direction" hidden>
                      <button id="selection-higher" type="button" role="radio" aria-checked="false" tabindex="-1">${buttonContent(phArrowUp, "Higher")}</button>
                      <button id="selection-same" type="button" role="radio" aria-checked="false" tabindex="-1">${buttonContent(phArrowRight, "Same")}</button>
                      <button id="selection-lower" type="button" role="radio" aria-checked="false" tabindex="-1">${buttonContent(phArrowDown, "Lower")}</button>
                    </div>
                  </div>
                </div>
                <div id="selection-slot-2" class="palette-slot">
                  <button id="selection-value" type="button" class="selection-action" popovertarget="selection-value-chooser" disabled>${buttonContent(bravuraNoteQuarterUp, html`<span data-control-label>Value</span>`)}</button>
                </div>
                <div id="selection-slot-3" class="palette-slot">
                  <button id="selection-attached-marks" type="button" class="selection-action" aria-label="Attached marks for selected event" disabled>${buttonContent(bravuraArticAccentAbove, "Marks")}</button>
                  <button id="selection-relationships" type="button" class="selection-action" aria-label="Relationships for the selected events" hidden>${buttonContent(phLink, html`<span data-control-label>Relate</span>`)}</button>
                  <button id="selection-mark-remove" type="button" class="selection-action danger-button" hidden>${buttonContent(phTrash, "Remove mark")}</button>
                  <button id="drag-pitch" type="button" class="gesture-handle footer-drag-handle" aria-label="Drag selected pitch" aria-describedby="drag-pitch-help pointer-help" title="Drag vertically to change the selected pitch" disabled hidden>${buttonContent(phArrowsVertical, "Drag pitch")}</button>
                </div>
                <div id="selection-collection" class="palette-slot selection-collection" role="group" aria-label="Build a selection">
                  <button id="selection-select-more" type="button" aria-describedby="selection-context">${buttonContent(phSelection, 'Select more')}</button>
                  <button id="selection-done" type="button" class="selection-done" hidden>${buttonContent(phCheck, "Done")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="workspace-mode-slot" class="workspace-mode-slot" role="group" aria-label="Editing mode">
        <button id="toggle-entry" type="button" aria-pressed="false" aria-describedby="entry-destination">${buttonContent(phMusicNotesPlus, html`<span id="entry-mode-label">Write notes</span>`)}</button>
        <button id="select-mode" type="button" aria-pressed="true">${buttonContent(phCursor, "Select")}</button>
      </div>
      <div id="palette-more-slot" class="palette-more-slot">
        <button id="edit-selected-event" class="selection-action selection-more" type="button" aria-controls="workspace-tools" aria-expanded="false" aria-describedby="edit-selected-help">${buttonContent(phDotsThree, html`<span id="edit-selected-label">More</span><span id="edit-selected-value" hidden></span>`)}</button>
        <button id="tools-toggle" type="button" class="tools-toggle" aria-controls="workspace-tools" aria-expanded="false">${buttonContent(phDotsThree, html`<span data-tools-toggle-label>More</span>`)}</button>
      </div>
      <button id="location-trigger" type="button" class="location-trigger" popovertarget="location-panel" aria-label="Location and musical actions" aria-describedby="selection-controls-context entry-destination">${buttonContent(phMapPin, html`<span id="palette-owner-label" class="control-caption">Selected</span><span id="selection-context" class="visually-hidden">Choose a musical location</span><span id="selection-controls-context" class="visually-hidden">Choose music on the staff.</span><span class="location-compact" aria-hidden="true"><span id="selection-compact-staff" class="visually-hidden">Staff</span><span id="selection-compact-context">Bar 1 · V1</span></span>`, { layout: "inline" })}</button>
      <span id="drag-pitch-help" class="visually-hidden">Prepare an untied single note for dragging in Properties.</span>
      <p id="pointer-help" class="visually-hidden">In Write notes, click to place a single pitched note or an ordinary rest. Rest placement works on pitched, rhythm, and 3 roads staves; height never gives a rest a pitch. Full-measure rests use Insert here or Enter. Prepare a note or rest drag in the options before using its handle. Selection controls change existing music; pitch drags keep the rhythm. Escape cancels an active gesture.</p>
      <p id="edit-selected-help" class="visually-hidden">Show or hide Properties for the selected music. With the score focused in Select, Enter opens Properties.</p>
    </section>
  `;
}
