// @vitest-environment happy-dom
/**
 * Real Author shell, EditorSession, selection routing, quick commands and drafts.
 * requestRender is stubbed; a fixed workbench clientWidth supplies pane-policy
 * input instead of Happy DOM's zero layout. These tests do not qualify engraving geometry,
 * native popover/picker behavior, browser text highlighting, touch, or printing.
 */
import { authorActiveElement, authorControlParent, authorControlRoot, findAuthorControl, mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { reduceSelection } from '../src/authoring/selection.js';
import { pitchText } from '../src/model/index.js';
import type { MusicEvent } from '../src/model/types.js';

const selectionSource = `<music-system id="selection-score">
  <music-staff id="lead" label="Lead">
    <music-measure id="bar-12" number="12">
      <music-voice id="lead-v1-12">
        <music-note id="a" pitch="F4" duration="quarter"><music-articulation id="a-accent" type="accent"></music-articulation></music-note>
        <music-note id="b" pitch="F4" duration="quarter"></music-note>
        <music-note id="c" pitch="F4" duration="quarter"></music-note>
        <music-note id="d" pitch="F4" duration="quarter"></music-note>
      </music-voice>
      <music-voice id="lead-v2-12"><music-note id="v2a" pitch="C3" duration="half"></music-note><music-note id="v2b" pitch="C3" duration="half"></music-note></music-voice>
    </music-measure>
    <music-measure id="bar-13" number="13">
      <music-voice id="lead-v1-13">
        <music-note id="e" pitch="F4" duration="quarter"><music-ornament id="e-turn" type="turn"></music-ornament></music-note>
        <music-note id="f" pitch="F4" duration="quarter"></music-note>
        <music-note id="g" pitch="F4" duration="quarter"></music-note>
        <music-note id="h" pitch="F4" duration="quarter"></music-note>
      </music-voice>
      <music-voice id="lead-v2-13"><music-note id="v2c" pitch="C3" duration="whole"></music-note></music-voice>
    </music-measure>
  </music-staff>
  <music-staff id="bass" label="Bass" clef="bass">
    <music-measure id="bass-12" number="12"><music-note id="bass-a" pitch="Bb2" duration="half"></music-note><music-note id="bass-b" pitch="Bb2" duration="half"></music-note></music-measure>
    <music-measure id="bass-13" number="13"><music-note id="bass-c" pitch="Bb2" duration="whole"></music-note></music-measure>
  </music-staff>
</music-system>`;
const roadSource = `<music-staff id="road-staff" label="Relative melody" notation="three-roads">
  <music-measure id="road-bar"><music-road id="road-a" direction="lower" duration="half" tie="start"><music-interval id="road-fifth-a" value="5" placement="above"></music-interval></music-road><music-road id="road-b" direction="same" duration="half" tie="end"><music-interval id="road-fifth-b" value="5" placement="above"></music-interval></music-road></music-measure>
</music-staff>`;
function writingSource(): string {
  return `<music-staff id="writing-staff" label="Writing study">${Array.from({ length: 20 }, (_, index) =>
    `<music-measure id="writing-bar-${index + 1}" number="${index + 1}">${index === 19
      ? '<music-rest id="writing-placeholder" measure></music-rest>'
      : `<music-note id="writing-note-${index + 1}" pitch="F4" duration="whole"></music-note>`}</music-measure>`).join('')}</music-staff>`;
}

let app: AuthorWorkspace | undefined;
let sequence = 0;
let viewportDescriptor: PropertyDescriptor | undefined;
const actions: string[] = [];
function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl(document, id);
  if (!element) throw new Error(`The current Author shell is missing #${id}.`);
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
  const ancestors: HTMLDetailsElement[] = [];
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) if (parent instanceof HTMLDetailsElement) ancestors.unshift(parent);
  for (const details of ancestors) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary'); expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true);
    actions.push(`disclose:${details.id || summary!.textContent?.trim()}`); summary!.click(); await flush(); expect(details.open).toBe(true);
  }
}
function mount(source = selectionSource): AuthorWorkspace {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `selection-workspace-${++sequence}`, writerId: 'selection-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Selection integration'), recovery });
  return app;
}
async function click(id: string): Promise<void> {
  const element = control<HTMLButtonElement>(id); await disclose(element); expect(available(element), `#${id} is an available visible action`).toBe(true);
  actions.push(`click:${id}`); element.click(); await flush();
}
async function setField(id: string, value: string): Promise<void> {
  const element = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  await disclose(element); expect(available(element), `#${id} is an available field`).toBe(true);
  if (element instanceof HTMLSelectElement) expect([...element.options].some(option => option.value === value && !option.disabled), `#${id} offers ${value}`).toBe(true);
  actions.push(`field:${id}`); element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function deliverStaleField(element: HTMLSelectElement | HTMLInputElement, value: string): Promise<void> {
  // Deliberate stale-event stress. Ordinary helpers above require available UI.
  actions.push(`stale-field:${element.id}`); element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function deliverStaleClick(element: HTMLElement): Promise<void> {
  actions.push(`stale-click:${element.id}`); element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await flush();
}
interface Modifiers { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; clickCount?: number; pointerType?: string }
async function chooseSource(id: string, modifiers: Modifiers = {}): Promise<void> {
  const sourceElement = app!.session.source.id === id ? app!.session.source : app!.session.source.querySelector(`[id="${id}"]`);
  expect(sourceElement, `The fixture owns source ${id}`).not.toBeNull();
  actions.push(`source:${id}:${JSON.stringify(modifiers)}`);
  control('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse', ...modifiers,
  } }));
  await flush();
}
async function externalToggleSelection(id: string): Promise<void> {
  // A separate workspace actor may change transient selection while a native
  // chooser or modal is open. This is not a user click through that surface.
  const current = app!.session.selection;
  const transition = reduceSelection(current, { type: 'toggle', id }, {
    score: app!.session.score, documentId: current.documentId, documentEpoch: current.documentEpoch, partId: current.partId,
  });
  expect(transition.reason).toBeUndefined();
  actions.push(`external-selection-toggle:${id}`); app!.session.setSelection(transition.state); await flush();
}
async function key(name: string, id = 'score-editor', options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const element = control(id); element.focus({ preventScroll: true });
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true, ...options });
  actions.push(`key:${id}:${name}`); element.dispatchEvent(event);
  if ((name === ' ' || name === 'Enter') && element instanceof HTMLButtonElement && (element.getRootNode() as ShadowRoot).host?.localName === 'music-toggle-button-group' && !event.defaultPrevented) element.click();
  await flush(); return event;
}
function exactSelection() { return app!.session.selection; }
function selectedIds(): string[] { return [...exactSelection().ids]; }
function eventById(id: string): MusicEvent {
  const event = app!.session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).find(event => event.id === id);
  if (!event) throw new Error(`The accepted score has no event ${id}.`); return event;
}
function entryRecipe(): object {
  return { ...Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
    'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, control<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: control<HTMLInputElement>('event-measure-rest').checked, rhythmic: control<HTMLInputElement>('event-rhythmic').checked };
}
function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision, undo: app!.session.canUndo, redo: app!.session.canRedo,
    cursor: app!.session.cursor, parts: structuredClone(app!.session.project.parts), layouts: structuredClone(app!.session.project.layouts) };
}
function noEdit(before: ReturnType<typeof accepted>, preserveWritingCursor = true): void {
  expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.revision).toBe(before.revision);
  expect([app!.session.canUndo, app!.session.canRedo]).toEqual([before.undo, before.redo]);
  expect(app!.session.project.parts).toEqual(before.parts); expect(app!.session.project.layouts).toEqual(before.layouts);
  if (preserveWritingCursor) expect(app!.session.cursor).toEqual(before.cursor);
}
function feedback(): string {
  return ['selection-controls-error', 'selection-controls-feedback', 'author-errors', 'author-status', 'pointer-status']
    .map(id => findAuthorControl(document, id)?.textContent ?? '').join(' ');
}
function expectMembers(ids: string[], primaryId?: string, anchorId?: string): void {
  expect(selectedIds()).toEqual(ids);
  if (primaryId !== undefined) expect(exactSelection().primaryId).toBe(primaryId);
  if (anchorId !== undefined) expect(exactSelection().anchorId).toBe(anchorId);
}
async function location(staff: string, measure: string, voice = '0'): Promise<void> {
  await click('location-trigger'); await setField('staff-select', staff); await setField('measure-select', measure); await setField('event-voice', voice); await click('close-location');
}
async function startHere(): Promise<void> {
  await click('location-trigger'); await click('start-entry-here');
  expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true');
}
async function properties(id: string): Promise<void> {
  await chooseSource(id); await click('edit-selected-event');
  expect(control('workspace-tools').hidden).toBe(false); expect(control('selection-inspector').hidden).toBe(false);
}
function markingRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`#event-markings-rows [data-marking-id="${id}"]`);
  if (!row) throw new Error(`The real attachment editor has no ${id} row.`); return row;
}
async function markingType(id: string, type: string): Promise<void> {
  const select = markingRow(id).querySelector<HTMLSelectElement>('[data-marking-field="type"]');
  expect(select).not.toBeNull(); await setField(select!.id, type);
}
async function width(value: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value }); window.dispatchEvent(new Event('resize')); await flush();
}

