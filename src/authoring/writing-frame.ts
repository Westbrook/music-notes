export interface WritingFrameOptions {
  /** Comfortable OUTER paper / score-editor width, independent of task-pane visibility. */
  readonly maxWidth?: number;
  /** Space for a usable task pane, including its own border and padding. */
  readonly paneWidth?: number;
  readonly gap?: number;
}

export interface WritingFrameState {
  /** Outer paper border-box width. The score-host content width follows its CSS padding. */
  readonly width: number;
  readonly availableWidth: number;
  readonly paneWidth: number;
  readonly gap: number;
  readonly paneFits: boolean;
  readonly measured: boolean;
}

function validSize(value: number, name: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError('Writing frame ' + name + ' must be a finite ' + (allowZero ? 'nonnegative' : 'positive') + ' number.');
  }
  return value;
}

/** The owner measures on workbench resize/refit; this never observes a resized score column. */
export class WritingFrame {
  private readonly workbench: HTMLElement;
  private readonly maxWidth: number;
  private current: WritingFrameState;
  private disposed = false;

  constructor(workbench: HTMLElement, options: WritingFrameOptions = {}) {
    this.workbench = workbench;
    this.maxWidth = validSize(options.maxWidth ?? 960, 'maxWidth');
    const paneWidth = validSize(options.paneWidth ?? 320, 'paneWidth');
    const gap = validSize(options.gap ?? 16, 'gap', true);
    this.current = { width: 0, availableWidth: 0, paneWidth, gap, paneFits: false, measured: false };
    this.publish('--tools-pane-width', paneWidth);
    this.publish('--writing-frame-gap', gap);
  }

  get state(): WritingFrameState { return { ...this.current }; }

  measure(): WritingFrameState {
    if (this.disposed || !this.visibleWorkbench()) return this.state;
    const style = this.workbench.ownerDocument.defaultView?.getComputedStyle(this.workbench);
    const padding = (Number.parseFloat(style?.paddingLeft ?? '') || 0) + (Number.parseFloat(style?.paddingRight ?? '') || 0);
    // clientWidth excludes border and scrollbar; subtract padding for the grid's content box.
    // A score-host rect would shrink when a pane opened and corrupt the chosen frame.
    const availableWidth = this.workbench.clientWidth - padding;
    if (!Number.isFinite(availableWidth) || availableWidth <= 0) return this.state;
    const width = Math.min(this.maxWidth, availableWidth);
    const { paneWidth, gap } = this.current;
    this.current = { width, availableWidth, paneWidth, gap, paneFits: width + paneWidth + gap <= availableWidth, measured: true };
    this.publish('--writing-frame-width', width);
    return this.state;
  }

  refit(): WritingFrameState { return this.measure(); }

  dispose(): void { this.disposed = true; }

  private publish(name: string, value: number): void {
    const text = `${value}px`;
    if (this.workbench.style.getPropertyValue(name) !== text) this.workbench.style.setProperty(name, text);
  }

  private visibleWorkbench(): boolean {
    if (!this.workbench.isConnected || this.workbench.closest('[hidden]')) return false;
    const view = this.workbench.ownerDocument.defaultView;
    for (let element: HTMLElement | null = this.workbench; element && view; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  }
}
