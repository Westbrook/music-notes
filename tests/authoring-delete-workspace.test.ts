// @vitest-environment happy-dom
/**
 * Delete shortcuts through the actual Author shell, session and controllers.
 * Only engraving dispatch is stubbed. Public notation-select events verify the
 * app's focus handoff; these are not trusted browser or glyph hit-test claims.
 */
import { authorActiveElement, authorControlParent, findAuthorControl, mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { pitchText } from '../src/model/index.js';

const source = `<music-staff id="lead" label="Lead">
  <music-measure id="bar-12" number="12"><music-voice id="voice-12">
    <music-note id="a" pitch="F4" duration="quarter"><music-articulation id="a-accent" type="accent"></music-articulation><music-ornament id="a-turn" type="turn"></music-ornament></music-note>
    <music-note id="b" pitch="G4" duration="quarter"></music-note><music-note id="c" pitch="A4" duration="quarter"></music-note><music-note id="d" pitch="Bb4" duration="quarter"></music-note>
  </music-voice><music-voice id="voice-12-lower"><music-note id="lower-a" pitch="C3" duration="half"></music-note><music-note id="lower-b" pitch="D3" duration="half"></music-note></music-voice></music-measure>
  <music-measure id="bar-13" number="13"><music-voice id="voice-13"><music-note id="solo" pitch="C5" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-14" number="14"><music-voice id="voice-14"><music-rest id="writer" measure></music-rest></music-voice></music-measure>
</music-staff>`;
const keys = ['Delete', 'Backspace'] as const;
let app: AuthorWorkspace | undefined;
let sequence = 0;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl<T>(document, id); if (!element) throw new Error(`Missing actual Author control #${id}.`); return element;
}
function available(element: HTMLElement): boolean {
  if (element.matches(':disabled')) return false;
  let child = element;
  for (let parent: HTMLElement | null = element; parent; parent = authorControlParent(parent)) {
    if (parent.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(child)) return false;
    child = parent;
  }
  return true;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function disclose(element: HTMLElement): Promise<void> {
  const parents: HTMLDetailsElement[] = [];
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) if (parent instanceof HTMLDetailsElement) parents.unshift(parent);
  for (const details of parents) if (!details.open) { const summary = details.querySelector<HTMLElement>(':scope > summary'); expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true); summary!.click(); await flush(); expect(details.open).toBe(true); }
}
async function click(id: string): Promise<void> { const target = el(id); await disclose(target); expect(available(target), `#${id} is available`).toBe(true); target.click(); await flush(); }
async function field(id: string, value: string): Promise<void> {
  const target = el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id); await disclose(target); expect(available(target), `#${id} is available`).toBe(true);
  if (target instanceof HTMLSelectElement) expect([...target.options].some(option => option.value === value && !option.disabled)).toBe(true);
  target.value = value; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
function mount(html = source): AuthorWorkspace {
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `delete-workspace-${++sequence}`, writerId: 'delete-tests',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(html, 'Delete integration'), recovery }); return app;
}
async function select(id: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}): Promise<void> {
  const sourceElement = app!.session.source.id === id ? app!.session.source : app!.session.source.querySelector(`[id="${id}"]`); expect(sourceElement).not.toBeNull();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse', ...modifiers,
  } })); await flush();
}
/** Do not focus the score here: successful selection must have done that itself. */
async function press(value: string, options: KeyboardEventInit = {}, target = authorActiveElement(document)): Promise<KeyboardEvent> {
  expect(target).toBeInstanceOf(HTMLElement);
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true, ...options }); target!.dispatchEvent(event); await flush(); return event;
}
function recipe() {
  return { values: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
    'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked, rhythmic: el<HTMLInputElement>('event-rhythmic').checked };
}
function accepted() {
  return { source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource, revision: app!.session.revision,
    undo: app!.session.canUndo, redo: app!.session.canRedo, selection: app!.session.selection, cursor: app!.session.cursor, recipe: recipe(),
    parts: structuredClone(app!.session.project.parts), layouts: structuredClone(app!.session.project.layouts) };
}
function unchanged(before: ReturnType<typeof accepted>): void { expect(accepted()).toEqual(before); }
function identity(selection = app!.session.selection) { const { version: _version, ...identity } = selection; return identity; }
function voice(measure = 0, index = 0) { return app!.session.score.staves[0].measures[measure].voices[index]; }
function event(id: string) { return app!.session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).find(item => item.id === id); }
async function futureRecipe(writerId = 'writer'): Promise<void> {
  await select(writerId); await click('location-trigger'); await click('start-entry-here');
  await click('entry-settings-trigger'); await field('event-kind', 'note'); await field('event-pitch', 'Fqs5'); await field('event-accidental-display', 'courtesy');
  await field('event-stem', 'down'); await field('event-beam', 'none'); await field('insert-position', 'after'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'eighth'); await field('event-dots', '1'); await click('close-entry-value');
  expect(el('entry-settings').hidden).toBe(true); expect(el('entry-value-chooser').hidden).toBe(true); await click('select-mode');
}
async function undoDeletion(before: ReturnType<typeof accepted>): Promise<void> {
  await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(identity()).toEqual(identity(before.selection));
  expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(true); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name); mountAuthorFixture();
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64'); window.getSelection()?.removeAllRanges();
});
afterEach(async () => { app?.dispose(); app = undefined; await flush(); vi.clearAllMocks(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); await releaseAuthorFixture(); });

