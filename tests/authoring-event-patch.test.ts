// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession, EditorValidationError } from '../src/authoring/editor';
import { patchEventFields, validateEventPatchFields } from '../src/authoring/event-field-patch';
import { createProject } from '../src/authoring/project';
import type { AuthorCommand, EventInput } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { durationTime, rational } from '../src/model/index';
import type { MusicEvent } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function score(body: string, measureAttributes = 'incomplete', staffAttributes = ''): Element {
  return element(`<music-system id="score"><music-staff id="staff" ${staffAttributes}><music-measure id="bar" ${measureAttributes}>${body}</music-measure></music-staff></music-system>`);
}

function input(changes: Partial<EventInput> = {}): EventInput {
  return {
    kind: 'note', pitch: 'C5', pitches: 'C5 E5 G5', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
    ...changes,
  };
}

function patch(fields: readonly (keyof EventInput)[], changes: Partial<EventInput> = {}, eventId = 'n'): AuthorCommand {
  return { type: 'update-event', eventId, value: input(changes), fields };
}

function event(root: Element, id = 'n'): MusicEvent {
  return readScore(root).score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))
    .find(item => item.id === id)!;
}

function attrs(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

function errors(root: Element): string[] {
  return readScore(root).diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function session(root: Element): EditorSession {
  expect(errors(root)).toEqual([]);
  const editor = new EditorSession(createProject(root.outerHTML, 'Event field patches'));
  editor.select('n');
  return editor;
}

/** Attribute order may change when a removed attribute is restored by undo. */
function sourceData(html: string): string {
  const root = element(html);
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const attributes = Object.entries(attrs(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of attributes) node.setAttribute(name, value);
  }
  return root.outerHTML;
}

const AUTHORED_NOTE = '<music-note id="n" pitch="f4" accidental="quarter-sharp" duration="8" dotted dots="1" accidental-display="courtesy" stem="auto" beam="none" data-author="retain &amp; compare"><!-- event comment --></music-note>';

describe('EVENT-PATCH-UNTOUCHED: named event fields only', () => {
  it.each(['stem', 'beam'] as const)('changes only %s, preserving literal source and accepted musical data', field => {
    const root = score(`<!-- before -->${AUTHORED_NOTE}<!-- after -->`);
    const node = root.querySelector('#n')!;
    const before = event(root);
    const expected = attrs(node);
    if (field === 'stem') expected.stem = 'up';
    else delete expected.beam;
    const content = node.innerHTML;
    const parent = node.parentElement;
    applyCommand(root, patch([field], { stem: 'up', beam: 'auto' }));
    expect(root.querySelector('#n')).toBe(node);
    expect(node.parentElement).toBe(parent);
    expect(attrs(node)).toEqual(expected);
    expect(node.innerHTML).toBe(content);
    expect(event(root)).toEqual({ ...before, [field]: field === 'stem' ? 'up' : 'auto' });
    expect(root.innerHTML).toContain('<!-- before -->');
    expect(root.innerHTML).toContain('<!-- after -->');
    expect(errors(root)).toEqual([]);
  });

  it.each(['stem', 'beam'] as const)('does not validate or apply unrelated pending values during immediate %s', field => {
    const root = score(AUTHORED_NOTE);
    const expected = attrs(root.querySelector('#n')!);
    if (field === 'stem') expected.stem = 'down';
    else delete expected.beam;
    applyCommand(root, patch([field], {
      kind: 'chord', pitch: 'unfinished', pitches: '', duration: 'unfinished' as EventInput['duration'],
      dots: NaN, measureRest: true, rhythmic: true, accidentalDisplay: 'unfinished' as EventInput['accidentalDisplay'],
      stem: 'down', beam: 'auto',
    }));
    expect(root.querySelector('#n')!.localName).toBe('music-note');
    expect(attrs(root.querySelector('#n')!)).toEqual(expected);
  });

  it('treats an empty field list as a true no-op despite invalid pending values', () => {
    const editor = session(score(AUTHORED_NOTE));
    editor.execute({ type: 'set-note-pitch', eventId: 'n', pitch: 'Gqs4', ties: 'reject' });
    editor.undo();
    const before = editor.project.sourceHtml;
    const revision = editor.revision;
    editor.execute(patch([], { pitch: 'unfinished', dots: NaN, duration: 'unfinished' as EventInput['duration'] }));
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(revision);
    expect(editor.selectionId).toBe('n');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(event(editor.source).pitches[0]).toMatchObject({ step: 'G', alter: 0.5 });
  });

  it('preserves microtonal pitch aliases, duration aliases, dotted syntax and explicit default attributes on semantic no-op', () => {
    const root = score(AUTHORED_NOTE);
    const before = root.outerHTML;
    applyCommand(root, patch(['kind', 'pitch', 'duration', 'dots', 'accidentalDisplay', 'stem', 'beam'], {
      kind: 'note', pitch: 'Fqs4', duration: 'eighth', dots: 1, accidentalDisplay: 'courtesy', stem: 'auto', beam: 'none',
    }));
    expect(root.outerHTML).toBe(before);
  });

  it('changes the explicit pitch without normalizing rhythm, display, metadata or legacy triplet markers', () => {
    const root = score('<music-note id="n" pitch="F4" accidental="three-quarter-flat" duration="8" dotted accidental-display="always" stem="down" beam="none" triplet="start" data-user="keep"></music-note>'
      + '<music-note id="middle" pitch="G4" duration="8"></music-note><music-note id="last" pitch="A4" duration="8" triplet="end"></music-note>');
    const expected = attrs(root.querySelector('#n')!);
    delete expected.accidental;
    expected.pitch = 'Gtqs4';
    const before = event(root);
    applyCommand(root, patch(['pitch'], { pitch: 'Gtqs4' }));
    expect(attrs(root.querySelector('#n')!)).toEqual(expected);
    expect(event(root)).toEqual({ ...before, pitches: [{ step: 'G', octave: 4, alter: 1.5, display: 'always' }] });
    expect(root.querySelector('#last')?.getAttribute('triplet')).toBe('end');
  });
});

describe('EVENT-PATCH-MIXED-CHORD: pitch and display ownership', () => {
  it.each(['stem', 'beam', 'duration'] as const)('does not normalize chord spelling or display for an unrelated %s edit', field => {
    const root = score('<music-chord id="n" pitches="cqs4  E♭4 G4" duration="8" dotted accidental-display="courtesy" stem="auto" beam="none" data-parts="lead,solo"><!-- preserve tones --></music-chord>');
    const before = event(root);
    const expected = attrs(root.querySelector('#n')!);
    if (field === 'stem') expected.stem = 'down';
    if (field === 'beam') delete expected.beam;
    if (field === 'duration') expected.duration = 'sixteenth';
    applyCommand(root, patch([field], { kind: 'chord', pitches: 'A3 C4 E4', stem: 'down', beam: 'auto', duration: 'sixteenth' }));
    expect(attrs(root.querySelector('#n')!)).toEqual(expected);
    expect(event(root).pitches).toEqual(before.pitches);
    expect(root.querySelector('#n')!.innerHTML).toBe('<!-- preserve tones -->');
  });

  it('changes only chord pitches and retains the accepted accidental display', () => {
    const root = score('<music-chord id="n" pitches="Cqs4 E4 G4" duration="8" dotted accidental-display="always" stem="up" data-user="keep"></music-chord>');
    const expected = attrs(root.querySelector('#n')!);
    expected.pitches = 'Dqf4 F4 A4';
    applyCommand(root, patch(['pitches'], { kind: 'chord', pitches: 'Dqf4 F4 A4' }));
    expect(attrs(root.querySelector('#n')!)).toEqual(expected);
    expect(event(root).pitches.map(pitch => pitch.display)).toEqual(['always', 'always', 'always']);
  });

  it.each(['stem', 'beam', 'duration'] as const)('preserves a model with mixed chord display policies during %s', field => {
    // The current HTML grammar uses one display attribute per chord. A synthetic
    // accepted model catches helpers that flatten policies through the first tone.
    const root = score('<music-chord id="n" pitches="cqs4 E♭4 G4" duration="8" dotted accidental-display="courtesy" stem="auto" beam="none"></music-chord>');
    const displays = ['auto', 'always', 'courtesy'] as const;
    const mixed = Object.freeze({ ...event(root), pitches: Object.freeze(event(root).pitches
      .map((pitch, index) => Object.freeze({ ...pitch, display: displays[index] }))) });
    const beforeModel = structuredClone(mixed);
    const node = root.querySelector('#n')!;
    const expected = attrs(node);
    if (field === 'stem') expected.stem = 'down';
    if (field === 'beam') delete expected.beam;
    if (field === 'duration') expected.duration = 'sixteenth';
    expect(patchEventFields(node, mixed, input({ stem: 'down', beam: 'auto', duration: 'sixteenth' }), [field]))
      .toEqual({ changed: true, rhythmChanged: field === 'duration' });
    expect(attrs(node)).toEqual(expected);
    expect(mixed).toEqual(beforeModel);
  });

  it('intentionally applies a named display uniformly rather than assuming the first tone speaks for the chord', () => {
    const root = score('<music-chord id="n" pitches="Cqs4 E4 G4" duration="8" dotted accidental-display="courtesy" stem="down"></music-chord>');
    const mixed = { ...event(root), pitches: event(root).pitches.map((pitch, index) => ({ ...pitch, display: index ? 'auto' as const : 'always' as const })) };
    const node = root.querySelector('#n')!;
    const expected = { ...attrs(node), 'accidental-display': 'always' };
    expect(patchEventFields(node, mixed, input({ accidentalDisplay: 'always' }), ['accidentalDisplay']))
      .toEqual({ changed: true, rhythmChanged: false });
    expect(attrs(node)).toEqual(expected);
    expect(event(root).pitches.map(pitch => pitch.display)).toEqual(['always', 'always', 'always']);
    expect(mixed.pitches.map(pitch => pitch.display)).toEqual(['always', 'auto', 'auto']);
  });

  it('does not rewrite unchanged chord aliases, letter case or spacing', () => {
    const root = score('<music-chord id="n" pitches="cqs4  E♭4 G4" duration="8" dotted accidental-display="courtesy"></music-chord>');
    const before = root.outerHTML;
    expect(patchEventFields(root.querySelector('#n')!, event(root), input({ pitches: 'Cqs4 Eb4 G4' }), ['pitches']))
      .toEqual({ changed: false, rhythmChanged: false });
    expect(root.outerHTML).toBe(before);
  });
});

describe('field patch validation and semantic no-ops', () => {
  it.each([
    ['pitch="F4" accidental="quarter-flat"', 'Fqf4'],
    ['pitch="ftqf4"', 'Ftqf4'],
    ['pitch="F4" accidental="three-quarter-sharp"', 'Ftqs4'],
    ['pitch="f♯4"', 'F#4'],
    ['pitch="F♮4"', 'F4'],
  ])('preserves unchanged absolute spelling %s', (pitch, next) => {
    const root = score(`<music-note id="n" ${pitch} duration="4" accidental-display="courtesy" data-user="keep"></music-note>`);
    const before = root.outerHTML;
    expect(patchEventFields(root.querySelector('#n')!, event(root), input({ pitch: next }), ['pitch']))
      .toEqual({ changed: false, rhythmChanged: false });
    expect(root.outerHTML).toBe(before);
  });

  it.each(['', ' stem="auto" beam="auto" accidental-display="auto"', ' duration="4" dots="0"'])('preserves omitted and explicit default attributes%s', attributes => {
    const root = score(`<music-note id="n" pitch="C4"${attributes}></music-note>`);
    const before = root.outerHTML;
    expect(patchEventFields(root.querySelector('#n')!, event(root), input(), ['duration', 'dots', 'stem', 'beam', 'accidentalDisplay']))
      .toEqual({ changed: false, rhythmChanged: false });
    expect(root.outerHTML).toBe(before);
  });

  it('keeps revision, selection, source and redo for a semantic rather than literal no-op', () => {
    const editor = session(score(AUTHORED_NOTE));
    editor.execute({ type: 'set-note-pitch', eventId: 'n', pitch: 'Gqs4', ties: 'reject' });
    editor.undo();
    const before = editor.project.sourceHtml;
    const revision = editor.revision;
    editor.execute(patch(['pitch', 'duration', 'dots', 'stem', 'beam', 'accidentalDisplay'], {
      pitch: 'Fqs4', duration: 'eighth', dots: 1, stem: 'auto', beam: 'none', accidentalDisplay: 'courtesy',
    }));
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(revision);
    expect(editor.selectionId).toBe('n');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(event(editor.source).pitches[0].step).toBe('G');
  });

  it.each([
    ['stem', 'left'], ['beam', 'swing'], ['accidentalDisplay', 'never'], ['duration', 'pending'],
    ['dots', -1], ['dots', 4], ['dots', 0.5], ['dots', NaN], ['dots', Infinity], ['dots', undefined],
    ['measureRest', 'true'], ['rhythmic', 1], ['pitch', 'unfinished'],
  ] as const)('rejects invalid named %s=%s before applying any other named field', (field, value) => {
    const root = score(AUTHORED_NOTE);
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root),
      input({ pitch: 'Gqs4', stem: 'down', [field]: value } as Partial<EventInput>), ['pitch', 'stem', field])).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it.each([null, 'stem', ['stem', 'not-an-event-field'], ['kind', 'tie'], ['__proto__']])('rejects unsupported field scope %s', fields => {
    const root = score(AUTHORED_NOTE);
    const before = root.outerHTML;
    const selection = fields as readonly (keyof EventInput)[];
    expect(() => validateEventPatchFields(selection)).toThrow('supported event fields');
    expect(() => applyCommand(root, { type: 'update-event', eventId: 'n', fields: selection, value: input({ kind: 'rest' }) })).toThrow('supported event fields');
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    ['<music-rest id="n" duration="8"></music-rest>', 'pitch'],
    ['<music-rhythm id="n" duration="8"></music-rhythm>', 'pitch'],
    ['<music-chord id="n" pitches="C4 E4" duration="8"></music-chord>', 'pitch'],
    ['<music-note id="n" pitch="C4" duration="8"></music-note>', 'pitches'],
    ['<music-rest id="n" duration="8"></music-rest>', 'accidentalDisplay'],
  ] as const)('rejects field %s / %s on an inapplicable event kind', (markup, field) => {
    const root = score(markup, 'incomplete', markup.includes('music-rhythm') ? 'notation="rhythm"' : '');
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root), input(), [field])).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it.each(['C4', 'C4 C4', 'Cqs4 cqs4', 'C4 unfinished', undefined])('rejects invalid chord pitches %s before writing a valid stem change', pitches => {
    const root = score('<music-chord id="n" pitches="C4 E4" duration="8"></music-chord>');
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root), input({ pitches, stem: 'up' } as Partial<EventInput>), ['stem', 'pitches'])).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it('leaves actual kind changes to the caller, while an unnamed stale kind is ignored', () => {
    const root = score(AUTHORED_NOTE);
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root), input({ kind: 'rest' }), ['kind'])).toThrow('explicit event replacement');
    expect(root.outerHTML).toBe(before);
    expect(patchEventFields(root.querySelector('#n')!, event(root), input({ kind: 'rest', stem: 'auto' }), ['stem']))
      .toEqual({ changed: false, rhythmChanged: false });
  });
});

