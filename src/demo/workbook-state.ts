import { Signal } from 'signal-polyfill';
import type { Diagnostic } from '../model/types.js';
import { readonlySignal } from '../state/readonly-signal.js';
import type { ReadonlySignal } from '../state/readonly-signal.js';

/** The rendering boundary required by the workbook, independent of the DOM. */
export interface WorkbookScore {
  readonly renderComplete?: Promise<void>;
  readonly diagnostics?: readonly Diagnostic[];
}

export interface WorkbookHost {
  /** Return the current, connected score roots in their authored order. */
  readScores(): readonly WorkbookScore[];
  applyPreview(checked: boolean): void;
  /** Returning does not establish that a dialog opened or a document printed. */
  requestPrint(): void;
}

export interface WorkbookView {
  readonly preview: boolean;
  readonly disabled: boolean;
  readonly preparing: boolean;
  readonly status: string;
}

interface WorkbookSnapshot {
  readonly preview: boolean;
  readonly externallyDisabled: boolean;
  readonly preparing: boolean;
  readonly status: string;
}

interface RenderSnapshot {
  readonly scores: readonly WorkbookScore[];
  readonly completions: readonly Promise<void>[];
}

interface PrintRequest {
  readonly previousStatus: string;
}

function layoutStatus(preview: boolean): string {
  return preview
    ? 'Previewing score layout at the configured print width. This does not show physical paper pages.'
    : 'Responsive score layout. Printing uses each score’s configured print width.';
}

/**
 * Owns workbook presentation state and print readiness. The injected host owns
 * browser effects; consumers only read the computed view and invoke actions.
 */
export class WorkbookState {
  readonly view: ReadonlySignal<WorkbookView>;

  private readonly host: WorkbookHost;
  private readonly snapshot: Signal.State<WorkbookSnapshot>;
  private activeRequest: PrintRequest | null = null;
  private disposed = false;

  constructor(host: WorkbookHost, initial: { readonly preview?: boolean; readonly disabled?: boolean } = {}) {
    this.host = host;
    const preview = initial.preview ?? false;
    this.snapshot = new Signal.State<WorkbookSnapshot>({
      preview,
      externallyDisabled: initial.disabled ?? false,
      preparing: false,
      status: layoutStatus(preview),
    });
    this.view = readonlySignal(new Signal.Computed(() => {
      const { preview, externallyDisabled, preparing, status } = this.snapshot.get();
      return Object.freeze({ preview, disabled: externallyDisabled || preparing, preparing, status });
    }));
    this.host.applyPreview(preview);
  }

  setPreview(checked: boolean): void {
    if (this.disposed) return;
    const current = this.snapshot.get();
    this.snapshot.set({
      ...current,
      preview: checked,
      status: current.preparing ? current.status : layoutStatus(checked),
    });
    this.host.applyPreview(checked);
  }

  setDisabled(disabled: boolean): void {
    if (this.disposed) return;
    const current = this.snapshot.get();
    if (current.externallyDisabled !== disabled) this.snapshot.set({ ...current, externallyDisabled: disabled });
  }

  async requestPrint(): Promise<void> {
    const current = this.snapshot.get();
    if (this.disposed || this.activeRequest || current.externallyDisabled) return;
    const request: PrintRequest = { previousStatus: current.status };
    this.activeRequest = request;
    this.snapshot.set({ ...current, preparing: true, status: 'Preparing scores for the print dialog…' });
    try {
      while (this.isCurrent(request)) {
        const pending = this.readRenderSnapshot();
        await Promise.all(pending.completions);
        if (!this.isCurrent(request)) return;
        // Completion getters also drain pending source mutations. An early
        // score may have changed while another score was still rendering.
        const ready = this.readRenderSnapshot();
        if (!this.isCurrent(request)) return;
        if (ready.scores.length !== pending.scores.length
          || ready.scores.some((score, index) => score !== pending.scores[index]
            || ready.completions[index] !== pending.completions[index])) continue;

        let invalidScores = 0;
        let notices = 0;
        for (const score of ready.scores) {
          const diagnostics = score.diagnostics;
          if (!Array.isArray(diagnostics)) throw new Error('A score has not reported its rendering status. Reload the workbook and try again.');
          if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) invalidScores++;
          notices += diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
        }
        if (!this.isCurrent(request)) return;
        if (invalidScores) {
          this.setStatus(`Printing blocked: ${invalidScores} score${invalidScores === 1 ? ' has' : 's have'} notation errors. Review the score diagnostics, fix the errors, and try again.`);
          return;
        }
        // Keep the final readiness check and print request in this continuation;
        // an async gap here would allow printing a stale score projection.
        this.setStatus('Print dialog requested.'
          + (notices ? ` ${notices} notation notice${notices === 1 ? ' remains' : 's remain'}; review the score diagnostics.` : '')
          + ' If nothing opens, use your browser’s Print command.');
        if (this.isCurrent(request)) this.host.requestPrint();
        return;
      }
    } catch (error: unknown) {
      if (this.isCurrent(request)) {
        const detail = error instanceof Error && error.message ? error.message : 'The print request could not be prepared.';
        this.setStatus(`Could not request printing: ${detail} Review any reported errors, fix them, and try again.`);
      }
    } finally {
      if (this.isCurrent(request)) {
        this.activeRequest = null;
        this.snapshot.set({ ...this.snapshot.get(), preparing: false });
      }
    }
  }

  /** Cancel pending work without discarding preview or preventing a later retry. */
  cancelPendingPrint(): void {
    const request = this.activeRequest;
    if (!request) return;
    this.activeRequest = null;
    this.snapshot.set({ ...this.snapshot.get(), preparing: false, status: request.previousStatus });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingPrint();
  }

  private isCurrent(request: PrintRequest): boolean {
    return !this.disposed && this.activeRequest === request;
  }

  private setStatus(status: string): void {
    this.snapshot.set({ ...this.snapshot.get(), status });
  }

  private readRenderSnapshot(): RenderSnapshot {
    // Copy even a mutable host array so pending identity/order cannot change.
    const scores = [...this.host.readScores()];
    if (!scores.length) throw new Error('No scores are available to print.');
    const completions = scores.map(score => {
      const completion = score.renderComplete;
      if (!completion || typeof completion.then !== 'function') {
        throw new Error('A score is not ready. Reload the workbook after its music components have loaded.');
      }
      return completion;
    });
    return { scores, completions };
  }
}
