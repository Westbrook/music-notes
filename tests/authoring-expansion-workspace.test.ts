// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { parsePitch, pitchText } from '../src/model/index.js';
import type { AuthorProject } from '../src/authoring/types.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const roadSource = `<music-staff id="roads" label="Road lead" notation="three-roads">
  <music-measure id="road-bar" number="12A">
    <music-road id="main" direction="same" duration="half">
      <music-articulation id="accent" type="accent"></music-articulation>
      <music-ornament id="trill" type="trill"></music-ornament>
      <music-interval id="fifth" value="5" placement="above"></music-interval>
      <music-interval id="third" value="b3" placement="below"></music-interval>
    </music-road>
    <music-road id="higher" direction="higher" duration="half"><music-articulation id="higher-fermata" type="fermata"></music-articulation></music-road>
  </music-measure>
  <music-measure id="road-next"><music-road id="last-road" direction="same" duration="whole"></music-road></music-measure>
</music-staff>`;
const pitchedSource = `<music-staff id="staff" label="Flugelhorn"><music-measure id="bar" number="27B">
  <music-note id="note" pitch="Fqs4" duration="half"><music-ornament id="note-trill" type="trill"></music-ornament></music-note>
  <music-chord id="chord" pitches="G4 Bb4 D5" duration="half"><music-articulation id="chord-accent" type="accent"></music-articulation></music-chord>
</music-measure></music-staff>`;
const silentSource = (notation = 'pitched') => `<music-staff id="staff" label="Entry study" notation="${notation}"><music-measure id="bar"><music-rest id="silent" measure></music-rest></music-measure></music-staff>`;
const fullSource = '<music-staff id="staff" label="Entry study"><music-measure id="bar"><music-note id="full" pitch="C4" duration="whole"></music-note></music-measure></music-staff>';
const conversionSource = `<music-staff id="staff" label="Flugelhorn"><music-measure id="bar" number="27B">
  <music-voice id="first-voice"><music-rest id="silent" measure></music-rest></music-voice>
  <music-voice id="second-voice"><music-note id="note" pitch="F4" duration="half"><music-ornament id="note-trill" type="trill"></music-ornament></music-note><music-note id="next" pitch="G4" duration="half"></music-note></music-voice>
</music-measure></music-staff>`;

let workspace: AuthorWorkspace | undefined;
let sequence = 0;
function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The real Author shell is missing #${id}.`);
  return element as T;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function mount(source = roadSource): AuthorWorkspace {
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `expansion-workspace-${++sequence}`, writerId: 'test',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  workspace = new AuthorWorkspace({ project: createProject(source, 'Expansion workspace'), recovery });
  return workspace;
}
async function click(id: string): Promise<void> { control<HTMLButtonElement>(id).click(); await flush(); }
function available(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}
async function disclose(element: HTMLElement): Promise<void> {
  const ancestors: HTMLDetailsElement[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) ancestors.unshift(parent);
  }
  for (const details of ancestors) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    expect(summary).not.toBeNull(); expect(available(summary!)).toBe(true);
    summary!.click(); await flush(); expect(details.open).toBe(true);
  }
}
async function visibleClick(id: string): Promise<void> {
  const element = control<HTMLButtonElement>(id); await disclose(element);
  expect(available(element), `#${id} is an available action in the current view`).toBe(true);
  element.click(); await flush();
}
async function field(id: string, value: string): Promise<void> {
  const element = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}
