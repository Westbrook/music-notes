import { Signal } from 'signal-polyfill';
import { SignalMap } from 'signal-utils/map';
import { readonlySignal } from '../state/readonly-signal.js';
import type { DeepReadonly, ReadonlySignal } from '../state/readonly-signal.js';

/** Session-only form state. Accepted source and musical history remain the caller's responsibility. */
export type DraftFields = Record<string, string | boolean | string[]>;
export type DraftField<F extends object> = Extract<keyof F, string>;
export type DraftStatus = 'unbound' | 'clean' | 'dirty' | 'conflict' | 'missing' | 'document-changed';

export interface DraftTarget<F extends object> {
  /** Identity of the opened document, not a revision or a selected layout. */
  documentId: string;
  id: string;
  label: string;
  values: F;
  /** Relevant facts shared by every field, such as the target's owning measure. */
  context?: unknown;
  /** Relevant facts for each field. Do not include unrelated document state. */
  dependencies?: Partial<Record<DraftField<F>, unknown>>;
}

export interface DraftContext<F extends object> {
  documentId: string;
  /** Reported for the caller's transaction; a changed revision is not itself a conflict. */
  revision: number;
  /** Resolve this exact target, including targets that are no longer selected. */
  read: (targetId: string) => DraftTarget<F> | null;
}

export interface DraftSyncContext<F extends object> extends DraftContext<F> {
  selected: DraftTarget<F> | null;
}

export interface DraftConflict<F extends object> {
  field: DraftField<F>;
  reason: 'value' | 'context' | 'dependency';
  base: unknown;
  current: unknown;
  draft: unknown;
  message: string;
}

export interface DraftSnapshot<F extends object> {
  formId: string;
  documentId: string | null;
  targetId: string | null;
  label: string | null;
  /** Current accepted untouched fields, overlaid with the user's dirty fields. */
  values: F | null;
  current: F | null;
  dirtyFields: readonly DraftField<F>[];
  dirty: boolean;
  status: DraftStatus;
  message: string;
  /** Last rejected source transaction's local error, retained through unrelated refreshes. */
  error: string | null;
  conflicts: readonly DraftConflict<F>[];
  canApply: boolean;
  matchesSelection: boolean;
  revision: number | null;
}

/** Cached reactive views are immutable; snapshot() returns an independent editable copy. */
export type ReadonlyDraftSnapshot<F extends object> = DeepReadonly<DraftSnapshot<F>>;

export type DraftResolution<F extends object> = {
  ok: true;
  documentId: string;
  targetId: string;
  label: string;
  revision: number;
  /** Apply this patch only; values also contains the latest accepted untouched fields. */
  patch: Partial<F>;
  values: F;
  dirtyFields: readonly DraftField<F>[];
  /** False means the intent is already accepted: do not create a musical undo entry. */
  changed: boolean;
} | {
  ok: false;
  status: 'unbound' | 'conflict' | 'missing' | 'document-changed';
  message: string;
  conflicts: readonly DraftConflict<F>[];
};

export interface DraftSummary {
  formId: string;
  documentId: string;
  targetId: string;
  label: string;
  dirtyFields: readonly string[];
  status: DraftStatus;
  message: string;
}

type Values = Record<string, unknown>;
type Target = DraftTarget<Values>;
interface DirtyField { value: unknown; base: unknown; context: unknown; dependency: unknown }
interface StoredDraft {
  target: Target | null;
  selected: { documentId: string; id: string } | null;
  revision: number | null;
  fields: Map<string, DirtyField>;
  unavailable: 'missing' | 'document-changed' | null;
  error: string | null;
}

function emptyDraft(): StoredDraft {
  return { target: null, selected: null, revision: null, fields: new Map(), unavailable: null, error: null };
}

/** Clone data without invoking accessors or carrying mutable objects into the store. */
function copyData<T>(value: T, ancestors = new Set<object>(), depth = 0): T {
  if (value === null || value === undefined || typeof value === 'string'
    || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value !== 'object') throw new Error('Form drafts accept plain data, not functions or symbols.');
  if (depth > 64 || ancestors.has(value)) throw new Error('Form draft data must not contain cycles or excessive nesting.');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new Error('Form drafts accept plain objects and arrays only.');
  }
  const result: object = isArray ? new Array((value as unknown[]).length) : {};
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('Form draft data must use string keys.');
      if (isArray && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new Error('Form draft data must not contain accessors.');
      Object.defineProperty(result, key, {
        value: copyData(descriptor.value, ancestors, depth + 1), enumerable: true, configurable: true, writable: true,
      });
    }
  } finally { ancestors.delete(value); }
  return result as T;
}

