// @vitest-environment node
import { Signal } from 'signal-polyfill';
import { describe, expect, it, vi } from 'vitest';
import { WorkbookState } from '../src/demo/workbook-state.js';
import type { WorkbookScore } from '../src/demo/workbook-state.js';
import type { Diagnostic } from '../src/model/types.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

interface ScoreRendering {
  completion: Promise<void> | undefined;
  diagnostics: readonly Diagnostic[] | undefined;
  reads: number;
  onRead?: () => void;
}

/** Plain objects deliberately provide no browser or element capabilities. */
function score(completion = Promise.resolve()) {
  const rendering: ScoreRendering = { completion, diagnostics: [], reads: 0 };
  const root: WorkbookScore = {
    get renderComplete() {
      rendering.reads++;
      rendering.onRead?.();
      return rendering.completion;
    },
    get diagnostics() { return rendering.diagnostics; },
  };
  return { root, rendering };
}

function fixture(initial: { preview?: boolean; disabled?: boolean } = {}) {
  const scores = Array.from({ length: 3 }, () => score());
  const roots = scores.map(score => score.root);
  const host = {
    readScores: vi.fn(() => roots),
    applyPreview: vi.fn<(checked: boolean) => void>(),
    requestPrint: vi.fn<() => void>(),
  };
  const state = new WorkbookState(host, initial);
  return { state, host, roots, scores };
}

function diagnostic(severity: Diagnostic['severity']): Diagnostic {
  return { severity, sourceId: 'score', code: 'notation-review', message: 'Review the notation.' };
}

