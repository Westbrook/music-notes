// @vitest-environment happy-dom
/**
 * Writing journeys through the actual Author shell, session and controllers.
 * Only engraving dispatch is stubbed. Public notation-select and keyboard
 * events qualify routing and musical state, not trusted input, pixels or PDF.
 */
import { authorActiveElement, authorControlParent, findAuthorControl, mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { add, pitchText } from '../src/model/index.js';
import type { MusicEvent } from '../src/model/types.js';

const abcSource = `<music-staff id="lead" label="Lead">
  <music-measure id="bar-a" number="12" meter="4/4"><music-voice id="voice-a"><music-note id="a" pitch="F4" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-b" number="13"><music-voice id="voice-b"><music-note id="b" pitch="F4" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-c" number="14" incomplete><music-voice id="voice-c"><music-note id="c" pitch="E4" duration="half"></music-note></music-voice></music-measure>
  <music-measure id="bar-d" number="15" incomplete><music-voice id="voice-d"></music-voice></music-measure>
</music-staff>`;
const emptyBars = (count: number) => `<music-staff id="lead" label="Lead">${Array.from({ length: count }, (_, index) =>
  `<music-measure id="bar-${index + 1}" number="${index + 1}" meter="4/4" incomplete><music-voice id="voice-${index + 1}"></music-voice></music-measure>`).join('')}</music-staff>`;

let app: AuthorWorkspace | undefined;
let sequence = 0;
let widthDescriptor: PropertyDescriptor | undefined;
const actions: string[] = [];

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl(document, id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element as T;
}
function available(element: HTMLElement): boolean {
  if (element.closest('[hidden],[inert],[aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) {
    if (parent.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function disclose(element: HTMLElement): Promise<void> {
  const parents: HTMLDetailsElement[] = [];
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) if (parent instanceof HTMLDetailsElement) parents.unshift(parent);
  for (const details of parents) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true);
    actions.push(`disclose:${details.id}`); summary!.click(); await flush(); expect(details.open).toBe(true);
  }
}
async function click(id: string): Promise<void> {
  const target = el(id); await disclose(target); expect(available(target), `#${id} is available`).toBe(true);
  actions.push(`click:${id}`); target.click(); await flush();
}
async function field(id: string, value: string): Promise<void> {
  const target = el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
  await disclose(target); expect(available(target), `#${id} is available`).toBe(true);
  if (target instanceof HTMLSelectElement) expect([...target.options].some(option => option.value === value && !option.disabled), `#${id} offers ${value}`).toBe(true);
  actions.push(`field:${id}`); target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
function mount(source = abcSource): AuthorWorkspace {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `writing-surface-workspace-${++sequence}`, writerId: 'writing-surface-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Writing surface integration'), recovery }); return app;
}
async function select(id: string): Promise<void> {
  const sourceElement = app!.session.source.id === id ? app!.session.source : app!.session.source.querySelector(`[id="${id}"]`);
  expect(sourceElement, `Fixture source ${id} exists`).not.toBeNull(); expect(available(el('score-host')), 'The musical surface is available for deliberate selection').toBe(true);
  actions.push(`source:${id}`);
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } })); await flush();
}
/** Focus must come from the real Write/Select route, not this event helper. */
async function press(key: string, options: KeyboardEventInit = {}, target = authorActiveElement(document)): Promise<KeyboardEvent> {
  expect(target).toBeInstanceOf(HTMLElement); actions.push(`key:${key}`);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...options });
  target!.dispatchEvent(event); await flush(); return event;
}
function recipe() {
  return { values: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
    'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked, rhythmic: el<HTMLInputElement>('event-rhythmic').checked };
}
function accepted() {
  return { source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource, revision: app!.session.revision,
    undo: app!.session.canUndo, redo: app!.session.canRedo, cursor: app!.session.cursor,
    parts: structuredClone(app!.session.project.parts), layouts: structuredClone(app!.session.project.layouts) };
}
function noEdit(before: ReturnType<typeof accepted>, preserveCursor = true): void {
  const actual = accepted();
  expect(actual.source).toBe(before.source); expect(actual.pending).toBe(before.pending); expect(actual.revision).toBe(before.revision);
  expect([actual.undo, actual.redo]).toEqual([before.undo, before.redo]); expect(actual.parts).toEqual(before.parts); expect(actual.layouts).toEqual(before.layouts);
  if (preserveCursor) expect(actual.cursor).toEqual(before.cursor);
}
function voice(barIndex: number, voiceIndex = 0) { return app!.session.score.staves[0].measures[barIndex].voices[voiceIndex]; }
function allEvents(): MusicEvent[] { return app!.session.score.staves.flatMap(staff => staff.measures.flatMap(bar => bar.voices.flatMap(voice => voice.events))); }
function event(id: string): MusicEvent { const value = allEvents().find(item => item.id === id); if (!value) throw new Error(`Accepted event ${id} is missing.`); return value; }
function selectedIdentity() { const { version: _version, ...identity } = app!.session.selection; return identity; }
function historyTarget() { return { cursor: app!.session.cursor, selection: selectedIdentity() }; }
function scoreOnly(): void {
  expect(el('workspace-tools').hidden, 'Routine writing does not open a task pane').toBe(true);
  expect(el('selection-controls').hidden, 'Writing does not open selected-event controls').toBe(true);
  // The unsupported-Popover Document fallback is intentionally in flow. These
  // managed surfaces instead have actual open/closed controller state here.
  for (const id of ['location-panel', 'entry-settings', 'entry-value-chooser', 'source-panel', 'score-setup', 'continuation-review',
    'pointer-recovery', 'workspace-review', 'selection-value-chooser', 'selection-pitch-chooser', 'selection-shared-chooser']) {
    expect(el(id).hidden, `Routine writing does not open #${id}`).toBe(true);
  }
  expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false);
}
function writing(expected: boolean): void {
  expect(el('toggle-entry').getAttribute('aria-pressed')).toBe(String(expected));
  expect(el('select-mode').getAttribute('aria-pressed')).toBe(String(!expected));
  expect(document.body.dataset.entryMode).toBe(String(expected));
}
function heldDraft() {
  return { target: el('selection-inspector').dataset.draftTarget, state: el('selection-inspector').dataset.draftState,
    pitch: el<HTMLInputElement>('selected-pitch').value };
}
async function startC(withDirtyA = false): Promise<void> {
  if (withDirtyA) {
    await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
    // Return through the actual pane action before selecting the writer; a
    // compact task sheet must never receive a fake click through its score.
    await click('tools-hide'); expect(el('workspace-tools').hidden).toBe(true);
  }
  await select('c'); await click('location-trigger'); await click('start-entry-here');
  writing(true); expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-c', voiceIndex: 0, eventId: 'c' });
  await click('entry-settings-trigger'); await field('event-pitch', 'Fqs5');
  await field('event-accidental-display', 'courtesy'); await field('event-stem', 'down'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '0'); await click('close-entry-value');
}
async function parkABC(): Promise<void> { await startC(true); await click('select-mode'); await select('b'); writing(false); }

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture(); actions.length = 0;
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  app?.dispose(); app = undefined; await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
  if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
});

