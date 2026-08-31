import { Signal } from 'signal-polyfill';
import { batch } from 'signal-utils/subtle/batched-effect';
import { readonlySignal } from '../../state/readonly-signal.js';
import type { ViewMode } from '../types.js';

/** Ephemeral workspace choices. Music, history and form drafts have other owners. */
export interface AuthorViewSnapshot {
  readonly mode: ViewMode;
  readonly partId: string;
  readonly entryMode: boolean;
  readonly resumeWritingAfterView: boolean;
  readonly entryDragArmed: boolean;
  readonly pitchDragArmed: boolean;
  readonly selectMore: boolean;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly readingWidth: number | undefined;
  readonly pointerSummary: string;
  readonly writingStatus: boolean;
  readonly inspectionSelectionId: string | null;
  readonly propertiesVisited: boolean;
  readonly selectionError: string | undefined;
}

const initialView: AuthorViewSnapshot = Object.freeze({
  mode: 'write', partId: 'score', entryMode: false, resumeWritingAfterView: false,
  entryDragArmed: false, pitchDragArmed: false, selectMore: false,
  rangeStart: '', rangeEnd: '', readingWidth: undefined, pointerSummary: '',
  writingStatus: false, inspectionSelectionId: null, propertiesVisited: false,
  selectionError: undefined,
});

/**
 * DOM-free state, owned by one workspace and injectable into Lit components.
 * A patch publishes one snapshot; selectors suppress unrelated invalidations.
 * Native focus, pointer capture and measurements stay in lifecycle controllers.
 */
export class AuthorViewState {
  private readonly current: Signal.State<AuthorViewSnapshot>;
  readonly snapshot;
  readonly signals;

  constructor(initial: Partial<AuthorViewSnapshot> = {}) {
    this.current = new Signal.State(Object.freeze({ ...initialView, ...initial }));
    this.snapshot = readonlySignal(this.current);
    this.signals = Object.freeze({
      mode: readonlySignal(new Signal.Computed(() => this.current.get().mode)),
      partId: readonlySignal(new Signal.Computed(() => this.current.get().partId)),
      entryMode: readonlySignal(new Signal.Computed(() => this.current.get().entryMode)),
      selectMore: readonlySignal(new Signal.Computed(() => this.current.get().selectMore)),
      isWriting: readonlySignal(new Signal.Computed(() => this.current.get().mode === 'write')),
    });
  }

  update(patch: Partial<AuthorViewSnapshot>): void {
    const previous = this.current.get();
    const keys = Object.keys(patch) as (keyof AuthorViewSnapshot)[];
    if (keys.every(key => Object.is(previous[key], patch[key]))) return;
    batch(() => this.current.set(Object.freeze({ ...previous, ...patch })));
  }
}