beforeEach(() => {
  viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture(); actions.length = 0;
  vi.spyOn(control('author-workbench'), 'clientWidth', 'get').mockImplementation(() => window.innerWidth);
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => {
  app?.dispose(); app = undefined; await flush();
  // requestRender call contexts retain the disposed workspace and its control
  // maps even after the fixture's DOM descendants have been released.
  vi.clearAllMocks(); vi.restoreAllMocks(); await releaseAuthorFixture();
  if (viewportDescriptor) Object.defineProperty(window, 'innerWidth', viewportDescriptor);
});

describe('exact selection routed through the actual workspace', () => {
  it('plain selection updates inspection only, exposes common controls, and preserves the independent writing cursor and recipe', async () => {
    mount(); const before = accepted(), recipe = entryRecipe(); await chooseSource('a');
    expectMembers(['a'], 'a', 'a'); expect(exactSelection()).toMatchObject({ staffId: 'lead', voiceIndex: 0, focusId: 'a' });
    expect(control('workspace-tools').hidden).toBe(true); expect(control('selection-controls').hidden).toBe(false);
    expect(authorActiveElement(document)).not.toBe(control('selection-sharp')); expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it('Shift replaces membership with the fixed-anchor range across a barline, then shrinks it without filling a second range', async () => {
    mount(); const before = accepted(); await chooseSource('b'); await chooseSource('f', { shiftKey: true });
    expectMembers(['b', 'c', 'd', 'e', 'f'], 'f', 'b'); await chooseSource('c', { shiftKey: true });
    expectMembers(['b', 'c'], 'c', 'b'); noEdit(before);
  });
  it.each([{ platform: 'Linux x86_64', modifier: { ctrlKey: true } }, { platform: 'MacIntel', modifier: { metaKey: true } }])(
    'uses exact additive membership on $platform, preserving holes and deterministic primary removal', async ({ platform, modifier }) => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform); mount(); const before = accepted();
      await chooseSource('a'); await chooseSource('e', modifier); await chooseSource('c', modifier);
      expectMembers(['a', 'c', 'e'], 'c', 'a'); expect(selectedIds()).not.toContain('b'); expect(selectedIds()).not.toContain('d');
      await chooseSource('c', modifier); expectMembers(['a', 'e'], 'a', 'a');
      await chooseSource('a', modifier); expectMembers(['e'], 'e', 'e');
      await chooseSource('e', modifier); expectMembers([]); expect(exactSelection().primaryId).toBeUndefined(); expect(exactSelection().anchorId).toBeUndefined(); noEdit(before);
    },
  );
  it('leaves macOS Control-click to secondary-click behavior without changing music or selection', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel'); mount(); await chooseSource('a'); const selection = exactSelection(), before = accepted();
    await chooseSource('c', { ctrlKey: true }); expect(exactSelection()).toEqual(selection); noEdit(before);
  });
  it('Shift after a disjoint set replaces that set with one new anchored range', async () => {
    mount(); const before = accepted(); await chooseSource('b'); await chooseSource('d', { ctrlKey: true }); await chooseSource('g', { ctrlKey: true });
    expectMembers(['b', 'd', 'g'], 'g', 'b'); await chooseSource('c', { shiftKey: true }); expectMembers(['b', 'c'], 'c', 'b'); noEdit(before);
  });
  it.each([{ target: 'v2a', scope: /voice/i }, { target: 'bass-a', scope: /staff/i }])('refuses modified selection outside the current scope at $target', async ({ target, scope }) => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); const selection = exactSelection(), before = accepted();
    await chooseSource(target, { shiftKey: true }); expect(exactSelection()).toEqual(selection); expect(feedback()).toMatch(scope); noEdit(before);
    await chooseSource(target, { ctrlKey: true }); expect(exactSelection()).toEqual(selection); noEdit(before);
  });
  it('an unmodified cross-staff selection replaces the set while leaving the writing cursor alone', async () => {
    mount(); const before = accepted(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); await chooseSource('bass-a');
    expectMembers(['bass-a'], 'bass-a', 'bass-a'); expect(exactSelection()).toMatchObject({ staffId: 'bass', voiceIndex: 0 }); noEdit(before);
  });
  it('modified marking selection addresses the whole owner and clears the separate child target', async () => {
    mount(); await chooseSource('a-accent'); expect(control('score-editor').dataset.activeMarkingId).toBe('a-accent'); const before = accepted();
    await chooseSource('e-turn', { ctrlKey: true }); expectMembers(['a', 'e'], 'e', 'a');
    expect(control('score-editor').dataset.activeMarkingId || undefined).toBeUndefined(); expect(feedback()).toMatch(/owner|event|note/i); noEdit(before);
  });
  it('unmodified arrows collapse to the neighboring event relative to the primary, without changing the insertion bookmark', async () => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); const before = accepted(), recipe = entryRecipe();
    await key('ArrowRight'); expectMembers(['d'], 'd', 'd'); await key('ArrowLeft'); expectMembers(['c'], 'c', 'c');
    expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it('Shift arrows extend and shrink from the same anchor across measures', async () => {
    mount(); const before = accepted(); await chooseSource('d'); await key('ArrowRight', 'score-editor', { shiftKey: true });
    expectMembers(['d', 'e'], 'e', 'd'); await key('ArrowRight', 'score-editor', { shiftKey: true }); expectMembers(['d', 'e', 'f'], 'f', 'd');
    await key('ArrowLeft', 'score-editor', { shiftKey: true }); expectMembers(['d', 'e'], 'e', 'd'); noEdit(before);
  });
  it('Escape clears exact membership, child identity, count and range controls without discarding a held draft', async () => {
    mount(); await properties('a'); await setField('selected-pitch', 'Gqs4'); await chooseSource('d', { shiftKey: true }); const before = accepted();
    await key('Escape'); expectMembers([]); expect(exactSelection().primaryId).toBeUndefined(); expect(exactSelection().anchorId).toBeUndefined(); expect(exactSelection().focusId).toBeUndefined();
    expect(control<HTMLSelectElement>('range-start').value).toBe(''); expect(control<HTMLSelectElement>('range-end').value).toBe('');
    expect(control('score-editor').dataset.activeMarkingId || undefined).toBeUndefined();
    expect(control('selection-inspector').dataset.draftTarget).toBe('a'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqs4');
    noEdit(before);
    await deliverStaleField(control<HTMLSelectElement>('range-end'), 'f'); expect(selectedIds()).not.toEqual(['a', 'b', 'c', 'd', 'e', 'f']); noEdit(before);
  });
});

async function configureFutureRecipe(): Promise<object> {
  await startHere(); await click('entry-settings-trigger'); await setField('event-kind', 'chord');
  await setField('event-pitches', 'Bqf3 D#4 Fqs4');
  await setField('event-accidental-display', 'courtesy'); await setField('event-stem', 'down'); await setField('event-beam', 'none');
  await setField('insert-position', 'before'); await click('close-entry-settings');
  await click('entry-value-trigger'); await setField('event-duration', 'eighth'); await setField('event-dots', '2'); await click('close-entry-value');
  await click('select-mode'); return entryRecipe();
}
function structuralState(item: MusicEvent): object {
  return { id: item.id, kind: item.kind, duration: item.duration, dots: item.dots, onset: item.onset, time: item.time,
    tupletIds: item.tupletIds, tie: item.tie, markings: item.markings, stem: item.stem, beam: item.beam, measureRest: item.measureRest, rhythmic: item.rhythmic };
}
async function shared(): Promise<void> { await click('selection-shared'); expect(control('selection-shared-chooser').hidden).toBe(false); }

