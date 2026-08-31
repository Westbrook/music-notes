import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { eventProperties } from './event-properties.js';
import { passageTools } from './passage-tools.js';
import { annotationTools } from './annotation-tools.js';
import { measureTools } from './measure-tools.js';

/** Composes the independent native tool panes without extra layout wrappers. */
export function writingTools(): TemplateResult {
  return html`
    <aside slot="tools" id="workspace-tools" class="workspace-tools nonprinting" data-tools-view="properties" data-tools-presentation="closed" aria-labelledby="workspace-tools-heading" hidden>
      <div class="tools-header">
        <h2 id="workspace-tools-heading" class="visually-hidden">Writing tools</h2>
        <h2 id="properties-heading">Properties</h2>
        <button id="other-tools" type="button" class="quiet-button">Other tools</button>
        <button id="back-to-properties" type="button" class="quiet-button" hidden>Back to properties</button>
        <button id="tools-hide" type="button" class="quiet-button" aria-label="Hide writing tools">Hide</button>
      </div>
      <div id="tools-tablist" class="tools-tablist" role="tablist" aria-label="Other writing tools" hidden>
        <button id="tool-tab-rhythm" type="button" role="tab" aria-controls="passage-inspector" aria-selected="true" tabindex="0">Relationships</button>
        <button id="tool-tab-markings" type="button" role="tab" aria-controls="annotation-inspector" aria-selected="false" tabindex="-1">Instructions</button>
        <button id="tool-tab-measure" type="button" role="tab" aria-controls="measure-inspector" aria-selected="false" tabindex="-1">Measure</button>
      </div>
      ${eventProperties()}
      ${passageTools()}
      ${annotationTools()}
      ${measureTools()}
      <div class="tools-footer">
        <button id="tools-expand" type="button" class="quiet-button" aria-pressed="false"><span data-tools-expand-label>Expand task</span></button>
      </div>
    </aside>
  `;
}