describe('fixed writing intent keeps three musical owners separate', () => {
  it('Write notes resumes saved C while preserving selected B, dirty Properties A, the recipe and history', async () => {
    mount(); await parkABC(); const before = accepted(), palette = recipe(), selection = app!.session.selection, draft = heldDraft();
    expect(draft).toMatchObject({ target: 'a', state: 'dirty', pitch: 'Gqf4' }); expect(selection.ids).toEqual(['b']);
    expect(el('palette-owner-label').textContent).toMatch(/^Selected/i); expect(el('selection-controls-context').textContent).toMatch(/(?:bar|measure)\s*13/i);
    const actionStart = actions.length; await click('toggle-entry'); writing(true);
    expect(actions.slice(actionStart)).toEqual(['click:toggle-entry']); expect(authorActiveElement(document)).toBe(el('score-editor'));
    expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-c', voiceIndex: 0, eventId: 'c' });
    expect(app!.session.selection).toEqual(selection); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); noEdit(before);
    expect(el('palette-owner-label').textContent).toMatch(/^New notes/i);
    const inserted = await press('Enter'); expect(inserted.defaultPrevented).toBe(true); writing(true);
    expect(voice(2).events).toHaveLength(2); expect(voice(2).events[0].id).toBe('c');
    expect(voice(2).events[1].pitches.map(pitchText)).toEqual(['Fqs5']); expect(voice(2).events[1].duration).toBe('quarter');
    expect(voice(2).events[1].onset).toEqual({ numerator: 1, denominator: 2 }); expect(voice(1).events.map(item => item.id)).toEqual(['b']);
    expect(event('b').pitches.map(pitchText)).toEqual(['F4']); expect(app!.session.revision).toBe(before.revision + 1);
    expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    await press('z', { ctrlKey: true }); expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.cursor).toEqual(before.cursor);
    expect(app!.session.selection.ids).toEqual(['b']); expect(app!.session.canUndo).toBe(before.undo); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
  });
  it('both fixed mode controls remain available and no third Resume competes with them', async () => {
    mount(); await parkABC();
    for (const id of ['toggle-entry', 'select-mode']) expect(available(el(id)), `${id} stays available`).toBe(true);
    expect(el('toggle-entry').textContent).toMatch(/Write notes/i);
    expect([...el('workspace-mode-slot').querySelectorAll<HTMLButtonElement>('button')].filter(available).map(button => button.id)).toEqual(['toggle-entry', 'select-mode']);
    expect(document.querySelectorAll('#toggle-entry')).toHaveLength(1); expect(document.querySelectorAll('#select-mode')).toHaveLength(1);
  });
  it('clicking active Write notes only returns score focus and explicit Select parks the same destination', async () => {
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft(), selection = app!.session.selection;
    el('document-menu-trigger').focus(); await click('toggle-entry'); writing(true); expect(authorActiveElement(document)).toBe(el('score-editor'));
    noEdit(before); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); expect(app!.session.selection).toEqual(selection);
    await click('select-mode'); writing(false); noEdit(before); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    await click('toggle-entry'); writing(true); noEdit(before); expect(app!.session.selection).toEqual(selection);
  });
  it('opening Location retains Write, but deliberately navigating to B enters Select without replacing parked C', async () => {
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft();
    await click('location-trigger'); writing(true); noEdit(before);
    await field('measure-select', 'bar-b'); writing(false); noEdit(before);
    expect(app!.session.selection.sourceId).toBe('bar-b'); expect(app!.session.selection.ids).toEqual([]);
    expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    await click('close-location'); const selection = app!.session.selection; await click('toggle-entry'); writing(true); noEdit(before);
    expect(app!.session.selection).toEqual(selection); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    expect(el('palette-owner-label').textContent).toMatch(/^New notes/i);
  });
});