describe('selected-note deletion follows the actual score focus handoff', () => {
  it.each(keys)('%s removes only the clicked note, leaves other voices unchanged, and restores source plus selection with one Undo', async key => {
    mount(); await futureRecipe(); el('document-menu-trigger').focus(); expect(authorActiveElement(document)).toBe(el('document-menu-trigger'));
    await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor')); const before = accepted(), lower = structuredClone(voice(0, 1));
    const deleted = await press(key); expect(event('b')).toBeUndefined(); expect(deleted.defaultPrevented).toBe(true);
    expect(voice().events.map(item => item.id)).toEqual(['a', 'c', 'd']); expect(voice(0, 1)).toEqual(lower);
    expect(voice().events.map(item => item.onset)).toEqual([{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 4 }, { numerator: 1, denominator: 2 }]);
    expect(event('a')?.markings?.map(mark => mark.id)).toEqual(['a-accent', 'a-turn']); expect(voice().events.some(item => item.kind === 'rest')).toBe(false);
    expect(app!.session.score.staves[0].measures[0].incomplete).toBe(true); expect(app!.session.revision).toBe(before.revision + 1);
    expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe); expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false);
    await undoDeletion(before);
  });
  it.each(keys)('%s deletes selected B despite a held dirty Properties draft for A, without applying or discarding that draft', async key => {
    mount(); await futureRecipe(); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4'); await select('b');
    expect(authorActiveElement(document)).toBe(el('score-editor')); expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLButtonElement>('remove-event').disabled).toBe(true);
    const before = accepted(); await press(key); expect(event('b')).toBeUndefined(); expect(event('a')?.pitches.map(pitchText)).toEqual(['F4']);
    expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4'); expect(el('selection-inspector').dataset.draftState).toBe('dirty');
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
    await undoDeletion(before); expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
  });
});

