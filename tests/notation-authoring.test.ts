// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { NoteEditor } from '../src/authoring/note-editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { NoteEditorState } from '../src/authoring/note-editor.js';
import { createProject, importProject, serializeProject } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';
import type { AuthorCommand, EventInput } from '../src/authoring/types.js';
import { add, meterTime, rational, subtract } from '../src/model/index.js';
import type { MusicEvent } from '../src/model/types.js';

function session(source: string): EditorSession {
  return new EditorSession(createProject(source, 'Microtones and rhythm'));
}

function eventInput(overrides: Partial<EventInput> = {}): EventInput {
  return {
    kind: 'rhythm', pitch: '', pitches: '', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
    ...overrides,
  };
}

function event(editor: EditorSession, id: string): MusicEvent {
  return editor.score.staves.flatMap(staff => staff.measures.flatMap(measure =>
    measure.voices.flatMap(voice => voice.events))).find(item => item.id === id)!;
}

function attributes(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

/** Reconciliation may change attribute order without changing the source data. */
function sourceData(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('*')) {
    const entries = Object.entries(attributes(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of entries) node.setAttribute(name, value);
  }
  return template.innerHTML;
}

function expectValid(editor: EditorSession): void {
  expect(editor.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
}

function expectNoPitchContext(staff: Element): void {
  for (const node of [staff, ...staff.querySelectorAll('music-measure')]) {
    expect(node.hasAttribute('clef')).toBe(false);
    expect(node.hasAttribute('key')).toBe(false);
  }
}

const mixedSource = `<music-system id="score" key="G">
  <music-staff id="melody" label="Melody">
    <music-measure id="pitched-bar"><music-note id="p1" pitch="Fqs4" duration="half" accidental-display="courtesy"></music-note><music-note id="p2" pitch="Gtqf4" duration="half"></music-note></music-measure>
  </music-staff>
  <music-staff id="pulse" label="Claps" notation="rhythm" data-role="counted attacks">
    <music-measure id="rhythm-bar"><!-- keep the grouping -->
      <music-tuplet id="triplet" actual="3" normal="2" bracket="yes" ratio>
        <music-rhythm id="r1" duration="eighth" beam="start"></music-rhythm>
        <music-rhythm id="r2" duration="eighth" beam="continue"></music-rhythm>
        <music-rhythm id="r3" duration="eighth" beam="end"></music-rhythm>
      </music-tuplet>
      <music-rhythm id="r4" duration="half" dots="1" stem="down" data-performer="sustain"></music-rhythm>
    </music-measure>
  </music-staff>
</music-system>`;

const emptyRhythmSource = '<music-staff id="pulse" notation="rhythm" label="Claps"><music-measure id="bar"><music-rest id="placeholder" measure data-user="keep"></music-rest></music-measure></music-staff>';

describe('portable microtonal and rhythm authoring', () => {
  it('round-trips mixed notation, authored spelling, tuplets, and part extraction without adding pitch context', () => {
    const original = createProject(mixedSource, 'Quarter-tone duet', [
      { id: 'melody-part', label: 'Melody', staffIds: ['melody'] },
      { id: 'rhythm-part', label: 'Claps', staffIds: ['pulse'] },
    ]);
    const reopened = importProject(serializeProject(original));
    expect(reopened).toEqual(original);
    expect(reopened.sourceHtml).toBe(mixedSource);
    const before = JSON.stringify(reopened);
    const rhythm = buildProjection(reopened, 'rhythm-part');
    expect(rhythm.label).toBe('Claps · rhythm notation');
    expect(rhythm.score.label).not.toContain('authored pitch');
    expect(rhythm.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(rhythm.score.staves).toHaveLength(1);
    expect(rhythm.score.staves[0]).toMatchObject({ id: 'pulse', notation: 'rhythm', clef: 'treble', key: 'C' });
    const voice = rhythm.score.staves[0].measures[0].voices[0];
    expect(voice.events.map(item => [item.id, item.kind, item.pitches, item.rhythmic])).toEqual([
      ['r1', 'rhythm', [], false], ['r2', 'rhythm', [], false], ['r3', 'rhythm', [], false], ['r4', 'rhythm', [], false],
    ]);
    expect(voice.events.map(item => item.time)).toEqual([rational(1, 12), rational(1, 12), rational(1, 12), rational(3, 4)]);
    expect(voice.tuplets[0]).toMatchObject({ id: 'triplet', actual: 3, normal: 2, eventIds: ['r1', 'r2', 'r3'] });
    expectNoPitchContext(rhythm.source.querySelector('#pulse')!);
    expect(rhythm.source.innerHTML).toContain('<!-- keep the grouping -->');
    const melody = buildProjection(reopened, 'melody-part');
    expect(melody.source.querySelector('#p1')?.getAttribute('pitch')).toBe('Fqs4');
    expect(melody.source.querySelector('#p2')?.getAttribute('pitch')).toBe('Gtqf4');
    expect(melody.score.staves[0].measures[0].voices[0].events.map(item => item.pitches[0].alter)).toEqual([0.5, -1.5]);
    expect(JSON.stringify(reopened)).toBe(before);
  });

  it('adds a rhythm staff to a pitched root in one undoable action, inheriting meter but no key or clef', () => {
    const editor = session('<music-staff id="melody" clef="alto" key="Eb" meter="7/8" groups="2+2+3"><music-measure id="m1"><music-rest id="a" measure></music-rest></music-measure><music-measure id="m2" meter="3/4" key="G"><music-rest id="b" measure></music-rest></music-measure></music-staff>');
    const before = editor.project;
    const originalStaff = editor.source;
    const result = editor.execute({ type: 'add-staff', label: 'Claps', clef: 'bass', notation: 'rhythm' });
    const added = editor.score.staves[1];
    expect(added).toMatchObject({ id: result.selectionId, label: 'Claps', notation: 'rhythm', clef: 'treble', key: 'C' });
    expect(added.measures.map(measure => [measure.meter.display, measure.key, measure.clef])).toEqual([
      ['7/8', 'C', 'treble'], ['3/4', 'C', 'treble'],
    ]);
    expect(added.measures.every(measure => measure.voices[0].events[0].measureRest)).toBe(true);
    expectNoPitchContext(editor.source.querySelector(`#${result.selectionId}`)!);
    expect(editor.project.columns.every(column => column.measureIds.length === 2)).toBe(true);
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(editor.source).toBe(originalStaff);
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.project.columns).toEqual(before.columns);
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.score.staves[1].notation).toBe('rhythm');
  });

  it('keeps rhythm notation when editing a staff without a notation argument', () => {
    const editor = session(emptyRhythmSource);
    editor.execute({ type: 'set-staff', staffId: 'pulse', label: 'Taps', clef: 'bass', key: 'G' });
    expect(editor.score.staves[0]).toMatchObject({ notation: 'rhythm', label: 'Taps', clef: 'treble', key: 'C' });
    expectNoPitchContext(editor.source);
    expectValid(editor);
    editor.undo();
    expect(editor.score.staves[0].label).toBe('Claps');
    expect(editor.canUndo).toBe(false);
  });

  it('requires explicit event conversion before a staff can change its notation', () => {
    const editor = session('<music-staff id="staff" clef="bass" key="G"><music-measure id="bar"><music-note id="note" pitch="Bqf3" duration="whole" data-intent="keep"></music-note></music-measure></music-staff>');
    editor.select('note');
    const before = editor.project;
    const node = editor.source.querySelector('#note');
    const mode: AuthorCommand = { type: 'set-staff', staffId: 'staff', label: 'Rhythm', clef: 'bass', key: 'G', notation: 'rhythm' };
    expect(() => editor.execute(mode)).toThrow();
    expect(() => editor.execute({ type: 'convert-events', eventIds: ['note'], kind: 'rhythm', rhythmic: false, pitch: '' })).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.source.querySelector('#note')).toBe(node);
    expect(editor.selectionId).toBe('note');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
    editor.execute({ type: 'convert-events', eventIds: ['note'], kind: 'slash', rhythmic: true, pitch: '' });
    editor.execute(mode);
    editor.execute({ type: 'convert-events', eventIds: ['note'], kind: 'rhythm', rhythmic: false, pitch: '' });
    expect(event(editor, 'note')).toMatchObject({ kind: 'rhythm', pitches: [], time: rational(1), rhythmic: false });
    expect(editor.source.querySelector('#note')?.getAttribute('data-intent')).toBe('keep');
    expect(editor.source.querySelector('#note')?.hasAttribute('rhythmic')).toBe(false);
    expectNoPitchContext(editor.source);
    expectValid(editor);
    const accepted = editor.project;
    expect(() => editor.execute({ ...mode, notation: 'pitched' })).toThrow();
    expect(editor.project).toEqual(accepted);
  });

  it.each<AuthorCommand>([
    { type: 'insert-event', cursor: { staffId: 'pulse', measureId: 'rhythm-bar', voiceIndex: 0, eventId: 'r4' }, value: eventInput({ kind: 'note', pitch: 'C4' }), position: 'replace' },
    { type: 'insert-event', cursor: { staffId: 'melody', measureId: 'pitched-bar', voiceIndex: 0, eventId: 'p1' }, value: eventInput(), position: 'replace' },
    { type: 'update-event', eventId: 'r4', value: eventInput({ kind: 'note', pitch: 'C4', duration: 'half', dots: 1 }) },
    { type: 'update-event', eventId: 'p1', value: eventInput({ duration: 'half' }) },
    { type: 'set-measure', measureId: 'rhythm-bar', values: { clef: 'bass' } },
    { type: 'set-measure', measureId: 'rhythm-bar', values: { key: 'G' } },
  ])('rejects incompatible $type commands without changing accepted music or history', command => {
    const editor = session(mixedSource);
    editor.select('r4');
    const before = editor.project;
    const root = editor.source;
    const selected = root.querySelector('#r4');
    expect(() => editor.execute(command)).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.source).toBe(root);
    expect(editor.source.querySelector('#r4')).toBe(selected);
    expect(editor.selectionId).toBe('r4');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });
});

