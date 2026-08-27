// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeWorkbookControls } from '../src/demo/workbook-controls.js';
import { readScore } from '../src/dom/index.js';
import type { Diagnostic } from '../src/model/types.js';
import galleryHtml from '../index.html?raw';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const disposers: (() => void)[] = [];

interface ScoreState {
  completion: Promise<void>;
  diagnostics: readonly Diagnostic[];
  reads: number;
  onRead?: () => void;
}

/** Only the score readiness boundary is controlled; controls and events are real DOM. */
function scoreState(score: Element, completion = Promise.resolve()): ScoreState {
  const state: ScoreState = { completion, diagnostics: [], reads: 0 };
  Object.defineProperties(score, {
    renderComplete: { configurable: true, get: () => { state.reads++; state.onRead?.(); return state.completion; } },
    diagnostics: { configurable: true, get: () => state.diagnostics },
  });
  return state;
}

function fixture({ checked = false, disabled = false } = {}) {
  const template = document.createElement('template');
  template.innerHTML = galleryHtml;
  const root = template.content.querySelector<HTMLElement>('main')!;
  document.body.append(root);
  const preview = root.querySelector<HTMLInputElement>('#print-preview')!;
  const printButton = root.querySelector<HTMLButtonElement>('#print-scores')!;
  const status = root.querySelector<HTMLElement>('#workbook-status')!;
  const scores = [...root.querySelectorAll('[data-score]')];
  const states = scores.map(score => scoreState(score));
  const requestPrint = vi.fn<() => void>();
  preview.checked = checked;
  printButton.disabled = disabled;
  const options = { root, preview, printButton, status, requestPrint };
  const dispose = initializeWorkbookControls(options);
  disposers.push(dispose);
  return { ...options, scores, states, dispose };
}

function addScore(root: ParentNode, completion = Promise.resolve()) {
  const score = document.createElement('music-measure');
  score.setAttribute('data-score', '');
  score.innerHTML = '<music-rest measure></music-rest>';
  const state = scoreState(score, completion);
  root.append(score);
  return { score, state };
}

