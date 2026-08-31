// @vitest-environment happy-dom
/**
 * Actual Author shell, public writing controls, EditorSession and RecoveryStore.
 * Engraving and the browser download boundary are doubled; timers are controlled.
 * These are simulated-runtime state/route checks, not native pixels, Web Locks,
 * picker/popover behavior, physical input, or proof of a downloaded file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject, importProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { RecoveryStorage } from '../src/authoring/storage.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = '<music-staff id="lead" label="Lead"><music-measure id="bar" meter="4/4" incomplete><music-voice id="voice"></music-voice></music-measure></music-staff>';
type FailureKind = 'write-failure' | 'no-locks' | 'lock-rejection' | 'conflict' | 'invalid-recovered';
let app: AuthorWorkspace | undefined;
let sequence = 0;
const downloads: Blob[] = [];

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing actual Author control #${id}.`);
  return value as T;
}
function available(element: HTMLElement): boolean {
  return !element.closest('[hidden],[inert],[aria-hidden="true"]') && !element.matches(':disabled');
}
async function flush(): Promise<void> { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function click(id: string): Promise<void> {
  const button = el(id); expect(available(button), `#${id} is reachable`).toBe(true);
  button.focus({ preventScroll: true }); button.click(); await flush();
}
async function key(value: string): Promise<void> {
  expect(document.activeElement).toBe(el('score-editor'));
  el('score-editor').dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true }));
  await flush();
}
async function startQuarterWriting(): Promise<void> {
  const before = state();
  await click('toggle-entry'); await click('entry-value-trigger');
  // Happy DOM does not establish the native customizable select's initial
  // selection faithfully. Configure this fixture through actual visible fields.
  for (const [id, value] of [['event-duration', 'quarter'], ['event-dots', '0']] as const) {
    const field = el<HTMLSelectElement>(id); expect(available(field)).toBe(true);
    expect([...field.options].some(option => option.value === value && !option.disabled)).toBe(true);
    field.focus({ preventScroll: true }); field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); await flush();
  }
  await click('close-entry-value'); await click('toggle-entry');
  expect(el<HTMLSelectElement>('event-duration').value).toBe('quarter'); expect(el<HTMLSelectElement>('event-dots').value).toBe('0');
  expect(app!.session.project).toEqual(before.project); expect(app!.session.revision).toBe(before.revision);
  expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(before.redo);
  expect(document.activeElement).toBe(el('score-editor')); expect(document.body.dataset.entryMode).toBe('true');
}
async function select(id: string): Promise<void> {
  const sourceElement = app!.session.source.querySelector(`[id="${id}"]`);
  expect(sourceElement).not.toBeNull();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } })); await flush();
}
/** A state/lifecycle boundary double only; native top-layer pixels and delivery are not simulated. */
function nativeValueChooser() {
  const panel = el('selection-value-chooser');
  let open = false;
  const matches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : matches(selector));
  const lifecycle = (type: 'beforetoggle' | 'toggle', next: 'open' | 'closed') => {
    const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && next === 'open' });
    Object.defineProperties(event, { newState: { value: next }, oldState: { value: next === 'open' ? 'closed' : 'open' }, source: { value: el('selection-value') } });
    panel.dispatchEvent(event); return event;
  };
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: () => {
      if (open || lifecycle('beforetoggle', 'open').defaultPrevented) return;
      open = true; lifecycle('toggle', 'open');
    } },
    hidePopover: { configurable: true, value: () => {
      if (!open) return;
      lifecycle('beforetoggle', 'closed'); open = false; lifecycle('toggle', 'closed');
    } },
  });
  // Positioner requires an admitted invoker. These rectangles are fixture input,
  // not evidence that the chooser fits a real desktop or phone.
  vi.spyOn(el('selection-value'), 'getBoundingClientRect').mockReturnValue(new DOMRect(180, 500, 80, 44));
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(180, 240, 300, 250));
  return { isOpen: () => open, closeBeforeToggleDelivery: () => { open = false; } };
}
function state() {
  return { project: structuredClone(app!.session.project), revision: app!.session.revision,
    undo: app!.session.canUndo, redo: app!.session.canRedo, cursor: app!.session.cursor,
    selection: app!.session.selection,
    recipe: ['event-kind', 'event-pitch', 'event-duration', 'event-dots', 'insert-position'].map(id => el<HTMLInputElement>(id).value) };
}
function layoutOwners() {
  return { main: [...document.querySelector('main.author-workspace')!.children],
    dock: [...el('workspace-dock').children], header: el('workspace-feedback-label').parentElement };
}
function sameOwners(before: ReturnType<typeof layoutOwners>): void {
  expect([...document.querySelector('main.author-workspace')!.children]).toEqual(before.main);
  expect([...el('workspace-dock').children]).toEqual(before.dock);
  expect(el('workspace-feedback-label').parentElement).toBe(before.header);
  expect(el('workspace-feedback-label').parentElement).toBe(el('save-status').parentElement);
  expect(el('workspace-notices').closest('#workspace-review')).toBe(el('workspace-review'));
}
function recoveryFixture(kind: FailureKind) {
  const keyName = `writing-recovery-${++sequence}`;
  const records = new Map<string, string>();
  let rejectWrite = kind === 'write-failure';
  const storage: RecoveryStorage = {
    getItem: name => records.get(name) ?? null,
    setItem: (name, value) => { if (rejectWrite) throw new Error('Fixture quota exhausted'); records.set(name, value); },
    removeItem: name => { records.delete(name); },
  };
  if (kind === 'invalid-recovered') records.set(keyName, '{corrupt recovery kept for review');
  const locks = kind === 'no-locks' ? null : {
    request: async <T>(_name: string, callback: () => T | PromiseLike<T>): Promise<T> => {
      if (kind === 'lock-rejection') throw new Error('Fixture coordination denied');
      return callback();
    },
  };
  const store = new RecoveryStore({ key: keyName, writerId: 'current-tab', storage, locks });
  const saving = vi.spyOn(store, 'saveCoordinated');
  app = new AuthorWorkspace({ project: createProject(source, 'Recovery visibility'), recovery: store });
  if (kind === 'conflict') {
    const other = new RecoveryStore({ key: keyName, writerId: 'other-tab', storage, locks });
    expect(other.save(createProject(source, 'Other writer, never overwrite')).status).toBe('saved');
  }
  const protectedRaw = records.get(keyName);
  return { store, saving, records, keyName, protectedRaw, allowWrites: () => { rejectWrite = false; } };
}
function visibleRecovery(cause: RegExp): void {
  const feedback = el('workspace-feedback-label');
  expect(available(feedback), 'Recovery remains in the compact visible status').toBe(true);
  expect(feedback.textContent).toMatch(/recover|sav|storage|coordinat/i);
  expect(feedback.textContent).toMatch(/unavailable|failed|not saved|cannot|could not|changed|invalid|blocked|conflict/i);
  expect(feedback.getAttribute('aria-live')).toBe('polite');
  expect(available(el('workspace-review-trigger'))).toBe(true);
  expect(el('workspace-recovery-detail').textContent).toMatch(cause);
  expect(el('workspace-recovery-detail').textContent).toMatch(/download|backup/i);
}
async function inspectRecovery(cause: RegExp): Promise<void> {
  const before = state(); await click('workspace-review-trigger');
  expect(el('workspace-review').hidden).toBe(false);
  expect(available(el('workspace-recovery-detail'))).toBe(true);
  expect(el('workspace-recovery-detail').textContent).toMatch(cause);
  expect(available(el('review-download-project'))).toBe(true);
  expect(el('review-download-project').textContent).toMatch(/download.*project/i);
  expect(state()).toEqual(before);
  await click('close-workspace-review'); expect(state()).toEqual(before);
}

