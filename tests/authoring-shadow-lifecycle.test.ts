// @vitest-environment happy-dom
/** Real controllers reuse the mounted composition; engraving and native pixels are outside this lifecycle gate. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { CoordinatedRecoverySaveResult } from '../src/authoring/storage.js';
import type { AuthorProject, ViewMode } from '../src/authoring/types.js';
import type { AuthorShell } from '../src/authoring/ui/author-shell.js';
import type { MusicSourceEditor } from '../src/authoring/ui/source-editor.js';
import type { ScoreViewport } from '../src/authoring/ui/score-viewport.js';
import type { AuthorViewSwitch } from '../src/authoring/ui/view-switch.js';
import { authorActiveElement, findAuthorControl, mountAuthorFixture } from './author-fixture.js';

const acceptedSource = '<music-staff id="lead"><music-measure id="bar"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff>';
const invalidDraft = acceptedSource.replace('pitch="C4"', 'pitch="not a pitch"');
let shell: AuthorShell;
let app: AuthorWorkspace | undefined;
let sequence = 0;

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl<T>(document, id);
  if (!element) throw new Error(`Missing Author control #${id}`);
  return element;
}

function recoveryStorage() {
  const records = new Map<string, string>();
  const key = `shadow-lifecycle-${++sequence}`;
  return {
    records,
    store: () => new RecoveryStore({
      key, writerId: `lifecycle-writer-${++sequence}`,
      storage: {
        getItem: name => records.get(name) ?? null,
        setItem: (name, value) => { records.set(name, value); },
        removeItem: name => { records.delete(name); },
      },
      locks: { request: async (_name, action) => action() },
    }),
  };
}

function construct(project: AuthorProject | undefined, recovery: RecoveryStore): AuthorWorkspace {
  app = new AuthorWorkspace({ project, recovery });
  return app;
}

async function flush(): Promise<void> {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await shell.updateComplete;
  await Promise.resolve(); await Promise.resolve();
}

async function disposeCurrent(): Promise<void> {
  app?.dispose(); app = undefined;
  await flush();
}

function scoreMounts() {
  const viewport = control<ScoreViewport>('score-host');
  return { viewport, root: viewport.shadowRoot, score: viewport.scoreMount, selection: viewport.overlayMount, preview: viewport.previewMount };
}

function expectMode(mode: ViewMode): void {
  expect(app!.view.get().mode).toBe(mode);
  expect(document.body.dataset.view).toBe(mode);
  expect(control('author-workbench').getAttribute('mode')).toBe(mode);
  expect(control<AuthorViewSwitch>('view-switch').mode).toBe(mode);
  for (const candidate of ['write', 'read', 'pages']) {
    expect(control(`view-${candidate}`).getAttribute('aria-pressed')).toBe(String(candidate === mode));
  }
  expect(control('author-workbench').hidden).toBe(mode === 'pages');
  expect(control('score-editor').hidden).toBe(mode === 'pages');
  expect(control('page-host').hidden).toBe(mode !== 'pages');
  expect(control('workspace-dock').hidden).toBe(mode !== 'write');
  expect(control<HTMLButtonElement>('source-trigger').disabled).toBe(mode !== 'write');
  expect(control<HTMLTextAreaElement>('source-input').readOnly).toBe(mode !== 'write');
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  shell = mountAuthorFixture();
  // Explicit fallback surfaces exercise controller lifecycle without pretending
  // the DOM emulator implements native popover or layout behavior.
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined },
    hidePopover: { configurable: true, value: undefined },
  });
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
});

afterEach(async () => {
  await disposeCurrent();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('workspace reconstruction on a retained shadow composition', () => {
  it('recovers the same invalid draft with fresh local feedback and one active controller', async () => {
    const storage = recoveryStorage();
    const first = construct(createProject(acceptedSource, 'Recover the draft'), storage.store());
    const source = control<MusicSourceEditor>('source-editor');
    const input = control<HTMLTextAreaElement>('source-input');
    const mounts = scoreMounts();
    const guard = control('print-guard');
    control('source-trigger').click();
    expect(control('source-panel').hidden).toBe(false);
    input.value = invalidDraft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    control('source-apply').click();
    await flush();
    expect(first.session.signals.pendingSource.get()).toBe(invalidDraft);
    expect(source.failureMessage).toMatch(/pitch/i);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const previousProject = first.session.signals.project.get();

    await disposeCurrent();
    expect(storage.records.size).toBe(1);
    construct(undefined, storage.store());
    expect(document.querySelector('music-author-shell')).toBe(shell);
    expect(control('source-editor')).toBe(source);
    expect(control('source-input')).toBe(input);
    expect(scoreMounts()).toEqual(mounts);
    expect(app!.session.signals.project.get().id).toBe(previousProject.id);
    expect(app!.session.signals.project.get().sourceHtml).toBe(previousProject.sourceHtml);
    expect(app!.session.signals.pendingSource.get()).toBe(invalidDraft);
    expect(input.value).toBe(invalidDraft);
    expect(source.failureMessage).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(control('source-error').hidden).toBe(true);
    expect(control('print-guard')).toBe(guard);
    expect(document.querySelectorAll('#print-guard')).toHaveLength(1);

    control('source-trigger').click();
    const revisedDraft = invalidDraft.replace('not a pitch', 'still invalid');
    input.value = revisedDraft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    await flush();
    expect(app!.session.signals.pendingSource.get()).toBe(revisedDraft);
    expect(first.session.signals.pendingSource.get()).toBe(invalidDraft);
  });

  it('forces a different project draft into a reused field that still holds shadow focus', async () => {
    const storage = recoveryStorage();
    construct(createProject(acceptedSource, 'Previous document'), storage.store());
    const source = control<MusicSourceEditor>('source-editor');
    const input = control<HTMLTextAreaElement>('source-input');
    const mounts = scoreMounts();
    await disposeCurrent();
    // A caller can retain and present the composed shell between controller
    // instances. Its focused local field must not override the new document.
    control('source-panel').hidden = false;
    input.value = 'Local text from the previous document';
    source.focusInput();
    expect(authorActiveElement(document)).toBe(input);
    const project = { ...createProject(acceptedSource.replace('C4', 'D4'), 'Replacement document'),
      pendingSource: acceptedSource.replace('C4', 'E4') };

    construct(project, storage.store());
    expect(control('source-input')).toBe(input);
    expect(input.value).toBe(project.pendingSource);
    expect(app!.session.signals.project.get().id).toBe(project.id);
    expect(app!.session.signals.pendingSource.get()).toBe(project.pendingSource);
    expect(scoreMounts()).toEqual(mounts);
    expectMode('write');
    await flush();
    expect(input.value).toBe(project.pendingSource);
  });

  it.each(['read', 'pages'] as const)('restores Write synchronously after disposing in %s without replacing score mounts', async previousMode => {
    const storage = recoveryStorage();
    const first = construct(createProject(acceptedSource, 'Previous view'), storage.store());
    const mounts = scoreMounts();
    const guard = control('print-guard');
    control(`view-${previousMode}`).click();
    await flush();
    expectMode(previousMode);
    const project = first.session.project;
    await disposeCurrent();

    construct(project, storage.store());
    expectMode('write');
    expect(control('author-workbench').getAttribute('tools-presentation')).toBe('closed');
    expect(control('workspace-tools').hidden).toBe(true);
    expect(control<HTMLAnchorElement>('skip-to-score').getAttribute('href')).toBe('#score-editor');
    expect(scoreMounts()).toEqual(mounts);
    expect(control('print-guard')).toBe(guard);
    expect(document.querySelectorAll('#print-guard')).toHaveLength(1);
    await flush();
    expectMode('write');
    expect(scoreMounts()).toEqual(mounts);
    const nextMode = previousMode === 'read' ? 'pages' : 'read';
    control(`view-${nextMode}`).click();
    await flush();
    expectMode(nextMode);
    expect(first.view.get().mode).toBe(previousMode);
  });

  it('clears the previous expanded Tools sheet so the reconstructed Write score is interactive', async () => {
    const storage = recoveryStorage();
    construct(createProject(acceptedSource, 'Expanded task'), storage.store());
    const mounts = scoreMounts();
    control('toggle-entry').click();
    control('tools-toggle').click();
    expect(control('workspace-tools').hidden).toBe(false);
    control('tools-expand').click();
    await flush();
    expect(control('author-workbench').getAttribute('tools-presentation')).toBe('sheet');
    expect(control('score-editor').inert).toBe(true);
    expect(control('score-editor').getAttribute('aria-hidden')).toBe('true');
    await disposeCurrent();

    construct(undefined, storage.store());
    expectMode('write');
    expect(control('workspace-tools').hidden).toBe(true);
    expect(control('author-workbench').getAttribute('tools-presentation')).toBe('closed');
    expect(control('score-editor').inert).toBe(false);
    expect(control('score-editor').hasAttribute('aria-hidden')).toBe(false);
    expect(scoreMounts()).toEqual(mounts);
  });

  it.each([
    { status: 'saved', revision: 1, savedAt: 1 },
    { status: 'unavailable', message: 'The previous document could not be saved.' },
  ] as const)('does not let a disposed workspace action or $status save overwrite replacement feedback', async result => {
    const previousRecovery = recoveryStorage().store();
    let finishSave!: (result: CoordinatedRecoverySaveResult) => void;
    const pendingSave = new Promise<CoordinatedRecoverySaveResult>(resolve => { finishSave = resolve; });
    const save = vi.spyOn(previousRecovery, 'saveCoordinated').mockReturnValue(pendingSave);
    construct(createProject(acceptedSource, 'Previous pending document'), previousRecovery);
    const input = control<HTMLTextAreaElement>('source-input');
    input.value = invalidDraft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    // Reconstruct before run()'s awaited action can finish and before the old
    // recovery save settles. Both completions belong to the previous owner.
    app!.dispose(); app = undefined;
    construct(createProject(acceptedSource, 'Replacement accepted document'), recoveryStorage().store());
    const feedback = () => ['save-status', 'workspace-feedback-label', 'workspace-review-summary', 'source-draft-notice']
      .map(id => ({ id, text: control(id).textContent, hidden: control(id).hidden }));
    const current = feedback();
    await flush();
    expect(save).toHaveBeenCalledOnce();
    expect(feedback()).toEqual(current);

    finishSave(result);
    await flush();
    expect(feedback()).toEqual(current);
    expect(app!.session.signals.pendingSource.get()).toBeNull();
    expect(control<HTMLTextAreaElement>('source-input').value).toBe(app!.session.signals.project.get().sourceHtml);
  });
});
