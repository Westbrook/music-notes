// @vitest-environment happy-dom
/**
 * Actual Author shell, session, menu owner and drafts. Engraving dispatch,
 * native popover activation and positioning are explicit controlled boundaries.
 * These tests prove registration, invoker/lifecycle ownership and retained
 * editing state; they do not qualify native top-layer geometry or dismissal.
 */
import { authorActiveElement, authorControlParent, findAuthorControl, mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { PopoverPositionOptions, PopoverPositioner } from '../src/authoring/popover-position.js';

interface PositionRecord {
  options: PopoverPositionOptions;
  api: { open: ReturnType<typeof vi.fn<PopoverPositioner['open']>>;
    refresh: ReturnType<typeof vi.fn<PopoverPositioner['refresh']>>;
    close: ReturnType<typeof vi.fn<PopoverPositioner['close']>>;
    dispose: ReturnType<typeof vi.fn<PopoverPositioner['dispose']>> };
}
const positioning = vi.hoisted(() => ({
  create: vi.fn<(options: PopoverPositionOptions) => PopoverPositioner>(),
  records: [] as PositionRecord[],
}));
vi.mock('../src/authoring/popover-position.js', () => ({ createPopoverPositioner: positioning.create }));

const authorCss = readFileSync('src/authoring/author.css', 'utf8');
const source = '<music-staff id="staff" label="Document study">'
  + '<music-measure id="bar-a"><music-voice id="voice-a">'
  + '<music-note id="a" pitch="F4" duration="half"></music-note>'
  + '<music-note id="b" pitch="G4" duration="half"></music-note>'
  + '</music-voice></music-measure>'
  + '<music-measure id="bar-writer" incomplete><music-voice id="voice-writer">'
  + '<music-note id="writer" pitch="C5" duration="quarter"></music-note>'
  + '</music-voice></music-measure></music-staff>';

let app: AuthorWorkspace | undefined;
let native: ReturnType<typeof nativeLifecycle> | undefined;
let sequence = 0;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl<T>(document, id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element;
}
function unavailableAncestor(element: HTMLElement): HTMLElement | null {
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = authorControlParent(ancestor)) {
    if (ancestor.matches('[hidden],[inert],[aria-hidden="true"]')) return ancestor;
  }
  return null;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function declarationsFor(selector: string): string {
  const css = authorCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector || match[1].split(',').some(part => part.trim() === selector));
  expect(rules.length, `Missing actual Author CSS declaration for ${selector}`).toBeGreaterThan(0);
  return rules.map(match => match[2]).join('\n');
}
function toggleEvent(panel: HTMLElement, type: 'beforetoggle' | 'toggle', state: 'open' | 'closed', invoker?: HTMLElement): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && state === 'open' });
  Object.defineProperties(event, {
    newState: { value: state }, oldState: { value: state === 'open' ? 'closed' : 'open' }, source: { value: invoker ?? null },
  });
  panel.dispatchEvent(event); return event;
}
function nativeLifecycle(panel: HTMLElement) {
  let open = false;
  const matches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : matches(selector));
  const show = vi.fn((invoker?: HTMLElement) => {
    if (open || toggleEvent(panel, 'beforetoggle', 'open', invoker).defaultPrevented) return;
    open = true; toggleEvent(panel, 'toggle', 'open', invoker);
  });
  const hide = vi.fn(() => {
    if (!open) return;
    toggleEvent(panel, 'beforetoggle', 'closed'); open = false; toggleEvent(panel, 'toggle', 'closed');
  });
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide },
  });
  return { show, hide, isOpen: () => open };
}
function mount(useNative = true): AuthorWorkspace {
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  native = useNative ? nativeLifecycle(el('document-menu')) : undefined;
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `document-menu-workspace-${++sequence}`, writerId: 'document-menu-tests',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Document menu integration'), recovery });
  return app;
}
function documentPosition(): PositionRecord {
  const records = positioning.records.filter(record => record.options.panel.id === 'document-menu');
  expect(records, 'Document must have exactly one shared native positioner').toHaveLength(1);
  return records[0];
}
async function click(id: string): Promise<MouseEvent> {
  const button = el<HTMLButtonElement>(id);
  expect(unavailableAncestor(button)).toBeNull(); expect(button.disabled).toBe(false);
  button.focus({ preventScroll: true });
  const target = button.getAttribute('popovertarget');
  const action = button.getAttribute('popovertargetaction');
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
  button.dispatchEvent(event);
  if (native && target === 'document-menu') {
    // Deliberately supply only the browser's declarative activation boundary.
    expect(event.defaultPrevented, 'Author must not replace native popover activation').toBe(false);
    if (action === 'hide' || action !== 'show' && native.isOpen()) native.hide();
    else native.show(button);
  }
  await flush(); return event;
}
async function field(id: string, value: string): Promise<void> {
  const control = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  for (let ancestor = authorControlParent(control); ancestor; ancestor = authorControlParent(ancestor)) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) ancestor.querySelector<HTMLElement>(':scope > summary')!.click();
  }
  expect(unavailableAncestor(control)).toBeNull();
  control.value = value; control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function select(id: string): Promise<void> {
  const sourceElement = app!.session.source.querySelector(`[id="${id}"]`); expect(sourceElement).not.toBeNull();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } })); await flush();
}
function accepted() {
  return {
    source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource,
    revision: app!.session.revision, selection: app!.session.selection, cursor: app!.session.cursor,
    undo: app!.session.canUndo, redo: app!.session.canRedo,
    recipe: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-direction', 'event-duration', 'event-dots',
      'event-stem', 'event-beam', 'event-accidental-display', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked,
    draftTarget: el('selection-inspector').dataset.draftTarget, draftState: el('selection-inspector').dataset.draftState,
    draftPitch: el<HTMLInputElement>('selected-pitch').value,
    sourceText: el<HTMLTextAreaElement>('source-input').value,
  };
}
async function holdEditingContext(holdSource = true): Promise<void> {
  // Keep a real Undo step and a populated Redo branch. Source editing has its
  // own documented branch invalidation, so pending-Source cases start after it.
  app!.session.execute({ type: 'set-note-pitch', eventId: 'a', pitch: 'F#4', ties: 'reject' });
  app!.session.execute({ type: 'set-note-pitch', eventId: 'b', pitch: 'G#4', ties: 'reject' });
  app!.session.undo(); await flush(); expect(app!.session.canRedo).toBe(true);
  await select('writer'); await click('location-trigger'); await click('start-entry-here');
  await click('entry-settings-trigger'); await field('event-pitch', 'Fqs5'); await field('event-stem', 'down');
  await field('event-accidental-display', 'courtesy'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'eighth'); await field('event-dots', '1'); await click('close-entry-value');
  await click('select-mode'); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
  await click('edit-selected-event');
  if (holdSource) {
    await click('source-trigger'); await field('source-input', `${app!.session.project.sourceHtml}\n<!-- Held source draft -->`); await click('close-source');
  }
  expect(accepted()).toMatchObject({ selection: { ids: ['a'] }, cursor: { measureId: 'bar-writer', eventId: 'writer' },
    draftTarget: 'a', draftState: 'dirty', draftPitch: 'Gqf4', undo: true, redo: !holdSource,
    recipe: { 'event-pitch': 'Fqs5', 'event-duration': 'eighth', 'event-dots': '1' } });
  if (holdSource) expect(app!.session.project.pendingSource).not.toBeNull();
  else expect(app!.session.project.pendingSource).toBeNull();
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture();
  Object.defineProperty(el('author-workbench'), 'clientWidth', { configurable: true, value: 1440 });
  positioning.records.length = 0;
  positioning.create.mockReset().mockImplementation(options => {
    const api = { open: vi.fn<PopoverPositioner['open']>(), refresh: vi.fn<PopoverPositioner['refresh']>(),
      close: vi.fn<PopoverPositioner['close']>(), dispose: vi.fn<PopoverPositioner['dispose']>() };
    positioning.records.push({ options, api }); return api;
  });
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  app?.dispose(); app = undefined; native = undefined;
  await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('Document uses the actual Author native surface owner', () => {
  it('registers its native invoker with the shared positioner and exposes one scroll body below its heading', async () => {
    mount(); const panel = el('document-menu'), trigger = el('document-menu-trigger'); const position = documentPosition();
    expect(trigger.getAttribute('popovertarget')).toBe('document-menu'); expect(trigger.getAttribute('popovertargetaction')).toBe('toggle');
    expect(trigger.getAttribute('aria-controls')).toBe('document-menu'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('popover')).toBe('auto'); expect(panel.hasAttribute('role')).toBe(false);
    expect(panel.querySelectorAll(':scope > .popover-body')).toHaveLength(1);
    expect(panel.querySelector('.popover-body')).toBe(panel.querySelector('.document-menu-content'));
    expect(panel.querySelector('.popover-body')!.contains(el('close-document-menu'))).toBe(false);
    await click('document-menu-trigger');
    expect(native!.isOpen()).toBe(true); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(position.api.open).toHaveBeenCalledExactlyOnceWith(trigger);
  });

  it.each(['trigger', 'close', 'native-dismiss'] as const)('keeps Source, Properties, selection, recipe, bookmark and history when closed by %s', async method => {
    mount(); await holdEditingContext(); const before = accepted(); const position = documentPosition();
    await click('document-menu-trigger'); expect(accepted()).toEqual(before);
    if (method === 'native-dismiss') { native!.hide(); await flush(); }
    else await click(method === 'trigger' ? 'document-menu-trigger' : 'close-document-menu');
    expect(native!.isOpen()).toBe(false); expect(el('document-menu-trigger').getAttribute('aria-expanded')).toBe('false');
    expect(position.api.close).toHaveBeenCalled(); expect(accepted()).toEqual(before);
    await click('document-menu-trigger'); expect(position.api.open).toHaveBeenCalledTimes(2); expect(accepted()).toEqual(before);
  });

  it.each([true, false])('keeps a populated Redo branch replayable after native=%s Document inspection', async useNative => {
    mount(useNative); await holdEditingContext(false); const before = accepted();
    await click('document-menu-trigger'); await click('close-document-menu');
    expect(accepted()).toEqual(before); expect(app!.session.canRedo).toBe(true);
    await click('redo');
    expect(app!.session.source.querySelector('#b')!.getAttribute('pitch')).toBe('G#4');
    expect(app!.session.source.querySelector('#a')!.getAttribute('pitch')).toBe('F#4');
    expect(app!.session.canRedo).toBe(false); expect(accepted().recipe).toEqual(before.recipe);
  });

  it('leaves native Escape unclaimed instead of changing the score or taking over dismissal', async () => {
    mount(); await click('document-menu-trigger'); const before = accepted(); const hideCount = native!.hide.mock.calls.length;
    el('score-editor').focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true });
    el('score-editor').dispatchEvent(escape); await flush();
    expect(escape.defaultPrevented).toBe(false); expect(native!.hide.mock.calls.length).toBe(hideCount); expect(accepted()).toEqual(before);
    // Supply native dismissal separately; the manager must reflect that result.
    native!.hide(); await flush(); expect(el('document-menu-trigger').getAttribute('aria-expanded')).toBe('false');
  });

  it('disposes its positioner and listeners without accepting late native callbacks', async () => {
    mount(); await holdEditingContext(); await click('document-menu-trigger'); const before = accepted(); const position = documentPosition();
    app!.dispose(); app = undefined; await flush();
    expect(position.api.dispose).toHaveBeenCalledOnce(); expect(native!.isOpen()).toBe(false);
    expect(el('document-menu-trigger').getAttribute('aria-expanded')).toBe('false');
    const opened = position.api.open.mock.calls.length, closed = position.api.close.mock.calls.length;
    native!.show(el('document-menu-trigger')); position.options.onAnchorUnavailable?.(); await flush();
    expect(position.api.open.mock.calls.length).toBe(opened); expect(position.api.close.mock.calls.length).toBe(closed);
    expect(el('document-menu-trigger').getAttribute('aria-expanded')).toBe('false');
    expect(el<HTMLTextAreaElement>('source-input').value).toBe(before.sourceText);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe(before.draftPitch);
  });
});

