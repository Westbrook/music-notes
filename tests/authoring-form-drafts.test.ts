import { describe, expect, it, vi } from 'vitest';
import { Signal } from 'signal-polyfill';
import { DraftStore } from '../src/authoring/form-drafts.js';
import type { DraftContext, DraftSyncContext, DraftTarget } from '../src/authoring/form-drafts.js';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';

interface Fields { text: string; meter: string; pickup: boolean; recipients: string[] }
interface Forms { measure: Fields; marking: Fields; page: Fields }

function target(id = 'm1', values: Partial<Fields> = {}, documentId = 'opened-1'): DraftTarget<Fields> {
  return {
    documentId, id, label: `Measure ${id.slice(1)}`,
    values: { text: 'Freely', meter: '4/4', pickup: false, recipients: ['s1'], ...values },
    context: { staffId: 's1' },
    dependencies: { text: { onset: '0/1' }, meter: { writtenTime: '1/1' }, recipients: { available: ['s1', 's2'] } },
  };
}

function fixture() {
  const store = new DraftStore<Forms>();
  const targets = new Map([['m1', target()], ['m2', target('m2', { text: 'In time' })]]);
  const state = {
    store, targets, documentId: 'opened-1', revision: 0,
    context(selected: string | null = 'm1'): DraftSyncContext<Fields> {
      return {
        documentId: state.documentId, revision: state.revision,
        selected: selected === null ? null : targets.get(selected) ?? null,
        read: id => targets.get(id) ?? null,
      };
    },
  };
  store.sync('measure', state.context());
  return state;
}

describe('session-only form draft binding', () => {
  it('starts unbound and requires a named target before editing', () => {
    const store = new DraftStore<Forms>();
    expect(store.snapshot('measure')).toMatchObject({
      formId: 'measure', status: 'unbound', targetId: null, values: null, current: null,
      dirty: false, dirtyFields: [], canApply: false, matchesSelection: false, revision: null,
    });
    expect(() => store.patch('measure', { text: 'Later' })).toThrow(/Select a target/);
    expect(store.dirtyCount).toBe(0);
  });

  it('lets pristine forms follow selection and fresh accepted properties automatically', () => {
    const f = fixture();
    f.targets.get('m1')!.values.text = 'Accepted update';
    f.revision = 6;
    expect(f.store.sync('measure', f.context())).toMatchObject({
      targetId: 'm1', status: 'clean', values: { text: 'Accepted update' }, revision: 6, matchesSelection: true,
    });
    expect(f.store.sync('measure', f.context('m2'))).toMatchObject({
      targetId: 'm2', label: 'Measure 2', values: { text: 'In time' }, status: 'clean',
    });
    expect(f.store.sync('measure', f.context(null))).toMatchObject({ targetId: null, status: 'unbound', values: null });
  });

  it('retains a dirty original target across selection, no selection, and repeated refreshes', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Rubato' });
    for (const selected of ['m2', null, 'm1', 'm2']) {
      f.revision++;
      const view = f.store.sync('measure', f.context(selected));
      expect(view).toMatchObject({ targetId: 'm1', label: 'Measure 1', values: { text: 'Rubato' }, status: 'dirty' });
      expect(view.matchesSelection).toBe(selected === 'm1');
    }
    expect(f.store.dirtyCount).toBe(1);
  });

  it('maintains separate drafts for multiple forms and counts forms rather than fields', () => {
    const f = fixture();
    f.store.sync('marking', f.context('m2'));
    f.store.patch('measure', { meter: '3/4', pickup: true });
    f.store.patch('marking', { text: 'Open solo', recipients: ['s1', 's2'] });
    f.store.sync('measure', f.context('m2'));
    f.store.sync('marking', f.context());
    expect(f.store.dirtyCount).toBe(2);
    expect(f.store.dirtyDrafts).toEqual([
      { formId: 'measure', documentId: 'opened-1', targetId: 'm1', label: 'Measure 1', dirtyFields: ['meter', 'pickup'], status: 'dirty', message: '' },
      { formId: 'marking', documentId: 'opened-1', targetId: 'm2', label: 'Measure 2', dirtyFields: ['text', 'recipients'], status: 'dirty', message: '' },
    ]);
  });

  it('uses the selected snapshot for a pristine form without reading the old target', () => {
    const f = fixture();
    const read = vi.fn(() => { throw new Error('The old target must not be read'); });
    const view = f.store.sync('measure', { ...f.context('m2'), read });
    expect(view.targetId).toBe('m2');
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the dirty original target and never silently substitutes the selected target', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Stay here' });
    const read = vi.fn((id: string) => f.targets.get(id) ?? null);
    f.store.sync('measure', { ...f.context('m2'), read });
    expect(read).toHaveBeenCalledExactlyOnceWith('m1');
    expect(f.store.snapshot('measure').targetId).toBe('m1');
  });
});

