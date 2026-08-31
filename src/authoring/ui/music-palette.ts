import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Persistent palette for entry recipes and accepted selection actions. */
export function musicPalette(): TemplateResult {
  return html`
    <section slot="palette" id="workspace-dock" class="workspace-dock nonprinting" aria-label="Music palette">
      <div id="workspace-mode-slot" class="workspace-mode-slot" role="group" aria-label="Editing mode">
        <button id="toggle-entry" type="button" aria-pressed="false" aria-describedby="entry-destination"><span id="entry-mode-label">Write notes</span></button>
        <button id="select-mode" type="button" aria-pressed="true">Select</button>
      </div>
      <div id="palette-musical-slots" class="palette-musical-slots">
        <div id="entry-toolbar" class="entry-toolbar" aria-label="New notes">
          <section id="write-tools" class="entry-tools" aria-label="New-note recipe">
            <div id="entry-slot-options" class="palette-slot">
              <button id="entry-settings-trigger" type="button" class="entry-settings-trigger palette-action" popovertarget="entry-settings" aria-label="New note options" aria-describedby="entry-options-help entry-destination"><span id="entry-settings-label" class="control-caption">Note</span><span id="entry-recipe">C4</span></button>
              <button id="entry-direction-trigger" type="button" class="palette-action" popovertarget="entry-direction-chooser" aria-label="Direction for the next 3 roads note" aria-describedby="direction-help" hidden>Same (middle)</button>
            </div>
            <div id="entry-slot-value" class="palette-slot">
              <button id="entry-value-trigger" type="button" class="palette-action entry-value-trigger" popovertarget="entry-value-chooser" aria-label="Written value for new notes"><span id="entry-value-label">Quarter</span><span id="entry-value-dots" class="control-caption">No dots</span></button>
              <button id="cancel-entry-drag" type="button" class="quiet-button palette-action" aria-label="Cancel prepared note drag" hidden>Done</button>
            </div>
            <div id="entry-slot-action" class="palette-slot">
              <button id="insert-event" type="button" class="quiet-button palette-action" aria-describedby="entry-destination"><span id="insert-event-label">Insert here</span><span id="insert-event-destination" class="control-caption" hidden></span></button>
              <button id="drag-entry" type="button" hidden class="gesture-handle entry-drag-handle palette-action" aria-label="Drag the configured note to the staff" aria-describedby="pointer-help pitch-help position-help" title="Drag the next note to the staff"><span>Drag note</span><span id="drag-entry-value" class="visually-hidden">C4 quarter note</span></button>
            </div>
          </section>
        </div>
        <div id="pointer-tools" class="pointer-tools" data-selection-state="none" aria-label="Selected music">
          <div id="selection-controls-dock" class="selection-controls-dock">
            <div id="selection-controls" class="selection-controls" role="toolbar" aria-label="Selected music" aria-describedby="selection-controls-context" data-selection-placement="dock" data-selection-state="none" data-has-error="false">
              <div id="selection-slot-1" class="palette-slot selection-pitch-slot">
                <button id="selection-pitch" type="button" class="selection-action selection-pitch-action" popovertarget="selection-pitch-chooser" hidden>Pitch</button>
                <button id="selection-shared" type="button" class="selection-action" popovertarget="selection-shared-chooser" hidden>Shared properties</button>
                <button id="selection-mark-edit" type="button" class="selection-action" hidden>Edit mark</button>
                <div class="selection-direct-choices">
                  <div id="selection-accidentals" class="selection-shortcuts" role="radiogroup" aria-label="Set absolute accidental" hidden>
                    <button id="selection-flat" type="button" role="radio" aria-checked="false" tabindex="-1">Flat</button>
                    <button id="selection-natural" type="button" role="radio" aria-checked="false" tabindex="-1">Natural</button>
                    <button id="selection-sharp" type="button" role="radio" aria-checked="false" tabindex="-1">Sharp</button>
                  </div>
                  <div id="selection-road-directions" class="selection-shortcuts" role="radiogroup" aria-label="Relative pitch direction" hidden>
                    <button id="selection-higher" type="button" role="radio" aria-checked="false" tabindex="-1">Higher</button>
                    <button id="selection-same" type="button" role="radio" aria-checked="false" tabindex="-1">Same</button>
                    <button id="selection-lower" type="button" role="radio" aria-checked="false" tabindex="-1">Lower</button>
                  </div>
                </div>
              </div>
              <div id="selection-slot-2" class="palette-slot">
                <button id="selection-value" type="button" class="selection-action" popovertarget="selection-value-chooser" disabled>Value</button>
                <button id="selection-done" type="button" class="selection-done" hidden>Done</button>
              </div>
              <div id="selection-slot-3" class="palette-slot">
                <button id="selection-attached-marks" type="button" class="selection-action" aria-label="Attached marks for selected event" disabled>Marks</button>
                <button id="selection-relationships" type="button" class="selection-action" aria-label="Relationships for the selected events" hidden>Relate</button>
                <button id="selection-mark-remove" type="button" class="selection-action danger-button" hidden>Remove mark</button>
                <button id="drag-pitch" type="button" class="gesture-handle footer-drag-handle" aria-label="Drag selected pitch" aria-describedby="drag-pitch-help pointer-help" title="Drag vertically to change the selected pitch" disabled hidden>Drag pitch</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="palette-more-slot" class="palette-more-slot">
        <button id="edit-selected-event" class="selection-action selection-more" type="button" aria-controls="workspace-tools" aria-expanded="false" aria-describedby="edit-selected-help"><span id="edit-selected-label">More</span><span id="edit-selected-value" hidden></span></button>
        <button id="tools-toggle" type="button" class="tools-toggle" aria-controls="workspace-tools" aria-expanded="false"><span data-tools-toggle-label>More</span></button>
      </div>
      <button id="location-trigger" type="button" class="location-trigger" popovertarget="location-panel" aria-label="Location and musical actions" aria-describedby="selection-controls-context entry-destination"><span id="palette-owner-label" class="control-caption">Selected</span><span id="selection-context" class="visually-hidden">Choose a musical location</span><span id="selection-controls-context" class="visually-hidden">Choose music on the staff.</span><span class="location-compact" aria-hidden="true"><span id="selection-compact-staff" class="visually-hidden">Staff</span><span id="selection-compact-context">Bar 1 · V1</span></span></button>
      <span id="drag-pitch-help" class="visually-hidden">Prepare an untied single note for dragging in Properties.</span>
      <p id="pointer-help" class="visually-hidden">In Write notes, click to place a single pitched note or an ordinary rest. Rest placement works on pitched, rhythm, and 3 roads staves; height never gives a rest a pitch. Full-measure rests use Insert here or Enter. Prepare a note or rest drag in the options before using its handle. Selection controls change existing music; pitch drags keep the rhythm. Escape cancels an active gesture.</p>
      <p id="edit-selected-help" class="visually-hidden">Show or hide Properties for the selected music. With the score focused in Select, Enter opens Properties.</p>
    </section>
  `;
}
