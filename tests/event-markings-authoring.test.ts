// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { EditorSession } from '../src/authoring/editor.js';
import { EventMarkingsEditor } from '../src/authoring/event-markings-editor.js';
import type { EventMarkingsContext } from '../src/authoring/event-markings-editor.js';
import { createProject, importProject, parseSource, serializeProject } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';
import type { AuthorCommand, EventInput, EventMarkingField, EventMarkingInput } from '../src/authoring/types.js';
import { readScore, serializeScore } from '../src/dom/index.js';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, harmonyIntervalOffset, rational } from '../src/model/index.js';
import type { EventMarking, MusicEvent, StaffNotation } from '../src/model/types.js';

const TARGETS = {
  note: { notation: 'pitched', tag: 'music-note', attributes: 'pitch="Fqs4"' },
  chord: { notation: 'pitched', tag: 'music-chord', attributes: 'pitches="C4 E4 G4"' },
  rhythm: { notation: 'rhythm', tag: 'music-rhythm', attributes: '' },
  road: { notation: 'three-roads', tag: 'music-road', attributes: 'direction="higher"' },
  rhythmicSlash: { notation: 'pitched', tag: 'music-slash', attributes: 'rhythmic' },
  openSlash: { notation: 'pitched', tag: 'music-slash', attributes: '' },
  rest: { notation: 'pitched', tag: 'music-rest', attributes: '' },
  measureRest: { notation: 'pitched', tag: 'music-rest', attributes: 'measure' },
} as const;
type TargetKind = keyof typeof TARGETS;

function staff(body: string, notation: StaffNotation = 'pitched', measureAttributes = ''): string {
  return `<music-staff id="staff" notation="${notation}" label="Voice"><music-measure id="bar" ${measureAttributes}>${body}</music-measure></music-staff>`;
}

function sourceFor(kind: TargetKind = 'note', children = ''): string {
  const target = TARGETS[kind];
  return staff(`<${target.tag} id="n" ${target.attributes} duration="whole" data-user="keep">${children}</${target.tag}>`, target.notation);
}

function session(source = sourceFor()): EditorSession {
  return new EditorSession(createProject(source, 'Attached event markings'));
}

function event(editor: EditorSession, id = 'n'): MusicEvent {
  return editor.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))
    .find(item => item.id === id)!;
}

function markings(editor: EditorSession, id = 'n'): readonly EventMarking[] {
  return event(editor, id).markings ?? [];
}

function input(changes: Partial<EventInput> = {}): EventInput {
  return {
    kind: 'note', pitch: 'D4', pitches: 'D4 F4', duration: 'whole', dots: 0, rhythmic: false,
    measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto', ...changes,
  };
}