describe('reactive draft selectors', () => {
  it('keeps selectors stable and updates derived dirty summaries through form transitions', () => {
    const f = fixture();
    const measure = f.store.select('measure');
    expect(f.store.select('measure')).toBe(measure);
    expect(measure).not.toHaveProperty('set');
    expect(f.store.signals.dirtyCount).not.toHaveProperty('set');
    expect(f.store.signals.dirtyDrafts).not.toHaveProperty('set');
    const summary = new Signal.Computed(() => ({
      count: f.store.signals.dirtyCount.get(),
      drafts: f.store.signals.dirtyDrafts.get(),
    }));
    const cleanSummary = summary.get();
    expect(cleanSummary).toEqual({ count: 0, drafts: [] });
    f.store.sync('page', f.context('m2'));
    expect(summary.get()).toBe(cleanSummary);

    f.store.patch('measure', { meter: '7/', pickup: true });
    expect(summary.get()).toMatchObject({ count: 1, drafts: [{ formId: 'measure', dirtyFields: ['meter', 'pickup'] }] });
    const dirtySummary = summary.get();
    f.store.patch('measure', { meter: '7/8' });
    expect(summary.get()).toBe(dirtySummary);
    f.store.fail('measure', 'Finish the meter denominator.');
    expect(summary.get().drafts[0].message).toBe('Finish the meter denominator.');
    f.store.discard('measure', f.targets.get('m1')!);
    expect(summary.get()).toEqual({ count: 0, drafts: [] });
    expect(measure.get().status).toBe('clean');
  });

  it('does not recompute or replace another form view when a form changes or is first bound', () => {
    const f = fixture();
    f.store.sync('marking', f.context('m2'));
    const measureRead = vi.fn(() => f.store.select('measure').get());
    const markingRead = vi.fn(() => f.store.select('marking').get());
    const measure = new Signal.Computed(measureRead);
    const marking = new Signal.Computed(markingRead);
    const beforeMeasure = measure.get();
    const beforeMarking = marking.get();

    f.store.patch('measure', { text: 'New cue' });
    f.store.sync('page', f.context());
    expect(measure.get()).not.toBe(beforeMeasure);
    expect(measure.get().values!.text).toBe('New cue');
    expect(marking.get()).toBe(beforeMarking);
    expect(measureRead).toHaveBeenCalledTimes(2);
    expect(markingRead).toHaveBeenCalledTimes(1);
  });

  it('retains cached views and derived work for transitions with no observable change', () => {
    const f = fixture();
    const read = vi.fn(() => f.store.select('measure').get());
    const derived = new Signal.Computed(read);
    const before = derived.get();
    const unchanged = [
      () => f.store.sync('measure', f.context()),
      () => f.store.patch('measure', { text: 'Freely', recipients: ['s1'] }),
      () => f.store.resolve('measure', f.context()),
      () => f.store.review('measure', f.context()),
      () => f.store.commit('measure', f.targets.get('m1')!),
      () => f.store.discard('measure', f.targets.get('m1')!),
    ];
    for (const update of unchanged) {
      update();
      expect(derived.get()).toBe(before);
    }
    expect(read).toHaveBeenCalledTimes(1);

    f.store.patch('measure', { text: 'Draft cue' });
    const dirty = derived.get();
    f.store.patch('measure', { text: 'Draft cue' });
    expect(derived.get()).toBe(dirty);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('deeply freezes shared views and summaries while preserving independent mutable snapshots', () => {
    const f = fixture();
    f.store.patch('measure', { recipients: ['s2'] });
    f.targets.get('m1')!.dependencies!.recipients = { available: ['s1'] };
    f.store.sync('measure', f.context());
    const view = f.store.select('measure').get();
    const summary = f.store.signals.dirtyDrafts.get();
    const dependency = view.conflicts[0].base as { available: readonly string[] };
    for (const value of [view, view.values, view.values!.recipients, view.current, view.current!.recipients,
      view.dirtyFields, view.conflicts, view.conflicts[0], dependency, dependency.available,
      summary, summary[0], summary[0].dirtyFields]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(() => (view.values!.recipients as string[]).push('external mutation')).toThrow(TypeError);
    expect(() => (dependency.available as string[]).push('external mutation')).toThrow(TypeError);

    const copy = f.store.snapshot('measure');
    copy.values!.recipients.push('local mutation');
    (copy.conflicts[0].base as { available: string[] }).available.push('local mutation');
    expect(f.store.select('measure').get()).toBe(view);
    expect(view.values!.recipients).toEqual(['s2']);
    expect(dependency.available).toEqual(['s1', 's2']);
  });

  it('publishes no partial state or notification when input or refresh validation fails', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Keep this cue' });
    const read = vi.fn(() => ({
      view: f.store.select('measure').get(),
      count: f.store.signals.dirtyCount.get(),
      drafts: f.store.signals.dirtyDrafts.get(),
    }));
    const derived = new Signal.Computed(read);
    const notified = vi.fn();
    const watcher = new Signal.subtle.Watcher(notified);
    watcher.watch(derived);
    try {
      const before = derived.get();
      const getter = vi.fn(() => '3/4');
      const patch: Partial<Fields> = { text: 'A partial replacement' };
      Object.defineProperty(patch, 'meter', { enumerable: true, get: getter });
      expect(() => f.store.patch('measure', patch)).toThrow(/accessors/);
      const invalid = target();
      invalid.context = new Date();
      expect(() => f.store.sync('measure', {
        ...f.context('m2'), revision: 9, read: () => invalid,
      })).toThrow(/plain objects/);
      expect(getter).not.toHaveBeenCalled();
      expect(notified).not.toHaveBeenCalled();
      expect(derived.get()).toBe(before);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      watcher.unwatch(derived);
    }
  });

  it('resets existing selector consumers on discardAll and reuses their handles on the next bind', () => {
    const f = fixture();
    const measure = f.store.select('measure');
    const marking = f.store.select('marking');
    f.store.sync('marking', f.context('m2'));
    f.store.patch('measure', { text: 'One draft' });
    f.store.patch('marking', { text: 'Another draft' });
    const derived = new Signal.Computed(() => [measure.get().status, marking.get().status, f.store.signals.dirtyCount.get()]);
    expect(derived.get()).toEqual(['dirty', 'dirty', 2]);

    f.store.discardAll();
    expect(derived.get()).toEqual(['unbound', 'unbound', 0]);
    expect(f.store.signals.dirtyDrafts.get()).toEqual([]);
    f.store.sync('measure', f.context('m2'));
    expect(f.store.select('measure')).toBe(measure);
    expect(derived.get()).toEqual(['clean', 'unbound', 0]);
    expect(measure.get().targetId).toBe('m2');
  });
});

describe('field patches and relevant dependencies', () => {
  it('merges untouched fields from current accepted data and ignores unrelated revisions', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Open, then cue' });
    f.targets.get('m1')!.values.pickup = true;
    f.targets.get('m1')!.values.recipients = ['s2'];
    f.targets.get('m2')!.values.meter = '7/8';
    f.revision = 999;
    const resolved = f.store.resolve('measure', f.context('m2'));
    expect(resolved).toEqual({
      ok: true, documentId: 'opened-1', targetId: 'm1', label: 'Measure 1', revision: 999,
      patch: { text: 'Open, then cue' },
      values: { text: 'Open, then cue', meter: '4/4', pickup: true, recipients: ['s2'] },
      dirtyFields: ['text'], changed: true,
    });
  });

  it('refreshes untouched fields while displaying retained raw invalid input', () => {
    const f = fixture();
    f.store.patch('measure', { meter: '7/' });
    f.targets.get('m1')!.values.text = 'Accepted direction';
    const view = f.store.sync('measure', f.context('m2'));
    expect(view.values).toEqual({ text: 'Accepted direction', meter: '7/', pickup: false, recipients: ['s1'] });
    expect(view.current!.meter).toBe('4/4');
    expect(view.status).toBe('dirty');
  });

  it('reports an edited-field conflict with its original, accepted, and intended values', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'My cue' });
    f.targets.get('m1')!.values.text = 'Another accepted cue';
    const resolved = f.store.resolve('measure', f.context());
    expect(resolved).toMatchObject({ ok: false, status: 'conflict', conflicts: [{
      field: 'text', reason: 'value', base: 'Freely', current: 'Another accepted cue', draft: 'My cue',
    }] });
    expect(f.store.snapshot('measure')).toMatchObject({ values: { text: 'My cue' }, dirty: true, canApply: false });
  });

  it('blocks changed shared context for each intended field without losing values', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'My cue', meter: '3/4' });
    f.targets.get('m1')!.context = { staffId: 's2' };
    const view = f.store.sync('measure', f.context('m2'));
    expect(view.status).toBe('conflict');
    expect(view.conflicts.map(conflict => [conflict.field, conflict.reason])).toEqual([
      ['text', 'context'], ['meter', 'context'],
    ]);
    expect(view.values).toMatchObject({ text: 'My cue', meter: '3/4' });
  });

  it('checks dependencies only for dirty fields', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'On cue' });
    f.targets.get('m1')!.dependencies!.meter = { writtenTime: '3/4' };
    expect(f.store.sync('measure', f.context()).status).toBe('dirty');
    f.targets.get('m1')!.dependencies!.text = { onset: '1/4' };
    expect(f.store.resolve('measure', f.context())).toMatchObject({
      ok: false, status: 'conflict', conflicts: [{ field: 'text', reason: 'dependency', base: { onset: '0/1' }, current: { onset: '1/4' } }],
    });
  });

  it('captures each field baseline when that field first becomes dirty', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Cue one' });
    f.targets.get('m1')!.values.meter = '3/4';
    f.targets.get('m1')!.dependencies!.meter = { writtenTime: '3/4' };
    f.store.sync('measure', f.context());
    f.store.patch('measure', { meter: '5/4' });
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: true, patch: { text: 'Cue one', meter: '5/4' } });
    f.targets.get('m1')!.values.meter = '6/4';
    const view = f.store.sync('measure', f.context());
    expect(view.conflicts).toMatchObject([{ field: 'meter', reason: 'value', base: '3/4', current: '6/4', draft: '5/4' }]);
  });

  it('does not rebase an already dirty field merely because its input changes again', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'First intent' });
    f.targets.get('m1')!.values.text = 'Accepted elsewhere';
    f.store.sync('measure', f.context());
    const view = f.store.patch('measure', { text: 'Second intent' });
    expect(view.conflicts).toMatchObject([{ base: 'Freely', current: 'Accepted elsewhere', draft: 'Second intent' }]);
  });

  it('reverting to the current accepted value clears only that dirty field', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Draft text', pickup: true });
    f.store.patch('measure', { text: 'Freely' });
    expect(f.store.snapshot('measure').dirtyFields).toEqual(['pickup']);
    f.store.patch('measure', { pickup: false });
    expect(f.store.snapshot('measure').status).toBe('clean');
    expect(f.store.dirtyCount).toBe(0);
  });

  it('typing the old baseline does not discard an intended reversal of a new accepted value', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Draft text' });
    f.targets.get('m1')!.values.text = 'New accepted text';
    f.store.sync('measure', f.context());
    const view = f.store.patch('measure', { text: 'Freely' });
    expect(view).toMatchObject({ status: 'conflict', dirty: true, values: { text: 'Freely' } });
    expect(view.conflicts[0].base).toBe('Freely');
  });

  it('recognizes an already accepted intent without requiring another Apply or history entry', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Accepted together' });
    f.targets.get('m1')!.values.text = 'Accepted together';
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: true, changed: false, patch: {}, dirtyFields: [] });
    expect(f.store.dirtyCount).toBe(0);
  });

  it('clears satisfied fields independently while keeping other intended changes', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Accepted together', pickup: true });
    f.targets.get('m1')!.values.text = 'Accepted together';
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: true, changed: true, patch: { pickup: true }, dirtyFields: ['pickup'] });
  });

  it('does not jump to the selected target during a successful own-action refresh', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Accepted together' });
    f.targets.get('m1')!.values.text = 'Accepted together';
    expect(f.store.sync('measure', f.context('m2'))).toMatchObject({ targetId: 'm1', status: 'clean' });
    f.store.commit('measure', f.targets.get('m1')!);
    expect(f.store.sync('measure', f.context('m2')).targetId).toBe('m2');
  });

  it('compares object dependencies structurally without depending on property order', () => {
    const f = fixture();
    f.targets.get('m1')!.context = { staff: 's1', measure: 'm1', position: [0, 1] };
    f.store.sync('measure', f.context());
    f.store.patch('measure', { text: 'Wait for cue' });
    f.targets.get('m1')!.context = { position: [0, 1], measure: 'm1', staff: 's1' };
    expect(f.store.resolve('measure', f.context()).ok).toBe(true);
    f.targets.get('m1')!.context = { staff: 's1', measure: 'm1', position: [1, 0] };
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: false, status: 'conflict' });
  });

  it('supports an explicit undefined patch for an optional field', () => {
    const store = new DraftStore<{ page: { maxMeasures?: string; paper: string } }>();
    const value: DraftTarget<{ maxMeasures?: string; paper: string }> = {
      documentId: 'doc', id: 'score', label: 'Full score pages', values: { maxMeasures: '4', paper: 'letter' },
    };
    const context = { documentId: 'doc', revision: 0, selected: value, read: () => value };
    store.sync('page', context);
    store.patch('page', { maxMeasures: undefined });
    const resolved = store.resolve('page', context);
    expect(resolved).toMatchObject({ ok: true, patch: { maxMeasures: undefined }, values: { paper: 'letter' } });
    if (resolved.ok) expect(Object.hasOwn(resolved.patch, 'maxMeasures')).toBe(true);
  });
});