describe('deletion preserves musical structure and exact selected membership', () => {
  it.each(keys)('%s removes a disjoint exact set in one Undo without deleting its holes or another voice', async key => {
    mount(); await futureRecipe(); await select('a'); await select('c', { ctrlKey: true });
    expect(app!.session.selection.ids).toEqual(['a', 'c']); expect(authorActiveElement(document)).toBe(el('score-editor'));
    const before = accepted(), lower = structuredClone(voice(0, 1)); const deleted = await press(key);
    expect(deleted.defaultPrevented).toBe(true); expect(voice().events.map(item => item.id)).toEqual(['b', 'd']);
    expect(voice().events.map(item => item.pitches.map(pitchText))).toEqual([['G4'], ['Bb4']]); expect(voice(0, 1)).toEqual(lower);
    expect(voice().events.map(item => item.onset)).toEqual([{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 4 }]);
    expect(app!.session.source.querySelector('#a-accent')).toBeNull(); expect(app!.session.source.querySelector('#a-turn')).toBeNull();
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe); await undoDeletion(before);
  });
  it.each(keys)('%s leaves a blank incomplete voice when removing its sole note, without inventing replacement music', async key => {
    mount(); await futureRecipe(); await select('solo'); const before = accepted(), firstVoice = structuredClone(voice());
    expect(authorActiveElement(document)).toBe(el('score-editor')); await press(key); expect(event('solo')).toBeUndefined();
    const measure = app!.session.score.staves[0].measures[1]; expect(measure.id).toBe('bar-13'); expect(measure.number).toBe('13');
    expect(measure.voices).toHaveLength(1); expect(voice(1).id).toBe('voice-13'); expect(voice(1).events).toEqual([]); expect(measure.incomplete).toBe(true);
    expect(app!.session.source.querySelector('#voice-13')).not.toBeNull(); expect(app!.session.source.querySelector('#voice-13 music-rest')).toBeNull(); expect(voice()).toEqual(firstVoice);
    expect(app!.session.score.staves[0].measures).toHaveLength(3); expect(app!.session.cursor).toEqual(before.cursor);
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.project.parts).toEqual(before.parts); expect(app!.session.project.layouts).toEqual(before.layouts);
    expect(recipe()).toEqual(before.recipe); await undoDeletion(before);
  });
  it.each(keys)('%s really removes a sole full-measure rest, clears old Redo and restores its exact identity with one Undo', async key => {
    mount(); await futureRecipe('b'); await select('b'); await click('selection-sharp'); await click('undo'); expect(app!.session.canRedo).toBe(true); await select('writer');
    const before = accepted(), rest = structuredClone(event('writer')); await press(key); expect(event('writer')).toBeUndefined();
    expect(voice(2).id).toBe('voice-14'); expect(voice(2).events).toEqual([]); expect(app!.session.score.staves[0].measures[2].incomplete).toBe(true);
    expect(app!.session.source.querySelector('#voice-14')).not.toBeNull(); expect(app!.session.source.querySelector('#voice-14 music-rest')).toBeNull();
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.canUndo).toBe(true); expect(app!.session.canRedo).toBe(false);
    expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe); expect(el('author-errors').hidden).toBe(true);
    await undoDeletion(before); expect(event('writer')).toEqual(rest);
  });
  it.each([['a', 'b'], ['b', 'c']])('refuses the entire selection %s + %s when any selected member belongs to a tie chain', async (first, second) => {
    mount('<music-staff id="lead"><music-measure id="bar"><music-voice id="voice"><music-note id="a" pitch="E4" duration="quarter"></music-note><music-note id="b" pitch="F4" duration="quarter" tie="start"></music-note><music-note id="c" pitch="F4" duration="quarter" tie="end"></music-note><music-note id="d" pitch="G4" duration="quarter"></music-note></music-voice></music-measure></music-staff>');
    await select(first); await select(second, { ctrlKey: true }); const before = accepted();
    for (const key of keys) { await press(key); unchanged(before); expect(el('author-errors').textContent).toMatch(/Clear connected ties before removing any tied event/i); expect(el('author-errors').hidden).toBe(false); }
    expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false);
  });
  it('refuses to empty a pickup instead of inventing a full-bar rest or erasing its pickup intent', async () => {
    mount('<music-staff id="lead"><music-measure id="pickup" pickup><music-note id="pickup-note" pitch="F4" duration="quarter"></music-note></music-measure></music-staff>');
    await select('pickup-note'); const before = accepted();
    for (const key of keys) { await press(key); unchanged(before); expect(el('author-errors').textContent).toMatch(/would empty a pickup\. Replace the selected music with written rests/i); expect(el('author-errors').hidden).toBe(false); }
  });
  it.each(keys)('%s on an exact attached mark removes only that child and restores it with one Undo', async key => {
    mount(); await futureRecipe(); await select('a-turn'); expect(el('score-editor').dataset.activeMarkingId).toBe('a-turn');
    expect(authorActiveElement(document)).toBe(el('score-editor')); const before = accepted(), owner = structuredClone(event('a')!), sibling = structuredClone(event('b'));
    await press(key); expect(event('a')).toBeDefined(); expect(event('a')?.markings).toEqual(owner.markings?.filter(mark => mark.id !== 'a-turn'));
    const { markings: _oldMarks, ...oldMusic } = owner, { markings: _newMarks, ...newMusic } = event('a')!; expect(newMusic).toEqual(oldMusic);
    expect(event('b')).toEqual(sibling); expect(app!.session.source.querySelector('#a-turn')).toBeNull(); expect(app!.session.source.querySelector('#a-accent')).not.toBeNull();
    expect(app!.session.revision).toBe(before.revision + 1); expect(recipe()).toEqual(before.recipe); expect(app!.session.cursor).toEqual(before.cursor);
    expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false); await undoDeletion(before);
  });
});