function attrs(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

/** Undo may restore attribute order differently without changing authored data. */
function sourceData(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('*')) {
    const entries = Object.entries(attrs(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of entries) node.setAttribute(name, value);
  }
  return template.innerHTML;
}

function expectValid(editor: EditorSession): void {
  expect(editor.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
}

function expectRejected(editor: EditorSession, command: AuthorCommand): void {
  const before = editor.project;
  const root = editor.source;
  const nodes = [...root.querySelectorAll('*')];
  const revision = editor.revision;
  const selection = editor.selectionId;
  const cursor = editor.cursor;
  const undo = editor.canUndo;
  const redo = editor.canRedo;
  expect(() => editor.execute(command)).toThrow();
  expect(editor.project).toEqual(before);
  expect(editor.source).toBe(root);
  const afterNodes = [...root.querySelectorAll('*')];
  expect(afterNodes).toHaveLength(nodes.length);
  nodes.forEach((node, index) => expect(afterNodes[index]).toBe(node));
  expect(editor.revision).toBe(revision);
  expect(editor.selectionId).toBe(selection);
  expect(editor.cursor).toEqual(cursor);
  expect(editor.canUndo).toBe(undo);
  expect(editor.canRedo).toBe(redo);
}

const decorated = '<!-- before accent --><music-articulation id="accent" type="accent" placement="auto" data-user="emphasis"><!-- preserve inside --></music-articulation><!-- between --><music-ornament id="ornament" type="trill" data-user="ornament"></music-ornament><!-- after ornament -->';

describe('event marking author commands and source ownership', () => {
  it.each<[TargetKind, EventMarkingInput]>([
    ['note', { kind: 'articulation', type: 'accent', placement: 'auto' }],
    ['chord', { kind: 'articulation', type: 'marcato', placement: 'above' }],
    ['rhythm', { kind: 'articulation', type: 'staccato', placement: 'below' }],
    ['road', { kind: 'articulation', type: 'tenuto', placement: 'auto' }],
    ['rhythmicSlash', { kind: 'articulation', type: 'staccatissimo', placement: 'above' }],
    ['openSlash', { kind: 'articulation', type: 'fermata', placement: 'above' }],
    ['rest', { kind: 'articulation', type: 'fermata', placement: 'below' }],
    ['measureRest', { kind: 'articulation', type: 'fermata', placement: 'auto' }],
    ['note', { kind: 'ornament', type: 'upper-mordent', placement: 'above' }],
    ['road', { kind: 'ornament', type: 'inverted-turn', placement: 'below' }],
  ])('attaches an allowed marking to %s without changing event attributes, time, or owner selection', (kind, value) => {
    const editor = session(sourceFor(kind, '<!-- keep this comment -->'));
    const original = editor.project.sourceHtml;
    const beforeEvent = event(editor);
    const node = editor.source.querySelector('#n')!;
    const beforeAttributes = attrs(node);
    const comment = node.firstChild;
    const result = editor.execute({ type: 'add-event-marking', eventId: 'n', value });
    expect(result.selectionId).toBe('n');
    expect(editor.selectionId).toBe('n');
    expect(editor.cursor).toEqual({ staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'n' });
    expect(attrs(node)).toEqual(beforeAttributes);
    expect(node.firstChild).toBe(comment);
    expect(markings(editor)).toHaveLength(1);
    expect(markings(editor)[0]).toMatchObject(value);
    expect(editor.source.querySelector(`[id="${markings(editor)[0].id}"]`)?.parentElement).toBe(node);
    expect(event(editor).time).toEqual(beforeEvent.time);
    expect(event(editor).pitches).toEqual(beforeEvent.pitches);
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(original));
    expect(editor.source.querySelector('#n')).toBe(node);
    expect(editor.canUndo).toBe(false);
  });

  it('applies add, update, and remove as one transaction, retaining existing child identity and fresh IDs on redo', () => {
    const editor = session(sourceFor('road', decorated));
    editor.select('n');
    const before = editor.project.sourceHtml;
    const node = editor.source.querySelector('#n')!;
    const accent = editor.source.querySelector('#accent')!;
    const childComments = [...node.childNodes].filter(child => child.nodeType === 8);
    const beforeAttributes = attrs(node);
    const result = editor.execute({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'accent', value: { kind: 'articulation', type: 'tenuto', placement: 'below' }, fields: ['type'] },
      { type: 'remove', markingId: 'ornament' },
      { type: 'add', value: { kind: 'interval', value: 'b3', placement: 'below' } },
    ] });
    expect(result.selectionId).toBe('n');
    expect(attrs(node)).toEqual(beforeAttributes);
    expect(editor.source.querySelector('#accent')).toBe(accent);
    expect(accent.getAttribute('placement')).toBe('auto');
    expect(accent.getAttribute('data-user')).toBe('emphasis');
    expect(accent.innerHTML).toBe('<!-- preserve inside -->');
    expect([...node.childNodes].filter(child => child.nodeType === 8)).toEqual(childComments);
    expect(editor.source.querySelector('#ornament')).toBeNull();
    const interval = markings(editor).find(marking => marking.kind === 'interval')!;
    expect(interval).toMatchObject({ kind: 'interval', interval: { number: 3, alter: -1 }, placement: 'below' });
    if (interval.kind !== 'interval') throw new Error('Expected the inserted interval.');
    expect(harmonyIntervalOffset(interval.interval, interval.placement)).toBe(-3);
    expect(event(editor).pitches).toEqual([]);
    expect(event(editor).pitchDirection).toBe('higher');
    expect(event(editor).time).toEqual(rational(1));
    expect(editor.revision).toBe(1);
    expectValid(editor);
    const addedId = interval.id;
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#accent')).toBe(accent);
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(markings(editor).map(marking => marking.id)).toContain(addedId);
    expect(editor.source.querySelector('#ornament')).toBeNull();
  });

  it.each<{
    markup: string; value: EventMarkingInput; fields: readonly EventMarkingField[]; changed: Record<string, string>;
  }>([
    { markup: '<music-articulation id="mark" type="accent" placement="auto" data-user="keep"></music-articulation>',
      value: { kind: 'articulation', type: 'unfinished', placement: 'below' } as unknown as EventMarkingInput,
      fields: ['placement'], changed: { placement: 'below' } },
    { markup: '<music-ornament id="mark" type="trill" data-user="keep"></music-ornament>',
      value: { kind: 'ornament', type: 'turn', placement: 'unfinished' } as unknown as EventMarkingInput,
      fields: ['type'], changed: { type: 'turn' } },
    { markup: '<music-interval id="mark" value="♭3" placement="above" data-user="keep"></music-interval>',
      value: { kind: 'interval', value: 'unfinished', placement: 'below' },
      fields: ['placement'], changed: { placement: 'below' } },
  ])('updates only $fields while preserving unrelated raw values and source spelling', ({ markup, value, fields, changed }) => {
    const editor = session(sourceFor('road', `<!-- before -->${markup}<!-- after -->`));
    const node = editor.source.querySelector('#mark')!;
    const parent = node.parentElement;
    const before = attrs(node);
    const beforeTime = event(editor).time;
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'mark', value, fields });
    expect(editor.source.querySelector('#mark')).toBe(node);
    expect(node.parentElement).toBe(parent);
    expect(attrs(node)).toEqual({ ...before, ...changed });
    expect(parent!.innerHTML).toContain('<!-- before -->');
    expect(parent!.innerHTML).toContain('<!-- after -->');
    expect(event(editor).time).toEqual(beforeTime);
    expectValid(editor);
  });

  it('keeps interval aliases, explicit defaults, source metadata, and redo for semantic or empty updates', () => {
    const editor = session(sourceFor('road', `${decorated}<music-interval id="interval" value="♭3" placement="below" data-user="keep"></music-interval>`));
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'accent', value: { kind: 'articulation', type: 'tenuto', placement: 'auto' } });
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'interval', value: { kind: 'interval', value: 'b3', placement: 'above' }, fields: ['value'] });
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'accent', value: { kind: 'articulation', type: 'accent', placement: 'auto' } });
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'ornament', value: { kind: 'ornament', type: 'trill', placement: 'above' } });
    editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'interval', value: { kind: 'articulation', type: 'unfinished', placement: 'unfinished' } as unknown as EventMarkingInput, fields: [] });
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
  });

  it.each<EventMarkingInput>([
    { kind: 'articulation', type: 'unfinished', placement: 'auto' } as unknown as EventMarkingInput,
    { kind: 'ornament', type: 'trill', placement: 'auto' } as unknown as EventMarkingInput,
    { kind: 'interval', value: '14', placement: 'below' },
    { kind: 'interval', value: 'b3', placement: 'auto' } as unknown as EventMarkingInput,
  ])('rejects an invalid marking after an otherwise valid batch edit without applying either', invalid => {
    const editor = session(sourceFor('road', decorated));
    editor.select('accent');
    expectRejected(editor, { type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'accent', value: { kind: 'articulation', type: 'tenuto', placement: 'auto' } },
      { type: 'add', value: invalid },
    ] });
    expect(editor.source.querySelector('#accent')?.getAttribute('type')).toBe('accent');
  });

  it('rejects wrong owners, marking family changes, and duplicate target edits without changing accepted source', () => {
    const editor = session(staff('<music-note id="n" pitch="C4" duration="half"><music-articulation id="accent" type="accent"></music-articulation></music-note><music-note id="other" pitch="D4" duration="half"><music-ornament id="other-mark" type="trill"></music-ornament></music-note>'));
    expectRejected(editor, { type: 'remove-event-marking', eventId: 'n', markingId: 'other-mark' });
    expectRejected(editor, { type: 'update-event-marking', eventId: 'n', markingId: 'other-mark', value: { kind: 'ornament', type: 'turn', placement: 'above' } });
    expectRejected(editor, { type: 'update-event-marking', eventId: 'n', markingId: 'accent', value: { kind: 'ornament', type: 'turn', placement: 'above' }, fields: ['placement'] });
    expectRejected(editor, { type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'accent', value: { kind: 'articulation', type: 'tenuto', placement: 'auto' } },
      { type: 'remove', markingId: 'accent' },
    ] });
  });

  it.each<[TargetKind, EventMarkingInput]>([
    ['rest', { kind: 'articulation', type: 'accent', placement: 'auto' }],
    ['openSlash', { kind: 'articulation', type: 'staccato', placement: 'below' }],
    ['chord', { kind: 'ornament', type: 'trill', placement: 'above' }],
    ['rhythm', { kind: 'ornament', type: 'turn', placement: 'below' }],
    ['note', { kind: 'interval', value: 'b3', placement: 'below' }],
  ])('rejects an incompatible marking on %s without changing the event meaning', (kind, value) => {
    const editor = session(sourceFor(kind));
    expectRejected(editor, { type: 'add-event-marking', eventId: 'n', value });
    expect(markings(editor)).toEqual([]);
  });
});

