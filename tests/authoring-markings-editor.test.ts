// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { MarkingsEditor } from '../src/authoring/markings-editor.js';
import type { MarkingsContext } from '../src/authoring/markings-editor.js';
import { createProject } from '../src/authoring/project.js';
import { enhanceSelects } from '../src/authoring/select.js';
import type { AuthorProject, ViewMode } from '../src/authoring/types.js';
import { formatRational } from '../src/model/index.js';

const cleanup: (() => void)[] = [];
const option = (value: string) => `<option value="${value}">${value || 'New'}</option>`;
const selectMarkup = (id: string, values: string[]) => `<label for="${id}">${id}<select id="${id}">${values.map(option).join('')}</select></label>`;
const shell = `<button id="add-chord-symbol" type="button">Add chord symbol</button><section id="annotation-inspector">
  <p id="annotation-draft-target"></p><p id="annotation-draft-status" role="status"></p>
  ${selectMarkup('annotation-select', [''])}${selectMarkup('annotation-kind', ['harmony', 'direction', 'rehearsal', 'dynamics', 'tempo'])}
  ${selectMarkup('annotation-placement', ['above', 'below'])}
  <label for="annotation-text">Printed text<textarea id="annotation-text"></textarea></label>
  <label for="annotation-at">Position<input id="annotation-at" value="0"></label>
  <button id="annotation-at-start">At bar start</button><button id="annotation-at-selection">Use selected note's current position</button>
  <div id="annotation-tempo-fields"><label for="annotation-bpm">BPM<input id="annotation-bpm" type="number"></label>
    ${selectMarkup('annotation-beat', ['quarter', 'eighth', 'half', 'whole'])}${selectMarkup('annotation-dots', ['0', '1', '2', '3'])}</div>
  ${selectMarkup('annotation-scope', ['staff', 'all', 'parts'])}<div id="annotation-part-scopes"></div>
  <button id="add-annotation">Add instruction</button><button id="add-annotation-next">Add & next bar</button>
  <button id="update-annotation">Apply changes</button><button id="update-annotation-next">Apply & next bar</button>
  <button id="remove-annotation">Remove</button><button id="new-annotation">New instruction</button>
  <button id="discard-annotation-draft">Discard/start here</button><button id="return-annotation-draft">Return to target</button>
  <button id="review-annotation-draft">Review current changes</button></section>`;

