// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { analyzeContinuation } from '../src/authoring/continuation';
import { EditorSession } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import type { AuthorCommand, Cursor, EventInput } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { rational } from '../src/model/index';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function note(id = 'tail', attributes = 'pitch="C4" duration="whole"'): string {
  return `<music-note id="${id}" ${attributes}></music-note>`;
}

function bar(body = note(), attributes = '', id = 'bar'): string {
  return `<music-measure id="${id}" ${attributes}>${body}</music-measure>`;
}

function staff(body = bar(), attributes = '', id = 'staff'): string {
  return `<music-staff id="${id}" ${attributes}>${body}</music-staff>`;
}

function entry(overrides: Partial<EventInput> = {}): EventInput {
  return { kind: 'note', pitch: 'F#4', pitches: 'C4 E4 G4', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'courtesy', stem: 'auto', beam: 'auto', ...overrides };
}

function cursor(overrides: Partial<Cursor> = {}): Cursor {
  return { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'tail', ...overrides };
}

function continuation(overrides: Partial<Extract<AuthorCommand, { type: 'append-and-insert' }>> = {}): Extract<AuthorCommand, { type: 'append-and-insert' }> {
  return { type: 'append-and-insert', cursor: cursor(), value: entry(), position: 'after', ...overrides };
}

function ending(overrides: Partial<Extract<AuthorCommand, { type: 'continue-piece' }>> = {}): Extract<AuthorCommand, { type: 'continue-piece' }> {
  return { type: 'continue-piece', cursor: cursor(), value: entry(), position: 'after', confirmation: 'final-to-single', ...overrides };
}

function session(html = staff()): EditorSession {
  const editor = new EditorSession(createProject(html, 'Continuation'));
  editor.select('tail');
  return editor;
}

function errors(root: Element): string[] {
  return readScore(root).diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code);
}

/** Reconciliation preserves source data, but native attribute list order may change. */
function sourceData(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('*')) {
    const attributes = [...node.attributes].map(attribute => [attribute.name, attribute.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of attributes) node.setAttribute(name, value);
  }
  return template.innerHTML;
}

