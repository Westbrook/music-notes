// @vitest-environment happy-dom
/**
 * Actual Author shell, controllers, session and drafts. Engraving dispatch is
 * stubbed and workbench width is an explicit policy fixture. DOM ancestry and
 * synthetic event routing do not qualify CSS position, glyph geometry, native
 * popovers/pickers, pointer capture or touch.
 */
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { pitchText } from '../src/model/index.js';

const source = `<music-staff id="lead" label="Lead">
  <music-measure id="bar-12" number="12"><music-voice id="voice-12">
    <music-note id="a" pitch="F4" duration="quarter"><music-articulation id="a-accent" type="accent"></music-articulation></music-note>
    <music-note id="b" pitch="G4" duration="quarter"></music-note><music-note id="c" pitch="Aqf4" duration="quarter"></music-note><music-note id="d" pitch="Bb4" duration="quarter"></music-note>
  </music-voice></music-measure>
  <music-measure id="bar-13" number="13"><music-voice id="voice-13">
    <music-note id="e" pitch="C5" duration="quarter"><music-ornament id="e-turn" type="turn"></music-ornament></music-note>
    <music-chord id="chord" pitches="C4 Eqs4 G4" duration="half"></music-chord><music-slash id="open-span" duration="quarter"></music-slash>
  </music-voice></music-measure>
  <music-measure id="bar-14" number="14"><music-voice id="voice-14"><music-rest id="writer" measure></music-rest></music-voice></music-measure>
</music-staff>`;

