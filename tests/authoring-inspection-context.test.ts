// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { EventMarkingsEditor } from '../src/authoring/event-markings-editor.js';
import type { EventMarkingsContext } from '../src/authoring/event-markings-editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext } from '../src/authoring/inspector-forms.js';
import { createProject } from '../src/authoring/project.js';
import type { EventInput } from '../src/authoring/types.js';

const source = `<music-staff id="staff" label="Flute"><music-measure id="bar1" number="1" incomplete>
  <music-note id="a" pitch="C4" duration="quarter"><music-articulation id="a-mark" type="accent" placement="below" data-keep="old-side"><!-- preserve --></music-articulation></music-note>
  <music-note id="b" pitch="D4" duration="quarter"><music-ornament id="b-mark" type="trill" placement="below" data-keep="old-side"></music-ornament></music-note>
  </music-measure><music-measure id="bar2" number="2" incomplete><music-note id="c" pitch="E4" duration="quarter"></music-note></music-measure></music-staff>`;
type Inspection<T> = T & { inspectionSelectionId?: string | null; entryMode?: boolean };
const cleanups: (() => void)[] = [];
function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function notice(id: string): HTMLElement { return el(id).closest<HTMLElement>('.draft-notice')!; }
function change(id: string, value: string): void {
  const input = el<HTMLInputElement | HTMLSelectElement>(id); input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function markingField(id: string): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>(`[data-marking-id="${id}"] [data-marking-field="type"]`)!;
}
function changeMark(id: string, value: string): void {
  const input = markingField(id); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
}
function accepted(session: EditorSession) { return { project: session.project, revision: session.revision, cursor: session.cursor, selection: session.selectionId, undo: session.canUndo, redo: session.canRedo }; }

function fixture() {
  mountAuthorFixture();
  el('workspace-tools').hidden = false; el('selection-inspector').hidden = false;
  const session = new EditorSession(createProject(source, 'Inspection study')); session.select('a');
  const propertiesContext: Inspection<InspectorContext> = {
    mode: 'write', partId: 'score', cursor: { staffId: 'staff', measureId: 'bar1', voiceIndex: 0, eventId: 'a' },
    selectionId: 'a', rangeEventIds: ['a'], inspectionSelectionId: 'a', entryMode: false,
  };
  const marksContext: Inspection<EventMarkingsContext> = { mode: 'write', selectionId: 'a', rangeEventIds: ['a'], inspectionSelectionId: 'a', entryMode: false };
  let forms: InspectorForms; let marks: EventMarkingsEditor;
  const refresh = () => { forms?.refresh(); marks?.refresh(); };
  const actual = (id: string | undefined, members: readonly string[] = id ? [id] : []) => {
    propertiesContext.selectionId = marksContext.selectionId = id;
    propertiesContext.rangeEventIds = marksContext.rangeEventIds = members;
    for (const staff of session.score.staves) for (const measure of staff.measures) for (const [voiceIndex, voice] of measure.voices.entries()) {
      if (voice.events.some(event => event.id === id)) propertiesContext.cursor = { staffId: staff.id, measureId: measure.id, voiceIndex, eventId: id };
    }
    session.select(id); refresh();
  };
  const select = vi.fn((id: string) => {
    propertiesContext.entryMode = marksContext.entryMode = false;
    propertiesContext.inspectionSelectionId = marksContext.inspectionSelectionId = id;
    actual(id);
  });
  const report = vi.fn();
  forms = new InspectorForms({ session, context: () => propertiesContext, select,
    returnTarget: target => { if (target.context.sourceId) select(target.context.sourceId); }, report });
  marks = new EventMarkingsEditor({ session, context: () => marksContext, select,
    openTools: () => { el('workspace-tools').hidden = false; el('selection-inspector').hidden = false; }, report });
  session.addEventListener('change', refresh);
  cleanups.push(() => { session.removeEventListener('change', refresh); forms.dispose(); marks.dispose(); });
  const enter = (id: string) => { propertiesContext.entryMode = marksContext.entryMode = true; actual(id); };
  const unseen = (id: string | undefined, members: readonly string[] = id ? [id] : []) => {
    session.removeEventListener('change', refresh);
    propertiesContext.selectionId = marksContext.selectionId = id;
    propertiesContext.rangeEventIds = marksContext.rangeEventIds = members;
    session.select(id);
  };
  return { session, forms, marks, propertiesContext, marksContext, actual, select, report, enter, refresh, unseen };
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); document.body.removeAttribute('tabindex'); });

