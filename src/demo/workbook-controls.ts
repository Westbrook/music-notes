import { reaction } from 'signal-utils/subtle/reaction';
import { WorkbookState } from './workbook-state.js';
import type { WorkbookScore } from './workbook-state.js';

export interface WorkbookStateOptions {
  readonly root: ParentNode;
  readonly preview?: boolean;
  readonly disabled?: boolean;
  /** Requests the host's print dialog; returning does not establish that it opened. */
  readonly requestPrint: () => void;
}

export interface WorkbookControlsOptions {
  readonly root: ParentNode;
  readonly preview: HTMLInputElement;
  readonly printButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly requestPrint: () => void;
}

/** The only adapter that connects workbook state to authored score elements. */
export function createWorkbookState({ root, requestPrint, preview, disabled }: WorkbookStateOptions): WorkbookState {
  const currentScores = (): (Element & WorkbookScore)[] => [...root.querySelectorAll<Element & WorkbookScore>('[data-score]')]
    .filter(score => score.isConnected);

  return new WorkbookState({
    readScores: currentScores,
    applyPreview: checked => {
      for (const score of currentScores()) score.toggleAttribute('print-preview', checked);
    },
    requestPrint,
  }, { preview, disabled });
}

/**
 * Compatibility adapter for existing hosts that supply their own native controls.
 * New hosts can bind the same state to music-workbook-toolbar. Input boundaries
 * update immediately; signal reactions project asynchronous readiness outcomes.
 */
export function initializeWorkbookControls({ root, preview, printButton, status, requestPrint }: WorkbookControlsOptions): () => void {
  const state = createWorkbookState({
    root,
    preview: preview.checked,
    disabled: printButton.disabled,
    requestPrint: () => {
      project();
      requestPrint();
    },
  });
  let disposed = false;
  let previousDisabled = printButton.disabled;
  let previousStatus = status.textContent;

  const project = (): void => {
    const view = state.view.get();
    preview.checked = view.preview;
    printButton.disabled = view.disabled;
    status.textContent = view.status;
  };
  const stopReaction = reaction(() => state.view.get(), project);

  const changePreview = (): void => {
    if (disposed) return;
    state.setPreview(preview.checked);
    project();
  };
  const clickPrint = (): void => {
    if (disposed || printButton.disabled) return;
    previousDisabled = printButton.disabled;
    previousStatus = status.textContent;
    state.setDisabled(printButton.disabled);
    void state.requestPrint();
    project();
  };

  preview.addEventListener('change', changePreview);
  printButton.addEventListener('click', clickPrint);
  project();

  return () => {
    if (disposed) return;
    disposed = true;
    preview.removeEventListener('change', changePreview);
    printButton.removeEventListener('click', clickPrint);
    stopReaction();
    const preparing = state.view.get().preparing;
    state.dispose();
    if (preparing) {
      printButton.disabled = previousDisabled;
      status.textContent = previousStatus;
    }
  };
}
