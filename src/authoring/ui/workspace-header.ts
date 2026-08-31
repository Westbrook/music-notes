import { phArrowUUpLeft, phArrowUUpRight, phCode, phFile, phStackSimple, phWarning } from '../../ui/icons/phosphor.js';
import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { buttonContent } from '../../ui/button-content.js';
import type { ViewMode } from '../types.js';

/** Document identity, workspace views, and persistent navigation controls. */
export function workspaceHeader(mode: ViewMode = 'write'): TemplateResult {
  return html`
    <a id="skip-to-score" class="skip-link nonprinting" href="#score-editor">Skip to the score</a>
    <header class="app-header nonprinting">
      <div class="header-document"><a class="brand" href="/index.html" aria-label="Music Notes notation workbook">Music Notes</a>
        <div class="document-identity">
          <span id="document-title" class="document-name">Untitled composition</span>
          <div class="document-subline">
            <span id="save-status" class="save-status">Opening…</span>
            <span id="workspace-feedback-label" class="workspace-feedback-label" role="status" aria-live="polite" aria-atomic="true"></span>
          </div>
        </div>
        <button id="active-part-label" class="part-navigation" type="button" popovertarget="location-panel" aria-describedby="part-navigation-help" title="Choose part and location">${buttonContent(phStackSimple, html`<span data-control-label>Full score</span>`, { layout: "inline" })}</button>
        <span id="part-navigation-help" class="visually-hidden">Choose the part or musical location to view.</span>
      </div>
      <music-view-switch id="view-switch" class="view-switch" .mode=${mode}></music-view-switch>
      <div class="header-actions">
        <div class="history-actions" aria-label="Edit history">
          <button id="undo" type="button" class="quiet-button" title="Undo (Command or Control + Z)" disabled="">${buttonContent(phArrowUUpLeft, "Undo")}</button>
          <button id="redo" type="button" class="quiet-button" title="Redo (Command or Control + Shift + Z)" disabled="">${buttonContent(phArrowUUpRight, "Redo")}</button>
          <div id="workspace-review-slot" class="workspace-review-slot">
            <button id="workspace-review-trigger" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${buttonContent(phWarning, html`<span data-control-label>Review</span>`)}</button>
          </div>
        </div>
        <div class="document-actions">
          <button id="source-trigger" type="button" class="quiet-button" popovertarget="source-panel">${buttonContent(phCode, "Source")}</button>
          <button id="document-menu-trigger" class="document-menu-trigger" type="button" popovertarget="document-menu">${buttonContent(phFile, "Document")}</button>
        </div>
      </div>
    </header>
  `;
}