describe('inspection surfaces and nonediting views suspend actions without retargeting writing', () => {
  it.each([
    ['entry-settings-trigger', 'entry-settings', 'close-entry-settings'],
    ['entry-value-trigger', 'entry-value-chooser', 'close-entry-value'],
    ['source-trigger', 'source-panel', 'close-source'],
    ['score-setup-trigger', 'score-setup', 'close-score-setup'],
  ])('%s opens and closes without parking Write, applying dirty A, or changing its saved C', async (trigger, panel, closer) => {
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft(), selection = app!.session.selection;
    if (trigger === 'score-setup-trigger') await click('document-menu-trigger');
    await click(trigger); expect(el(panel).hidden).toBe(false); writing(true); noEdit(before);
    expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); expect(app!.session.selection).toEqual(selection);
    await click(closer); expect(el(panel).hidden).toBe(true); writing(true); noEdit(before); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
  });
  it('a synthetic Document beforetoggle lifecycle does not park writing or change music', async () => {
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft(), selection = app!.session.selection;
    // happy-dom has no native top layer. Deliver only the public lifecycle event;
    // this is explicitly not native opening, light dismissal or focus coverage.
    for (const state of ['open', 'closed']) {
      const toggle = new Event('beforetoggle', { cancelable: true }); Object.defineProperty(toggle, 'newState', { value: state });
      el('document-menu').dispatchEvent(toggle); await flush(); writing(true); noEdit(before);
      expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); expect(app!.session.selection).toEqual(selection);
    }
  });
  it.each([true, false])('Read and Pages roundtrip restores the prior writing intent %s with no musical transaction', async wasWriting => {
    mount(); await startC(true); if (!wasWriting) { await click('select-mode'); await select('b'); }
    const before = accepted(), palette = recipe(), draft = heldDraft(), selection = app!.session.selection;
    for (const view of ['read', 'pages']) {
      await click(`view-${view}`); expect(document.body.dataset.view).toBe(view); noEdit(before);
      await press('Enter', {}, el(view === 'read' ? 'score-editor' : 'page-host')); noEdit(before);
      expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    }
    await click('view-write'); writing(wasWriting); noEdit(before); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    expect(app!.session.selection).toEqual(selection);
  });
  it('returning from Read restores C even when Read inspection visited B', async () => {
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft();
    await click('view-read'); await select('b'); expect(app!.session.selection.ids).toEqual(['b']); noEdit(before);
    await click('view-pages'); await click('view-write'); writing(true); noEdit(before);
    expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-c', voiceIndex: 0, eventId: 'c' });
    expect(app!.session.selection.ids).toEqual(['b']); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
  });
});