describe('deleted targets and opened-document identity', () => {
  it('keeps a deleted target draft visible and never applies it to the current selection', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Original intent' });
    f.targets.delete('m1');
    const view = f.store.sync('measure', f.context('m2'));
    expect(view).toMatchObject({ targetId: 'm1', status: 'missing', values: { text: 'Original intent' }, canApply: false, dirty: true });
    expect(f.store.resolve('measure', f.context('m2'))).toMatchObject({ ok: false, status: 'missing' });
    expect(f.store.dirtyCount).toBe(1);
    expect(f.store.dirtyDrafts[0].status).toBe('missing');
  });

  it('checks deletion again at Apply even if no intervening sync occurred', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Waiting' });
    f.targets.delete('m1');
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: false, status: 'missing' });
  });

  it('can revalidate the same restored target without losing the retained draft', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Retained through undo' });
    f.targets.delete('m1');
    f.store.sync('measure', f.context('m2'));
    f.targets.set('m1', target());
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: true, patch: { text: 'Retained through undo' } });
  });

  it.each(['sync', 'resolve', 'review'] as const)('blocks document ID reuse during %s before reading the replacement document', method => {
    const f = fixture();
    f.store.patch('measure', { text: 'Old document intent' });
    f.documentId = 'opened-2';
    f.targets.set('m1', target('m1', { text: 'Another chart' }, 'opened-2'));
    const read = vi.fn((id: string) => f.targets.get(id) ?? null);
    const context = { ...f.context(), read };
    const result = f.store[method]('measure', context);
    expect(result).toMatchObject({ status: 'document-changed' });
    expect(read).not.toHaveBeenCalled();
    expect(f.store.snapshot('measure')).toMatchObject({ documentId: 'opened-1', targetId: 'm1', values: { text: 'Old document intent' } });
  });

  it('allows a clean form to follow a new document without a warning', () => {
    const f = fixture();
    f.documentId = 'opened-2';
    f.targets.set('m1', target('m1', { text: 'New chart' }, 'opened-2'));
    expect(f.store.sync('measure', f.context())).toMatchObject({ documentId: 'opened-2', values: { text: 'New chart' }, status: 'clean' });
  });

  it('requires exact document and target identities from the read callback', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Named target' });
    expect(f.store.resolve('measure', { ...f.context(), read: () => target('m2') })).toMatchObject({ ok: false, status: 'missing' });
    expect(f.store.resolve('measure', { ...f.context(), read: () => target('m1', {}, 'another-document') })).toMatchObject({
      ok: false, status: 'document-changed',
    });
    expect(f.store.snapshot('measure').targetId).toBe('m1');
  });

  it('never clears draft fields just because a different document happens to contain their value', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Same words' });
    f.documentId = 'opened-2';
    f.targets.set('m1', target('m1', { text: 'Same words' }, 'opened-2'));
    f.store.sync('measure', f.context());
    expect(f.store.snapshot('measure')).toMatchObject({ status: 'document-changed', dirty: true, dirtyFields: ['text'] });
  });
});