describe('written rests, blank voices and deliberate recovery', () => {
  it.each(keys)('%s removes a written rest and its fermata without replacing it or changing other voices', async key => {
    mount(source.replace('<music-note id="b" pitch="G4" duration="quarter"></music-note>', '<music-rest id="b" duration="quarter"><music-articulation id="rest-fermata" type="fermata"></music-articulation></music-rest>'));
    await futureRecipe(); await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor'));
    const before = accepted(), lower = structuredClone(voice(0, 1)), rest = structuredClone(event('b'));
    const deleted = await press(key); expect(deleted.defaultPrevented).toBe(true); expect(event('b')).toBeUndefined(); expect(app!.session.source.querySelector('#rest-fermata')).toBeNull();
    expect(voice().events.map(item => item.id)).toEqual(['a', 'c', 'd']); expect(voice().events.some(item => item.kind === 'rest')).toBe(false); expect(voice(0, 1)).toEqual(lower);
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
    await undoDeletion(before); expect(event('b')).toEqual(rest); expect(app!.session.source.querySelector('#rest-fermata')).not.toBeNull();
  });
  it.each(keys)('%s removes a disjoint mixed note/rest selection and retains the unselected notes between it', async key => {
    mount(source.replace('<music-note id="c" pitch="A4" duration="quarter"></music-note>', '<music-rest id="c" duration="quarter"></music-rest>'));
    await futureRecipe(); await select('a'); await select('c', { ctrlKey: true }); const before = accepted(), lower = structuredClone(voice(0, 1));
    expect(app!.session.selection.ids).toEqual(['a', 'c']); expect(event('a')?.kind).toBe('note'); expect(event('c')?.kind).toBe('rest'); await press(key);
    expect(voice().events.map(item => item.id)).toEqual(['b', 'd']); expect(voice().events.map(item => item.pitches.map(pitchText))).toEqual([['G4'], ['Bb4']]);
    expect(voice(0, 1)).toEqual(lower); expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
    await undoDeletion(before); expect(event('c')?.kind).toBe('rest');
  });
  it('deleting every selected note and written rest empties only that voice, keeps its container and meter, and undoes as one action', async () => {
    mount(source.replace('<music-note id="b" pitch="G4" duration="quarter"></music-note>', '<music-rest id="b" duration="quarter"></music-rest>')
      .replace('<music-note id="c" pitch="A4" duration="quarter"></music-note>', '<music-rest id="c" duration="quarter"></music-rest>'));
    await futureRecipe(); await select('a'); await select('d', { shiftKey: true }); expect(app!.session.selection.ids).toEqual(['a', 'b', 'c', 'd']);
    const before = accepted(), lower = structuredClone(voice(0, 1)), meter = structuredClone(app!.session.score.staves[0].measures[0].meter);
    await press('Delete'); expect(voice().id).toBe('voice-12'); expect(voice().events).toEqual([]); expect(voice(0, 1)).toEqual(lower);
    expect(app!.session.source.querySelector('#voice-12')).not.toBeNull(); expect(app!.session.source.querySelector('#voice-12 music-rest')).toBeNull();
    const measure = app!.session.score.staves[0].measures[0]; expect(measure.voices).toHaveLength(2); expect(measure.meter).toEqual(meter); expect(measure.incomplete).toBe(true);
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe); await undoDeletion(before);
  });
  it('removing a selected full-measure rest never applies or discards a dirty Properties draft for another note', async () => {
    mount(); await futureRecipe('b'); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4'); await select('writer');
    const before = accepted(); expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLButtonElement>('remove-event').disabled).toBe(true);
    await press('Backspace'); expect(event('writer')).toBeUndefined(); expect(voice(2).events).toEqual([]); expect(app!.session.revision).toBe(before.revision + 1);
    expect(event('a')?.pitches.map(pitchText)).toEqual(['F4']); expect(el('selection-inspector').dataset.draftTarget).toBe('a');
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4'); expect(el('selection-inspector').dataset.draftState).toBe('dirty');
    expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe); await undoDeletion(before);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4'); expect(el('selection-inspector').dataset.draftTarget).toBe('a');
  });
  it('Location explicitly starts Insert in an emptied second voice at onset zero; separate Undos restore the blank then the deleted music', async () => {
    mount(); await futureRecipe(); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
    await select('lower-a'); await select('lower-b', { ctrlKey: true }); const beforeDeletion = accepted(), upper = structuredClone(voice());
    await press('Delete'); expect(voice(0, 1).events).toEqual([]); expect(app!.session.cursor).toEqual(beforeDeletion.cursor); const blank = accepted();
    await click('location-trigger'); await field('staff-select', 'lead'); await field('measure-select', 'bar-12'); await field('event-voice', '1');
    expect(el<HTMLSelectElement>('event-voice').value).toBe('1'); await click('start-entry-here');
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(app!.session.cursor).toMatchObject({ staffId: 'lead', measureId: 'bar-12', voiceIndex: 1 });
    expect(app!.session.cursor?.eventId).toBeUndefined(); expect(app!.session.project.sourceHtml).toBe(blank.source); expect(app!.session.revision).toBe(blank.revision); expect(recipe()).toEqual(beforeDeletion.recipe);
    const insertionCursor = app!.session.cursor; await click('insert-event'); expect(app!.session.revision).toBe(blank.revision + 1); expect(voice(0, 1).events).toHaveLength(1);
    const inserted = voice(0, 1).events[0]; expect(inserted).toMatchObject({ kind: 'note', duration: 'eighth', dots: 1,
      onset: { numerator: 0, denominator: 1 }, time: { numerator: 3, denominator: 16 } }); expect(inserted.pitches.map(pitchText)).toEqual(['Fqs5']);
    expect(voice()).toEqual(upper); expect(app!.session.cursor).toMatchObject({ voiceIndex: 1, eventId: inserted.id }); expect(recipe()).toEqual(beforeDeletion.recipe);
    expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(blank.source); expect(voice(0, 1).events).toEqual([]); expect(app!.session.cursor).toEqual(insertionCursor);
    await click('select-mode'); await undoDeletion(beforeDeletion); expect(voice(0, 1).events.map(item => item.id)).toEqual(['lower-a', 'lower-b']);
    expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
  });
  it('Fill rests adds silence only after explicit confirmation; Cancel and separate Undos preserve the empty draft and prior note', async () => {
    mount(); await futureRecipe(); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4'); await select('solo');
    const beforeDeletion = accepted(); await press('Delete'); expect(voice(1).events).toEqual([]); const blank = accepted();
    await click('location-trigger'); await field('measure-select', 'bar-13'); await field('event-voice', '0'); await click('close-location');
    await click('other-tools'); await click('tool-tab-measure'); const beforeFill = accepted(); await click('fill-rests');
    expect(el<HTMLDialogElement>('author-confirmation').open).toBe(true); const plan = el('author-confirmation-message').textContent;
    expect(plan).toMatch(/bar 13.*voice 1/i); expect(plan).toContain('quarter, quarter, quarter, quarter'); unchanged(beforeFill);
    await click('author-confirmation-cancel'); unchanged(beforeFill); expect(voice(1).events).toEqual([]);
    await click('fill-rests'); expect(el('author-confirmation-message').textContent).toBe(plan); await click('author-confirmation-confirm'); expect(app!.session.revision).toBe(beforeFill.revision + 1);
    const rests = voice(1).events; expect(rests).toHaveLength(4); expect(new Set(rests.map(rest => rest.id)).size).toBe(4);
    for (const rest of rests) { expect(rest.id).not.toBe('solo'); expect(rest).toMatchObject({ kind: 'rest', duration: 'quarter', dots: 0, time: { numerator: 1, denominator: 4 } }); }
    expect(rests.map(rest => rest.onset)).toEqual([{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 4 }, { numerator: 1, denominator: 2 }, { numerator: 3, denominator: 4 }]);
    expect(app!.session.score.staves[0].measures[1].incomplete).toBe(false); expect(recipe()).toEqual(beforeDeletion.recipe); expect(app!.session.cursor).toEqual(beforeDeletion.cursor);
    expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(blank.source); expect(voice(1).events).toEqual([]); expect(app!.session.score.staves[0].measures[1].incomplete).toBe(true);
    await undoDeletion(beforeDeletion); expect(event('solo')?.pitches.map(pitchText)).toEqual(['C5']); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
  });
});