describe('keyboard writing uses existing empty bars and accepted transactions', () => {
  it('writes 32 quarter notes in eight genuinely empty bars with one mode choice, seven navigation keys and exactly 32 Undos', async () => {
    mount(emptyBars(8));
    expect(allEvents()).toEqual([]); expect(app!.session.source.querySelector('music-rest')).toBeNull();
    expect(app!.session.score.staves[0].measures.every(measure => measure.incomplete && measure.voices.length === 1)).toBe(true);
    expect(el<HTMLSelectElement>('insert-position').value).toBe('after');
    expect(el<HTMLInputElement>('continuation-enabled').checked).toBe(false);
    const initial = accepted(), checkpoints = [initial.source], eventIds: string[] = [], expectedPitches: string[] = [];
    const insertionTargets: ReturnType<typeof historyTarget>[] = [];
    actions.length = 0; await click('toggle-entry'); writing(true); noEdit(initial); expect(authorActiveElement(document)).toBe(el('score-editor'));
    // Choose the recipe once through real controls. This also avoids treating
    // happy-dom's customizable-select default handling as native qualification.
    await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '0'); await click('close-entry-value');
    await click('toggle-entry'); writing(true); noEdit(initial); expect(authorActiveElement(document)).toBe(el('score-editor'));
    expect(actions).toEqual(['click:toggle-entry', 'click:entry-value-trigger', 'field:event-duration', 'field:event-dots', 'click:close-entry-value', 'click:toggle-entry']);
    actions.length = 0; // The second Write activation above only returns focus.
    for (let index = 0; index < 32; index++) {
      const barIndex = Math.floor(index / 4), noteIndex = index % 4, letter = 'CDEFGAB'[index % 7];
      if (noteIndex === 0 && barIndex > 0) {
        const before = accepted(), selection = app!.session.selection, palette = recipe();
        const navigation = await press('ArrowRight'); expect(navigation.defaultPrevented).toBe(true); writing(true); noEdit(before, false);
        expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: `bar-${barIndex + 1}`, voiceIndex: 0 });
        expect(app!.session.selection).toEqual(selection); expect(recipe()).toEqual(palette); expect(voice(barIndex).events).toEqual([]); scoreOnly();
      }
      const before = accepted(); insertionTargets.push(historyTarget());
      const written = await press(letter); expect(written.defaultPrevented).toBe(true); writing(true);
      expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.canRedo).toBe(false); expect(allEvents()).toHaveLength(index + 1);
      expect(app!.session.score.staves[0].measures).toHaveLength(8); expect(app!.session.source.querySelector('music-rest')).toBeNull();
      const current = voice(barIndex).events[noteIndex]; expect(current).toBeDefined();
      expect(current.kind).toBe('note'); expect(current.pitches.map(pitchText)).toEqual([`${letter}4`]); expect(current.duration).toBe('quarter'); expect(current.dots).toBe(0);
      expect(current.time).toEqual({ numerator: 1, denominator: 4 });
      expect(current.onset).toEqual([{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 4 }, { numerator: 1, denominator: 2 }, { numerator: 3, denominator: 4 }][noteIndex]);
      expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: `bar-${barIndex + 1}`, voiceIndex: 0, eventId: current.id });
      scoreOnly();
      eventIds.push(current.id); expectedPitches.push(`${letter}4`); checkpoints.push(app!.session.project.sourceHtml);
    }
    expect(new Set(eventIds).size).toBe(32); expect(allEvents().map(item => item.id)).toEqual(eventIds);
    expect(allEvents().map(item => pitchText(item.pitches[0]))).toEqual(expectedPitches);
    for (const measure of app!.session.score.staves[0].measures) {
      expect(measure.voices[0].events).toHaveLength(4);
      const last = measure.voices[0].events[3]; expect(add(last.onset, last.time)).toEqual({ numerator: 1, denominator: 1 });
      expect(measure.incomplete).toBe(true); // Authored draft review is not silently cleared by entry.
    }
    expect(app!.session.revision).toBe(initial.revision + 32);
    expect(actions.filter(action => action.startsWith('click:'))).toEqual([]);
    expect(actions.filter(action => action.startsWith('field:') || action.startsWith('disclose:') || action.startsWith('source:'))).toEqual([]);
    expect(actions.filter(action => action === 'key:ArrowRight')).toHaveLength(7);
    expect(actions.filter(action => /^key:[A-G]$/.test(action))).toHaveLength(32);
    for (let count = 31; count >= 0; count--) {
      await press('z', { ctrlKey: true }); expect(app!.session.project.sourceHtml).toBe(checkpoints[count]);
      expect(allEvents()).toHaveLength(count); expect(allEvents().map(item => item.id)).toEqual(eventIds.slice(0, count));
      expect(historyTarget()).toEqual(insertionTargets[count]);
      expect(app!.session.canUndo).toBe(count > 0); expect(app!.session.canRedo).toBe(true); writing(true);
    }
    expect(app!.session.project.sourceHtml).toBe(initial.source); expect(app!.session.source.querySelector('music-rest')).toBeNull();
  }, 15000);

  it('alternates notes and authored quarter rests through N/R then Enter, without Properties or per-event Insert', async () => {
    mount(emptyBars(2)); expect(allEvents()).toEqual([]); const initial = accepted(), checkpoints = [initial.source];
    const insertionTargets: ReturnType<typeof historyTarget>[] = [];
    actions.length = 0; await click('toggle-entry'); writing(true); expect(authorActiveElement(document)).toBe(el('score-editor'));
    await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '0'); await click('close-entry-value');
    await click('toggle-entry'); writing(true); noEdit(initial); actions.length = 0;
    const ids: string[] = [];
    for (let index = 0; index < 8; index++) {
      if (index === 4) { const before = accepted(); await press('ArrowRight'); noEdit(before, false); writing(true); scoreOnly(); }
      const beforeChoice = accepted(), beforeRecipe = recipe();
      const kind = index % 2 ? 'rest' : 'note'; await press(kind === 'rest' ? 'R' : 'N'); writing(true); noEdit(beforeChoice);
      expect(el<HTMLSelectElement>('event-kind').value).toBe(kind); expect(el<HTMLInputElement>('event-measure-rest').checked).toBe(false);
      for (const id of ['event-pitch', 'event-duration', 'event-dots', 'event-beam', 'insert-position']) expect(recipe().values[id]).toBe(beforeRecipe.values[id]);
      const before = accepted(); insertionTargets.push(historyTarget());
      const written = await press('Enter'); expect(written.defaultPrevented).toBe(true); writing(true);
      expect(app!.session.revision).toBe(before.revision + 1); expect(allEvents()).toHaveLength(index + 1);
      const next = voice(Math.floor(index / 4)).events[index % 4]; ids.push(next.id);
      expect(next.kind).toBe(kind); expect(next.measureRest).not.toBe(true); expect(next.duration).toBe('quarter'); expect(next.dots).toBe(0);
      expect(next.time).toEqual({ numerator: 1, denominator: 4 }); expect(next.pitches.map(pitchText)).toEqual(kind === 'rest' ? [] : ['C4']);
      scoreOnly(); expect(app!.session.score.staves[0].measures).toHaveLength(2);
      checkpoints.push(app!.session.project.sourceHtml);
    }
    expect(allEvents().map(item => item.kind)).toEqual(['note', 'rest', 'note', 'rest', 'note', 'rest', 'note', 'rest']);
    expect(new Set(ids).size).toBe(8); expect(actions.filter(action => action.startsWith('click:'))).toEqual([]);
    expect(actions.filter(action => action === 'key:Enter')).toHaveLength(8); expect(actions.filter(action => action === 'key:ArrowRight')).toHaveLength(1);
    expect(actions.filter(action => /^key:[NR]$/.test(action))).toHaveLength(8);
    for (let count = 7; count >= 0; count--) {
      await press('z', { ctrlKey: true }); expect(app!.session.project.sourceHtml).toBe(checkpoints[count]);
      expect(allEvents().map(item => item.id)).toEqual(ids.slice(0, count)); expect(historyTarget()).toEqual(insertionTargets[count]);
      expect(app!.session.canUndo).toBe(count > 0); writing(true);
    }
    expect(allEvents()).toEqual([]); expect(app!.session.source.querySelector('music-rest')).toBeNull();
  });

  it('writes the composer’s eight-bar mixed note/rest study through keyboard recipes and reverses exactly 30 accepted events', async () => {
    type Step = readonly [kind: 'N' | 'R', duration: 'eighth' | 'quarter' | 'half', dots: 0 | 1, pitch?: string];
    const bars: Step[][] = [
      [['N', 'quarter', 0, 'F4'], ['R', 'quarter', 0], ['N', 'quarter', 0, 'G4'], ['R', 'quarter', 0]],
      [['N', 'eighth', 0, 'A4'], ['R', 'eighth', 0], ['N', 'quarter', 0, 'G4'], ['R', 'quarter', 0], ['N', 'quarter', 0, 'F4']],
      [['N', 'quarter', 1, 'E4'], ['R', 'eighth', 0], ['N', 'quarter', 0, 'D4'], ['R', 'quarter', 0]],
      [['R', 'half', 0], ['N', 'quarter', 0, 'C4'], ['N', 'quarter', 0, 'D4']],
      [['N', 'quarter', 0, 'Fqs4'], ['R', 'quarter', 0], ['N', 'quarter', 0, 'Gqs4'], ['R', 'quarter', 0]],
      [['N', 'eighth', 0, 'A4'], ['R', 'eighth', 0], ['N', 'eighth', 0, 'G4'], ['R', 'eighth', 0], ['N', 'half', 0, 'F4']],
      [['R', 'half', 1], ['N', 'quarter', 0, 'E4']],
      [['N', 'half', 0, 'D4'], ['R', 'quarter', 0], ['N', 'quarter', 0, 'C4']],
    ];
    const fraction = (eighths: number) => {
      const divisor = eighths % 8 === 0 ? 8 : eighths % 4 === 0 ? 4 : eighths % 2 === 0 ? 2 : 1;
      return { numerator: eighths / divisor, denominator: 8 / divisor };
    };
    const music = (item: MusicEvent) => ({ id: item.id, kind: item.kind, duration: item.duration, dots: item.dots,
      onset: item.onset, time: item.time, measureRest: item.measureRest, pitches: item.pitches.map(pitchText) });
    mount(emptyBars(8)); expect(allEvents()).toEqual([]); expect(app!.session.source.querySelector('music-rest')).toBeNull();
    expect(app!.session.score.staves[0].measures.every(bar => bar.incomplete && bar.voices.length === 1 && !bar.voices[0].events.length)).toBe(true);
    expect(el<HTMLSelectElement>('insert-position').value).toBe('after'); expect(el<HTMLInputElement>('continuation-enabled').checked).toBe(false);
    const initial = accepted(), checkpoints = [initial.source], ids: string[] = [], expected: object[][] = bars.map(() => []);
    const insertionTargets: ReturnType<typeof historyTarget>[] = [];
    const originalIds = new Set([app!.session.source.id, ...[...app!.session.source.querySelectorAll('[id]')].map(node => node.id)]);
    let valueMenus = 0, pitchMenus = 0, plannedPitch = 'F4', plannedDuration: Step[1] = 'quarter', plannedDots: Step[2] = 0;
    actions.length = 0; await click('toggle-entry'); writing(true); noEdit(initial); expect(authorActiveElement(document)).toBe(el('score-editor'));
    const choosePitch = async (pitch: string) => {
      const before = accepted(), selection = app!.session.selection; pitchMenus++;
      await click('entry-settings-trigger'); expect(el('entry-settings').hidden).toBe(false); await field('event-pitch', pitch);
      await click('close-entry-settings'); expect(el('entry-settings').hidden).toBe(true);
      // Already writing: this activation returns focus, without another mode choice.
      await click('toggle-entry'); writing(true); noEdit(before); expect(app!.session.selection).toEqual(selection);
      expect(authorActiveElement(document)).toBe(el('score-editor')); expect(el<HTMLInputElement>('event-pitch').value).toBe(pitch);
    };
    const chooseValue = async (duration: Step[1], dots: Step[2]) => {
      const before = accepted(), selection = app!.session.selection; valueMenus++;
      await click('entry-value-trigger'); expect(el('entry-value-chooser').hidden).toBe(false);
      await field('event-duration', duration); await field('event-dots', String(dots));
      await click('close-entry-value'); expect(el('entry-value-chooser').hidden).toBe(true);
      await click('toggle-entry'); writing(true); noEdit(before); expect(app!.session.selection).toEqual(selection);
      expect(authorActiveElement(document)).toBe(el('score-editor'));
    };
    await choosePitch(plannedPitch); await chooseValue(plannedDuration, plannedDots); noEdit(initial);
    for (const [barIndex, steps] of bars.entries()) {
      if (barIndex > 0) {
        const before = accepted(), selection = app!.session.selection, palette = recipe();
        const moved = await press('ArrowRight'); expect(moved.defaultPrevented).toBe(true); writing(true); noEdit(before, false);
        expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: `bar-${barIndex + 1}`, voiceIndex: 0 });
        expect(app!.session.selection).toEqual(selection); expect(recipe()).toEqual(palette); expect(voice(barIndex).events).toEqual([]);
        scoreOnly();
      }
      let onset = 0;
      for (const [kind, duration, dots, spelling] of steps) {
        const beforeChoice = accepted(), previousRecipe = recipe(), selection = app!.session.selection;
        expect(authorActiveElement(document)).toBe(el('score-editor')); const chosen = await press(kind);
        expect(chosen.defaultPrevented).toBe(true); writing(true); noEdit(beforeChoice); expect(app!.session.selection).toEqual(selection);
        expect(el<HTMLSelectElement>('event-kind').value).toBe(kind === 'N' ? 'note' : 'rest'); expect(recipe().measureRest).toBe(false);
        for (const id of ['event-pitch', 'event-duration', 'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position']) {
          expect(recipe().values[id]).toBe(previousRecipe.values[id]);
        }
        const wantedPitch = spelling ?? 'F4';
        if (kind === 'N' && wantedPitch !== plannedPitch) { await choosePitch(wantedPitch); plannedPitch = wantedPitch; }
        if (duration !== plannedDuration || dots !== plannedDots) { await chooseValue(duration, dots); plannedDuration = duration; plannedDots = dots; }
        expect(el<HTMLInputElement>('event-pitch').value).toBe(plannedPitch);
        const before = accepted(), palette = recipe(); insertionTargets.push(historyTarget()); const inserted = await press('Enter');
        expect(inserted.defaultPrevented).toBe(true); writing(true); expect(recipe()).toEqual(palette);
        expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.canRedo).toBe(false);
        const current = voice(barIndex).events[expected[barIndex].length]; expect(current).toBeDefined();
        expect(current.id).toBeTruthy(); expect(originalIds.has(current.id)).toBe(false); expect(ids).not.toContain(current.id); ids.push(current.id);
        const span = { eighth: 1, quarter: 2, half: 4 }[duration] * (dots ? 1.5 : 1);
        expected[barIndex].push({ id: current.id, kind: kind === 'N' ? 'note' : 'rest', duration, dots,
          onset: fraction(onset), time: fraction(span), measureRest: false, pitches: kind === 'N' ? [wantedPitch] : [] });
        expect(voice(barIndex).events.map(music)).toEqual(expected[barIndex]); onset += span;
        expect(allEvents()).toHaveLength(ids.length); expect(allEvents().map(item => item.id)).toEqual(ids);
        expect(app!.session.score.staves).toHaveLength(1); expect(app!.session.score.staves[0].measures).toHaveLength(8);
        const node = app!.session.source.querySelector(`[id="${current.id}"]`);
        expect(node?.localName).toBe(kind === 'N' ? 'music-note' : 'music-rest'); expect(node?.parentElement?.id).toBe(`voice-${barIndex + 1}`);
        expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: `bar-${barIndex + 1}`, voiceIndex: 0, eventId: current.id });
        scoreOnly(); checkpoints.push(app!.session.project.sourceHtml);
      }
      expect(onset).toBe(8); const last = voice(barIndex).events.at(-1)!;
      expect(add(last.onset, last.time)).toEqual({ numerator: 1, denominator: 1 });
      expect(app!.session.score.staves[0].measures[barIndex].incomplete).toBe(true);
    }
    const measures = app!.session.score.staves[0].measures;
    expect(measures.map(bar => bar.id)).toEqual(bars.map((_, index) => `bar-${index + 1}`));
    expect(measures.map(bar => bar.number)).toEqual(bars.map((_, index) => String(index + 1)));
    expect(measures.every(bar => bar.meter.display === '4/4' && bar.voices.length === 1 && bar.incomplete)).toBe(true);
    expect(app!.session.source.querySelectorAll('music-measure[incomplete]')).toHaveLength(8);
    expect(measures.map(bar => bar.voices[0].id)).toEqual(bars.map((_, index) => `voice-${index + 1}`));
    expect(measures.map(bar => bar.voices[0].events.map(music))).toEqual(expected);
    expect(ids).toHaveLength(30); expect(new Set(ids).size).toBe(30); expect(allEvents().filter(item => item.kind === 'note')).toHaveLength(17);
    expect(allEvents().filter(item => item.kind === 'rest')).toHaveLength(13); expect(app!.session.source.querySelectorAll('music-note, music-rest')).toHaveLength(30);
    const sourceIds = [app!.session.source.id, ...[...app!.session.source.querySelectorAll('[id]')].map(node => node.id)];
    expect(new Set(sourceIds).size).toBe(sourceIds.length); expect(sourceIds).toHaveLength(originalIds.size + 30);
    expect(app!.session.revision).toBe(initial.revision + 30); expect(app!.session.project.parts).toEqual(initial.parts); expect(app!.session.project.layouts).toEqual(initial.layouts);
    expect(actions.filter(action => /^key:[NR]$/.test(action))).toEqual(bars.flatMap(bar => bar.map(step => `key:${step[0]}`)));
    expect(actions.filter(action => action === 'key:Enter')).toHaveLength(30); expect(actions.filter(action => action === 'key:ArrowRight')).toHaveLength(7);
    expect(valueMenus).toBe(14); expect(pitchMenus).toBe(17);
    expect(actions.filter(action => action === 'click:entry-value-trigger')).toHaveLength(valueMenus);
    expect(actions.filter(action => action === 'click:entry-settings-trigger')).toHaveLength(pitchMenus);
    expect(actions.filter(action => action === 'click:toggle-entry')).toHaveLength(1 + valueMenus + pitchMenus);
    expect(actions.filter(action => !/^(?:key:(?:N|R|Enter|ArrowRight)|click:(?:toggle-entry|entry-value-trigger|close-entry-value|entry-settings-trigger|close-entry-settings)|field:(?:event-duration|event-dots|event-pitch))$/.test(action))).toEqual([]);
    const finalRecipe = recipe();
    for (let remaining = 29; remaining >= 0; remaining--) {
      const revision = app!.session.revision; await press('z', { ctrlKey: true });
      expect(app!.session.revision).toBe(revision + 1); expect(app!.session.project.sourceHtml).toBe(checkpoints[remaining]);
      expect(historyTarget()).toEqual(insertionTargets[remaining]);
      expect(allEvents().map(item => item.id)).toEqual(ids.slice(0, remaining)); expect(app!.session.canUndo).toBe(remaining > 0);
      expect(app!.session.canRedo).toBe(true); expect(recipe()).toEqual(finalRecipe); writing(true);
    }
    expect(app!.session.project.sourceHtml).toBe(initial.source); expect(allEvents()).toEqual([]);
    expect(app!.session.source.querySelector('music-rest')).toBeNull(); expect(app!.session.score.staves[0].measures).toHaveLength(8);
  }, 20000);

  it.each(['before', 'after', 'replace'])('Arrow keys retain Writing and the configured %s policy while reaching an empty existing bar', async position => {
    mount(); await startC(); await click('entry-settings-trigger'); await field('insert-position', position); await click('close-entry-settings');
    await click('toggle-entry'); const before = accepted(), palette = recipe(), selection = app!.session.selection;
    await press('ArrowRight'); writing(true); noEdit(before, false); expect(recipe()).toEqual(palette); expect(app!.session.selection).toEqual(selection);
    expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-d', voiceIndex: 0 }); expect(voice(3).events).toEqual([]);
    await press('ArrowLeft'); writing(true); noEdit(before); expect(recipe()).toEqual(palette); expect(app!.session.selection).toEqual(selection);
  });

  it('Writing arrows do not skip a missing voice or silently switch to another voice', async () => {
    const source = abcSource.replace('<music-voice id="voice-c">', '<music-voice id="voice-c-upper"><music-rest measure></music-rest></music-voice><music-voice id="voice-c">');
    mount(source); await select('c'); await click('location-trigger'); await click('start-entry-here');
    expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-c', voiceIndex: 1, eventId: 'c' });
    const before = accepted(), selection = app!.session.selection, palette = recipe();
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      await press(key); writing(true); noEdit(before); expect(app!.session.selection).toEqual(selection); expect(recipe()).toEqual(palette);
      expect(app!.session.score.staves[0].measures.map(bar => bar.voices.length)).toEqual([1, 1, 2, 1]);
    }
  });

  it('visible Note/Rest choices change only the next-event recipe, while native field N/R/Enter remain native', async () => {
    mount(emptyBars(1)); await click('toggle-entry'); const before = accepted(), original = recipe();
    await click('entry-settings-trigger'); await click('entry-choose-rest'); writing(true); noEdit(before);
    expect(el<HTMLSelectElement>('event-kind').value).toBe('rest'); expect(allEvents()).toEqual([]);
    // Reopen through the invoker only if the deliberate quick choice closed its surface.
    if (el('entry-settings').hidden) await click('entry-settings-trigger');
    await click('entry-choose-note'); writing(true); noEdit(before); expect(recipe()).toEqual(original);
    if (el('entry-settings').hidden) await click('entry-settings-trigger');
    const pitch = el<HTMLInputElement>('event-pitch'); expect(available(pitch)).toBe(true); pitch.focus();
    for (const key of ['N', 'R', 'Enter', 'ArrowLeft', 'ArrowRight']) {
      const native = await press(key); expect(native.defaultPrevented).toBe(false); noEdit(before); expect(recipe()).toEqual(original);
      expect(authorActiveElement(document)).toBe(pitch);
    }
  });

  it.each(['Fqs5', 'unfinished pitch'])('authored rest entry preserves dormant note recipe %s exactly and does not parse it as rest pitch', async pitch => {
    mount(emptyBars(1)); await click('toggle-entry');
    await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '1'); await click('close-entry-value');
    await click('entry-settings-trigger'); await field('event-pitch', pitch); await field('event-accidental-display', 'courtesy'); await field('event-stem', 'down');
    await click('close-entry-settings'); await click('toggle-entry');
    const before = accepted(), dormant = recipe();
    await press('R'); writing(true); noEdit(before);
    const restRecipe = { ...dormant, values: { ...dormant.values, 'event-kind': 'rest' } };
    expect(recipe()).toEqual(restRecipe); const restKey = await press('Enter'); expect(restKey.defaultPrevented).toBe(true);
    expect(voice(0).events).toHaveLength(1); const rest = voice(0).events[0];
    expect(rest.kind).toBe('rest'); expect(rest.pitches).toEqual([]); expect(rest.measureRest).not.toBe(true);
    expect(rest.duration).toBe('quarter'); expect(rest.dots).toBe(1); expect(rest.onset).toEqual({ numerator: 0, denominator: 1 });
    expect(rest.time).toEqual({ numerator: 3, denominator: 8 }); expect(app!.session.revision).toBe(before.revision + 1);
    expect(recipe()).toEqual(restRecipe); expect(app!.session.source.querySelector('music-rest')?.hasAttribute('pitch')).toBe(false);
    const afterRest = accepted(); await press('N'); writing(true); noEdit(afterRest); expect(recipe()).toEqual(dormant);
    if (pitch === 'unfinished pitch') {
      await press('Enter'); noEdit(afterRest); expect(recipe()).toEqual(dormant); expect(voice(0).events.map(item => item.id)).toEqual([rest.id]);
      expect(el('author-errors').textContent).toMatch(/pitch/i);
    }
    await press('z', { ctrlKey: true }); expect(app!.session.project.sourceHtml).toBe(before.source); expect(allEvents()).toEqual([]);
    expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(true); expect(recipe()).toEqual(dormant); writing(true);
  });
});

