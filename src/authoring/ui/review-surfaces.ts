import { html } from 'lit';
import type { TemplateResult } from 'lit';

/** Native modal confirmation for reviewed changes. */
export function actionConfirmation(): TemplateResult {
  return html`
    <dialog id="author-confirmation" class="author-confirmation nonprinting" aria-labelledby="author-confirmation-title" aria-describedby="author-confirmation-message">
      <div class="confirmation-heading">
        <h2 id="author-confirmation-title">Review this change</h2>
      </div>
      <div class="confirmation-body">
        <p id="author-confirmation-message"></p>
        <p id="author-confirmation-status" role="alert" hidden></p>
      </div>
      <div class="confirmation-actions">
        <button id="author-confirmation-cancel" type="button" class="quiet-button">Cancel</button>
        <button id="author-confirmation-confirm" type="button" class="primary-button">Confirm</button>
      </div>
    </dialog>
  `;
}

/** Workspace notices and recoverable editing errors. */
export function workspaceReview(): TemplateResult {
  return html`
    <section id="workspace-review" class="surface-popover workspace-review nonprinting" popover="auto" aria-labelledby="workspace-review-heading">
      <div class="popover-heading">
        <h2 id="workspace-review-heading">Workspace review</h2>
        <button id="close-workspace-review" type="button" class="quiet-button" popovertarget="workspace-review" popovertargetaction="hide">Close</button>
      </div>
      <div class="popover-body">
        <div id="workspace-notices" class="workspace-notices nonprinting">
          <div class="workspace-notice-summary">
            <div id="source-draft-notice" class="source-draft-notice" hidden>Source unapplied · editing and printing paused.</div>
            <div id="inspector-draft-status" class="inspector-draft-status"></div>
            <div id="workspace-review-summary" class="workspace-review-summary" hidden></div>
          </div>
        </div>
        <div id="author-status" class="author-status nonprinting"></div>
        <p id="workspace-recovery-detail" class="workspace-recovery-detail" hidden></p>
        <button id="review-download-project" type="button" class="primary-button" hidden>Download project</button>
        <section id="notation-review" aria-labelledby="notation-review-heading" hidden>
          <h3 id="notation-review-heading">Notation notices</h3>
          <ul id="notation-review-list"></ul>
        </section>
        <p id="pointer-status" class="pointer-status selection-feedback"></p>
        <p id="selection-controls-feedback" class="visually-hidden"></p>
        <p id="selection-controls-error" class="selection-feedback selection-error" hidden></p>
        <div id="author-errors" class="author-errors" tabindex="0" aria-label="Editing problem" hidden></div>
        <div class="button-row review-actions">
          <button id="review-source" type="button" popovertarget="source-panel" hidden>Review Source</button>
          <button id="review-drafts" type="button" hidden>Review unsaved forms</button>
          <button id="review-incompatible-mark" type="button" hidden>Edit attached mark…</button>
        </div>
      </div>
    </section>
  `;
}

/** Explicit review before continuing a completed score. */
export function continuationReview(): TemplateResult {
  return html`
    <section id="continuation-review" class="surface-popover confirmation-popover nonprinting" popover="auto" aria-labelledby="continuation-review-heading">
      <div class="popover-heading">
        <h2 id="continuation-review-heading">Continue this piece</h2>
        <button id="close-continuation-review" type="button" class="quiet-button" popovertarget="continuation-review" popovertargetaction="hide">Close</button>
      </div>
      <div class="popover-body">
        <p id="continuation-review-context" class="target-context"></p>
        <p class="field-help">Review the named staves and ending before changing it. The whole action has one Undo.</p>
        <button id="confirm-continue-piece" type="button" class="primary-button">Change final barlines and insert</button>
      </div>
    </section>
  `;
}

/** Explicit destination confirmation following an unsuccessful gesture. */
export function pointerRecovery(): TemplateResult {
  return html`
    <section id="pointer-recovery" class="surface-popover confirmation-popover nonprinting" popover="auto" aria-labelledby="pointer-recovery-heading">
      <div class="popover-heading">
        <h2 id="pointer-recovery-heading">Place in a new measure</h2>
        <button id="close-pointer-recovery" type="button" class="quiet-button" popovertarget="pointer-recovery" popovertargetaction="hide">Close</button>
      </div>
      <div class="popover-body">
        <p id="pointer-recovery-context" class="target-context"></p>
        <p class="field-help">The earlier gesture changed nothing. This confirms a new destination.</p>
        <button id="confirm-pointer-recovery" type="button" class="primary-button">Add measure and place note</button>
      </div>
    </section>
  `;
}