function changePreview(view: ReturnType<typeof fixture>, checked: boolean): void {
  view.preview.checked = checked;
  view.preview.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

describe('workbook controls', () => {
  it('applies the actual checkbox to all nine gallery scores and restores responsive layout', () => {
    const view = fixture();
    expect(view.scores).toHaveLength(9);
    expect(view.status.textContent).toContain('Responsive score layout');
    expect(view.scores.every(score => !score.hasAttribute('print-preview'))).toBe(true);
    changePreview(view, true);
    expect(view.scores.every(score => score.hasAttribute('print-preview'))).toBe(true);
    expect(view.status.textContent).toContain('configured print width');
    expect(view.status.textContent).toContain('does not show physical paper pages');
    changePreview(view, false);
    expect(view.scores.every(score => !score.hasAttribute('print-preview'))).toBe(true);
    expect(view.status.textContent).toContain('Responsive score layout');
    expect(view.requestPrint).not.toHaveBeenCalled();
  });

  it('honors a checkbox that was already checked before initialization', () => {
    const view = fixture({ checked: true });
    expect(view.scores.every(score => score.hasAttribute('print-preview'))).toBe(true);
    expect(view.status.textContent).toContain('configured print width');
  });

  it('queries the current score roots for each checkbox change', () => {
    const view = fixture({ checked: true });
    const removed = view.scores[0];
    removed.remove();
    const added = addScore(view.root).score;
    changePreview(view, false);
    expect(removed.hasAttribute('print-preview')).toBe(true);
    expect([...view.root.querySelectorAll('[data-score]')].every(score => !score.hasAttribute('print-preview'))).toBe(true);
    changePreview(view, true);
    expect(added.hasAttribute('print-preview')).toBe(true);
    expect([...view.root.querySelectorAll('[data-score]')]).toHaveLength(9);
  });

  it('waits for the ninth score and restores the button after requesting the dialog', async () => {
    const view = fixture();
    const ninth = deferred();
    view.states[8].completion = ninth.promise;
    view.printButton.click();
    expect(view.printButton.disabled).toBe(true);
    expect(view.status.textContent).toContain('Preparing scores');
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    ninth.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledExactlyOnceWith();
    expect(view.printButton.disabled).toBe(false);
    expect(view.status.textContent).toMatch(/^Print dialog requested\./);
    expect(view.status.textContent).toContain('If nothing opens');
    expect(view.status.textContent).not.toMatch(/printed|saved|dialog opened|dialog closed|cancelled/i);
  });

  it.each([false, true])('prints independently of preview=%s without changing source markup or identities', async checked => {
    const view = fixture({ checked });
    const before = view.scores.map(score => ({ html: score.outerHTML, ...readScore(score) }));
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.preview.checked).toBe(checked);
    for (const [index, score] of view.scores.entries()) {
      expect(score.outerHTML).toBe(before[index].html);
      const after = readScore(score);
      expect(after.score).toEqual(before[index].score);
      for (const [id, source] of before[index].sources) expect(after.sources.get(id), id).toBe(source);
    }
  });

  it('waits for a newer render of an early score while the ninth score is still pending', async () => {
    const view = fixture();
    const ninth = deferred();
    const edit = deferred();
    view.states[8].completion = ninth.promise;
    view.printButton.click();
    await nextTask();
    view.states[0].completion = edit.promise;
    ninth.resolve();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.states[0].reads).toBeGreaterThan(1);
    edit.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('rereads completion getters that can flush pending source edits', async () => {
    const view = fixture();
    const edit = deferred();
    view.states[0].onRead = () => {
      if (view.states[0].reads === 2) view.states[0].completion = edit.promise;
    };
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    edit.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('calls the print adapter in the same continuation as the final readiness check', async () => {
    const view = fixture();
    let nextMicrotaskRan = false;
    view.states[0].onRead = () => {
      if (view.states[0].reads === 2) queueMicrotask(() => { nextMicrotaskRan = true; });
    };
    view.requestPrint.mockImplementation(() => { expect(nextMicrotaskRan).toBe(false); });
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.status.textContent).toMatch(/^Print dialog requested\./);
    expect(nextMicrotaskRan).toBe(true);
  });

  it('awaits score roots added while another root is rendering', async () => {
    const view = fixture();
    const first = deferred();
    const added = deferred();
    view.states[0].completion = first.promise;
    view.printButton.click();
    await nextTask();
    addScore(view.root, added.promise);
    first.resolve();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    added.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('detects a replacement root even when its DOM id has not changed', async () => {
    const view = fixture();
    const old = deferred();
    const replacement = deferred();
    view.states[0].completion = old.promise;
    view.printButton.click();
    await nextTask();
    const score = view.scores[0].cloneNode(true) as Element;
    scoreState(score, replacement.promise);
    view.scores[0].replaceWith(score);
    old.resolve();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    replacement.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('rechecks reordered roots without rewriting their DOM order', async () => {
    const view = fixture();
    const first = deferred();
    view.states[0].completion = first.promise;
    view.printButton.click();
    await nextTask();
    view.scores[0].before(view.scores[1]);
    const expected = [...view.root.querySelectorAll('[data-score]')];
    first.resolve();
    await nextTask();
    expect(view.states.every(state => state.reads >= 3)).toBe(true);
    expect([...view.root.querySelectorAll('[data-score]')]).toEqual(expected);
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('does not let a removed score block the remaining workbook after its pending render settles', async () => {
    const view = fixture();
    const removed = deferred();
    view.states[0].completion = removed.promise;
    view.states[0].diagnostics = [{ severity: 'error', code: 'invalid-pitch', sourceId: 'removed', message: 'Invalid pitch' }];
    view.printButton.click();
    await nextTask();
    view.scores[0].remove();
    removed.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.status.textContent).toMatch(/^Print dialog requested\./);
  });

  it('deduplicates native and dispatched clicks while preparing, but permits a later request', async () => {
    const view = fixture();
    const first = deferred();
    view.states[0].completion = first.promise;
    view.printButton.click();
    view.printButton.click();
    view.printButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    first.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledTimes(2);
  });

  it('honors preview changes during preparation and waits for their newer rendering', async () => {
    const view = fixture();
    const first = deferred();
    const previewRender = deferred();
    view.states[0].completion = first.promise;
    view.printButton.click();
    await nextTask();
    changePreview(view, true);
    view.states.forEach(state => { state.completion = previewRender.promise; });
    expect(view.status.textContent).toContain('Preparing scores');
    first.resolve();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    previewRender.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.scores.every(score => score.hasAttribute('print-preview'))).toBe(true);
  });

  it.each(['invalid-pitch', 'invalid-layout', 'engraving-error', 'print-engraving-error'])('blocks %s on any score and allows a repaired render to retry', async code => {
    const view = fixture();
    view.states[8].diagnostics = [{ severity: 'error', code, sourceId: 'last-score', message: 'A reported notation error' }];
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.status.textContent).toContain('Printing blocked: 1 score has notation errors');
    expect(view.status.textContent).not.toContain('browser’s Print command');
    expect(view.printButton.disabled).toBe(false);
    const repaired = deferred();
    view.states[8].diagnostics = [];
    view.states[8].completion = repaired.promise;
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    repaired.resolve();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('allows explicit draft and overflow warnings but retains their notices in the request status', async () => {
    const view = fixture();
    ['incomplete-measure', 'tuplet-span', 'print-layout-overflow'].forEach((code, index) => {
      view.states[index].diagnostics = [{ severity: 'warning', code, sourceId: `score-${index}`, message: 'Review this notation notice' }];
    });
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.status.textContent).toContain('3 notation notices remain');
    expect(view.status.textContent).toContain('review the score diagnostics');
    expect(view.status.textContent).not.toMatch(/complete|validated|printed|saved/i);
  });

  it('reports rejected readiness, restores the button, and permits a later retry', async () => {
    const view = fixture();
    const failed = deferred();
    view.states[0].completion = failed.promise;
    view.printButton.click();
    failed.reject(new Error('Notation font preparation failed.'));
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.printButton.disabled).toBe(false);
    expect(view.status.textContent).toContain('Notation font preparation failed.');
    expect(view.status.textContent).not.toContain('browser’s Print command');
    view.states[0].completion = Promise.resolve();
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('reports a thrown print adapter without claiming success and restores the button', async () => {
    const view = fixture();
    view.requestPrint.mockImplementationOnce(() => { throw new Error('The host rejected the print request.'); });
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledOnce();
    expect(view.status.textContent).toContain('Could not request printing: The host rejected');
    expect(view.status.textContent).not.toContain('Print dialog requested.');
    expect(view.status.textContent).not.toContain('browser’s Print command');
    expect(view.printButton.disabled).toBe(false);
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).toHaveBeenCalledTimes(2);
    expect(view.status.textContent).toMatch(/^Print dialog requested\./);
  });

  it.each(['renderComplete', 'diagnostics'])('does not mistake a missing %s API for successful rendering', async name => {
    const view = fixture();
    Reflect.deleteProperty(view.scores[0], name);
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.status.textContent).toMatch(/^Could not request printing:/);
    expect(view.status.textContent).not.toContain('browser’s Print command');
    expect(view.printButton.disabled).toBe(false);
  });

  it.each([1, 2])('handles a completion getter throwing on read %s', async read => {
    const view = fixture();
    view.states[0].onRead = () => { if (view.states[0].reads === read) throw new Error('Cannot inspect this score.'); };
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.status.textContent).toContain('Cannot inspect this score.');
    expect(view.printButton.disabled).toBe(false);
  });

  it('does not request an empty workbook or one removed while preparation is pending', async () => {
    const view = fixture();
    const first = deferred();
    view.states[0].completion = first.promise;
    view.printButton.click();
    view.root.remove();
    first.resolve();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.status.textContent).toContain('No scores are available');
    expect(view.printButton.disabled).toBe(false);
    document.body.append(view.root);
    for (const score of view.scores) score.remove();
    view.printButton.click();
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.printButton.disabled).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('disposes listeners and cancels pending work before it later %ss', async outcome => {
    const view = fixture();
    const first = deferred();
    const idleStatus = view.status.textContent;
    view.states[0].completion = first.promise;
    view.printButton.click();
    expect(view.printButton.disabled).toBe(true);
    view.dispose();
    view.dispose();
    expect(view.printButton.disabled).toBe(false);
    expect(view.status.textContent).toBe(idleStatus);
    changePreview(view, true);
    expect(view.scores.every(score => !score.hasAttribute('print-preview'))).toBe(true);
    view.printButton.click();
    if (outcome === 'resolve') first.resolve();
    else first.reject(new Error('Old preparation failed.'));
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.status.textContent).toBe(idleStatus);
  });

  it('does not let disposed asynchronous work overwrite a replacement controller', async () => {
    const view = fixture();
    const old = deferred();
    const replacement = deferred();
    view.states[0].completion = old.promise;
    view.printButton.click();
    view.dispose();
    view.states[0].completion = replacement.promise;
    disposers.push(initializeWorkbookControls(view));
    view.printButton.click();
    old.resolve();
    await nextTask();
    expect(view.printButton.disabled).toBe(true);
    expect(view.status.textContent).toContain('Preparing scores');
    expect(view.requestPrint).not.toHaveBeenCalled();
    replacement.resolve();
    await nextTask();
    expect(view.printButton.disabled).toBe(false);
    expect(view.requestPrint).toHaveBeenCalledOnce();
  });

  it('respects an already disabled print button', async () => {
    const view = fixture({ disabled: true });
    view.printButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTask();
    expect(view.requestPrint).not.toHaveBeenCalled();
    expect(view.printButton.disabled).toBe(true);
    view.dispose();
    expect(view.printButton.disabled).toBe(true);
  });
});