describe('ordinary event edits and conversion retain attached source', () => {
  it.each<AuthorCommand>([
    { type: 'set-note-pitch', eventId: 'n', pitch: 'Gqs4', ties: 'reject' },
    { type: 'set-note-accidental', eventId: 'n', alter: -0.5, ties: 'reject' },
    { type: 'set-event-rhythm', eventId: 'n', duration: 'half', dots: 1 },
    { type: 'update-event', eventId: 'n', value: input({ stem: 'down' }), fields: ['stem'] },
    { type: 'update-event', eventId: 'n', value: input({ pitch: 'D4' }) },
  ])('preserves marking nodes, IDs, comments, and metadata during $type', command => {
    const editor = session(sourceFor('note', decorated));
    const node = editor.source.querySelector('#n')!;
    const children = [...node.childNodes];
    const before = node.innerHTML;
    const model = markings(editor);
    editor.execute(command);
    expect(editor.source.querySelector('#n')).toBe(node);
    expect(node.childNodes).toHaveLength(children.length);
    children.forEach((child, index) => expect(node.childNodes[index]).toBe(child));
    expect(node.innerHTML).toBe(before);
    expect(markings(editor)).toEqual(model);
    expectValid(editor);
  });

  it.each(['pitchDirection', 'duration'] as const)('preserves attached road intervals and exact tuplet membership while editing %s', field => {
    const editor = session(staff('<music-tuplet id="triplet" actual="3" normal="2"><music-road id="n" direction="higher" duration="8" data-user="keep"><music-interval id="interval" value="♭3" placement="below"></music-interval></music-road><music-road id="b" direction="same" duration="8"></music-road><music-road id="c" direction="lower" duration="8"></music-road></music-tuplet>', 'three-roads', 'incomplete'));
    const node = editor.source.querySelector('#n')!;
    const mark = node.firstElementChild;
    const parent = node.parentElement;
    const before = mark!.outerHTML;
    const tuplets = editor.score.staves[0].measures[0].voices[0].tuplets;
    editor.execute({ type: 'update-event', eventId: 'n', value: input({ kind: 'road', pitchDirection: 'lower', duration: 'sixteenth' }), fields: [field] });
    expect(node.firstElementChild).toBe(mark);
    expect(mark!.outerHTML).toBe(before);
    expect(node.parentElement).toBe(parent);
    expect(editor.score.staves[0].measures[0].voices[0].tuplets).toEqual(tuplets);
    expect(event(editor).time).toEqual(field === 'duration' ? rational(1, 24) : rational(1, 12));
    expectValid(editor);
  });

  it('preserves articulation children through a compatible note-to-chord kind replacement and undo', () => {
    const editor = session(sourceFor('note', '<!-- before --><music-articulation id="accent" type="accent" data-user="keep"></music-articulation><!-- after -->'));
    const before = editor.project.sourceHtml;
    const mark = editor.source.querySelector('#accent')!;
    const contents = editor.source.querySelector('#n')!.innerHTML;
    editor.execute({ type: 'update-event', eventId: 'n', value: input({ kind: 'chord', pitches: 'D4 F4' }), fields: ['kind'] });
    const chord = editor.source.querySelector('#n')!;
    expect(chord.localName).toBe('music-chord');
    expect(chord.innerHTML).toBe(contents);
    expect(editor.source.querySelector('#accent')).toBe(mark);
    expect(mark.parentElement).toBe(chord);
    expect(chord.getAttribute('data-user')).toBe('keep');
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#accent')).toBe(mark);
    expect(editor.canUndo).toBe(false);
  });

  it('retains a fermata and its child identity when explicitly converting a note to a rest', () => {
    const editor = session(sourceFor('note', '<music-articulation id="fermata" type="fermata" placement="above" data-user="keep"></music-articulation>'));
    const mark = editor.source.querySelector('#fermata')!;
    editor.execute({ type: 'convert-events', eventIds: ['n'], kind: 'rest', rhythmic: false, pitch: '' });
    expect(event(editor)).toMatchObject({ kind: 'rest', pitches: [], time: rational(1) });
    expect(editor.source.querySelector('#fermata')).toBe(mark);
    expect(mark.parentElement?.localName).toBe('music-rest');
    expect(mark.getAttribute('data-user')).toBe('keep');
    expectValid(editor);
  });

  it.each<[TargetKind, string, AuthorCommand]>([
    ['note', '<music-ornament id="mark" type="trill"></music-ornament>',
      { type: 'update-event', eventId: 'n', value: input({ kind: 'chord' }), fields: ['kind'] }],
    ['road', '<music-interval id="mark" value="b3" placement="below"></music-interval>',
      { type: 'convert-events', eventIds: ['n'], kind: 'rest', rhythmic: false, pitch: '' }],
  ])('rejects incompatible %s conversion until the marking is deliberately removed', (kind, markup, command) => {
    const editor = session(sourceFor(kind, markup));
    expectRejected(editor, command);
    editor.execute({ type: 'remove-event-marking', eventId: 'n', markingId: 'mark' });
    editor.execute(command);
    expect(editor.source.querySelector('#mark')).toBeNull();
    expect(markings(editor)).toEqual([]);
    expectValid(editor);
    editor.undo();
    editor.undo();
    expect(editor.source.querySelector('#mark')?.parentElement?.id).toBe('n');
    expect(editor.canUndo).toBe(false);
  });
});

