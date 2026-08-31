// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import authorHtml from '../author.html?raw';
import { analyzeContinuation } from '../src/authoring/continuation.js';
import { EditorSession } from '../src/authoring/editor.js';
import { patchEventFields } from '../src/authoring/event-field-patch.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext } from '../src/authoring/inspector-forms.js';
import { createProject, importProject, parseSource, serializeProject } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';
import { createTemplate, templateOptions } from '../src/authoring/templates.js';
import type { AuthorCommand, EventInput } from '../src/authoring/types.js';
import { readScore, serializeScore } from '../src/dom/index.js';
import { rational } from '../src/model/index.js';
import type { MusicEvent, PitchDirection, StaffNotation } from '../src/model/types.js';

function input(changes: Partial<EventInput> = {}): EventInput {
  const result: EventInput = {
    kind: 'road', pitchDirection: 'same', pitch: 'C4', pitches: 'C4 E4', duration: 'whole', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto', ...changes,
  };
  if (result.kind !== 'road') delete result.pitchDirection;
  return result;
}

function staffSource(body: string, notation: StaffNotation = 'three-roads', measureAttributes = ''): string {
  return `<music-staff id="staff" notation="${notation}" label="Voice"><music-measure id="bar" ${measureAttributes}>${body}</music-measure></music-staff>`;
}

function road(id: string, direction: PitchDirection = 'same', duration = 'whole', attributes = ''): string {
  return `<music-road id="${id}" direction="${direction}" duration="${duration}" ${attributes}></music-road>`;
}

function session(html = staffSource('<music-rest id="n" measure data-user="keep"></music-rest>')): EditorSession {
  return new EditorSession(createProject(html, 'Three roads'));
}

function event(editor: EditorSession, id = 'n'): MusicEvent {
  return editor.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))
    .find(item => item.id === id)!;
}

function attrs(element: Element): Record<string, string> {
  return Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]));
}

function sourceData(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const entries = Object.entries(attrs(element)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    for (const [name, value] of entries) element.setAttribute(name, value);
  }
  return template.innerHTML;
}

