// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext, InspectorFormName } from '../src/authoring/inspector-forms.js';
import { createProject } from '../src/authoring/project.js';
import type { EventInput } from '../src/authoring/types.js';

const cleanups: (() => void)[] = [];
const durationOptions = 'breve whole half quarter eighth sixteenth thirty-second sixty-fourth 128th';
const select = (id: string, options: string) => `<label for="${id}">${id}<select id="${id}"><button type="button"><selectedcontent></selectedcontent></button>${options.split(' ').map(value => `<option value="${value}">${value || 'New'}</option>`).join('')}</select></label>`;
const input = (id: string, check = false) => `<label for="${id}">${id}<input id="${id}" ${check ? 'type="checkbox"' : 'type="text"'} /></label>`;
const button = (id: string) => `<button id="${id}" type="button">${id}</button>`;
const note = (id: string, pitch = 'F4', duration = 'quarter') => `<music-note id="${id}" pitch="${pitch}" duration="${duration}"></music-note>`;
const music = `<music-system id="score"><music-staff id="upper" label="Flute" key="G">
  <music-measure id="a" number="12" incomplete>${note('n1')}${note('n2', 'G4')}</music-measure>
  <music-measure id="b" number="13" incomplete>${note('n3', 'A4')}${note('n4', 'B4')}</music-measure>
  </music-staff><music-staff id="lower" label="Bass" clef="bass">
  <music-measure id="c" number="12" incomplete>${note('bass1', 'C3')}</music-measure>
  <music-measure id="d" number="13" incomplete>${note('bass2', 'D3')}</music-measure>
  </music-staff></music-system>`;

function markup(): string {
  return `<input id="event-pitch" value="Bb5"><input id="event-duration" value="eighth">
  <section id="selection-inspector"><div class="inspector-content"><p id="event-form-context"></p>
    ${select('selected-kind', 'note chord rest slash rhythmic-slash rhythm')}
    <div id="selected-pitch-field">${input('selected-pitch')}</div><div id="selected-pitches-field">${input('selected-pitches')}</div>
    ${select('selected-duration', durationOptions)}${select('selected-dots', '0 1 2 3')}
    <div id="selected-slash-field">${input('selected-rhythmic', true)}</div><div id="selected-measure-rest-field">${input('selected-measure-rest', true)}</div>
    ${select('selected-accidental-display', 'auto always courtesy')}${select('selected-stem', 'auto up down')}${select('selected-beam', 'auto start continue end none')}
    ${button('update-event')}${button('load-event-values')}</div></section>
  <section id="measure-inspector"><div class="inspector-content">${input('measure-meter')}${input('measure-groups')}${input('measure-key')}
    ${select('measure-clef', 'treble bass alto tenor')}${select('measure-end-bar', 'single double final repeat-end none')}
    ${input('measure-pickup', true)}${input('measure-incomplete', true)}${input('measure-repeat-start', true)}${button('apply-measure')}</div></section>
  <section id="staff-inspector"><div class="inspector-content">${input('staff-label')}${select('staff-clef', 'treble bass alto tenor')}${input('staff-key')}
    ${select('staff-notation', 'pitched rhythm')}${button('apply-staff')}${button('add-staff')}</div></section>
  <section id="part-inspector"><div class="inspector-content">${input('part-label')}<div id="part-staves"></div>${button('add-part')}${button('update-part')}</div></section>
  <section id="paper-inspector"><div class="inspector-content">${select('page-paper', 'letter a4')}${select('page-orientation', 'portrait landscape')}
    ${input('page-margin')}${input('page-scale')}${input('page-max-measures')}${select('page-measure-numbers', 'system all none')}${input('page-justify-last', true)}${button('apply-pages')}</div></section>
  <section id="break-inspector"><div class="inspector-content">${select('layout-break', 'auto line page')}${input('layout-keep', true)}${button('apply-break')}</div></section>
  <section id="tuplet-inspector"><div class="inspector-content">${select('tuplet-select', ' ')}${input('tuplet-actual')}${input('tuplet-normal')}
    ${select('tuplet-bracket', 'auto yes no')}${input('tuplet-ratio', true)}${button('wrap-tuplet')}${button('update-tuplet')}${button('unwrap-tuplet')}</div></section>`;
}