function field<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing marking test control ${id}`);
  return found as T;
}
function value(id: string): string { return field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).value; }
function set(id: string, next: string): void {
  const element = field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  element.value = next;
  element.dispatchEvent(new Event(id === 'annotation-text' || id === 'annotation-at' || id === 'annotation-bpm' ? 'input' : 'change', { bubbles: true }));
}
function click(id: string, bypassDisabled = false): void {
  const button = field<HTMLButtonElement>(id);
  // Simulate a stale enabled control so the handler's own guard must reject it.
  // happy-dom suppresses clicks on disabled buttons before reaching listeners.
  if (bypassDisabled) { button.disabled = false; button.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  else button.click();
}
function note(id: string, pitch = 'C4', duration = 'quarter'): string {
  return `<music-note id="${id}" pitch="${pitch}" duration="${duration}"></music-note>`;
}
function harmony(id: string, text: string, at = '0', placement = 'above'): string {
  return `<music-harmony id="${id}" text="${text}" at="${at}" placement="${placement}"></music-harmony>`;
}
function score(bars = 3, annotations: Record<number, string> = {}): string {
  return `<music-staff id="staff" label="Flute">${Array.from({ length: bars }, (_, index) => {
    const number = index + 1;
    return `<music-measure id="m${number}" number="${number}" incomplete>${note(`n${number}a`)}${note(`n${number}b`, 'D4')}${annotations[number] ?? ''}</music-measure>`;
  }).join('')}</music-staff>`;
}
function project(html = score()): AuthorProject {
  return createProject(html, 'Markings fixture', [
    { id: 'flute', label: 'Flute part', staffIds: ['staff'] },
    { id: 'reader', label: 'Reader part', staffIds: ['staff'] },
  ]);
}

function fixture(input = project(), initial = 'n1a', markup: string | (() => void) = shell,
  root: Document | HTMLElement | ShadowRoot = document) {
  if (typeof markup === 'function') markup();
  else document.body.innerHTML = markup;
  enhanceSelects(root);
  const session = new EditorSession(input);
  session.select(initial);
  const state = { mode: 'write' as ViewMode, autoRefresh: true };
  const context = (): MarkingsContext => {
    const score = session.score;
    const cursor = session.cursor;
    const staff = score.staves.find(item => item.id === cursor?.staffId) ?? score.staves[0];
    const measure = staff.measures.find(item => item.id === cursor?.measureId) ?? staff.measures[0];
    const voiceIndex = cursor?.voiceIndex ?? 0;
    return { mode: state.mode, staff, measure, voiceIndex,
      event: measure.voices[voiceIndex]?.events.find(item => item.id === session.selectionId),
      annotation: measure.annotations.find(item => item.id === session.selectionId) };
  };
  const select = vi.fn((id: string) => { session.select(id); });
  const openTools = vi.fn();
  const report = vi.fn();
  const onDraftChange = vi.fn();
  const editor = new MarkingsEditor({ session, context, select, openTools, report, onDraftChange }, root);
  const refresh = () => { if (state.autoRefresh) editor.refresh(); };
  session.addEventListener('change', refresh);
  cleanup.push(() => { session.removeEventListener('change', refresh); editor.dispose(); });
  const selectId = (id: string) => { select(id); editor.refresh(); };
  return { session, state, editor, context, select, selectId, openTools, report, onDraftChange,
    annotations: (number: number) => session.score.staves[0].measures[number - 1].annotations,
    text: () => root.querySelector('#annotation-draft-status')!.textContent,
    disabled: (id: string) => root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled };
}

afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });

describe('isolated instruction control roots', () => {
  it.each(['element', 'shadow'] as const)('edits the existing instruction in its %s root without changing duplicate global controls', kind => {
    const global = fixture(project(score(1, { 1: harmony('global-harmony', 'G7') })), 'global-harmony', mountAuthorFixture);
    const globalField = field<HTMLTextAreaElement>('annotation-text');
    const globalSource = global.session.project.sourceHtml;
    const host = document.createElement('div');
    document.body.append(host);
    const root = kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host;
    const container = document.createElement('div');
    root.append(container);
    const scoped = fixture(project(score(1, { 1: harmony('scoped-harmony', 'Dm9') })), 'scoped-harmony',
      () => { mountAuthorFixture(container); }, root);
    const input = root.querySelector<HTMLTextAreaElement>('#annotation-text')!;
    const apply = root.querySelector<HTMLButtonElement>('#update-annotation')!;
    expect(input.value).toBe('Dm9');
    expect(globalField.value).toBe('G7');

    input.value = 'Dm11';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(scoped.editor.hasDirty).toBe(true);
    expect(global.editor.hasDirty).toBe(false);
    expect(scoped.annotations(1)[0].text).toBe('Dm9');
    expect(globalField.value).toBe('G7');
    apply.click();
    expect(scoped.annotations(1)[0].text).toBe('Dm11');
    expect(scoped.session.revision).toBe(1);
    expect(scoped.editor.hasDirty).toBe(false);
    expect(global.session.project.sourceHtml).toBe(globalSource);
    expect(global.session.revision).toBe(0);
    expect(globalField.value).toBe('G7');

    scoped.editor.dispose();
    input.value = 'Cmaj7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    apply.disabled = false;
    apply.click();
    expect(scoped.annotations(1)[0].text).toBe('Dm11');
    expect(scoped.editor.hasDirty).toBe(false);
    expect(scoped.session.revision).toBe(1);
  });
});

describe('instruction Properties reopening does not navigate the score', () => {
  const annotated = () => project(score(3, { 1: harmony('h1', 'Dm9'), 2: harmony('h2', 'G13') }));
  const accepted = (h: ReturnType<typeof fixture>) => ({
    source: h.session.project.sourceHtml, revision: h.session.revision,
    selection: h.session.selection, cursor: h.session.cursor,
    undo: h.session.canUndo, redo: h.session.canRedo,
    scopes: h.session.project.instructionScopes,
  });
  const fields = () => Object.fromEntries(['annotation-select', 'annotation-kind', 'annotation-text', 'annotation-at',
    'annotation-placement', 'annotation-scope'].map(id => [id, value(id)]));

  it.each([false, true])('reopens the current instruction without selecting again, preserving dirty=%s fields and Redo', dirty => {
    const h = fixture(annotated(), 'h2');
    h.session.execute({ type: 'set-note-accidental', eventId: 'n3a', alter: 1, ties: 'reject' });
    h.session.undo();
    expect(h.session.canRedo).toBe(true);
    expect(h.session.selectionId).toBe('h2');
    if (dirty) {
      set('annotation-text', 'G7sus'); set('annotation-at', '1/4');
      set('annotation-placement', 'below'); set('annotation-scope', 'all');
    }
    const before = accepted(h), buffered = fields(), caption = field('annotation-draft-target').textContent;
    h.select.mockClear(); h.openTools.mockClear();
    for (let attempt = 0; attempt < 3; attempt++) {
      h.editor.editAnnotation('h2', { navigate: false });
      expect(h.select).not.toHaveBeenCalled();
      expect(h.openTools).toHaveBeenCalledTimes(attempt + 1);
      expect(document.activeElement).toBe(field('annotation-text'));
      expect(fields()).toEqual(buffered); expect(field('annotation-draft-target').textContent).toBe(caption);
      expect(h.editor.hasDirty).toBe(dirty); expect(accepted(h)).toEqual(before);
    }
  });

  it('keeps default explicit instruction editing as one selection of its requested destination', () => {
    const h = fixture(annotated(), 'h1');
    const source = h.session.project.sourceHtml, revision = h.session.revision;
    h.select.mockClear(); h.openTools.mockClear();
    h.editor.editAnnotation('h2');
    expect(h.select).toHaveBeenCalledExactlyOnceWith('h2'); expect(h.openTools).toHaveBeenCalledOnce();
    expect(h.session.selectionId).toBe('h2'); expect(h.context().annotation?.id).toBe('h2');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('G13');
    expect(document.activeElement).toBe(field('annotation-text'));
    expect(h.session.project.sourceHtml).toBe(source); expect(h.session.revision).toBe(revision);
    expect(h.session.canUndo).toBe(false); expect(h.session.canRedo).toBe(false);
  });

  it('retains dirty instruction A when reopening selected B without navigation or silent retargeting', () => {
    const h = fixture(annotated(), 'h1');
    set('annotation-text', 'Dm11'); set('annotation-placement', 'below'); set('annotation-scope', 'all');
    h.selectId('h2');
    const before = accepted(h), buffered = fields(), caption = field('annotation-draft-target').textContent;
    h.select.mockClear(); h.openTools.mockClear();
    h.editor.editAnnotation('h2', { navigate: false });
    expect(h.select).not.toHaveBeenCalled(); expect(h.openTools).toHaveBeenCalledOnce();
    expect(h.session.selectionId).toBe('h2'); expect(h.context().annotation?.id).toBe('h2');
    expect(fields()).toEqual(buffered); expect(value('annotation-select')).toBe('h1');
    expect(field('annotation-draft-target').textContent).toBe(caption);
    expect(caption).toContain('bar 1'); expect(h.text()).toContain('original target'); expect(h.text()).toContain('Discard/start here');
    expect(h.editor.hasDirty).toBe(true); expect(accepted(h)).toEqual(before);
    expect(h.annotations(1)[0]).toMatchObject({ id: 'h1', text: 'Dm9', placement: 'above' });
    expect(h.annotations(2)[0]).toMatchObject({ id: 'h2', text: 'G13', placement: 'above' });
    click('discard-annotation-draft');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('G13');
    expect(h.editor.hasDirty).toBe(false); expect(h.select).not.toHaveBeenCalled(); expect(accepted(h)).toEqual(before);
  });

  it('advances unchanged harmony deliberately, then reopens its current target without another selection callback', () => {
    const h = fixture(annotated(), 'h1');
    const source = h.session.project.sourceHtml;
    h.select.mockClear(); click('update-annotation-next');
    expect(h.select.mock.calls.map(([id]) => id)).toEqual(['m2', 'h2']);
    expect(h.session.selectionId).toBe('h2'); expect(value('annotation-select')).toBe('h2');
    expect(value('annotation-text')).toBe('G13'); expect(h.session.project.sourceHtml).toBe(source);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    const before = accepted(h); h.select.mockClear();
    h.editor.editAnnotation('h2', { navigate: false });
    expect(h.select).not.toHaveBeenCalled(); expect(accepted(h)).toEqual(before);
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('G13');
  });
});

describe('dedicated Markings draft and direct entry', () => {
  it('makes initially hidden real-shell New and collision recovery actions available when applicable', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1', mountAuthorFixture);
    expect(field('new-annotation').hidden).toBe(false);
    expect(field('add-annotation').hidden).toBe(true);
    expect(field('update-annotation-next').hidden).toBe(false);
    click('update-annotation-next'); set('annotation-text', 'Dm9');
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '0', placement: 'above' } });
    expect(field('new-annotation').hidden).toBe(false);
    expect(field('new-annotation').textContent).toBe('Keep draft as New');
    expect(field('annotation-select').firstElementChild?.localName).toBe('button');
  });

  it('opens chord entry directly with the selected exact onset and native form semantics', () => {
    const h = fixture(project(), 'n1b');
    click('add-chord-symbol');
    expect(h.openTools).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field('annotation-text'));
    expect(value('annotation-kind')).toBe('harmony');
    expect(value('annotation-at')).toBe('1/4');
    expect(field('annotation-draft-target').textContent).toContain('New chord symbol · Flute · bar 1 · at 1/4');
    expect(field('annotation-tempo-fields').hidden).toBe(true);
    expect(field('annotation-select').firstElementChild?.localName).toBe('button');
    expect(field('annotation-select').querySelector('selectedcontent')).not.toBeNull();
    expect(h.session.revision).toBe(0);
    expect(h.editor.dirtyCount).toBe(0);
  });

  it('adds one fixed-onset annotation and its literal all-recipient scope in one undo step', () => {
    const h = fixture(project(), 'n1b');
    const before = h.session.project.sourceHtml;
    click('add-chord-symbol'); set('annotation-text', 'Dm9'); set('annotation-scope', 'all');
    field('add-annotation').focus(); click('add-annotation');
    const annotation = h.annotations(1)[0];
    expect(annotation.text).toBe('Dm9');
    expect(formatRational(annotation.onset)).toBe('1/4');
    expect(h.session.project.instructionScopes[annotation.id]).toBe('all');
    expect(h.session.revision).toBe(1);
    expect(h.editor.dirtyCount).toBe(0);
    expect(document.activeElement).toBe(field('annotation-text'));
    expect(field('annotation-inspector').dataset.annotationMode).toBe('edit');
    h.session.undo();
    expect(h.session.project.sourceHtml).toBe(before);
    expect(h.session.project.instructionScopes).toEqual({});
    expect(h.session.canUndo).toBe(false);
    h.session.redo();
    expect(h.annotations(1)[0].id).toBe(annotation.id);
  });

  it('captures selected note position as an exact fixed onset rather than a future attachment', () => {
    const h = fixture(project(), 'n1b');
    click('add-chord-symbol'); set('annotation-text', 'G13');
    h.session.execute({ type: 'set-event-rhythm', eventId: 'n1a', duration: 'eighth', dots: 0 });
    expect(value('annotation-at')).toBe('1/4');
    click('add-annotation');
    expect(formatRational(h.annotations(1)[0].onset)).toBe('1/4');
    h.selectId('n1b'); click('new-annotation'); set('annotation-text', 'Cmaj9');
    click('annotation-at-selection');
    expect(value('annotation-at')).toBe('1/8');
    expect(h.text()).toContain('will not follow future note movement');
    click('annotation-at-start');
    expect(value('annotation-at')).toBe('0');
  });

  it('captures nested tuplet onsets without rounding and adds no musical history until Add', () => {
    const html = `<music-staff id="staff"><music-measure id="m1" incomplete>${note('n1a', 'C4', 'eighth')}<music-tuplet id="outer" actual="3" normal="2">${note('n1b', 'D4', 'eighth')}<music-tuplet id="inner" actual="5" normal="4">${note('n1c', 'E4', 'sixteenth')}${note('n1d', 'F4', 'sixteenth')}</music-tuplet></music-tuplet></music-measure></music-staff>`;
    const h = fixture(project(html), 'n1d');
    click('add-chord-symbol'); click('annotation-at-selection');
    expect(value('annotation-at')).toBe('29/120');
    expect(h.session.revision).toBe(0);
    set('annotation-text', 'A7alt'); click('add-annotation');
    expect(formatRational(h.annotations(1)[0].onset)).toBe('29/120');
  });

  it('shows tempo-only fields only for tempo without resetting chosen placement or recipients', () => {
    const h = fixture();
    set('annotation-placement', 'below'); set('annotation-scope', 'all');
    set('annotation-kind', 'tempo');
    expect(field('annotation-tempo-fields').hidden).toBe(false);
    expect(value('annotation-placement')).toBe('below');
    expect(value('annotation-scope')).toBe('all');
    set('annotation-kind', 'direction');
    expect(field('annotation-tempo-fields').hidden).toBe(true);
    expect(value('annotation-placement')).toBe('below');
    expect(h.session.revision).toBe(0);
  });

  it('keeps an unfinished marking bound across selection, view changes, note changes, and title changes', () => {
    const h = fixture();
    click('add-chord-symbol'); set('annotation-text', 'Dm11');
    h.selectId('n3a');
    h.state.mode = 'read'; h.editor.refresh(); h.state.mode = 'pages'; h.editor.refresh(); h.state.mode = 'write'; h.editor.refresh();
    h.session.update('Title', draft => { draft.metadata.title = 'A revised title'; });
    h.session.execute({ type: 'set-note-accidental', eventId: 'n3a', alter: 1, ties: 'reject' });
    expect(value('annotation-text')).toBe('Dm11');
    expect(field('annotation-draft-target').textContent).toContain('bar 1');
    expect(h.disabled('add-annotation')).toBe(false);
    expect(h.text()).toContain('not saved');
    expect(h.text()).toContain('original target');
    expect(h.editor.dirtyCount).toBe(1);
    click('add-annotation');
    expect(h.annotations(1)[0].text).toBe('Dm11');
    expect(h.annotations(3)).toHaveLength(0);
    expect(h.session.project.metadata.title).toBe('A revised title');
  });

  it('pristine forms follow selection and dirty forms offer explicit Return and Discard/start here', () => {
    const h = fixture();
    h.selectId('n2b'); expect(value('annotation-at')).toBe('1/4');
    expect(field('annotation-draft-target').textContent).toContain('bar 2');
    set('annotation-text', 'Solo until cue'); h.selectId('n3a');
    expect(field<HTMLButtonElement>('return-annotation-draft').hidden).toBe(false);
    click('return-annotation-draft');
    expect(h.context().measure.id).toBe('m2');
    expect(value('annotation-text')).toBe('Solo until cue');
    h.selectId('n3a'); click('discard-annotation-draft');
    expect(value('annotation-text')).toBe('');
    expect(field('annotation-draft-target').textContent).toContain('bar 3');
    expect(h.editor.hasDirty).toBe(false);
    expect(h.session.revision).toBe(0);
  });

  it('does not take a position from a different draft bar', () => {
    const h = fixture();
    set('annotation-text', 'Dm9'); h.selectId('n2b');
    expect(h.disabled('annotation-at-selection')).toBe(true);
    click('annotation-at-selection', true);
    expect(value('annotation-at')).toBe('0');
    expect(h.text()).toContain('this instruction’s staff and bar');
  });

  it('keeps dirty text when direct Add chord symbol requests another target, then explicitly starts New', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13'); h.selectId('n3a'); click('add-chord-symbol');
    expect(value('annotation-text')).toBe('Cmaj13');
    expect(field('annotation-inspector').dataset.annotationMode).toBe('edit');
    expect(h.text()).toContain('Discard/start here');
    click('discard-annotation-draft');
    expect(value('annotation-text')).toBe('');
    expect(value('annotation-kind')).toBe('harmony');
    expect(field('annotation-draft-target').textContent).toContain('bar 3');
    expect(field('annotation-inspector').dataset.annotationMode).toBe('new');
    expect(h.annotations(1)[0].text).toBe('Cmaj9');
  });

  it('discards a new draft at a changed note in the same bar without reviving its old onset', () => {
    const h = fixture(); set('annotation-text', 'old'); h.selectId('n1b');
    click('discard-annotation-draft');
    expect(value('annotation-at')).toBe('1/4');
    h.editor.refresh(); expect(value('annotation-at')).toBe('1/4');
  });
});

describe('Markings dependency and transaction safety', () => {
  it('merges only changed fields against current accepted annotation values', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13');
    h.session.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'Cmaj9', at: '0', placement: 'below' } });
    expect(h.disabled('update-annotation')).toBe(false);
    expect(value('annotation-placement')).toBe('below');
    click('update-annotation');
    expect(h.annotations(1)[0]).toMatchObject({ id: 'h1', text: 'Cmaj13', placement: 'below' });
  });

  it('keeps a conflicting typed value until its current accepted changes are explicitly reviewed', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13');
    h.session.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'C6/9', at: '0', placement: 'above' } });
    expect(value('annotation-text')).toBe('Cmaj13');
    expect(h.disabled('update-annotation')).toBe(true);
    expect(h.text()).toContain('C6/9');
    expect(field('annotation-draft-status').getAttribute('role')).toBe('alert');
    const before = h.session.project.sourceHtml;
    click('update-annotation', true); expect(h.session.project.sourceHtml).toBe(before);
    field('review-annotation-draft').focus(); click('review-annotation-draft');
    expect(h.disabled('update-annotation')).toBe(false);
    expect(value('annotation-text')).toBe('Cmaj13');
    expect(document.activeElement).toBe(field('update-annotation'));
    click('update-annotation');
    expect(h.annotations(1)[0].text).toBe('Cmaj13');
  });

  it('treats a changed meter as relevant context, but not another bar’s meter', () => {
    const h = fixture(); set('annotation-text', 'G13');
    h.session.execute({ type: 'set-measure', measureId: 'm2', values: { meter: '3/4' } });
    expect(h.disabled('add-annotation')).toBe(false);
    h.session.execute({ type: 'set-measure', measureId: 'm1', values: { meter: '3/4' } });
    expect(h.disabled('add-annotation')).toBe(true);
    expect(value('annotation-text')).toBe('G13');
    expect(h.text()).toContain('meter is now 3/4');
    click('review-annotation-draft'); click('add-annotation');
    expect(h.annotations(1)[0].text).toBe('G13');
  });

  it('requires review when an accepted annotation changes kind under a typed draft', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13');
    h.session.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'direction', text: 'Cmaj9', at: '0', placement: 'above' } });
    expect(h.disabled('update-annotation')).toBe(true);
    expect(field('annotation-inspector').dataset.annotationState).toBe('conflict');
    expect(value('annotation-text')).toBe('Cmaj13');
    click('update-annotation', true);
    expect(h.annotations(1)[0]).toMatchObject({ kind: 'direction', text: 'Cmaj9' });
  });

  it('does not acknowledge an unseen newer conflict through a stale Review handler', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13');
    h.session.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'C6/9', at: '0', placement: 'above' } });
    expect(h.text()).toContain('C6/9'); h.state.autoRefresh = false;
    h.session.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'C7', at: '0', placement: 'above' } });
    click('review-annotation-draft');
    expect(h.disabled('update-annotation')).toBe(true); expect(h.text()).toContain('C7');
    click('review-annotation-draft'); expect(h.disabled('update-annotation')).toBe(false);
    expect(value('annotation-text')).toBe('Cmaj13');
  });

  it('never redirects a dirty draft when its annotation is deleted or a different project reuses its ID', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13'); h.session.execute({ type: 'remove-annotation', annotationId: 'h1' });
    expect(h.text()).toContain('no longer available'); expect(h.disabled('update-annotation')).toBe(true);
    const replacement = project(score(3, { 1: harmony('h1', 'F7') }));
    h.session.replaceProject(replacement); h.editor.refresh();
    expect(h.text()).toContain('different opened document');
    click('update-annotation', true); expect(h.annotations(1)[0].text).toBe('F7');
    expect(value('annotation-text')).toBe('Cmaj13');
    expect(h.editor.dirtyCount).toBe(1);
    h.editor.reset();
    expect(h.editor.dirtyCount).toBe(0);
    expect(h.session.revision).toBe(2);
  });

  it('rejects stale handlers even when a changed target was not refreshed into the controls', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    set('annotation-text', 'Cmaj13'); h.state.autoRefresh = false;
    h.session.execute({ type: 'remove-annotation', annotationId: 'h1' });
    const before = h.session.project.sourceHtml; click('update-annotation', true);
    expect(h.session.project.sourceHtml).toBe(before); expect(h.annotations(1)).toHaveLength(0);
    expect(h.text()).toContain('no longer available');
  });

  it.each(['read', 'pages'] as const)('blocks musical mutations in %s while retaining editable inspector draft state', mode => {
    const h = fixture(); set('annotation-text', 'Dm9'); h.state.mode = mode; h.editor.refresh();
    expect(h.disabled('add-annotation')).toBe(true);
    expect(field<HTMLInputElement>('annotation-text').disabled).toBe(false);
    click('add-annotation', true); expect(h.session.revision).toBe(0);
    expect(value('annotation-text')).toBe('Dm9'); expect(h.text()).toContain('Return to Write');
  });

  it('blocks musical mutations with pending Source and preserves both drafts separately', () => {
    const h = fixture(); set('annotation-text', 'Dm9');
    const sourceDraft = h.session.project.sourceHtml.replace('C4', 'E4'); h.session.setPendingSource(sourceDraft);
    expect(h.disabled('add-annotation')).toBe(true);
    click('add-annotation', true); expect(h.annotations(1)).toHaveLength(0);
    expect(h.session.project.pendingSource).toBe(sourceDraft);
    expect(value('annotation-text')).toBe('Dm9');
    h.session.setPendingSource(null); click('add-annotation');
    expect(h.annotations(1)[0].text).toBe('Dm9');
  });

  it('preserves tempo declaration omissions and source metadata while changing only prose', () => {
    const tempo = '<music-tempo id="t1" marking="Quietly" bpm="96" at="0" placement="above" data-editor="keep"></music-tempo>';
    const h = fixture(project(score(3, { 1: tempo })), 't1');
    const acceptedNode = h.session.source.querySelector('#t1');
    set('annotation-text', 'With space'); click('update-annotation');
    const node = h.session.source.querySelector('#t1')!;
    expect(node).toBe(acceptedNode); expect(node.getAttribute('data-editor')).toBe('keep');
    expect(node.hasAttribute('beat')).toBe(false); expect(node.hasAttribute('dots')).toBe(false);
    expect(h.annotations(1)[0].bpm).toBe(96);
  });

  it('MARK-PATCH-UNTOUCHED preserves literal prose and onset when only placement changes', () => {
    const literal = '<music-harmony id="h1" at="0/2">  Cmaj9  <!--keep this source comment--></music-harmony>';
    const h = fixture(project(score(3, { 1: literal })), 'h1');
    const sourceNode = h.session.source.querySelector('#h1')!;
    const beforeChildren = sourceNode.innerHTML;
    set('annotation-placement', 'below'); click('update-annotation');
    expect(h.session.source.querySelector('#h1')).toBe(sourceNode);
    expect(sourceNode.innerHTML).toBe(beforeChildren);
    expect(sourceNode.getAttribute('at')).toBe('0/2');
    expect(sourceNode.getAttribute('placement')).toBe('below');
  });

  it('MARK-SCOPE-ONLY changes recipients in one transaction without rewriting any source', () => {
    const literal = '<music-harmony id="h1" at="0/2" text="  Cmaj9  "></music-harmony>';
    const h = fixture(project(score(3, { 1: literal })), 'h1');
    const before = h.session.project.sourceHtml;
    set('annotation-scope', 'all'); click('update-annotation');
    expect(h.session.project.sourceHtml).toBe(before);
    expect(h.session.project.instructionScopes.h1).toBe('all');
    expect(h.session.revision).toBe(1);
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(before); expect(h.session.project.instructionScopes.h1).toBeUndefined();
  });

  it('MARK-LATEST-INTENT lets an explicit Edit replace an earlier pending Add request', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') + harmony('h2', 'G7', '1/2') })), 'h1');
    set('annotation-text', 'Cmaj13'); click('add-chord-symbol'); set('annotation-select', 'h2');
    click('discard-annotation-draft');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('G7');
    expect(field('annotation-inspector').dataset.annotationMode).toBe('edit');
    expect(h.session.revision).toBe(0);
  });

  it('MARK-NEW-RECIPE keeps displayed kind, placement, and recipients when explicitly starting New', () => {
    const input = project(score(3, { 1: '<music-direction id="d1" text="Solo until cue" at="0" placement="below"></music-direction>' }));
    input.instructionScopes.d1 = 'all';
    const h = fixture(input, 'd1');
    click('new-annotation');
    expect(value('annotation-kind')).toBe('direction'); expect(value('annotation-placement')).toBe('below');
    expect(value('annotation-scope')).toBe('all'); expect(value('annotation-text')).toBe('');
    expect(h.session.revision).toBe(0);
  });

  it('requires explicit new mode before adding beside an existing instruction without overwriting it', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('add-annotation', true); expect(h.session.revision).toBe(0);
    click('new-annotation'); set('annotation-text', 'C6/9'); click('add-annotation');
    expect(h.annotations(1).map(item => item.text)).toEqual(['Cmaj9', 'C6/9']);
    expect(h.annotations(1)[0].id).toBe('h1');
    expect(h.annotations(1)[1].id).not.toBe('h1');
  });

  it('retains dirty text when choosing another existing annotation until explicit discard', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') + harmony('h2', 'G7', '1/2') })), 'h1');
    set('annotation-text', 'Cmaj13'); set('annotation-select', 'h2');
    expect(value('annotation-select')).toBe('h1'); expect(value('annotation-text')).toBe('Cmaj13');
    click('discard-annotation-draft');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('G7');
    expect(h.session.revision).toBe(0);
  });

  it('namespaces temporary form targets independently of authored source IDs', () => {
    const id = 'new-instruction:m1';
    const h = fixture(project(score(3, { 1: harmony(id, 'Cmaj9') })), id);
    h.editor.editAnnotation(id); set('annotation-text', 'Cmaj13'); click('update-annotation');
    expect(h.annotations(1)[0]).toMatchObject({ id, text: 'Cmaj13' });
  });

  it('does not reserve a chooser placeholder value that can collide with an authored annotation ID', () => {
    const h = fixture(project(score(3, { 1: harmony('__choose-instruction__', 'Cmaj9') })));
    set('annotation-select', '__choose-instruction__');
    expect(value('annotation-text')).toBe('Cmaj9');
    set('annotation-text', 'Cmaj13'); click('update-annotation');
    expect(h.annotations(1)[0]).toMatchObject({ id: '__choose-instruction__', text: 'Cmaj13' });
  });
});

describe('sustained harmony entry and intentional next-bar matching', () => {
  it('writes eight existing bars without reopening tools, resetting recipients, or appending a ninth bar', () => {
    const h = fixture(project(score(8)));
    click('add-chord-symbol'); set('annotation-placement', 'below'); set('annotation-scope', 'all');
    const texts = ['Dm9', 'G13', 'Cmaj9', 'A7alt', 'Dm11', 'G7sus', 'C6/9', 'Cmaj13'];
    for (const [index, text] of texts.entries()) {
      expect(h.context().measure.id).toBe(`m${index + 1}`);
      expect(value('annotation-kind')).toBe('harmony'); expect(value('annotation-at')).toBe('0');
      expect(value('annotation-placement')).toBe('below'); expect(value('annotation-scope')).toBe('all');
      set('annotation-text', text); click('add-annotation-next');
      expect(document.activeElement).toBe(field('annotation-text'));
    }
    expect(h.openTools).toHaveBeenCalledTimes(1);
    expect(h.session.score.staves[0].measures).toHaveLength(8);
    expect(h.session.score.staves[0].measures.map(measure => measure.annotations[0].text)).toEqual(texts);
    expect(h.session.revision).toBe(8); expect(h.text()).toContain('last existing bar');
    expect(h.editor.dirtyCount).toBe(0);
  });

  it('loads a unique next-bar symbol by ID and advances an unchanged Apply without history or DOM normalization', () => {
    const h = fixture(project(score(3, {
      1: '<music-harmony id="h1">Cmaj9</music-harmony>',
      2: '<music-harmony id="h2" at="0/2">Dm9</music-harmony>',
      3: harmony('h3', 'G13'),
    })), 'h1');
    const before = h.session.project.sourceHtml;
    field('update-annotation-next').focus(); click('update-annotation-next');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-text')).toBe('Dm9');
    expect(field('annotation-inspector').dataset.annotationMode).toBe('edit');
    expect(h.text()).toContain('Editing existing chord symbol');
    expect(h.session.project.sourceHtml).toBe(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    click('update-annotation-next');
    expect(value('annotation-select')).toBe('h3'); expect(h.session.revision).toBe(0);
    expect(h.annotations(2)).toHaveLength(1);
  });

  it('MARK-CLEAN-WHITESPACE advances pristine Apply with authored whitespace without a transaction', () => {
    const h = fixture(project(score(3, { 1: '<music-harmony id="h1" text="  Cmaj9  " at="0/2"></music-harmony>' })), 'h1');
    const before = h.session.project.sourceHtml;
    click('update-annotation-next');
    expect(h.context().measure.id).toBe('m2'); expect(h.session.revision).toBe(0);
    expect(h.session.project.sourceHtml).toBe(before); expect(h.session.canUndo).toBe(false);
  });

  it('MARK-CONCURRENT-NEW requires Keep draft as New when another matching symbol arrives during a sustained draft', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('update-annotation-next'); set('annotation-text', 'Dm9');
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '0', placement: 'above' } });
    const before = h.session.project.sourceHtml;
    expect(h.disabled('add-annotation-next')).toBe(true);
    expect(value('annotation-text')).toBe('Dm9'); expect(field('new-annotation').textContent).toContain('Keep draft as New');
    click('add-annotation-next', true); expect(h.session.project.sourceHtml).toBe(before);
    click('new-annotation'); expect(value('annotation-text')).toBe('Dm9'); click('add-annotation-next');
    expect(h.annotations(2).map(item => item.text)).toEqual(['D7', 'Dm9']); expect(h.context().measure.id).toBe('m3');
  });

  it('keeps other-onset and other-kind accepted additions unrelated to the actual sustained draft', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('update-annotation-next'); set('annotation-text', 'Solo until cue');
    set('annotation-kind', 'direction'); set('annotation-at', '1/2');
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '0', placement: 'above' } });
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'direction', text: 'Another onset', at: '0', placement: 'above' } });
    expect(h.disabled('add-annotation-next')).toBe(false);
    click('add-annotation-next');
    expect(h.annotations(2).at(-1)).toMatchObject({ kind: 'direction', text: 'Solo until cue', onset: { numerator: 1, denominator: 2 } });
  });

  it('guards matching instructions at a deliberately changed onset and placement', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('update-annotation-next'); set('annotation-text', 'Dm9');
    set('annotation-at', '1/2'); set('annotation-placement', 'below');
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '1/2', placement: 'below' } });
    expect(h.disabled('add-annotation-next')).toBe(true); expect(value('annotation-text')).toBe('Dm9');
    click('new-annotation'); click('add-annotation-next');
    expect(h.annotations(2)).toHaveLength(2);
    expect(h.annotations(2)[1]).toMatchObject({ placement: 'below', onset: { numerator: 1, denominator: 2 } });
  });

  it('does not acknowledge a newer unseen collision through the Keep draft as New action', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('update-annotation-next'); set('annotation-text', 'Dm9');
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '0', placement: 'above' } });
    h.state.autoRefresh = false;
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D11', at: '0', placement: 'above' } });
    click('new-annotation');
    expect(h.disabled('add-annotation-next')).toBe(true); expect(value('annotation-text')).toBe('Dm9');
    click('new-annotation'); expect(h.disabled('add-annotation-next')).toBe(false);
  });

  it('retains the Redo branch during a clean Apply & next navigation', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    h.session.update('Title', draft => { draft.metadata.title = 'Another title'; }); h.session.undo();
    const revision = h.session.revision;
    expect(h.session.canRedo).toBe(true); click('update-annotation-next');
    expect(h.context().measure.id).toBe('m2'); expect(h.session.revision).toBe(revision); expect(h.session.canRedo).toBe(true);
  });

  it('commits an existing symbol by its ID, then selects the next existing symbol without duplicating either', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h2', 'Dm9') })), 'h1');
    set('annotation-text', 'Cmaj13'); click('update-annotation-next');
    expect(h.annotations(1)).toHaveLength(1); expect(h.annotations(1)[0]).toMatchObject({ id: 'h1', text: 'Cmaj13' });
    expect(value('annotation-select')).toBe('h2'); expect(h.session.revision).toBe(1);
    h.session.undo(); expect(h.annotations(1)[0].text).toBe('Cmaj9');
  });

  it('accepts an explicit-part set regardless of ordering without equating it to all', () => {
    const input = project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h2', 'Dm9') }));
    input.instructionScopes = { h1: ['flute', 'reader'], h2: ['reader', 'flute'] };
    const h = fixture(input, 'h1'); click('update-annotation-next');
    expect(value('annotation-select')).toBe('h2'); expect(value('annotation-scope')).toBe('parts'); expect(h.session.revision).toBe(0);
  });

  it('requires a deliberate chooser/New decision when the only next symbol has different recipients', () => {
    const input = project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h2', 'Dm9') }));
    input.instructionScopes = { h1: 'all', h2: ['flute', 'reader'] };
    const h = fixture(input, 'h1'); click('update-annotation-next');
    expect(h.text()).toContain('different recipients'); expect(h.disabled('add-annotation')).toBe(true);
    expect(field('annotation-inspector').dataset.annotationState).toBe('choose');
    expect(document.activeElement).toBe(field('annotation-select'));
    click('add-annotation', true); expect(h.annotations(2)).toHaveLength(1);
    set('annotation-select', 'h2');
    expect(value('annotation-text')).toBe('Dm9'); expect(value('annotation-scope')).toBe('parts');
    expect(h.disabled('update-annotation')).toBe(false);
  });

  it('UX-HARMONY-CHOOSER-SCOPE distinguishes placement and recipient intent before selecting an instruction', () => {
    const input = project(score(3, {
      1: harmony('h1', 'Cmaj9'),
      2: harmony('h-all', 'Dm9') + harmony('h-staff', 'Dm9') + harmony('h-flute', 'Dm9')
        + harmony('h-reader', 'Dm9') + harmony('h-chosen-all', 'Dm9') + harmony('h-below', 'Dm9', '0', 'below'),
    }));
    input.instructionScopes = {
      h1: 'all', 'h-all': 'all', 'h-flute': ['flute'], 'h-reader': ['reader'],
      'h-chosen-all': ['reader', 'flute'], 'h-below': 'all',
    };
    const h = fixture(input, 'h1');
    const source = h.session.project.sourceHtml;
    click('update-annotation-next');
    const options = field<HTMLSelectElement>('annotation-select');
    const label = (id: string) => [...options.options].find(option => option.value === id)?.textContent ?? '';
    expect(label('h-all')).toContain('Above staff'); expect(label('h-all')).toContain('Score and all relevant parts');
    expect(label('h-staff')).toContain('Staff only: Flute');
    expect(label('h-flute')).toContain('Chosen parts: Flute part');
    expect(label('h-reader')).toContain('Chosen parts: Reader part');
    expect(label('h-chosen-all')).toContain('Chosen parts:');
    expect(label('h-chosen-all')).toContain('Flute part'); expect(label('h-chosen-all')).toContain('Reader part');
    expect(label('h-below')).toContain('Below staff');
    const labels = ['h-all', 'h-staff', 'h-flute', 'h-reader', 'h-chosen-all', 'h-below'].map(label);
    expect(new Set(labels).size).toBe(6);
    expect(field('annotation-inspector').dataset.annotationState).toBe('choose');
    expect(options.firstElementChild?.localName).toBe('button');
    expect(h.session.project.sourceHtml).toBe(source); expect(h.session.revision).toBe(0);
  });

  it('UX-HARMONY-CHOOSER-SCOPE disambiguates chosen parts even when their displayed names are identical', () => {
    const input = project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h-flute', 'Dm9') + harmony('h-reader', 'Dm9') }));
    input.parts.forEach(part => { part.label = 'Lead'; });
    input.instructionScopes = { 'h-flute': ['flute'], 'h-reader': ['reader'] };
    const h = fixture(input, 'h1'); click('update-annotation-next');
    const options = field<HTMLSelectElement>('annotation-select');
    const first = [...options.options].find(option => option.value === 'h-flute')!.textContent!;
    const second = [...options.options].find(option => option.value === 'h-reader')!.textContent!;
    expect(first).toContain('Chosen parts: Lead'); expect(second).toContain('Chosen parts: Lead');
    expect(first).not.toBe(second);
    expect(h.session.revision).toBe(0);
  });

  it('MARK-IDENTICAL-CHOICE identifies only colliding complete labels and loads either exact ID without history changes', () => {
    const input = project(score(3, { 1: harmony('h-duplicate-one', 'Dm9') + harmony('h-duplicate-two', 'Dm9') + harmony('h-unique', 'G13') }));
    input.instructionScopes = { 'h-duplicate-one': 'all', 'h-duplicate-two': 'all', 'h-unique': 'all' };
    const h = fixture(input);
    h.session.update('Prepare redo history', draft => { draft.metadata.title = 'Another title'; }); h.session.undo();
    const source = h.session.project.sourceHtml;
    const revision = h.session.revision;
    const options = field<HTMLSelectElement>('annotation-select');
    const label = (id: string) => [...options.options].find(option => option.value === id)!.textContent!;
    expect(label('h-duplicate-one')).toContain('h-duplicate-one');
    expect(label('h-duplicate-two')).toContain('h-duplicate-two');
    expect(label('h-duplicate-one')).not.toBe(label('h-duplicate-two'));
    expect(label('h-unique')).toBe('chord symbol · G13 · at 0 · Above staff · Score and all relevant parts');
    for (const id of ['h-duplicate-one', 'h-duplicate-two']) {
      set('annotation-select', id);
      expect(value('annotation-select')).toBe(id);
      expect(h.context().annotation?.id).toBe(id);
      expect(h.session.selectionId).toBe(id);
      expect(value('annotation-text')).toBe('Dm9');
      expect(h.session.project.sourceHtml).toBe(source);
      expect(h.session.revision).toBe(revision);
      expect(h.session.canUndo).toBe(false); expect(h.session.canRedo).toBe(true);
    }
  });

  it('does not guess between several matching symbols even when one matches recipients', () => {
    const input = project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h2', 'Dm9') + harmony('h3', 'D7') }));
    input.instructionScopes = { h1: 'all', h2: 'all', h3: ['flute'] };
    const h = fixture(input, 'h1'); click('update-annotation-next');
    expect(h.text()).toContain('several matching instructions');
    expect(h.disabled('add-annotation-next')).toBe(true);
    click('new-annotation'); set('annotation-text', 'Dm11'); click('add-annotation');
    expect(h.annotations(2).map(item => item.text)).toEqual(['Dm9', 'D7', 'Dm11']);
    expect(h.session.project.instructionScopes[h.annotations(2)[2].id]).toBe('all');
  });

  it('does not match another onset, placement, or kind, and can add a second change in one bar', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9'), 2: harmony('h2', 'Dm9', '1/2') + harmony('h3', 'D7', '0', 'below') })), 'h1');
    click('update-annotation-next'); expect(field('annotation-inspector').dataset.annotationMode).toBe('new');
    set('annotation-text', 'G13'); click('add-annotation');
    expect(h.annotations(2)).toHaveLength(3);
    click('new-annotation'); set('annotation-at', '3/4'); set('annotation-text', 'Cmaj9'); click('add-annotation');
    expect(h.annotations(2).map(item => formatRational(item.onset))).toContain('3/4');
  });

  it('retains a Solo until cue direction as prose and keeps its chosen scope and placement across next bars', () => {
    const h = fixture(); set('annotation-kind', 'direction'); set('annotation-scope', 'all'); set('annotation-placement', 'below');
    set('annotation-text', 'Solo until cue'); click('add-annotation-next');
    expect(h.annotations(1)[0]).toMatchObject({ kind: 'direction', text: 'Solo until cue' });
    expect(value('annotation-kind')).toBe('direction'); expect(value('annotation-placement')).toBe('below');
    expect(value('annotation-scope')).toBe('all'); expect(value('annotation-text')).toBe('');
    expect(h.session.score.staves[0].measures[0].voices[0].events).toHaveLength(2);
  });

  it.each([
    { text: '', at: '0' }, { text: 'Dm9', at: '5/4' }, { text: 'Dm9', at: '1/0' }, { text: 'Dm9', at: '0.25' },
  ])('keeps text, target, source, and history unchanged when Add & next rejects $text at $at', ({ text, at }) => {
    const h = fixture(); const before = h.session.project.sourceHtml;
    set('annotation-text', text); set('annotation-at', at); click('add-annotation-next');
    expect(h.context().measure.id).toBe('m1'); expect(value('annotation-text')).toBe(text); expect(value('annotation-at')).toBe(at);
    expect(h.session.project.sourceHtml).toBe(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    expect(field('annotation-draft-status').getAttribute('role')).toBe('alert');
  });

  it('rejects an empty chosen-parts list without advancing or creating an instruction', () => {
    const h = fixture(); set('annotation-text', 'Dm9'); set('annotation-scope', 'parts'); click('add-annotation-next');
    expect(h.text()).toContain('at least one part'); expect(h.context().measure.id).toBe('m1'); expect(h.annotations(1)).toHaveLength(0);
  });

  it('MARK-RECIPIENT-IDENTITY names duplicate and unnamed recipient checkboxes without retargeting the draft or writing on refresh', () => {
    const lower = `<music-staff id="other" label="Piano">${[1, 2, 3].map(number => `<music-measure id="other${number}" number="${number}"><music-rest id="other-rest${number}" measure></music-rest></music-measure>`).join('')}</music-staff>`;
    const input = createProject(`<music-system id="system">${score(3)}${lower}</music-system>`, 'Recipient identity', [
      { id: 'lead-flute', label: 'Lead', staffIds: ['staff'] },
      { id: 'lead-piano', label: 'Lead', staffIds: ['other'] },
      { id: 'unnamed-ensemble', label: '', staffIds: ['staff', 'other'] },
    ]);
    const h = fixture(input);
    const source = h.session.project.sourceHtml;
    set('annotation-text', 'Solo until cue'); set('annotation-scope', 'parts');
    const recipients = () => [...field('annotation-part-scopes').querySelectorAll<HTMLInputElement>('input')];
    const label = (id: string) => recipients().find(item => item.value === id)!.closest('label')!.textContent;
    expect(label('lead-flute')).toBe('Lead (lead-flute)');
    expect(label('lead-piano')).toBe('Lead (lead-piano)');
    expect(label('unnamed-ensemble')).toBe('unnamed-ensemble');
    const chosen = recipients().find(item => item.value === 'lead-piano')!;
    chosen.checked = true; chosen.dispatchEvent(new Event('change', { bubbles: true }));
    h.selectId('n3a'); h.editor.refresh(); h.editor.refresh();
    expect(recipients().filter(item => item.checked).map(item => item.value)).toEqual(['lead-piano']);
    expect(value('annotation-text')).toBe('Solo until cue');
    expect(field('annotation-draft-target').textContent).toContain('bar 1');
    expect(h.session.project.sourceHtml).toBe(source); expect(h.session.revision).toBe(0);
    expect(h.session.canUndo).toBe(false);
    click('add-annotation');
    expect(h.session.project.instructionScopes[h.annotations(1)[0].id]).toEqual(['lead-piano']);
    expect(h.annotations(3)).toHaveLength(0);
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(source);
  });

  it('retains a removed chosen recipient visibly and rejects it until recipients are explicitly changed', () => {
    const h = fixture(); set('annotation-text', 'Dm9'); set('annotation-scope', 'parts');
    const part = field('annotation-part-scopes').querySelector<HTMLInputElement>('input[value="reader"]')!;
    part.checked = true; part.dispatchEvent(new Event('change', { bubbles: true }));
    h.session.update('Remove part', draft => { draft.parts = draft.parts.filter(item => item.id !== 'reader'); delete draft.layouts.reader; });
    expect(field('annotation-part-scopes').textContent).toContain('Missing part (reader)');
    click('add-annotation-next'); expect(h.annotations(1)).toHaveLength(0); expect(h.context().measure.id).toBe('m1');
    set('annotation-scope', 'staff'); click('add-annotation-next'); expect(h.annotations(1)[0].text).toBe('Dm9');
  });

  it('MARK-INTENDED-RECIPIENTS reviews membership changes to a newly chosen part, not unrelated parts', () => {
    const lower = `<music-staff id="other" label="Piano">${[1, 2, 3].map(number => `<music-measure id="other${number}" number="${number}"><music-rest id="other-rest${number}" measure></music-rest></music-measure>`).join('')}</music-staff>`;
    const h = fixture(project(`<music-system id="system">${score(3)}${lower}</music-system>`));
    set('annotation-kind', 'direction'); set('annotation-text', 'Solo until cue'); set('annotation-scope', 'parts');
    const part = field('annotation-part-scopes').querySelector<HTMLInputElement>('input[value="reader"]')!;
    part.checked = true; part.dispatchEvent(new Event('change', { bubbles: true }));
    h.session.update('Change unrelated part', draft => { draft.parts.find(item => item.id === 'flute')!.staffIds = ['other']; });
    expect(h.disabled('add-annotation')).toBe(false);
    h.session.update('Change chosen part', draft => { draft.parts.find(item => item.id === 'reader')!.staffIds = ['other']; });
    expect(h.disabled('add-annotation')).toBe(true);
    expect(h.text()).toContain('Piano'); expect(value('annotation-text')).toBe('Solo until cue');
    click('add-annotation', true); expect(h.annotations(1)).toHaveLength(0);
    click('review-annotation-draft'); expect(h.disabled('add-annotation')).toBe(false);
    click('add-annotation'); expect(h.annotations(1)[0].text).toBe('Solo until cue');
    expect(h.session.project.instructionScopes[h.annotations(1)[0].id]).toEqual(['reader']);
    h.session.undo(); expect(h.annotations(1)).toHaveLength(0);
    expect(h.session.project.parts.find(item => item.id === 'reader')!.staffIds).toEqual(['other']);
  });

  it('can recover a deleted recipient while a sustained New collision is awaiting a choice', () => {
    const h = fixture(project(score(3, { 1: harmony('h1', 'Cmaj9') })), 'h1');
    click('update-annotation-next'); set('annotation-text', 'Dm9'); set('annotation-scope', 'parts');
    const part = field('annotation-part-scopes').querySelector<HTMLInputElement>('input[value="reader"]')!;
    part.checked = true; part.dispatchEvent(new Event('change', { bubbles: true }));
    h.session.execute({ type: 'add-annotation', measureId: 'm2', value: { kind: 'harmony', text: 'D7', at: '0', placement: 'above' } });
    h.session.update('Remove chosen part', draft => { draft.parts = draft.parts.filter(item => item.id !== 'reader'); delete draft.layouts.reader; });
    expect(field<HTMLSelectElement>('annotation-scope').disabled).toBe(false);
    set('annotation-scope', 'staff'); click('new-annotation');
    expect(value('annotation-text')).toBe('Dm9'); expect(h.disabled('add-annotation-next')).toBe(false);
    click('add-annotation-next'); expect(h.annotations(2)).toHaveLength(2);
  });

  it('removes the annotation and its scope atomically, and blocks removing a dirty form', () => {
    const input = project(score(3, { 1: harmony('h1', 'Cmaj9') })); input.instructionScopes.h1 = 'all';
    const h = fixture(input, 'h1'); set('annotation-text', 'Cmaj13'); click('remove-annotation', true);
    expect(h.annotations(1)).toHaveLength(1); expect(h.session.revision).toBe(0);
    click('discard-annotation-draft'); click('remove-annotation');
    expect(h.annotations(1)).toHaveLength(0); expect(h.session.project.instructionScopes.h1).toBeUndefined();
    h.session.undo(); expect(h.annotations(1)[0].text).toBe('Cmaj9'); expect(h.session.project.instructionScopes.h1).toBe('all');
  });

  it('disposes all controller listeners and stops refresh mutations', () => {
    const h = fixture(); h.editor.dispose();
    set('annotation-text', 'Dm9'); click('add-annotation'); click('add-chord-symbol'); h.editor.refresh();
    expect(h.session.revision).toBe(0); expect(h.openTools).not.toHaveBeenCalled(); expect(h.editor.dirtyCount).toBe(0);
  });
});