describe('microtonal and pitchless selected-event inspector drafts', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

  function fixture(selectedId: string) {
    // These are the mounted inspector controls, independent of the concurrent
    // workspace shell. The real controller reads accepted musical source.
    document.body.innerHTML = `<section id="selection-inspector"><div class="inspector-content">
      <label for="selected-kind">Kind<select id="selected-kind"><option value="note">Note</option><option value="chord">Chord</option><option value="rest">Rest</option><option value="slash">Open slash</option><option value="rhythmic-slash">Rhythmic slash</option><option value="rhythm">Rhythm note</option></select></label>
      <label id="selected-pitch-field" for="selected-pitch">Pitch<input id="selected-pitch"></label>
      <label id="selected-pitches-field" for="selected-pitches">Pitches<input id="selected-pitches"></label>
      <label for="selected-accidental-display">Accidental display<select id="selected-accidental-display"><option value="auto">Auto</option><option value="always">Always</option><option value="courtesy">Courtesy</option></select></label>
    </div></section>`;
    const editor = session(`<music-system id="score">
      <music-staff id="pitched"><music-measure id="pitched-bar"><music-note id="n" pitch="Fqs4" duration="half" accidental-display="courtesy"></music-note><music-chord id="c" pitches="C4 Eqf4 G4" duration="half"></music-chord></music-measure></music-staff>
      <music-staff id="pulse" notation="rhythm"><music-measure id="rhythm-bar"><music-rhythm id="r"></music-rhythm><music-rest id="rest"></music-rest><music-slash id="open"></music-slash><music-slash id="slash" rhythmic></music-slash></music-measure></music-staff>
    </music-system>`);
    editor.select(selectedId);
    const forms = new InspectorForms({
      session: editor,
      context: () => {
        const staff = editor.score.staves.find(item => item.measures.some(measure => measure.voices.some(voice => voice.events.some(event => event.id === editor.selectionId))))!;
        return { mode: 'write', partId: 'score', selectionId: editor.selectionId,
          cursor: { staffId: staff.id, measureId: staff.measures[0].id, voiceIndex: 0, eventId: editor.selectionId } };
      },
      select: id => editor.select(id),
    });
    cleanups.push(() => forms.dispose());
    return { editor, forms, accidental: document.getElementById('selected-accidental-display') as HTMLSelectElement };
  }

  it('describes microtones in target labels while retaining canonical pitch tokens in editable fields', () => {
    const h = fixture('n');
    expect(h.forms.snapshot('selected').label).toContain('F quarter-sharp 4');
    expect(h.forms.snapshot('selected').values?.pitch).toBe('Fqs4');
    expect((document.getElementById('selected-pitch') as HTMLInputElement).value).toBe('Fqs4');
    expect(h.accidental.disabled).toBe(false);
    expect(h.accidental.closest('label')?.hidden).toBe(false);
    h.editor.select('c'); h.forms.refresh();
    expect(h.forms.snapshot('selected').label).toContain('E quarter-flat 4');
    expect(h.forms.snapshot('selected').values?.pitches).toBe('C4 Eqf4 G4');
  });

  it.each(['r', 'rest', 'open', 'slash'])('hides ineffective accidental choices for %s and restores them for pitched notes', id => {
    const h = fixture(id);
    const before = h.editor.project.sourceHtml;
    expect(h.accidental.disabled).toBe(true);
    expect(h.accidental.closest('label')?.hidden).toBe(true);
    if (id === 'r') expect(h.forms.snapshot('selected').label).toContain('Rhythm note');
    expect(h.forms.snapshot('selected').dirty).toBe(false);
    h.editor.select('n'); h.forms.refresh();
    expect(h.accidental.disabled).toBe(false);
    expect(h.accidental.closest('label')?.hidden).toBe(false);
    expect(h.accidental.value).toBe('courtesy');
    expect(h.editor.project.sourceHtml).toBe(before);
    expect(h.editor.canUndo).toBe(false);
  });
});