describe('Document remains usable without native popovers', () => {
  it('keeps visible in-flow trigger and Close controls, toggles the managed fallback, and never starts positioning', async () => {
    mount(false);
    // Check actual fallback declarations rather than asking the DOM emulator
    // to qualify CSS feature-query behavior or native layout.
    const panel = el('document-menu'), trigger = el('document-menu-trigger'), close = el('close-document-menu');
    expect(panel.dataset.popoverFallback).toBe('true'); expect(panel.hasAttribute('popover')).toBe(false); expect(panel.hidden).toBe(true);
    expect(trigger.dataset.surfaceTarget).toBe('document-menu'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(declarationsFor('.document-menu-trigger[data-surface-target]')).toMatch(/display:\s*inline-flex;/);
    expect(declarationsFor('.document-menu-close[data-surface-target]')).toMatch(/display:\s*inline-flex;/);
    expect(declarationsFor('.surface-popover[data-popover-fallback="true"]')).toMatch(/position:\s*static;/);
    const before = accepted(); await click('document-menu-trigger');
    expect(panel.hidden).toBe(false); expect(panel.dataset.surfaceState).toBe('open'); expect(panel.style.position).toBe('');
    expect(close.dataset.surfaceTarget).toBe('document-menu'); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await click('close-document-menu'); expect(panel.hidden).toBe(true); expect(authorActiveElement(document)).toBe(trigger);
    await click('document-menu-trigger'); await click('document-menu-trigger');
    expect(panel.hidden).toBe(true); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(positioning.records).toHaveLength(0); expect(accepted()).toEqual(before);
  });

  it.each([true, false])('Document file actions close through their owner in native=%s without changing music or held drafts', async useNative => {
    mount(useNative); await holdEditingContext(); const before = accepted();
    const filePicker = vi.spyOn(el<HTMLInputElement>('project-file'), 'click').mockImplementation(() => {});
    await click('document-menu-trigger'); await click('open-project');
    expect(filePicker).toHaveBeenCalledOnce(); expect(el('document-menu-trigger').getAttribute('aria-expanded')).toBe('false');
    if (native) expect(native.isOpen()).toBe(false); else expect(el('document-menu').hidden).toBe(true);
    expect(accepted()).toEqual(before);
  });

  it('closes during a cancelled composition confirmation and restores Document as the surviving invoker', async () => {
    mount(false); await holdEditingContext(); const before = accepted(); await click('document-menu-trigger');
    await click('new-project'); expect(el('document-menu').hidden).toBe(true);
    expect(el<HTMLDialogElement>('author-confirmation').open).toBe(true);
    await click('author-confirmation-cancel');
    expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false); expect(authorActiveElement(document)).toBe(el('document-menu-trigger'));
    expect(accepted()).toEqual(before);
  });
});
