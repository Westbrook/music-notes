// @vitest-environment happy-dom
/**
 * Real AuthorWorkspace, action bindings, selection, and history. Only engraving
 * requestRender is stubbed. Keys stay on their actual focused action: moving
 * focus to #score-editor before Escape would conceal these regressions.
 * Synthetic key/click delivery tests routing, not a browser's native defaults.
 */
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';

const source = '<music-staff id="staff" label="Keyboard study"><music-measure id="bar">'
  + '<music-note id="note" pitch="F4" duration="quarter"></music-note>'
  + '<music-note id="other" pitch="G4" duration="quarter"></music-note>'
  + '<music-rest id="rest" duration="half"></music-rest></music-measure></music-staff>';

let app: AuthorWorkspace | undefined;
let sequence = 0;
let viewportDescriptor: PropertyDescriptor | undefined;

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing Author action #${id}.`);
  return element as T;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function keyboard(target: HTMLElement, key: string, type = 'keydown'): KeyboardEvent {
  const event = new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event); return event;
}
function pointer(target: HTMLElement, type: 'pointerdown' | 'pointerup'): PointerEvent {
  const event = new PointerEvent(type, { pointerId: 52, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event); return event;
}
async function click(id: string): Promise<void> {
  const button = control<HTMLButtonElement>(id);
  expect(button.closest('[hidden], [inert]')).toBeNull(); expect(button.disabled).toBe(false);
  button.click(); await flush();
}
async function mountSelected(): Promise<void> {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `selection-escape-${++sequence}`, writerId: 'selection-escape-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Escape routing'), recovery });
  control('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: 'note', sourceElement: app.session.source.querySelector('#note'), shiftKey: false, ctrlKey: false,
    metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } }));
  await flush(); expect(app.session.selection.ids).toEqual(['note']);
}
function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision,
    undo: app!.session.canUndo, redo: app!.session.canRedo, selection: app!.session.selection,
    cursor: app!.session.cursor };
}
function noCancellationError(): void {
  expect(control('selection-controls-error').hidden).toBe(true);
  expect(control('author-errors').hidden).toBe(true);
  expect(document.body.dataset.selectionFeedback).not.toBe('rejected');
}

beforeEach(() => {
  viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture();
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  app?.dispose(); app = undefined; await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
  if (viewportDescriptor) Object.defineProperty(window, 'innerWidth', viewportDescriptor);
});

describe('Escape retains the actual focused selection action', () => {
  it.each(['edit-selected-event', 'selection-value'] as const)('cancels pending native Space on #%s before its delayed click can act', async id => {
    await mountSelected(); const before = accepted(); const button = control<HTMLButtonElement>(id); button.focus();
    expect(document.activeElement).toBe(button);
    expect(keyboard(button, ' ').defaultPrevented).toBe(false); // Ordinary native-button activation is pending until release.
    const escape = keyboard(button, 'Escape');
    keyboard(button, ' ', 'keyup');
    // Happy DOM has no native keyup click. Deliver that late activation explicitly,
    // even if Escape intentionally returned focus elsewhere, to exercise its guard.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 0 }));
    await flush();
    expect(control('workspace-tools').hidden).toBe(true);
    expect(control('selection-value-chooser').hidden).toBe(true);
    expect(accepted()).toEqual(before);
    noCancellationError();
    expect(escape.defaultPrevented).toBe(true);
  });

  it.each(['edit-selected-event', 'selection-value'] as const)('cancels a focused #%s pointer activation before release', async id => {
    await mountSelected(); const before = accepted(); const button = control<HTMLButtonElement>(id); button.focus();
    pointer(button, 'pointerdown'); const escape = keyboard(button, 'Escape');
    pointer(button, 'pointerup');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
    await flush();
    expect(control('workspace-tools').hidden).toBe(true);
    expect(control('selection-value-chooser').hidden).toBe(true);
    expect(accepted()).toEqual(before);
    noCancellationError();
    expect(escape.defaultPrevented).toBe(true);
  });

  it('cancels prepared pitch dragging with Escape on its focused handle and returns focus to the score', async () => {
    await mountSelected(); await click('edit-selected-event');
    const before = accepted(); await click('selection-prepare-drag');
    const handle = control('drag-pitch');
    expect(document.body.dataset.pitchDragArmed).toBe('true'); expect(document.activeElement).toBe(handle);
    const escape = keyboard(handle, 'Escape'); await flush();
    expect(document.body.dataset.pitchDragArmed).not.toBe('true');
    expect(handle.hidden).toBe(true); expect(control('selection-done').hidden).toBe(true);
    expect(document.activeElement).toBe(control('score-editor')); expect(accepted()).toEqual(before);
    noCancellationError();
    expect(escape.defaultPrevented).toBe(true);
  });

  it('cancels pending Space on Properties Spelling without closing the pane or opening Pitch', async () => {
    await mountSelected(); await click('edit-selected-event');
    const before = accepted(); const spelling = control('properties-pitch'); spelling.focus();
    expect(keyboard(spelling, ' ').defaultPrevented).toBe(false);
    const escape = keyboard(spelling, 'Escape');
    keyboard(spelling, ' ', 'keyup');
    spelling.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 0 }));
    await flush();
    expect(control('workspace-tools').hidden).toBe(false);
    expect(control('selection-pitch-chooser').hidden).toBe(true);
    expect(accepted()).toEqual(before); noCancellationError(); expect(escape.defaultPrevented).toBe(true);
  });
});

