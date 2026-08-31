// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession, EditorValidationError } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import type { AuthorCommand } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { durationTime, rational } from '../src/model/index';
import type { Duration, MusicEvent } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function score(body: string, measureAttributes = '', staffAttributes = ''): Element {
  return element(`<music-system id="score"><music-staff id="staff" ${staffAttributes}><music-measure id="bar" ${measureAttributes}>${body}</music-measure></music-staff></music-system>`);
}

function note(id: string, attributes = 'pitch="C4" duration="half"'): string {
  return `<music-note id="${id}" ${attributes}></music-note>`;
}

function event(root: Element, id = 'n1'): MusicEvent {
  return readScore(root).score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).find(value => value.id === id)!;
}

function attrs(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

function errors(root: Element): string[] {
  return readScore(root).diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function session(root = score(note('n1', 'pitch="F4" accidental="sharp" duration="half" accidental-display="courtesy" data-author="kept"')
  + '<!-- keep the instruction --> <music-direction id="direction" text="Listen"></music-direction>' + note('n2'), '', 'key="G"')): EditorSession {
  const editor = new EditorSession(createProject(root.outerHTML, 'Selected note properties'));
  editor.select('n1');
  return editor;
}

/** Attribute order is not source data; native reconciliation may restore it differently. */
function sourceData(html: string): string {
  const root = element(html);
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const attributes = Object.entries(attrs(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of attributes) node.setAttribute(name, value);
  }
  return root.outerHTML;
}

function validationCodes(edit: () => unknown): string[] {
  try { edit(); } catch (error) {
    expect(error).toBeInstanceOf(EditorValidationError);
    return (error as EditorValidationError).diagnostics.map(item => item.code);
  }
  throw new Error('The invalid edit unexpectedly committed.');
}

describe('selected note accidental commands', () => {
  it.each([
    [-2, 'Bbb3'], [-1, 'Bb3'], [0, 'B3'], [1, 'B#3'], [2, 'B##3'],
  ] as const)('chooses alteration %s on the same letter and octave, independently of key', (alter, pitch) => {
    const root = score(note('n1', 'pitch="Bb3" duration="whole" accidental-display="courtesy" stem="down" beam="none" data-user="keep"'), '', 'key="G"');
    const before = event(root);
    const result = applyCommand(root, { type: 'set-note-accidental', eventId: 'n1', alter, ties: 'reject' });
    expect(result.selectionId).toBe('n1');
    expect(root.querySelector('#n1')?.getAttribute('pitch')).toBe(pitch);
    expect(event(root)).toEqual({ ...before, pitches: [{ ...before.pitches[0], alter }] });
    expect(root.querySelector('#bar')?.hasAttribute('incomplete')).toBe(false);
    expect(errors(root)).toEqual([]);
  });

  it('removes a conflicting legacy accidental but preserves literal rhythm, engraving, metadata, and parent', () => {
    const root = score(`<!-- retained --> <music-tuplet id="t" actual="3" normal="2" ratio bracket="yes">`
      + note('n1', 'pitch="F4" accidental="sharp" duration="8" dotted accidental-display="always" stem="down" beam="none" data-author="A &amp; B"')
      + '</music-tuplet>', 'incomplete', 'key="G"');
    const node = root.querySelector('#n1')!;
    const before = event(root);
    const expectedAttrs: Record<string, string> = { ...attrs(node), pitch: 'F4' };
    delete expectedAttrs.accidental;
    const parent = node.parentElement;
    applyCommand(root, { type: 'set-note-accidental', eventId: 'n1', alter: 0, ties: 'reject' });
    expect(root.querySelector('#n1')).toBe(node);
    expect(node.parentElement).toBe(parent);
    expect(attrs(node)).toEqual(expectedAttrs);
    expect(event(root)).toEqual({ ...before, pitches: [{ ...before.pitches[0], alter: 0 }] });
    expect(root.innerHTML).toContain('<!-- retained -->');
    expect(errors(root)).toEqual([]);
  });

  it.each(['pitch="f♯4"', 'pitch="F4" accidental="sharp"', 'pitch="F#4" accidental="sharp"'])('does not canonicalize an unchanged accidental: %s', pitch => {
    const root = score(note('n1', `${pitch} duration="1" data-user="keep"`));
    const before = root.outerHTML;
    expect(applyCommand(root, { type: 'set-note-accidental', eventId: 'n1', alter: 1, ties: 'reject' }).message).toContain('nothing changed');
    expect(root.outerHTML).toBe(before);
  });

  it.each(['n1', 'n2', 'n3'])('preserves tied same-alter requests and rejects changes to %s without clearing the chain', eventId => {
    const root = score(note('n1', 'pitch="F4" accidental="sharp" duration="quarter" tie="start"')
      + note('n2', 'pitch="F#4" duration="half" tie="continue"')
      + note('n3', 'pitch="F#4" duration="quarter" tie="end"'));
    const before = root.outerHTML;
    applyCommand(root, { type: 'set-note-accidental', eventId, alter: 1, ties: 'reject' });
    expect(root.outerHTML).toBe(before);
    expect(() => applyCommand(root, { type: 'set-note-accidental', eventId, alter: 0, ties: 'reject' })).toThrow('Clear the connected tie chain');
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    '<music-chord id="n1" pitches="C4 E4" duration="whole"></music-chord>',
    '<music-rest id="n1" duration="whole"></music-rest>',
    '<music-slash id="n1" duration="whole"></music-slash>',
    '<music-slash id="n1" duration="whole" rhythmic></music-slash>',
  ])('rejects non-single-note accidental edits without mutation: %s', markup => {
    const root = score(markup);
    const before = root.outerHTML;
    expect(() => applyCommand(root, { type: 'set-note-accidental', eventId: 'n1', alter: 1, ties: 'reject' })).toThrow('single note only');
    expect(root.outerHTML).toBe(before);
  });

  it.each([-3, 3, 0.25, NaN, Infinity, undefined])('rejects unsupported runtime alteration %s before writing', alter => {
    const root = score(note('n1', 'pitch="C4" duration="whole"'));
    const before = root.outerHTML;
    const command = { type: 'set-note-accidental', eventId: 'n1', alter, ties: 'reject' } as AuthorCommand;
    expect(() => applyCommand(root, command)).toThrow('alteration');
    expect(root.outerHTML).toBe(before);
  });
});

describe('selected event written rhythm commands', () => {
  it.each([
    note('n1', 'pitch="F4" accidental="sharp" duration="whole" accidental-display="courtesy" stem="down" beam="none" data-author="keep"'),
    '<music-chord id="n1" pitches="Bb3 D4 F4" duration="whole" accidental-display="always" stem="up" data-author="keep"></music-chord>',
    '<music-rest id="n1" duration="whole" beam="none" data-author="keep"></music-rest>',
    '<music-slash id="n1" duration="whole" rhythmic stem="down" data-author="keep"></music-slash>',
  ])('changes only written duration on a supported event: %s', markup => {
    const root = score(markup);
    const node = root.querySelector('#n1')!;
    const before = event(root);
    const expectedAttrs = { ...attrs(node), duration: 'half' };
    const result = applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'half', dots: 0 });
    expect(result.selectionId).toBe('n1');
    expect(attrs(node)).toEqual(expectedAttrs);
    expect(event(root)).toEqual({ ...before, duration: 'half', time: rational(1, 2) });
    expect(root.querySelectorAll('music-note, music-chord, music-rest, music-slash')).toHaveLength(1);
    expect(root.querySelector('#bar')?.hasAttribute('incomplete')).toBe(true);
    expect(errors(root)).toEqual([]);
  });

  it('preserves legacy dotted spelling when only duration changes', () => {
    const root = score(note('n1', 'pitch="F4" accidental="sharp" duration="2" dotted dots="1" data-user="keep"') + note('n2', 'pitch="C4" duration="quarter"'));
    const node = root.querySelector('#n1')!;
    const before = attrs(node);
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 1 });
    expect(attrs(node)).toEqual({ ...before, duration: 'quarter' });
    expect(event(root).time).toEqual(rational(3, 8));
    expect(event(root, 'n2').onset).toEqual(rational(3, 8));
    expect(errors(root)).toEqual([]);
  });

  it.each([0, 2, 3])('replaces legacy dot attributes only when changing the dot count to %s', dots => {
    const root = score(note('n1', 'pitch="F4" accidental="sharp" duration="8" dotted dots="1" data-user="keep"'), 'incomplete');
    const node = root.querySelector('#n1')!;
    const expectedAttrs = attrs(node);
    delete expectedAttrs.dotted;
    if (dots) expectedAttrs.dots = String(dots);
    else delete expectedAttrs.dots;
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots });
    expect(attrs(node)).toEqual(expectedAttrs);
    expect(event(root).time).toEqual(durationTime('eighth', dots));
    expect(errors(root)).toEqual([]);
  });

  it.each([
    ['duration="4"', 'quarter', 0],
    ['', 'quarter', 0],
    ['duration="8" dotted', 'eighth', 1],
    ['duration="8" dotted dots="1"', 'eighth', 1],
  ] as const)('keeps a semantic no-op literally unchanged: %s', (attributes, duration, dots) => {
    const root = score(note('n1', `pitch="C4" ${attributes} data-user="keep"`), 'incomplete');
    const before = root.outerHTML;
    expect(applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration, dots }).message).toContain('nothing changed');
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    ['<music-rest id="n1" measure></music-rest>', 'full-measure rest'],
    ['<music-slash id="n1" duration="whole"></music-slash>', 'open slash'],
  ])('rejects rhythm controls for %s even when the requested values match', (markup, message) => {
    const root = score(markup);
    const before = root.outerHTML;
    for (const duration of ['whole', 'half'] as const) {
      expect(() => applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration, dots: 0 })).toThrow(message);
      expect(root.outerHTML).toBe(before);
    }
  });

  it('retains nested tuplet and voice membership with exact multiplied time and visible draft diagnostics', () => {
    const root = score('<music-voice id="v1"><music-tuplet id="outer" actual="3" normal="2" bracket="yes" ratio><music-tuplet id="inner" actual="3" normal="2">'
      + note('n1', 'pitch="C4" duration="sixteenth"') + note('n2', 'pitch="D4" duration="sixteenth"') + note('n3', 'pitch="E4" duration="sixteenth"')
      + '</music-tuplet>' + note('n4', 'pitch="F4" duration="eighth"') + note('n5', 'pitch="G4" duration="eighth"')
      + '</music-tuplet></music-voice><music-voice id="v2"><music-rest id="other" duration="quarter"></music-rest></music-voice>', 'meter="1/4"');
    expect(errors(root)).toEqual([]);
    const before = readScore(root).score.staves[0].measures[0];
    const parent = root.querySelector('#n1')!.parentElement;
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'thirty-second', dots: 0 });
    const after = readScore(root).score.staves[0].measures[0];
    expect(root.querySelector('#n1')!.parentElement).toBe(parent);
    expect(after.voices[0].tuplets).toEqual(before.voices[0].tuplets);
    expect(after.voices[1]).toEqual(before.voices[1]);
    expect(event(root)).toMatchObject({ duration: 'thirty-second', dots: 0, time: rational(1, 72), tupletIds: ['outer', 'inner'] });
    expect(after.voices[0].events.map(value => value.onset)).toEqual([rational(0), rational(1, 72), rational(1, 24), rational(5, 72), rational(11, 72)]);
    expect(after.incomplete).toBe(true);
    expect(readScore(root).diagnostics.some(item => item.code === 'tuplet-span' && item.severity === 'warning')).toBe(true);
    expect(errors(root)).toEqual([]);
  });

  it('preserves legacy triplet markers when changing written rhythm', () => {
    const root = score(note('n1', 'pitch="C4" duration="8" triplet="start"')
      + note('n2', 'pitch="D4" duration="8"') + note('n3', 'pitch="E4" duration="8" triplet="end"'), 'meter="1/4"');
    const before = readScore(root).score.staves[0].measures[0].voices[0].tuplets;
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'sixteenth', dots: 0 });
    expect(event(root).time).toEqual(rational(1, 24));
    expect(readScore(root).score.staves[0].measures[0].voices[0].tuplets).toEqual(before);
    expect(root.querySelector('#n1')?.getAttribute('triplet')).toBe('start');
    expect(root.querySelector('#n3')?.getAttribute('triplet')).toBe('end');
    expect(root.querySelector('music-tuplet')).toBeNull();
    expect(errors(root)).toEqual([]);
  });

  it.each([false, true])('retains annotation anchoring rather than rewriting its onset (fixed: %s)', fixed => {
    const root = score(note('n1') + `<music-harmony id="h" text="G7"${fixed ? ' at="1/2"' : ''}></music-harmony>` + note('n2'));
    const annotation = root.querySelector('#h')!.outerHTML;
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 0 });
    expect(root.querySelector('#h')!.outerHTML).toBe(annotation);
    expect(readScore(root).score.staves[0].measures[0].annotations[0].onset).toEqual(fixed ? rational(1, 2) : rational(1, 4));
    expect(errors(root)).toEqual([]);
  });

  it.each([
    ['invalid' as Duration, 0], ['quarter', -1], ['quarter', 4], ['quarter', 0.5], ['quarter', NaN], ['quarter', undefined],
  ])('rejects invalid written rhythm %s / %s before mutation', (duration, dots) => {
    const root = score(note('n1') + note('n2'));
    const before = root.outerHTML;
    expect(() => applyCommand(root, { type: 'set-event-rhythm', eventId: 'n1', duration, dots } as AuthorCommand)).toThrow();
    expect(root.outerHTML).toBe(before);
  });
});

