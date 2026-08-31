import { Signal } from 'signal-polyfill';
import type { Diagnostic, Score } from '../../model/types.js';
import { readonlySignal } from '../../state/readonly-signal.js';
import type { DeepReadonly, ReadonlySignal } from '../../state/readonly-signal.js';
import type { SelectionState } from '../selection.js';
import type { AuthorProject, Cursor } from '../types.js';

/** Cached accepted values for renderers. Commands remain the only write API. */
export interface EditorSignals {
  readonly project: ReadonlySignal<DeepReadonly<AuthorProject>>;
  readonly score: ReadonlySignal<Score>;
  readonly diagnostics: ReadonlySignal<readonly Diagnostic[]>;
  readonly revision: ReadonlySignal<number>;
  readonly documentEpoch: ReadonlySignal<number>;
  readonly selectionId: ReadonlySignal<string | undefined>;
  readonly selection: ReadonlySignal<SelectionState>;
  readonly selectionVersion: ReadonlySignal<number>;
  readonly cursor: ReadonlySignal<Readonly<Cursor> | undefined>;
  readonly canUndo: ReadonlySignal<boolean>;
  readonly canRedo: ReadonlySignal<boolean>;
  readonly pendingSource: ReadonlySignal<string | null>;
  readonly hasPendingSource: ReadonlySignal<boolean>;
}

interface EditorSignalSource {
  readonly project: AuthorProject;
  readonly score: Score;
  readonly diagnostics: readonly Diagnostic[];
  readonly revision: number;
  readonly documentEpoch: number;
  readonly selectionId: string | undefined;
  readonly selection: SelectionState;
  readonly cursor: Cursor | undefined;
  readonly past: readonly unknown[];
  readonly future: readonly unknown[];
}

/** Freeze only serializable snapshots, never authored DOM or engraving objects. */
export function freezeEditorValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeEditorValue(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Computeds are lazy and own no effects, observers, or DOM lifecycle. Narrow
 * selectors stop a cursor move from invalidating a score-only consumer.
 */
export function createEditorSignals(read: () => EditorSignalSource): EditorSignals {
  const project = new Signal.Computed(() => read().project);
  const selection = new Signal.Computed(() => read().selection);
  const pendingSource = new Signal.Computed(() => project.get().pendingSource);
  return Object.freeze({
    project: readonlySignal(project),
    score: readonlySignal(new Signal.Computed(() => read().score)),
    diagnostics: readonlySignal(new Signal.Computed(() => read().diagnostics)),
    revision: readonlySignal(new Signal.Computed(() => read().revision)),
    documentEpoch: readonlySignal(new Signal.Computed(() => read().documentEpoch)),
    selectionId: readonlySignal(new Signal.Computed(() => read().selectionId)),
    selection: readonlySignal(selection),
    selectionVersion: readonlySignal(new Signal.Computed(() => selection.get().version)),
    cursor: readonlySignal(new Signal.Computed(() => read().cursor)),
    canUndo: readonlySignal(new Signal.Computed(() => read().past.length > 0)),
    canRedo: readonlySignal(new Signal.Computed(() => read().future.length > 0)),
    pendingSource: readonlySignal(pendingSource),
    hasPendingSource: readonlySignal(new Signal.Computed(() => pendingSource.get() !== null)),
  });
}