function expectValid(editor: EditorSession): void {
  expect(editor.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
}

function expectNoPitchContext(staff: Element): void {
  for (const element of [staff, ...staff.querySelectorAll('music-measure')]) {
    expect(element.hasAttribute('clef')).toBe(false);
    expect(element.hasAttribute('key')).toBe(false);
  }
}

function expectRejected(editor: EditorSession, command: AuthorCommand): void {
  const before = editor.project;
  const root = editor.source;
  const selection = editor.selectionId;
  const revision = editor.revision;
  const undo = editor.canUndo;
  const redo = editor.canRedo;
  expect(() => editor.execute(command)).toThrow();
  expect(editor.project).toEqual(before);
  expect(editor.source).toBe(root);
  expect(editor.selectionId).toBe(selection);
  expect(editor.revision).toBe(revision);
  expect(editor.canUndo).toBe(undo);
  expect(editor.canRedo).toBe(redo);
}

const mixedSource = `<music-system id="score" key="Eb" clef="bass" meter="4/4" bracket="bracket">
  <music-staff id="pitched" label="Bass">
    <music-measure id="p1"><music-direction id="shared" text="Choose a comfortable starting pitch."></music-direction><music-note id="pitch" pitch="Bqf3" duration="whole"></music-note></music-measure>
    <music-measure id="p2" meter="3/4" key="G"><music-rest id="pr2" measure></music-rest></music-measure>
    <music-measure id="p3" meter="5/8" groups="2+3"><music-rest id="pr3" measure></music-rest></music-measure>
  </music-staff>
  <music-staff id="roads" notation="three-roads" label="Voice" data-origin="relative pitch">
    <music-measure id="r1"><!-- retain contour -->
      <music-road id="higher" direction="higher" duration="half" data-user="keep"></music-road>
      <music-road id="same" direction="same" duration="quarter"></music-road>
      <music-road id="lower" direction="lower" duration="quarter"></music-road>
    </music-measure>
    <music-measure id="r2" meter="3/4"><music-tuplet id="triplet" actual="3" normal="2" ratio bracket="yes">
      <music-road id="t1" direction="higher" duration="eighth" beam="start"></music-road>
      <music-road id="t2" direction="same" duration="eighth" beam="continue"></music-road>
      <music-road id="t3" direction="lower" duration="eighth" beam="end"></music-road>
    </music-tuplet><music-rest id="rr2" duration="half"></music-rest></music-measure>
    <music-measure id="r3" meter="5/8" groups="2+3"><music-road id="last" direction="lower" duration="half"></music-road><music-rest id="rr3" duration="eighth"></music-rest></music-measure>
  </music-staff>
</music-system>`;

describe('portable three-roads authoring and musical context', () => {
  it('round-trips directions, exact rhythm, shared instructions, and extracted parts without inherited pitch context', () => {
    const project = createProject(mixedSource, 'Relative contour', [
      { id: 'voice-part', label: 'Voice', staffIds: ['roads'] },
      { id: 'bass-part', label: 'Bass', staffIds: ['pitched'] },
    ]);
    project.instructionScopes.shared = 'all';
    const reopened = importProject(serializeProject(project));
    expect(reopened).toEqual(project);
    expect(reopened.sourceHtml).toBe(mixedSource);
    const before = JSON.stringify(reopened);
    const full = buildProjection(reopened);
    expect(full.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(full.score.staves[0]).toMatchObject({ key: 'Eb', clef: 'bass' });
    const voice = buildProjection(reopened, 'voice-part');
    expect(voice.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(voice.label).toContain('3 roads music');
    expect(voice.label).not.toContain('authored pitch');
    expect(voice.score.staves).toHaveLength(1);
    const staff = voice.score.staves[0];
    expect(staff).toMatchObject({ id: 'roads', notation: 'three-roads', key: 'C', clef: 'treble' });
    expect(staff.measures.every(measure => measure.key === 'C' && measure.clef === 'treble')).toBe(true);
    expect(staff.measures[0].voices[0].events.map(item => [item.id, item.kind, item.pitchDirection, item.pitches, item.rhythmic])).toEqual([
      ['higher', 'road', 'higher', [], false], ['same', 'road', 'same', [], false], ['lower', 'road', 'lower', [], false],
    ]);
    expect(staff.measures[1].voices[0].events.slice(0, 3).map(item => item.time)).toEqual([rational(1, 12), rational(1, 12), rational(1, 12)]);
    expect(voice.source.querySelector('#shared')?.closest('music-measure')?.id).toBe('r1');
    expectNoPitchContext(voice.source.querySelector('#roads')!);
    expect(voice.source.innerHTML).toContain('<!-- retain contour -->');
    expect(JSON.stringify(reopened)).toBe(before);
    const serialized = serializeScore(full.score);
    const readBack = readScore(parseSource(serialized));
    expect(readBack.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(readBack.score).toEqual(full.score);
  });

  it('adds a three-roads staff in one undo step, copying meters but ignoring the selected clef and key', () => {
    const editor = session('<music-staff id="solo" key="G" clef="bass" meter="7/8" groups="2+2+3"><music-measure id="m1"><music-rest id="a" measure></music-rest></music-measure><music-measure id="m2" key="Eb" meter="3/4"><music-rest id="b" measure></music-rest></music-measure></music-staff>');
    const before = editor.project;
    const source = editor.source;
    const result = editor.execute({ type: 'add-staff', notation: 'three-roads', label: 'Relative voice', clef: 'alto' });
    const staff = editor.score.staves[1];
    expect(staff).toMatchObject({ notation: 'three-roads', id: result.selectionId, key: 'C', clef: 'treble' });
    expect(staff.measures.map(measure => [measure.meter.display, measure.key, measure.clef])).toEqual([
      ['7/8', 'C', 'treble'], ['3/4', 'C', 'treble'],
    ]);
    expect(staff.measures.every(measure => measure.voices[0].events[0].measureRest)).toBe(true);
    expectNoPitchContext(editor.source.querySelector(`#${staff.id}`)!);
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(editor.source).toBe(source);
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.project.columns).toEqual(before.columns);
    expect(editor.canUndo).toBe(false);
  });

  it('preserves three-roads notation when set-staff omits the mode and does not write legacy pitch fields', () => {
    const editor = session(staffSource(road('n', 'higher')));
    editor.execute({ type: 'set-staff', staffId: 'staff', label: 'Singers', clef: 'bass', key: 'G' });
    expect(editor.score.staves[0]).toMatchObject({ notation: 'three-roads', label: 'Singers', clef: 'treble', key: 'C' });
    expect(event(editor).pitchDirection).toBe('higher');
    expectNoPitchContext(editor.source);
    expectValid(editor);
  });

  it.each<AuthorCommand>([
    { type: 'duplicate-measures', measureIds: ['r2'] },
    { type: 'append-measure', afterMeasureId: 'r2' },
    { type: 'move-measure', measureId: 'r2', direction: 1 },
  ])('keeps original contour, meter, and neutral context through $type', command => {
    const editor = session(mixedSource);
    const before = editor.score.staves[1].measures;
    const result = editor.execute(command);
    const staff = editor.score.staves[1];
    for (const original of before) {
      const retained = staff.measures.find(measure => measure.id === original.id)!;
      expect(retained).toMatchObject({ meter: original.meter, key: 'C', clef: 'treble', voices: original.voices });
    }
    expectNoPitchContext(editor.source.querySelector('#roads')!);
    expect(editor.score.staves[0].measures).toHaveLength(staff.measures.length);
    if (command.type === 'duplicate-measures') {
      for (const id of ['t1', 't2', 't3']) {
        const copied = result.copiedIds![id];
        expect(copied).toBeTruthy();
        expect(event(editor, copied)).toMatchObject({ kind: 'road', pitchDirection: event(editor, id).pitchDirection, time: rational(1, 12) });
      }
    }
    expectValid(editor);
  });
});

describe('road insertion and scoped direction edits', () => {
  it.each(['higher', 'same', 'lower'] as const)('inserts the explicit %s direction and restores its placeholder with one undo', pitchDirection => {
    const editor = session();
    const before = editor.project.sourceHtml;
    const result = editor.execute({ type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 },
      value: input({ pitchDirection, duration: 'eighth', dots: 1 }), position: 'after' });
    expect(result.selectionId).toBe('n');
    expect(event(editor)).toMatchObject({ kind: 'road', pitchDirection, pitches: [], rhythmic: false, time: rational(3, 16) });
    const node = editor.source.querySelector('#n')!;
    expect(node.getAttribute('direction')).toBe(pitchDirection);
    expect(node.getAttribute('data-user')).toBe('keep');
    expect(node.hasAttribute('pitch')).toBe(false);
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });

  it.each(['higher', 'same', 'lower'] as const)('patches only direction to %s, ignoring unfinished unrelated form values', pitchDirection => {
    const priorDirection = pitchDirection === 'higher' ? 'lower' : 'higher';
    const editor = session(staffSource(`<music-tuplet id="tuplet" actual="3" normal="2">${road('n', priorDirection, '8', 'dotted dots="1" stem="auto" beam="none" data-user="keep"')}${road('b', 'same', '8')}${road('c', 'lower', '8')}</music-tuplet>`, 'three-roads', 'incomplete'));
    editor.select('n');
    const before = editor.project.sourceHtml;
    const original = event(editor);
    const node = editor.source.querySelector('#n')!;
    const parent = node.parentElement;
    const originalAttributes = attrs(node);
    const value = { ...input(), kind: 'chord', pitchDirection, pitch: 'unfinished', pitches: '',
      duration: 'unfinished', dots: NaN, measureRest: true, rhythmic: true, stem: 'left' } as unknown as EventInput;
    editor.execute({ type: 'update-event', eventId: 'n', value, fields: ['pitchDirection'] });
    expect(editor.source.querySelector('#n')).toBe(node);
    expect(node.parentElement).toBe(parent);
    expect(attrs(node)).toEqual({ ...originalAttributes, direction: pitchDirection });
    expect(event(editor)).toEqual({ ...original, pitchDirection });
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#n')).toBe(node);
    expect(editor.canUndo).toBe(false);
  });

  it('preserves literal source and redo history for unchanged or unnamed direction fields', () => {
    const editor = session(staffSource(road('n', 'same', '8', 'dotted dots="1" stem="auto" data-user="keep"'), 'three-roads', 'incomplete'));
    editor.select('n');
    editor.execute({ type: 'update-event', eventId: 'n', value: input({ pitchDirection: 'lower' }), fields: ['pitchDirection'] });
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    editor.execute({ type: 'update-event', eventId: 'n', value: { ...input(), pitchDirection: 'same', duration: 'unfinished' } as unknown as EventInput, fields: ['pitchDirection'] });
    editor.execute({ type: 'update-event', eventId: 'n', value: { ...input(), pitchDirection: 'unfinished' } as unknown as EventInput, fields: [] });
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(revision);
    expect(editor.selectionId).toBe('n');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
  });

  it.each([undefined, '', 'Higher', ' same ', 'up', 1])('rejects invalid direction %s before any other selected field can write', pitchDirection => {
    const editor = session(staffSource(road('n', 'same', '8', 'data-user="keep"'), 'three-roads', 'incomplete'));
    const node = editor.source.querySelector('#n')!;
    const before = editor.source.outerHTML;
    const invalid = { ...input({ stem: 'down' }), pitchDirection } as unknown as EventInput;
    expect(() => patchEventFields(node, event(editor), invalid, ['stem', 'pitchDirection'])).toThrow();
    expect(editor.source.outerHTML).toBe(before);
    expectRejected(editor, { type: 'update-event', eventId: 'n', value: invalid, fields: ['stem', 'pitchDirection'] });
  });

  it.each(['stem', 'beam', 'duration', 'dots'] as const)('preserves direction and tuplet membership during an unrelated %s patch', field => {
    const editor = session(staffSource(`<music-tuplet id="triplet" actual="3" normal="2">${road('n', 'lower', '8', 'dots="0" stem="auto" beam="none" data-user="keep"')}${road('b', 'same', '8')}${road('c', 'higher', '8')}</music-tuplet>`, 'three-roads', 'incomplete'));
    const node = editor.source.querySelector('#n')!;
    const parent = node.parentElement;
    const expected = attrs(node);
    if (field === 'stem') expected.stem = 'down';
    if (field === 'beam') delete expected.beam;
    if (field === 'duration') expected.duration = 'sixteenth';
    if (field === 'dots') expected.dots = '1';
    const originalTuplets = editor.score.staves[0].measures[0].voices[0].tuplets;
    const value = { ...input({ stem: 'down', beam: 'auto', duration: 'sixteenth', dots: 1 }), pitchDirection: 'unfinished' } as unknown as EventInput;
    editor.execute({ type: 'update-event', eventId: 'n', value, fields: [field] });
    expect(attrs(node)).toEqual(expected);
    expect(node.parentElement).toBe(parent);
    expect(event(editor)).toMatchObject({ kind: 'road', pitchDirection: 'lower', pitches: [], tupletIds: ['triplet'] });
    expect(editor.score.staves[0].measures[0].voices[0].tuplets).toEqual(originalTuplets);
    expectValid(editor);
  });

  it('requires a direction for road insertion and does not apply a named direction to a rest or pitched note', () => {
    const editor = session();
    expectRejected(editor, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 },
      value: input({ pitchDirection: undefined }), position: 'after' });
    expectRejected(editor, { type: 'update-event', eventId: 'n', value: input(), fields: ['pitchDirection'] });
    const pitched = session(staffSource('<music-note id="n" pitch="C4" duration="whole"></music-note>', 'pitched'));
    expectRejected(pitched, { type: 'update-event', eventId: 'n', value: input(), fields: ['pitchDirection'] });
  });
});