describe('workbook state without a browser', () => {
  it('protects its observable view from consumer mutation', () => {
    const { state } = fixture();
    const initial = state.view.get();
    expect(Object.keys(state.view)).toEqual(['get']);
    expect(Reflect.set(state.view, 'get', () => ({ preview: true }))).toBe(false);
    expect(Reflect.set(initial, 'preview', true)).toBe(false);
    expect(state.view.get().preview).toBe(false);
    state.setPreview(true);
    expect(state.view.get().preview).toBe(true);
    expect(initial.preview).toBe(false);
    expect(Object.isFrozen(state.view.get())).toBe(true);
  });

  it('applies initial preview and invalidates consumers of the readonly computed view', () => {
    const { state, host } = fixture({ preview: true, disabled: true });
    const description = new Signal.Computed(() => {
      const { preview, disabled, preparing } = state.view.get();
      return { preview, disabled, preparing };
    });
    expect(host.applyPreview).toHaveBeenCalledExactlyOnceWith(true);
    expect(description.get()).toEqual({ preview: true, disabled: true, preparing: false });
    expect(state.view.get().status).toContain('does not show physical paper pages');
    state.setPreview(false);
    state.setDisabled(false);
    expect(description.get()).toEqual({ preview: false, disabled: false, preparing: false });
    expect(host.applyPreview).toHaveBeenLastCalledWith(false);
    expect(state.view.get().status).toContain('Responsive score layout');
    expect(host.requestPrint).not.toHaveBeenCalled();
  });

  it('waits for every score and ignores duplicate requests during preparation', async () => {
    const { state, host, scores } = fixture();
    const last = deferred();
    scores.at(-1)!.rendering.completion = last.promise;
    const request = state.requestPrint();
    await state.requestPrint();
    expect(state.view.get()).toMatchObject({ preparing: true, disabled: true });
    expect(state.view.get().status).toContain('Preparing scores');
    expect(host.requestPrint).not.toHaveBeenCalled();
    last.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false, preview: false });
    expect(state.view.get().status).toMatch(/^Print dialog requested\./);
    expect(state.view.get().status).toContain('If nothing opens');
    expect(state.view.get().status).not.toMatch(/printed|saved|dialog opened|dialog closed|cancelled/i);
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledTimes(2);
  });

  it('waits for a newer render of an early score while another score is pending', async () => {
    const { state, host, scores } = fixture();
    const last = deferred();
    const edit = deferred();
    scores[2].rendering.completion = last.promise;
    const request = state.requestPrint();
    scores[0].rendering.completion = edit.promise;
    last.resolve();
    await nextTask();
    expect(host.requestPrint).not.toHaveBeenCalled();
    edit.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('rereads completion getters that can flush pending source edits', async () => {
    const { state, host, scores } = fixture();
    const edit = deferred();
    const first = scores[0].rendering;
    first.onRead = () => { if (first.reads === 2) first.completion = edit.promise; };
    const request = state.requestPrint();
    await nextTask();
    expect(host.requestPrint).not.toHaveBeenCalled();
    edit.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('requests printing in the same continuation as the final readiness check', async () => {
    const { state, host, scores } = fixture();
    let nextMicrotaskRan = false;
    const first = scores[0].rendering;
    first.onRead = () => {
      if (first.reads === 2) queueMicrotask(() => { nextMicrotaskRan = true; });
    };
    host.requestPrint.mockImplementation(() => { expect(nextMicrotaskRan).toBe(false); });
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(nextMicrotaskRan).toBe(true);
  });

  it.each(['addition', 'replacement'] as const)('waits for a root %s even when the host mutates its returned array', async operation => {
    const { state, host, roots, scores } = fixture();
    const previous = deferred();
    const replacement = deferred();
    scores[0].rendering.completion = previous.promise;
    const request = state.requestPrint();
    const added = score(replacement.promise);
    if (operation === 'addition') roots.push(added.root);
    else roots[0] = added.root;
    previous.resolve();
    await nextTask();
    expect(host.requestPrint).not.toHaveBeenCalled();
    replacement.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('rechecks changed root order and preserves the host order', async () => {
    const { state, host, roots, scores } = fixture();
    const first = deferred();
    scores[0].rendering.completion = first.promise;
    const request = state.requestPrint();
    roots.reverse();
    const expected = [...roots];
    first.resolve();
    await request;
    expect(scores.every(score => score.rendering.reads >= 3)).toBe(true);
    expect(roots).toEqual(expected);
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('does not let a removed score block the remaining workbook after settling', async () => {
    const { state, host, roots, scores } = fixture();
    const removed = deferred();
    scores[0].rendering.completion = removed.promise;
    scores[0].rendering.diagnostics = [diagnostic('error')];
    const request = state.requestPrint();
    roots.shift();
    removed.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(state.view.get().status).toMatch(/^Print dialog requested\./);
  });

  it('honors preview changes during preparation and waits for their rendering', async () => {
    const { state, host, scores } = fixture();
    const previous = deferred();
    const preview = deferred();
    scores[0].rendering.completion = previous.promise;
    host.applyPreview.mockImplementation(() => {
      for (const score of scores) score.rendering.completion = preview.promise;
    });
    const request = state.requestPrint();
    state.setPreview(true);
    expect(state.view.get()).toMatchObject({ preview: true, preparing: true });
    expect(state.view.get().status).toContain('Preparing scores');
    previous.resolve();
    await nextTask();
    expect(host.requestPrint).not.toHaveBeenCalled();
    preview.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(state.view.get().preview).toBe(true);
  });

  it.each([1, 2])('blocks %s invalid score(s), counts scores rather than errors, and allows repair', async count => {
    const { state, host, scores } = fixture();
    for (const score of scores.slice(0, count)) score.rendering.diagnostics = [diagnostic('error'), diagnostic('error')];
    await state.requestPrint();
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get().status).toContain(`Printing blocked: ${count} score${count === 1 ? ' has' : 's have'} notation errors`);
    expect(state.view.get().status).not.toContain('browser’s Print command');
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
    for (const score of scores) score.rendering.diagnostics = [];
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it.each([1, 3])('permits warnings and retains %s notation notice(s) in the status', async count => {
    const { state, host, scores } = fixture();
    scores[0].rendering.diagnostics = Array.from({ length: count }, () => diagnostic('warning'));
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(state.view.get().status).toContain(`${count} notation notice${count === 1 ? ' remains' : 's remain'}`);
    expect(state.view.get().status).toContain('review the score diagnostics');
    expect(state.view.get().status).not.toMatch(/complete|validated|printed|saved/i);
  });

  it('reports rejected readiness and permits a later retry', async () => {
    const { state, host, scores } = fixture();
    const failed = deferred();
    scores[0].rendering.completion = failed.promise;
    const request = state.requestPrint();
    failed.reject(new Error('Notation font preparation failed.'));
    await request;
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
    expect(state.view.get().status).toContain('Notation font preparation failed.');
    scores[0].rendering.completion = Promise.resolve();
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('reports a throwing print host without retaining a success status and permits retry', async () => {
    const { state, host } = fixture();
    host.requestPrint.mockImplementationOnce(() => { throw new Error('The host rejected the print request.'); });
    await state.requestPrint();
    expect(state.view.get().status).toContain('Could not request printing: The host rejected');
    expect(state.view.get().status).not.toContain('Print dialog requested.');
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledTimes(2);
    expect(state.view.get().status).toMatch(/^Print dialog requested\./);
  });

  it.each(['completion', 'diagnostics'] as const)('rejects a score with missing %s', async missing => {
    const { state, host, scores } = fixture();
    scores[0].rendering[missing] = undefined;
    await state.requestPrint();
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get().status).toMatch(/^Could not request printing:/);
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
  });

  it.each([1, 2])('handles a completion getter throwing on read %s', async read => {
    const { state, host, scores } = fixture();
    const first = scores[0].rendering;
    first.onRead = () => { if (first.reads === read) throw new Error('Cannot inspect this score.'); };
    await state.requestPrint();
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get().status).toContain('Cannot inspect this score.');
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
  });

  it.each(['before', 'during'] as const)('rejects workbooks emptied %s preparation', async when => {
    const { state, host, roots, scores } = fixture();
    const first = deferred();
    scores[0].rendering.completion = first.promise;
    if (when === 'before') roots.length = 0;
    const request = state.requestPrint();
    roots.length = 0;
    first.resolve();
    await request;
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get().status).toContain('No scores are available');
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
  });

  it('respects external disabling and keeps it separate from preparation', async () => {
    const { state, host, scores } = fixture({ disabled: true });
    await state.requestPrint();
    expect(host.readScores).not.toHaveBeenCalled();
    state.setDisabled(false);
    const first = deferred();
    scores[0].rendering.completion = first.promise;
    const request = state.requestPrint();
    state.setDisabled(false);
    expect(state.view.get().disabled).toBe(true);
    state.setDisabled(true);
    first.resolve();
    await request;
    expect(host.requestPrint).toHaveBeenCalledOnce();
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: true });
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('cancels pending work before it %ss and preserves current preview', async outcome => {
    const { state, host, scores } = fixture();
    const first = deferred();
    const previousStatus = state.view.get().status;
    scores[0].rendering.completion = first.promise;
    const request = state.requestPrint();
    state.setPreview(true);
    state.cancelPendingPrint();
    state.cancelPendingPrint();
    expect(state.view.get()).toEqual({ preview: true, preparing: false, disabled: false, status: previousStatus });
    if (outcome === 'resolve') first.resolve();
    else first.reject(new Error('Old preparation failed.'));
    await request;
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(state.view.get().status).toBe(previousStatus);
  });

  it.each(['resolve', 'reject'] as const)('does not let canceled work that %ss overwrite a newer pending request', async outcome => {
    const { state, host, scores } = fixture();
    const previous = deferred();
    const next = deferred();
    scores[0].rendering.completion = previous.promise;
    const oldRequest = state.requestPrint();
    state.cancelPendingPrint();
    scores[0].rendering.completion = next.promise;
    const newRequest = state.requestPrint();
    if (outcome === 'resolve') previous.resolve();
    else previous.reject(new Error('Old preparation failed.'));
    await oldRequest;
    expect(state.view.get()).toMatchObject({ preparing: true, disabled: true });
    expect(state.view.get().status).toContain('Preparing scores');
    expect(host.requestPrint).not.toHaveBeenCalled();
    next.resolve();
    await newRequest;
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: false });
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('preserves a newer completed request when old canceled work later fails', async () => {
    const { state, host, scores } = fixture();
    const previous = deferred();
    scores[0].rendering.completion = previous.promise;
    const oldRequest = state.requestPrint();
    state.cancelPendingPrint();
    scores[0].rendering.completion = Promise.resolve();
    await state.requestPrint();
    const completedView = state.view.get();
    previous.reject(new Error('Old preparation failed.'));
    await oldRequest;
    expect(state.view.get()).toBe(completedView);
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it('preserves an external disabled change when canceling and can be reused', async () => {
    const { state, host, scores } = fixture();
    const previous = deferred();
    scores[0].rendering.completion = previous.promise;
    const oldRequest = state.requestPrint();
    state.setDisabled(true);
    state.cancelPendingPrint();
    expect(state.view.get()).toMatchObject({ preparing: false, disabled: true });
    await state.requestPrint();
    expect(host.requestPrint).not.toHaveBeenCalled();
    state.setDisabled(false);
    previous.resolve();
    await oldRequest;
    await state.requestPrint();
    expect(host.requestPrint).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('disposes pending work before it %ss and ignores future actions', async outcome => {
    const { state, host, scores } = fixture();
    const first = deferred();
    const idleView = state.view.get();
    scores[0].rendering.completion = first.promise;
    const request = state.requestPrint();
    state.dispose();
    state.dispose();
    state.setPreview(true);
    state.setDisabled(true);
    await state.requestPrint();
    if (outcome === 'resolve') first.resolve();
    else first.reject(new Error('Disposed preparation failed.'));
    await request;
    expect(state.view.get()).toEqual(idleView);
    expect(host.applyPreview).toHaveBeenCalledExactlyOnceWith(false);
    expect(host.requestPrint).not.toHaveBeenCalled();
  });
});