describe('Escape preserves native fields and the innermost choice surface', () => {
  it.each(['event-pitch', 'event-duration'] as const)('does not consume native Escape on #%s or park entry', async id => {
    await mountSelected(); await click('location-trigger'); await click('start-entry-here');
    if (id === 'event-pitch') await click('entry-settings-trigger');
    const field = control(id); field.focus(); expect(document.activeElement).toBe(field);
    const before = accepted(); const escape = keyboard(field, 'Escape'); await flush();
    expect(escape.defaultPrevented).toBe(false);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(accepted()).toEqual(before);
    expect(document.activeElement).toBe(field);
  });

  it('leaves a native select Escape available to its picker without clearing the selected music', async () => {
    await mountSelected(); await click('selection-value');
    const field = control('selection-duration'); field.focus(); const before = accepted();
    const escape = keyboard(field, 'Escape'); await flush();
    expect(escape.defaultPrevented).toBe(false); expect(control('selection-value-chooser').hidden).toBe(false);
    expect(accepted()).toEqual(before); expect(document.activeElement).toBe(field);
  });

  it('closes only the in-flow choice surface when Escape is owned by its Close action', async () => {
    await mountSelected(); await click('selection-value');
    const close = control('close-selection-value'); close.focus(); const before = accepted();
    const escape = keyboard(close, 'Escape'); await flush();
    expect(escape.defaultPrevented).toBe(true); expect(control('selection-value-chooser').hidden).toBe(true);
    expect(accepted()).toEqual(before); expect(document.activeElement).toBe(control('selection-value'));
  });

  it('does not intercept Escape owned by a declarative popover surface', async () => {
    await mountSelected(); await click('selection-value');
    const panel = control('selection-value-chooser');
    // Happy DOM lacks a native top layer. This explicit boundary tests only that
    // Author yields the key when a chooser declares native popover ownership;
    // real native dismissal and focus restoration still require browser review.
    panel.setAttribute('popover', 'auto');
    const close = control('close-selection-value'); close.focus(); const before = accepted();
    const escape = keyboard(close, 'Escape'); await flush();
    expect(escape.defaultPrevented).toBe(false); expect(panel.hidden).toBe(false);
    expect(accepted()).toEqual(before); expect(document.activeElement).toBe(close);
  });

  it('invalidates a pending popover-button Space action quietly while leaving native Escape dismissal unprevented', async () => {
    await mountSelected(); await click('edit-selected-event'); await click('properties-pitch');
    const panel = control('selection-pitch-chooser');
    // The same explicit declarative boundary as above; there is no native top
    // layer in this test. The late click must be safe even before dismissal.
    panel.setAttribute('popover', 'auto');
    const sharp = control('selection-chooser-sharp'); sharp.focus(); const before = accepted();
    expect(keyboard(sharp, ' ').defaultPrevented).toBe(false);
    const escape = keyboard(sharp, 'Escape');
    keyboard(sharp, ' ', 'keyup');
    sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 0 }));
    await flush();
    expect(escape.defaultPrevented).toBe(false); expect(accepted()).toEqual(before); noCancellationError();
  });
});