beforeEach(() => {
  vi.useFakeTimers(); downloads.length = 0;
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloads.push(blob as Blob); return `blob:writing-recovery-${downloads.length}`; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('WRITING-ANNOUNCEMENT-OWNER with explicit popover-state doubles', () => {
  it.each(['native', 'fallback'] as const)('a closed %s chooser cannot silence the shared announcement or block ordinary score input', async mode => {
    const panel = el('selection-value-chooser');
    const native = mode === 'native' ? nativeValueChooser() : undefined;
    recoveryFixture('write-failure'); await startQuarterWriting(); await key('Enter'); await key('Enter');
    await click('select-mode'); const first = app!.session.score.staves[0].measures[0].voices[0].events[0].id;
    await select(first); const accepted = state(); await click('selection-value');
    // Happy DOM has no UA declarative popover activation. Supply only that
    // boundary after the real invoker has passed its production guards.
    if (native) { panel.showPopover(); await flush(); expect(native.isOpen()).toBe(true); }
    else expect(panel.hidden).toBe(false);
    const duration = el<HTMLSelectElement>('selection-duration');
    expect(available(duration)).toBe(true); duration.focus({ preventScroll: true }); duration.value = 'whole';
    duration.dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(state()).toEqual(accepted); expect(duration.value).toBe('quarter');
    const local = el('selection-value-error');
    expect(local.hidden).toBe(false); expect(local.textContent?.trim()).not.toBe(''); expect(local.getAttribute('role')).toBe('alert');
    expect(el('workspace-feedback-label').getAttribute('aria-live')).toBe('off');

    // Even an artificially focused score must not receive Enter through an
    // actually open chooser. This is input ownership, not native focus coverage.
    el('score-editor').focus({ preventScroll: true });
    const blocked = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
    el('score-editor').dispatchEvent(blocked); await flush();
    expect(blocked.defaultPrevented).toBe(false); expect(state()).toEqual(accepted);
    expect(el('workspace-tools').hidden).toBe(true);

    if (native) {
      // Keep the old data attribute until the later toggle notification. The
      // queried native closed state must be authoritative immediately.
      native.closeBeforeToggleDelivery(); expect(panel.hidden).toBe(false); expect(panel.dataset.surfaceState).toBe('open');
    } else { await click('close-selection-value'); expect(panel.hidden).toBe(true); }
    await click('select-mode');
    expect(state()).toEqual(accepted);
    // A completed fallback close clears the local alert and retains Review.
    // The native boundary above deliberately withholds that close notification.
    expect(local.hidden).toBe(mode === 'fallback');
    expect(el('workspace-feedback-label').getAttribute('aria-live')).toBe('polite');
    expect(el('workspace-feedback-label').textContent?.trim()).not.toBe('');
    if (native) expect(panel.dataset.surfaceState).toBe('open');
    expect(document.activeElement).toBe(el('score-editor'));
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
    el('score-editor').dispatchEvent(right); await flush();
    expect(right.defaultPrevented).toBe(true);
    expect(app!.session.selectionId).toBe(app!.session.score.staves[0].measures[0].voices[0].events[1].id);
    expect(app!.session.project).toEqual(accepted.project); expect(app!.session.revision).toBe(accepted.revision);
    expect(app!.session.canUndo).toBe(accepted.undo); expect(app!.session.canRedo).toBe(accepted.redo);
    expect(state().recipe).toEqual(accepted.recipe);
  });
});
afterEach(async () => {
  app?.dispose(); app = undefined; await flush(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('WRITING-RECOVERY-VISIBILITY through the actual workspace', () => {
  it.each([
    ['write-failure', 'unavailable', /quota exhausted/i],
    ['no-locks', 'coordination-unavailable', /Web Locks.*unavailable/i],
    ['lock-rejection', 'coordination-unavailable', /coordination denied/i],
    ['conflict', 'conflict', /another tab|another.*session/i],
    ['invalid-recovered', null, /recovery.*(could not|invalid|unavailable)|stored.*(could not|invalid)/i],
  ] as const)('%s stays visible after accepted writing, routine feedback and menu inspection', async (kind, expectedResult, cause) => {
    const h = recoveryFixture(kind), owners = layoutOwners();
    await startQuarterWriting(); expect(document.body.dataset.entryMode).toBe('true');
    await key('Enter'); expect(app!.session.revision).toBe(1);
    const accepted = state(); expect(app!.session.score.staves[0].measures[0].voices[0].events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(350); await flush();
    if (expectedResult) {
      expect(h.saving).toHaveBeenCalled();
      expect(await h.saving.mock.results.at(-1)!.value).toMatchObject({ status: expectedResult });
    } else expect(h.saving).not.toHaveBeenCalled();
    visibleRecovery(cause); expect(state()).toEqual(accepted); sameOwners(owners);
    expect(h.records.get(h.keyName)).toBe(h.protectedRaw);

    await inspectRecovery(cause); await click('toggle-entry'); await key('N');
    visibleRecovery(cause); expect(state()).toEqual(accepted);
    await click('entry-settings-trigger'); await click('close-entry-settings');
    // The unsupported native-Document menu is in-flow in this environment.
    // Its real invoker still must not erase the persistent recovery condition.
    await click('document-menu-trigger'); visibleRecovery(cause); expect(state()).toEqual(accepted);
    await click('toggle-entry'); await inspectRecovery(cause); sameOwners(owners);

    await click('toggle-entry'); await key('Enter');
    expect(app!.session.revision).toBe(2);
    expect(app!.session.score.staves[0].measures[0].voices[0].events).toHaveLength(2);
    visibleRecovery(cause); await vi.advanceTimersByTimeAsync(350); visibleRecovery(cause);
    expect(h.records.get(h.keyName)).toBe(h.protectedRaw); sameOwners(owners);
  });

  it('Review requests a current project download without pretending that failed recovery succeeded', async () => {
    const h = recoveryFixture('no-locks'); await startQuarterWriting(); await key('Enter');
    await vi.advanceTimersByTimeAsync(350); visibleRecovery(/Web Locks.*unavailable/i);
    const before = state(); await click('workspace-review-trigger'); await click('review-download-project');
    expect(downloads).toHaveLength(1);
    const requested = importProject(await downloads[0].text());
    expect(requested.sourceHtml).toBe(before.project.sourceHtml); expect(requested.pendingSource).toBe(before.project.pendingSource);
    expect(requested.parts).toEqual(before.project.parts); expect(requested.layouts).toEqual(before.project.layouts);
    expect(state()).toEqual(before); expect(h.records.has(h.keyName)).toBe(false);
    visibleRecovery(/Web Locks.*unavailable/i);
  });

  it('only a confirmed later recovery save clears its failure; unrelated routine feedback does not', async () => {
    const h = recoveryFixture('write-failure'); await startQuarterWriting(); await key('Enter');
    await vi.advanceTimersByTimeAsync(350); visibleRecovery(/quota exhausted/i);
    const before = state(); await key('N'); visibleRecovery(/quota exhausted/i); expect(state()).toEqual(before);
    h.allowWrites(); await key('Enter'); await vi.advanceTimersByTimeAsync(350); await flush();
    expect(await h.saving.mock.results.at(-1)!.value).toMatchObject({ status: 'saved' });
    expect(el('workspace-recovery-detail').hidden).toBe(true); expect(el('review-download-project').hidden).toBe(true);
    expect(el('workspace-feedback-label').textContent).not.toMatch(/quota exhausted|recovery.*failed|recovery.*unavailable/i);
    const saved = JSON.parse(h.records.get(h.keyName)!) as { project: { sourceHtml: string } };
    expect(saved.project.sourceHtml).toBe(app!.session.project.sourceHtml); expect(app!.session.revision).toBe(2);
  });
});