describe('direct common actions use accepted music, never the next-entry recipe', () => {
  it('Select then Sharp is two actions and one transaction with no Edit, tab, or Apply detour', async () => {
    mount(); const future = await configureFutureRecipe(); const before = accepted(); const start = actions.length;
    await chooseSource('a'); const original = eventById('a'); await click('selection-sharp');
    expect(actions.slice(start)).toEqual(['source:a:{}', 'click:selection-sharp']);
    expect(pitchText(eventById('a').pitches[0])).toBe('F#4'); expect(structuralState(eventById('a'))).toEqual(structuralState(original));
    expect(app!.session.revision).toBe(before.revision + 1); expect(entryRecipe()).toEqual(future); expect(control('workspace-tools').hidden).toBe(true);
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.canUndo).toBe(before.undo); expect(entryRecipe()).toEqual(future);
  });
  it('the compact value chooser changes the accepted duration, preserves dots and pending recipe, and undoes once', async () => {
    mount(); const future = await configureFutureRecipe(); await chooseSource('a'); const before = accepted();
    await click('selection-value'); await setField('selection-duration', 'eighth');
    expect(eventById('a')).toMatchObject({ duration: 'eighth', dots: 0, time: { numerator: 1, denominator: 8 } });
    expect(eventById('a').pitches.map(pitchText)).toEqual(['F4']); expect(entryRecipe()).toEqual(future); expect(app!.session.revision).toBe(before.revision + 1);
    await click('close-selection-value'); await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(entryRecipe()).toEqual(future);
  });
  it('a microtonal note reports its real alteration with none of the three ordinary shortcuts selected', async () => {
    await width(390); mount(selectionSource.replace('id="a" pitch="F4"', 'id="a" pitch="Fqs4"')); await chooseSource('a'); const before = accepted();
    for (const id of ['selection-flat', 'selection-natural', 'selection-sharp']) expect(control(id).getAttribute('aria-pressed')).toBe('false');
    expect(control('selection-controls-context').textContent).toMatch(/quarter|qs|½/i);
    await click('selection-pitch'); expect(control<HTMLSelectElement>('selection-alteration').value).toBe('0.5');
    expect([...control<HTMLSelectElement>('selection-alteration').options].map(option => option.value).filter(Boolean)).toEqual(['-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2']); noEdit(before);
    await setField('selection-alteration', '-1.5'); expect(pitchText(eventById('a').pitches[0])).toBe('Ftqf4'); expect(app!.session.revision).toBe(before.revision + 1);
  });
  it('ordinary radio arrows move focus without editing; Space applies the focused value exactly once', async () => {
    mount(); await chooseSource('a'); const before = accepted(); control('selection-natural').focus();
    await key('ArrowRight', 'selection-natural'); expect(authorActiveElement(document)).toBe(control('selection-sharp')); noEdit(before);
    await key(' ', 'selection-sharp'); expect(pitchText(eventById('a').pitches[0])).toBe('F#4'); expect(app!.session.revision).toBe(before.revision + 1);
  });
  it('a repeated accepted value does not consume redo or create history', async () => {
    mount(); await chooseSource('a'); await click('selection-sharp'); await click('undo'); const before = accepted();
    expect(before.redo).toBe(true); await click('selection-natural'); noEdit(before); expectMembers(['a']);
  });
  it('a chord is one selected event and routes Pitches directly to its complete staged pitch list', async () => {
    mount(selectionSource.replace('<music-note id="b" pitch="F4" duration="quarter"></music-note>', '<music-chord id="b" pitches="C4 Eqs4 G4" duration="quarter"></music-chord>'));
    await chooseSource('b'); const before = accepted(); expectMembers(['b'], 'b', 'b');
    expect(control('selection-controls').dataset.selectionState).toBe('chord'); expect(control('selection-pitch').textContent).toMatch(/pitches/i);
    await click('selection-pitch'); expect(control('selection-inspector').hidden).toBe(false); expect(authorActiveElement(document)).toBe(control('selected-pitches'));
    expect(control<HTMLInputElement>('selected-pitches').value).toBe('C4 Eqs4 G4'); noEdit(before);
  });
  it('the road toolbar changes direction without inventing pitches and refuses a held continuation direction', async () => {
    mount(roadSource); await chooseSource('road-a'); const before = accepted(), original = eventById('road-a');
    expect(control('selection-controls').dataset.selectionState).toBe('road'); await click('selection-higher');
    expect(eventById('road-a').pitchDirection).toBe('higher'); expect(eventById('road-a').pitches).toEqual([]);
    expect(structuralState(eventById('road-a'))).toEqual(structuralState(original)); expect(app!.session.revision).toBe(before.revision + 1);
    await chooseSource('road-b'); expect(control<HTMLButtonElement>('selection-higher').disabled).toBe(true); expect(control<HTMLButtonElement>('selection-lower').disabled).toBe(true);
    const guarded = accepted(); await deliverStaleClick(control('selection-higher')); noEdit(guarded); expect(eventById('road-b').pitchDirection).toBe('same');
  });
  it.each([
    { source: '<music-staff id="staff"><music-measure id="bar"><music-rest id="target" measure></music-rest></music-measure></music-staff>', state: 'rest', label: /meter|full.measure/i },
    { source: '<music-staff id="staff"><music-measure id="bar"><music-slash id="target" duration="whole"></music-slash></music-measure></music-staff>', state: 'slash', label: /write.*rhythm|improvis|nominal/i },
  ])('does not misrepresent the nominal duration of a $state', async ({ source, state, label }) => {
    mount(source); await chooseSource('target'); const before = accepted();
    expect(control('selection-controls').dataset.selectionState).toBe(state); expect(control('selection-controls').textContent).toMatch(label);
    expect(available(control('selection-flat'))).toBe(false); noEdit(before);
  });
  it('More opens untabbed Properties directly; Other tools and Back preserve the same held target without musical edits', async () => {
    mount(); await chooseSource('a'); const before = accepted(); await click('edit-selected-event');
    expect(control('selection-inspector').getAttribute('role')).not.toBe('tabpanel'); expect(control('tools-tablist').hidden).toBe(true);
    expect(control('workspace-tools').querySelectorAll('#selection-inspector')).toHaveLength(1);
    expect(control('selection-inspector').dataset.draftTarget).toBe('a');
    control('selection-inspector').scrollTop = 137; await click('other-tools'); expect(control('tools-tablist').hidden).toBe(false);
    await click('tool-tab-markings'); expect(control('annotation-inspector').hidden).toBe(false);
    await click('back-to-properties'); expect(control('tools-tablist').hidden).toBe(true); expect(control('selection-inspector').hidden).toBe(false);
    expect(control('selection-inspector').scrollTop).toBe(137); expect(control('selection-inspector').dataset.draftTarget).toBe('a'); noEdit(before);
  });
  it('double-click and Enter share the direct Properties destination without opening duplicate editors or changing source', async () => {
    mount(); const before = accepted(); await chooseSource('a'); await chooseSource('a', { clickCount: 2 });
    expect(control('workspace-tools').hidden).toBe(false); expect(control('selection-inspector').dataset.draftTarget).toBe('a');
    expect(control('tools-tablist').hidden).toBe(true); expect(control('note-editor').dataset.noteEditorState).not.toBe('open');
    await click('tools-hide'); await key('Enter'); expect(control('workspace-tools').hidden).toBe(false); expect(control('selection-inspector').dataset.draftTarget).toBe('a'); noEdit(before);
  });
  it('double-clicking a child uses its exact row rather than a broad owner editor', async () => {
    mount(); const before = accepted(); await chooseSource('e-turn'); await chooseSource('e-turn', { clickCount: 2 });
    expect(control('score-editor').dataset.activeMarkingId).toBe('e-turn'); expect(control('event-markings-editor').dataset.activeMarkingId).toBe('e-turn');
    expect(markingRow('e-turn').contains(authorActiveElement(document))).toBe(true); expect(control('tools-tablist').hidden).toBe(true); noEdit(before);
  });
});

describe('exact membership reaches atomic shared actions and lifecycle guards', () => {
  it('adds only missing articulations to the exact holes, preserves existing child IDs, and undoes as one transaction', async () => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); const before = accepted(), selection = exactSelection(), recipe = entryRecipe();
    expect(control('selection-controls').dataset.selectionState).toBe('multiple'); expect(JSON.parse(control('selection-controls').dataset.eventIds!)).toEqual(['a', 'c']);
    await shared(); await setField('selection-articulation', 'accent');
    expect(control('selection-add-articulation').textContent).toMatch(/all.*2|2.*events/i); await click('selection-add-articulation');
    expect(eventById('a').markings?.map(mark => mark.id)).toEqual(['a-accent']); expect(eventById('c').markings).toHaveLength(1);
    expect(eventById('c').markings?.[0]).toMatchObject({ kind: 'articulation', type: 'accent' });
    expect(eventById('b').markings ?? []).toHaveLength(0); expect(eventById('d').markings ?? []).toHaveLength(0);
    expect(app!.session.revision).toBe(before.revision + 1); expect(entryRecipe()).toEqual(recipe); expectMembers(['a', 'c'], selection.primaryId, selection.anchorId);
    const repeated = accepted(); expect(control<HTMLButtonElement>('selection-add-articulation').disabled).toBe(true); await deliverStaleClick(control('selection-add-articulation')); noEdit(repeated);
    await click('close-selection-shared'); await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source);
    expectMembers(['a', 'c'], selection.primaryId, selection.anchorId); expect(app!.session.cursor).toEqual(before.cursor); expect(entryRecipe()).toEqual(recipe);
    await click('redo'); expect(eventById('c').markings).toHaveLength(1); expectMembers(['a', 'c'], selection.primaryId, selection.anchorId);
  });
  it('rejects a late-invalid batch after proving its first member alone can change, preserving holes and redo', async () => {
    const source = selectionSource.replace('id="bar-12" number="12"', 'id="bar-12" number="12" incomplete')
      .replace('<music-note id="d" pitch="F4" duration="quarter"></music-note>', '');
    mount(source); await chooseSource('a'); const initial = accepted();
    await click('selection-value'); await setField('selection-duration', 'half');
    expect(eventById('a').duration).toBe('half'); expect(app!.session.revision).toBe(initial.revision + 1);
    await click('close-selection-value'); await click('undo'); expect(app!.session.project.sourceHtml).toBe(initial.source);
    await chooseSource('e', { ctrlKey: true }); const before = accepted(); expect(before.redo).toBe(true);
    await shared(); await setField('selection-shared-duration', 'half'); noEdit(before);
    expect(['a', 'b', 'c', 'e'].map(id => eventById(id).duration)).toEqual(['quarter', 'quarter', 'quarter', 'quarter']); expectMembers(['a', 'e']);
    expect(control('selection-shared-error').textContent).toMatch(/contains|allows|excess|overflow|fit/i);
  });
  it('does not make a disjoint set tie- or tuplet-eligible by silently including intervening events', async () => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); await click('selection-relationships'); const before = accepted();
    expect(control<HTMLButtonElement>('tie-events').disabled).toBe(true); expect(control<HTMLButtonElement>('wrap-tuplet').disabled).toBe(true);
    expect(control('range-status').textContent).toMatch(/contiguous|consecutive|disjoint|gap/i);
    await deliverStaleClick(control('tie-events')); await deliverStaleClick(control('wrap-tuplet')); noEdit(before); expectMembers(['a', 'c']);
  });
  it.each([false, true])('invalidates an open shared chooser when a nonprimary member changes (round trip: %s)', async roundTrip => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); await chooseSource('e', { ctrlKey: true });
    await shared(); const stale = control<HTMLSelectElement>('selection-shared-alteration'); const version = app!.session.selectionVersion; const primary = exactSelection().primaryId;
    await externalToggleSelection('c');
    if (roundTrip) { await externalToggleSelection('c'); await externalToggleSelection('e'); await externalToggleSelection('e'); }
    expect(exactSelection().primaryId).toBe(primary); expect(app!.session.selectionVersion).toBeGreaterThan(version);
    const before = accepted(); await deliverStaleField(stale, '1'); noEdit(before);
    expect(['a', 'c', 'e'].map(id => eventById(id).pitches[0].alter)).toEqual([0, 0, 0]);
  });
  it.each([false, true])('document replacement invalidates captured choices even with reused event IDs (same project ID: %s)', async sameId => {
    mount(); await chooseSource('a'); await click('selection-value'); const stale = control<HTMLSelectElement>('selection-duration'); const epoch = app!.session.documentEpoch;
    const next = createProject(selectionSource, 'Reopened composition'); if (sameId) next.id = app!.session.project.id;
    app!.session.replaceProject(next); await flush(); expect(app!.session.documentEpoch).toBeGreaterThan(epoch);
    await chooseSource('a'); const before = accepted(); await deliverStaleField(stale, 'eighth'); noEdit(before); expect(eventById('a').duration).toBe('quarter');
    await click('selection-value'); await setField('selection-duration', 'eighth'); expect(eventById('a').duration).toBe('eighth'); expect(app!.session.revision).toBe(before.revision + 1);
  });
  it('keeps only original in-scope survivors after accepted Source reparents a selected event into another voice', async () => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); await shared(); const stale = control<HTMLSelectElement>('selection-shared-alteration');
    const source = app!.session.source.cloneNode(true) as Element; const moved = source.querySelector('#c')!; moved.remove();
    source.querySelector('#bar-12')!.setAttribute('incomplete', ''); source.querySelector('#lead-v2-12')!.replaceChildren(moved);
    app!.session.applySource(source.outerHTML); await flush(); expectMembers(['a']); expect(exactSelection()).toMatchObject({ staffId: 'lead', voiceIndex: 0 });
    const before = accepted(); await deliverStaleField(stale, '1'); noEdit(before); expect(eventById('c').pitches[0].alter).toBe(0);
  });
});