describe('explicit review, commit, discard, and local validation errors', () => {
  it('review acknowledges current relevant facts without applying the dirty fields', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'My intended cue' });
    f.targets.get('m1')!.values.text = 'New accepted cue';
    f.targets.get('m1')!.dependencies!.text = { onset: '1/4' };
    expect(f.store.resolve('measure', f.context()).ok).toBe(false);
    const view = f.store.review('measure', f.context());
    expect(view).toMatchObject({ status: 'dirty', values: { text: 'My intended cue' }, current: { text: 'New accepted cue' }, conflicts: [] });
    expect(f.targets.get('m1')!.values.text).toBe('New accepted cue');
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: true, patch: { text: 'My intended cue' } });
  });

  it('revalidates a reviewed draft at Apply and blocks subsequent relevant changes', () => {
    const f = fixture();
    f.store.patch('measure', { meter: '3/4' });
    f.targets.get('m1')!.dependencies!.meter = { writtenTime: '1/2' };
    f.store.review('measure', f.context());
    f.targets.get('m1')!.dependencies!.meter = { writtenTime: '1/4' };
    expect(f.store.resolve('measure', f.context())).toMatchObject({ ok: false, status: 'conflict' });
  });

  it('review cannot acknowledge deletion into a valid target', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Lost target' });
    f.targets.delete('m1');
    expect(f.store.review('measure', f.context('m2'))).toMatchObject({ status: 'missing', canApply: false, dirty: true });
  });

  it('commits accepted canonical values only after the caller succeeds', () => {
    const f = fixture();
    f.store.patch('measure', { text: '  Trimmed text  ' });
    f.targets.get('m1')!.values.text = 'Trimmed text';
    const view = f.store.commit('measure', f.targets.get('m1')!);
    expect(view).toMatchObject({ values: { text: 'Trimmed text' }, status: 'clean', dirty: false, conflicts: [], error: null });
    expect(f.store.dirtyCount).toBe(0);
  });

  it.each([target('m2'), target('m1', {}, 'opened-2')])('rejects a commit for another target without clearing the draft', accepted => {
    const f = fixture();
    f.store.patch('measure', { text: 'Keep me' });
    const before = f.store.snapshot('measure');
    expect(() => f.store.commit('measure', accepted)).toThrow(/does not match/);
    expect(f.store.snapshot('measure')).toEqual(before);
  });

  it('explicit discard rebinds a dirty form without changing any other form', () => {
    const f = fixture();
    f.store.sync('marking', f.context('m2'));
    f.store.patch('marking', { text: 'Keep this draft' });
    f.store.patch('measure', { meter: '7/8' });
    expect(f.store.discard('measure', f.targets.get('m2')!)).toMatchObject({ targetId: 'm2', status: 'clean', matchesSelection: true });
    expect(f.store.snapshot('marking').values!.text).toBe('Keep this draft');
    expect(f.store.dirtyCount).toBe(1);
    expect(f.store.discard('marking', null).status).toBe('unbound');
  });

  it('supports deliberate rebind after a new synthetic target creates a real annotation', () => {
    const f = fixture();
    f.store.discard('marking', target('new:m1'));
    f.store.patch('marking', { text: 'B♭13' });
    const created = target('annotation-7', { text: 'B♭13' });
    expect(f.store.discard('marking', created)).toMatchObject({ targetId: 'annotation-7', values: { text: 'B♭13' }, status: 'clean' });
  });

  it('retains a local source validation error and raw draft through unrelated refreshes', () => {
    const f = fixture();
    f.store.patch('measure', { meter: '7/' });
    f.store.fail('measure', 'Finish the meter denominator.');
    f.targets.get('m1')!.values.text = 'Unrelated accepted cue';
    f.revision++;
    const view = f.store.sync('measure', f.context('m2'));
    expect(view).toMatchObject({ values: { meter: '7/' }, error: 'Finish the meter denominator.', message: 'Finish the meter denominator.', dirty: true });
    expect(f.store.resolve('measure', f.context()).ok).toBe(true);
    expect(f.store.patch('measure', { meter: '7/8' }).error).toBeNull();
  });

  it('clears local errors after explicit review, discard, or successful commit', () => {
    const f = fixture();
    for (const action of ['review', 'discard', 'commit'] as const) {
      f.store.patch('measure', { text: 'Edited' });
      f.store.fail('measure', 'A local error');
      const view = action === 'review' ? f.store.review('measure', f.context())
        : f.store[action]('measure', f.targets.get('m1')!);
      expect(view.error).toBeNull();
    }
  });

  it('only explicit discardAll removes all session drafts', () => {
    const f = fixture();
    f.store.sync('marking', f.context('m2'));
    f.store.patch('measure', { text: 'One' });
    f.store.patch('marking', { text: 'Two' });
    f.store.discardAll();
    expect(f.store.dirtyCount).toBe(0);
    expect(f.store.dirtyDrafts).toEqual([]);
    expect(f.store.snapshot('measure').status).toBe('unbound');
    expect(f.store.snapshot('marking').status).toBe('unbound');
  });
});