function own(value: object | undefined, key: string): unknown {
  return value && Object.hasOwn(value, key) ? (value as Values)[key] : undefined;
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equal(own(left, key), own(right, key)));
}

function record(value: unknown, label: string): asserts value is Values {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a field object.`);
}

function copyTarget<F extends object>(value: DraftTarget<F>): Target {
  const target = copyData(value);
  record(target, 'The form target');
  for (const key of ['documentId', 'id', 'label'] as const) {
    if (typeof target[key] !== 'string' || !target[key].trim()) throw new Error(`The form target needs a ${key}.`);
  }
  record(target.values, 'Form values');
  if (target.dependencies !== undefined) record(target.dependencies, 'Form dependencies');
  return target as unknown as Target;
}

function copyStored(value: StoredDraft): StoredDraft {
  // All accepted data was copied at the boundary. Transitions replace field
  // records and targets, so only the draft record and its editable map need copying.
  return { ...value, fields: new Map(value.fields) };
}

function sameDraft(left: StoredDraft, right: StoredDraft): boolean {
  if (left.revision !== right.revision || left.unavailable !== right.unavailable || left.error !== right.error
    || !equal(left.target, right.target) || !equal(left.selected, right.selected)
    || left.fields.size !== right.fields.size) return false;
  const previous = [...left.fields];
  return [...right.fields].every(([key, field], index) =>
    key === previous[index][0] && equal(field, previous[index][1]));
}

function freezeData<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function validateContext<F extends object>(context: DraftContext<F>): void {
  if (typeof context.documentId !== 'string' || !context.documentId.trim()) throw new Error('The form needs a document identity.');
  if (!Number.isSafeInteger(context.revision) || context.revision < 0) throw new Error('The form needs a valid revision.');
  if (typeof context.read !== 'function') throw new Error('The form needs an exact target resolver.');
}

function bind(state: StoredDraft, target: Target | null): void {
  state.target = target;
  state.fields.clear();
  state.unavailable = null;
  state.error = null;
}

/** Refresh the named original target, never substituting the currently selected target. */
function refresh<F extends object>(state: StoredDraft, context: DraftContext<F>): void {
  state.revision = context.revision;
  if (!state.target) return;
  if (state.target.documentId !== context.documentId) {
    state.unavailable = 'document-changed';
    return;
  }
  const value = context.read(state.target.id);
  if (value === null) {
    state.unavailable = 'missing';
    return;
  }
  const current = copyTarget(value);
  if (current.documentId !== state.target.documentId) {
    state.unavailable = 'document-changed';
    return;
  }
  if (current.id !== state.target.id) {
    state.unavailable = 'missing';
    return;
  }
  state.target = current;
  state.unavailable = null;
  for (const [key, field] of state.fields) {
    if (equal(own(current.values, key), field.value)) state.fields.delete(key);
  }
  if (!state.fields.size) state.error = null;
}

function conflictsFor(state: StoredDraft): DraftConflict<Values>[] {
  if (!state.target || state.unavailable) return [];
  const result: DraftConflict<Values>[] = [];
  for (const [field, value] of state.fields) {
    const checks = [
      { reason: 'value' as const, base: value.base, current: own(state.target.values, field), message: `${field} changed in the accepted document.` },
      { reason: 'context' as const, base: value.context, current: state.target.context, message: `The context for ${field} changed in the accepted document.` },
      { reason: 'dependency' as const, base: value.dependency, current: own(state.target.dependencies, field), message: `A setting required by ${field} changed in the accepted document.` },
    ];
    for (const check of checks) if (!equal(check.base, check.current)) {
      result.push({ field, ...check, draft: value.value });
    }
  }
  return result;
}

function setField(target: Values, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value: copyData(value), enumerable: true, configurable: true, writable: true });
}

function snapshot<F extends object>(form: string, state: StoredDraft): DraftSnapshot<F> {
  const conflicts = conflictsFor(state);
  const status: DraftStatus = !state.target ? 'unbound' : state.unavailable
    ?? (conflicts.length ? 'conflict' : state.fields.size ? 'dirty' : 'clean');
  const label = state.target?.label ?? null;
  const message = status === 'unbound' ? 'Select a target to use this form.'
    : status === 'missing' ? `${label} is no longer available. Your unsaved fields are kept; discard them to choose another target.`
      : status === 'document-changed' ? `${label} belongs to a different opened document. Your unsaved fields were not applied.`
        : status === 'conflict' ? `${label} changed in a field or context used by this draft. Review the changes or discard the draft.`
          : state.error ?? '';
  const values = state.target ? copyData(state.target.values) : null;
  if (values) for (const [key, field] of state.fields) setField(values, key, field.value);
  return {
    formId: form,
    documentId: state.target?.documentId ?? null,
    targetId: state.target?.id ?? null,
    label,
    values: values as F | null,
    current: (state.target ? copyData(state.target.values) : null) as F | null,
    dirtyFields: [...state.fields.keys()] as DraftField<F>[],
    dirty: state.fields.size > 0,
    status,
    message,
    error: state.error,
    conflicts: copyData(conflicts) as DraftConflict<F>[],
    canApply: state.fields.size > 0 && status === 'dirty',
    matchesSelection: !!state.target && state.selected?.documentId === state.target.documentId && state.selected.id === state.target.id,
    revision: state.revision,
  };
}

/**
 * Each form owns one named draft. Clean forms follow selection; dirty forms retain
 * their original identity and field baselines. This class never edits a project.
 */
export class DraftStore<Forms extends { [Name in keyof Forms]: object } = Record<string, DraftFields>> {
  // SignalMap tracks each form separately. A transition is staged privately and
  // published once, so observers never see partly validated fields or targets.
  private readonly drafts = new SignalMap<string, StoredDraft>();
  private readonly views = new Map<string, ReadonlySignal<ReadonlyDraftSnapshot<Values>>>();

  readonly signals = Object.freeze({
    dirtyCount: readonlySignal(new Signal.Computed(() => {
      let count = 0;
      for (const state of this.drafts.values()) if (state.fields.size) count++;
      return count;
    })),
    dirtyDrafts: readonlySignal(new Signal.Computed(() => {
      const summaries: DraftSummary[] = [];
      for (const [formId, state] of this.drafts) {
        if (!state.fields.size) continue;
        const view = this.view(formId).get();
        summaries.push({
          formId, documentId: view.documentId!, targetId: view.targetId!, label: view.label!,
          dirtyFields: view.dirtyFields, status: view.status, message: view.message,
        });
      }
      return freezeData(summaries);
    }, { equals: equal })),
  });

  get dirtyCount(): number { return this.signals.dirtyCount.get(); }

  get dirtyDrafts(): readonly DraftSummary[] {
    return copyData(this.signals.dirtyDrafts.get());
  }

  /** Read this selector in a reactive UI; unrelated forms keep their cached views. */
  select<Name extends Extract<keyof Forms, string>>(form: Name): ReadonlySignal<ReadonlyDraftSnapshot<Forms[Name]>> {
    return this.view(form) as unknown as ReadonlySignal<ReadonlyDraftSnapshot<Forms[Name]>>;
  }

  snapshot<Name extends Extract<keyof Forms, string>>(form: Name): DraftSnapshot<Forms[Name]> {
    return copyData(this.select(form).get()) as DraftSnapshot<Forms[Name]>;
  }

  private view(form: string): ReadonlySignal<ReadonlyDraftSnapshot<Values>> {
    let view = this.views.get(form);
    if (!view) {
      view = readonlySignal(new Signal.Computed(() =>
        freezeData(snapshot<Values>(form, this.drafts.get(form) ?? emptyDraft()))));
      this.views.set(form, view);
    }
    return view;
  }

  private publish(form: string, state: StoredDraft): void {
    const previous = this.drafts.get(form);
    if (!previous || !sameDraft(previous, state)) this.drafts.set(form, state);
  }

  sync<Name extends Extract<keyof Forms, string>>(form: Name, context: DraftSyncContext<Forms[Name]>): DraftSnapshot<Forms[Name]> {
    validateContext(context);
    const selected = context.selected === null ? null : copyTarget(context.selected);
    if (selected && selected.documentId !== context.documentId) throw new Error('The selected form target belongs to another document.');
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    state.selected = selected ? { documentId: selected.documentId, id: selected.id } : null;
    state.revision = context.revision;
    if (!state.fields.size) bind(state, selected);
    else refresh(state, context);
    this.publish(form, state);
    return this.snapshot(form);
  }

  patch<Name extends Extract<keyof Forms, string>>(form: Name, fields: Partial<Forms[Name]>): DraftSnapshot<Forms[Name]> {
    const patch = copyData(fields);
    record(patch, 'A form patch');
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    if (!state.target) throw new Error('Select a target before editing this form.');
    for (const key of Object.keys(patch)) {
      const value = own(patch, key);
      const current = own(state.target.values, key);
      if (equal(value, current)) state.fields.delete(key);
      else {
        const previous = state.fields.get(key);
        state.fields.set(key, previous ? { ...previous, value } : {
          value, base: copyData(current), context: copyData(state.target.context),
          dependency: copyData(own(state.target.dependencies, key)),
        });
      }
    }
    state.error = null;
    this.publish(form, state);
    return this.snapshot(form);
  }

  resolve<Name extends Extract<keyof Forms, string>>(form: Name, context: DraftContext<Forms[Name]>): DraftResolution<Forms[Name]> {
    validateContext(context);
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    refresh(state, context);
    this.publish(form, state);
    const view = this.snapshot(form);
    if (view.status !== 'clean' && view.status !== 'dirty') {
      return { ok: false, status: view.status, message: view.message, conflicts: view.conflicts };
    }
    const patch: Values = {};
    for (const [key, field] of state.fields) setField(patch, key, field.value);
    return {
      ok: true, documentId: view.documentId!, targetId: view.targetId!, label: view.label!, revision: context.revision,
      patch: patch as Partial<Forms[Name]>, values: view.values!, dirtyFields: view.dirtyFields, changed: view.dirty,
    };
  }

  /** Explicitly acknowledge current dependencies while keeping the intended dirty values. */
  review<Name extends Extract<keyof Forms, string>>(form: Name, context: DraftContext<Forms[Name]>): DraftSnapshot<Forms[Name]> {
    validateContext(context);
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    refresh(state, context);
    if (state.target && !state.unavailable) {
      for (const [key, field] of state.fields) state.fields.set(key, {
        value: field.value, base: copyData(own(state.target.values, key)), context: copyData(state.target.context),
        dependency: copyData(own(state.target.dependencies, key)),
      });
      state.error = null;
    }
    this.publish(form, state);
    return this.snapshot(form);
  }

  /** Call only after the corresponding source transaction succeeds. */
  commit<Name extends Extract<keyof Forms, string>>(form: Name, accepted: DraftTarget<Forms[Name]>): DraftSnapshot<Forms[Name]> {
    const target = copyTarget(accepted);
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    if (!state.target || state.target.documentId !== target.documentId || state.target.id !== target.id) {
      throw new Error('The accepted target does not match this form draft.');
    }
    bind(state, target);
    this.publish(form, state);
    return this.snapshot(form);
  }

  /** Explicit discard/rebind, also used after successful creation or Apply and next. */
  discard<Name extends Extract<keyof Forms, string>>(form: Name, selected: DraftTarget<Forms[Name]> | null): DraftSnapshot<Forms[Name]> {
    const target = selected === null ? null : copyTarget(selected);
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    bind(state, target);
    state.selected = target ? { documentId: target.documentId, id: target.id } : null;
    this.publish(form, state);
    return this.snapshot(form);
  }

  /** Keep source validation failures local without losing any user-entered field. */
  fail<Name extends Extract<keyof Forms, string>>(form: Name, message: string): DraftSnapshot<Forms[Name]> {
    const state = copyStored(this.drafts.get(form) ?? emptyDraft());
    state.error = message;
    this.publish(form, state);
    return this.snapshot(form);
  }

  /** The caller must confirm loss of any listed dirty drafts before using this. */
  discardAll(): void { if (this.drafts.size) this.drafts.clear(); }
}