function tiedRoadSource(tied = true, continuationIntervals = true): string {
  const first = '<music-interval id="a-third" value="b3" placement="below"></music-interval><music-interval id="a-fifth" value="5" placement="above"></music-interval>';
  const second = continuationIntervals ? '<music-interval id="b-fifth" value="5" placement="above"></music-interval><music-interval id="b-third" value="b3" placement="below"></music-interval>' : '';
  return staff(`<music-road id="a" direction="higher" duration="half"${tied ? ' tie="start"' : ''}>${first}</music-road><music-road id="b" direction="same" duration="half"${tied ? ' tie="end"' : ''}>${second}</music-road>`, 'three-roads');
}

describe('attached markings and tie meaning', () => {
  it('ties complete road interval sets independent of IDs/order and permits a staccato on the tie end', () => {
    const editor = session(tiedRoadSource(false));
    const first = markings(editor, 'a');
    const second = markings(editor, 'b');
    editor.execute({ type: 'tie-events', eventIds: ['b', 'a'] });
    expect(event(editor, 'a').tie).toBe('start');
    expect(event(editor, 'b').tie).toBe('end');
    expect(markings(editor, 'a')).toEqual(first);
    expect(markings(editor, 'b')).toEqual(second);
    editor.execute({ type: 'add-event-marking', eventId: 'b', value: { kind: 'articulation', type: 'staccato', placement: 'below' } });
    expect(event(editor, 'b').tie).toBe('end');
    expect(markings(editor, 'b').at(-1)).toMatchObject({ kind: 'articulation', type: 'staccato' });
    expectValid(editor);
  });

  it.each<AuthorCommand>([
    { type: 'update-event-marking', eventId: 'b', markingId: 'b-third', value: { kind: 'interval', value: '3', placement: 'below' }, fields: ['value'] },
    { type: 'update-event-marking', eventId: 'b', markingId: 'b-third', value: { kind: 'interval', value: 'b3', placement: 'above' }, fields: ['placement'] },
    { type: 'add-event-marking', eventId: 'b', value: { kind: 'interval', value: '#9', placement: 'above' } },
    { type: 'remove-event-marking', eventId: 'b', markingId: 'b-third' },
  ])('rejects $type that changes a sustained interval set without consuming redo', command => {
    const editor = session(tiedRoadSource());
    editor.execute({ type: 'add-event-marking', eventId: 'b', value: { kind: 'articulation', type: 'tenuto', placement: 'auto' } });
    editor.undo();
    expectRejected(editor, command);
    expect(editor.canRedo).toBe(true);
    expect(event(editor, 'a').tie).toBe('start');
    expect(event(editor, 'b').tie).toBe('end');
    expectValid(editor);
  });

  it('does not silently inherit missing continuation harmony when tying road events', () => {
    const editor = session(tiedRoadSource(false, false));
    expectRejected(editor, { type: 'tie-events', eventIds: ['a', 'b'] });
    expect(markings(editor, 'b')).toEqual([]);
    expect(editor.source.querySelectorAll('[tie]')).toHaveLength(0);
  });
});