describe('native controls and prose own their deletion keys', () => {
  it.each(['selected-pitch', 'source-input', 'selection-duration', 'selection-sharp'])('%s keeps Delete and Backspace native without modifying selected music', async control => {
    mount(); await select('b');
    if (control === 'selected-pitch') { await click('edit-selected-event'); await field(control, 'Gqf5'); }
    if (control === 'source-input') { await click('source-trigger'); await field(control, `${app!.session.project.sourceHtml}\n<!-- held source draft -->`); }
    if (control === 'selection-duration') await click('selection-value');
    const target = el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(control); await disclose(target); expect(available(target)).toBe(true); target.focus();
    const before = accepted(), value = 'value' in target ? target.value : undefined;
    for (const key of keys) { const native = await press(key); expect(native.defaultPrevented).toBe(false); unchanged(before); if (value !== undefined) expect(target.value).toBe(value); }
  });
  it.each(['', 'true', 'plaintext-only', 'prose', 'transcript', 'nested-editor'])('preserves native content from a %j origin inside the score, including shadow boundaries', async kind => {
    mount(); await select('b'); const host = document.createElement('div'); host.id = 'delete-native-fixture'; el('score-editor').append(host);
    const target = document.createElement(kind === 'prose' ? 'p' : 'div'); target.tabIndex = 0; target.textContent = 'Keep this written performance instruction.';
    if (['', 'true', 'plaintext-only'].includes(kind)) target.setAttribute('contenteditable', kind);
    if (kind === 'transcript') target.className = 'transcript';
    if (kind === 'nested-editor') { target.setAttribute('contenteditable', 'plaintext-only'); host.attachShadow({ mode: 'open' }).append(target); }
    else host.append(target);
    target.focus(); const before = accepted();
    for (const key of keys) { const native = await press(key, {}, target); expect(native.defaultPrevented).toBe(false); unchanged(before); }
    expect(target.textContent).toBe('Keep this written performance instruction.');
  });
  it.each([
    { name: 'Shift', shiftKey: true }, { name: 'Control', ctrlKey: true }, { name: 'Command', metaKey: true }, { name: 'Alt', altKey: true },
    { name: 'composition', isComposing: true },
  ])('ignores $name modified deletion without consuming or changing the current musical selection', async ({ name: _name, ...options }) => {
    mount(); await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor')); const before = accepted();
    for (const key of keys) { const untouched = await press(key, options); expect(untouched.defaultPrevented).toBe(false); unchanged(before); }
  });
  it('consumes held deletion repeats without cascading into the newly selected surviving neighbor', async () => {
    mount(); await select('b'); const before = accepted(); await press('Delete'); expect(event('b')).toBeUndefined();
    expect(app!.session.selection.ids).toEqual(['c']); const after = accepted();
    for (const key of keys) { const repeated = await press(key, { repeat: true }); expect(repeated.defaultPrevented).toBe(true); unchanged(after); }
    expect(event('c')).toBeDefined(); await undoDeletion(before);
  });
  it.each([
    { open: 'selection-value', panel: 'selection-value-chooser' }, { open: 'score-setup-trigger', panel: 'score-setup' }, { open: 'source-trigger', panel: 'source-panel' },
  ])('does not delete through the open $panel even if a stale score key is delivered', async ({ open, panel }) => {
    mount(); await select('b');
    if (open === 'score-setup-trigger') await click('document-menu-trigger');
    await click(open); expect(el(panel).hidden).toBe(false); const before = accepted();
    // Synthetic stale delivery: this is not a claim that a native popup permits
    // its user to focus a hidden or inert background control.
    el('score-editor').focus();
    for (const key of keys) { const stale = await press(key); expect(stale.defaultPrevented).toBe(false); unchanged(before); }
  });
});