async function visibleField(id: string, value: string): Promise<void> {
  const element = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  await disclose(element);
  expect(available(element), `#${id} is an available field in the current view`).toBe(true);
  if (element instanceof HTMLSelectElement) expect([...element.options].some(option => option.value === value && !option.disabled)).toBe(true);
  await field(id, value);
}
async function check(id: string, checked: boolean): Promise<void> {
  const element = control<HTMLInputElement>(id); element.checked = checked;
  element.dispatchEvent(new Event('change', { bubbles: true })); await flush();
}
async function select(id: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(`#event-navigator [data-source-id="${id}"]`);
  if (!button) throw new Error(`The real event navigator has no ${id} button.`);
  await disclose(button); expect(available(button)).toBe(true);
  button.click(); await flush();
}
async function selectMark(id: string): Promise<void> {
  const detail = { sourceId: id, sourceElement: workspace!.session.source.querySelector(`[id="${id}"]`) };
  control('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true, detail }));
  await flush();
  expect(detail.sourceId).toBe(id);
}
async function key(key: string, id = 'score-editor', options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const target = control(id); target.focus({ preventScroll: true });
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...options });
  target.dispatchEvent(event); await flush(); return event;
}
const activeMark = () => control('score-editor').dataset.activeMarkingId || undefined;
const entry = (): Record<string, string | boolean> => ({ ...Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-duration', 'event-dots',
  'event-accidental-display', 'event-stem', 'event-beam', 'event-direction', 'insert-position']
  .map(id => [id, control<HTMLInputElement | HTMLSelectElement>(id).value])),
  'event-measure-rest': control<HTMLInputElement>('event-measure-rest').checked,
  'event-rhythmic': control<HTMLInputElement>('event-rhythmic').checked,
});
const eventById = (id: string) => workspace!.session.score.staves.flatMap(staff => staff.measures.flatMap(measure =>
  measure.voices.flatMap(voice => voice.events))).find(event => event.id === id)!;