describe('field-specific rhythm transactions', () => {
  it.each([0, 2, 3])('changes only dots to %s, retaining the written duration alias and accidental source', dots => {
    const root = score(AUTHORED_NOTE);
    const node = root.querySelector('#n')!;
    const expected = attrs(node);
    delete expected.dotted;
    if (dots) expected.dots = String(dots);
    else delete expected.dots;
    expect(patchEventFields(node, event(root), input({ dots, duration: 'unfinished' as EventInput['duration'] }), ['dots']))
      .toEqual({ changed: true, rhythmChanged: true });
    expect(attrs(node)).toEqual(expected);
    expect(event(root).time).toEqual(durationTime('eighth', dots));
  });

  it.each([
    ['<music-rest id="n" duration="1" beam="none" data-user="keep"></music-rest>', ''],
    ['<music-slash id="n" duration="1" beam="none" data-user="keep"></music-slash>', ''],
    ['<music-slash id="n" duration="1" rhythmic stem="down" data-user="keep"></music-slash>', ''],
    ['<music-rhythm id="n" duration="1" stem="down" data-user="keep"></music-rhythm>', 'notation="rhythm"'],
  ])('supports advanced duration edits for %s without adopting unrelated form flags', (markup, staffAttributes) => {
    const editor = session(score(markup, '', staffAttributes));
    const beforeEvent = event(editor.source);
    const expected = { ...attrs(editor.source.querySelector('#n')!), duration: 'half' };
    editor.execute(patch(['duration'], { duration: 'half', kind: 'chord', rhythmic: !beforeEvent.rhythmic, measureRest: true, pitch: 'unfinished' }));
    expect(attrs(editor.source.querySelector('#n')!)).toEqual(expected);
    expect(event(editor.source)).toEqual({ ...beforeEvent, duration: 'half', time: rational(1, 2) });
    expect(editor.source.querySelector('#bar')!.hasAttribute('incomplete')).toBe(true);
    expect(editor.source.querySelectorAll('music-note, music-chord, music-rest, music-slash, music-rhythm')).toHaveLength(1);
  });

  it.each([false, true])('changes the slash attack flag from %s without changing nominal time', rhythmic => {
    const root = score(`<music-slash id="n" duration="8" dotted ${rhythmic ? 'rhythmic="true"' : ''} stem="down" beam="none" data-user="keep"></music-slash>`);
    const node = root.querySelector('#n')!;
    const before = event(root);
    const expected = attrs(node);
    if (rhythmic) delete expected.rhythmic;
    else expected.rhythmic = '';
    expect(patchEventFields(node, before, input({ rhythmic: !rhythmic }), ['rhythmic']))
      .toEqual({ changed: true, rhythmChanged: false });
    expect(attrs(node)).toEqual(expected);
    expect(event(root)).toEqual({ ...before, rhythmic: !rhythmic });
  });

  it('preserves pitch-free rhythm ties when changing a written value', () => {
    const editor = session(score('<music-rhythm id="n" duration="half" tie="start" stem="up"></music-rhythm>'
      + '<music-rhythm id="tail" duration="half" tie="end" stem="up"></music-rhythm>', '', 'notation="rhythm"'));
    editor.execute(patch(['duration'], { duration: 'quarter', pitch: 'C5', kind: 'note' }));
    expect(event(editor.source)).toMatchObject({ kind: 'rhythm', pitches: [], tie: 'start', duration: 'quarter', time: rational(1, 4) });
    expect(event(editor.source, 'tail')).toMatchObject({ kind: 'rhythm', pitches: [], tie: 'end', onset: rational(1, 4) });
    expect(editor.source.querySelector('[pitch], [pitches]')).toBeNull();
    expect(editor.revision).toBe(1);
  });

  it('retains nested tuplets, another voice, comments and exact multiplied time', () => {
    const editor = session(score('<music-voice id="v1"><music-tuplet id="outer" actual="3" normal="2" bracket="yes" ratio>'
      + '<music-tuplet id="inner" actual="3" normal="2"><!-- exact inner group -->'
      + '<music-note id="n" pitch="Ctqs4" duration="16" data-user="keep"></music-note>'
      + '<music-note id="n2" pitch="D4" duration="sixteenth"></music-note><music-note id="n3" pitch="E4" duration="sixteenth"></music-note></music-tuplet>'
      + '<music-note id="n4" pitch="F4" duration="eighth"></music-note><music-note id="n5" pitch="G4" duration="eighth"></music-note>'
      + '</music-tuplet></music-voice><music-voice id="v2"><music-rest id="other" duration="quarter"></music-rest></music-voice>', 'meter="1/4"'));
    const before = readScore(editor.source).score.staves[0].measures[0];
    const n = editor.source.querySelector('#n')!;
    const parent = n.parentElement;
    const expected = { ...attrs(n), duration: 'thirty-second' };
    editor.execute(patch(['duration'], { duration: 'thirty-second', pitch: 'unfinished', dots: NaN }));
    const after = readScore(editor.source).score.staves[0].measures[0];
    expect(attrs(n)).toEqual(expected);
    expect(n.parentElement).toBe(parent);
    expect(after.voices[0].tuplets).toEqual(before.voices[0].tuplets);
    expect(after.voices[1]).toEqual(before.voices[1]);
    expect(event(editor.source)).toMatchObject({ time: rational(1, 72), tupletIds: ['outer', 'inner'] });
    expect(after.voices[0].events.map(value => value.onset)).toEqual([rational(0), rational(1, 72), rational(1, 24), rational(5, 72), rational(11, 72)]);
    expect(after.incomplete).toBe(true);
    expect(editor.source.innerHTML).toContain('<!-- exact inner group -->');
    expect(readScore(editor.source).diagnostics.some(item => item.code === 'tuplet-span' && item.severity === 'warning')).toBe(true);
    expect(editor.revision).toBe(1);
  });

  it('keeps sequential annotations sequential and fixed annotations fixed when timing moves', () => {
    const editor = session(score('<music-note id="n" pitch="F4" duration="half"></music-note>'
      + '<music-harmony id="sequential" text="F7"></music-harmony><music-direction id="fixed" at="1/2" text="Listen"></music-direction>'
      + '<music-note id="tail" pitch="G4" duration="half"></music-note>', ''));
    const sequential = editor.source.querySelector('#sequential')!.outerHTML;
    const fixed = editor.source.querySelector('#fixed')!.outerHTML;
    editor.execute(patch(['duration'], { duration: 'quarter' }));
    const annotations = readScore(editor.source).score.staves[0].measures[0].annotations;
    expect(annotations.find(item => item.id === 'sequential')!.onset).toEqual(rational(1, 4));
    expect(annotations.find(item => item.id === 'fixed')!.onset).toEqual(rational(1, 2));
    expect(editor.source.querySelector('#sequential')!.outerHTML).toBe(sequential);
    expect(editor.source.querySelector('#fixed')!.outerHTML).toBe(fixed);
  });

  it('changes duration alone, marks an underfull draft, and preserves both tied pitches and source identities in one undo', () => {
    const editor = session(score('<music-note id="n" pitch="F4" accidental="quarter-sharp" duration="half" accidental-display="courtesy" tie="start" data-user="keep"></music-note>'
      + '<!-- tie continues --><music-note id="tail" pitch="Fqs4" duration="half" tie="end"></music-note>', ''));
    const before = editor.project.sourceHtml;
    const n = editor.source.querySelector('#n')!;
    const tail = editor.source.querySelector('#tail')!;
    const pitches = event(editor.source).pitches;
    editor.execute(patch(['duration'], { duration: 'quarter' }));
    expect(event(editor.source)).toMatchObject({ duration: 'quarter', dots: 0, time: rational(1, 4), tie: 'start', pitches });
    expect(editor.source.querySelector('#n')).toBe(n);
    expect(editor.source.querySelector('#tail')).toBe(tail);
    expect(tail.getAttribute('tie')).toBe('end');
    expect(editor.source.querySelector('#bar')!.hasAttribute('incomplete')).toBe(true);
    expect(editor.revision).toBe(1);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#n')).toBe(n);
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(event(editor.source).duration).toBe('quarter');
  });

  it('rejects overflow atomically and can recover with a shorter field-only edit', () => {
    const editor = session(score('<music-note id="n" pitch="F4" duration="half" accidental-display="courtesy"></music-note><music-note id="tail" pitch="G4" duration="half"></music-note>', ''));
    const before = editor.project.sourceHtml;
    expect(() => editor.execute(patch(['duration'], { duration: 'whole' }))).toThrow(EditorValidationError);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(0);
    expect(editor.selectionId).toBe('n');
    expect(editor.canUndo).toBe(false);
    editor.execute(patch(['duration'], { duration: 'quarter' }));
    expect(event(editor.source).pitches[0]).toMatchObject({ step: 'F', octave: 4, display: 'courtesy' });
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });

  it('keeps a full-measure rest unless its own flag is explicitly changed', () => {
    const editor = session(score('<music-rest id="n" measure data-user="keep"></music-rest>', ''));
    const before = editor.project.sourceHtml;
    expect(() => editor.execute(patch(['duration'], { kind: 'rest', duration: 'half' }))).toThrow(/full-measure rest/i);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(0);
  });

  it('rejects a tied pitch change without clearing ties or losing redo', () => {
    const editor = session(score('<music-note id="n" pitch="Fqs4" duration="half" tie="start"></music-note>'
      + '<music-note id="tail" pitch="Fqs4" duration="half" tie="end"></music-note>', ''));
    editor.execute(patch(['stem'], { stem: 'down' }));
    editor.undo();
    const before = editor.project.sourceHtml;
    const revision = editor.revision;
    expect(() => editor.execute(patch(['pitch'], { pitch: 'F4' }))).toThrow(EditorValidationError);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(event(editor.source).tie).toBe('start');
    expect(event(editor.source, 'tail').tie).toBe('end');
  });

  it('rejects an invalid beam without constructing a beam group or applying pending duration', () => {
    const editor = session(score(AUTHORED_NOTE));
    const before = editor.project.sourceHtml;
    expect(() => editor.execute(patch(['beam'], { beam: 'start', duration: 'whole' }))).toThrow(EditorValidationError);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(0);
    expect(editor.selectionId).toBe('n');
    expect(editor.canUndo).toBe(false);
    editor.execute(patch(['beam'], { beam: 'auto' }));
    expect(event(editor.source).duration).toBe('eighth');
    expect(event(editor.source).dots).toBe(1);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
  });
});