describe('atomic append and entry commands', () => {
  it('appends one column and enters at zero as one reversible transaction', () => {
    const html = `<!-- before -->\n${staff(bar('<!-- keep -->' + note('tail', 'pitch="F4" accidental="sharp" duration="1" data-author="keep"')
      + '<music-direction id="direction" text="Listen" at="0"></music-direction>', 'data-section="head"'), 'key="G"')}\n<!-- after -->`;
    const editor = session(html);
    const before = editor.project.sourceHtml;
    const oldBar = editor.source.querySelector('#bar');
    const oldNote = editor.source.querySelector('#tail');
    const beforeMeasure = editor.score.staves[0].measures[0];
    const result = editor.execute(continuation());
    const newBar = editor.score.staves[0].measures[1];
    const newEvent = newBar.voices[0].events[0];
    expect(editor.score.staves[0].measures).toHaveLength(2);
    expect(editor.score.staves[0].measures[0]).toEqual(beforeMeasure);
    expect(newEvent).toMatchObject({ id: result.selectionId, kind: 'note', duration: 'quarter', time: rational(1, 4), onset: rational(0),
      pitches: [{ step: 'F', octave: 4, alter: 1, display: 'courtesy' }], tie: 'none', tupletIds: [] });
    expect(result.cursor).toEqual({ staffId: 'staff', measureId: newBar.id, voiceIndex: 0, eventId: newEvent.id });
    expect(editor.selectionId).toBe(newEvent.id);
    expect(newBar.incomplete).toBe(true);
    expect(newBar.annotations).toEqual([]);
    expect(editor.source.querySelector('#bar')).toBe(oldBar);
    expect(editor.source.querySelector('#tail')).toBe(oldNote);
    expect(editor.project.sourceHtml).toContain('<!-- before -->');
    expect(editor.project.sourceHtml).toContain('<!-- after -->');
    expect(editor.revision).toBe(1);
    expect(editor.canUndo).toBe(true);
    const after = editor.project.sourceHtml;
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.selectionId).toBe('tail');
    expect(editor.source.querySelector('#tail')).toBe(oldNote);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(editor.project.sourceHtml).toBe(after);
    expect(editor.selectionId).toBe(newEvent.id);
    expect(errors(editor.source)).toEqual([]);
  });

  it('retains lower-staff voice 2, per-staff voice counts, additive context, and unrelated source', () => {
    const html = `<music-system id="score" meter="7/8" groups="2+2+3" key="Dm">`
      + staff(bar('<music-rest id="upper-rest" measure></music-rest><music-direction id="cue" text="Wait for cue" at="0"></music-direction>', '', 'upper-bar'), 'label="Flute"', 'upper')
      + staff(bar('<music-voice id="lower-v1"><music-rest id="lower-rest" measure></music-rest></music-voice><music-voice id="lower-v2">'
        + note('begin', 'pitch="Bb2" duration="2" dotted') + note('tail', 'pitch="F3" duration="8"') + '</music-voice>', 'key="Bb" clef="bass"', 'lower-bar'), 'label="Bass"', 'lower')
      + '</music-system>';
    const editor = session(html);
    const original = editor.score.staves.map(part => part.measures[0]);
    const parts = editor.project.parts;
    const metadata = editor.project.metadata;
    const layouts = editor.project.layouts;
    const target = cursor({ staffId: 'lower', measureId: 'lower-bar', voiceIndex: 1 });
    const result = editor.execute(continuation({ cursor: target, value: entry({ kind: 'chord', pitches: 'C3 Eb3 G3', duration: 'quarter', dots: 1 }) }));
    const [upper, lower] = editor.score.staves;
    expect([upper.measures.length, lower.measures.length]).toEqual([2, 2]);
    expect(upper.measures[0]).toEqual(original[0]);
    expect(lower.measures[0]).toEqual(original[1]);
    expect([upper.measures[1].voices.length, lower.measures[1].voices.length]).toEqual([1, 2]);
    expect(upper.measures[1].voices[0].events[0]).toMatchObject({ kind: 'rest', measureRest: true, time: rational(7, 8) });
    expect(lower.measures[1].voices[0].events[0]).toMatchObject({ kind: 'rest', measureRest: true, time: rational(7, 8) });
    expect(lower.measures[1]).toMatchObject({ key: 'Bb', clef: 'bass', meter: { display: '7/8', groups: [2, 2, 3] }, incomplete: true, annotations: [] });
    expect(lower.measures[1].voices[1].events[0]).toMatchObject({ kind: 'chord', onset: rational(0), time: rational(3, 8), id: result.selectionId });
    expect(result.cursor).toEqual({ staffId: 'lower', measureId: lower.measures[1].id, voiceIndex: 1, eventId: result.selectionId });
    expect(editor.project.parts).toEqual(parts);
    expect(editor.project.metadata).toEqual(metadata);
    expect(editor.project.layouts).toEqual(layouts);
    expect(editor.project.instructionScopes).toEqual({});
    const sourceIds = [editor.source, ...editor.source.querySelectorAll('*')].map(node => node.id);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(errors(editor.source)).toEqual([]);
  });

  it.each([
    entry({ kind: 'note' }),
    entry({ kind: 'chord' }),
    entry({ kind: 'rest' }),
    entry({ kind: 'slash', rhythmic: true }),
    entry({ kind: 'slash', rhythmic: false }),
  ])('enters an explicitly requested $kind with rhythmic=$rhythmic without carrying previous semantics', value => {
    const root = element(staff());
    const result = applyCommand(root, continuation({ value }));
    const appended = readScore(root).score.staves[0].measures[1].voices[0].events[0];
    expect(appended).toMatchObject({ id: result.selectionId, kind: value.kind, rhythmic: value.kind === 'slash' && value.rhythmic,
      duration: value.duration, dots: value.dots, onset: rational(0), time: rational(1, 4), tie: 'none', tupletIds: [] });
    expect(errors(root)).toEqual([]);
  });

  it.each([false, true])('uses the planned reader label instead of incrementing a custom number (opening pickup: %s)', pickup => {
    const opening = pickup ? bar(note('pickup-note', 'pitch="D4" duration="quarter"'), 'pickup number="Intro"', 'pickup') : '';
    const editor = session(staff(opening + bar(note(), 'number="99B"')));
    const input = continuation();
    expect(analyzeContinuation(editor.source, input).newMeasureLabel).toBe('2');
    const result = editor.execute(input);
    expect(editor.score.staves[0].measures.at(-1)?.number).toBe('2');
    expect(result.message).toContain('measure 2');
    expect(editor.source.querySelector('#bar')?.getAttribute('number')).toBe('99B');
  });

  it('accepts a measure-only end cursor without demanding a click on the final event', () => {
    const editor = session();
    editor.select('bar');
    const result = editor.execute(continuation({ cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 } }));
    expect(result.cursor?.eventId).toBe(result.selectionId);
    expect(editor.selectionId).toBe(result.selectionId);
    editor.undo();
    expect(editor.selectionId).toBe('bar');
    expect(editor.canUndo).toBe(false);
  });

  it('accepts completed incoming ties and earlier nested tuplets without changing them', () => {
    const tuplet = '<music-tuplet id="outer" actual="3" normal="2">' + note('first', 'pitch="C4" duration="eighth"')
      + '<music-tuplet id="inner" actual="5" normal="4">'
      + Array.from({ length: 5 }, (_, index) => note(`inner-${index}`, 'pitch="D4" duration="sixteenth"')).join('')
      + '</music-tuplet>' + note('last-in-group', 'pitch="E4" duration="quarter" dots="1"') + '</music-tuplet>';
    const examples = [
      bar(tuplet + note('tail', 'pitch="G4" duration="half"')),
      bar(note('tie-start', 'pitch="G4" duration="half" tie="start"') + note('tail', 'pitch="G4" duration="half" tie="end"')),
    ];
    for (const body of examples) {
      const editor = session(staff(body));
      const before = editor.score.staves[0].measures[0];
      editor.execute(continuation());
      expect(editor.score.staves[0].measures[0]).toEqual(before);
      expect(editor.score.staves[0].measures[1].voices[0].events[0].time).toEqual(rational(1, 4));
      expect(errors(editor.source)).toEqual([]);
    }
  });

  it('does not treat an ordinary whole rest as a replaceable starter', () => {
    const editor = session(staff(bar('<music-rest id="tail" duration="whole"></music-rest>')));
    editor.execute(continuation());
    expect(editor.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ id: 'tail', kind: 'rest', measureRest: false });
    expect(editor.score.staves[0].measures).toHaveLength(2);
  });
});