async function prepareWriting(dirty: boolean): Promise<object> {
  mount(writingSource()); await chooseSource('writing-placeholder'); await startHere(); await click('entry-settings-trigger'); await setField('event-kind', 'note');
  await setField('event-pitch', 'Fqs4'); await setField('insert-position', 'after');
  await click('close-entry-settings');
  await click('entry-value-trigger'); await setField('event-duration', 'quarter'); await setField('event-dots', '0'); await click('close-entry-value'); await click('select-mode');
  await properties('writing-note-8'); if (dirty) await setField('selected-pitch', 'Gqf4'); return entryRecipe();
}
async function writeEntries(count: number, recipe: object, held = 'writing-note-8'): Promise<string[]> {
  const inserted: string[] = [];
  for (let index = 0; index < count; index++) {
    const before = app!.session.revision; await key('Enter'); expect(app!.session.revision, `Entry ${index + 1} must actually commit`).toBe(before + 1);
    const cursor = app!.session.cursor; expect(cursor?.eventId).toBeTruthy(); const written = eventById(cursor!.eventId!); inserted.push(written.id);
    expect(pitchText(written.pitches[0])).toBe('Fqs4'); expect(written).toMatchObject({ duration: 'quarter', dots: 0, time: { numerator: 1, denominator: 4 } });
    expect(control('selection-controls').hidden, `Entry ${index + 1} must not raise selected-music controls`).toBe(true);
    expect(control('selection-inspector').dataset.draftTarget, `Entry ${index + 1} must not retarget held Properties`).toBe(held);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(entryRecipe()).toEqual(recipe);
  }
  return inserted;
}

