// @vitest-environment happy-dom
/**
 * Public Author routes for an implicit end-of-voice writing position.
 * Only engraving dispatch is stubbed. These synthetic controls and key events
 * cover navigation/transaction ownership, not native focus, geometry or input.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { pitchText } from '../src/model/index.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = `<music-staff id="lead" label="Lead">
  <music-measure id="bar-a" number="1" meter="4/4"><music-voice id="voice-a"><music-note id="a" pitch="F4" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-b" number="2"><music-voice id="voice-b"><music-note id="b" pitch="G4" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-c" number="3" incomplete><music-voice id="voice-c"><music-note id="c-first" pitch="E4" duration="quarter"></music-note><music-note id="c-last" pitch="G4" duration="quarter"></music-note></music-voice></music-measure>
  <music-measure id="bar-d" number="4" incomplete><music-voice id="voice-d"></music-voice></music-measure>
</music-staff>`;
const implicitEnd = { staffId: 'lead', measureId: 'bar-c', voiceIndex: 0 };
const nextBarStart = { staffId: 'lead', measureId: 'bar-d', voiceIndex: 0 };
let app: AuthorWorkspace | undefined;
let sequence = 0;
let widthDescriptor: PropertyDescriptor | undefined;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element as T;
}
function available(element: HTMLElement): boolean {
  if (element.closest('[hidden],[inert],[aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function disclose(element: HTMLElement): Promise<void> {
  const parents: HTMLDetailsElement[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parents.unshift(parent);
  for (const details of parents) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true);
    summary!.click(); await flush(); expect(details.open).toBe(true);
  }
}
async function click(id: string): Promise<void> {
  const target = el(id); await disclose(target); expect(available(target), `#${id} is available`).toBe(true);
  target.click(); await flush();
}
async function field(id: string, value: string): Promise<void> {
  const target = el<HTMLInputElement | HTMLSelectElement>(id);
  await disclose(target); expect(available(target), `#${id} is available`).toBe(true);
  if (target instanceof HTMLSelectElement) expect([...target.options].some(option => option.value === value && !option.disabled)).toBe(true);
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function select(id: string): Promise<void> {
  const sourceElement = app!.session.source.querySelector(`[id="${id}"]`);
  expect(sourceElement).not.toBeNull(); expect(available(el('score-host'))).toBe(true);
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse',
  } })); await flush();
}
/** This helper never grants focus; the public writing route must own it. */
async function press(key: string, options: KeyboardEventInit = {}): Promise<void> {
  expect(document.activeElement).toBe(el('score-editor'));
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event); await flush();
  expect(event.defaultPrevented).toBe(true);
}
function recipe() {
  return {
    values: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
      'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position']
      .map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked,
    rhythmic: el<HTMLInputElement>('event-rhythmic').checked,
  };
}
function heldDraft() {
  return { target: el('selection-inspector').dataset.draftTarget, state: el('selection-inspector').dataset.draftState,
    pitch: el<HTMLInputElement>('selected-pitch').value };
}
/** Navigation may move only the writing cursor, not any state captured here. */
function protectedState() {
  return { source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource,
    revision: app!.session.revision, undo: app!.session.canUndo, redo: app!.session.canRedo,
    selection: app!.session.selection, palette: recipe(), draft: heldDraft(),
    parts: structuredClone(app!.session.project.parts), layouts: structuredClone(app!.session.project.layouts) };
}
function writing(): void {
  expect(document.body.dataset.entryMode).toBe('true');
  expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
  expect(el('select-mode').getAttribute('aria-pressed')).toBe('false');
  expect(el('workspace-tools').hidden).toBe(true);
  for (const id of ['location-panel', 'entry-settings', 'entry-value-chooser']) expect(el(id).hidden).toBe(true);
  expect(document.activeElement).toBe(el('score-editor'));
}
function voice(barIndex: number) { return app!.session.score.staves[0].measures[barIndex].voices[0]; }
async function setup(): Promise<void> {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `writing-navigation-${++sequence}`, writerId: 'writing-navigation-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Writing navigation regression'), recovery });
  await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
  expect(heldDraft()).toEqual({ target: 'a', state: 'dirty', pitch: 'Gqf4' });
  await click('tools-hide');
  // Selecting the measure, not either existing note, establishes eventId-free C.
  await select('bar-c'); await click('location-trigger'); await click('start-entry-here');
  expect(app!.session.cursor).toEqual(implicitEnd);
  await click('entry-settings-trigger'); await field('event-pitch', 'Fqs5'); await field('insert-position', 'after');
  await field('event-accidental-display', 'courtesy'); await field('event-stem', 'down'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '0'); await click('close-entry-value');
  // Keep selection B independent from the saved writing point and held draft A.
  await click('select-mode'); await select('b'); await click('toggle-entry'); writing();
  expect(app!.session.cursor).toEqual(implicitEnd);
  expect(app!.session.selection.ids).toEqual(['b']);
  expect(heldDraft()).toEqual({ target: 'a', state: 'dirty', pitch: 'Gqf4' });
  expect(voice(2).events.map(event => event.id)).toEqual(['c-first', 'c-last']);
  expect(app!.session.score.staves[0].measures[2].incomplete).toBe(true);
  expect(voice(3).events).toEqual([]);
  expect(app!.session.source.querySelector('music-rest')).toBeNull();
  expect(app!.session.canUndo).toBe(false);
}
async function expectOneInsertionAt(barIndex: number, onset: { numerator: number; denominator: number }, before: ReturnType<typeof protectedState>): Promise<void> {
  const existing = structuredClone(app!.session.score.staves[0].measures.map(measure => measure.voices[0].events));
  await press('Enter'); writing();
  expect(app!.session.revision).toBe(before.revision + 1);
  expect(app!.session.score.staves[0].measures).toHaveLength(4);
  for (let index = 0; index < 4; index++) {
    if (index !== barIndex) expect(voice(index).events).toEqual(existing[index]);
  }
  expect(voice(barIndex).events).toHaveLength(existing[barIndex].length + 1);
  expect(voice(barIndex).events.slice(0, -1)).toEqual(existing[barIndex]);
  const inserted = voice(barIndex).events.at(-1)!;
  expect(inserted.kind).toBe('note'); expect(inserted.pitches.map(pitchText)).toEqual(['Fqs5']);
  expect(inserted.duration).toBe('quarter'); expect(inserted.dots).toBe(0);
  expect(inserted.onset).toEqual(onset); expect(inserted.time).toEqual({ numerator: 1, denominator: 4 });
  expect(app!.session.source.querySelector('music-rest')).toBeNull();
  expect(recipe()).toEqual(before.palette); expect(heldDraft()).toEqual(before.draft);
  await press('z', { ctrlKey: true }); writing();
  expect(app!.session.project.sourceHtml).toBe(before.source);
  expect(app!.session.project.pendingSource).toBe(before.pending);
  expect(app!.session.canUndo).toBe(false); expect(app!.session.canRedo).toBe(true);
  expect(app!.session.selection.ids).toEqual(['b']);
  expect(recipe()).toEqual(before.palette); expect(heldDraft()).toEqual(before.draft);
}

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  app?.dispose(); app = undefined; await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
  if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
});