describe('safe snapshots and atomic failures', () => {
  it('does not let accepted snapshots, input patches, or returned views mutate draft state', () => {
    const f = fixture();
    const recipients = ['s1', 's2'];
    f.store.patch('measure', { recipients });
    recipients.push('outside');
    const view = f.store.snapshot('measure');
    view.values!.recipients.push('view mutation');
    view.current!.recipients.push('current mutation');
    expect(f.store.snapshot('measure').values!.recipients).toEqual(['s1', 's2']);
    expect(f.store.snapshot('measure').current!.recipients).toEqual(['s1']);
    f.targets.get('m1')!.values.recipients.push('accepted external update');
    expect(f.store.snapshot('measure').current!.recipients).toEqual(['s1']);
    f.store.sync('measure', f.context());
    expect(f.store.snapshot('measure').status).toBe('conflict');
  });

  it('returns independent arrays and dependency snapshots from resolutions and summaries', () => {
    const f = fixture();
    f.store.patch('measure', { recipients: ['s2'] });
    const resolved = f.store.resolve('measure', f.context());
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      resolved.patch.recipients!.push('patch mutation');
      resolved.values.recipients.push('merged mutation');
      (resolved.dirtyFields as string[]).push('text');
    }
    const summaries = f.store.dirtyDrafts;
    (summaries[0].dirtyFields as string[]).push('text');
    expect(f.store.snapshot('measure').dirtyFields).toEqual(['recipients']);
    expect(f.store.snapshot('measure').values!.recipients).toEqual(['s2']);
    f.targets.get('m1')!.dependencies!.recipients = { available: ['s1'] };
    const view = f.store.sync('measure', f.context());
    (view.conflicts[0].base as { available: string[] }).available.push('conflict mutation');
    expect(f.store.snapshot('measure').conflicts[0].base).toEqual({ available: ['s1', 's2'] });
  });

  it('handles special property names as data without prototype mutation', () => {
    const store = new DraftStore();
    const values = Object.fromEntries([['__proto__', 'old'], ['constructor', 'old constructor']]);
    const value = { documentId: 'doc', id: '__proto__', label: 'Direction', values };
    const context = { documentId: 'doc', revision: 0, selected: value, read: () => value };
    store.sync('__proto__', context);
    store.patch('__proto__', Object.fromEntries([['__proto__', 'new'], ['constructor', 'new constructor']]));
    const resolved = store.resolve('__proto__', context);
    expect(resolved).toMatchObject({ ok: true, changed: true });
    if (resolved.ok) {
      expect(Object.getOwnPropertyDescriptor(resolved.patch, '__proto__')!.value).toBe('new');
      expect(Object.getPrototypeOf(resolved.patch)).toBe(Object.prototype);
      expect(resolved.patch.constructor).toBe('new constructor');
    }
    expect(store.dirtyCount).toBe(1);
  });

  it('rejects accessors without invoking them or replacing the accepted draft', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Keep safe' });
    const before = f.store.snapshot('measure');
    let reads = 0;
    const patch: Partial<Fields> = {};
    Object.defineProperty(patch, 'text', { enumerable: true, get: () => { reads++; return 'No'; } });
    expect(() => f.store.patch('measure', patch)).toThrow(/accessors/);
    const accepted = target();
    Object.defineProperty(accepted, 'context', { enumerable: true, get: () => { reads++; return {}; } });
    expect(() => f.store.sync('measure', { ...f.context(), selected: accepted })).toThrow(/accessors/);
    expect(reads).toBe(0);
    expect(f.store.snapshot('measure')).toEqual(before);
  });

  it.each([
    new Date(), new Map(), () => 'not data', Symbol('not data'), Object.create({ inherited: true }),
  ])('rejects unsupported dependency data atomically', context => {
    const f = fixture();
    f.store.patch('measure', { text: 'Keep safe' });
    const before = f.store.snapshot('measure');
    const accepted = target();
    accepted.context = context;
    expect(() => f.store.resolve('measure', { ...f.context(), read: () => accepted })).toThrow();
    expect(f.store.snapshot('measure')).toEqual(before);
  });

  it('rejects cyclic data while allowing repeated independent references', () => {
    const f = fixture();
    const shared = { available: ['s1', 's2'] };
    f.targets.get('m1')!.context = { first: shared, second: shared };
    expect(() => f.store.sync('measure', f.context())).not.toThrow();
    const cycle: { next?: unknown } = {};
    cycle.next = cycle;
    f.targets.get('m1')!.context = cycle;
    const before = f.store.snapshot('measure');
    expect(() => f.store.sync('measure', f.context())).toThrow(/cycles/);
    expect(f.store.snapshot('measure')).toEqual(before);
  });

  it('leaves a draft intact when resolving current source throws', () => {
    const f = fixture();
    f.store.patch('measure', { text: 'Keep safe' });
    const before = f.store.snapshot('measure');
    const context = { ...f.context('m2'), revision: 10, read: () => { throw new Error('Reader unavailable'); } };
    expect(() => f.store.sync('measure', context)).toThrow('Reader unavailable');
    expect(() => f.store.resolve('measure', context)).toThrow('Reader unavailable');
    expect(() => f.store.review('measure', context)).toThrow('Reader unavailable');
    expect(f.store.snapshot('measure')).toEqual(before);
  });

  it('rejects invalid identity and revision input before changing state', () => {
    const f = fixture();
    const before = f.store.snapshot('measure');
    expect(() => f.store.sync('measure', { ...f.context(), documentId: 'other' })).toThrow(/another document/);
    expect(() => f.store.sync('measure', { ...f.context(), revision: -1 })).toThrow(/revision/);
    expect(() => f.store.sync('measure', { ...f.context(), selected: { ...target(), label: '' } })).toThrow(/label/);
    expect(f.store.snapshot('measure')).toEqual(before);
  });
});