describe('entry and held Properties keep separate destinations', () => {
  it('32 accepted entries create eight bars at the parked writing point without raising a selection HUD or retargeting pristine Properties', async () => {
    const recipe = await prepareWriting(false); const before = accepted();
    expect(control('resume-entry').textContent).toMatch(/20/); await click('toggle-entry');
    expect(control('workspace-tools').hidden).toBe(false); expect(control('selection-inspector').dataset.draftTarget).toBe('writing-note-8');
    const ids = await writeEntries(32, recipe); expect(new Set(ids).size).toBe(32);
    const bars = app!.session.score.staves[0].measures; expect(bars).toHaveLength(27);
    expect(bars.slice(19).map(bar => bar.voices[0].events.length)).toEqual(Array(8).fill(4));
    expect(bars.slice(19).flatMap(bar => bar.voices[0].events.map(event => event.id))).toEqual(ids);
    expect(app!.session.revision).toBe(before.revision + 32); expect(control<HTMLInputElement>('selected-pitch').value).toBe('F4');
    expect(app!.session.cursor?.measureId).toBe(bars[26].id); expect(control('tools-toggle').textContent).toBe('More');
  });
  it.each([1440, 390])('Resume and eight accepted entries preserve a dirty inspector and restore it with one Properties activation at policy width %s', async viewport => {
    await width(viewport); const recipe = await prepareWriting(true);
    const panel = control('selection-inspector'), pane = control('workspace-tools'); panel.scrollTop = 137; pane.scrollTop = 23;
    await click('toggle-entry'); expect(pane.hidden).toBe(viewport < 960 + 320 + 16);
    const ids = await writeEntries(8, recipe); expect(new Set(ids).size).toBe(8);
    if (!pane.hidden) await click('tools-hide');
    expect(control('tools-toggle').textContent).toBe('More'); const before = accepted(), actionCount = actions.length;
    await click('tools-toggle'); expect(actions.slice(actionCount)).toEqual(['click:tools-toggle']);
    expect(pane.hidden).toBe(false); expect(panel.hidden).toBe(false); expect(panel.dataset.draftTarget).toBe('writing-note-8');
    expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqf4'); expect(panel.scrollTop).toBe(137); expect(pane.scrollTop).toBe(23);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(control('selection-controls').hidden).toBe(true); expect(entryRecipe()).toEqual(recipe); noEdit(before);
    expect(control<HTMLButtonElement>('update-event').disabled).toBe(true); expect(available(control('return-selected-draft'))).toBe(true);
  });
  it('reading clean held Properties and switching tools is passive; Return explicitly authorizes correction before Resume restores writing', async () => {
    const recipe = await prepareWriting(false); await click('toggle-entry'); const writing = app!.session.cursor, beforeReading = accepted();
    await click('other-tools'); await click('tool-tab-measure'); await click('back-to-properties');
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(control('selection-inspector').dataset.draftTarget).toBe('writing-note-8');
    expect(control<HTMLButtonElement>('update-event').disabled).toBe(true); expect(available(control('return-selected-draft'))).toBe(true); noEdit(beforeReading);
    await click('return-selected-draft'); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('false'); expectMembers(['writing-note-8']);
    expect(app!.session.cursor).toEqual(writing); await click('selection-sharp'); expect(pitchText(eventById('writing-note-8').pitches[0])).toBe('F#4');
    await click('toggle-entry'); expect(app!.session.cursor).toEqual(writing); expect(entryRecipe()).toEqual(recipe);
    const entries = await writeEntries(1, recipe); expect(app!.session.score.staves[0].measures[19].voices[0].events[0].id).toBe(entries[0]);
  });
  it('a held scalar draft for A and attachment draft for E remain distinct while quick correction edits B', async () => {
    mount(); const recipe = await configureFutureRecipe(); await properties('a'); await setField('selected-pitch', 'Gqs4');
    await chooseSource('e'); const beforeOpeningE = accepted();
    // More now toggles the visible pane. Closing it does not authorize a new
    // target or discard the held draft; reopening is a separate activation.
    await click('edit-selected-event'); expect(control('workspace-tools').hidden).toBe(true); noEdit(beforeOpeningE);
    expect(control('selection-inspector').dataset.draftTarget).toBe('a'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqs4');
    await click('edit-selected-event'); expect(control('workspace-tools').hidden).toBe(false); expect(control('selection-inspector').hidden).toBe(false); noEdit(beforeOpeningE);
    await markingType('e-turn', 'inverted-turn'); await chooseSource('b'); const before = accepted();
    await click('selection-sharp'); expect(pitchText(eventById('b').pitches[0])).toBe('F#4'); expect(pitchText(eventById('a').pitches[0])).toBe('F4');
    expect(eventById('e').markings?.[0]).toMatchObject({ id: 'e-turn', kind: 'ornament', type: 'turn' }); expect(app!.session.revision).toBe(before.revision + 1);
    expect(control('selection-inspector').dataset.draftTarget).toBe('a'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqs4');
    expect(control('event-markings-editor').dataset.draftTarget).toBe('e'); expect(markingRow('e-turn').querySelector<HTMLSelectElement>('[data-marking-field="type"]')?.value).toBe('inverted-turn');
    expect(control('event-form-context').textContent).toMatch(/12/); expect(control('event-markings-target').textContent).toMatch(/13/);
    expect(control<HTMLButtonElement>('update-event').disabled).toBe(true); expect(control<HTMLButtonElement>('apply-event-markings').disabled).toBe(true);
    const guarded = accepted(); await deliverStaleClick(control('update-event')); await deliverStaleClick(control('apply-event-markings')); noEdit(guarded); expect(entryRecipe()).toEqual(recipe);
    await click('return-selected-draft'); expectMembers(['a']); expect(control<HTMLButtonElement>('apply-event-markings').disabled).toBe(true);
    const beforeA = app!.session.revision; await click('update-event'); expect(app!.session.revision).toBe(beforeA + 1); expect(pitchText(eventById('a').pitches[0])).toBe('Gqs4');
    expect(control('event-markings-editor').dataset.draftTarget).toBe('e'); expect(markingRow('e-turn').querySelector<HTMLSelectElement>('[data-marking-field="type"]')?.value).toBe('inverted-turn');
    await click('return-event-markings'); expectMembers(['e']); const beforeDiscard = accepted(); await click('discard-event-markings'); noEdit(beforeDiscard);
    expect(eventById('e').markings?.[0]).toMatchObject({ id: 'e-turn', type: 'turn' }); expect(pitchText(eventById('b').pitches[0])).toBe('F#4'); expect(entryRecipe()).toEqual(recipe);
  });
  it('an accepted-value correction on A does not read its staged pitch and exposes a genuine conflict when that pitch is later corrected', async () => {
    mount(); await properties('a'); await setField('selected-pitch', 'Gqf4'); const before = accepted();
    await click('selection-value'); await setField('selection-duration', 'eighth'); await click('close-selection-value');
    expect(pitchText(eventById('a').pitches[0])).toBe('F4'); expect(eventById('a').duration).toBe('eighth'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    expect(app!.session.revision).toBe(before.revision + 1); await click('selection-sharp');
    expect(pitchText(eventById('a').pitches[0])).toBe('F#4'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    expect(control('selected-draft-status').dataset.draftState).toBe('conflict'); expect(available(control('review-selected-draft'))).toBe(true);
    expect(control('selection-inspector').dataset.draftTarget).toBe('a');
  });
});

describe('selection modes, native ownership, and drag admission policy', () => {
  it('Select more toggles exact touch targets; arrows move only focus, Space toggles, and toggling off keeps membership', async () => {
    mount(); await chooseSource('a'); const before = accepted();
    expect(available(control('selection-select-more'))).toBe(true); await click('selection-select-more');
    expect(control('selection-select-more').getAttribute('aria-pressed')).toBe('true');
    expect(document.body.dataset.selectMore).toBe('true'); await chooseSource('c', { pointerType: 'touch' }); expectMembers(['a', 'c'], 'c', 'a');
    await key('ArrowLeft'); expectMembers(['a', 'c'], 'c', 'a'); expect(exactSelection().focusId).toBe('b');
    await key(' '); expectMembers(['a', 'b', 'c'], 'b', 'a'); await click('selection-select-more'); expect(document.body.dataset.selectMore).toBe('false');
    expectMembers(['a', 'b', 'c'], 'b', 'a'); await key('ArrowRight'); expectMembers(['c'], 'c', 'c'); noEdit(before);
  });
  it.each([{ shiftKey: true }, { ctrlKey: true }])('a selection-modifier press parks entry before gesture setup: %j', async modifier => {
    mount(); await chooseSource('a'); await startHere(); const before = accepted(), recipe = entryRecipe();
    const press = new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, pointerId: 71, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, ...modifier });
    control('score-host').dispatchEvent(press); await flush();
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('false'); expect(document.body.dataset.pointerGesture).toBeUndefined(); noEdit(before); expect(entryRecipe()).toEqual(recipe);
    // Only admission policy is asserted: no renderer/CTM is supplied here.
  });
  it('exposes deliberate pitch-drag preparation only for one eligible selected note, never a group primary', async () => {
    mount(); await properties('a'); expect(control<HTMLButtonElement>('selection-prepare-drag').disabled).toBe(false); const before = accepted();
    await click('selection-prepare-drag'); expect(document.body.dataset.pitchDragArmed).toBe('true'); expect(available(control('drag-pitch'))).toBe(true);
    expect(control('workspace-tools').hidden).toBe(true); noEdit(before); await key('Escape'); expect(document.body.dataset.pitchDragArmed).not.toBe('true');
    await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); expect(control<HTMLButtonElement>('drag-pitch').disabled).toBe(true);
    await click('edit-selected-event'); expect(control<HTMLButtonElement>('selection-prepare-drag').disabled).toBe(true);
    const guarded = accepted(); await deliverStaleClick(control('selection-prepare-drag')); expect(document.body.dataset.pitchDragArmed).not.toBe('true'); noEdit(guarded);
  });
  it('closing an open value chooser consumes the first Escape without clearing the selected music', async () => {
    mount(); await chooseSource('a'); await click('selection-value'); const selection = exactSelection(), before = accepted();
    await key('Escape', 'selection-value-chooser'); expect(control('selection-value-chooser').hidden).toBe(true); expect(exactSelection()).toEqual(selection); noEdit(before);
    await key('Escape'); expectMembers([]); noEdit(before);
  });
  it.each(['input', 'textarea', 'select', 'button', 'a', 'summary', 'editable-empty', 'editable-plaintext', 'transcript', 'diagnostics'])('does not consume Enter from an actual shadow %s target while entering', async kind => {
    mount(); await chooseSource('a'); await startHere(); const before = accepted();
    const shadow = control('score-host').shadowRoot!; const host = document.createElement('div'); let target: HTMLElement;
    if (kind === 'summary') { const details = document.createElement('details'); target = document.createElement('summary'); target.textContent = 'Readable notation'; details.append(target); host.append(details); }
    else if (kind.startsWith('editable')) { target = document.createElement('div'); target.setAttribute('contenteditable', kind === 'editable-empty' ? '' : 'plaintext-only'); host.append(target); }
    else if (kind === 'transcript' || kind === 'diagnostics') { target = document.createElement('pre'); target.className = kind; target.textContent = 'F4, then hold'; target.tabIndex = 0; host.append(target); }
    else { target = document.createElement(kind); if (kind === 'a') target.setAttribute('href', '#native'); host.append(target); }
    shadow.append(host); target.focus(); const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }); target.dispatchEvent(event); await flush();
    expect(event.defaultPrevented).toBe(false); noEdit(before); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(control('workspace-tools').hidden).toBe(true);
  });
  it('keeps printed instruction selection passive, leaves its double-click as text intent, and opens Instructions only on explicit Enter', async () => {
    mount('<music-staff id="staff" label="Lead"><music-measure id="bar"><music-note id="a" pitch="F4" duration="half"></music-note><music-harmony id="harmony" text="Dm9"></music-harmony><music-note id="b" pitch="G4" duration="half"></music-note></music-measure></music-staff>');
    const before = accepted(); await chooseSource('harmony'); expect(exactSelection().sourceId).toBe('harmony'); expectMembers([]); expect(control('workspace-tools').hidden).toBe(true);
    await chooseSource('harmony', { clickCount: 2 }); expect(control('workspace-tools').hidden).toBe(true); noEdit(before);
    await key('Enter'); expect(control('annotation-inspector').hidden).toBe(false); expect(authorActiveElement(document)).toBe(control('annotation-text'));
    expect(app!.session.source.querySelector('#harmony')?.hasAttribute('at')).toBe(false); noEdit(before);
  });
});

describe('whole-selection and document identity guard pending decisions', () => {
  it.each([false, true])('an old conversion decision cannot survive nonprimary membership changes (round trip: %s)', async roundTrip => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); await chooseSource('e', { ctrlKey: true });
    await click('selection-relationships'); await setField('convert-kind', 'note'); await setField('convert-pitch', 'G4');
    const initial = exactSelection(), before = accepted(); await click('convert-events'); expect(control<HTMLDialogElement>('author-confirmation').open).toBe(true);
    await externalToggleSelection('c');
    if (roundTrip) { await externalToggleSelection('c'); await externalToggleSelection('e'); await externalToggleSelection('e'); }
    expect(exactSelection().primaryId).toBe(initial.primaryId); expect(exactSelection().anchorId).toBe(initial.anchorId);
    expect(exactSelection().version).toBeGreaterThan(initial.version); expect(control<HTMLInputElement>('convert-pitch').value).toBe('G4'); noEdit(before);
    if (roundTrip) expect(selectedIds()).toEqual(initial.ids); else expectMembers(['a', 'e'], 'e', 'a');
    await deliverStaleClick(control('author-confirmation-confirm')); noEdit(before); expect(control<HTMLDialogElement>('author-confirmation').open).toBe(true);
    expect(control('author-confirmation-status').textContent).toMatch(/changed|again|current|stale/i); await click('author-confirmation-cancel');
    const current = selectedIds(); await click('convert-events'); await click('author-confirmation-confirm');
    expect(app!.session.revision).toBe(before.revision + 1); for (const id of current) expect(pitchText(eventById(id).pitches[0])).toBe('G4');
    for (const id of ['a', 'b', 'c', 'd', 'e'].filter(id => !current.includes(id))) expect(pitchText(eventById(id).pitches[0])).toBe('F4');
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(selectedIds()).toEqual(current);
  });
  it('hidden-part selection is pruned rather than retargeted to a different visible event with a stale exact-child route', async () => {
    const workspace = mount(); await chooseSource('a-accent'); const oldEdit = control('selection-mark-edit');
    await key(' ', oldEdit.id); // Capture an actual pending button action, not just its reusable DOM node.
    const part = workspace.session.project.parts.find(part => part.staffIds.length === 1 && part.staffIds[0] === 'bass');
    expect(part).toBeTruthy(); const before = accepted(); await click('location-trigger'); await setField('part-select', part!.id); await click('close-location');
    expect(selectedIds()).not.toContain('a'); expect(control('score-editor').dataset.activeMarkingId || undefined).toBeUndefined();
    const current = exactSelection(); oldEdit.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    await deliverStaleClick(oldEdit); expect(exactSelection()).toEqual(current); expect(control('workspace-tools').hidden).toBe(true); noEdit(before);
  });
  it.each(['read', 'pages'])('Read/Pages hides selected-music commands and refuses a retained immediate action in %s', async mode => {
    mount(); await chooseSource('a'); const oldSharp = control('selection-sharp'); const before = accepted(); await click(`view-${mode}`);
    expect(control('selection-controls').hidden).toBe(true); await deliverStaleClick(oldSharp); noEdit(before);
    expect(pitchText(eventById('a').pitches[0])).toBe('F4');
  });
  it('pending Source refuses a retained quick action while preserving the staged text and accepted music', async () => {
    mount(); await chooseSource('a'); const oldSharp = control('selection-sharp'); await click('source-trigger');
    const pending = `${app!.session.project.sourceHtml}\n<!-- unfinished source review -->`; await setField('source-input', pending); await click('close-source');
    const before = accepted(); expect(app!.session.project.pendingSource).toBe(pending); await deliverStaleClick(oldSharp); noEdit(before);
    expect(app!.session.project.pendingSource).toBe(pending); expect(pitchText(eventById('a').pitches[0])).toBe('F4');
  });
});