describe('authoring required rhythm attacks', () => {
  it('inserts a dotted rhythm event into a placeholder and edits its value while retaining identity and metadata', () => {
    const editor = session(emptyRhythmSource);
    const before = editor.project.sourceHtml;
    const inserted = editor.execute({ type: 'insert-event', cursor: { staffId: 'pulse', measureId: 'bar', voiceIndex: 0 },
      value: eventInput({ duration: 'eighth', dots: 1, stem: 'up', beam: 'none' }), position: 'after' });
    expect(inserted.selectionId).toBe('placeholder');
    expect(event(editor, 'placeholder')).toMatchObject({ kind: 'rhythm', pitches: [], rhythmic: false, time: rational(3, 16), dots: 1 });
    expect(editor.revision).toBe(1);
    const node = editor.source.querySelector('#placeholder')!;
    const priorAttributes = attributes(node);
    editor.execute({ type: 'set-event-rhythm', eventId: 'placeholder', duration: 'half', dots: 1 });
    expect(editor.source.querySelector('#placeholder')).toBe(node);
    expect(attributes(node)).toEqual({ ...priorAttributes, duration: 'half' });
    expect(event(editor, 'placeholder').time).toEqual(rational(3, 4));
    expectValid(editor);
    editor.undo();
    expect(event(editor, 'placeholder').time).toEqual(rational(3, 16));
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });

  it('ties rhythm events across bars, preserves the chain through value edits, and clears it from the middle', () => {
    const editor = session('<music-staff id="pulse" notation="rhythm"><music-measure id="m1"><music-rhythm id="a" duration="whole"></music-rhythm></music-measure><music-measure id="m2"><music-rhythm id="b" duration="half"></music-rhythm><music-rhythm id="c" duration="half"></music-rhythm></music-measure></music-staff>');
    const before = editor.project.sourceHtml;
    editor.execute({ type: 'tie-events', eventIds: ['c', 'a', 'b'] });
    expect(['a', 'b', 'c'].map(id => event(editor, id).tie)).toEqual(['start', 'continue', 'end']);
    expect(editor.revision).toBe(1);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
    editor.redo();
    editor.execute({ type: 'update-event', eventId: 'b', value: eventInput({ duration: 'quarter' }) });
    expect(event(editor, 'b')).toMatchObject({ kind: 'rhythm', tie: 'continue', time: rational(1, 4) });
    expect(['a', 'b', 'c'].map(id => event(editor, id).tie)).toEqual(['start', 'continue', 'end']);
    editor.execute({ type: 'clear-ties', eventIds: ['b'] });
    expect(editor.source.querySelectorAll('[tie]')).toHaveLength(0);
    editor.undo();
    expect(['a', 'b', 'c'].map(id => event(editor, id).tie)).toEqual(['start', 'continue', 'end']);
    expectValid(editor);
  });

  it('retains rhythm tuplet membership and explicit beams when changing a written value', () => {
    const editor = session(mixedSource);
    const parent = editor.source.querySelector('#r1')!.parentElement;
    const tuplets = editor.score.staves[1].measures[0].voices[0].tuplets;
    editor.execute({ type: 'set-event-rhythm', eventId: 'r1', duration: 'sixteenth', dots: 0 });
    expect(editor.source.querySelector('#r1')!.parentElement).toBe(parent);
    expect(event(editor, 'r1')).toMatchObject({ kind: 'rhythm', time: rational(1, 24), beam: 'start', tupletIds: ['triplet'] });
    expect(editor.score.staves[1].measures[0].voices[0].tuplets).toEqual(tuplets);
    expect(editor.diagnostics.some(item => item.code === 'tuplet-span' && item.severity === 'warning')).toBe(true);
    expectValid(editor);
  });

  it('wraps and unwraps selected rhythm events with an exact tuplet ratio', () => {
    const editor = session('<music-staff id="pulse" notation="rhythm"><music-measure id="bar" incomplete><music-rhythm id="a" duration="eighth"></music-rhythm><music-rhythm id="b" duration="eighth"></music-rhythm><music-rhythm id="c" duration="eighth"></music-rhythm></music-measure></music-staff>');
    const result = editor.execute({ type: 'wrap-tuplet', eventIds: ['c', 'a', 'b'], actual: 3, normal: 2, bracket: 'yes', ratio: true });
    expect(['a', 'b', 'c'].map(id => event(editor, id).time)).toEqual([rational(1, 12), rational(1, 12), rational(1, 12)]);
    expect(editor.source.querySelector('music-tuplet')?.children).toHaveLength(3);
    editor.execute({ type: 'unwrap-tuplet', tupletId: result.selectionId! });
    expect(editor.source.querySelector('music-tuplet')).toBeNull();
    expect(['a', 'b', 'c'].map(id => event(editor, id).time)).toEqual([rational(1, 8), rational(1, 8), rational(1, 8)]);
    expectValid(editor);
  });

  it.each<AuthorCommand>([
    { type: 'duplicate-measures', measureIds: ['r2'] },
    { type: 'append-measure', afterMeasureId: 'r2' },
    { type: 'move-measure', measureId: 'r2', direction: 1 },
  ])('preserves rhythm meter and neutral context through $type', command => {
    const editor = session(`<music-system id="score" key="G">
      <music-staff id="melody" clef="bass"><music-measure id="p1" meter="3/4"><music-rest id="a" measure></music-rest></music-measure><music-measure id="p2" meter="5/8" groups="2+3" key="Eb"><music-rest id="b" measure></music-rest></music-measure><music-measure id="p3" meter="4/4"><music-rest id="c" measure></music-rest></music-measure></music-staff>
      <music-staff id="pulse" notation="rhythm"><music-measure id="r1" meter="3/4"><music-rest id="d" measure></music-rest></music-measure><music-measure id="r2" meter="5/8" groups="2+3"><music-rest id="e" measure></music-rest></music-measure><music-measure id="r3" meter="4/4"><music-rest id="f" measure></music-rest></music-measure></music-staff>
    </music-system>`);
    const before = editor.score.staves[1].measures;
    editor.execute(command);
    const after = editor.score.staves[1];
    for (const original of before) {
      expect(after.measures.find(measure => measure.id === original.id)).toMatchObject({ meter: original.meter, clef: 'treble', key: 'C' });
    }
    expect(after.measures.every(measure => measure.key === 'C' && measure.clef === 'treble')).toBe(true);
    expectNoPitchContext(editor.source.querySelector('#pulse')!);
    expect(editor.score.staves[0].measures).toHaveLength(after.measures.length);
    expectValid(editor);
  });
});