describe('three-roads admission and deliberate conversions', () => {
  it.each<[StaffNotation, EventInput]>([
    ['pitched', input()], ['rhythm', input()],
    ['three-roads', input({ kind: 'note' })], ['three-roads', input({ kind: 'chord' })],
    ['three-roads', input({ kind: 'rhythm' })], ['three-roads', input({ kind: 'slash' })],
    ['three-roads', input({ kind: 'slash', rhythmic: true })],
    ['pitched', input({ kind: 'rhythm' })], ['rhythm', input({ kind: 'note' })], ['rhythm', input({ kind: 'chord' })],
  ])('rejects incompatible insertion and replacement on %s without accepting a different event meaning', (notation, value) => {
    const editor = session(staffSource('<music-rest id="n" duration="whole"></music-rest>', notation));
    editor.select('n');
    expectRejected(editor, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'n' }, value, position: 'replace' });
    expectRejected(editor, { type: 'update-event', eventId: 'n', value });
    expect(editor.source.querySelector('#n')?.localName).toBe('music-rest');
  });

  it.each(['pitched', 'rhythm'] as const)('rejects road conversion on %s and preserves existing road material when leaving its staff mode', notation => {
    const editor = session(staffSource('<music-rest id="n" duration="whole"></music-rest>', notation));
    expectRejected(editor, { type: 'convert-events', eventIds: ['n'], kind: 'road', pitchDirection: 'higher', rhythmic: false, pitch: '' });
    const roads = session(staffSource(road('n', 'higher')));
    expectRejected(roads, { type: 'set-staff', staffId: 'staff', label: 'Keep contour', clef: 'treble', key: 'C', notation });
  });

  it('does not silently relabel existing rhythm notes or slashes as a three-roads staff', () => {
    for (const [notation, markup] of [
      ['rhythm', '<music-rhythm id="n" duration="whole"></music-rhythm>'],
      ['rhythm', '<music-slash id="n" duration="whole" rhythmic></music-slash>'],
      ['pitched', '<music-slash id="n" duration="whole"></music-slash>'],
    ] as const) {
      const editor = session(staffSource(markup, notation));
      expectRejected(editor, { type: 'set-staff', staffId: 'staff', label: 'Keep the meaning', notation: 'three-roads', key: 'C', clef: 'treble' });
      expect(editor.source.querySelector('#n')?.hasAttribute('direction')).toBe(false);
    }
  });

  it('requires an explicit rest intermediary before converting pitched content into road events', () => {
    const editor = session('<music-staff id="staff" key="G" clef="bass"><music-measure id="bar"><music-note id="n" pitch="Bqf3" duration="whole" data-user="keep"></music-note></music-measure></music-staff>');
    const mode: AuthorCommand = { type: 'set-staff', staffId: 'staff', label: 'Relative voice', notation: 'three-roads', key: 'G', clef: 'bass' };
    expectRejected(editor, mode);
    editor.execute({ type: 'convert-events', eventIds: ['n'], kind: 'rest', rhythmic: false, pitch: '' });
    editor.execute(mode);
    const beforeConversion = editor.project.sourceHtml;
    expectRejected(editor, { type: 'convert-events', eventIds: ['n'], kind: 'road', rhythmic: false, pitch: '' });
    editor.execute({ type: 'convert-events', eventIds: ['n'], kind: 'road', pitchDirection: 'higher', rhythmic: false, pitch: '' });
    expect(event(editor)).toMatchObject({ kind: 'road', pitchDirection: 'higher', pitches: [], time: rational(1) });
    expect(editor.source.querySelector('#n')?.getAttribute('data-user')).toBe('keep');
    expectNoPitchContext(editor.source);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(beforeConversion));
    expect(event(editor)).toMatchObject({ kind: 'rest', pitches: [] });
    expect(event(editor).pitchDirection).toBeUndefined();
  });

  it('accepts an explicit staff-and-event Source conversion atomically with one undo', () => {
    const original = staffSource('<music-note id="n" pitch="Fqs4" duration="whole" data-user="keep"></music-note>', 'pitched');
    const editor = session(original);
    editor.applySource(staffSource(road('n', 'lower', 'whole', 'data-user="keep"')));
    expect(editor.revision).toBe(1);
    expect(event(editor)).toMatchObject({ kind: 'road', pitchDirection: 'lower', pitches: [] });
    expect(editor.score.staves[0].notation).toBe('three-roads');
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(original));
    expect(event(editor).pitches[0].alter).toBe(0.5);
    expect(editor.canUndo).toBe(false);
  });

  it.each<AuthorCommand>([
    { type: 'set-measure', measureId: 'bar', values: { key: 'C' } },
    { type: 'set-measure', measureId: 'bar', values: { clef: 'treble' } },
  ])('rejects even neutral explicit measure pitch context on three roads', command => {
    const editor = session();
    expectRejected(editor, command);
    expectNoPitchContext(editor.source);
  });

  it('blocks an oversized road continuation rather than splitting it into new attacks or ties', () => {
    const editor = session(staffSource(road('n', 'higher')));
    editor.select('n');
    const command: Extract<AuthorCommand, { type: 'append-and-insert' }> = {
      type: 'append-and-insert', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'n' },
      value: input({ pitchDirection: 'higher', duration: 'breve' }), position: 'after',
    };
    const analysis = analyzeContinuation(editor.source, command);
    expect(analysis.eligible).toBe(false);
    expect(analysis.reason).toContain('Continuation does not split events');
    expectRejected(editor, command);
    expect(editor.source.querySelectorAll('music-measure')).toHaveLength(1);
    expect(editor.source.querySelectorAll('music-road')).toHaveLength(1);
    expect(editor.source.querySelectorAll('[tie]')).toHaveLength(0);
  });
});