describe('continuation rejection and recovery', () => {
  it.each([false, true])('rolls back the entire staged operation when final whole-score validation fails (reopen ending: %s)', reopen => {
    const editor = session(staff(bar(note(), reopen ? 'end-bar="final"' : '')));
    const before = editor.project;
    const oldBar = editor.source.querySelector('#bar');
    let sawAppendedColumn = false;
    expect(() => editor.execute(reopen ? ending() : continuation(), draft => {
      const staged = element(draft.sourceHtml);
      sawAppendedColumn = staged.querySelectorAll('music-measure').length === 2;
      if (reopen) expect(staged.querySelector('#bar')?.getAttribute('end-bar')).toBe('single');
      // Exercise the final validation boundary after both staged mutations,
      // not only the analyzer's early rejection of an invalid entry.
      draft.sourceHtml = draft.sourceHtml.replace('pitch="F#4"', 'pitch="H4"');
    })).toThrow(/Invalid pitch/);
    expect(sawAppendedColumn).toBe(true);
    expect(editor.project).toEqual(before);
    expect(editor.source.querySelector('#bar')).toBe(oldBar);
    expect(editor.selectionId).toBe('tail');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('preserves starter replacement before testing fullness and never appends for the placeholder', () => {
    const editor = session(staff(bar('<music-rest id="tail" measure></music-rest>')));
    const before = editor.project;
    expect(analyzeContinuation(editor.source, continuation()).eligible).toBe(false);
    expect(() => editor.execute(continuation())).toThrow(/replac/i);
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
    editor.execute({ type: 'insert-event', cursor: cursor(), value: entry(), position: 'after' });
    expect(editor.score.staves[0].measures).toHaveLength(1);
    expect(editor.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ id: 'tail', kind: 'note', time: rational(1, 4) });
  });

  it.each(['before', 'replace'] as const)('rejects continuation for %s without altering source or history', position => {
    const editor = session();
    const before = editor.project;
    expect(() => editor.execute(continuation({ position }))).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('rejects an interior event and an existing later bar without shifting or consuming them', () => {
    const body = bar(note('interior', 'pitch="C4" duration="half"') + note('tail', 'pitch="G4" duration="half"'));
    for (const [html, target] of [
      [staff(body), cursor({ eventId: 'interior' })],
      [staff(body + bar('<music-rest id="intentional-silence" measure></music-rest>', '', 'later')), cursor()],
    ] as const) {
      const editor = session(html);
      const before = editor.project;
      expect(() => editor.execute(continuation({ cursor: target }))).toThrow();
      expect(editor.project).toEqual(before);
      expect(editor.canUndo).toBe(false);
    }
  });

  it('rejects partial overflow without filling, skipping, splitting, or tying, then recovers with an exact fit', () => {
    const editor = session(staff(bar(note('tail', 'pitch="C4" duration="half" dots="1"'), 'incomplete')));
    const before = editor.project;
    expect(() => editor.execute(continuation({ value: entry({ duration: 'half' }) }))).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
    editor.execute({ type: 'insert-event', cursor: cursor(), position: 'after', value: entry() });
    expect(editor.score.staves[0].measures).toHaveLength(1);
    expect(editor.score.staves[0].measures[0].voices[0].events.map(event => event.time)).toEqual([rational(3, 4), rational(1, 4)]);
    expect(editor.score.staves[0].measures[0].voices[0].events.every(event => event.tie === 'none')).toBe(true);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.canUndo).toBe(false);
  });

  it.each([
    entry({ duration: 'breve' }),
    entry({ duration: 'whole', dots: 1 }),
    entry({ kind: 'rest', measureRest: true }),
    entry({ beam: 'start', duration: 'eighth' }),
    entry({ beam: 'continue', duration: 'eighth' }),
    entry({ beam: 'end', duration: 'eighth' }),
    entry({ pitch: 'H4' }),
    entry({ kind: 'chord', pitches: 'C4 C4' }),
  ])('leaves no orphan column and preserves redo for invalid entry $kind / $duration / $beam', value => {
    const editor = session();
    editor.execute({ type: 'set-note-pitch', eventId: 'tail', pitch: 'D4', ties: 'reject' });
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    expect(() => editor.execute(continuation({ value }))).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(revision);
    expect(editor.selectionId).toBe('tail');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.execute(continuation());
    expect(editor.score.staves[0].measures).toHaveLength(2);
    expect(editor.revision).toBe(revision + 1);
    expect(editor.canRedo).toBe(false);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.canUndo).toBe(false);
  });

  it.each([false, true])('does not escape a terminal tuplet by omitting eventId (%s)', eventless => {
    const html = staff(bar('<music-tuplet id="triplet" actual="3" normal="2">' + note('a', 'pitch="C4" duration="half"')
      + note('b', 'pitch="D4" duration="half"') + note('tail', 'pitch="E4" duration="half"') + '</music-tuplet>'));
    const editor = session(html);
    const before = editor.project;
    const target = eventless ? { staffId: 'staff', measureId: 'bar', voiceIndex: 0 } : cursor();
    expect(() => editor.execute(continuation({ cursor: target }))).toThrow(/tuplet/i);
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
  });

  it.each(['pickup', 'repeat-start', 'end-bar="repeat-end"'])('requires a deliberate structural action for %s', attributes => {
    const editor = session(staff(bar(note(), attributes)));
    const before = editor.project;
    expect(() => editor.execute(continuation())).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
  });

  it('rejects unclosed outgoing ties and overfull invalid source without mutating staged data', () => {
    for (const body of [bar(note('tail', 'pitch="C4" duration="whole" tie="start"')), bar(note('tail', 'pitch="C4" duration="breve"'))]) {
      const root = element(staff(body));
      const before = root.outerHTML;
      expect(() => applyCommand(root, continuation())).toThrow();
      expect(root.outerHTML).toBe(before);
    }
  });
});

describe('explicit final-ending continuation', () => {
  function ensemble(finalAttributes = 'end-bar="final"'): string {
    return '<music-system id="score">'
      + staff(bar(note(), 'end-bar="double"'), 'label="Visible"')
      + staff(bar(note('hidden-note'), finalAttributes, 'hidden-bar'), 'label="Hidden final staff"', 'hidden')
      + staff(bar(note('ordinary-note'), 'end-bar="none"', 'ordinary-bar'), 'label="Ordinary staff"', 'ordinary')
      + '</music-system>';
  }

  it('requires distinct authorization when only a hidden staff has the final barline', () => {
    const editor = session(ensemble());
    const before = editor.project.sourceHtml;
    const analysis = analyzeContinuation(editor.source, continuation());
    expect(analysis).toMatchObject({ eligible: false, ending: true, newMeasureLabel: '2' });
    expect(analysis.affectedStaves.map(value => [value.staffId, value.endBar])).toEqual([['staff', 'double'], ['hidden', 'final'], ['ordinary', 'none']]);
    expect(() => editor.execute(continuation())).toThrow(/final/i);
    expect(() => editor.execute({ ...ending(), confirmation: 'unconfirmed' } as unknown as AuthorCommand)).toThrow(/confirm/i);
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.canUndo).toBe(false);
    const result = editor.execute(ending());
    expect(editor.score.staves.map(value => value.measures.length)).toEqual([2, 2, 2]);
    expect(editor.score.staves.map(value => value.measures[0].endBar)).toEqual(['double', 'single', 'none']);
    expect(editor.source.querySelector('#bar')?.getAttribute('end-bar')).toBe('double');
    expect(editor.source.querySelector('#ordinary-bar')?.getAttribute('end-bar')).toBe('none');
    expect(editor.source.querySelector('#hidden-bar')?.getAttribute('end-bar')).toBe('single');
    expect(editor.selectionId).toBe(result.selectionId);
    expect(editor.revision).toBe(1);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.source.querySelector('#hidden-bar')?.getAttribute('end-bar')).toBe('final');
    expect(editor.selectionId).toBe('tail');
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.score.staves.map(value => value.measures[0].endBar)).toEqual(['double', 'single', 'none']);
    expect(editor.selectionId).toBe(result.selectionId);
  });

  it('changes every final in the canonical column, but no earlier final or existing annotation', () => {
    const first = bar(note('earlier'), 'end-bar="final"', 'earlier-bar');
    const html = '<music-system id="score">'
      + staff(first + bar(note(), 'end-bar="final" data-ending="preserved"'))
      + staff(bar(note('hidden-earlier'), 'end-bar="double"', 'hidden-earlier-bar')
        + bar('<music-direction id="end-text" text="Fine" at="0"></music-direction>' + note('hidden-tail'), 'end-bar="final"', 'hidden-bar'), '', 'hidden')
      + '</music-system>';
    const editor = session(html);
    editor.execute(ending());
    expect(editor.source.querySelector('#earlier-bar')?.getAttribute('end-bar')).toBe('final');
    expect(editor.source.querySelector('#bar')?.getAttribute('end-bar')).toBe('single');
    expect(editor.source.querySelector('#hidden-bar')?.getAttribute('end-bar')).toBe('single');
    expect(editor.source.querySelector('#bar')?.getAttribute('data-ending')).toBe('preserved');
    expect(editor.source.querySelector('#end-text')?.getAttribute('text')).toBe('Fine');
    expect(editor.score.staves.every(value => value.measures.at(-1)?.annotations.length === 0)).toBe(true);
  });

  it.each(['repeat-start end-bar="final"', 'end-bar="repeat-end"'])('does not suppress hidden repeat semantics (%s)', attributes => {
    const editor = session(ensemble(attributes));
    const before = editor.project;
    const analysis = analyzeContinuation(editor.source, ending());
    expect(analysis.eligible).toBe(false);
    expect(analysis.ending).toBe(false);
    expect(() => editor.execute(ending())).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
  });

  it.each([
    ending({ value: entry({ duration: 'breve' }) }),
    ending({ value: entry({ beam: 'start', duration: 'eighth' }) }),
    ending({ value: entry({ kind: 'rest', measureRest: true }) }),
    ending({ position: 'before' }),
    ending({ cursor: cursor({ eventId: 'missing' }) }),
  ])('keeps finals untouched when another continuation guard fails', command => {
    const editor = session(ensemble());
    const before = editor.project;
    expect(analyzeContinuation(editor.source, command).ending).toBe(false);
    expect(() => editor.execute(command)).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
  });

  it('does not turn a final-only command into ordinary continuation when no final remains', () => {
    const editor = session();
    const before = editor.project;
    expect(() => editor.execute(ending())).toThrow(/no final/i);
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
  });
});