describe('quarter-tone note commands', () => {
  it.each([
    [-1.5, 'Btqf3'], [-0.5, 'Bqf3'], [0.5, 'Bqs3'], [1.5, 'Btqs3'],
  ] as const)('writes alteration %s on the same letter and octave in one undo step', (alter, pitch) => {
    const editor = session('<music-staff id="staff" key="G"><music-measure id="bar"><!-- keep spelling intent --><music-note id="note" pitch="Bb3" duration="1" accidental-display="courtesy" stem="down" beam="none" data-user="keep"></music-note></music-measure></music-staff>');
    const beforeSource = editor.project.sourceHtml;
    const beforeEvent = event(editor, 'note');
    const node = editor.source.querySelector('#note')!;
    const beforeAttributes = attributes(node);
    editor.execute({ type: 'set-note-accidental', eventId: 'note', alter, ties: 'reject' });
    expect(editor.source.querySelector('#note')).toBe(node);
    expect(attributes(node)).toEqual({ ...beforeAttributes, pitch });
    expect(event(editor, 'note')).toEqual({ ...beforeEvent, pitches: [{ ...beforeEvent.pitches[0], alter }] });
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(beforeSource));
    expect(editor.source.querySelector('#note')).toBe(node);
    expect(editor.canUndo).toBe(false);
  });

  it('keeps spelling, source metadata, and redo history for a quarter-tone semantic no-op', () => {
    const editor = session('<music-staff id="staff"><music-measure id="bar"><music-note id="note" pitch="bqf3" duration="1" data-user="keep"></music-note></music-measure></music-staff>');
    const original = editor.project.sourceHtml;
    editor.execute({ type: 'set-note-accidental', eventId: 'note', alter: -0.5, ties: 'reject' });
    editor.execute({ type: 'set-note-pitch', eventId: 'note', pitch: 'Bqf3', ties: 'reject' });
    expect(editor.project.sourceHtml).toBe(original);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
    editor.execute({ type: 'set-note-accidental', eventId: 'note', alter: 1.5, ties: 'reject' });
    editor.undo();
    const revision = editor.revision;
    const undone = editor.project.sourceHtml;
    editor.execute({ type: 'set-note-accidental', eventId: 'note', alter: -0.5, ties: 'reject' });
    expect(editor.project.sourceHtml).toBe(undone);
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
  });

  it.each([0.25, -0.25, 0.75])('rejects unsupported runtime alteration %s without committing state', alter => {
    const editor = session('<music-staff id="staff"><music-measure id="bar"><music-note id="note" pitch="Cqs4" duration="whole"></music-note></music-measure></music-staff>');
    editor.select('note');
    const before = editor.project;
    expect(() => editor.execute({ type: 'set-note-accidental', eventId: 'note', alter, ties: 'reject' } as AuthorCommand)).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.selectionId).toBe('note');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('accepts unchanged quarter-tone accidentals on a tie but rejects pitch changes without breaking the chain', () => {
    const editor = session('<music-staff id="staff"><music-measure id="bar"><music-note id="a" pitch="Fqs4" duration="half" tie="start"></music-note><music-note id="b" pitch="Fqs4" duration="half" tie="end"></music-note></music-measure></music-staff>');
    const before = editor.project;
    editor.execute({ type: 'set-note-accidental', eventId: 'b', alter: 0.5, ties: 'reject' });
    expect(() => editor.execute({ type: 'set-note-accidental', eventId: 'b', alter: -0.5, ties: 'reject' })).toThrow();
    expect(editor.project).toEqual(before);
    expect(['a', 'b'].map(id => event(editor, id).tie)).toEqual(['start', 'end']);
    expect(editor.canUndo).toBe(false);
    expectValid(editor);
  });
});