describe('shared value accuracy and exact visible membership', () => {
  it('changing written value preserves augmentation dots, and changing dots preserves the new duration', async () => {
    mount('<music-staff id="staff"><music-measure id="bar"><music-note id="dotted" pitch="Fqs4" duration="half" dots="1"></music-note><music-note id="tail" pitch="G4" duration="quarter"></music-note></music-measure></music-staff>');
    await chooseSource('dotted'); const before = accepted(), recipe = entryRecipe(); await click('selection-value');
    await setField('selection-duration', 'eighth'); expect(eventById('dotted')).toMatchObject({ duration: 'eighth', dots: 1, time: { numerator: 3, denominator: 16 } });
    await setField('selection-dots', '2'); expect(eventById('dotted')).toMatchObject({ duration: 'eighth', dots: 2, time: { numerator: 7, denominator: 32 } });
    expect(pitchText(eventById('dotted').pitches[0])).toBe('Fqs4'); expect(app!.session.revision).toBe(before.revision + 2); expect(entryRecipe()).toEqual(recipe);
    await click('close-selection-value'); await click('undo'); expect(eventById('dotted')).toMatchObject({ duration: 'eighth', dots: 1 });
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(entryRecipe()).toEqual(recipe);
  });
  it('one successful shared duration edit preserves the holes, source IDs and writing cursor through Undo and Redo', async () => {
    mount(); const recipe = await configureFutureRecipe(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); const before = accepted(), original = exactSelection();
    const pressed = [...authorControlRoot(document, 'event-navigator')!.querySelectorAll<HTMLElement>('[data-source-id][aria-pressed="true"]')].map(button => button.dataset.sourceId);
    expect(pressed).toEqual(['a', 'c']); await shared(); await setField('selection-shared-duration', 'eighth');
    expect(['a', 'b', 'c', 'd'].map(id => eventById(id).duration)).toEqual(['eighth', 'quarter', 'eighth', 'quarter']);
    expect(app!.session.revision).toBe(before.revision + 1); expectMembers(['a', 'c'], original.primaryId, original.anchorId); expect(entryRecipe()).toEqual(recipe); expect(app!.session.cursor).toEqual(before.cursor);
    const after = app!.session.project.sourceHtml; await click('close-selection-shared'); await click('undo');
    expect(app!.session.project.sourceHtml).toBe(before.source); expectMembers(['a', 'c'], original.primaryId, original.anchorId); expect(app!.session.cursor).toEqual(before.cursor);
    await click('redo'); expect(app!.session.project.sourceHtml).toBe(after); expectMembers(['a', 'c'], original.primaryId, original.anchorId); expect(entryRecipe()).toEqual(recipe);
  });
  it('one incompatible member disables the whole alteration action instead of correcting an eligible primary alone', async () => {
    mount(selectionSource.replace('<music-note id="b" pitch="F4" duration="quarter"></music-note>', '<music-rest id="b" duration="quarter"></music-rest>'));
    await chooseSource('b'); await chooseSource('a', { ctrlKey: true }); expectMembers(['a', 'b'], 'a', 'b'); await shared();
    expect(control<HTMLSelectElement>('selection-shared-alteration').disabled).toBe(true); const before = accepted();
    await deliverStaleField(control<HTMLSelectElement>('selection-shared-alteration'), '1'); noEdit(before); expect(eventById('a').pitches[0].alter).toBe(0); expect(eventById('b').kind).toBe('rest');
  });
});

