import { AuthorWorkspace } from './main.js';

// Entry-point effects stay outside reusable controllers and state modules.
let workspace: AuthorWorkspace | undefined;
try { workspace = new AuthorWorkspace(); }
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.dataset.authorReady = 'true';
  document.body.dataset.renderState = 'error';
  const output = document.getElementById('author-errors');
  if (output) { output.hidden = false; output.textContent = message; }
  const summary = document.getElementById('workspace-review-summary');
  if (summary) { summary.hidden = false; summary.textContent = `The editor could not open: ${message}`; }
  const trigger = document.getElementById('workspace-review-trigger');
  if (trigger) { trigger.hidden = false; trigger.textContent = 'Review error'; }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    workspace?.dispose();
    document.querySelector('music-author-shell')?.remove();
    document.getElementById('print-guard')?.remove();
  });
}