describe('append voice retention and sustained entry', () => {
  it('retains an explicitly requested lower voice while preserving legacy measure-only selection by default', () => {
    const html = staff(bar('<music-voice id="one"><music-rest id="r1" measure></music-rest></music-voice>'
      + '<music-voice id="two"><music-rest id="r2" measure></music-rest></music-voice>'));
    const editor = session(html);
    const result = editor.execute({ type: 'append-measure', afterMeasureId: 'bar', voiceIndex: 1 });
    const measure = editor.score.staves[0].measures[1];
    expect(result.selectionId).toBe(measure.voices[1].events[0].id);
    expect(result.cursor).toEqual({ staffId: 'staff', measureId: measure.id, voiceIndex: 1, eventId: result.selectionId });
    editor.undo();
    const legacy = editor.execute({ type: 'append-measure', afterMeasureId: 'bar' });
    const legacyMeasure = editor.score.staves[0].measures[1];
    expect(legacy.selectionId).toBe(legacyMeasure.id);
    expect(legacy.cursor).toEqual({ staffId: 'staff', measureId: legacyMeasure.id, voiceIndex: 0 });
  });

  it.each([-1, 1, 0.5, NaN])('rejects an unavailable append voice %s before adding any column', voiceIndex => {
    const root = element(staff());
    const before = root.outerHTML;
    expect(() => applyCommand(root, { type: 'append-measure', afterMeasureId: 'bar', voiceIndex })).toThrow(/voice/i);
    expect(root.outerHTML).toBe(before);
  });

  it.each([8, 16])('writes %s full measures with no trailing empty column and one history step per entry', measures => {
    const editor = session(staff(bar('<music-rest id="tail" measure></music-rest>')));
    let at = cursor();
    const value = entry();
    for (let index = 0; index < measures * 4; index++) {
      const request = continuation({ cursor: at, value });
      const analysis = analyzeContinuation(editor.source, request);
      const result = editor.execute(analysis.eligible ? request : { type: 'insert-event', cursor: at, value, position: 'after' });
      const measure = editor.score.staves[0].measures.find(candidate => candidate.voices.some(voice => voice.events.some(event => event.id === result.selectionId)))!;
      at = { staffId: 'staff', measureId: measure.id, voiceIndex: 0, eventId: result.selectionId };
      expect(editor.revision).toBe(index + 1);
    }
    expect(editor.score.staves[0].measures).toHaveLength(measures);
    for (const measure of editor.score.staves[0].measures) {
      expect(measure.voices[0].events).toHaveLength(4);
      expect(measure.voices[0].events.map(event => event.onset)).toEqual([rational(0), rational(1, 4), rational(1, 2), rational(3, 4)]);
      expect(measure.voices[0].events.every(event => event.kind === 'note' && event.time.numerator === 1 && event.time.denominator === 4)).toBe(true);
    }
    expect(errors(editor.source)).toEqual([]);
    for (let index = 0; index < measures * 4; index++) editor.undo();
    expect(editor.score.staves[0].measures).toHaveLength(1);
    expect(editor.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ id: 'tail', kind: 'rest', measureRest: true });
    expect(editor.canUndo).toBe(false);
  });
});