describe('explicit full-measure rest field conversions', () => {
  it.each([
    '<music-rest id="n" measure data-user="keep"></music-rest>',
    '<music-rest id="n" measure="true" duration="1" dots="0" beam="auto" data-user="keep"></music-rest>',
  ])('preserves full-rest semantic no-ops: %s', markup => {
    const root = score(markup, 'meter="3/4"');
    const before = root.outerHTML;
    expect(patchEventFields(root.querySelector('#n')!, event(root), input({ duration: 'whole', dots: 0, measureRest: true }), ['measureRest', 'duration', 'dots']))
      .toEqual({ changed: false, rhythmChanged: false });
    expect(root.outerHTML).toBe(before);
  });

  it.each([false, true])('materializes the written whole value when clearing an implicit full rest (duration named: %s)', named => {
    const root = score('<music-rest id="n" measure data-user="keep"></music-rest>', '');
    const node = root.querySelector('#n')!;
    const fields: (keyof EventInput)[] = named ? ['measureRest', 'duration'] : ['measureRest'];
    expect(patchEventFields(node, event(root), input({ measureRest: false, duration: named ? 'whole' : 'quarter' }), fields))
      .toEqual({ changed: true, rhythmChanged: true });
    expect(attrs(node)).toEqual({ id: 'n', duration: 'whole', 'data-user': 'keep' });
    expect(event(root)).toMatchObject({ measureRest: false, duration: 'whole', time: rational(1), beam: 'auto' });
    expect(errors(root)).toEqual([]);
  });

  it('preserves an explicit whole alias, beam and metadata when clearing the meter-rest flag', () => {
    const root = score('<music-rest id="n" measure="true" duration="1" beam="none" dots="0" data-user="keep"></music-rest>', '');
    const node = root.querySelector('#n')!;
    const expected = attrs(node);
    delete expected.measure;
    patchEventFields(node, event(root), input({ measureRest: false }), ['measureRest']);
    expect(attrs(node)).toEqual(expected);
    expect(event(root)).toMatchObject({ measureRest: false, duration: 'whole', dots: 0, beam: 'none' });
  });

  it('does not guess a fitting rest when clearing a full rest in 3/4, but accepts an explicitly chosen quarter', () => {
    const editor = session(score('<music-rest id="n" measure data-user="keep"></music-rest>', 'meter="3/4"'));
    const before = editor.project.sourceHtml;
    expect(() => editor.execute(patch(['measureRest'], { measureRest: false }))).toThrow(EditorValidationError);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
    editor.execute(patch(['measureRest', 'duration'], { measureRest: false, duration: 'quarter' }));
    expect(event(editor.source)).toMatchObject({ kind: 'rest', measureRest: false, duration: 'quarter', time: rational(1, 4) });
    expect(editor.source.querySelector('#bar')!.hasAttribute('incomplete')).toBe(true);
    expect(editor.source.querySelectorAll('music-rest')).toHaveLength(1);
    expect(editor.revision).toBe(1);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
  });

  it('allows the meter-rest flag to clean only required duration and dot attributes', () => {
    const root = score('<music-rest id="n" duration="8" dotted dots="1" stem="down" beam="none" data-user="keep"><!-- keep rest --> </music-rest>', 'incomplete meter="3/4"');
    const node = root.querySelector('#n')!;
    const expected = attrs(node);
    delete expected.duration;
    delete expected.dots;
    delete expected.dotted;
    expected.measure = '';
    expect(patchEventFields(node, event(root), input({ measureRest: true, dots: NaN }), ['measureRest']))
      .toEqual({ changed: true, rhythmChanged: true });
    expect(attrs(node)).toEqual(expected);
    expect(node.innerHTML).toBe('<!-- keep rest --> ');
    expect(event(root)).toMatchObject({ measureRest: true, duration: 'whole', dots: 0, time: rational(3, 4), stem: 'down', beam: 'none' });
    expect(errors(root)).toEqual([]);
  });

  it('preserves an existing whole alias when making a full-measure rest', () => {
    const root = score('<music-rest id="n" duration="1" beam="none" data-user="keep"></music-rest>', '');
    const expected = { ...attrs(root.querySelector('#n')!), measure: '' };
    patchEventFields(root.querySelector('#n')!, event(root), input({ measureRest: true }), ['measureRest']);
    expect(attrs(root.querySelector('#n')!)).toEqual(expected);
  });

  it.each([
    [['measureRest', 'duration'], { measureRest: true, duration: 'half' }],
    [['measureRest', 'dots'], { measureRest: true, dots: 1 }],
  ] as const)('rejects named written values that conflict with the requested full rest: %s', (fields, changes) => {
    const root = score('<music-rest id="n" duration="8" dotted beam="none"></music-rest>');
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root), input(changes), fields)).toThrow(/full-measure rest/i);
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    [true, '', 'none', 'none'],
    [true, 'beam="none"', 'auto', null],
    [false, '', 'auto', 'auto'],
    [false, 'beam="auto"', 'none', 'none'],
  ] as const)('honors a named beam across the implicit-default change (full rest: %s, source: %s, requested: %s)', (wasFull, beamAttribute, beam, expectedBeam) => {
    const root = score(`<music-rest id="n" duration="1" ${wasFull ? 'measure' : ''} ${beamAttribute}></music-rest>`, '');
    const node = root.querySelector('#n')!;
    expect(patchEventFields(node, event(root), input({ measureRest: !wasFull, beam }), ['measureRest', 'beam']))
      .toEqual({ changed: true, rhythmChanged: true });
    expect(node.getAttribute('beam')).toBe(expectedBeam);
    expect(event(root)).toMatchObject({ measureRest: !wasFull, beam });
    expect(errors(root)).toEqual([]);
  });

  it.each([
    '<music-rest id="n" duration="eighth"></music-rest><music-note id="tail" pitch="C4" duration="eighth"></music-note>',
    '<music-tuplet id="triplet" actual="3" normal="2"><music-rest id="n" duration="eighth"></music-rest><music-note id="tail" pitch="C4" duration="quarter"></music-note></music-tuplet>',
    '<music-note id="start" pitch="C4" duration="eighth" beam="start"></music-note><music-rest id="n" duration="eighth" beam="continue"></music-rest><music-note id="tail" pitch="D4" duration="eighth" beam="end"></music-note>',
  ])('rejects an unsafe full-rest conversion without removing surrounding music, tuplets or beams: %s', body => {
    const editor = session(score(body));
    const before = editor.project.sourceHtml;
    expect(() => editor.execute(patch(['measureRest'], { measureRest: true }))).toThrow(EditorValidationError);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it.each(['rhythmic', 'measureRest'] as const)('rejects an inapplicable true %s flag but preserves false as a no-op', field => {
    const root = score(AUTHORED_NOTE);
    const before = root.outerHTML;
    expect(() => patchEventFields(root.querySelector('#n')!, event(root), input({ [field]: true }), [field])).toThrow();
    expect(root.outerHTML).toBe(before);
    expect(patchEventFields(root.querySelector('#n')!, event(root), input({ [field]: false }), [field]))
      .toEqual({ changed: false, rhythmChanged: false });
    expect(root.outerHTML).toBe(before);
  });
});