describe('drafts alongside actual musical transactions', () => {
  interface EventFields { duration: string; dots: string; pitch: string }
  const html = `<music-staff id="staff" clef="treble"><music-measure id="m1"><music-note id="n1" pitch="C4" duration="whole"></music-note></music-measure><music-measure id="m2"><music-note id="n2" pitch="D4" duration="whole"></music-note></music-measure></music-staff>`;
  function integration() {
    const session = new EditorSession(createProject(html, 'Draft test'));
    const store = new DraftStore<{ event: EventFields }>();
    const documentId = 'opened-document-instance-1';
    const read = (id: string): DraftTarget<EventFields> | null => {
      const element = session.source.querySelector(`#${id}`);
      if (!element) return null;
      return {
        documentId, id, label: 'Note in measure 1',
        values: { duration: element.getAttribute('duration') ?? 'quarter', dots: element.getAttribute('dots') ?? '0', pitch: element.getAttribute('pitch')! },
        context: { measureId: element.parentElement!.id },
        dependencies: { duration: { meter: '4/4' }, pitch: { ties: element.getAttribute('tie') } },
      };
    };
    const context = (): DraftContext<EventFields> => ({ documentId, revision: session.revision, read });
    store.sync('event', { ...context(), selected: read('n1') });
    return { session, store, read, context };
  }

  it('does not touch source, revisions, recovery, undo, or redo while editing and reviewing forms', () => {
    const f = integration();
    f.session.execute({ type: 'set-note-pitch', eventId: 'n2', pitch: 'E4', ties: 'reject' });
    f.session.undo();
    const revision = f.session.revision;
    const project = f.session.project;
    const undo = f.session.canUndo;
    const redo = f.session.canRedo;
    f.store.patch('event', { pitch: 'F#4' });
    f.store.sync('event', { ...f.context(), selected: f.read('n2') });
    f.store.resolve('event', f.context());
    f.store.review('event', f.context());
    expect(f.session.project).toEqual(project);
    expect(f.session.revision).toBe(revision);
    expect(f.session.canUndo).toBe(undo);
    expect(f.session.canRedo).toBe(redo);
    expect(f.session.canRedo).toBe(true);
  });

  it('applies only the dirty field after unrelated music and metadata changes', () => {
    const f = integration();
    f.store.patch('event', { pitch: 'F#4' });
    f.session.execute({ type: 'set-note-pitch', eventId: 'n2', pitch: 'G4', ties: 'reject' });
    f.session.update('Chart title', draft => { draft.metadata.title = 'A new title'; });
    const resolved = f.store.resolve('event', f.context());
    expect(resolved).toMatchObject({ ok: true, patch: { pitch: 'F#4' } });
    if (!resolved.ok) throw new Error('Expected a valid pitch draft');
    const revision = f.session.revision;
    f.session.execute({ type: 'set-note-pitch', eventId: resolved.targetId, pitch: resolved.values.pitch, ties: 'reject' });
    f.store.commit('event', f.read('n1')!);
    expect(f.session.revision).toBe(revision + 1);
    expect(f.session.source.querySelector('#n1')!.getAttribute('pitch')).toBe('F#4');
    expect(f.session.source.querySelector('#n2')!.getAttribute('pitch')).toBe('G4');
    expect(f.session.project.metadata.title).toBe('A new title');
    expect(f.store.dirtyCount).toBe(0);
    f.session.undo();
    expect(f.session.source.querySelector('#n1')!.getAttribute('pitch')).toBe('C4');
    expect(f.session.source.querySelector('#n2')!.getAttribute('pitch')).toBe('G4');
    expect(f.session.project.metadata.title).toBe('A new title');
  });

  it('keeps the complete source and draft when whole-score musical validation rejects Apply', () => {
    const f = integration();
    f.store.patch('event', { duration: 'breve' });
    const before = f.session.project;
    const resolved = f.store.resolve('event', f.context());
    if (!resolved.ok) throw new Error('The field patch itself should resolve');
    try {
      f.session.execute({ type: 'set-event-rhythm', eventId: resolved.targetId, duration: 'breve', dots: Number(resolved.values.dots) });
      throw new Error('Expected the whole-score validator to reject overflow');
    } catch (error) {
      f.store.fail('event', (error as Error).message);
    }
    expect(f.session.project).toEqual(before);
    expect(f.session.revision).toBe(0);
    expect(f.session.canUndo).toBe(false);
    expect(f.store.snapshot('event')).toMatchObject({ dirty: true, values: { duration: 'breve' }, current: { duration: 'whole' } });
    expect(f.store.snapshot('event').error).toBeTruthy();
  });
});
