import type { Diagnostic } from '../model/types.js';

export interface WorkbookControlsOptions {
  readonly root: ParentNode;
  readonly preview: HTMLInputElement;
  readonly printButton: HTMLButtonElement;
  readonly status: HTMLElement;
  /** Requests the host's print dialog; returning does not establish that it opened. */
  readonly requestPrint: () => void;
}

interface WorkbookScore extends Element {
  readonly renderComplete?: Promise<void>;
  readonly diagnostics?: readonly Diagnostic[];
}

interface RenderSnapshot {
  readonly scores: readonly WorkbookScore[];
  readonly completions: readonly Promise<void>[];
}

/**
 * Bind workbook UI after registering the music components. Printing uses each
 * score's existing print projection, independently of the preview checkbox.
 * The disposer removes listeners and cancels any pending request, without
 * reverting the reader's chosen preview or changing authored musical data.
 */
export function initializeWorkbookControls({ root, preview, printButton, status, requestPrint }: WorkbookControlsOptions): () => void {
  let disposed = false;
  let preparing = false;
  let previousDisabled = printButton.disabled;
  let previousStatus = status.textContent;

  const currentScores = (): WorkbookScore[] => [...root.querySelectorAll<WorkbookScore>('[data-score]')]
    .filter(score => score.isConnected);

  const layoutStatus = (): string => preview.checked
    ? 'Previewing score layout at the configured print width. This does not show physical paper pages.'
    : 'Responsive score layout. Printing uses each score’s configured print width.';

  const changePreview = (): void => {
    if (disposed) return;
    for (const score of currentScores()) score.toggleAttribute('print-preview', preview.checked);
    if (!preparing) status.textContent = layoutStatus();
  };

  const snapshot = (): RenderSnapshot => {
    const scores = currentScores();
    if (!scores.length) throw new Error('No scores are available to print.');
    const completions = scores.map(score => {
      // An unregistered element must not count as a successfully rendered score.
      const completion = score.renderComplete;
      if (!completion || typeof completion.then !== 'function') {
        throw new Error('A score is not ready. Reload the workbook after its music components have loaded.');
      }
      return completion;
    });
    return { scores, completions };
  };

  const request = async (): Promise<void> => {
    if (disposed || preparing || printButton.disabled) return;
    preparing = true;
    previousDisabled = printButton.disabled;
    previousStatus = status.textContent;
    printButton.disabled = true;
    status.textContent = 'Preparing scores for the print dialog…';
    try {
      while (!disposed) {
        const pending = snapshot();
        await Promise.all(pending.completions);
        if (disposed) return;
        // renderComplete also drains pending source mutations. A score that
        // finished early may have changed while another score was still waiting.
        const current = snapshot();
        if (current.scores.length !== pending.scores.length
          || current.scores.some((score, index) => score !== pending.scores[index]
            || current.completions[index] !== pending.completions[index])) continue;

        let invalidScores = 0;
        let notices = 0;
        for (const score of current.scores) {
          const diagnostics = score.diagnostics;
          if (!Array.isArray(diagnostics)) throw new Error('A score has not reported its rendering status. Reload the workbook and try again.');
          if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) invalidScores++;
          notices += diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
        }
        if (invalidScores) {
          status.textContent = `Printing blocked: ${invalidScores} score${invalidScores === 1 ? ' has' : 's have'} notation errors. Review the score diagnostics, fix the errors, and try again.`;
          return;
        }
        // No await is allowed between the final readiness check and this call.
        // A returned print request cannot tell us whether a dialog opened, was
        // cancelled, or produced paper/PDF output.
        status.textContent = 'Print dialog requested.'
          + (notices ? ` ${notices} notation notice${notices === 1 ? ' remains' : 's remain'}; review the score diagnostics.` : '')
          + ' If nothing opens, use your browser’s Print command.';
        requestPrint();
        return;
      }
    } catch (error: unknown) {
      if (!disposed) {
        const detail = error instanceof Error && error.message ? error.message : 'The print request could not be prepared.';
        status.textContent = `Could not request printing: ${detail} Review any reported errors, fix them, and try again.`;
      }
    } finally {
      preparing = false;
      if (!disposed) printButton.disabled = previousDisabled;
    }
  };

  const clickPrint = (): void => { void request(); };
  preview.addEventListener('change', changePreview);
  printButton.addEventListener('click', clickPrint);
  changePreview();

  return () => {
    if (disposed) return;
    disposed = true;
    preview.removeEventListener('change', changePreview);
    printButton.removeEventListener('click', clickPrint);
    if (preparing) {
      printButton.disabled = previousDisabled;
      status.textContent = previousStatus;
    }
  };
}