describe('continuation with the current rhythm and microtonal grammar', () => {
  it('continues a rhythm staff alongside pitched music without adding a pitched context', () => {
    const html = '<music-system id="score" meter="4/4" key="G">'
      + staff(bar(note('pitched', 'pitch="Fqs4" duration="whole"'), '', 'pitched-bar'), 'label="Flute"', 'pitched-staff')
      + staff(bar('<music-rhythm id="tail" duration="whole"></music-rhythm>'), 'notation="rhythm" label="Drums"')
      + '</music-system>';
    const editor = session(html);
    const original = editor.score.staves.map(value => value.measures[0]);
    const result = editor.execute(continuation({ value: entry({ kind: 'rhythm' }) }));
    const [pitched, rhythm] = editor.score.staves;
    expect([pitched.measures.length, rhythm.measures.length]).toEqual([2, 2]);
    expect(pitched.measures[0]).toEqual(original[0]);
    expect(rhythm.measures[0]).toEqual(original[1]);
    expect(rhythm.notation).toBe('rhythm');
    expect(rhythm.measures[1].voices[0].events[0]).toMatchObject({ id: result.selectionId, kind: 'rhythm', pitches: [],
      onset: rational(0), time: rational(1, 4), rhythmic: false, tie: 'none' });
    const rhythmStaff = editor.source.querySelector('#staff')!;
    expect(rhythmStaff.querySelectorAll('[clef], [key], music-note, music-chord')).toHaveLength(0);
    expect(errors(editor.source)).toEqual([]);
  });

  it.each([
    ['Fqs4', 0.5], ['Fqf4', -0.5], ['Ftqs4', 1.5], ['Ftqf4', -1.5],
  ] as const)('uses model spelling for %s without normalizing earlier microtonal attributes', (pitch, alter) => {
    const editor = session(staff(bar(note('tail', 'pitch="F4" accidental="quarter-sharp" duration="whole" data-author="keep"')), 'key="G"'));
    const before = editor.source.querySelector('#tail')!.outerHTML;
    editor.execute(continuation({ value: entry({ pitch }) }));
    expect(editor.source.querySelector('#tail')!.outerHTML).toBe(before);
    expect(editor.score.staves[0].measures[1].voices[0].events[0].pitches[0]).toMatchObject({ step: 'F', octave: 4, alter, display: 'courtesy' });
    expect(errors(editor.source)).toEqual([]);
  });

  it('retains completed rhythm-note ties while starting the next measure untied', () => {
    const editor = session(staff(bar('<music-rhythm id="start" duration="half" tie="start"></music-rhythm>'
      + '<music-rhythm id="tail" duration="half" tie="end"></music-rhythm>'), 'notation="rhythm"'));
    const before = editor.score.staves[0].measures[0];
    editor.execute(continuation({ value: entry({ kind: 'rhythm' }) }));
    expect(editor.score.staves[0].measures[0]).toEqual(before);
    expect(editor.score.staves[0].measures[1].voices[0].events[0]).toMatchObject({ kind: 'rhythm', tie: 'none', pitches: [] });
    expect(errors(editor.source)).toEqual([]);
  });

  it.each(['pitched', 'rhythm'] as const)('does not reopen a final for an event incompatible with %s notation', notation => {
    const content = notation === 'rhythm' ? '<music-rhythm id="tail" duration="whole"></music-rhythm>' : note();
    const editor = session(staff(bar(content, 'end-bar="final"'), notation === 'rhythm' ? 'notation="rhythm"' : ''));
    const command = ending({ value: entry({ kind: notation === 'rhythm' ? 'note' : 'rhythm' }) });
    const before = editor.project;
    expect(analyzeContinuation(editor.source, command).ending).toBe(false);
    expect(() => editor.execute(command)).toThrow(/rhythm/i);
    expect(editor.project).toEqual(before);
    expect(editor.canUndo).toBe(false);
  });
});