function expectNoEdit(app: AuthorWorkspace, source: string, revision: number): void {
  expect(app.session.project.sourceHtml).toBe(source);
  expect(app.session.revision).toBe(revision);
}
async function startHere(): Promise<void> {
  await click(control('toggle-entry').hidden ? 'start-entry-here' : 'toggle-entry');
  expect(control('toggle-entry').getAttribute('aria-pressed')).toBe('true');
}
function expectProperties(): void {
  expect(control('workspace-tools').hidden).toBe(false);
  expect(control('workspace-tools').dataset.toolsView).toBe('properties');
  expect(control('selection-inspector').hidden).toBe(false);
  expect(control('selection-inspector').getAttribute('role')).toBe('region');
  expect(control('tools-tablist').hidden).toBe(true);
  expect(document.getElementById('tool-tab-edit')).toBeNull();
  expect(control('note-editor').dataset.noteEditorState).not.toBe('open');
}
async function openProperties(): Promise<void> {
  await visibleClick('edit-selected-event'); expectProperties();
}
function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#event-markings-rows [data-marking-id="${id}"]`);
  if (!element) throw new Error(`The attached-marks editor has no row for ${id}.`);
  return element;
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell;
  // Real application listeners, session, guards, and controllers. Rendering is
  // the only stub; this suite makes no geometry, top-layer, or visual claims.
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
});
afterEach(async () => {
  workspace?.dispose(); workspace = undefined;
  await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('precise attached-mark selection in the real workspace', () => {
  it.each(['accent', 'trill', 'fifth', 'third'])('retains exact child %s separately from its musical owner without opening Tools or adding history', async markingId => {
    const app = mount(); await select('main');
    const cursor = app.session.cursor; const source = app.session.project.sourceHtml;
    await selectMark(markingId);
    expect(activeMark()).toBe(markingId);
    expect(app.session.selectionId).toBe('main');
    expect(app.session.cursor).toEqual(cursor);
    expect(control('workspace-tools').hidden).toBe(true);
    expect(control('selection-inspector').dataset.draftTarget).toBe('main');
    expectNoEdit(app, source, 0); expect(app.session.canUndo).toBe(false);
  });

  it('changes only the child target when another mark on the same event is selected', async () => {
    const app = mount(); await selectMark('fifth');
    const cursor = app.session.cursor; const source = app.session.project.sourceHtml;
    await selectMark('third');
    expect(activeMark()).toBe('third');
    expect(app.session.cursor).toEqual(cursor); expect(app.session.selectionId).toBe('main');
    expectNoEdit(app, source, 0);
  });

  it('resolves a clicked child to its owner without moving a different writing bookmark', async () => {
    const app = mount(); await select('higher'); await startHere(); await visibleClick('select-mode');
    const writer = app.session.cursor, recipe = entry(), source = app.session.project.sourceHtml;
    expect(writer).toMatchObject({ staffId: 'roads', measureId: 'road-bar', voiceIndex: 0, eventId: 'higher' });
    await selectMark('trill');
    expect(activeMark()).toBe('trill');
    expect(app.session.selectionId).toBe('main');
    expect(app.session.selection).toMatchObject({ ids: ['main'], primaryId: 'main', staffId: 'roads', voiceIndex: 0 });
    expect(control('selection-inspector').dataset.draftTarget).toBe('main');
    expect(app.session.cursor).toEqual(writer); expect(entry()).toEqual(recipe);
    expect(control('workspace-tools').hidden).toBe(true); expectNoEdit(app, source, 0); expect(app.session.canUndo).toBe(false);
  });

  it.each(['navigator', 'owner-ink', 'keyboard', 'range-start', 'range-end', 'entry', 'start-here', 'part'] as const)(
    'clears the exact child target after an ordinary %s action', async action => {
      const app = mount(); await selectMark('fifth'); expect(activeMark()).toBe('fifth');
      const source = app.session.project.sourceHtml;
      if (action === 'navigator') await select('higher');
      if (action === 'owner-ink') await selectMark('main');
      if (action === 'keyboard') await key('ArrowRight');
      if (action === 'range-start') await field('range-start', 'main');
      if (action === 'range-end') await field('range-end', 'higher');
      if (action === 'entry') await startHere();
      if (action === 'start-here') { await click('location-trigger'); await click('start-entry-here'); }
      if (action === 'part') await field('part-select', app.session.project.parts[0].id);
      expect(activeMark()).toBeUndefined(); expectNoEdit(app, source, 0);
    });

  it('does not resurrect a removed child target through Undo or ordinary owner selection', async () => {
    const app = mount(); await selectMark('fifth');
    app.session.execute({ type: 'remove-event-marking', eventId: 'main', markingId: 'fifth' }); await flush();
    expect(activeMark()).toBeUndefined(); expect(app.session.source.querySelector('#fifth')).toBeNull();
    await click('undo');
    expect(app.session.source.querySelector('#fifth')).not.toBeNull(); expect(activeMark()).toBeUndefined();
    await select('main'); expect(activeMark()).toBeUndefined(); expect(app.session.revision).toBe(2);
  });

  it('retains the exact surviving child through its own edit and an unrelated sibling removal', async () => {
    const app = mount(); await selectMark('fifth');
    app.session.execute({ type: 'update-event-marking', eventId: 'main', markingId: 'fifth',
      value: { kind: 'interval', value: '#5', placement: 'above' }, fields: ['value'] }); await flush();
    expect(activeMark()).toBe('fifth');
    app.session.execute({ type: 'remove-event-marking', eventId: 'main', markingId: 'accent' }); await flush();
    expect(activeMark()).toBe('fifth'); expect(app.session.selectionId).toBe('main');
    expect(app.session.source.querySelector('#fifth')?.getAttribute('value')).toBe('#5');
  });

  it.each(['family', 'owner', 'presence'] as const)('clears a child target when its %s changes in accepted Source', async change => {
    const app = mount(); await selectMark('fifth');
    const child = '<music-interval id="fifth" value="5" placement="above"></music-interval>';
    const before = app.session.project.sourceHtml;
    const updated = change === 'family'
      ? before.replace(child, '<music-articulation id="fifth" type="tenuto" placement="above"></music-articulation>')
      : change === 'owner' ? before.replace(child, '').replace('<music-road id="higher" direction="higher" duration="half">',
        `<music-road id="higher" direction="higher" duration="half">${child}`) : before.replace(child, '');
    expect(updated).not.toBe(before);
    app.session.applySource(updated); await flush();
    if (change === 'presence') expect(app.session.source.querySelector('#fifth')).toBeNull();
    else expect(app.session.source.querySelector('#fifth')).not.toBeNull();
    expect(activeMark()).toBeUndefined(); expect(app.session.selectionId).toBe('main');
    expect(app.session.revision).toBe(1);
  });

  it('retains the exact child through an accepted same-family Source update and its history', async () => {
    const app = mount(); await selectMark('fifth'); const before = app.session.project.sourceHtml;
    app.session.applySource(before.replace('id="fifth" value="5"', 'id="fifth" value="#5"')); await flush();
    expect(app.session.source.querySelector('#fifth')?.getAttribute('value')).toBe('#5');
    expect(activeMark()).toBe('fifth'); expect(app.session.selectionId).toBe('main');
    await click('undo'); expect(activeMark()).toBe('fifth'); expect(app.session.project.sourceHtml).toBe(before);
    await click('redo'); expect(activeMark()).toBe('fifth'); expect(app.session.selectionId).toBe('main');
    expect(app.session.source.querySelector('#fifth')?.getAttribute('value')).toBe('#5');
  });

  it.each([false, true])('invalidates child selection on project replacement even with reused source IDs (same project ID: %s)', async sameId => {
    const app = mount(); await selectMark('fifth');
    const replacement = createProject(roadSource, 'Another composition');
    if (sameId) replacement.id = app.session.project.id;
    app.session.replaceProject(replacement); await flush();
    expect(activeMark()).toBeUndefined(); expect(app.session.canUndo).toBe(false);
  });
});

describe('explicit selection and Properties routes', () => {
  it.each(['trill', 'third'])('opens the exact %s row only after the explicit Edit action', async id => {
    const app = mount(); await selectMark(id); const source = app.session.project.sourceHtml;
    expect(control('workspace-tools').hidden).toBe(true);
    await visibleClick('selection-mark-edit');
    expectProperties();
    expect(row(id).contains(document.activeElement)).toBe(true);
    expect(row(id).getAttribute('aria-current')).toBe('true');
    expect(control('event-markings-editor').dataset.activeMarkingId).toBe(id);
    expectNoEdit(app, source, 0);
  });

  it('opens Properties with Attached marks prominent for an ordinary owner without changing the entry recipe', async () => {
    const app = mount(pitchedSource); await select('note');
    const source = app.session.project.sourceHtml; const recipe = entry();
    await openProperties();
    expect(control('event-markings-editor').dataset.draftTarget).toBe('note');
    expect(control('event-markings-editor').dataset.draftState).toBe('clean');
    expect(available(control('event-markings-editor'))).toBe(true);
    expect(available(row('note-trill').querySelector<HTMLElement>('[data-marking-field="type"]')!)).toBe(true);
    expect(available(control('add-event-articulation'))).toBe(true);
    expect(control<HTMLDetailsElement>('event-details').open).toBe(false);
    expect(control('event-markings-editor').compareDocumentPosition(control('event-details')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control('selection-inspector').contains(document.activeElement)).toBe(true);
    expect(entry()).toEqual(recipe); expectNoEdit(app, source, 0);
  });

  it('applies the explicitly targeted row with one Undo/Redo without changing its siblings or entry recipe', async () => {
    const app = mount(); await selectMark('fifth'); await visibleClick('selection-mark-edit');
    const before = app.session.project.sourceHtml; const recipe = entry();
    const unchangedIds = ['accent', 'trill', 'third', 'higher'];
    const siblings = unchangedIds.map(id => app.session.source.querySelector(`[id="${id}"]`)!.outerHTML);
    const value = row('fifth').querySelector<HTMLInputElement>('[data-marking-field="value"]')!;
    value.value = '#5'; value.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expectNoEdit(app, before, 0);
    await visibleClick('apply-event-markings');
    expect(app.session.source.querySelector('#fifth')?.getAttribute('value')).toBe('#5');
    expect(unchangedIds.map(id => app.session.source.querySelector(`[id="${id}"]`)!.outerHTML)).toEqual(siblings);
    expect(activeMark()).toBe('fifth'); expect(app.session.selectionId).toBe('main');
    expect(entry()).toEqual(recipe); expect(app.session.revision).toBe(1);
    await click('undo');
    expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
    expect(activeMark()).toBe('fifth'); expect(entry()).toEqual(recipe);
    await click('redo');
    expect(app.session.source.querySelector('#fifth')?.getAttribute('value')).toBe('#5');
    expect(unchangedIds.map(id => app.session.source.querySelector(`[id="${id}"]`)!.outerHTML)).toEqual(siblings);
    expect(activeMark()).toBe('fifth'); expect(entry()).toEqual(recipe);
  });

  it('opens a selected chord directly at its advanced pitch list', async () => {
    const app = mount(pitchedSource); await select('chord'); const source = app.session.project.sourceHtml;
    expect(control('selection-pitch').textContent).toBe('Pitches');
    await visibleClick('selection-pitch'); expectProperties();
    expect(control('selection-inspector').dataset.draftTarget).toBe('chord');
    expect(control<HTMLDetailsElement>('event-details').open).toBe(true);
    expect(document.activeElement).toBe(control('selected-pitches'));
    expect(control<HTMLInputElement>('selected-pitches').value).toBe('G4 Bb4 D5');
    expectNoEdit(app, source, 0);
  });

  it('edits chord pitches through the direct Pitches route without losing its attached mark or changing the entry recipe', async () => {
    const app = mount(pitchedSource); await select('chord'); const before = app.session.project.sourceHtml;
    const recipe = entry(); const note = app.session.source.querySelector('#note')!.outerHTML;
    const marking = app.session.source.querySelector('#chord-accent')!.outerHTML;
    await visibleClick('selection-pitch'); expectProperties();
    expect(control<HTMLDetailsElement>('event-details').open).toBe(true);
    expect(document.activeElement).toBe(control('selected-pitches'));
    await visibleField('selected-pitches', 'Aqf4 Cqs5 E5');
    expectNoEdit(app, before, 0); await visibleClick('update-event');
    expect(eventById('chord').pitches.map(pitch => pitchText(pitch))).toEqual(['Aqf4', 'Cqs5', 'E5']);
    expect(app.session.source.querySelector('#note')!.outerHTML).toBe(note);
    expect(app.session.source.querySelector('#chord-accent')!.outerHTML).toBe(marking);
    expect(app.session.selectionId).toBe('chord'); expect(entry()).toEqual(recipe); expect(app.session.revision).toBe(1);
    await click('undo'); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
    expect(entry()).toEqual(recipe); expect(app.session.selectionId).toBe('chord');
  });

  it('keeps an older scalar draft bound and focuses its status instead of loading a newly selected chord over it', async () => {
    const app = mount(pitchedSource); await select('note'); await openProperties();
    await visibleField('selected-pitch', 'Aqf4'); await visibleClick('tools-hide'); await select('chord');
    const source = app.session.project.sourceHtml;
    await visibleClick('selection-pitch'); expectProperties();
    expect(control('selection-inspector').dataset.draftTarget).toBe('note');
    expect(control<HTMLInputElement>('selected-pitch').value).toBe('Aqf4');
    expect(document.activeElement).toBe(control('selected-draft-status'));
    expect(app.session.selectionId).toBe('chord'); expectNoEdit(app, source, 0);
  });

  it('keeps an older attached-mark draft when explicit Edit targets a mark on a different owner', async () => {
    const app = mount(); await selectMark('fifth'); await visibleClick('selection-mark-edit');
    const value = row('fifth').querySelector<HTMLInputElement>('[data-marking-field="value"]')!;
    value.value = '#5'; value.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    await visibleClick('tools-hide'); await selectMark('higher-fermata');
    const source = app.session.project.sourceHtml;
    await visibleClick('selection-mark-edit'); expectProperties();
    expect(control('event-markings-editor').dataset.draftTarget).toBe('main');
    expect(row('fifth').querySelector<HTMLInputElement>('[data-marking-field="value"]')?.value).toBe('#5');
    expect(document.activeElement).toBe(control('event-markings-draft-status'));
    expect(app.session.selectionId).toBe('higher'); expectNoEdit(app, source, 0);
  });
});

describe('Enter inserts the exact native next-entry recipe', () => {
  it.each([
    { notation: 'pitched', kind: 'note', pitch: 'Fqs5', direction: undefined },
    { notation: 'pitched', kind: 'chord', pitches: 'Cqf4 Eqs4 G4', direction: undefined },
    { notation: 'rhythm', kind: 'rhythm', pitch: undefined, direction: undefined },
    { notation: 'three-roads', kind: 'road', pitch: undefined, direction: 'lower' },
  ])('inserts $kind through Enter without inventing pitch or discarding the recipe', async scenario => {
    const app = mount(silentSource(scenario.notation)); await startHere();
    await field('event-kind', scenario.kind); if (scenario.pitch) await field('event-pitch', scenario.pitch);
    if (scenario.pitches) await field('event-pitches', scenario.pitches);
    if (scenario.direction) await field('event-direction', scenario.direction);
    await field('event-duration', 'eighth'); await field('event-dots', '1');
    await field('event-stem', 'down'); await field('event-beam', 'none'); await field('event-accidental-display', 'courtesy');
    const before = app.session.project.sourceHtml; const recipe = entry();
    const pressed = await key('Enter');
    expect(pressed.defaultPrevented).toBe(true);
    const event = app.session.score.staves[0].measures[0].voices[0].events[0];
    expect(event).toMatchObject({ kind: scenario.kind, duration: 'eighth', dots: 1, stem: 'down', beam: 'none', time: { numerator: 3, denominator: 16 } });
    if (scenario.pitch) expect(pitchText(event.pitches[0])).toBe(scenario.pitch);
    else if (scenario.pitches) expect(event.pitches.map(pitch => pitchText(pitch)).join(' ')).toBe(scenario.pitches);
    else expect(event.pitches).toEqual([]);
    for (const pitch of event.pitches) expect(pitch.display).toBe('courtesy');
    if (scenario.direction) expect(event.pitchDirection).toBe(scenario.direction);
    expect(entry()).toEqual(recipe); expect(app.session.revision).toBe(1);
    await click('undo'); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
  });

  it('retains the documented A–G natural-pitch policy separately from exact-recipe Enter', async () => {
    const app = mount(silentSource()); await startHere();
    await field('event-pitch', 'Fqs5'); await field('event-duration', 'quarter');
    await key('g');
    expect(pitchText(app.session.score.staves[0].measures[0].voices[0].events[0].pitches[0])).toBe('G5');
    expect(control<HTMLInputElement>('event-pitch').value).toBe('G5');
    expect(control<HTMLSelectElement>('event-alteration').value).toBe('0');
  });

  it.each(['event-pitch', 'event-duration', 'insert-event'])('leaves Enter on native #%s to that control', async id => {
    const app = mount(silentSource()); await startHere(); const source = app.session.project.sourceHtml;
    const pressed = await key('Enter', id);
    expect(pressed.defaultPrevented).toBe(false); expectNoEdit(app, source, 0);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('does not reinterpret %s + Enter as note entry', async modifier => {
    const app = mount(silentSource()); await startHere(); const source = app.session.project.sourceHtml;
    const pressed = await key('Enter', 'score-editor', { [modifier]: true });
    expect(pressed.defaultPrevented).toBe(false); expectNoEdit(app, source, 0);
  });

  it('opens direct Properties with Enter in Select mode without inserting or moving the writing cursor', async () => {
    const app = mount(pitchedSource); await select('note'); const source = app.session.project.sourceHtml;
    const recipe = entry(), writer = app.session.cursor;
    const pressed = await key('Enter');
    expect(pressed.defaultPrevented).toBe(true);
    expectProperties(); expect(control('selection-inspector').dataset.draftTarget).toBe('note');
    expect(control('selection-inspector').contains(document.activeElement)).toBe(true);
    expect(entry()).toEqual(recipe); expect(app.session.cursor).toEqual(writer); expectNoEdit(app, source, 0);
  });

  it('requires the keyboard continuation option and appends exactly once when it is enabled', async () => {
    const app = mount(fullSource); await select('full'); await startHere();
    await field('event-pitch', 'Gqf5'); await field('event-duration', 'eighth'); await field('event-dots', '1');
    const before = app.session.project.sourceHtml; const cursor = app.session.cursor;
    await check('continuation-enabled', false); await key('Enter');
    expectNoEdit(app, before, 0); expect(app.session.score.staves[0].measures).toHaveLength(1);
    await check('continuation-enabled', true); await key('Enter');
    expect(app.session.score.staves[0].measures).toHaveLength(2); expect(app.session.revision).toBe(1);
    const note = app.session.score.staves[0].measures[1].voices[0].events[0];
    expect(pitchText(note.pitches[0])).toBe('Gqf5'); expect(note).toMatchObject({ duration: 'eighth', dots: 1 });
    await click('undo'); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.cursor).toEqual(cursor);
    expect(app.session.canUndo).toBe(false);
  });

  it.each(['final', 'partial', 'before'] as const)('does not extend or silently reinterpret a %s boundary through keyboard Enter', async boundary => {
    const source = boundary === 'final' ? fullSource.replace('id="bar"', 'id="bar" end-bar="final"')
      : boundary === 'partial' ? fullSource.replace('id="bar"', 'id="bar" incomplete').replace('duration="whole"', 'duration="half"') : fullSource;
    const app = mount(source); await select('full'); await startHere();
    await field('event-duration', 'whole'); if (boundary === 'before') await field('insert-position', 'before');
    await check('continuation-enabled', true); const before = app.session.project.sourceHtml;
    await key('Enter'); expectNoEdit(app, before, 0);
    expect(app.session.score.staves[0].measures).toHaveLength(1);
    expect(control('continuation-review').dataset.surfaceState).not.toBe('open');
  });
});

describe('native next-entry alteration integration', () => {
  it('sets all nine alterations on the current letter/octave without touching music, selection, or other recipe fields', async () => {
    const app = mount(pitchedSource); await select('note'); await startHere();
    await field('event-pitch', 'Dqs5'); await field('event-duration', 'eighth'); await field('event-dots', '1');
    await field('event-accidental-display', 'courtesy'); await field('event-stem', 'down'); await field('event-beam', 'none');
    const original = entry(); const source = app.session.project.sourceHtml; const cursor = app.session.cursor;
    for (const alter of [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) {
      await field('event-alteration', String(alter));
      expect(parsePitch(control<HTMLInputElement>('event-pitch').value)).toMatchObject({ step: 'D', octave: 5, alter });
      expect({ ...entry(), 'event-pitch': original['event-pitch'] }).toEqual(original);
      expect(app.session.cursor).toEqual(cursor); expectNoEdit(app, source, 0);
    }
  });

  it('synchronizes the alteration choice when the typed spelling changes', async () => {
    mount(silentSource()); await startHere();
    await field('event-pitch', 'Btqf3'); expect(control<HTMLSelectElement>('event-alteration').value).toBe('-1.5');
    await field('event-pitch', 'G4'); expect(control<HTMLSelectElement>('event-alteration').value).toBe('0');
  });

  it('inserts the pitch chosen with the alteration picker through Enter and preserves that recipe through Undo/Redo', async () => {
    const app = mount(silentSource()); await startHere();
    await field('event-pitch', 'F5'); await field('event-alteration', '-1.5');
    await field('event-duration', 'eighth'); await field('event-dots', '1'); await field('event-accidental-display', 'always');
    const before = app.session.project.sourceHtml; const recipe = entry();
    expect(control<HTMLInputElement>('event-pitch').value).toBe('Ftqf5'); expectNoEdit(app, before, 0);
    await key('Enter');
    const event = app.session.score.staves[0].measures[0].voices[0].events[0];
    expect(event.pitches[0]).toMatchObject({ step: 'F', octave: 5, alter: -1.5, display: 'always' });
    expect(event).toMatchObject({ duration: 'eighth', dots: 1 }); expect(entry()).toEqual(recipe);
    const accepted = app.session.project.sourceHtml;
    await click('undo'); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
    expect(entry()).toEqual(recipe); expect(control<HTMLSelectElement>('event-alteration').value).toBe('-1.5');
    await click('redo'); expect(app.session.project.sourceHtml).toBe(accepted); expect(entry()).toEqual(recipe);
    expect(control<HTMLSelectElement>('event-alteration').value).toBe('-1.5');
  });

  it('preserves an unfinished pitch and explains an alteration attempt locally instead of guessing', async () => {
    const app = mount(silentSource()); await startHere(); await field('event-pitch', 'unfinished F?');
    const before = app.session.project.sourceHtml;
    await field('event-alteration', '1');
    expect(control<HTMLInputElement>('event-pitch').value).toBe('unfinished F?');
    expect(control('event-alteration-status').textContent?.trim().length).toBeGreaterThan(0);
    expectNoEdit(app, before, 0);
  });

  it('keeps next-entry alteration independent from immediate selected-note changes', async () => {
    const app = mount(pitchedSource); await select('note'); await startHere();
    await field('event-pitch', 'Gqf5'); await field('event-duration', 'eighth'); await click('select-mode');
    const recipe = entry(), writer = app.session.cursor;
    expect(control('workspace-tools').hidden).toBe(true);
    await visibleClick('selection-sharp');
    expect(eventById('note').pitches[0].alter).toBe(1);
    expect(entry()).toEqual(recipe); expect(control<HTMLSelectElement>('event-alteration').value).toBe('-0.5');
    expect(control('workspace-tools').hidden).toBe(true); expect(app.session.cursor).toEqual(writer);
    expect(app.session.revision).toBe(1);
  });

  it.each([
    { notation: 'pitched', kind: 'chord' }, { notation: 'pitched', kind: 'rest' },
    { notation: 'rhythm', kind: 'rhythm' }, { notation: 'three-roads', kind: 'road' },
  ])('hides and disables single-note alteration for $kind without changing the stored pitch recipe', async scenario => {
    const app = mount(silentSource(scenario.notation)); await startHere();
    await field('event-pitch', 'Bqs5'); await field('event-kind', scenario.kind);
    const source = app.session.project.sourceHtml; const recipe = entry();
    expect(control('event-alteration-field').hidden).toBe(true);
    expect(control<HTMLSelectElement>('event-alteration').disabled).toBe(true);
    // A stale native choice must also be harmless after its context disappears.
    await field('event-alteration', '-1');
    expect(entry()).toEqual(recipe); expectNoEdit(app, source, 0);
  });
});

describe('structured incompatible-mark recovery in Author', () => {
  async function rejectConversion(): Promise<AuthorWorkspace> {
    const app = mount(conversionSource); await select('note'); await openProperties();
    await visibleField('selected-kind', 'rhythmic-slash'); await visibleClick('update-event');
    expect(app.session.revision).toBe(0);
    expect(control('author-errors').textContent).toMatch(/trill|ornament/i);
    return app;
  }

  it('names the actual staff, custom bar label, and voice and routes to the exact offending mark', async () => {
    const app = await rejectConversion(); const source = app.session.project.sourceHtml;
    const explanation = control('author-errors').textContent ?? '';
    expect(explanation).toContain('Flugelhorn'); expect(explanation).toContain('27B'); expect(explanation).toMatch(/voice 2/i);
    expect(control<HTMLButtonElement>('review-incompatible-mark').hidden).toBe(false);
    await click('review-incompatible-mark');
    expect(app.session.selectionId).toBe('note'); expect(activeMark()).toBe('note-trill');
    expect(row('note-trill').contains(document.activeElement)).toBe(true);
    expect(row('note-trill').getAttribute('aria-current')).toBe('true'); expectNoEdit(app, source, 0);
  });

  it.each(['revision', 'part', 'removed', 'replacement', 'read', 'pages', 'source'] as const)('does not navigate through a stale %s recovery offer', async change => {
    const app = await rejectConversion(); const action = control<HTMLButtonElement>('review-incompatible-mark');
    if (change === 'revision') app.session.update('New metadata revision', project => { project.metadata.subtitle = 'Changed'; });
    if (change === 'part') await field('part-select', app.session.project.parts[0].id);
    if (change === 'removed') app.session.execute({ type: 'remove-event-marking', eventId: 'note', markingId: 'note-trill' });
    if (change === 'replacement') {
      const replacement: AuthorProject = createProject(conversionSource, 'Replacement with reused identifiers');
      replacement.id = app.session.project.id; app.session.replaceProject(replacement);
    }
    if (change === 'read' || change === 'pages') await click(`view-${change}`);
    if (change === 'source') {
      await click('source-trigger'); await field('source-input', `${app.session.project.sourceHtml}\n<!-- Unapplied draft -->`);
      expect(app.session.project.pendingSource).not.toBeNull(); await click('close-source');
    }
    await flush(); const source = app.session.project.sourceHtml; const revision = app.session.revision; const selection = app.session.selectionId;
    if (!control('workspace-tools').hidden) await visibleClick('tools-hide');
    control('view-write').focus({ preventScroll: true });
    expect(control('workspace-tools').hidden).toBe(true);
    // Exercise the connected stale control even when normal UI hides/disables it.
    action.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush();
    expect(activeMark()).toBeUndefined(); expect(app.session.selectionId).toBe(selection);
    expect(control('workspace-tools').hidden).toBe(true); expect(document.activeElement).toBe(control('view-write'));
    expectNoEdit(app, source, revision);
  });
});