describe('explicit transition from writing back to inspected properties', () => {
  it.each(['more', 'enter'] as const)('blank → insert B → Select → %s binds the newly written B without a score reselect', async route => {
    mount('<music-staff id="entry-staff" label="Blank"><music-measure id="entry-bar"><music-rest id="entry-rest" measure></music-rest></music-measure></music-staff>');
    await startHere(); await click('entry-settings-trigger'); await setField('event-pitch', 'B4'); await click('close-entry-settings');
    await key('Enter'); const written = app!.session.cursor?.eventId; expect(written).toBeTruthy(); expect(pitchText(eventById(written!).pitches[0])).toBe('B4');
    await click('select-mode'); const before = accepted(), recipe = entryRecipe();
    if (route === 'more') await click('edit-selected-event'); else await key('Enter');
    expect(control('selection-inspector').dataset.draftTarget).toBe(written); expect(control<HTMLInputElement>('selected-pitch').value).toBe('B4');
    expect(control('workspace-tools').hidden).toBe(false); expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it.each([false, true])('reopening More after Select and insertion follows B only when old Properties A is clean (old draft dirty: %s)', async dirty => {
    const recipe = await prepareWriting(dirty); await click('toggle-entry'); await writeEntries(1, recipe);
    const written = app!.session.cursor?.eventId; expect(written).toBeTruthy(); await click('select-mode');
    const before = accepted(), heldTarget = control('selection-inspector').dataset.draftTarget, heldPitch = control<HTMLInputElement>('selected-pitch').value;
    expect(control('workspace-tools').hidden).toBe(false); await click('edit-selected-event');
    expect(control('workspace-tools').hidden).toBe(true); expect(control('edit-selected-event').getAttribute('aria-expanded')).toBe('false');
    expect(control('selection-inspector').dataset.draftTarget).toBe(heldTarget); expect(control<HTMLInputElement>('selected-pitch').value).toBe(heldPitch); noEdit(before);
    await click('edit-selected-event'); expect(control('workspace-tools').hidden).toBe(false); expect(control('edit-selected-event').getAttribute('aria-expanded')).toBe('true');
    expect(control('selection-inspector').dataset.draftTarget).toBe(dirty ? 'writing-note-8' : written);
    expect(control<HTMLInputElement>('selected-pitch').value).toBe(dirty ? 'Gqf4' : 'Fqs4'); expectMembers([written!]);
    if (dirty) { expect(available(control('return-selected-draft'))).toBe(true); expect(control<HTMLButtonElement>('update-event').disabled).toBe(true); }
    expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it.each(['range', 'escape'] as const)('a phone Properties restore survives %s clearing the scalar inspection accessor while dirty A remains held', async change => {
    await width(390); const recipe = await prepareWriting(true); const panel = control('selection-inspector'); panel.scrollTop = 153;
    expect(control('workspace-tools').dataset.toolsPresentation).toBe('sheet'); await click('tools-expand');
    await chooseSource('writing-note-12', { shiftKey: true }); expect(selectedIds().length).toBeGreaterThan(1);
    if (change === 'escape') { await key('Escape'); expectMembers([]); }
    expect(panel.dataset.draftTarget).toBe('writing-note-8'); expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqf4');
    await click('toggle-entry'); expect(control('workspace-tools').hidden).toBe(true); expect(control('tools-toggle').textContent).toBe('More');
    const before = accepted(), actionCount = actions.length; await click('tools-toggle'); expect(actions.slice(actionCount)).toEqual(['click:tools-toggle']);
    expect(control('workspace-tools').hidden).toBe(false); expect(panel.hidden).toBe(false); expect(panel.dataset.draftTarget).toBe('writing-note-8');
    expect(control<HTMLInputElement>('selected-pitch').value).toBe('Gqf4'); expect(panel.scrollTop).toBe(153);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it('Location inspection at bar 12 leaves the independently parked writing point at bar 20', async () => {
    const recipe = await prepareWriting(false); const before = accepted(); await location('writing-staff', 'writing-bar-12');
    expect(control('resume-entry').textContent).toMatch(/20/); noEdit(before); await click('toggle-entry');
    expect(app!.session.cursor?.measureId).toBe('writing-bar-20'); expect(entryRecipe()).toEqual(recipe);
  });
});

describe('history restores writing independently from inspected selection', () => {
  it('Resume B → Undo an A correction while entering → Enter writes at B’s exact onset, never at restored selection A', async () => {
    const recipe = await prepareWriting(false); const writing = app!.session.cursor; expect(writing?.measureId).toBe('writing-bar-20');
    expectMembers(['writing-note-8']); const beforeA = accepted(); await click('selection-sharp');
    expect(pitchText(eventById('writing-note-8').pitches[0])).toBe('F#4'); expect(app!.session.cursor).toEqual(writing);
    await click('toggle-entry'); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); await click('undo');
    expect(app!.session.project.sourceHtml).toBe(beforeA.source); expect(app!.session.cursor).toEqual(writing); expectMembers(['writing-note-8']);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(entryRecipe()).toEqual(recipe);
    const revision = app!.session.revision; await key('Enter'); expect(app!.session.revision).toBe(revision + 1);
    const bars = app!.session.score.staves[0].measures; const written = bars[19].voices[0].events;
    expect(written).toHaveLength(1); expect(written[0]).toMatchObject({ kind: 'note', duration: 'quarter', onset: { numerator: 0, denominator: 1 }, time: { numerator: 1, denominator: 4 } });
    expect(written[0].pitches.map(pitchText)).toEqual(['Fqs4']); expect(app!.session.cursor).toMatchObject({ measureId: 'writing-bar-20', eventId: written[0].id });
    expect(bars[7].voices[0].events).toHaveLength(1); expect(bars[7].voices[0].events[0]).toMatchObject({ id: 'writing-note-8', duration: 'whole' });
    expect(bars[7].voices[0].events[0].pitches.map(pitchText)).toEqual(['F4']); expect(bars).toHaveLength(20);
  });
  it('Redo while writing is parked advances the resumable bookmark, so the next entry follows the restored second event', async () => {
    const recipe = await prepareWriting(false); await click('toggle-entry'); const [first, second] = await writeEntries(2, recipe);
    const afterTwo = accepted(); await click('undo'); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(app!.session.cursor?.eventId).toBe(first); expect(app!.session.source.querySelector(`[id="${second}"]`)).toBeNull();
    await click('select-mode'); await chooseSource('writing-note-8'); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('false'); expectMembers(['writing-note-8']);
    await click('redo'); expect(app!.session.project.sourceHtml).toBe(afterTwo.source); expect(app!.session.cursor?.eventId).toBe(second);
    expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('false'); expect(entryRecipe()).toEqual(recipe);
    expect(control('entry-mode-reason').hidden).toBe(true); const beforeResume = accepted();
    // The fixed Write notes action resumes the restored bookmark even when
    // history also restores inspection to a different event.
    await click('toggle-entry');
    expect(app!.session.project.sourceHtml).toBe(beforeResume.source); expect(app!.session.revision).toBe(beforeResume.revision);
    const resumedCursor = app!.session.cursor; await key('Enter'); const third = app!.session.cursor?.eventId; expect(third).toBeTruthy();
    const events = app!.session.score.staves[0].measures[19].voices[0].events;
    expect(events.map(event => event.id)).toEqual([first, second, third]);
    expect(events.map(event => event.onset)).toEqual([{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 4 }, { numerator: 1, denominator: 2 }]);
    expect(events.map(event => event.pitches.map(pitchText))).toEqual([['Fqs4'], ['Fqs4'], ['Fqs4']]);
    expect(resumedCursor).toEqual(beforeResume.cursor); expect(app!.session.revision).toBe(beforeResume.revision + 1); expect(entryRecipe()).toEqual(recipe);
    expect(eventById('writing-note-8')).toMatchObject({ duration: 'whole' }); expect(eventById('writing-note-8').pitches.map(pitchText)).toEqual(['F4']);
  });
  it('Undo of an insertion while writing is parked restores its previous resumable event instead of retaining the deleted new event', async () => {
    const recipe = await prepareWriting(false); await click('toggle-entry'); const [first] = await writeEntries(1, recipe); const beforeSecond = accepted();
    const [removed] = await writeEntries(1, recipe); expect(removed).not.toBe(first); await click('select-mode'); await chooseSource('writing-note-8'); expectMembers(['writing-note-8']);
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(beforeSecond.source); expect(app!.session.cursor).toEqual(beforeSecond.cursor);
    expect(app!.session.source.querySelector(`[id="${removed}"]`)).toBeNull(); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('false');
    expect(entryRecipe()).toEqual(recipe); expect(control('entry-mode-reason').hidden).toBe(true);
    expect(control('entry-mode-label').textContent).toBe('Write notes'); const beforeResume = accepted();
    await click('toggle-entry'); noEdit(beforeResume); expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    await key('Enter'); const next = app!.session.cursor?.eventId; expect(next).toBeTruthy(); expect(next).not.toBe(first);
    const events = app!.session.score.staves[0].measures[19].voices[0].events;
    expect(events.map(event => event.id)).toEqual([first, next]); expect(events[1]).toMatchObject({ duration: 'quarter', dots: 0,
      onset: { numerator: 1, denominator: 4 }, time: { numerator: 1, denominator: 4 } });
    expect(events.map(event => event.pitches.map(pitchText))).toEqual([['Fqs4'], ['Fqs4']]); expect(app!.session.revision).toBe(beforeResume.revision + 1);
    expect(entryRecipe()).toEqual(recipe); expect(eventById('writing-note-8').duration).toBe('whole'); expect(eventById('writing-note-8').pitches.map(pitchText)).toEqual(['F4']);
  });
});

describe('review regressions for displayed range and read-only activation', () => {
  it('toggle B + A + C displays the actual contiguous range From A Through C, not the original anchor B', async () => {
    mount(); const before = accepted(); await chooseSource('b'); await chooseSource('a', { ctrlKey: true }); await chooseSource('c', { ctrlKey: true });
    expectMembers(['a', 'b', 'c'], 'c', 'b'); expect(control<HTMLSelectElement>('range-start').value).toBe('a'); expect(control<HTMLSelectElement>('range-end').value).toBe('c'); noEdit(before);
  });
  it('a read-only double activation does not open editing tools or report a writing error', async () => {
    mount(); await chooseSource('a'); await click('view-read'); const before = accepted();
    await chooseSource('a'); await chooseSource('a', { clickCount: 2 });
    expect(control('workspace-tools').hidden).toBe(true); expect(control('author-errors').hidden).toBe(true); expect(control('selection-controls').hidden).toBe(true); noEdit(before);
  });
});

async function rejectQuickOverflow(): Promise<{ before: ReturnType<typeof accepted>; message: string }> {
  const before = accepted(); await click('selection-value'); await setField('selection-duration', 'half');
  noEdit(before); expect(eventById('a').duration).toBe('quarter');
  const message = control('selection-value-error').textContent?.trim() ?? '';
  expect(message).toMatch(/contains.*allows|excess|overflow/i); expect(control('selection-value-error').hidden).toBe(false);
  expect(document.body.dataset.selectionFeedback).toBe('rejected'); expect(control('selection-review').hidden).toBe(true);
  expect(available(control('workspace-feedback-label'))).toBe(true); expect(control('workspace-feedback-label').getAttribute('aria-label')).toBe(message);
  expect(available(control('workspace-review-trigger'))).toBe(true); expect(control('workspace-review-trigger').textContent).toBe('Review error');
  expect(control('author-errors').textContent?.trim()).toBe(message); return { before, message };
}

describe('header error recovery keeps one active announcement and reachable full details', () => {
  it('quick overflow keeps correction actions available and opens the complete unchanged failure through header Review', async () => {
    mount(); await chooseSource('a'); const { before, message } = await rejectQuickOverflow();
    expect(control('workspace-review-summary').hidden).toBe(true); expect(control('workspace-review-trigger').hidden).toBe(false);
    expect(control('workspace-feedback-label').getAttribute('aria-live')).toBe('off');
    for (const id of ['author-errors', 'selection-controls-error', 'pointer-status']) {
      expect(control(id).getAttribute('role')).toBeNull(); expect(control(id).getAttribute('aria-live')).toBeNull();
    }
    expect(control('inspector-draft-status').hidden).toBe(true); expect(control('source-draft-notice').hidden).toBe(true);
    await click('close-selection-value'); expect(available(control('workspace-review-trigger'))).toBe(true);
    expect(control('workspace-feedback-label').getAttribute('aria-live')).toBe('polite');
    for (const id of ['selection-value', 'selection-pitch', 'selection-attached-marks']) expect(available(control(id))).toBe(true);
    expect(control('selection-controls-error').textContent?.trim()).toBe(message);
    await click('workspace-review-trigger'); expect(control('workspace-review').hidden).toBe(false); expect(available(control('author-errors'))).toBe(true);
    expect(control('author-errors').textContent?.trim()).toBe(message); noEdit(before);
    await click('close-workspace-review'); expect(document.body.dataset.selectionFeedback).toBe('rejected');
    expect(available(control('workspace-review-trigger'))).toBe(true); expect(control('author-errors').textContent?.trim()).toBe(message); noEdit(before);
  });
  it('selecting B restores its normal controls while Review retains the full prior editing problem', async () => {
    mount(); await chooseSource('a'); const { before, message } = await rejectQuickOverflow(); await click('close-selection-value');
    await chooseSource('b'); expectMembers(['b']); expect(document.body.dataset.selectionFeedback).toBe('none');
    expect(control('selection-controls').hidden).toBe(false); expect(control('selection-controls').dataset.hasError).toBe('false');
    expect(available(control('selection-value'))).toBe(true); expect(available(control('selection-sharp'))).toBe(true); expect(control('selection-review').hidden).toBe(true);
    expect(control('workspace-review-summary').hidden).toBe(true); expect(control('workspace-review-trigger').hidden).toBe(false);
    await click('workspace-review-trigger'); expect(control('workspace-review').hidden).toBe(false); expect(control('author-errors').textContent?.trim()).toBe(message);
    expectMembers(['b']); noEdit(before);
  });
  it('a successful value correction clears rejected feedback and its retained Review route in the same accepted transaction', async () => {
    mount(); await chooseSource('a'); const recipe = entryRecipe(), { before } = await rejectQuickOverflow();
    await setField('selection-duration', 'eighth'); expect(app!.session.revision).toBe(before.revision + 1);
    expect(eventById('a')).toMatchObject({ duration: 'eighth', time: { numerator: 1, denominator: 8 } });
    expect(document.body.dataset.selectionFeedback).toBe('none'); expect(control('selection-controls-error').hidden).toBe(true);
    expect(control('selection-value-error').hidden).toBe(true); expect(control('author-errors').hidden).toBe(true);
    expect(control('selection-review').hidden).toBe(true); expect(control('selection-review-history').hidden).toBe(true);
    expect(control('workspace-review-summary').hidden).toBe(true); expect(control('workspace-review-trigger').textContent).not.toMatch(/error/i); expect(entryRecipe()).toEqual(recipe);
    await click('close-selection-value'); await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source);
    expect(document.body.dataset.selectionFeedback).toBe('none'); expect(control('selection-review').hidden).toBe(true);
  });
  it('reselecting the same event clears only active rejection presentation, preserving selection version and the full prior Review history', async () => {
    mount(); await chooseSource('a'); const selection = exactSelection(), recipe = entryRecipe();
    const { before, message } = await rejectQuickOverflow(); await click('close-selection-value'); await chooseSource('a');
    expect(exactSelection()).toEqual(selection); expect(app!.session.selectionVersion).toBe(selection.version); noEdit(before);
    expect(document.body.dataset.selectionFeedback).toBe('none'); expect(control('selection-controls').hidden).toBe(false);
    expect(control('selection-controls').dataset.hasError).toBe('false'); expect(control('selection-controls-error').hidden).toBe(true);
    expect(control('selection-value-error').hidden).toBe(true); expect(control('selection-review').hidden).toBe(true);
    expect(available(control('selection-value'))).toBe(true); expect(available(control('selection-sharp'))).toBe(true);
    expect(control('workspace-review-summary').hidden).toBe(true); expect(control('workspace-review-trigger').hidden).toBe(false);
    await click('selection-value'); expect(control('selection-value-error').hidden).toBe(true); await click('close-selection-value');
    await click('location-trigger'); expect(available(control('selection-review-history'))).toBe(true); await click('selection-review-history');
    expect(control('workspace-review').hidden).toBe(false); expect(available(control('author-errors'))).toBe(true);
    expect(control('author-errors').textContent?.trim()).toBe(message); expect(exactSelection()).toEqual(selection); expect(entryRecipe()).toEqual(recipe); noEdit(before);
  });
  it('rechoosing the accepted value clears rejected feedback without an Undo step or loss of redo', async () => {
    mount(); await chooseSource('a'); await click('selection-sharp'); await click('undo'); expect(app!.session.canRedo).toBe(true);
    const { before } = await rejectQuickOverflow(), recipe = entryRecipe();
    await setField('selection-duration', 'quarter'); noEdit(before); expect(entryRecipe()).toEqual(recipe);
    expect(document.body.dataset.selectionFeedback).toBe('none'); expect(control('selection-controls').dataset.hasError).toBe('false');
    expect(control('selection-controls-error').hidden).toBe(true); expect(control('selection-value-error').hidden).toBe(true);
    expect(control('author-errors').hidden).toBe(true); expect(control('selection-review').hidden).toBe(true); expect(control('selection-review-history').hidden).toBe(true);
    expect(control('workspace-review-summary').hidden).toBe(true); expect(control('workspace-review-trigger').textContent).not.toMatch(/error/i);
    await click('close-selection-value'); await click('redo'); expect(pitchText(eventById('a').pitches[0])).toBe('F#4');
  });
  it('group More opens selection Relationships, keeps its holes until an explicit range change, and ties that chosen range in one Undo', async () => {
    mount(); await chooseSource('a'); await chooseSource('c', { ctrlKey: true }); const beforeRoute = accepted(), recipe = entryRecipe();
    await click('edit-selected-event'); expect(control('workspace-tools').hidden).toBe(false);
    expect(control('workspace-tools').dataset.toolsView).toBe('tools'); expect(control('workspace-tools').dataset.activeTool).toBe('rhythm');
    expect(control('passage-inspector').hidden).toBe(false); expect(control('selection-inspector').hidden).toBe(true);
    expect(control('tools-tablist').hidden).toBe(false); expectMembers(['a', 'c'], 'c', 'a'); noEdit(beforeRoute);
    expect(control<HTMLButtonElement>('tie-events').disabled).toBe(true);
    await setField('range-start', 'a'); await setField('range-end', 'c'); expectMembers(['a', 'b', 'c']); noEdit(beforeRoute);
    const beforeTie = accepted(); expect(control<HTMLButtonElement>('tie-events').disabled).toBe(false); await click('tie-events');
    expect(['a', 'b', 'c', 'd'].map(id => eventById(id).tie)).toEqual(['start', 'continue', 'end', 'none']);
    expect(app!.session.revision).toBe(beforeTie.revision + 1); expect(entryRecipe()).toEqual(recipe);
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(beforeTie.source); expectMembers(['a', 'b', 'c']); expect(entryRecipe()).toEqual(recipe);
  });
});

describe('phone pitch chooser provides direct ordinary accidental buttons', () => {
  it.each([
    { action: 'flat', initial: 'F4', expected: 'Fb4', alteration: '-1' },
    { action: 'natural', initial: 'F#4', expected: 'F4', alteration: '0' },
    { action: 'sharp', initial: 'F4', expected: 'F#4', alteration: '1' },
  ])('selection → Pitch → $action is three explicit activations, one exact-target edit and one Undo', async ({ action, initial, expected, alteration }) => {
    // Width exercises workspace policy only. Happy DOM does not qualify the
    // responsive CSS, native picker, or physical activation target dimensions.
    await width(390); mount(selectionSource.replace('id="c" pitch="F4"', `id="c" pitch="${initial}"`));
    const recipe = await configureFutureRecipe(), before = accepted(), original = eventById('c');
    const unchanged = ['a', 'b', 'd', 'e', 'f', 'g', 'h', 'v2a', 'v2b', 'v2c', 'bass-a', 'bass-b', 'bass-c']
      .map(id => ({ id, event: structuredClone(eventById(id)) }));
    const start = actions.length; await chooseSource('c'); await click('selection-pitch');
    expect(control('selection-pitch-chooser').hidden).toBe(false); await click(`selection-chooser-${action}`);
    expect(actions.slice(start)).toEqual(['source:c:{}', 'click:selection-pitch', `click:selection-chooser-${action}`]);
    expectMembers(['c'], 'c', 'c'); expect(pitchText(eventById('c').pitches[0])).toBe(expected);
    expect(control<HTMLSelectElement>('selection-alteration').value).toBe(alteration);
    for (const value of ['flat', 'natural', 'sharp']) expect(control(`selection-chooser-${value}`).getAttribute('aria-pressed')).toBe(String(value === action));
    expect(structuralState(eventById('c'))).toEqual(structuralState(original));
    for (const { id, event } of unchanged) expect(eventById(id)).toEqual(event);
    expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.cursor).toEqual(before.cursor);
    expect(entryRecipe()).toEqual(recipe); expect(control('workspace-tools').hidden).toBe(true);
    await click('close-selection-pitch'); await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source);
    expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(true); expectMembers(['c'], 'c', 'c');
    expect(app!.session.cursor).toEqual(before.cursor); expect(entryRecipe()).toEqual(recipe);
  });
});

describe('open-slash nominal span has an honest reachable Properties route', () => {
  it('Value opens named nominal fields, stages the exact span without prescribing rhythm, and applies with one Undo', async () => {
    mount('<music-staff id="improv-staff" label="Improvised line"><music-measure id="improv-bar"><music-slash id="open-span" duration="whole"></music-slash></music-measure></music-staff>');
    const recipe = await configureFutureRecipe(), before = accepted(), original = eventById('open-span');
    await chooseSource('open-span'); expect(control('selection-value').textContent).toMatch(/nominal span/i); await click('selection-value');
    expect(control('selection-value-chooser').hidden).toBe(true); expect(control('workspace-tools').hidden).toBe(false);
    expect(control('workspace-tools').dataset.toolsView).toBe('properties'); expect(control('selection-inspector').hidden).toBe(false);
    expect(control('selection-inspector').dataset.draftTarget).toBe('open-span'); expect(control<HTMLDetailsElement>('event-details').open).toBe(true);
    expect(available(control('selected-nominal-span'))).toBe(true); expect(control('selected-nominal-span').querySelector('legend')?.textContent).toMatch(/nominal span.*open slash/i);
    expect(control('selected-nominal-help').textContent).toMatch(/rhythm stays unwritten/i); expect(authorActiveElement(document)).toBe(control('selected-duration'));
    expect(control<HTMLSelectElement>('selected-kind').value).toBe('slash'); expect(control<HTMLSelectElement>('selected-duration').value).toBe('whole');
    expect(control<HTMLSelectElement>('selected-dots').value).toBe('0'); noEdit(before);
    await setField('selected-duration', 'half'); await setField('selected-dots', '1'); noEdit(before);
    expect(eventById('open-span')).toEqual(original); expect(entryRecipe()).toEqual(recipe);
    await click('update-event'); expect(app!.session.revision).toBe(before.revision + 1);
    expect(eventById('open-span')).toMatchObject({ id: 'open-span', kind: 'slash', rhythmic: false, measureRest: false,
      duration: 'half', dots: 1, time: { numerator: 3, denominator: 4 }, onset: { numerator: 0, denominator: 1 }, pitches: [] });
    expect(app!.session.source.querySelector('#open-span')?.tagName.toLowerCase()).toBe('music-slash');
    expect(eventById('open-span').tie).toBe(original.tie); expect(eventById('open-span').beam).toBe(original.beam);
    expect(eventById('open-span').stem).toBe(original.stem); expectMembers(['open-span']); expect(app!.session.cursor).toEqual(before.cursor); expect(entryRecipe()).toEqual(recipe);
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(eventById('open-span')).toEqual(original);
    expect(app!.session.canUndo).toBe(before.undo); expect(app!.session.canRedo).toBe(true); expect(app!.session.cursor).toEqual(before.cursor); expect(entryRecipe()).toEqual(recipe);
  });
});