describe('selected note property transactions', () => {
  it.each([
    { type: 'set-note-accidental', eventId: 'n1', alter: 0, ties: 'reject' },
    { type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 1 },
  ] satisfies AuthorCommand[])('commits $type as one undo step, preserving source identity and unrelated notation', command => {
    const editor = session();
    const before = editor.project.sourceHtml;
    const node = editor.source.querySelector('#n1');
    const unchangedNote = editor.source.querySelector('#n2')!.outerHTML;
    editor.execute(command);
    const after = editor.project.sourceHtml;
    expect(editor.revision).toBe(1);
    expect(editor.selectionId).toBe('n1');
    expect(editor.source.querySelector('#n1')).toBe(node);
    expect(editor.source.querySelector('#n2')!.outerHTML).toBe(unchangedNote);
    expect(after).toContain('<!-- keep the instruction -->');
    expect(node?.getAttribute('accidental-display')).toBe('courtesy');
    expect(node?.getAttribute('data-author')).toBe('kept');
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#n1')).toBe(node);
    expect(node?.getAttribute('accidental')).toBe('sharp');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(editor.project.sourceHtml).toBe(after);
    expect(editor.source.querySelector('#n1')).toBe(node);
  });

  it('preserves accepted source, reviews, selection history, and redo for semantic no-ops', () => {
    const root = score(note('n1', 'pitch="F4" accidental="sharp" duration="8" dotted tie="start"')
      + note('n2', 'pitch="F#4" duration="quarter" tie="end"'), 'incomplete');
    const project = createProject(root.outerHTML, 'No-op review');
    project.reviewedShortMeasures = ['bar'];
    project.layouts.score.reviewedTurns[project.columns[0].id] = 'reviewed';
    const editor = new EditorSession(project);
    editor.select('n2');
    const before = editor.project;
    editor.execute({ type: 'set-note-accidental', eventId: 'n1', alter: 1, ties: 'reject' });
    editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 1 });
    expect(editor.project).toEqual(before);
    expect(editor.selectionId).toBe('n1');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
    editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'sixteenth', dots: 1 });
    editor.undo();
    const restored = editor.project;
    const revision = editor.revision;
    editor.execute({ type: 'set-note-accidental', eventId: 'n1', alter: 1, ties: 'reject' });
    editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 1 });
    expect(editor.project).toEqual(restored);
    expect(sourceData(restored.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(editor.project.reviewedShortMeasures).toEqual(['bar']);
    expect(editor.project.layouts.score.reviewedTurns).toEqual(before.layouts.score.reviewedTurns);
  });

  it.each([
    ['whole', 0], ['half', 1],
  ] as const)('rolls back overflow for %s / %s, preserves redo, and recovers with one valid edit', (duration, dots) => {
    const editor = session();
    editor.execute({ type: 'set-note-accidental', eventId: 'n1', alter: 0, ties: 'reject' });
    editor.undo();
    editor.select('n2');
    const before = editor.project;
    const revision = editor.revision;
    const node = editor.source.querySelector('#n1');
    expect(validationCodes(() => editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration, dots }))).toContain('measure-overfull');
    expect(editor.project).toEqual(before);
    expect(editor.source.querySelector('#n1')).toBe(node);
    expect(editor.selectionId).toBe('n2');
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 0 });
    expect(editor.revision).toBe(revision + 1);
    expect(editor.selectionId).toBe('n1');
    expect(editor.canRedo).toBe(false);
    expect(editor.score.staves[0].measures[0].incomplete).toBe(true);
    expect(editor.score.staves[0].measures[0].voices[0].events.map(value => value.duration)).toEqual(['quarter', 'half']);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.selectionId).toBe('n2');
    expect(editor.canUndo).toBe(false);
  });

  it.each(['note', 'chord'] as const)('preserves a complete tied %s chain when changing written rhythm', kind => {
    const pitches = kind === 'note' ? 'pitch="F#4"' : 'pitches="F#4 A4 C#5"';
    const root = score(`<music-${kind} id="n1" ${pitches} duration="half" tie="start"></music-${kind}><music-${kind} id="n2" ${pitches} duration="half" tie="end"></music-${kind}>`);
    const editor = session(root);
    const before = editor.score.staves[0].measures[0].voices[0].events;
    editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 1 });
    const after = editor.score.staves[0].measures[0].voices[0].events;
    expect(after[0]).toEqual({ ...before[0], duration: 'quarter', dots: 1, time: rational(3, 8) });
    expect(after[1]).toEqual({ ...before[1], onset: rational(3, 8) });
    expect(editor.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(editor.revision).toBe(1);
  });

  it('rejects changes that invalidate an explicit beam without silently changing that beam', () => {
    const editor = session(score(note('n1', 'pitch="C4" duration="eighth" beam="start"')
      + note('n2', 'pitch="D4" duration="eighth" beam="end"') + '<music-rest id="r" duration="half"></music-rest>', 'incomplete'));
    const before = editor.project;
    expect(validationCodes(() => editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 0 }))).toContain('invalid-beam-member');
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('rejects a pickup rhythm change that misaligns the ensemble', () => {
    const root = element('<music-system id="score"><music-staff id="upper"><music-measure id="bar" pickup>'
      + note('n1', 'pitch="C4" duration="quarter"') + '</music-measure></music-staff><music-staff id="lower"><music-measure id="lower-bar" pickup>'
      + note('n2', 'pitch="C3" duration="quarter"') + '</music-measure></music-staff></music-system>');
    const editor = session(root);
    const before = editor.project;
    expect(validationCodes(() => editor.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 0 }))).toContain('staff-pickup-duration-mismatch');
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
    expect(editor.source.querySelectorAll('[incomplete]')).toHaveLength(0);
  });

  it('preserves accepted state and selection when tied accidental and missing-event requests fail', () => {
    const editor = session(score(note('n1', 'pitch="F4" accidental="sharp" duration="half" tie="start"')
      + note('n2', 'pitch="F#4" duration="half" tie="end"')));
    editor.select('n2');
    const before = editor.project;
    expect(() => editor.execute({ type: 'set-note-accidental', eventId: 'n1', alter: 0, ties: 'reject' })).toThrow('Clear the connected tie chain');
    expect(() => editor.execute({ type: 'set-note-accidental', eventId: 'missing', alter: 0, ties: 'reject' })).toThrow();
    expect(() => editor.execute({ type: 'set-event-rhythm', eventId: 'missing', duration: 'quarter', dots: 0 })).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.selectionId).toBe('n2');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });
});