describe('held inspection targets and quiet property captions', () => {
  it('hides complete pristine notices and uses one shared target caption for the same owner', () => {
    const h = fixture(); const before = accepted(h.session);
    for (const id of ['selected', 'measure', 'staff', 'part', 'page', 'boundary', 'tuplet']) {
      expect(notice(`${id}-draft-status`).hidden, id).toBe(true);
      expect(el(`${id}-draft-status`).textContent, id).toBe('');
    }
    expect(notice('event-markings-draft-status').hidden).toBe(true);
    expect(el('event-form-context').textContent).toContain('C4 · Flute, bar 1, voice 1');
    expect(el('event-markings-target').hidden).toBe(true);
    expect(el('selected-pitch').getAttribute('aria-describedby')).toContain('event-form-context');
    expect(markingField('a-mark').getAttribute('aria-describedby')).toContain('event-form-context');
    expect(markingField('a-mark').getAttribute('aria-describedby')).not.toContain('event-markings-target');
    h.refresh(); expect(accepted(h.session)).toEqual(before);
  });

  it('shows a concise dirty message without repeating the target caption', () => {
    const h = fixture(); change('selected-pitch', 'C#4');
    expect(notice('selected-draft-status').hidden).toBe(false);
    expect(el('selected-draft-status').textContent).toBe('Unapplied changes.');
    expect(el('event-form-context').textContent).toContain('C4');
    expect(el('event-markings-target').hidden).toBe(true);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', dirty: true, matchesSelection: true, canApply: true });
  });

  it('holds clean properties and attached marks while an accepted insertion changes the writing selection', () => {
    const h = fixture(); const markField = markingField('a-mark'); h.enter('c');
    const recipe: EventInput = { kind: 'note', pitch: 'F4', pitches: '', duration: 'quarter', dots: 0, rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };
    const result = h.session.execute({ type: 'insert-event', cursor: h.propertiesContext.cursor, value: recipe, position: 'after' });
    h.actual(result.selectionId);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', dirty: false, matchesSelection: false, canApply: false });
    expect(h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: false, matchesSelection: false, canApply: false });
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('C4'); expect(markingField('a-mark')).toBe(markField);
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(true); expect(markField.disabled).toBe(true);
    expect(el<HTMLButtonElement>('return-selected-draft').hidden).toBe(false); expect(el<HTMLButtonElement>('return-event-markings').hidden).toBe(false);
    expect(h.session.revision).toBe(1); expect(h.session.selectionId).toBe(result.selectionId); expect(h.select).not.toHaveBeenCalled();
  });

  it('requires Return even when Enter still has the inspected note as its last selected event', () => {
    const h = fixture(); h.enter('a'); const before = accepted(h.session);
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(true); expect(markingField('a-mark').disabled).toBe(true);
    expect(el<HTMLButtonElement>('return-selected-draft').hidden).toBe(false);
    expect(() => h.forms.resolve('selected')).toThrow(/Return/);
    el('apply-event-markings').dispatchEvent(new Event('click'));
    expect(accepted(h.session)).toEqual(before);
  });

  it('does not accept a synthetic edit from a held property control while entering elsewhere', () => {
    const h = fixture(); h.enter('c'); const before = accepted(h.session);
    change('selected-pitch', 'G#4'); changeMark('a-mark', 'staccato');
    expect(h.forms.snapshot('selected').dirty).toBe(false); expect(h.marks.snapshot().dirty).toBe(false);
    expect(accepted(h.session)).toEqual(before);
  });

  it('rejects old connected inputs if Enter begins before either pane refreshes', () => {
    const h = fixture(); const field = markingField('a-mark');
    h.propertiesContext.entryMode = h.marksContext.entryMode = true;
    h.propertiesContext.selectionId = h.marksContext.selectionId = 'c';
    h.propertiesContext.rangeEventIds = h.marksContext.rangeEventIds = ['c'];
    const before = accepted(h.session);
    change('selected-pitch', 'G#4'); field.value = 'staccato'; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', dirty: false, canApply: false });
    expect(h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: false, canApply: false });
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('C4'); expect(field.value).toBe('accent');
    expect(accepted(h.session)).toEqual(before);
  });

  it('retains old displayed input as an A draft after unseen group selection, without authorizing Apply', () => {
    const h = fixture(); const field = markingField('a-mark');
    h.propertiesContext.rangeEventIds = h.marksContext.rangeEventIds = ['a', 'b'];
    const before = accepted(h.session);
    change('selected-pitch', 'C#4'); field.value = 'staccato'; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', dirty: true, matchesSelection: false, canApply: false });
    expect(h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: true, matchesSelection: false, canApply: false });
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('C#4'); expect(field.value).toBe('staccato');
    expect(() => h.forms.resolve('selected')).toThrow(/Return/); el('apply-event-markings').dispatchEvent(new Event('click'));
    expect(accepted(h.session)).toEqual(before);
  });

  it('treats an explicitly empty inspection as unbound, while undefined keeps legacy selection following', () => {
    const h = fixture();
    h.propertiesContext.inspectionSelectionId = h.marksContext.inspectionSelectionId = null; h.actual('b');
    expect(h.forms.snapshot('selected').targetId).toBeNull(); expect(h.marks.snapshot().targetId).toBeNull();
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(true); expect(el('event-form-context').textContent).not.toContain('D4');
    h.propertiesContext.inspectionSelectionId = h.marksContext.inspectionSelectionId = undefined; h.refresh();
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'b', matchesSelection: true });
    expect(h.marks.snapshot()).toMatchObject({ targetId: 'b', matchesSelection: true });
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('D4');
  });

  it('Returns to a clean held owner explicitly, parks entry, and enables its fields without changing music', () => {
    const h = fixture(); h.enter('c'); const before = h.session.project; const revision = h.session.revision;
    el('return-selected-draft').click();
    expect(h.select).toHaveBeenCalledWith('a'); expect(h.propertiesContext.entryMode).toBe(false); expect(h.session.selectionId).toBe('a');
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(false); expect(markingField('a-mark').disabled).toBe(false);
    expect(notice('selected-draft-status').hidden).toBe(true); expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(revision);
  });

  it('More on B never labels dirty A fields as B, and Discard explicitly starts B', () => {
    const h = fixture(); change('selected-pitch', 'C#4'); h.select('b'); h.select.mockClear();
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', matchesSelection: false, canApply: false });
    expect(el('event-form-context').textContent).toContain('C4'); expect(el('event-form-context').textContent).not.toContain('D4');
    expect(el('selected-draft-status').textContent).toContain('D4'); expect(el('selected-draft-status').textContent).toMatch(/selected/);
    expect(el('load-event-values').textContent).toMatch(/Discard and edit D4/);
    const before = h.session.project;
    el('load-event-values').click();
    expect(h.select).toHaveBeenCalledWith('b'); expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'b', dirty: false, matchesSelection: true });
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('D4'); expect(h.session.project).toEqual(before);
  });

  it.each(['properties', 'markings'] as const)('keeps the %s draft if a named Discard destination changes before render', form => {
    const h = fixture();
    if (form === 'properties') change('selected-pitch', 'C#4'); else changeMark('a-mark', 'staccato');
    h.select('b'); h.select.mockClear();
    const button = el(form === 'properties' ? 'load-event-values' : 'discard-event-markings');
    expect(button.textContent).toContain('Discard and edit D4');
    h.unseen('c'); const before = accepted(h.session); button.click();
    const view = form === 'properties' ? h.forms.snapshot('selected') : h.marks.snapshot();
    expect(view).toMatchObject({ targetId: 'a', dirty: true, canApply: false });
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
    expect(button.textContent).toContain('Discard and edit E4');
    expect(el(form === 'properties' ? 'selected-draft-status' : 'event-markings-draft-status').textContent).toMatch(/changed/);
  });

  it.each([
    { form: 'properties', members: ['b', 'c'] }, { form: 'properties', members: [] },
    { form: 'markings', members: ['b', 'c'] }, { form: 'markings', members: [] },
  ])('keeps a $form draft if a named Discard gains membership $members before render', ({ form, members }) => {
    const h = fixture();
    if (form === 'properties') change('selected-pitch', 'C#4'); else changeMark('a-mark', 'staccato');
    h.select('b'); h.select.mockClear(); h.unseen('b', members); const before = accepted(h.session);
    el(form === 'properties' ? 'load-event-values' : 'discard-event-markings').click();
    expect((form === 'properties' ? h.forms.snapshot('selected') : h.marks.snapshot()).dirty).toBe(true);
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
  });

  it.each(['properties', 'markings'] as const)('keeps the %s draft if a replacement document reuses a named Discard destination', form => {
    const h = fixture();
    if (form === 'properties') change('selected-pitch', 'C#4'); else changeMark('a-mark', 'staccato');
    h.select('b'); h.select.mockClear(); h.session.removeEventListener('change', h.refresh);
    h.session.replaceProject(createProject(source, 'Replacement')); const before = accepted(h.session);
    el(form === 'properties' ? 'load-event-values' : 'discard-event-markings').click();
    expect(form === 'properties' ? h.forms.snapshot('selected') : h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: true, status: 'document-changed' });
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
  });

  it.each(['properties', 'markings'] as const)('keeps the %s draft if the named Discard destination is deleted before render', form => {
    const h = fixture();
    if (form === 'properties') change('selected-pitch', 'C#4'); else changeMark('a-mark', 'staccato');
    h.select('b'); h.select.mockClear(); h.session.removeEventListener('change', h.refresh);
    h.session.execute({ type: 'remove-event', eventId: 'b' }); const before = accepted(h.session);
    const button = el(form === 'properties' ? 'load-event-values' : 'discard-event-markings');
    expect(button.textContent).toContain('Discard and edit D4'); button.click();
    expect(form === 'properties' ? h.forms.snapshot('selected') : h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: true, canApply: false });
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
    expect(el(form === 'properties' ? 'selected-draft-status' : 'event-markings-draft-status').textContent).toMatch(/changed|no longer available/);
  });

  it.each(['removed', 'replacement'] as const)('does not follow an old scalar Return after its target is %s', reason => {
    const h = fixture(); change('selected-pitch', 'C#4'); h.select('b'); h.select.mockClear(); h.session.removeEventListener('change', h.refresh);
    if (reason === 'removed') h.session.execute({ type: 'remove-event', eventId: 'a' });
    else h.session.replaceProject(createProject(source, 'Replacement'));
    const before = accepted(h.session); el('return-selected-draft').click();
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
    expect(h.forms.snapshot('selected').dirty).toBe(true);
  });

  it.each([{ members: ['a', 'b'] }, { members: [] as string[] }])('does not authorize a held primary for actual membership $members', ({ members }) => {
    const h = fixture(); change('selected-pitch', 'C#4'); changeMark('a-mark', 'staccato');
    h.actual('a', members); const before = accepted(h.session);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', matchesSelection: false, canApply: false });
    expect(h.marks.snapshot()).toMatchObject({ targetId: 'a', matchesSelection: false, canApply: false });
    expect(() => h.forms.resolve('selected')).toThrow(/Return/); el('apply-event-markings').dispatchEvent(new Event('click'));
    expect(accepted(h.session)).toEqual(before);
  });

  it.each([{ members: ['a', 'b'] }, { members: [] as string[] }])('Discard does not select an arbitrary primary for actual membership $members', ({ members }) => {
    const h = fixture(); change('selected-pitch', 'C#4'); changeMark('a-mark', 'staccato'); h.actual('a', members);
    const before = accepted(h.session);
    expect(el('load-event-values').textContent).toBe('Discard changes'); expect(el('discard-event-markings').textContent).toBe('Discard changes');
    el('load-event-values').click(); el('discard-event-markings').click();
    expect(h.select).not.toHaveBeenCalled(); expect(h.forms.snapshot('selected').dirty).toBe(false); expect(h.marks.snapshot().dirty).toBe(false);
    expect(h.forms.snapshot('selected').canApply).toBe(false); expect(h.marks.snapshot().canApply).toBe(false);
    expect(accepted(h.session)).toEqual(before);
  });

  it('retains distinct scalar and attachment owners instead of merging their captions or drafts', () => {
    const h = fixture(); change('selected-pitch', 'C#4'); h.select('b'); changeMark('b-mark', 'turn'); h.enter('c');
    expect(h.forms.snapshot('selected').targetId).toBe('a'); expect(h.marks.snapshot().targetId).toBe('b');
    expect(el('event-form-context').textContent).toContain('C4'); expect(el('event-markings-target').hidden).toBe(false); expect(el('event-markings-target').textContent).toContain('D4');
    expect(markingField('b-mark').getAttribute('aria-describedby')).toContain('event-markings-target');
    expect(markingField('b-mark').getAttribute('aria-describedby')).not.toContain('event-form-context');
    const before = h.session.project; el('load-event-values').click();
    expect(h.forms.snapshot('selected').targetId).toBe('c'); expect(h.marks.snapshot()).toMatchObject({ targetId: 'b', dirty: true, matchesSelection: false });
    expect(h.session.project).toEqual(before); expect(h.propertiesContext.entryMode).toBe(false);
  });

  it.each(['properties-first', 'markings-first'] as const)('updates a shared caption when one of two A drafts is discarded for C (%s)', order => {
    const h = fixture(); change('selected-pitch', 'C#4'); changeMark('a-mark', 'staccato'); h.actual('c');
    expect(el('event-markings-target').hidden).toBe(true);
    const refresh = () => order === 'properties-first' ? (h.forms.refresh(), h.marks.refresh()) : (h.marks.refresh(), h.forms.refresh());
    el('load-event-values').click(); refresh();
    expect(h.forms.snapshot('selected').targetId).toBe('c'); expect(h.marks.snapshot()).toMatchObject({ targetId: 'a', dirty: true });
    expect(el('event-form-context').textContent).toContain('E4'); expect(el('event-markings-target').hidden).toBe(false);
    expect(markingField('a-mark').getAttribute('aria-describedby')).toContain('event-markings-target');
    expect(markingField('a-mark').getAttribute('aria-describedby')).not.toContain('event-form-context');
    el('discard-event-markings').click(); refresh();
    expect(h.marks.snapshot().targetId).toBe('c'); expect(el('event-markings-target').hidden).toBe(true);
    expect(el('event-markings-editor').getAttribute('aria-describedby')).toBe('event-form-context');
  });

  it.each(['hidden', 'inert'] as const)('keeps an available marks caption when the matching properties caption is %s', attribute => {
    const h = fixture(); el('event-form-context').setAttribute(attribute, ''); h.marks.refresh();
    expect(el('event-markings-target').hidden).toBe(false);
    expect(markingField('a-mark').getAttribute('aria-describedby')).toContain('event-markings-target');
    expect(markingField('a-mark').getAttribute('aria-describedby')).not.toContain('event-form-context');
    el('event-form-context').removeAttribute(attribute); h.marks.refresh();
    expect(el('event-markings-target').hidden).toBe(true);
  });

  it('keeps an attached-mark row’s held identity and scroll during entry, while retaining its edit guard', () => {
    const h = fixture(); h.marks.openFor('a', 'a-mark'); const field = markingField('a-mark');
    el('selection-inspector').scrollTop = 231; el('score-editor').focus(); h.enter('c');
    h.marks.openFor('a', 'a-mark');
    expect(h.select).not.toHaveBeenCalled(); expect(h.marks.snapshot().targetId).toBe('a'); expect(field.disabled).toBe(true);
    expect(el('event-markings-editor').dataset.activeMarkingId).toBe('a-mark');
    expect(el('selection-inspector').scrollTop).toBe(231);
    el('return-event-markings').click(); expect(h.session.selectionId).toBe('a'); expect(h.marksContext.entryMode).toBe(false);
    changeMark('a-mark', 'staccato'); el('apply-event-markings').click();
    expect(h.session.source.querySelector('#a-mark')?.getAttribute('placement')).toBe('below');
    expect(h.session.source.querySelector('#a-mark')?.getAttribute('data-keep')).toBe('old-side');
  });

  it('does not retarget an inspector when opening it for reading during entry', () => {
    const h = fixture(); h.enter('c'); const before = accepted(h.session); h.marks.openFor('b');
    expect(h.select).not.toHaveBeenCalled(); expect(h.propertiesContext.entryMode).toBe(true);
    expect(h.marks.snapshot().targetId).toBe('a'); expect(accepted(h.session)).toEqual(before);
  });

  it('restores a held pane during entry without scrolling to its offscreen Return action', () => {
    const h = fixture(); h.marks.openFor('a', 'a-mark'); const pane = el('selection-inspector');
    Object.defineProperty(pane, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 1200, configurable: true });
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this === pane ? { top: 100, bottom: 300, height: 200 } : { top: -150, bottom: -106, height: 44 }) as DOMRect;
    });
    try {
      pane.scrollTop = 440; el('score-editor').focus(); h.enter('c'); h.marks.openFor('a', 'a-mark');
      expect(pane.scrollTop).toBe(440); expect(document.activeElement).toBe(el('score-editor'));
      expect(el('event-markings-editor').dataset.activeMarkingId).toBe('a-mark'); expect(h.select).not.toHaveBeenCalled();
    } finally { bounds.mockRestore(); }
  });

  it('hides the successful attachment notice and focuses an available caption without stealing later score focus', () => {
    const h = fixture(); changeMark('a-mark', 'staccato'); el('apply-event-markings').focus(); el('apply-event-markings').click();
    expect(notice('event-markings-draft-status').hidden).toBe(true); expect(el('event-markings-draft-status').textContent).toBe('');
    expect(document.activeElement?.closest('[hidden], [inert]')).toBeNull(); expect(document.activeElement).not.toBe(el('apply-event-markings'));
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining('One Undo'));
    el('score-editor').focus(); h.refresh(); expect(document.activeElement).toBe(el('score-editor'));
  });

  it('does not resurrect an old success message when Enter later needs a Return action', () => {
    const h = fixture(); changeMark('a-mark', 'staccato'); el('apply-event-markings').click(); h.enter('c');
    expect(el('event-markings-draft-status').textContent).toContain('Return');
    expect(el('event-markings-draft-status').textContent).not.toMatch(/Applied attached marks|One Undo/);
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining('One Undo'));
  });

  it.each([false, true])('repairs scalar Apply focus only after commit, including native blur: %s', nativeBlur => {
    const h = fixture(); el<HTMLDetailsElement>('event-details').open = true; change('selected-pitch', 'C#4');
    const apply = el<HTMLButtonElement>('update-event'); apply.focus(); const resolved = h.forms.resolve('selected');
    h.session.execute({ type: 'update-event', eventId: resolved.targetId, fields: ['pitch'], value: {
      kind: 'note', pitch: 'C#4', pitches: '', duration: 'quarter', dots: 0, rhythmic: false, measureRest: false,
      accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
    } });
    if (nativeBlur) { document.body.tabIndex = -1; document.body.focus(); expect(document.activeElement).toBe(document.body); }
    h.forms.commit('selected');
    expect(document.activeElement).not.toBe(apply); expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('[hidden], [inert], details:not([open])')).toBeNull();
    expect((document.activeElement as HTMLInputElement).disabled).not.toBe(true);
    el('score-editor').focus(); h.refresh(); expect(document.activeElement).toBe(el('score-editor'));
  });

  it('does not take focus back if another target was deliberately focused before scalar commit', () => {
    const h = fixture(); el<HTMLDetailsElement>('event-details').open = true; change('selected-pitch', 'C#4');
    el('update-event').focus(); h.forms.resolve('selected'); el('score-editor').focus(); h.forms.commit('selected');
    expect(document.activeElement).toBe(el('score-editor'));
  });

  it('gives the low-level beam field its held-event caption and never treats a group as that event', () => {
    const h = fixture(); change('selected-pitch', 'C#4'); h.select('b');
    expect(el('beam-target-context').textContent).toBe(el('event-form-context').textContent);
    expect(el('beam-target-context').dataset.targetId).toBe('a'); expect(el('beam-target-context').textContent).not.toContain('D4');
    expect(el('selected-beam').getAttribute('aria-describedby')).toContain('beam-target-context');
    expect(el('selected-beam').getAttribute('aria-describedby')).not.toContain('event-form-context');
    h.actual('a', ['a', 'b']);
    expect(el<HTMLSelectElement>('selected-beam').disabled).toBe(true);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'a', matchesSelection: false, canApply: false });
  });

  it('keeps a local validation failure visible while preserving the original dirty target', () => {
    const h = fixture(); change('selected-pitch', 'not a pitch'); h.forms.markFailure('selected', new Error('Write an explicit pitch and octave.'));
    expect(notice('selected-draft-status').hidden).toBe(false); expect(el('selected-draft-status').textContent).toContain('Write an explicit pitch and octave.');
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('not a pitch'); expect(h.forms.snapshot('selected').targetId).toBe('a'); expect(h.session.revision).toBe(0);
  });

  it('does not substitute a newly selected event for a deleted held inspection target', () => {
    const h = fixture(); h.enter('c'); h.session.execute({ type: 'remove-event', eventId: 'a' }); h.actual('c');
    expect(h.forms.snapshot('selected').targetId).toBeNull(); expect(h.marks.snapshot().targetId).toBeNull();
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(true); expect(el('event-form-context').textContent).toMatch(/no longer|unavailable/);
    expect(el('event-markings-target').textContent).not.toContain('E4');
    expect(notice('selected-draft-status').hidden).toBe(true); expect(notice('event-markings-draft-status').hidden).toBe(true);
  });

  it('keeps document-bound dirty owners when a replacement reuses their source IDs', () => {
    const h = fixture(); change('selected-pitch', 'C#4'); changeMark('a-mark', 'staccato');
    h.session.replaceProject(createProject(source, 'Another document')); h.propertiesContext.inspectionSelectionId = h.marksContext.inspectionSelectionId = null; h.refresh();
    expect(h.forms.snapshot('selected').status).toBe('document-changed'); expect(h.marks.snapshot().status).toBe('document-changed');
    expect(notice('selected-draft-status').hidden).toBe(false); expect(notice('event-markings-draft-status').hidden).toBe(false);
    expect(() => h.forms.resolve('selected')).toThrow(/different|another/); expect(h.session.source.querySelector('#a')?.getAttribute('pitch')).toBe('C4');
  });
});