function el<T extends HTMLElement = HTMLInputElement>(id: string): T { return document.getElementById(id) as T; }
function value(id: string): string { return el<HTMLInputElement>(id).value; }
function edit(id: string, value: string | boolean): void {
  const field = el<HTMLInputElement>(id);
  if (typeof value === 'boolean') field.checked = value; else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function pickStaff(id: string, checked: boolean): void {
  const field = [...el('part-staves').querySelectorAll<HTMLInputElement>('input')].find(input => input.value === id)!;
  field.checked = checked; field.dispatchEvent(new Event('change', { bubbles: true }));
}
function chosenStaves(): string[] { return [...el('part-staves').querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value); }

function fixture(source = music) {
  document.body.innerHTML = markup();
  const project = createProject(source, 'Form fixture', [
    { id: 'flute-part', label: 'Flute part', staffIds: ['upper'] },
    ...(source.includes('id="lower"') ? [{ id: 'bass-part', label: 'Bass part', staffIds: ['lower'] }] : []),
  ]);
  const session = new EditorSession(project);
  const context: InspectorContext = { mode: 'write', partId: 'score', cursor: { staffId: 'upper', measureId: 'a', voiceIndex: 0, eventId: 'n1' }, selectionId: 'n1', rangeEventIds: ['n1'] };
  session.select('n1');
  const report = vi.fn(); const changed = vi.fn();
  let forms: InspectorForms;
  const selectSource = vi.fn((id: string) => {
    context.selectionId = id; context.rangeEventIds = [];
    for (const staff of session.score.staves) for (const measure of staff.measures) for (const [voiceIndex, voice] of measure.voices.entries()) {
      const event = voice.events.find(item => item.id === id);
      if (event || voice.tuplets.some(item => item.id === id) || measure.id === id || staff.id === id) {
        context.cursor = { staffId: staff.id, measureId: measure.id, voiceIndex, ...(event ? { eventId: id } : {}) };
        context.rangeEventIds = event ? [id] : [];
        session.select(id); forms?.refresh(); return;
      }
    }
    session.select(id); forms?.refresh();
  });
  const returnTarget = vi.fn(({ context: targetContext }: Parameters<NonNullable<ConstructorParameters<typeof InspectorForms>[0]['returnTarget']>>[0]) => {
    if (targetContext.partId) context.partId = targetContext.partId;
    if (targetContext.sourceId) selectSource(targetContext.sourceId);
    forms.refresh();
  });
  forms = new InspectorForms({ session, context: () => context, select: selectSource, returnTarget, onDraftChange: changed, report });
  const listener = () => forms.refresh();
  session.addEventListener('change', listener);
  cleanups.push(() => { session.removeEventListener('change', listener); forms.dispose(); });
  return { forms, session, context, selectSource, returnTarget, report, changed };
}

const entered: EventInput = { kind: 'note', pitch: 'C5', pitches: 'C5 E5 G5', duration: 'eighth', dots: 0, rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };
function applySelected(h: ReturnType<typeof fixture>): void {
  const resolved = h.forms.resolve('selected');
  const fields = resolved.values;
  if (resolved.changed) h.session.execute({ type: 'update-event', eventId: resolved.targetId, value: {
    kind: fields.kind === 'rhythmic-slash' ? 'slash' : fields.kind as EventInput['kind'], pitch: String(fields.pitch), pitches: String(fields.pitches),
    duration: fields.duration as EventInput['duration'], dots: Number(fields.dots), rhythmic: fields.kind === 'rhythmic-slash',
    measureRest: Boolean(fields.measureRest), accidentalDisplay: fields.accidentalDisplay as EventInput['accidentalDisplay'],
    stem: fields.stem as EventInput['stem'], beam: fields.beam as EventInput['beam'],
  } });
  h.forms.commit('selected');
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

describe('inspector DOM drafts', () => {
  it('loads accepted values for all clean forms without adding history', () => {
    const h = fixture();
    expect(value('selected-pitch')).toBe('F4'); expect(value('selected-duration')).toBe('quarter');
    expect(value('measure-meter')).toBe('4/4'); expect(value('measure-key')).toBe('G');
    expect(value('staff-label')).toBe('Flute'); expect(value('page-margin')).toBe('15');
    expect(chosenStaves()).toEqual(['upper']); expect(value('tuplet-actual')).toBe('3');
    expect(h.forms.dirtyCount).toBe(0); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('follows clean selection without copying into the independent insertion recipe', () => {
    const h = fixture(); h.selectSource('n3');
    expect(value('selected-pitch')).toBe('A4'); expect(h.forms.snapshot('measure').targetId).toBe('b');
    expect(value('event-pitch')).toBe('Bb5'); expect(value('event-duration')).toBe('eighth');
    expect(h.forms.snapshot('selected').dirty).toBe(false); expect(h.session.canUndo).toBe(false);
  });

  it('requires an exact single event, including a one-item range that differs from the cursor', () => {
    const h = fixture(); h.context.rangeEventIds = ['n2']; h.forms.refresh();
    expect(h.forms.snapshot('selected').targetId).toBeNull(); expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(true);
    expect(() => h.forms.resolve('selected')).toThrow('Select a target');
    h.context.rangeEventIds = ['n1', 'n2']; h.forms.refresh(); expect(h.forms.snapshot('selected').targetId).toBeNull();
  });

  it('keeps a dirty selected event and requires Return before applying to it', () => {
    const h = fixture(); edit('selected-pitch', 'F#4'); h.selectSource('n3');
    expect(value('selected-pitch')).toBe('F#4'); expect(h.forms.snapshot('selected').targetId).toBe('n1');
    expect(h.forms.snapshot('selected').canApply).toBe(false); expect(el<HTMLButtonElement>('return-selected-draft').hidden).toBe(false);
    expect(() => h.forms.resolve('selected')).toThrow('Return to this draft');
    el('return-selected-draft').click(); expect(h.context.selectionId).toBe('n1');
    applySelected(h); expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('F#4');
    expect(h.session.source.querySelector('#n3')?.getAttribute('pitch')).toBe('A4');
    expect(h.forms.dirtyCount).toBe(0); expect(h.session.revision).toBe(1);
  });

  it('preserves simultaneous drafts across selection and an unrelated title change', () => {
    const h = fixture(); edit('measure-end-bar', 'double'); edit('staff-label', 'Solo flute');
    h.selectSource('n3'); h.session.update('Title', project => { project.metadata.title = 'Next title'; });
    expect(h.forms.dirtyCount).toBe(2); expect(value('measure-end-bar')).toBe('double'); expect(value('staff-label')).toBe('Solo flute');
    expect(h.forms.snapshot('measure').targetId).toBe('a'); expect(h.forms.snapshot('measure').status).toBe('dirty');
    expect(h.forms.resolve('measure').targetId).toBe('a'); expect(h.forms.snapshot('staff').status).toBe('dirty');
  });

  it('merges untouched accepted fields rather than replacing them with an old form snapshot', () => {
    const h = fixture(); edit('measure-end-bar', 'double');
    h.session.execute({ type: 'set-measure', measureId: 'a', values: { key: 'D' } });
    const resolved = h.forms.resolve('measure');
    expect(resolved.patch).toEqual({ endBar: 'double' }); expect(resolved.values.key).toBe('D'); expect(value('measure-key')).toBe('D');
    expect(resolved.values.endBar).toBe('double'); expect(h.forms.snapshot('measure').status).toBe('dirty');
  });

  it('does not invalidate a meter draft when an unrelated bar or its pitch changes', () => {
    const h = fixture(); edit('measure-meter', '3/4');
    h.session.execute({ type: 'insert-event', cursor: { staffId: 'upper', measureId: 'b', voiceIndex: 0, eventId: 'n4' }, position: 'after', value: entered });
    h.session.execute({ type: 'set-note-pitch', eventId: 'n2', pitch: 'A4', ties: 'reject' });
    expect(h.forms.snapshot('measure').status).toBe('dirty'); expect(h.forms.resolve('measure').values.meter).toBe('3/4');
  });

  it('detects relevant rhythm changes in hidden staves before applying an aligned meter draft', () => {
    const h = fixture(); edit('measure-meter', '3/4');
    h.session.execute({ type: 'set-event-rhythm', eventId: 'bass1', duration: 'half', dots: 0 });
    expect(h.forms.snapshot('measure').status).toBe('conflict'); expect(value('measure-meter')).toBe('3/4');
    expect(() => h.forms.resolve('measure')).toThrow('Review');
    expect(el('measure-draft-status').textContent).toContain('musical context that changed');
    expect(el<HTMLButtonElement>('review-measure-draft').hidden).toBe(false);
  });

  it('shows accepted and draft values, then rebases only after explicit review', () => {
    const h = fixture(); edit('measure-end-bar', 'double');
    h.session.execute({ type: 'set-measure', measureId: 'a', values: { endBar: 'final' } });
    expect(el('measure-draft-status').textContent).toContain('accepted final; draft double');
    const revision = h.session.revision;
    el('review-measure-draft').click();
    expect(h.forms.snapshot('measure').status).toBe('dirty'); expect(value('measure-end-bar')).toBe('double');
    expect(h.forms.resolve('measure').patch).toEqual({ endBar: 'double' }); expect(h.session.revision).toBe(revision);
    expect(document.activeElement).toBe(el('apply-measure'));
  });

  it('never falls back after the original measure is deleted', () => {
    const h = fixture(); edit('measure-end-bar', 'double'); h.selectSource('n3');
    h.session.execute({ type: 'remove-measure', measureId: 'a' });
    expect(h.forms.snapshot('measure').status).toBe('missing'); expect(h.forms.snapshot('measure').targetId).toBe('a');
    expect(value('measure-end-bar')).toBe('double'); expect(() => h.forms.resolve('measure')).toThrow('no longer available');
    expect(el<HTMLButtonElement>('return-measure-draft').disabled).toBe(true);
    el('discard-measure-draft').click(); expect(h.forms.snapshot('measure').targetId).toBe('b'); expect(value('measure-end-bar')).toBe('single');
  });

  it('guards the opened document identity even when a replacement reuses every source ID', () => {
    const h = fixture(); edit('selected-pitch', 'F#4');
    h.session.replaceProject(createProject(music, 'Other project'));
    expect(h.forms.snapshot('selected').status).toBe('document-changed');
    expect(value('selected-pitch')).toBe('F#4'); expect(() => h.forms.resolve('selected')).toThrow('different opened document');
    expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('F4');
    h.forms.reset(); expect(h.forms.dirtyCount).toBe(0); expect(value('selected-pitch')).toBe('F4');
  });

  it('keeps a selected pitch draft through unrelated rhythm changes and merges their accepted value', () => {
    const h = fixture(); edit('selected-pitch', 'F#4');
    h.session.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 0 });
    const resolved = h.forms.resolve('selected'); expect(resolved.patch).toEqual({ pitch: 'F#4' });
    expect(resolved.values.duration).toBe('eighth'); applySelected(h);
    expect(h.session.source.querySelector('#n1')?.getAttribute('duration')).toBe('eighth');
  });

  it('invalidates a written-duration draft when another event changes its available time', () => {
    const h = fixture(); edit('selected-duration', 'half');
    h.session.execute({ type: 'set-event-rhythm', eventId: 'n2', duration: 'half', dots: 0 });
    expect(h.forms.snapshot('selected').status).toBe('conflict'); expect(value('selected-duration')).toBe('half');
    expect(() => h.forms.resolve('selected')).toThrow('Review');
  });

  it('clears only a draft field already satisfied by an accepted immediate change', () => {
    const h = fixture(); edit('selected-pitch', 'F#4'); edit('selected-stem', 'up');
    h.session.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'F#4', ties: 'reject' });
    expect(h.forms.snapshot('selected').dirtyFields).toEqual(['stem']); expect(h.forms.snapshot('selected').status).toBe('dirty');
    expect(h.forms.resolve('selected').patch).toEqual({ stem: 'up' });
  });

  it('treats unchanged Apply as a no-op without adding an undo step', () => {
    const h = fixture(); const resolved = h.forms.resolve('selected');
    expect(resolved.changed).toBe(false); expect(resolved.patch).toEqual({});
    expect(el<HTMLButtonElement>('update-event').disabled).toBe(true); applySelected(h);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('retains rejected fields and a local error through unrelated refreshes', () => {
    const h = fixture(); edit('selected-duration', 'whole');
    expect(() => applySelected(h)).toThrow(); h.forms.markFailure('selected', new Error('The chosen value exceeds this voice.'));
    const accepted = h.session.project.sourceHtml;
    h.session.update('Title', project => { project.metadata.title = 'Title after rejection'; });
    expect(value('selected-duration')).toBe('whole'); expect(el('selected-draft-status').textContent).toContain('exceeds this voice');
    expect(h.session.project.sourceHtml).toBe(accepted); edit('selected-duration', 'eighth');
    expect(h.forms.snapshot('selected').error).toBeNull();
  });

  it('keeps grouped checkbox choices through new labels, selection, and title changes', () => {
    const h = fixture(); h.context.partId = 'flute-part'; h.forms.refresh();
    pickStaff('lower', true); edit('part-label', 'Duo');
    h.context.partId = 'bass-part'; h.selectSource('bass2');
    h.session.execute({ type: 'set-staff', staffId: 'lower', label: 'Double bass', clef: 'bass', key: 'C' });
    h.session.update('Title', project => { project.metadata.title = 'Duo study'; });
    expect(chosenStaves()).toEqual(['upper', 'lower']); expect(value('part-label')).toBe('Duo');
    expect(el('part-staves').textContent).toContain('Double bass');
    const resolved = h.forms.resolve('part'); expect(resolved.targetId).toBe('flute-part');
    expect(resolved.patch).toEqual({ staffIds: ['upper', 'lower'], label: 'Duo' });
  });

  it('binds a new part draft and consumes it only after successful creation', () => {
    const h = fixture(); edit('part-label', 'New duo'); pickStaff('lower', true);
    expect(h.forms.snapshot('part').context?.creating).toBe(true);
    const resolved = h.forms.resolve('part');
    h.session.update('Create part', project => {
      project.parts.push({ id: 'duo', label: String(resolved.values.label), staffIds: resolved.values.staffIds as string[] });
      project.layouts.duo = structuredClone(project.layouts.score);
    });
    h.context.partId = 'duo'; h.forms.consume('part');
    expect(h.forms.snapshot('part').targetId).toBe('duo'); expect(h.forms.snapshot('part').dirty).toBe(false);
    expect(value('part-label')).toBe('New duo'); expect(chosenStaves()).toEqual(['upper', 'lower']);
  });

  it('keeps creation targets distinct from imported part IDs that resemble internal prefixes', () => {
    const h = fixture();
    h.session.update('Rename identifier', project => {
      project.parts[0].id = 'new-part:upper'; project.layouts['new-part:upper'] = project.layouts['flute-part']; delete project.layouts['flute-part'];
    });
    h.context.partId = 'new-part:upper'; h.forms.refresh();
    expect(value('part-label')).toBe('Flute part'); expect(h.forms.snapshot('part').context?.creating).toBeUndefined();
    h.context.partId = 'score'; h.forms.refresh(); edit('part-label', 'Another part');
    expect(h.forms.snapshot('part').targetId).not.toBe('new-part:upper'); expect(h.forms.resolve('part').context.creating).toBe(true);
  });

  it('keeps page drafts on their original part and preserves accepted untouched settings', () => {
    const h = fixture(); h.context.mode = 'pages'; h.context.partId = 'flute-part'; h.forms.refresh(); edit('page-margin', '22');
    h.context.partId = 'bass-part'; h.forms.refresh();
    h.session.update('Paper', project => { project.layouts['flute-part'].paper = 'a4'; });
    const resolved = h.forms.resolve('page');
    expect(resolved.targetId).toBe('flute-part'); expect(resolved.context.partId).toBe('flute-part');
    expect(resolved.patch).toEqual({ marginMm: '22' }); expect(value('page-paper')).toBe('a4');
    el('return-page-draft').click(); expect(h.context.partId).toBe('flute-part');
  });

  it('reads canonical source boundaries from hidden staves instead of only the visible staff', () => {
    const source = music.replace('id="c" number="12"', 'id="c" number="12" break-before="page" keep-with-next');
    const h = fixture(source); h.context.mode = 'pages'; h.context.partId = 'flute-part'; h.forms.refresh();
    expect(value('layout-break')).toBe('page'); expect(el<HTMLInputElement>('layout-keep').checked).toBe(true);
    edit('layout-break', 'line'); const resolved = h.forms.resolve('boundary');
    expect(resolved.context.partId).toBe('flute-part'); expect(resolved.context.measureId).toBe('a');
    expect(resolved.context.columnId).toBe(h.session.project.columns[0].id);
  });

  it('retains a page boundary draft through navigation and uses its bound column on Apply', () => {
    const h = fixture(); h.context.mode = 'pages'; h.forms.refresh(); edit('layout-break', 'line');
    const columnId = h.session.project.columns[0].id; h.selectSource('n3');
    const resolved = h.forms.resolve('boundary'); expect(resolved.context.columnId).toBe(columnId);
    h.session.update('Boundary', project => { project.layouts[resolved.context.partId!].breaks[resolved.context.columnId!] = resolved.values.breakBefore as 'line'; });
    h.forms.commit('boundary');
    expect(h.session.project.layouts.score.breaks[columnId]).toBe('line');
    expect(h.forms.snapshot('boundary').context?.measureId).toBe('b');
  });

  it.each(['remove', 'move'] as const)('DRAFT-KEEP-NEIGHBOR: reviews Keep with next when its named next column changes by %s', change => {
    const threeBars = music.replace('</music-staff><music-staff id="lower"', `<music-measure id="e" number="14" incomplete>${note('n5', 'C5')}</music-measure></music-staff><music-staff id="lower"`)
      .replace('</music-staff></music-system>', `<music-measure id="f" number="14" incomplete>${note('bass3', 'E3')}</music-measure></music-staff></music-system>`);
    const h = fixture(threeBars); h.context.mode = 'pages'; h.forms.refresh(); edit('layout-keep', true);
    const nextBefore = h.session.project.columns[1].id;
    h.session.execute(change === 'remove' ? { type: 'remove-measure', measureId: 'b' } : { type: 'move-measure', measureId: 'b', direction: 1 });
    expect(h.session.project.columns[1].id).not.toBe(nextBefore);
    expect(h.forms.snapshot('boundary').status).toBe('conflict');
    expect(h.forms.snapshot('boundary').conflicts.map(conflict => conflict.field)).toContain('keepWithNext');
    expect(el<HTMLInputElement>('layout-keep').checked).toBe(true);
    expect(() => h.forms.resolve('boundary')).toThrow('Review');
  });

  it('DRAFT-KEEP-NEIGHBOR: treats appending a new next column after a former last bar as a relevant change', () => {
    const h = fixture(); h.context.mode = 'pages'; h.selectSource('n3'); edit('layout-keep', true);
    h.session.execute({ type: 'append-measure', afterMeasureId: 'b' });
    expect(h.forms.snapshot('boundary').status).toBe('conflict');
    expect(h.forms.snapshot('boundary').targetId).toBe(JSON.stringify(['score', h.session.project.columns[1].id]));
    expect(() => h.forms.resolve('boundary')).toThrow('Review');
  });

  it('DRAFT-KEEP-NEIGHBOR: an independent start-line choice survives a changed next column', () => {
    const h = fixture(); h.context.mode = 'pages'; h.forms.refresh(); edit('layout-break', 'line');
    h.session.execute({ type: 'remove-measure', measureId: 'b' });
    expect(h.forms.snapshot('boundary').status).toBe('dirty');
    expect(h.forms.resolve('boundary').patch).toEqual({ breakBefore: 'line' });
  });

  it('keeps written tuplet parameters and source IDs while a different bar is selected', () => {
    const source = music.replace(note('n1') + note('n2', 'G4'), `<music-tuplet id="trip" actual="3" normal="2">${note('n1')}${note('n2', 'G4')}</music-tuplet>`);
    const h = fixture(source); h.selectSource('trip');
    expect(value('tuplet-actual')).toBe('3'); expect(value('tuplet-normal')).toBe('2');
    edit('tuplet-actual', '5'); h.selectSource('n3');
    const resolved = h.forms.resolve('tuplet'); expect(resolved.targetId).toBe('trip');
    expect(resolved.context.eventIds).toEqual(['n1', 'n2']); expect(value('tuplet-select')).toBe('trip');
    const picker = el<HTMLSelectElement>('tuplet-select');
    expect(picker.firstElementChild?.tagName).toBe('BUTTON'); expect(picker.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect([...picker.options].every(option => option.hasAttribute('value'))).toBe(true);
  });

  it('binds a new tuplet to its actual event IDs rather than a later passage selection', () => {
    const h = fixture(); h.context.rangeEventIds = ['n1', 'n2']; h.forms.refresh(); edit('tuplet-actual', '5');
    h.selectSource('n3'); const resolved = h.forms.resolve('tuplet');
    expect(resolved.context.creating).toBe(true); expect(resolved.context.eventIds).toEqual(['n1', 'n2']);
    expect(resolved.values.actual).toBe('5'); expect(el<HTMLButtonElement>('update-tuplet').disabled).toBe(true);
    expect(el<HTMLButtonElement>('wrap-tuplet').disabled).toBe(false);
  });

  it('keeps mode and pending Source guards separate from draft ownership', () => {
    const h = fixture(); edit('measure-end-bar', 'double'); h.context.mode = 'read'; h.forms.refresh();
    expect(value('measure-end-bar')).toBe('double'); expect(() => h.forms.resolve('measure')).toThrow('Return to Write');
    h.context.mode = 'write'; h.forms.refresh(); h.session.setPendingSource('<unfinished source>');
    expect(() => h.forms.resolve('measure')).toThrow('Apply or Revert'); expect(value('measure-end-bar')).toBe('double');
    h.session.setPendingSource(null); expect(h.forms.resolve('measure').patch).toEqual({ endBar: 'double' });
  });

  it('requires Pages for page and boundary mutation but preserves their pending fields in Write', () => {
    const h = fixture(); h.context.mode = 'pages'; h.forms.refresh(); edit('page-margin', '20'); edit('layout-break', 'line');
    h.context.mode = 'write'; h.forms.refresh();
    expect(() => h.forms.resolve('page')).toThrow('Return to Pages'); expect(() => h.forms.resolve('boundary')).toThrow('Return to Pages');
    expect(value('page-margin')).toBe('20'); expect(value('layout-break')).toBe('line'); expect(h.forms.dirtyCount).toBe(2);
  });

  it('keeps slash kind and the optional rhythm checkbox consistent', () => {
    const h = fixture(); edit('selected-kind', 'rhythmic-slash');
    expect(el<HTMLInputElement>('selected-rhythmic').checked).toBe(true);
    expect(el('selected-pitch-field').hidden).toBe(true); expect(el('selected-slash-field').hidden).toBe(false);
    edit('selected-rhythmic', false); expect(value('selected-kind')).toBe('slash');
    expect(h.forms.resolve('selected').values.rhythmic).toBe(false);
  });

  it('discards a named draft without changing accepted music or another form', () => {
    const h = fixture(); edit('selected-stem', 'up'); edit('measure-end-bar', 'double');
    const accepted = h.session.project.sourceHtml; el('load-event-values').click();
    expect(value('selected-stem')).toBe('auto'); expect(value('measure-end-bar')).toBe('double');
    expect(h.forms.dirtyCount).toBe(1); expect(h.session.project.sourceHtml).toBe(accepted); expect(h.session.canUndo).toBe(false);
    expect(document.activeElement).toBe(el('selected-kind'));
  });

  it('does not retain a stale mode or Source message once that guard is resolved', () => {
    const h = fixture(); edit('measure-end-bar', 'double'); h.context.mode = 'read'; h.forms.refresh();
    expect(() => h.forms.resolve('measure')).toThrow('Return to Write');
    h.context.mode = 'write'; h.forms.refresh(); expect(el('measure-draft-status').textContent).not.toContain('Return to Write');
    h.session.setPendingSource('<draft>'); expect(() => h.forms.resolve('measure')).toThrow('Apply or Revert');
    h.session.setPendingSource(null); expect(el('measure-draft-status').textContent).not.toContain('Apply or Revert');
  });

  it('preserves a draft on an event whose parent voice changed and requires review', () => {
    const h = fixture(); edit('selected-pitch', 'F#4');
    const accepted = h.session.project.sourceHtml;
    const moved = accepted.replace(/(<music-note id="n1"[^>]*><\/music-note>)/, '<music-voice id="new-voice">$1</music-voice>')
      .replace(/(<music-note id="n2"[^>]*><\/music-note>)/, '<music-voice id="other-voice">$1</music-voice>');
    h.session.applySource(moved);
    expect(h.forms.snapshot('selected').status).toBe('conflict'); expect(value('selected-pitch')).toBe('F#4');
    expect(() => h.forms.resolve('selected')).toThrow('Review');
  });

  it('disables pitch context fields for an actual rhythm staff without replacing their draft values', () => {
    const rhythmSource = `<music-system id="score"><music-staff id="upper" label="Drums" notation="rhythm"><music-measure id="a" incomplete><music-rhythm id="n1" duration="quarter"></music-rhythm></music-measure></music-staff></music-system>`;
    const h = fixture(rhythmSource);
    expect(value('selected-kind')).toBe('rhythm'); expect(value('staff-notation')).toBe('rhythm');
    expect(el<HTMLInputElement>('staff-clef').disabled).toBe(true); expect(el<HTMLInputElement>('staff-key').disabled).toBe(true);
    expect(el<HTMLInputElement>('measure-clef').disabled).toBe(true); expect(el<HTMLInputElement>('measure-key').disabled).toBe(true);
    expect(h.forms.snapshot('selected').values?.duration).toBe('quarter');
  });

  it('keeps a removed part draft visible and never applies it to the remaining part', () => {
    const h = fixture(); h.context.partId = 'flute-part'; h.forms.refresh(); edit('part-label', 'Solo flute');
    h.context.partId = 'bass-part';
    h.session.update('Remove part', project => { project.parts = project.parts.filter(part => part.id !== 'flute-part'); delete project.layouts['flute-part']; });
    expect(h.forms.snapshot('part').status).toBe('missing'); expect(value('part-label')).toBe('Solo flute');
    expect(() => h.forms.resolve('part')).toThrow('no longer available');
    expect(h.session.project.parts[0].label).toBe('Bass part');
  });

  it('rejects a deleted boundary rather than applying its pending break to the next measure', () => {
    const h = fixture(); h.context.mode = 'pages'; h.forms.refresh(); edit('layout-break', 'page'); h.selectSource('n3');
    h.session.execute({ type: 'remove-measure', measureId: 'a' });
    expect(h.forms.snapshot('boundary').status).toBe('missing'); expect(value('layout-break')).toBe('page');
    expect(() => h.forms.resolve('boundary')).toThrow('no longer available');
    expect(h.session.project.layouts.score.breaks).toEqual({});
  });

  it('resolves from accepted source even if the caller missed a refresh', () => {
    const h = fixture(); edit('measure-end-bar', 'double');
    // Source reads here remain the session authority; this intentional unit setup skips notifications only.
    h.session.source.querySelector('#a')!.setAttribute('end-bar', 'final');
    expect(() => h.forms.resolve('measure')).toThrow('Review'); expect(value('measure-end-bar')).toBe('double');
  });

  it('supports missing optional DOM controls and aborts listeners on disposal', () => {
    const h = fixture(); h.forms.dispose();
    const before = h.forms.snapshot('measure'); edit('measure-end-bar', 'double');
    expect(h.forms.snapshot('measure')).toEqual(before);
    document.body.replaceChildren();
    const empty = new InspectorForms({ session: h.session, context: () => h.context, select: h.selectSource });
    expect(empty.dirtyCount).toBe(0); empty.refresh(); empty.dispose();
  });

  it('does not invoke the parent change callback before construction has returned', () => {
    const h = fixture(); expect(h.changed).not.toHaveBeenCalled();
    edit('staff-label', 'Solo flute'); expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it('supplies missing recovery actions when the shell already provides the status element', () => {
    const h = fixture(); h.forms.dispose();
    for (const id of ['discard-measure-draft', 'return-measure-draft', 'review-measure-draft']) el(id).remove();
    const forms = new InspectorForms({ session: h.session, context: () => h.context, select: h.selectSource });
    cleanups.push(() => forms.dispose()); edit('measure-end-bar', 'double');
    expect(el<HTMLButtonElement>('discard-measure-draft').hidden).toBe(false);
    expect(document.querySelectorAll('#measure-draft-status')).toHaveLength(1);
    el('discard-measure-draft').click(); expect(forms.dirtyCount).toBe(0);
  });

  it('reuses a project snapshot for status and fields within one accepted revision', () => {
    const h = fixture(); const read = vi.spyOn(h.session, 'project', 'get');
    edit('staff-label', 'Solo flute'); h.forms.refresh(); h.forms.snapshot('measure'); h.forms.snapshot('part');
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('keeps each form’s status connected to its controls without creating custom dropdowns', () => {
    fixture();
    const cases: [InspectorFormName, string][] = [['selected', 'selected-pitch'], ['measure', 'measure-meter'], ['staff', 'staff-label'], ['part', 'part-label'], ['page', 'page-margin'], ['boundary', 'layout-break'], ['tuplet', 'tuplet-actual']];
    for (const [form, id] of cases) {
      expect(el(id).getAttribute('aria-describedby')).toContain(`${form}-draft-status`);
      expect(el(`${form}-draft-status`).getAttribute('role')).toBe('status');
    }
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });
});