// Mount the real controls without main, stylesheets, or remote resources. The
// ordinary-flow fallback exercises state and transactions, not browser top-layer behavior.
const uiCleanups: (() => void)[] = [];
const accidentalIds = ['note-double-flat', 'note-flat', 'note-natural', 'note-sharp', 'note-double-sharp'];

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing author control ${id}`);
  return element as T;
}

function noteEditorFixture(source: string, selectionId = 'note') {
  mountAuthorFixture();
  const panel = control('note-editor');
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const accepted = session(source);
  accepted.select(selectionId);
  const state = (): NoteEditorState => {
    const base: NoteEditorState = {
      documentId: accepted.project.id, mode: 'write', revision: accepted.revision, pendingSource: accepted.project.pendingSource !== null,
      selectionCount: 1, staffLabel: '', measureNumber: '', voiceNumber: 1, remaining: rational(0), tuplets: [],
    };
    for (const staff of accepted.score.staves) for (const measure of staff.measures) {
      for (const [index, voice] of measure.voices.entries()) {
        const selected = voice.events.find(item => item.id === accepted.selectionId);
        if (selected) return {
          ...base, event: selected, staffLabel: staff.label, measureNumber: measure.number, voiceNumber: index + 1,
          remaining: subtract(meterTime(measure.meter), voice.events.reduce((time, item) => add(time, item.time), rational(0))),
          tuplets: voice.tuplets,
        };
      }
    }
    return base;
  };
  const execute = vi.fn((command: AuthorCommand) => { accepted.execute(command); });
  const undo = vi.fn(() => { accepted.undo(); });
  const editor = new NoteEditor({ state, beforeOpen: () => {}, execute, undo, canUndo: () => accepted.canUndo });
  const refresh = () => editor.refresh();
  accepted.addEventListener('change', refresh);
  uiCleanups.push(() => { accepted.removeEventListener('change', refresh); editor.dispose(); });
  return {
    editor, session: accepted, state, execute, undo, panel,
    microtone: control<HTMLSelectElement>('note-microtone'),
    duration: control<HTMLSelectElement>('note-duration'), dots: control<HTMLSelectElement>('note-dots'),
    undoButton: control<HTMLButtonElement>('note-editor-undo'),
  };
}

function change(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('microtonal and rhythm controls in the real author shell', () => {
  afterEach(() => {
    uiCleanups.splice(0).forEach(cleanup => cleanup());
    document.body.replaceChildren();
  });

  it('names the accepted microtonal spelling and selects its exact alteration instead of stale insertion values', () => {
    const h = noteEditorFixture('<music-staff id="staff" label="Viola" key="G"><music-measure id="bar" number="12"><music-note id="note" pitch="Gtqf4" duration="whole"></music-note></music-measure></music-staff>');
    const before = h.session.project.sourceHtml;
    control<HTMLInputElement>('event-pitch').value = 'Fqs4';
    h.microtone.value = '0.5';
    h.editor.open();
    expect(control('note-editor-heading').textContent).toBe('Edit G three-quarter-flat 4');
    expect(control('edit-selected-value').textContent).toContain('G three-quarter-flat 4');
    expect(control('note-editor-context').textContent).toBe('Viola · measure 12 · voice 1');
    expect(h.microtone.value).toBe('-1.5');
    expect(h.microtone.disabled).toBe(false);
    expect(document.activeElement).toBe(h.microtone);
    expect(accidentalIds.every(id => control(id).getAttribute('aria-pressed') === 'false')).toBe(true);
    change(h.microtone, '-1.5');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project.sourceHtml).toBe(before);
    expect(h.session.revision).toBe(0);
    expect(h.session.canUndo).toBe(false);
    expect(control('note-editor-feedback').textContent).toContain('No undo step');
  });

  it.each([
    [-1.5, 'Btqf3'], [-0.5, 'Bqf3'], [0.5, 'Bqs3'], [1.5, 'Btqs3'],
  ] as const)('applies dropdown alteration %s once, preserving note metadata and providing one local undo', (alter, pitch) => {
    const h = noteEditorFixture('<music-staff id="staff" key="G"><music-measure id="bar"><music-note id="note" pitch="B3" duration="1" accidental-display="courtesy" data-user="keep" stem="down"></music-note></music-measure></music-staff>');
    const original = h.session.project.sourceHtml;
    const target = h.session.source.querySelector('#note')!;
    const originalAttributes = attributes(target);
    h.editor.open();
    expect(h.microtone.value).toBe('');
    h.microtone.focus();
    change(h.microtone, String(alter));
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-accidental', eventId: 'note', alter, ties: 'reject' });
    expect(h.session.source.querySelector('#note')).toBe(target);
    expect(attributes(target)).toEqual({ ...originalAttributes, pitch });
    expect(h.microtone.value).toBe(String(alter));
    expect(document.activeElement).toBe(h.microtone);
    expect(h.session.revision).toBe(1);
    expect(h.undoButton.disabled).toBe(false);
    change(h.microtone, String(alter));
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.revision).toBe(1);
    expect(control('note-editor-feedback').textContent).toContain('No undo step');
    h.undoButton.click();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(sourceData(h.session.project.sourceHtml)).toBe(sourceData(original));
    expect(h.session.source.querySelector('#note')).toBe(target);
    expect(h.session.canUndo).toBe(false);
    expect(h.undoButton.disabled).toBe(true);
    expect(h.microtone.value).toBe('');
    expectValid(h.session);
  });

  it('disables all pitch controls for a rhythm note while duration and dots retain its tie and tuplet', () => {
    const h = noteEditorFixture('<music-staff id="staff" notation="rhythm" label="Claps"><music-measure id="bar" incomplete><music-tuplet id="triplet" actual="3" normal="2"><music-rhythm id="a" duration="eighth" tie="start" beam="start"></music-rhythm><music-rhythm id="note" duration="eighth" tie="continue" beam="continue" data-user="sustain"></music-rhythm><music-rhythm id="c" duration="eighth" tie="end" beam="end"></music-rhythm></music-tuplet></music-measure></music-staff>');
    const group = h.session.source.querySelector('#triplet');
    const target = h.session.source.querySelector('#note');
    const tuplets = h.state().tuplets;
    h.editor.open();
    expect(control('note-editor-heading').textContent).toBe('Edit Rhythm note');
    expect(control('edit-selected-label').textContent).toBe('Edit rhythm note');
    expect(control('edit-selected-value').textContent).toContain('Rhythm note');
    expect(accidentalIds.every(id => control<HTMLButtonElement>(id).disabled)).toBe(true);
    expect(h.microtone.disabled).toBe(true);
    expect(h.microtone.value).toBe('');
    expect(h.duration.disabled).toBe(false);
    expect(h.dots.disabled).toBe(false);
    expect(document.activeElement).toBe(h.duration);
    expect(control('note-rhythm-help').textContent).toContain('Tuplet 3:2: 1/8 written whole notes occupy 1/12 whole notes here');
    // Direct dispatch also checks the semantic guard behind the disabled control.
    change(h.microtone, '0.5');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.revision).toBe(0);
    expect(control('note-editor-error').textContent).toContain('no pitch or accidental');
    change(h.duration, 'sixteenth');
    change(h.dots, '1');
    expect(h.execute.mock.calls.map(([command]) => command)).toEqual([
      { type: 'set-event-rhythm', eventId: 'note', duration: 'sixteenth', dots: 0 },
      { type: 'set-event-rhythm', eventId: 'note', duration: 'sixteenth', dots: 1 },
    ]);
    expect(h.session.revision).toBe(2);
    expect(h.state().event).toMatchObject({ kind: 'rhythm', pitches: [], tie: 'continue', beam: 'continue', time: rational(1, 16), tupletIds: ['triplet'] });
    expect(h.state().tuplets).toEqual(tuplets);
    expect(h.session.source.querySelector('#triplet')).toBe(group);
    expect(h.session.source.querySelector('#note')).toBe(target);
    expect(target?.getAttribute('data-user')).toBe('sustain');
    expect(['a', 'note', 'c'].map(id => event(h.session, id).tie)).toEqual(['start', 'continue', 'end']);
    expectValid(h.session);
    h.undoButton.click();
    expect(h.state().event?.time).toEqual(rational(1, 24));
    h.undoButton.click();
    expect(h.state().event?.time).toEqual(rational(1, 12));
    expect(h.session.canUndo).toBe(false);
  });

  it('declares native notation and event selects with explicit values in the unenhanced shell', () => {
    mountAuthorFixture();
    const notation = control<HTMLSelectElement>('staff-notation');
    expect(notation.tagName).toBe('SELECT');
    expect(notation.name).toBe('staff-notation');
    expect(notation.firstElementChild?.tagName).toBe('BUTTON');
    expect(notation.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect([...notation.options].map(option => [option.getAttribute('value'), option.textContent])).toEqual([
      ['pitched', 'Pitched · five lines'], ['rhythm', 'Rhythm · one line'], ['three-roads', '3 roads music · three lines'],
    ]);
    for (const id of ['event-kind', 'selected-kind']) {
      const kind = control<HTMLSelectElement>(id);
      expect(kind.tagName).toBe('SELECT');
      expect(kind.querySelector('option[value="rhythm"]')?.textContent).toContain('no pitch');
      expect(kind.querySelector('option[value="rhythmic-slash"]')).not.toBeNull();
    }
    const microtone = control<HTMLSelectElement>('note-microtone');
    expect(microtone.firstElementChild?.tagName).toBe('BUTTON');
    expect([...microtone.options].map(option => option.getAttribute('value'))).toEqual(['', '-1.5', '-0.5', '0.5', '1.5']);
  });
});
