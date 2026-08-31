// @vitest-environment happy-dom
/**
 * Actual workspace/session/input owners with only engraving dispatch stubbed.
 * Controlled DOM event ordering proves admission and recovery contracts, not
 * native popover light-dismiss timing, pointer geometry, or browser defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = '<music-staff id="staff" label="Input study">'
  + '<music-measure id="bar-1" incomplete><music-voice id="voice-1">'
  + '<music-note id="a" pitch="F4" duration="quarter"></music-note>'
  + '<music-note id="b" pitch="G4" duration="quarter"></music-note>'
  + '<music-note id="c" pitch="A4" duration="quarter"></music-note>'
  + '</music-voice></music-measure>'
  + '<music-measure id="bar-2" incomplete><music-voice id="voice-2">'
  + '<music-note id="d" pitch="B4" duration="quarter"></music-note>'
  + '</music-voice></music-measure></music-staff>';

let app: AuthorWorkspace | undefined;
let sequence = 0;
const cleanups: (() => void)[] = [];

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const target = document.getElementById(id);
  if (!target) throw new Error('Missing actual Author control #' + id);
  return target as T;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function click(id: string): Promise<void> {
  const button = el<HTMLButtonElement>(id);
  expect(button.closest('[hidden],[inert]')).toBeNull(); expect(button.disabled).toBe(false);
  button.click(); await flush();
}
function notation(id: string, ctrlKey = false): void {
  const sourceElement = app!.session.source.querySelector('#' + id); expect(sourceElement).not.toBeNull();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true,
    detail: { sourceId: id, sourceElement, ctrlKey, shiftKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse' } }));
}
function pointer(type: 'pointerdown' | 'pointerup', ctrlKey = false): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true,
    pointerId: 71, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, ctrlKey });
  el('score-host').dispatchEvent(event); return event;
}
async function key(value: string): Promise<KeyboardEvent> {
  expect(document.activeElement).toBe(el('score-editor'));
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true });
  document.activeElement!.dispatchEvent(event); await flush(); return event;
}
function recipe() {
  return Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-direction', 'event-duration',
    'event-dots', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value]));
}
function accepted() {
  return { source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource,
    revision: app!.session.revision, selection: app!.session.selection, cursor: app!.session.cursor,
    undo: app!.session.canUndo, redo: app!.session.canRedo, recipe: recipe() };
}
async function mountWriting(): Promise<void> {
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: 'writing-input-guards-' + ++sequence, writerId: 'writing-input-tests',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() } });
  app = new AuthorWorkspace({ project: createProject(source, 'Writing input guards'), recovery });
  notation('b'); await flush(); await click('toggle-entry');
  await key('n'); await click('entry-value-trigger');
  for (const [id, value] of [['event-duration', 'quarter'], ['event-dots', '0']]) {
    const field = el<HTMLSelectElement>(id); expect(field.closest('[hidden]')).toBeNull();
    field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await click('close-entry-value'); el('score-editor').focus({ preventScroll: true });
  expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
  expect(app.session.cursor).toMatchObject({ staffId: 'staff', measureId: 'bar-1', voiceIndex: 0, eventId: 'b' });
  expect(document.activeElement).toBe(el('score-editor'));
}
async function applySource(html: string): Promise<void> {
  await click('source-trigger');
  const field = el<HTMLTextAreaElement>('source-input'); field.focus(); field.value = html;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  await click('source-apply');
  expect(app!.session.project.pendingSource).toBeNull(); expect(el('source-error').hidden).toBe(true);
  await click('close-source');
  // A deliberate keyboard return to the score does not choose a new event or
  // authorize a fallback writing destination after Source changed its owner.
  el('score-editor').focus({ preventScroll: true });
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  cleanups.splice(0).forEach(cleanup => cleanup()); app?.dispose(); app = undefined;
  await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('Source cannot silently replace an active writing destination', () => {
  it.each(['removed', 'reparented'] as const)('does not write at a fallback after Source %s the writer event', async change => {
    await mountWriting(); const next = app!.session.source.cloneNode(true) as HTMLElement;
    const writer = next.querySelector('#b')!;
    if (change === 'removed') writer.remove(); else next.querySelector('#voice-2')!.append(writer);
    await applySource(next.outerHTML); const afterApply = accepted();
    await key('Enter');
    expect(accepted()).toEqual(afterApply);
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('false');
    expect(el('select-mode').getAttribute('aria-pressed')).toBe('true');
    const recovery = el('workspace-feedback-label'); expect(recovery.closest('[hidden]')).toBeNull();
    expect(recovery.textContent).toMatch(/writing|destination|unavailable|location/i);
    await click('toggle-entry'); expect(accepted()).toEqual(afterApply);
    expect(el('author-errors').textContent).toMatch(/Location.*Start writing here/);
  });

  it('retains a valid writer through an unrelated accepted Source edit', async () => {
    await mountWriting(); const next = app!.session.source.cloneNode(true) as HTMLElement;
    next.querySelector('#d')!.setAttribute('pitch', 'C5');
    await applySource(next.outerHTML); const afterApply = accepted();
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(app!.session.cursor).toMatchObject({ measureId: 'bar-1', eventId: 'b' });
    await key('Enter');
    expect(app!.session.revision).toBe(afterApply.revision + 1);
    const ids = app!.session.score.staves[0].measures[0].voices[0].events.map(event => event.id);
    expect(ids.slice(0, 2)).toEqual(['a', 'b']); expect(ids.at(-1)).toBe('c'); expect(ids).toHaveLength(4);
  });
});

describe('a transient surface suspends score input without changing Writing', () => {
  it('Escape from deliberately returned score focus closes the entry-value fallback without changing music or tool', async () => {
    await mountWriting(); await click('entry-value-trigger');
    const panel = el('entry-value-chooser'); expect(panel.dataset.popoverFallback).toBe('true'); expect(panel.hidden).toBe(false);
    const before = accepted(); el('score-editor').focus({ preventScroll: true });
    const escape = await key('Escape');
    expect(panel.hidden).toBe(true); expect(escape.defaultPrevented).toBe(true);
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(accepted()).toEqual(before);
  });

  it('leaves native popover Escape unprevented even when a separate fallback remains open', async () => {
    await mountWriting(); await click('entry-value-trigger'); const before = accepted();
    // An explicit native ownership boundary, not a native top-layer emulator.
    const native = document.createElement('section'); native.setAttribute('popover', 'auto'); document.body.append(native);
    Object.defineProperties(native, { showPopover: { value: vi.fn() }, hidePopover: { value: vi.fn() } });
    const matches = native.matches.bind(native);
    vi.spyOn(native, 'matches').mockImplementation(selector => selector === ':popover-open' || matches(selector));
    el('score-editor').focus({ preventScroll: true }); const escape = await key('Escape');
    expect(escape.defaultPrevented).toBe(false); expect(el('entry-value-chooser').hidden).toBe(false);
    expect(native.hidePopover).not.toHaveBeenCalled(); expect(accepted()).toEqual(before);
  });

  it('does not claim fallback Escape from a generic focusable prose origin or move its focus', async () => {
    await mountWriting(); await click('entry-value-trigger'); const before = accepted();
    const prose = document.createElement('p'); prose.tabIndex = 0; prose.textContent = 'Keep this performance instruction.';
    el('score-editor').append(prose); prose.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
    prose.dispatchEvent(escape); await flush();
    expect(escape.defaultPrevented).toBe(false); expect(document.activeElement).toBe(prose);
    expect(el('entry-value-chooser').hidden).toBe(false); expect(accepted()).toEqual(before);
  });

  it('retains the rejected press through popup closure, release and notation compatibility activation', async () => {
    await mountWriting(); await click('source-trigger'); const before = accepted();
    pointer('pointerdown', true); await click('close-source'); pointer('pointerup', true); notation('c', true); await flush();
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(accepted()).toEqual(before);
    // A new pointer press after closure is an independent deliberate selection.
    pointer('pointerdown', true); pointer('pointerup', true); notation('c', true); await flush();
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('false'); expect(app!.session.selection.ids).toContain('c');
    expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.revision).toBe(before.revision);
  });

  it('does not retarget selection when Value opens and closes during an already held score press', async () => {
    await mountWriting(); await click('select-mode'); notation('a'); await flush();
    expect(app!.session.selection.ids).toEqual(['a']); const before = accepted();
    pointer('pointerdown');
    // Keyboard-style button activation does not begin another pointer press.
    await click('selection-value');
    const panel = el('selection-value-chooser');
    expect(panel.dataset.popoverFallback).toBe('true'); expect(panel.hidden).toBe(false);
    await click('close-selection-value'); expect(panel.hidden).toBe(true);
    pointer('pointerup'); notation('b'); await flush();
    expect(app!.session.selection.ids).toEqual(['a']); expect(accepted()).toEqual(before);
    // A fresh press after dismissal owns a new, deliberate selection.
    pointer('pointerdown'); pointer('pointerup'); notation('b'); await flush();
    expect(app!.session.selection.ids).toEqual(['b']);
    expect(el('select-mode').getAttribute('aria-pressed')).toBe('true');
    expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.revision).toBe(before.revision);
    expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(before.redo);
  });

  it('keeps a press blocked when its surface closes after the root capture listener but before gesture admission', async () => {
    await mountWriting(); await click('source-trigger'); const before = accepted();
    // Native timing is not simulated: this deliberately exercises the event
    // ordering the root press latch promises to keep safe for every owner.
    const closeDuringCapture = (event: Event) => {
      if (event.composedPath().includes(el('score-editor'))) el('close-source').click();
    };
    document.addEventListener('pointerdown', closeDuringCapture, { capture: true });
    cleanups.push(() => document.removeEventListener('pointerdown', closeDuringCapture, { capture: true }));
    pointer('pointerdown', true);
    expect(el('source-panel').hidden).toBe(true);
    // The modifier must not park Writing before release merely because the
    // popup is no longer open when StaffInteraction receives this same press.
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    pointer('pointerup', true); notation('c', true); await flush(); expect(accepted()).toEqual(before);
  });
});

describe('Writing keeps its own keyboard destination and view intent', () => {
  it('arrows, N/R and idle Escape keep inspection separate and the next Enter writes at the moved writer', async () => {
    await mountWriting(); await click('select-mode'); notation('a'); await flush(); await click('toggle-entry');
    expect(app!.session.selection.ids).toEqual(['a']); expect(app!.session.cursor?.eventId).toBe('b');
    const before = accepted(); await key('ArrowRight');
    expect(app!.session.cursor).toMatchObject({ measureId: 'bar-1', eventId: 'c' });
    expect(app!.session.selection).toEqual(before.selection); expect(recipe()).toEqual(before.recipe);
    const moved = accepted();
    const range = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, composed: true, cancelable: true });
    el('score-editor').dispatchEvent(range); await flush(); expect(accepted()).toEqual(moved);
    await key('Escape'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(accepted()).toEqual(moved);
    await key('r'); expect(el<HTMLSelectElement>('event-kind').value).toBe('rest');
    expect(el<HTMLInputElement>('event-measure-rest').checked).toBe(false);
    await key('n'); expect(accepted()).toEqual(moved);
    await key('Enter');
    const events = app!.session.score.staves[0].measures[0].voices[0].events;
    expect(events.map(event => event.id).slice(0, 3)).toEqual(['a', 'b', 'c']); expect(events).toHaveLength(4);
    expect(app!.session.cursor?.eventId).toBe(events[3].id); expect(app!.session.revision).toBe(before.revision + 1);
  });

  it('Read navigation and Pages suspend then restore Writing without taking the Write view button’s focus', async () => {
    await mountWriting(); const before = accepted();
    await click('view-read'); await key('ArrowRight');
    expect(app!.session.selection.sourceId).toBe('bar-2');
    el('view-pages').focus(); await click('view-pages');
    el('view-write').focus(); await click('view-write');
    expect(document.activeElement).toBe(el('view-write'));
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
    expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.revision).toBe(before.revision);
    expect(app!.session.canUndo).toBe(before.undo);
    el('score-editor').focus({ preventScroll: true }); await key('Enter');
    const events = app!.session.score.staves[0].measures[0].voices[0].events;
    expect(events.map(event => event.id).slice(0, 2)).toEqual(['a', 'b']); expect(events.at(-1)?.id).toBe('c'); expect(events).toHaveLength(4);
    expect(app!.session.score.staves[0].measures[1].voices[0].events.map(event => event.id)).toEqual(['d']);
  });
});