describe('deletion admission respects mode, gestures and current source identity', () => {
  it.each(['read', 'pages'])('does not edit from a retained score key in %s', async mode => {
    mount(); await select('b'); await click(`view-${mode}`); const before = accepted();
    for (const key of keys) { const retained = await press(key, {}, el('score-editor')); expect(retained.defaultPrevented).toBe(false); unchanged(before); }
  });
  it('does not remove a just-written note while Enter mode owns score focus', async () => {
    mount(); await futureRecipe(); const writing = app!.session.cursor;
    await select('b'); await click('toggle-entry'); expect(app!.session.cursor).toEqual(writing);
    await click('insert-event'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(authorActiveElement(document)).toBe(el('score-editor')); expect(event(app!.session.cursor!.eventId!)?.kind).toBe('note'); const before = accepted();
    for (const key of keys) { const entry = await press(key); expect(entry.defaultPrevented).toBe(false); unchanged(before); }
  });
  it('does not delete while the actual Prepare pitch drag action remains armed', async () => {
    mount(); await select('b'); await click('edit-selected-event'); await click('selection-prepare-drag'); expect(document.body.dataset.pitchDragArmed).toBe('true');
    const before = accepted(); el('score-editor').focus();
    for (const key of keys) { const armed = await press(key); expect(armed.defaultPrevented).toBe(false); unchanged(before); }
  });
  it.each(['insert', 'pitch'])('honors the synthetic public %s gesture admission signal without claiming a rendered drag', async gesture => {
    mount(); await select('b'); const before = accepted();
    // Only this observable admission signal is staged. No controller internals,
    // geometry, capture, preview or successful pointer gesture is simulated.
    document.body.dataset.pointerGesture = gesture;
    try { for (const key of keys) { const active = await press(key); expect(active.defaultPrevented).toBe(false); unchanged(before); } }
    finally { delete document.body.dataset.pointerGesture; }
  });
  it('an empty selection does not delete a remaining inspection or writing-cursor fallback', async () => {
    mount(); await futureRecipe(); await select('b'); await press('Escape'); expect(app!.session.selection.ids).toEqual([]); const before = accepted();
    for (const key of keys) { await press(key); unchanged(before); } expect(event('b')).toBeDefined(); expect(event('writer')).toBeDefined();
  });
  it('a structural measure selection never removes its first event or the independent writer', async () => {
    mount(); await futureRecipe(); await select('bar-12'); expect(app!.session.selection.ids).toEqual([]); const before = accepted();
    for (const key of keys) { await press(key); unchanged(before); } expect(voice().events.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('pending Source blocks musical deletion and retains the raw draft', async () => {
    mount(); await select('b'); await click('source-trigger'); const draft = `${app!.session.project.sourceHtml}\n<!-- pending source -->`;
    await field('source-input', draft); await click('close-source'); await select('b'); const before = accepted();
    for (const key of keys) { await press(key); unchanged(before); } expect(app!.session.project.pendingSource).toBe(draft);
  });
  it('accepting Source that removes the selected ID leaves no deletion target; only a new deliberate note selection can authorize deletion', async () => {
    mount(); await futureRecipe(); await select('b'); const next = app!.session.source.cloneNode(true) as HTMLElement;
    next.querySelector('#b')!.remove(); next.querySelector('#bar-12')!.setAttribute('incomplete', '');
    await click('source-trigger'); await field('source-input', next.outerHTML); await click('source-apply'); await click('close-source');
    expect(app!.session.selection.ids).toEqual([]); expect(event('b')).toBeUndefined(); const before = accepted();
    // Return keyboard focus to the now-unselected score without choosing a note.
    el('score-editor').focus(); for (const key of keys) { await press(key); unchanged(before); }
    expect(voice().events.map(item => item.id)).toEqual(['a', 'c', 'd']); await select('c'); expect(authorActiveElement(document)).toBe(el('score-editor'));
    const explicit = accepted(); await press('Delete'); expect(event('c')).toBeUndefined(); expect(app!.session.revision).toBe(explicit.revision + 1); await undoDeletion(explicit);
  });
});

describe('fresh text gestures relinquish score shortcuts without clearing browser selection', () => {
  it.each(keys)('a fresh prose selectstart keeps %s native; a later deliberate note selection can delete despite the retained Range', async key => {
    mount(); await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor')); const beforeText = accepted();
    const prose = el('keyboard-help'); const textStart = new Event('selectstart', { bubbles: true, composed: true, cancelable: true }); prose.dispatchEvent(textStart); await flush();
    expect(textStart.defaultPrevented).toBe(false); expect(authorActiveElement(document)).not.toBe(el('score-editor')); expect(authorActiveElement(document)).not.toBe(el('score-scroll')); unchanged(beforeText);
    const browserSelection = window.getSelection()!, range = document.createRange(); range.selectNodeContents(prose); browserSelection.addRange(range);
    const text = browserSelection.toString(); expect(text.length).toBeGreaterThan(0); expect(browserSelection.isCollapsed).toBe(false);
    const native = await press(key); expect(native.defaultPrevented).toBe(false); unchanged(beforeText); expect(browserSelection.toString()).toBe(text);
    await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor')); expect(browserSelection.toString()).toBe(text); const beforeDeletion = accepted();
    const musical = await press(key); expect(musical.defaultPrevented).toBe(true); expect(event('b')).toBeUndefined();
    expect(app!.session.revision).toBe(beforeDeletion.revision + 1); expect(browserSelection.toString()).toBe(text); await undoDeletion(beforeDeletion);
  });
  it('a new prose gesture reclaims ownership even when its retained Range has identical endpoints', async () => {
    mount(); await select('b'); const prose = el('keyboard-help');
    const selectText = async () => { const gesture = new Event('selectstart', { bubbles: true, composed: true, cancelable: true }); prose.dispatchEvent(gesture); await flush(); expect(gesture.defaultPrevented).toBe(false); };
    await selectText(); const selection = window.getSelection()!, range = document.createRange(); range.selectNodeContents(prose); selection.addRange(range);
    const text = selection.toString(); await select('b'); expect(authorActiveElement(document)).toBe(el('score-editor')); const before = accepted();
    await selectText(); expect(authorActiveElement(document)).not.toBe(el('score-editor')); expect(selection.toString()).toBe(text);
    for (const key of keys) { const native = await press(key); expect(native.defaultPrevented).toBe(false); unchanged(before); } expect(selection.toString()).toBe(text);
  });
  it('a native field selectstart preserves its focus and selection offsets instead of blurring it', async () => {
    mount(); await select('b'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf5');
    const input = el<HTMLInputElement>('selected-pitch'); input.focus(); input.setSelectionRange(1, 3); const before = accepted();
    const gesture = new Event('selectstart', { bubbles: true, composed: true, cancelable: true }); input.dispatchEvent(gesture); await flush();
    expect(gesture.defaultPrevented).toBe(false); expect(authorActiveElement(document)).toBe(input); expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
    for (const key of keys) { const native = await press(key); expect(native.defaultPrevented).toBe(false); unchanged(before); } expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });
});


describe('selection Delete button', () => {
  it('appears only for musical selection and deletes a disjoint touch collection in one Undo', async () => {
    mount(); expect(el('selection-delete').hidden).toBe(true);
    await futureRecipe(); await select('a'); await click('selection-select-more'); await select('c');
    expect(app!.session.selection.ids).toEqual(['a', 'c']);
    const before = accepted(), lower = structuredClone(voice(0, 1));
    await click('selection-delete');
    expect(voice().events.map(item => item.id)).toEqual(['b', 'd']); expect(voice(0, 1)).toEqual(lower);
    expect(app!.session.revision).toBe(before.revision + 1); expect(recipe()).toEqual(before.recipe);
    expect(app!.session.cursor).toEqual(before.cursor); await undoDeletion(before);
  });
  it('hides after deleting the last event and restores a full-measure rest with Undo', async () => {
    mount(); await select('writer'); const before = accepted(); await click('selection-delete');
    expect(voice(2).events).toEqual([]); expect(el('selection-delete').hidden).toBe(true);
    await undoDeletion(before); expect(event('writer')?.measureRest).toBe(true);
  });
  it('deletes the current selection without using or discarding a held Properties draft', async () => {
    mount(); await select('a'); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4'); await select('b');
    const before = accepted(); await click('selection-delete'); expect(event('b')).toBeUndefined();
    expect(event('a')?.pitches.map(pitchText)).toEqual(['F4']);
    expect(el('selection-inspector').dataset.draftTarget).toBe('a'); expect(el<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    await undoDeletion(before);
  });
  it('rejects tied event deletion atomically and retains Undo history', async () => {
    mount('<music-staff><music-measure><music-note id="a" pitch="C4" duration="half" tie="start"></music-note><music-note id="b" pitch="C4" duration="half" tie="end"></music-note></music-measure></music-staff>');
    await select('a'); const before = accepted(); await click('selection-delete'); unchanged(before);
    expect(el('author-errors').textContent).toMatch(/Clear connected ties/i);
  });
  it('disables deletion with an unapplied Source draft and hides it during entry', async () => {
    mount(); await select('b'); await click('source-trigger');
    await field('source-input', app!.session.project.sourceHtml + '\n<!-- pending -->'); await click('close-source');
    expect(el<HTMLButtonElement>('selection-delete').disabled).toBe(true);
    const before = accepted(); el('selection-delete').click(); await flush(); unchanged(before);
    await click('toggle-entry'); expect(available(el('selection-delete'))).toBe(false);
  });
});