describe('road ties and written rhythmic value', () => {
  it.each(['higher', 'same', 'lower'] as const)('allows a %s tie start followed by same directions across a barline', direction => {
    const editor = session(`<music-staff id="staff" notation="three-roads"><music-measure id="m1">${road('a', direction)}</music-measure><music-measure id="m2">${road('b', 'same', 'half')}${road('c', 'same', 'half')}</music-measure></music-staff>`);
    const before = editor.project.sourceHtml;
    editor.execute({ type: 'tie-events', eventIds: ['c', 'a', 'b'] });
    expect(['a', 'b', 'c'].map(id => event(editor, id).tie)).toEqual(['start', 'continue', 'end']);
    expect(event(editor, 'a').pitchDirection).toBe(direction);
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });

  it('rejects a changing direction after the tie start and does not consume accepted redo history', () => {
    const editor = session(staffSource(road('a', 'higher', 'quarter', 'tie="start"') + road('b', 'same', 'half', 'tie="continue"') + road('c', 'same', 'quarter', 'tie="end"')));
    editor.select('b');
    editor.execute({ type: 'update-event', eventId: 'a', value: input({ pitchDirection: 'lower' }), fields: ['pitchDirection'] });
    editor.undo();
    for (const [eventId, pitchDirection] of [['b', 'higher'], ['c', 'lower']] as const) {
      expectRejected(editor, { type: 'update-event', eventId, value: input({ pitchDirection }), fields: ['pitchDirection'] });
    }
    expect(['a', 'b', 'c'].map(id => event(editor, id).tie)).toEqual(['start', 'continue', 'end']);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(event(editor, 'a').pitchDirection).toBe('lower');
    expectValid(editor);
  });

  it('rejects ties that imply a new direction or cross silence', () => {
    const changing = session(staffSource(road('a', 'higher', 'half') + road('b', 'lower', 'half')));
    expectRejected(changing, { type: 'tie-events', eventIds: ['a', 'b'] });
    const silence = session(staffSource(road('a', 'higher', 'half') + '<music-rest id="b" duration="half"></music-rest>'));
    expectRejected(silence, { type: 'tie-events', eventIds: ['a', 'b'] });
  });

  it('retains road direction, ties, beams, source identity, and exact tuplet time during duration and dot edits', () => {
    const editor = session(staffSource(`<music-tuplet id="triplet" actual="3" normal="2">${road('a', 'higher', '8', 'tie="start" beam="start"')}${road('n', 'same', '8', 'tie="continue" beam="continue" data-user="sustain"')}${road('c', 'same', '8', 'tie="end" beam="end"')}</music-tuplet>`, 'three-roads', 'meter="1/4"'));
    const before = editor.project.sourceHtml;
    const node = editor.source.querySelector('#n')!;
    const group = node.parentElement;
    const tuplets = editor.score.staves[0].measures[0].voices[0].tuplets;
    editor.execute({ type: 'update-event', eventId: 'n', value: input({ pitchDirection: 'lower', duration: 'sixteenth' }), fields: ['duration'] });
    expect(event(editor)).toMatchObject({ pitchDirection: 'same', time: rational(1, 24), tie: 'continue', beam: 'continue' });
    editor.execute({ type: 'set-event-rhythm', eventId: 'n', duration: 'sixteenth', dots: 1 });
    expect(event(editor)).toMatchObject({ kind: 'road', pitchDirection: 'same', time: rational(1, 16), tie: 'continue', tupletIds: ['triplet'] });
    expect(editor.source.querySelector('#n')).toBe(node);
    expect(node.parentElement).toBe(group);
    expect(node.getAttribute('data-user')).toBe('sustain');
    expect(editor.score.staves[0].measures[0].voices[0].tuplets).toEqual(tuplets);
    expectValid(editor);
    editor.undo();
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });
});