const ensembleSource = `<!-- score notes -->
<music-system id="score" key="G" bracket="bracket">
  <music-staff id="pitched" label="Flute"><music-measure id="p1"><music-harmony id="harmony" text="C7"></music-harmony><music-note id="note" pitch="Fqs4" duration="whole" data-author="keep">${decorated}</music-note></music-measure></music-staff>
  <music-staff id="roads" notation="three-roads" label="Voice"><music-measure id="r1"><music-road id="road" direction="same" duration="whole"><music-interval id="third" value="♭3" placement="below" data-author="voicing"></music-interval><music-interval id="eleventh" value="#11" placement="above"></music-interval></music-road></music-measure></music-staff>
</music-system>
<!-- end score notes -->`;

describe('marking identity through duplication, backup, and parts', () => {
  it('round-trips source/project/model and keeps attached intervals with their owner rather than shared annotations', () => {
    const project = createProject(ensembleSource, 'Attached instructions', [
      { id: 'flute-part', label: 'Flute', staffIds: ['pitched'] }, { id: 'voice-part', label: 'Voice', staffIds: ['roads'] },
    ]);
    project.instructionScopes.harmony = 'all';
    const reopened = importProject(serializeProject(project));
    expect(reopened).toEqual(project);
    expect(reopened.sourceHtml).toBe(ensembleSource);
    const before = JSON.stringify(reopened);
    const full = buildProjection(reopened);
    const canonical = readScore(parseSource(serializeScore(full.score)));
    expect(canonical.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(canonical.score).toEqual(full.score);
    const voice = buildProjection(reopened, 'voice-part');
    const flute = buildProjection(reopened, 'flute-part');
    expect(voice.source.querySelector('#third')?.parentElement?.id).toBe('road');
    expect(voice.source.querySelector('#third')?.getAttribute('value')).toBe('♭3');
    expect(voice.source.querySelector('#accent')).toBeNull();
    expect(flute.source.querySelector('music-interval')).toBeNull();
    expect(flute.source.querySelector('#ornament')?.parentElement?.id).toBe('note');
    expect(voice.score.staves[0].measures[0].annotations.map(annotation => annotation.id)).toEqual(['harmony']);
    expect(voice.score.staves[0].measures[0].voices[0].events[0].markings).toEqual(full.score.staves[1].measures[0].voices[0].events[0].markings);
    expect(voice.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(flute.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(JSON.stringify(reopened)).toBe(before);
  });

  it('duplicates complete marking subtrees with fresh IDs and returns their mappings for one undo step', () => {
    const editor = session(ensembleSource);
    const before = editor.project.sourceHtml;
    const originals = ['accent', 'ornament', 'third', 'eleventh'];
    const nodes = originals.map(id => editor.source.querySelector(`#${id}`)!);
    const result = editor.execute({ type: 'duplicate-measures', measureIds: ['r1'] });
    const allIds = [editor.source, ...editor.source.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const [index, id] of originals.entries()) {
      expect(editor.source.querySelector(`#${id}`)).toBe(nodes[index]);
      const copiedId = result.copiedIds![id];
      expect(copiedId).toBeTruthy();
      expect(copiedId).not.toBe(id);
      const copy = editor.source.querySelector(`#${copiedId}`)!;
      expect(attrs(copy)).toEqual({ ...attrs(nodes[index]), id: copiedId });
      expect(copy.parentElement?.id).toBe(result.copiedIds![nodes[index].parentElement!.id]);
    }
    expect(editor.revision).toBe(1);
    expectValid(editor);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(originals.every(id => editor.source.querySelector(`#${result.copiedIds![id]}`))).toBe(true);
  });

  it('normalizes a child selection to its owning event and complete cursor without creating history', () => {
    const editor = session(staff('<music-voice id="voice-one"><music-note id="a" pitch="C4" duration="whole"><music-articulation id="accent" type="accent"></music-articulation></music-note></music-voice><music-voice id="voice-two"><music-note id="b" pitch="D4" duration="whole"><music-ornament id="ornament" type="trill"></music-ornament></music-note></music-voice>'));
    editor.select('a');
    editor.select('ornament');
    expect(editor.selectionId).toBe('b');
    expect(editor.cursor).toEqual({ staffId: 'staff', measureId: 'bar', voiceIndex: 1, eventId: 'b' });
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });
});

// Exercise the actual author controls without main, stylesheets, or remote assets.
const shellMarkup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const uiCleanups: (() => void)[] = [];

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual author control ${id}`);
  return element as T;
}

function markingsFixture(source = sourceFor('road'), selectionId = 'n') {
  document.body.innerHTML = shellMarkup;
  const editor = session(source);
  editor.select(selectionId);
  const context: EventMarkingsContext = { mode: 'write', selectionId: editor.selectionId, rangeEventIds: [selectionId] };
  let controller: EventMarkingsEditor | undefined;
  const select = (id: string): void => {
    editor.select(id);
    context.selectionId = editor.selectionId;
    context.rangeEventIds = editor.selectionId ? [editor.selectionId] : [];
    controller?.refresh();
  };
  const execute = vi.spyOn(editor, 'execute');
  const report = vi.fn();
  controller = new EventMarkingsEditor({ session: editor, context: () => context, select, report });
  const refresh = () => controller!.refresh();
  editor.addEventListener('change', refresh);
  uiCleanups.push(() => { editor.removeEventListener('change', refresh); controller!.dispose(); execute.mockRestore(); });
  return { editor, controller, context, select, execute, report };
}

function markingRow(kind: EventMarking['kind']): HTMLElement {
  const row = control('event-markings-rows').querySelector<HTMLElement>(`[data-marking-kind="${kind}"]`);
  if (!row) throw new Error(`Missing ${kind} draft row`);
  return row;
}

function rowForId(id: string): HTMLElement {
  const row = [...control('event-markings-rows').querySelectorAll<HTMLElement>('[data-marking-id]')]
    .find(element => element.dataset.markingId === id);
  if (!row) throw new Error(`Missing draft row for ${id}`);
  return row;
}

function rowField(row: HTMLElement, field: EventMarkingField): HTMLInputElement | HTMLSelectElement {
  const input = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-marking-field="${field}"]`);
  if (!input) throw new Error(`Missing ${field} row control`);
  return input;
}

function changeRow(row: HTMLElement, field: EventMarkingField, value: string): void {
  const input = rowField(row, field);
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

describe('attached-marking drafts in the actual author shell', () => {
  afterEach(() => {
    uiCleanups.splice(0).forEach(cleanup => cleanup());
    document.body.replaceChildren();
  });

  it('offers no placement control for any standard marking while retaining native interval direction choices', () => {
    const standardMarkup = [
      ...ARTICULATION_TYPES.map(type => `<music-articulation id="art-${type}" type="${type}" placement="above"></music-articulation>`),
      ...ORNAMENT_TYPES.map(type => `<music-ornament id="orn-${type}" type="${type}" placement="below"></music-ornament>`),
    ].join('');
    const h = markingsFixture(sourceFor('road', `${standardMarkup}<music-interval id="interval" value="b3" placement="below"></music-interval>`));
    const before = h.editor.project;
    for (const [prefix, types] of [['art', ARTICULATION_TYPES], ['orn', ORNAMENT_TYPES]] as const) {
      for (const type of types) {
        const row = rowForId(`${prefix}-${type}`);
        expect(row.querySelector('[data-marking-field="placement"]')).toBeNull();
        const choice = rowField(row, 'type');
        expect(choice.value).toBe(type);
        expect(choice.getAttribute('aria-describedby')?.split(/\s+/)).toContain('event-markings-placement-help');
      }
    }
    const placement = rowField(rowForId('interval'), 'placement') as HTMLSelectElement;
    expect(placement.tagName).toBe('SELECT');
    expect(placement.firstElementChild?.tagName).toBe('BUTTON');
    expect(placement.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect([...placement.options].map(option => option.value)).toEqual(['above', 'below']);
    expect(placement.value).toBe('below');
    expect(control('event-markings-placement-help').textContent).toContain('opposite the drawn stem');
    expect(control('event-markings-placement-help').textContent).toContain('above when there is no stem');
    expect(h.editor.project).toEqual(before);
    expect(h.editor.canUndo).toBe(false);
  });

  it.each([
    ['articulation', 'accent', 'tenuto', 'auto'],
    ['articulation', 'accent', 'tenuto', 'above'],
    ['articulation', 'accent', 'tenuto', 'below'],
    ['ornament', 'trill', 'turn', 'above'],
    ['ornament', 'trill', 'turn', 'below'],
  ] as const)('preserves %s (%s to %s) with legacy %s placement through edits, roundtrip, and undo', (kind, originalType, nextType, placement) => {
    const h = markingsFixture(sourceFor('road', `<!-- keep legacy setting --><music-${kind} id="legacy" type="${originalType}" placement="${placement}" data-user="keep"><!-- inside --></music-${kind}>`));
    const originalSource = h.editor.project.sourceHtml;
    const legacy = h.editor.source.querySelector('#legacy')!;
    const originalAttributes = attrs(legacy);
    expect(rowForId('legacy').querySelector('[data-marking-field="placement"]')).toBeNull();
    changeRow(rowForId('legacy'), 'type', nextType);
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'legacy', value: { kind, type: nextType, placement }, fields: ['type'] },
    ] });
    expect(h.editor.source.querySelector('#legacy')).toBe(legacy);
    expect(attrs(legacy)).toEqual({ ...originalAttributes, type: nextType });
    expect(legacy.innerHTML).toBe('<!-- inside -->');
    const afterType = h.editor.project.sourceHtml;
    const markingHtml = legacy.outerHTML;
    h.editor.execute({ type: 'update-event', eventId: 'n', value: input({ kind: 'road', pitchDirection: 'higher', stem: 'down' }), fields: ['stem'] });
    h.editor.execute({ type: 'set-event-rhythm', eventId: 'n', duration: 'half', dots: 1 });
    expect(legacy.outerHTML).toBe(markingHtml);
    expect(markings(h.editor)[0]).toMatchObject({ id: 'legacy', kind, type: nextType, placement });
    const reopened = importProject(serializeProject(h.editor.project));
    expect(reopened.sourceHtml).toBe(h.editor.project.sourceHtml);
    const part = buildProjection(reopened, reopened.parts[0].id);
    expect(part.source.querySelector('#legacy')?.getAttribute('placement')).toBe(placement);
    expect(part.score.staves[0].measures[0].voices[0].events[0].markings).toEqual(markings(h.editor));
    const canonical = readScore(parseSource(serializeScore(h.editor.score)));
    expect(canonical.score.staves[0].measures[0].voices[0].events[0].markings).toEqual(markings(h.editor));
    expectValid(h.editor);
    h.editor.undo();
    h.editor.undo();
    expect(sourceData(h.editor.project.sourceHtml)).toBe(sourceData(afterType));
    h.editor.undo();
    expect(sourceData(h.editor.project.sourceHtml)).toBe(sourceData(originalSource));
    expect(h.editor.source.querySelector('#legacy')).toBe(legacy);
    expect(rowField(rowForId('legacy'), 'type').value).toBe(originalType);
    expect(rowForId('legacy').querySelector('[data-marking-field="placement"]')).toBeNull();
    expect(h.editor.canUndo).toBe(false);
  });

  it('keeps invalid raw interval text editable and applies corrected rows as one undo without reading scalar form drafts', () => {
    const h = markingsFixture();
    const original = h.editor.project;
    const owner = h.editor.source.querySelector('#n');
    control<HTMLInputElement>('selected-pitch').value = 'unfinished scalar pitch';
    control<HTMLButtonElement>('add-event-articulation').click();
    changeRow(markingRow('articulation'), 'type', 'staccato');
    control<HTMLButtonElement>('add-event-ornament').click();
    control<HTMLButtonElement>('add-event-interval').click();
    const intervalRow = markingRow('interval');
    changeRow(intervalRow, 'value', 'b14');
    changeRow(intervalRow, 'placement', 'below');
    expect(rowField(intervalRow, 'value').value).toBe('b14');
    expect(h.controller.snapshot().values?.rows.find(row => row.kind === 'interval')?.value).toBe('b14');
    expect(h.controller.hasDirty).toBe(true);
    expect(h.editor.project).toEqual(original);
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.editor.project).toEqual(original);
    expect(h.editor.source.querySelector('#n')).toBe(owner);
    expect(h.editor.canUndo).toBe(false);
    expect(control('event-markings-draft-status').getAttribute('role')).toBe('alert');
    expect(rowField(intervalRow, 'value').value).toBe('b14');
    changeRow(intervalRow, 'value', 'b3');
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.execute.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'add', value: { kind: 'articulation', type: 'staccato', placement: 'auto' } },
      { type: 'add', value: { kind: 'ornament', type: 'trill', placement: 'above' } },
      { type: 'add', value: { kind: 'interval', value: 'b3', placement: 'below' } },
    ] });
    expect(markings(h.editor)).toHaveLength(3);
    expect(markings(h.editor).map(marking => [marking.kind, marking.placement])).toEqual([
      ['articulation', 'auto'], ['ornament', 'above'], ['interval', 'below'],
    ]);
    expect(h.editor.revision).toBe(1);
    expect(h.controller.hasDirty).toBe(false);
    expect(control('event-markings-draft-status').textContent).toBe('');
    expect(control('event-markings-draft-status').closest<HTMLElement>('.draft-notice')?.hidden).toBe(true);
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining('One Undo'));
    for (const select of control('event-markings-rows').querySelectorAll('select')) {
      expect(select.firstElementChild?.tagName).toBe('BUTTON');
      expect(select.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    }
    expectValid(h.editor);
    h.editor.undo();
    expect(sourceData(h.editor.project.sourceHtml)).toBe(sourceData(original.sourceHtml));
    expect(h.editor.source.querySelector('#n')).toBe(owner);
    expect(h.editor.canUndo).toBe(false);
  });

  it('keeps a dirty marking draft on its original event when selection moves to another staff', () => {
    const h = markingsFixture(ensembleSource, 'road');
    const before = h.editor.project;
    const mark = h.editor.source.querySelector('#third');
    const noteMarkings = markings(h.editor, 'note');
    changeRow(rowForId('third'), 'value', '5');
    h.select('note');
    expect(h.controller.snapshot()).toMatchObject({ targetId: 'road', matchesSelection: false, canApply: false });
    expect(rowField(rowForId('third'), 'value').value).toBe('5');
    expect(control<HTMLButtonElement>('return-event-markings').hidden).toBe(false);
    // Bypass native disabled-button behavior to verify the target guard too.
    control('apply-event-markings').dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.editor.project).toEqual(before);
    control<HTMLButtonElement>('return-event-markings').click();
    expect(h.editor.selectionId).toBe('road');
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'edit-event-markings', eventId: 'road', edits: [
      { type: 'update', markingId: 'third', value: { kind: 'interval', value: '5', placement: 'below' }, fields: ['value'] },
    ] });
    expect(h.editor.source.querySelector('#third')).toBe(mark);
    expect(mark?.getAttribute('data-author')).toBe('voicing');
    expect(markings(h.editor, 'note')).toEqual(noteMarkings);
    expect(h.editor.revision).toBe(1);
    h.editor.undo();
    expect(sourceData(h.editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(h.editor.canUndo).toBe(false);
  });

  it('merges an unrelated scalar direction edit and applies only the intentionally changed marking field', () => {
    const h = markingsFixture(sourceFor('road', `${decorated}<music-interval id="third" value="♭3" placement="below"></music-interval>`));
    const accent = h.editor.source.querySelector('#accent')!;
    const original = attrs(accent);
    changeRow(rowForId('accent'), 'type', 'tenuto');
    h.editor.execute({ type: 'update-event', eventId: 'n', value: input({ kind: 'road', pitchDirection: 'lower' }), fields: ['pitchDirection'] });
    expect(h.controller.snapshot().status).toBe('dirty');
    expect(h.controller.snapshot().canApply).toBe(true);
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.execute.mock.calls.at(-1)?.[0]).toEqual({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'accent', value: { kind: 'articulation', type: 'tenuto', placement: 'auto' }, fields: ['type'] },
    ] });
    expect(h.editor.source.querySelector('#accent')).toBe(accent);
    expect(attrs(accent)).toEqual({ ...original, type: 'tenuto' });
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('♭3');
    expect(event(h.editor).pitchDirection).toBe('lower');
    h.editor.undo();
    expect(attrs(accent)).toEqual(original);
    expect(event(h.editor).pitchDirection).toBe('lower');
    expectValid(h.editor);
  });

  it('requires Review after external marking changes and preserves source additions while applying the draft', () => {
    const h = markingsFixture(sourceFor('road', decorated));
    changeRow(rowForId('accent'), 'type', 'tenuto');
    h.editor.execute({ type: 'add-event-marking', eventId: 'n', value: { kind: 'articulation', type: 'staccato', placement: 'auto' } });
    const external = markings(h.editor).find(marking => marking.kind === 'articulation' && marking.type === 'staccato')!;
    const externalNode = h.editor.source.querySelector(`[id="${external.id}"]`);
    const accepted = h.editor.project;
    expect(h.controller.snapshot().status).toBe('conflict');
    expect(h.controller.snapshot().canApply).toBe(false);
    expect(control<HTMLButtonElement>('review-event-markings').hidden).toBe(false);
    control('apply-event-markings').dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.editor.project).toEqual(accepted);
    expect(h.execute).toHaveBeenCalledTimes(1);
    control<HTMLButtonElement>('review-event-markings').click();
    expect(h.controller.snapshot().canApply).toBe(true);
    expect(rowForId(external.id)).toBeDefined();
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.editor.source.querySelector(`[id="${external.id}"]`)).toBe(externalNode);
    expect(markings(h.editor)).toHaveLength(3);
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
    expect(h.editor.source.querySelector('#accent')?.getAttribute('placement')).toBe('auto');
    expect(h.editor.revision).toBe(2);
    h.editor.undo();
    expect(sourceData(h.editor.project.sourceHtml)).toBe(sourceData(accepted.sourceHtml));
    expect(markings(h.editor).some(marking => marking.id === external.id)).toBe(true);
    expectValid(h.editor);
  });

  it('rebuilds row controls when Source changes the marking family under an existing ID', () => {
    const h = markingsFixture(sourceFor('road', decorated));
    const originalRow = rowForId('accent');
    expect(rowField(originalRow, 'type').value).toBe('accent');
    expect(originalRow.querySelector('[data-marking-field="value"]')).toBeNull();
    const previousMark = h.editor.source.querySelector('#accent')!.outerHTML;
    h.editor.applySource(h.editor.project.sourceHtml.replace(previousMark,
      '<music-interval id="accent" value="b3" placement="below" data-user="changed family"></music-interval>'));
    const intervalRow = rowForId('accent');
    expect(intervalRow.dataset.markingKind).toBe('interval');
    expect(intervalRow.querySelector('[data-marking-field="type"]')).toBeNull();
    const value = rowField(intervalRow, 'value');
    expect(value.tagName).toBe('INPUT');
    expect(value.value).toBe('b3');
    const placement = rowField(intervalRow, 'placement') as HTMLSelectElement;
    expect(placement.tagName).toBe('SELECT');
    expect(placement.firstElementChild?.tagName).toBe('BUTTON');
    expect(placement.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect([...placement.options].map(option => option.value)).toEqual(['above', 'below']);
    expect(placement.value).toBe('below');
    changeRow(intervalRow, 'value', '#11');
    control<HTMLButtonElement>('apply-event-markings').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'accent', value: { kind: 'interval', value: '#11', placement: 'below' }, fields: ['value'] },
    ] });
    expect(markings(h.editor).find(marking => marking.id === 'accent')).toMatchObject({
      kind: 'interval', interval: { number: 11, alter: 1 }, placement: 'below',
    });
    expect(h.editor.source.querySelector('#accent')?.getAttribute('data-user')).toBe('changed family');
    expectValid(h.editor);
    h.editor.undo();
    expect(rowField(rowForId('accent'), 'value').value).toBe('b3');
    h.editor.undo();
    const restoredRow = rowForId('accent');
    expect(restoredRow.dataset.markingKind).toBe('articulation');
    expect(restoredRow.querySelector('[data-marking-field="value"]')).toBeNull();
    expect(rowField(restoredRow, 'type').value).toBe('accent');
    expect(restoredRow.querySelector('[data-marking-field="placement"]')).toBeNull();
    expect(h.editor.source.querySelector('#accent')?.getAttribute('placement')).toBe('auto');
    expect(h.editor.canUndo).toBe(false);
  });
});