let app: AuthorWorkspace | undefined;
let sequence = 0;
let widthDescriptor: PropertyDescriptor | undefined;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id); if (!element) throw new Error(`Missing actual Author control #${id}.`); return element as T;
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
    const summary = details.querySelector<HTMLElement>(':scope > summary'); expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true);
    summary!.click(); await flush(); expect(details.open).toBe(true);
  }
}
async function click(id: string): Promise<void> {
  const button = el(id); await disclose(button); expect(available(button), `#${id} must be an available action`).toBe(true); button.click(); await flush();
}
async function field(id: string, value: string): Promise<void> {
  const control = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id); await disclose(control);
  expect(available(control), `#${id} must be an available field`).toBe(true);
  if (control instanceof HTMLSelectElement) expect([...control.options].some(option => option.value === value && !option.disabled)).toBe(true);
  control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function select(id: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean; clickCount?: number } = {}): Promise<void> {
  expect(available(el('score-host')), 'Select music only while the paper is available').toBe(true);
  const sourceElement = app!.session.source.id === id ? app!.session.source : app!.session.source.querySelector(`[id="${id}"]`); expect(sourceElement).not.toBeNull();
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail: {
    sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse', ...modifiers,
  } })); await flush();
}
async function key(value: string, id = 'score-editor', options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const target = el(id); expect(available(target), `#${id} must be available for keyboard input`).toBe(true); target.focus({ preventScroll: true });
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true, ...options }); target.dispatchEvent(event); await flush(); return event;
}
function mount(): AuthorWorkspace {
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `dock-workspace-${++sequence}`, writerId: 'dock-tests',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(source, 'Dock integration'), recovery }); return app;
}
function recipe() {
  return { values: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
    'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked, rhythmic: el<HTMLInputElement>('event-rhythmic').checked };
}
function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision, undo: app!.session.canUndo, redo: app!.session.canRedo,
    cursor: app!.session.cursor, selection: app!.session.selection, recipe: recipe(), activeMark: el('score-editor').dataset.activeMarkingId,
    parts: structuredClone(app!.session.project.parts), layouts: structuredClone(app!.session.project.layouts) };
}
function unchanged(before: ReturnType<typeof accepted>): void { expect(accepted()).toEqual(before); }
function engravingRequests(): number {
  return vi.mocked((app as unknown as { requestRender(): void }).requestRender).mock.calls.length;
}
function event(id: string) {
  const found = app!.session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).find(item => item.id === id);
  if (!found) throw new Error(`No accepted event ${id}.`); return found;
}
function drafts() {
  return { scalarTarget: el('selection-inspector').dataset.draftTarget, scalarState: el('selection-inspector').dataset.draftState,
    scalarValues: Object.fromEntries(['selected-kind', 'selected-pitch', 'selected-pitches', 'selected-duration', 'selected-dots']
      .map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    markTarget: el('event-markings-editor').dataset.draftTarget, markState: el('event-markings-editor').dataset.draftState,
    rows: [...el('event-markings-rows').querySelectorAll<HTMLElement>('[data-marking-id]')].map(row => ({ id: row.dataset.markingId,
      fields: [...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-marking-field]')].map(control => ({ key: control.dataset.markingField, value: control.value })) })) };
}
async function markType(id: string, value: string): Promise<void> {
  const row = el('event-markings-rows').querySelector<HTMLElement>(`[data-marking-id="${id}"]`); expect(row).not.toBeNull();
  const control = row!.querySelector<HTMLSelectElement>('[data-marking-field="type"]'); expect(control).not.toBeNull(); await field(control!.id, value);
}
async function startWriter(): Promise<void> {
  await select('writer'); await click('location-trigger'); await click('start-entry-here');
  await click('entry-settings-trigger'); await field('event-kind', 'note');
  await field('event-pitch', 'Fqs5'); await field('event-accidental-display', 'courtesy');
  await field('event-stem', 'down'); await field('event-beam', 'none'); await field('insert-position', 'after'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'eighth'); await field('event-dots', '1'); await click('close-entry-value');
  expect(app!.session.cursor?.measureId).toBe('bar-14'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
}
async function parkedWriter(): Promise<void> { await startWriter(); await click('select-mode'); await select('a'); }
function expectExpanded(value: boolean): void { expect(el('edit-selected-event').getAttribute('aria-expanded')).toBe(String(value)); }
function requireDock(id: string): void {
  expect(el(id).closest('#workspace-dock')).toBe(el('workspace-dock')); expect(el('score-editor').contains(el(id))).toBe(false);
}

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture();
  // A wide writing frame plus a usable pane must fit without shrinking the paper.
  // Compact policy cases below explicitly return from the task sheet to select.
  Object.defineProperty(el('author-workbench'), 'clientWidth', { configurable: true, get: () => window.innerWidth - 32 });
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});
afterEach(async () => { app?.dispose(); app = undefined; await flush(); vi.restoreAllMocks(); document.body.replaceChildren(); if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor); });

describe('More is a repeatable pane disclosure without a musical edit', () => {
  it('More opens, closes and reopens Properties while both dirty buffers, scroll, selection, recipe and the parked writer survive', async () => {
    mount(); await parkedWriter(); await click('edit-selected-event'); expect(el('workspace-tools').hidden).toBe(false);
    expect(document.body.dataset.toolsPresentation).toBe('side'); expect(available(el('score-host'))).toBe(true);
    await field('selected-pitch', 'Gqf4'); await markType('a-accent', 'fermata');
    const panel = el('selection-inspector'), pane = el('workspace-tools'); panel.scrollTop = 137; panel.scrollLeft = 11; pane.scrollTop = 29; pane.scrollLeft = 7;
    const before = accepted(), buffered = drafts(); expect(buffered.scalarState).toBe('dirty'); expect(buffered.markState).toBe('dirty');
    const paper = el('score-editor'), host = el('score-host'), renderCount = engravingRequests();
    expect(el('author-workbench').style.getPropertyValue('--writing-frame-width')).toBe('960px');
    await click('edit-selected-event'); expect(pane.hidden).toBe(true); expectExpanded(false); expect(document.activeElement).toBe(el('edit-selected-event'));
    unchanged(before); expect(drafts()).toEqual(buffered); expect(el<HTMLDetailsElement>('event-details').open).toBe(true);
    await click('edit-selected-event'); expect(pane.hidden).toBe(false); expectExpanded(true); expect(panel.hidden).toBe(false);
    expect([panel.scrollTop, panel.scrollLeft, pane.scrollTop, pane.scrollLeft]).toEqual([137, 11, 29, 7]); unchanged(before); expect(drafts()).toEqual(buffered);
    expect(el('score-editor')).toBe(paper); expect(el('score-host')).toBe(host);
    expect(el('author-workbench').style.getPropertyValue('--writing-frame-width')).toBe('960px'); expect(engravingRequests()).toBe(renderCount);
    await click('update-event'); expect(event('a').pitches.map(pitchText)).toEqual(['Gqf4']); expect(app!.session.revision).toBe(before.revision + 1);
    expect(event('a').markings?.[0]).toMatchObject({ id: 'a-accent', type: 'accent' }); expect(drafts().markState).toBe('dirty');
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(recipe()).toEqual(before.recipe); expect(app!.session.cursor).toEqual(before.cursor);
  });
  it('More closes the visible Properties pane even when B is selected and dirty scalar A plus attachment E remain held', async () => {
    mount(); await parkedWriter(); await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
    await select('e-turn'); await click('selection-mark-edit'); await markType('e-turn', 'inverted-turn'); await select('b');
    expect(app!.session.selection.ids).toEqual(['b']); expect(drafts()).toMatchObject({ scalarTarget: 'a', markTarget: 'e' });
    const before = accepted(), buffered = drafts(); await click('edit-selected-event');
    expect(el('workspace-tools').hidden).toBe(true); expectExpanded(false); unchanged(before); expect(drafts()).toEqual(buffered);
    await click('edit-selected-event'); expect(el('workspace-tools').hidden).toBe(false); expectExpanded(true); unchanged(before); expect(drafts()).toEqual(buffered);
    expect(available(el('return-selected-draft'))).toBe(true); expect(available(el('return-event-markings'))).toBe(true);
    expect(el<HTMLButtonElement>('update-event').disabled).toBe(true); expect(el<HTMLButtonElement>('apply-event-markings').disabled).toBe(true);
  });
  it('More opens its Properties destination from Other tools, then closes it; aria-expanded also follows explicit Hide', async () => {
    mount(); await parkedWriter(); await click('edit-selected-event'); expectExpanded(true); const before = accepted();
    await click('other-tools'); await click('tool-tab-measure'); expect(el('workspace-tools').hidden).toBe(false); expectExpanded(false);
    await click('edit-selected-event'); expect(el('selection-inspector').hidden).toBe(false); expectExpanded(true); unchanged(before);
    await click('edit-selected-event'); expect(el('workspace-tools').hidden).toBe(true); expectExpanded(false); unchanged(before);
    await click('edit-selected-event'); await click('tools-hide'); expect(el('workspace-tools').hidden).toBe(true); expectExpanded(false); unchanged(before);
  });
  it('More toggles the group Relationships destination without replacing disjoint selected membership or the parked writer', async () => {
    mount(); await parkedWriter(); await select('c', { ctrlKey: true }); const before = accepted();
    await click('edit-selected-event'); expect(el('passage-inspector').hidden).toBe(false); expectExpanded(true); unchanged(before);
    await click('edit-selected-event'); expect(el('workspace-tools').hidden).toBe(true); expectExpanded(false); unchanged(before);
    await click('edit-selected-event'); expect(el('passage-inspector').hidden).toBe(false); expectExpanded(true); unchanged(before);
    expect(app!.session.selection.ids).toEqual(['a', 'c']); expect(el<HTMLButtonElement>('tie-events').disabled).toBe(true);
  });
});

describe('specific editing destinations stay open-only', () => {
  it('repeating Edit mark preserves the exact attached row and its dirty value instead of toggling the pane closed', async () => {
    mount(); await parkedWriter(); await select('e-turn'); await click('selection-mark-edit'); await markType('e-turn', 'inverted-turn');
    const before = accepted(), buffered = drafts(); await click('selection-mark-edit');
    expect(el('workspace-tools').hidden).toBe(false); expect(el('selection-inspector').hidden).toBe(false); expect(el('event-markings-editor').dataset.activeMarkingId).toBe('e-turn');
    unchanged(before); expect(drafts()).toEqual(buffered);
  });
  it('repeating Pitches keeps the staged chord list open and focused without substituting the next-entry recipe', async () => {
    mount(); await parkedWriter(); await select('chord'); await click('selection-pitch'); await field('selected-pitches', 'C4 Eqs4 G4 Bb4');
    const before = accepted(), buffered = drafts(); await click('selection-pitch');
    expect(el('workspace-tools').hidden).toBe(false); expect(document.activeElement).toBe(el('selected-pitches')); unchanged(before); expect(drafts()).toEqual(buffered);
  });
  it('repeating Nominal span keeps its staged fields open and focused without prescribing slash rhythm', async () => {
    mount(); await parkedWriter(); await select('open-span'); await click('selection-value'); await field('selected-duration', 'eighth');
    const before = accepted(), buffered = drafts(); await click('selection-value');
    expect(el('workspace-tools').hidden).toBe(false); expect(available(el('selected-nominal-span'))).toBe(true); expect(document.activeElement).toBe(el('selected-duration'));
    expect(event('open-span').rhythmic).toBe(false); unchanged(before); expect(drafts()).toEqual(buffered);
  });
  it.each(['Enter', 'double activation'] as const)('repeating %s opens or focuses Properties and never turns it into More’s close action', async route => {
    mount(); await parkedWriter();
    const open = async () => { if (route === 'Enter') await key('Enter'); else { await select('a'); await select('a', { clickCount: 2 }); } };
    await open(); expect(el('workspace-tools').hidden).toBe(false); await field('selected-pitch', 'Gqf4'); const before = accepted(), buffered = drafts();
    await open(); expect(el('workspace-tools').hidden).toBe(false); unchanged(before); expect(drafts()).toEqual(buffered);
  });
});

describe('the bottom dock preserves entry and native control ownership', () => {
  it('the actual palette has fixed Mode, musical actions, More and Location columns, with native details and Review outside the dock', async () => {
    mount(); const workbench = el('author-workbench'), dock = el('workspace-dock');
    expect(dock.parentElement).toBe(workbench); expect(workbench.lastElementChild).toBe(dock);
    expect(el('score-editor').parentElement).toBe(workbench); expect(el('workspace-tools').parentElement).toBe(workbench);
    const columns = ['workspace-mode-slot', 'palette-musical-slots', 'palette-more-slot', 'location-trigger'];
    expect([...dock.children].filter(child => !child.classList.contains('visually-hidden')).map(child => child.id)).toEqual(columns);
    for (const id of ['entry-toolbar', 'pointer-tools']) expect(el(id).parentElement).toBe(el('palette-musical-slots'));
    const dockControls = ['toggle-entry', 'select-mode', 'tools-toggle', 'entry-settings-trigger', 'entry-value-trigger',
      'insert-event', 'drag-entry', 'drag-pitch', 'edit-selected-event', 'location-trigger'];
    for (const id of dockControls) requireDock(id);
    expect([...el('workspace-mode-slot').children].map(child => child.id)).toEqual(['toggle-entry', 'select-mode']);
    const surfaceControls = [['event-kind', 'entry-settings'], ['event-duration', 'entry-value-chooser'], ['resume-entry', 'location-panel'],
      ['pointer-status', 'workspace-review'], ['selection-controls-feedback', 'workspace-review']] as const;
    for (const [id, owner] of surfaceControls) { expect(el(id).closest(`#${owner}`)).toBe(el(owner)); expect(dock.contains(el(id))).toBe(false); }
    expect(el('workspace-review-trigger').closest('header')).not.toBeNull();
    const controls = [...dockControls, ...surfaceControls.map(([id]) => id)];
    for (const id of controls) expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    expect(el('edit-selected-label').textContent).toBe('More');
    const nodes = controls.map(id => el(id)); await startWriter();
    expect(available(el('toggle-entry'))).toBe(true); expect(available(el('select-mode'))).toBe(true);
    expect(available(el('tools-toggle'))).toBe(true); expect(el('tools-toggle').textContent?.trim()).toBe('More');
    await click('select-mode'); expect(el('edit-selected-label').textContent).toBe('More');
    for (const [index, id] of controls.entries()) expect(el(id)).toBe(nodes[index]);
    for (const id of dockControls) requireDock(id);
    expect(available(el('toggle-entry'))).toBe(true); expect(available(el('select-mode'))).toBe(true);
  });
  it.each([1180, 390])('the entry More toggle hides and restores both held drafts without leaving Write notes at policy width %s', async width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); mount(); await parkedWriter();
    await click('edit-selected-event'); await field('selected-pitch', 'Gqf4');
    expect(document.body.dataset.toolsPresentation).toBe('sheet'); expect(available(el('score-host'))).toBe(false);
    await click('tools-expand'); expect(available(el('score-host'))).toBe(true);
    await select('e-turn'); await click('selection-mark-edit'); await markType('e-turn', 'inverted-turn');
    const panel = el('selection-inspector'), pane = el('workspace-tools'); panel.scrollTop = 143; pane.scrollTop = 31;
    await click('toggle-entry'); requireDock('tools-toggle'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    const before = accepted(), buffered = drafts(); expect(buffered).toMatchObject({ scalarTarget: 'a', markTarget: 'e', scalarState: 'dirty', markState: 'dirty' });
    const paper = el('score-editor'), host = el('score-host'), renderCount = engravingRequests(), frameWidth = `${Math.min(960, width - 32)}px`;
    expect(el('author-workbench').style.getPropertyValue('--writing-frame-width')).toBe(frameWidth);
    if (!pane.hidden) await click('tools-toggle'); expect(pane.hidden).toBe(true); unchanged(before); expect(drafts()).toEqual(buffered);
    await click('tools-toggle'); expect(pane.hidden).toBe(false); expect(panel.hidden).toBe(false); expect(el('tools-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(document.body.dataset.toolsPresentation).toBe('sheet'); expect(available(el('score-host'))).toBe(false); expect(paper.hidden).toBe(false);
    expect([panel.scrollTop, pane.scrollTop]).toEqual([143, 31]); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(el('selection-controls').hidden).toBe(true); unchanged(before); expect(drafts()).toEqual(buffered);
    await click('tools-toggle'); expect(pane.hidden).toBe(true); expect(el('tools-toggle').getAttribute('aria-expanded')).toBe('false');
    unchanged(before); expect(drafts()).toEqual(buffered); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(available(el('score-host'))).toBe(true); expect(el('score-editor')).toBe(paper); expect(el('score-host')).toBe(host);
    expect(el('author-workbench').style.getPropertyValue('--writing-frame-width')).toBe(frameWidth); expect(engravingRequests()).toBe(renderCount);
  });
  it('Escape from the focused relocated pitch handle ends preparation without clearing selection or touching the parked writer', async () => {
    mount(); await parkedWriter(); await click('edit-selected-event'); await click('selection-prepare-drag'); requireDock('drag-pitch');
    expect(document.activeElement).toBe(el('drag-pitch')); expect(document.body.dataset.pitchDragArmed).toBe('true'); expect(available(el('drag-pitch'))).toBe(true);
    const before = accepted(); const escape = await key('Escape', 'drag-pitch');
    expect(escape.defaultPrevented).toBe(true); expect(document.body.dataset.pitchDragArmed).toBe('false'); expect(document.body.dataset.pointerGesture).toBeFalsy();
    expect(document.activeElement).toBe(el('score-editor')); expect(el('workspace-tools').hidden).toBe(true); unchanged(before);
  });
  it('dock accidental radio arrows only focus, and explicit Space changes the selected note exactly once with one Undo', async () => {
    mount(); await parkedWriter(); requireDock('selection-natural'); requireDock('selection-sharp'); const before = accepted();
    const arrow = await key('ArrowRight', 'selection-natural'); expect(arrow.defaultPrevented).toBe(true); expect(document.activeElement).toBe(el('selection-sharp')); unchanged(before);
    const space = await key(' ', 'selection-sharp'); expect(space.defaultPrevented).toBe(true);
    expect(event('a').pitches.map(pitchText)).toEqual(['F#4']); expect(event('b').pitches.map(pitchText)).toEqual(['G4']); expect(app!.session.revision).toBe(before.revision + 1);
    expect(app!.session.selection).toEqual(before.selection); expect(app!.session.cursor).toEqual(before.cursor); expect(recipe()).toEqual(before.recipe);
    await click('undo'); expect(app!.session.project.sourceHtml).toBe(before.source); expect(app!.session.canUndo).toBe(before.undo); expect(recipe()).toEqual(before.recipe);
  });
  it('the native Value duration field retains Enter, note letters and history keys; the actual Insert button still commits once', async () => {
    mount(); await startWriter(); requireDock('entry-value-trigger'); const empty = accepted(); await click('insert-event'); await click('undo');
    expect(app!.session.project.sourceHtml).toBe(empty.source); expect(app!.session.canRedo).toBe(true); const before = accepted();
    await click('entry-value-trigger'); expect(el('event-duration').closest('#entry-value-chooser')).toBe(el('entry-value-chooser')); unchanged(before);
    for (const [value, options] of [
      ['Enter', {}], ['a', {}], ['z', { ctrlKey: true }], ['z', { metaKey: true }], ['z', { ctrlKey: true, shiftKey: true }], ['z', { metaKey: true, shiftKey: true }],
    ] as const) {
      const nativeKey = await key(value, 'event-duration', options); expect(nativeKey.defaultPrevented, `Native field owns ${value} ${JSON.stringify(options)}`).toBe(false); unchanged(before);
    }
    await click('close-entry-value'); unchanged(before);
    await click('insert-event'); expect(app!.session.revision).toBe(before.revision + 1); expect(app!.session.canRedo).toBe(false);
    const written = event(app!.session.cursor!.eventId!); expect(written.pitches.map(pitchText)).toEqual(['Fqs5']);
    expect(written).toMatchObject({ duration: 'eighth', dots: 1, time: { numerator: 3, denominator: 16 }, onset: { numerator: 0, denominator: 1 } });
    expect(app!.session.cursor?.measureId).toBe('bar-14'); expect(recipe()).toEqual(before.recipe); const after = accepted();
    await click('select-mode'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('false'); unchanged(after);
  });
  it.each(['drag-entry', 'drag-pitch'] as const)('the actual relocated %s reaches pointer readiness checks without fabricated engraving geometry', async handle => {
    mount(); if (handle === 'drag-entry') { await startWriter(); await click('entry-settings-trigger'); await click('prepare-entry-drag'); }
    else { await parkedWriter(); await click('edit-selected-event'); await click('selection-prepare-drag'); }
    requireDock(handle); expect(available(el(handle))).toBe(true); const before = accepted();
    const press = async (options: PointerEventInit = {}) => {
      el(handle).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true,
        pointerId: 37, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 80, clientY: 120, ...options })); await flush();
    };
    for (const modifier of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) { await press(modifier); unchanged(before); expect(document.body.dataset.pointerGesture).toBeFalsy(); }
    await press(); expect(el('pointer-status').textContent).toBe('Wait for the score to finish engraving.'); unchanged(before); expect(document.body.dataset.pointerGesture).toBeFalsy();
    expect(el('pointer-status').closest('#workspace-review')).toBe(el('workspace-review')); await click('workspace-review-trigger');
    expect(available(el('pointer-status'))).toBe(true); unchanged(before);
  });
});