// Use the authored controls without importing main or starting a render surface.
const shellMarkup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const uiCleanups: (() => void)[] = [];

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing real author control ${id}`);
  return result as T;
}

function inspectorFixture(source: string, selectionId = 'n') {
  document.body.innerHTML = shellMarkup;
  const editor = session(source);
  const context: InspectorContext = { mode: 'write', partId: 'score', cursor: { staffId: '', measureId: '', voiceIndex: 0 } };
  let forms: InspectorForms | undefined;
  const select = (id: string): void => {
    for (const staff of editor.score.staves) for (const measure of staff.measures) {
      for (const [voiceIndex, voice] of measure.voices.entries()) {
        if (!voice.events.some(item => item.id === id)) continue;
        context.selectionId = id;
        context.rangeEventIds = [id];
        context.cursor = { staffId: staff.id, measureId: measure.id, voiceIndex, eventId: id };
        editor.select(id);
        forms?.refresh();
        return;
      }
    }
    throw new Error(`Missing selected fixture event ${id}`);
  };
  select(selectionId);
  forms = new InspectorForms({ session: editor, context: () => context, select });
  const refresh = () => forms!.refresh();
  editor.addEventListener('change', refresh);
  uiCleanups.push(() => { editor.removeEventListener('change', refresh); forms!.dispose(); });
  return { editor, forms, select };
}

function changeDirection(direction: PitchDirection): void {
  const select = control<HTMLSelectElement>('selected-direction');
  select.value = direction;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('three-roads controls and inspector drafts in the real shell', () => {
  afterEach(() => {
    uiCleanups.splice(0).forEach(cleanup => cleanup());
    document.body.replaceChildren();
  });

  it('offers explicit native direction choices and an unwritten three-roads draft template', () => {
    document.body.innerHTML = shellMarkup;
    for (const id of ['event-direction', 'selected-direction']) {
      const select = control<HTMLSelectElement>(id);
      expect(select.tagName).toBe('SELECT');
      expect(select.firstElementChild?.tagName).toBe('BUTTON');
      expect(select.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
      expect([...select.options].map(option => [option.getAttribute('value'), option.textContent])).toEqual([
        ['higher', 'Higher (top)'], ['same', 'Same (middle)'], ['lower', 'Lower (bottom)'],
      ]);
    }
    expect(control('staff-notation').querySelector('option[value="three-roads"]')).not.toBeNull();
    expect(control('event-kind').querySelector('option[value="road"]')).not.toBeNull();
    expect(templateOptions.some(option => option.value === 'three-roads')).toBe(true);
    const template = new EditorSession(createTemplate('three-roads'));
    expect(template.score.staves[0]).toMatchObject({ notation: 'three-roads', clef: 'treble', key: 'C' });
    expect(template.score.staves[0].measures[0]).toMatchObject({ incomplete: true, pickup: false, voices: [{ events: [] }] });
    expectNoPitchContext(template.source);
    expectValid(template);
  });

  it('keeps a direction draft separate from insertion values and merges an unrelated accepted stem edit', () => {
    const h = inspectorFixture(staffSource(road('n', 'lower', '8', 'dotted dots="1" stem="auto" beam="none" data-user="keep"'), 'three-roads', 'incomplete'));
    const node = h.editor.source.querySelector('#n')!;
    const originalAttributes = attrs(node);
    const entry = control<HTMLSelectElement>('event-direction');
    entry.value = 'higher';
    expect(control<HTMLSelectElement>('selected-direction').value).toBe('lower');
    expect(control('selected-direction-field').hidden).toBe(false);
    expect(control('event-form-context').textContent).toContain('Lower (bottom)');
    for (const id of ['staff-clef', 'staff-key', 'measure-clef', 'measure-key']) {
      expect(control<HTMLInputElement>(id).disabled).toBe(true);
    }
    changeDirection('same');
    expect(h.forms.snapshot('selected').dirtyFields).toEqual(['pitchDirection']);
    expect(event(h.editor).pitchDirection).toBe('lower');
    expect(h.editor.canUndo).toBe(false);
    h.editor.execute({ type: 'update-event', eventId: 'n', value: input({ stem: 'up' }), fields: ['stem'] });
    const resolution = h.forms.resolve('selected');
    expect(resolution.patch).toEqual({ pitchDirection: 'same' });
    expect(resolution.values.stem).toBe('up');
    h.editor.execute({ type: 'update-event', eventId: resolution.targetId,
      value: input({ pitchDirection: resolution.values.pitchDirection as PitchDirection }), fields: ['pitchDirection'] });
    h.forms.commit('selected');
    expect(attrs(node)).toEqual({ ...originalAttributes, stem: 'up', direction: 'same' });
    expect(entry.value).toBe('higher');
    expect(h.forms.snapshot('selected').dirty).toBe(false);
    expect(h.editor.revision).toBe(2);
    h.editor.undo();
    expect(attrs(node)).toEqual({ ...originalAttributes, stem: 'up' });
    expect(control<HTMLSelectElement>('selected-direction').value).toBe('lower');
    expectValid(h.editor);
  });

  it('keeps dirty direction and kind choices bound to the road event when another staff is selected', () => {
    const h = inspectorFixture(mixedSource, 'higher');
    const original = h.editor.project;
    changeDirection('lower');
    h.select('pitch');
    const snapshot = h.forms.snapshot('selected');
    expect(snapshot.targetId).toBe('higher');
    expect(snapshot.matchesSelection).toBe(false);
    expect(snapshot.canApply).toBe(false);
    expect(control<HTMLSelectElement>('selected-direction').value).toBe('lower');
    const kinds = control<HTMLSelectElement>('selected-kind');
    expect([...kinds.options].filter(option => !option.disabled).map(option => option.value)).toEqual(['road', 'rest']);
    expect(() => h.forms.resolve('selected')).toThrow('Return to this draft');
    expect(h.editor.project).toEqual(original);
    control<HTMLButtonElement>('return-selected-draft').click();
    expect(h.editor.selectionId).toBe('higher');
    const resolution = h.forms.resolve('selected');
    expect(resolution.patch).toEqual({ pitchDirection: 'lower' });
    h.editor.execute({ type: 'update-event', eventId: resolution.targetId,
      value: input({ pitchDirection: 'lower' }), fields: ['pitchDirection'] });
    h.forms.commit('selected');
    expect(event(h.editor, 'higher').pitchDirection).toBe('lower');
    expect(event(h.editor, 'pitch').pitches[0]).toMatchObject({ step: 'B', octave: 3, alter: -0.5 });
    expect(h.editor.revision).toBe(1);
    h.editor.undo();
    expect(event(h.editor, 'higher').pitchDirection).toBe('higher');
    expect(h.editor.canUndo).toBe(false);
    expectValid(h.editor);
  });
});
