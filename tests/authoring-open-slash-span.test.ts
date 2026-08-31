// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rational } from '../src/model/index.js';
import { EditorSession } from '../src/authoring/editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext } from '../src/authoring/inspector-forms.js';
import { createProject } from '../src/authoring/project.js';
import type { EventInput } from '../src/authoring/types.js';

const openSlash = `<music-slash id="open" duration="quarter" data-chart="reserve-time"><!-- owner comment --><music-articulation id="fermata" type="fermata" placement="below" data-keep="yes"><!-- mark comment --></music-articulation></music-slash>`;
const afterNote = '<music-note id="after" pitch="F#4" duration="quarter" data-keep="after"></music-note>';
const staff = (events: string, notation = 'pitched') => `<music-staff id="staff" label="Lead" notation="${notation}" data-keep="staff"><music-measure id="a" number="8" meter="4/4" incomplete>${events}</music-measure></music-staff>`;
const source = staff(`${openSlash}${afterNote}`);
const cleanups: (() => void)[] = [];
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing author control ${id}`);
  return element as T;
}
function change(id: string, value: string): void {
  const field = el<HTMLInputElement | HTMLSelectElement>(id); field.value = value;
  field.dispatchEvent(new Event(field.localName === 'select' ? 'change' : 'input', { bubbles: true }));
}
function attrs(element: Element) { return Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])); }
function accepted(session: EditorSession) {
  return { project: session.project, revision: session.revision, cursor: session.cursor, selection: session.selectionId, undo: session.canUndo, redo: session.canRedo };
}

function fixture(html = source) {
  mountAuthorFixture();
  el('workspace-tools').hidden = false; el('selection-inspector').hidden = false; el<HTMLDetailsElement>('event-details').open = true;
  const session = new EditorSession(createProject(html, 'Nominal span')); session.select('open');
  const context: InspectorContext = { mode: 'write', partId: 'score', cursor: { staffId: 'staff', measureId: 'a', voiceIndex: 0, eventId: 'open' },
    selectionId: 'open', rangeEventIds: ['open'], inspectionSelectionId: 'open', entryMode: false };
  let forms: InspectorForms;
  const select = vi.fn((id: string) => {
    context.entryMode = false; context.selectionId = context.inspectionSelectionId = id; context.rangeEventIds = [id];
    context.cursor = { staffId: 'staff', measureId: 'a', voiceIndex: 0, eventId: id }; session.select(id); forms?.refresh();
  });
  forms = new InspectorForms({ session, context: () => context, select });
  const refresh = () => forms.refresh(); session.addEventListener('change', refresh);
  const execute = vi.spyOn(session, 'execute');
  cleanups.push(() => { session.removeEventListener('change', refresh); forms.dispose(); execute.mockRestore(); });
  const apply = () => {
    try {
      const draft = forms.resolve('selected'), fields = draft.values;
      if (draft.changed) session.execute({ type: 'update-event', eventId: draft.targetId, fields: draft.dirtyFields as (keyof EventInput)[], value: {
        kind: fields.kind === 'rhythmic-slash' ? 'slash' : fields.kind as EventInput['kind'], rhythmic: fields.kind === 'rhythmic-slash',
        pitch: String(fields.pitch), pitches: String(fields.pitches), pitchDirection: fields.pitchDirection as EventInput['pitchDirection'],
        duration: fields.duration as EventInput['duration'], dots: Number(fields.dots), measureRest: Boolean(fields.measureRest),
        accidentalDisplay: fields.accidentalDisplay as EventInput['accidentalDisplay'], stem: fields.stem as EventInput['stem'], beam: fields.beam as EventInput['beam'],
      } });
      forms.commit('selected');
    } catch (error) { forms.markFailure('selected', error); throw error; }
  };
  return { session, forms, context, select, execute, apply };
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

describe('staged nominal span for an open slash', () => {
  it('exposes the canonical duration and dots only inside the nominal-span task', () => {
    const h = fixture(); const before = accepted(h.session); const group = el<HTMLFieldSetElement>('selected-nominal-span');
    expect(group.hidden).toBe(false); expect(group.closest('#event-details')).not.toBeNull();
    expect(group.querySelector('legend')?.textContent).toMatch(/Nominal span/i);
    for (const id of ['selected-duration', 'selected-dots']) {
      const field = el<HTMLSelectElement>(id);
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1); expect(group.contains(field)).toBe(true);
      expect(field.closest('[hidden]')).toBeNull(); expect(field.disabled).toBe(false);
      expect(field.firstElementChild?.localName).toBe('button'); expect(field.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
      expect(field.getAttribute('aria-describedby')).toContain('selected-nominal-help');
    }
    expect(el('selected-nominal-help').textContent).toMatch(/time|occup/i);
    expect(accepted(h.session)).toEqual(before); expect(h.forms.snapshot('selected').dirty).toBe(false);
  });

  it.each([
    { name: 'note', notation: 'pitched', event: '<music-note id="open" pitch="C4" duration="quarter"></music-note>' },
    { name: 'chord', notation: 'pitched', event: '<music-chord id="open" pitches="C4 E4" duration="quarter"></music-chord>' },
    { name: 'rest', notation: 'pitched', event: '<music-rest id="open" duration="quarter"></music-rest>' },
    { name: 'rhythmic slash', notation: 'pitched', event: '<music-slash id="open" duration="quarter" rhythmic="true"></music-slash>' },
    { name: 'rhythm', notation: 'rhythm', event: '<music-rhythm id="open" duration="quarter"></music-rhythm>' },
    { name: 'road', notation: 'three-roads', event: '<music-road id="open" duration="quarter" direction="same"></music-road>' },
  ])('does not duplicate ordinary value controls for $name', ({ notation, event }) => {
    const h = fixture(staff(event, notation));
    expect(el('selected-nominal-span').hidden).toBe(true); expect(el('selected-duration').closest('[hidden]')).not.toBeNull();
    expect(h.forms.snapshot('selected').dirty).toBe(false); expect(h.session.canUndo).toBe(false);
  });

  it('follows deliberate draft-kind conversions without changing accepted notation or ordinary pitch fields', () => {
    const h = fixture(); const before = accepted(h.session);
    change('selected-kind', 'rhythmic-slash'); expect(el('selected-nominal-span').hidden).toBe(true);
    change('selected-kind', 'note'); expect(el('selected-nominal-span').hidden).toBe(true); expect(el('selected-pitch-field').hidden).toBe(false);
    change('selected-kind', 'chord'); expect(el('selected-nominal-span').hidden).toBe(true); expect(el('selected-pitches-field').hidden).toBe(false);
    change('selected-kind', 'slash'); expect(el('selected-nominal-span').hidden).toBe(false); expect(el('selected-pitch-field').hidden).toBe(true);
    expect(accepted(h.session)).toEqual(before);
    h.select('after'); change('selected-kind', 'slash'); expect(el('selected-nominal-span').hidden).toBe(false);
    expect(h.session.source.querySelector('#after')?.localName).toBe('music-note');
  });

  it.each([
    { name: 'duration', duration: 'half', dots: undefined, patch: ['duration'], time: rational(1, 2) },
    { name: 'dots', duration: undefined, dots: '1', patch: ['dots'], time: rational(3, 8) },
    { name: 'both', duration: 'half', dots: '1', patch: ['duration', 'dots'], time: rational(3, 4) },
  ])('applies $name as one narrow transaction and one Undo without writing attacks', ({ duration, dots, patch, time }) => {
    const h = fixture(); const before = h.session.project;
    const owner = h.session.source.querySelector('#open')!, mark = h.session.source.querySelector('#fermata')!;
    const ownerAttributes = attrs(owner), ownerChildren = owner.innerHTML, after = h.session.source.querySelector('#after')!.outerHTML;
    if (duration) change('selected-duration', duration); if (dots) change('selected-dots', dots);
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.forms.snapshot('selected').dirtyFields).toEqual(patch);
    h.apply();
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.execute.mock.calls[0][0]).toMatchObject({ type: 'update-event', eventId: 'open', fields: patch });
    expect(h.session.source.querySelector('#open')).toBe(owner); expect(h.session.source.querySelector('#fermata')).toBe(mark);
    expect(attrs(owner)).toEqual({ ...ownerAttributes, ...(duration ? { duration } : {}), ...(dots ? { dots } : {}) });
    expect(owner.innerHTML).toBe(ownerChildren); expect(h.session.source.querySelector('#after')!.outerHTML).toBe(after);
    expect(h.session.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ kind: 'slash', rhythmic: false, time });
    expect(h.session.project.metadata).toEqual(before.metadata); expect(h.session.project.layouts).toEqual(before.layouts); expect(h.session.project.parts).toEqual(before.parts);
    expect(h.session.revision).toBe(1); expect(h.forms.snapshot('selected').dirty).toBe(false);
    const applied = h.session.project.sourceHtml;
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(before.sourceHtml); expect(h.session.source.querySelector('#open')).toBe(owner);
    expect(h.session.canUndo).toBe(false); h.session.redo(); expect(h.session.project.sourceHtml).toBe(applied);
  });

  it('retains legacy duration and dot syntax for an unchanged Apply without consuming Redo', () => {
    const h = fixture(source.replace('duration="quarter"', 'duration="4" dotted'));
    h.session.update('Title', project => { project.metadata.title = 'Later title'; }); h.session.undo(); const before = accepted(h.session);
    change('selected-duration', 'quarter'); change('selected-dots', '1'); h.apply();
    expect(h.execute).not.toHaveBeenCalled(); expect(accepted(h.session)).toEqual(before);
    expect(h.session.source.querySelector('#open')?.getAttribute('duration')).toBe('4'); expect(h.session.source.querySelector('#open')?.hasAttribute('dotted')).toBe(true);
    expect(h.session.canRedo).toBe(true);
  });

  it('respects an existing tuplet multiplier and moves following onsets by the exact nominal time', () => {
    const h = fixture(staff(`<music-tuplet id="ratio" actual="3" normal="2" data-keep="ratio">${openSlash.replace('duration="quarter"', 'duration="quarter" dots="1"')}</music-tuplet>${afterNote}`));
    const ratio = h.session.source.querySelector('#ratio')!, ratioAttributes = attrs(ratio);
    expect(h.session.score.staves[0].measures[0].voices[0].events[1].onset).toEqual(rational(1, 4));
    change('selected-duration', 'half'); h.apply();
    const [slash, after] = h.session.score.staves[0].measures[0].voices[0].events;
    expect(slash).toMatchObject({ kind: 'slash', rhythmic: false, dots: 1, time: rational(1, 2), tupletIds: ['ratio'] });
    expect(after.onset).toEqual(rational(1, 2)); expect(h.session.source.querySelector('#ratio')).toBe(ratio); expect(attrs(ratio)).toEqual(ratioAttributes);
  });

  it('rejects overflow atomically while retaining the span draft and never extending or filling the bar', () => {
    const h = fixture(); const owner = h.session.source.querySelector('#open'), before = accepted(h.session);
    change('selected-duration', 'whole'); expect(() => h.apply()).toThrow(/overflow|exceed|excess|4\/4/i);
    expect(accepted(h.session)).toEqual(before); expect(h.session.source.querySelector('#open')).toBe(owner);
    expect(h.session.source.querySelectorAll('music-measure')).toHaveLength(1); expect(h.session.source.querySelectorAll('music-rest')).toHaveLength(0);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'open', dirty: true });
    expect(el<HTMLSelectElement>('selected-duration').value).toBe('whole'); expect(el('selected-draft-status').textContent).toMatch(/overflow|exceed|excess|4\/4/i);
    change('selected-duration', 'half'); h.apply(); expect(h.session.revision).toBe(1); expect(h.session.source.querySelector('#open')?.hasAttribute('rhythmic')).toBe(false);
  });

  it('retains the held open-slash task while a different event is selected and requires Return before Apply', () => {
    const h = fixture(); change('selected-duration', 'half'); h.select('after'); const before = accepted(h.session);
    expect(el('selected-nominal-span').hidden).toBe(false); expect(el<HTMLSelectElement>('selected-duration').disabled).toBe(true);
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'open', matchesSelection: false, canApply: false });
    expect(() => h.apply()).toThrow(/Return/); expect(accepted(h.session)).toEqual(before);
    el('return-selected-draft').click(); expect(h.context.selectionId).toBe('open'); expect(el<HTMLSelectElement>('selected-duration').disabled).toBe(false);
    h.apply(); expect(h.session.source.querySelector('#open')?.getAttribute('duration')).toBe('half'); expect(h.session.source.querySelector('#after')?.getAttribute('duration')).toBe('quarter');
  });

  it('does not show a newly selected open slash as the span of a held pitched draft', () => {
    const h = fixture(); h.select('after'); change('selected-pitch', 'F##4'); h.select('open');
    expect(h.forms.snapshot('selected')).toMatchObject({ targetId: 'after', dirty: true, matchesSelection: false });
    expect(el('selected-nominal-span').hidden).toBe(true); expect(el('selected-pitch-field').hidden).toBe(false);
  });

  it.each(['source', 'pages', 'read', 'entry', 'range', 'empty'] as const)('keeps the nominal span but blocks Apply during %s', reason => {
    const h = fixture(); change('selected-duration', 'half');
    if (reason === 'source') h.session.setPendingSource(h.session.project.sourceHtml);
    else if (reason === 'pages' || reason === 'read') h.context.mode = reason;
    else if (reason === 'entry') h.context.entryMode = true;
    else h.context.rangeEventIds = reason === 'range' ? ['open', 'after'] : [];
    h.forms.refresh(); const before = accepted(h.session);
    expect(el('selected-nominal-span').hidden).toBe(false); expect(el<HTMLSelectElement>('selected-duration').disabled).toBe(true);
    expect(h.forms.snapshot('selected').canApply).toBe(false); expect(() => h.apply()).toThrow();
    expect(accepted(h.session)).toEqual(before); expect(h.execute).not.toHaveBeenCalled(); expect(el<HTMLSelectElement>('selected-duration').value).toBe('half');
  });

  it.each(['rhythmic', 'voice-time'] as const)('keeps the original draft in conflict after an accepted %s change', changeKind => {
    const h = fixture(); change('selected-duration', 'half');
    if (changeKind === 'rhythmic') h.session.applySource(h.session.project.sourceHtml.replace('data-chart="reserve-time"', 'data-chart="reserve-time" rhythmic'));
    else h.session.execute({ type: 'set-event-rhythm', eventId: 'after', duration: 'half', dots: 0 });
    const before = accepted(h.session); expect(h.forms.snapshot('selected').status).toBe('conflict');
    expect(() => h.apply()).toThrow(/Review/); expect(accepted(h.session)).toEqual(before); expect(el<HTMLSelectElement>('selected-duration').value).toBe('half');
  });

  it('merges unrelated accepted title and pitch edits without replacing them when applying the span', () => {
    const h = fixture(); change('selected-duration', 'half');
    h.session.execute({ type: 'set-note-pitch', eventId: 'after', pitch: 'Gb4', ties: 'reject' });
    h.session.update('Title', project => { project.metadata.title = 'Revised chart'; });
    const before = h.session.project.sourceHtml;
    expect(h.forms.snapshot('selected').status).toBe('dirty'); expect(h.forms.resolve('selected').patch).toEqual({ duration: 'half' });
    h.apply();
    expect(h.session.source.querySelector('#open')?.getAttribute('duration')).toBe('half');
    expect(h.session.source.querySelector('#open')?.hasAttribute('rhythmic')).toBe(false);
    expect(h.session.source.querySelector('#after')?.getAttribute('pitch')).toBe('Gb4'); expect(h.session.project.metadata.title).toBe('Revised chart');
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(before); expect(h.session.project.metadata.title).toBe('Revised chart');
  });

  it('keeps a hidden pending span explicit when accepted rhythm changes its meaning, including after Review', () => {
    const h = fixture(); change('selected-duration', 'half');
    h.session.applySource(h.session.project.sourceHtml.replace('data-chart="reserve-time"', 'data-chart="reserve-time" rhythmic'));
    const acceptedRhythm = h.session.project.sourceHtml;
    expect(el('selected-nominal-span').hidden).toBe(true); expect(h.forms.snapshot('selected').status).toBe('conflict');
    expect(el('selected-draft-status').textContent).toMatch(/Pending value: half, 0 dots\./);
    expect(el('selected-draft-status').textContent).toMatch(/writes rhythm[\s\S]*written value/);
    el('review-selected-draft').click();
    expect(h.forms.snapshot('selected').status).toBe('dirty'); expect(el('selected-nominal-span').hidden).toBe(true);
    expect(el('selected-draft-status').textContent).toMatch(/Pending value: half, 0 dots\./);
    h.apply();
    expect(h.session.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ kind: 'slash', rhythmic: true, duration: 'half' });
    expect(el('selected-draft-status').textContent).not.toContain('Pending value');
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(acceptedRhythm);
  });
});