describe('WRITING-IMPLICIT-END-ARROW with After target', () => {
  it('Enter at an occupied eventId-free measure appends after its last actual event', async () => {
    await setup(); const before = protectedState();
    await expectOneInsertionAt(2, { numerator: 1, denominator: 2 }, before);
    expect(app!.session.cursor).toEqual(implicitEnd);
  });

  it('ArrowRight from the implicit end reaches the adjacent empty bar and Enter writes at its onset zero', async () => {
    await setup(); const before = protectedState();
    await press('ArrowRight'); writing();
    expect(app!.session.cursor, 'After with no eventId is the occupied voice end, not a position before its first note').toEqual(nextBarStart);
    expect(protectedState()).toEqual(before);
    await expectOneInsertionAt(3, { numerator: 0, denominator: 1 }, before);
    expect(app!.session.cursor).toEqual(nextBarStart);
  });

  it('ArrowLeft from the implicit end reaches the last actual event and forward navigation agrees with that end', async () => {
    await setup(); const before = protectedState();
    await press('ArrowLeft'); writing();
    expect(app!.session.cursor).toEqual({ ...implicitEnd, eventId: 'c-last' }); expect(protectedState()).toEqual(before);
    await press('ArrowLeft'); writing();
    expect(app!.session.cursor).toEqual({ ...implicitEnd, eventId: 'c-first' }); expect(protectedState()).toEqual(before);
    await press('ArrowRight'); writing();
    expect(app!.session.cursor).toEqual({ ...implicitEnd, eventId: 'c-last' }); expect(protectedState()).toEqual(before);
    await press('ArrowRight'); writing();
    expect(app!.session.cursor).toEqual(nextBarStart); expect(protectedState()).toEqual(before);
  });
});