describe('correction and explicit recovery preserve the saved writing owner', () => {
  it.each([1180, 390])('corrects F4 to F#4 and resumes C in the declared action count at width policy %s', async width => {
    // The width chooses the intended desktop/phone route. This does not qualify
    // responsive CSS, task-sheet geometry, or trusted touchscreen activation.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    mount(); await startC(true); const before = accepted(), palette = recipe(), draft = heldDraft();
    expect(draft).toEqual({ target: 'a', state: 'dirty', pitch: 'Gqf4' });
    expect(event('b').pitches.map(pitchText)).toEqual(['F4']); actions.length = 0;
    await click('select-mode'); await select('b');
    if (width < 1100) { await click('selection-pitch'); await click('selection-chooser-sharp'); }
    else await click('selection-sharp');
    const correctedSelection = app!.session.selection; await click('toggle-entry'); writing(true);
    expect(actions).toEqual(width < 1100
      ? ['click:select-mode', 'source:b', 'click:selection-pitch', 'click:selection-chooser-sharp', 'click:toggle-entry']
      : ['click:select-mode', 'source:b', 'click:selection-sharp', 'click:toggle-entry']);
    expect(event('b').pitches.map(pitchText)).toEqual(['F#4']); expect(event('a').pitches.map(pitchText)).toEqual(['F4']);
    expect(app!.session.revision).toBe(before.revision + 1); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    expect(app!.session.selection).toEqual(correctedSelection); expect(app!.session.cursor).toEqual(before.cursor);
    const identity = selectedIdentity(); await press('z', { ctrlKey: true }); writing(true);
    expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(true);
    expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); expect(selectedIdentity()).toEqual(identity);
  });

  it('a removed bookmark cannot make fixed Write silently use selected B; Start writing here is the explicit recovery', async () => {
    mount(); await startC(); await click('select-mode');
    const next = app!.session.source.cloneNode(true) as HTMLElement; next.querySelector('#c')!.remove();
    await click('source-trigger'); await field('source-input', next.outerHTML); await click('source-apply'); await click('close-source');
    expect(app!.session.project.pendingSource).toBeNull(); expect(allEvents().some(item => item.id === 'c')).toBe(false); expect(voice(2).events).toEqual([]);
    await select('b'); const before = accepted(), palette = recipe(), selection = app!.session.selection;
    await click('toggle-entry'); writing(false); noEdit(before); expect(recipe()).toEqual(palette); expect(app!.session.selection).toEqual(selection);
    expect(el('entry-mode-reason').hidden).toBe(false); expect(el('entry-mode-reason').textContent).toMatch(/resume|unavailable|changed/i);
    expect(el('toggle-entry').textContent).toMatch(/Write notes/i);
    await click('location-trigger'); expect(available(el('start-entry-here'))).toBe(true); await click('start-entry-here'); writing(true);
    noEdit(before, false); expect(recipe()).toEqual(palette); expect(app!.session.selection).toEqual(selection);
    expect(app!.session.cursor).toEqual({ staffId: 'lead', measureId: 'bar-b', voiceIndex: 0, eventId: 'b' });
  });

  it('pending Source preserves Write intent through views but blocks entry without applying or discarding either draft', async () => {
    mount(); await startC(true); const palette = recipe(), draft = heldDraft();
    await click('source-trigger'); const raw = `${app!.session.project.sourceHtml}\n<!-- deliberately unapplied source -->`;
    await field('source-input', raw); await click('close-source'); writing(true); const before = accepted();
    expect(before.pending).toBe(raw);
    await click('view-read'); await click('view-pages'); await click('view-write'); writing(true); noEdit(before);
    await click('toggle-entry'); expect(authorActiveElement(document)).toBe(el('score-editor')); writing(true); noEdit(before);
    const rejected = await press('Enter'); expect(rejected.defaultPrevented).toBe(true); noEdit(before);
    expect(app!.session.project.pendingSource).toBe(raw); expect(el<HTMLTextAreaElement>('source-input').value).toBe(raw);
    expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft); expect(el('author-errors').textContent).toMatch(/Apply or Revert|Source draft/i);
  });

  it('an invalid next pitch survives menu and view roundtrips without silent repair or an accepted insertion', async () => {
    mount(); await startC(true); await click('entry-settings-trigger'); await field('event-pitch', 'not-a-pitch'); await click('close-entry-settings');
    const before = accepted(), palette = recipe(), draft = heldDraft();
    await click('view-read'); await click('view-pages'); await click('view-write'); writing(true); noEdit(before);
    expect(recipe()).toEqual(palette); expect(el<HTMLInputElement>('event-pitch').value).toBe('not-a-pitch'); expect(heldDraft()).toEqual(draft);
    await click('toggle-entry'); expect(authorActiveElement(document)).toBe(el('score-editor')); noEdit(before);
    await press('Enter'); noEdit(before); expect(recipe()).toEqual(palette); expect(heldDraft()).toEqual(draft);
    expect(el('author-errors').hidden).toBe(false); expect(el('author-errors').textContent).toMatch(/pitch/i);
  });
});
