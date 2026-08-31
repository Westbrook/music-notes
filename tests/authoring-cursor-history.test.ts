import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import type { Cursor, EventInput } from '../src/authoring/types.js';

const source = `<music-system id="score">
  <music-staff id="upper" label="Melody">
    <music-measure id="upper-1">
      <music-direction id="direction" text="Leave space"></music-direction>
      <music-voice id="upper-1-v1"><music-note id="a" pitch="C4" duration="whole"></music-note></music-voice>
      <music-voice id="upper-1-v2"><music-note id="b" pitch="E4" duration="whole"></music-note></music-voice>
    </music-measure>
    <music-measure id="upper-2">
      <music-voice id="upper-2-v1"><music-note id="c" pitch="D4" duration="whole"></music-note></music-voice>
      <music-voice id="upper-2-v2"><music-note id="d" pitch="F4" duration="whole"></music-note></music-voice>
    </music-measure>
  </music-staff>
  <music-staff id="lower" label="Bass" clef="bass">
    <music-measure id="lower-1">
      <music-voice id="lower-1-v1"><music-note id="e" pitch="C3" duration="whole"></music-note></music-voice>
      <music-voice id="lower-1-v2"><music-note id="f" pitch="E3" duration="whole"></music-note></music-voice>
    </music-measure>
    <music-measure id="lower-2">
      <music-voice id="lower-2-v1"><music-note id="g" pitch="D3" duration="whole"></music-note></music-voice>
      <music-voice id="lower-2-v2"><music-note id="h" pitch="F3" duration="whole"></music-note></music-voice>
    </music-measure>
  </music-staff>
</music-system>`;

const lowerEnd: Cursor = { staffId: 'lower', measureId: 'lower-2', voiceIndex: 1 };
const upperNote: Cursor = { staffId: 'upper', measureId: 'upper-1', voiceIndex: 1, eventId: 'b' };

function editor(html = source): EditorSession { return new EditorSession(createProject(html, 'Full cursor history')); }
function note(pitch = 'G3', duration: EventInput['duration'] = 'quarter'): EventInput {
  return {
    kind: 'note', pitch, pitches: '', duration, dots: 0, rhythmic: false,
    measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
  };
}
function selectEnd(session: EditorSession): void {
  session.select(lowerEnd.measureId);
  session.setCursor(lowerEnd);
}

describe('transient full authoring cursor', () => {
  it('starts without an inferred first-staff cursor', () => {
    const session = editor();
    expect(session.cursor).toBeUndefined();
    expect(session.selectionId).toBeUndefined();
  });

  it('copies both the reported cursor and each returned cursor', () => {
    const session = editor();
    const supplied = { ...upperNote };
    session.setCursor(supplied);
    supplied.voiceIndex = 0;
    supplied.eventId = 'a';
    expect(session.cursor).toEqual(upperNote);
    const returned = session.cursor!;
    returned.staffId = 'lower';
    returned.eventId = 'h';
    expect(session.cursor).toEqual(upperNote);
  });

  it('does not change selection, content, revision, history, notifications, or redo during navigation', () => {
    const session = editor();
    session.select('direction');
    session.update('Title', draft => { draft.metadata.title = 'A revision'; });
    session.undo();
    const before = session.project;
    const revision = session.revision;
    const events: Event[] = [];
    session.addEventListener('change', event => events.push(event));
    session.setCursor(lowerEnd);
    session.setCursor(upperNote);
    session.setCursor(upperNote);
    expect(session.selectionId).toBe('direction');
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(revision);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
    expect(events).toEqual([]);
  });

  it.each<Cursor>([
    { ...upperNote, staffId: 'missing' },
    { ...upperNote, staffId: 'lower' },
    { ...upperNote, measureId: 'missing' },
    { ...upperNote, measureId: 'upper-2' },
    { ...upperNote, voiceIndex: -1 },
    { ...upperNote, voiceIndex: 0.5 },
    { ...upperNote, voiceIndex: Number.NaN },
    { ...upperNote, voiceIndex: Number.POSITIVE_INFINITY },
    { ...upperNote, voiceIndex: 2 },
    { ...upperNote, voiceIndex: 0 },
    { ...upperNote, eventId: 'missing' },
    { ...upperNote, eventId: 'd' },
    { ...upperNote, eventId: 'direction' },
    { ...upperNote, eventId: '' },
  ])('clears an invalid cursor without guessing another location: %j', cursor => {
    const session = editor();
    session.select('direction');
    session.setCursor(upperNote);
    const before = session.project;
    session.setCursor(cursor);
    expect(session.cursor).toBeUndefined();
    expect(session.selectionId).toBe('direction');
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(0);
    expect(session.canUndo).toBe(false);
  });

  it('derives exact event and explicit voice locations for existing select callers', () => {
    const session = editor();
    session.select('b');
    expect(session.cursor).toEqual(upperNote);
    session.select('lower-2-v2');
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2-v2');
  });

  it('retains voice 2 on measure and annotation selection without replacing annotation IDs', () => {
    const session = editor();
    session.select('b');
    session.select('upper-2');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-2', voiceIndex: 1 });
    session.select('direction');
    expect(session.selectionId).toBe('direction');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
  });

  it('finds a tuplet owner without treating the tuplet ID as an event ID', () => {
    const session = editor(source.replace('<music-note id="b" pitch="E4" duration="whole"></music-note>',
      '<music-tuplet id="triplet" actual="3" normal="2">'
      + ['t1', 't2', 't3'].map(id => `<music-note id="${id}" pitch="E4" duration="half"></music-note>`).join('')
      + '</music-tuplet>'));
    session.select('triplet');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
    expect(session.selectionId).toBe('triplet');
  });

  it('clears an unknown source selection instead of targeting the first staff', () => {
    const session = editor();
    selectEnd(session);
    session.select('stale-source-id');
    expect(session.selectionId).toBeUndefined();
    expect(session.cursor).toBeUndefined();
  });
});

describe('cursor snapshots in accepted authoring transactions', () => {
  it('undoes an appended column to a measure-only cursor on staff 2, voice 2 in one step', () => {
    const session = editor();
    selectEnd(session);
    const before = session.project.sourceHtml;
    const oldMeasure = session.source.querySelector('#lower-2');
    const result = session.execute({ type: 'append-measure', afterMeasureId: 'lower-2', voiceIndex: 1 });
    const destination = result.cursor!;
    expect(destination).toMatchObject({ staffId: 'lower', voiceIndex: 1, eventId: result.selectionId });
    expect(session.cursor).toEqual(destination);
    expect(session.selectionId).toBe(destination.eventId);
    expect(session.score.staves.map(staff => staff.measures.length)).toEqual([3, 3]);
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project.sourceHtml).toBe(before);
    expect(session.source.querySelector('#lower-2')).toBe(oldMeasure);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.cursor).toEqual(destination);
    expect(session.selectionId).toBe(destination.eventId);
    expect(session.score.staves.map(staff => staff.measures.length)).toEqual([3, 3]);
    expect(session.canRedo).toBe(false);
  });

  it('restores event cursors and their source identity through property Undo and Redo', () => {
    const session = editor();
    session.select('b');
    const sourceEvent = session.source.querySelector('#b');
    session.execute({ type: 'set-note-accidental', eventId: 'b', alter: 1, ties: 'reject' });
    expect(session.cursor).toEqual(upperNote);
    session.undo();
    expect(session.cursor).toEqual(upperNote);
    expect(session.source.querySelector('#b')).toBe(sourceEvent);
    expect(sourceEvent?.getAttribute('pitch')).toBe('E4');
    session.redo();
    expect(session.cursor).toEqual(upperNote);
    expect(sourceEvent?.getAttribute('pitch')).toBe('E#4');
  });

  it('keeps the independently selected annotation and exact voice cursor in history', () => {
    const session = editor();
    session.select('direction');
    session.setCursor({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
    session.execute({ type: 'update-annotation', annotationId: 'direction', value: {
      kind: 'direction', text: 'Leave more space', at: '0', placement: 'above',
    } });
    expect(session.selectionId).toBe('direction');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
    session.undo();
    expect(session.selectionId).toBe('direction');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
    session.redo();
    expect(session.selectionId).toBe('direction');
    expect(session.cursor).toEqual({ staffId: 'upper', measureId: 'upper-1', voiceIndex: 1 });
  });

  it('honors an explicit command cursor independently from its selection', () => {
    const session = editor();
    selectEnd(session);
    const result = session.execute({ type: 'append-measure', afterMeasureId: 'lower-2' }, (_draft, edit) => {
      edit.cursor = { ...lowerEnd, measureId: edit.selectionId!, voiceIndex: 0 };
    });
    expect(session.selectionId).toBe(result.selectionId);
    expect(session.cursor).toEqual({ ...lowerEnd, measureId: result.selectionId!, voiceIndex: 0 });
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    session.redo();
    expect(session.cursor?.voiceIndex).toBe(0);
  });

  it('does not fall back to a different cursor when a supplied command cursor is stale', () => {
    const session = editor();
    selectEnd(session);
    const result = session.execute({ type: 'append-measure', afterMeasureId: 'lower-2' }, (_draft, edit) => {
      edit.cursor = { ...lowerEnd, measureId: 'missing', voiceIndex: 0 };
    });
    expect(session.selectionId).toBe(result.selectionId);
    expect(session.cursor).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
  });

  it('captures later navigation for Redo without changing the cursor stored before the edit', () => {
    const session = editor();
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Changed title'; });
    session.select('direction');
    session.setCursor(upperNote);
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    session.setCursor({ ...lowerEnd, eventId: 'h' });
    expect(session.canRedo).toBe(true);
    session.redo();
    expect(session.cursor).toEqual(upperNote);
    expect(session.selectionId).toBe('direction');
  });

  it('preserves cursor and the redo branch after a rejected transaction', () => {
    const session = editor();
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    session.undo();
    const before = session.project;
    const revision = session.revision;
    expect(() => session.execute({ type: 'insert-event', cursor: lowerEnd, value: note(), position: 'after' })).toThrow();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(revision);
    expect(session.canRedo).toBe(true);
  });

  it('resolves a no-op command selection without adding history or losing Redo', () => {
    const session = editor();
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    session.undo();
    const revision = session.revision;
    session.execute({ type: 'set-note-pitch', eventId: 'b', pitch: 'E4', ties: 'reject' });
    expect(session.selectionId).toBe('b');
    expect(session.cursor).toEqual(upperNote);
    expect(session.revision).toBe(revision);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
  });

  it.each([false, true])('undoes atomic append and insertion to the original voice-2 cursor (event anchor: %s)', eventAnchor => {
    const session = editor();
    const priorCursor = eventAnchor ? { ...lowerEnd, eventId: 'h' } : lowerEnd;
    session.select(eventAnchor ? 'h' : 'lower-2');
    session.setCursor(priorCursor);
    const before = session.project.sourceHtml;
    const priorEvent = session.source.querySelector('#h');
    const result = session.execute({ type: 'append-and-insert', cursor: priorCursor, value: note(), position: 'after' });
    expect(result.cursor).toMatchObject({ staffId: 'lower', voiceIndex: 1, eventId: result.selectionId });
    expect(result.cursor?.measureId).not.toBe('lower-2');
    expect(session.cursor).toEqual(result.cursor);
    expect(session.selectionId).toBe(result.selectionId);
    expect(session.score.staves[1].measures[2].voices[1].events).toMatchObject([
      { id: result.selectionId, kind: 'note', duration: 'quarter' },
    ]);
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.cursor).toEqual(priorCursor);
    expect(session.selectionId).toBe(eventAnchor ? 'h' : 'lower-2');
    expect(session.project.sourceHtml).toBe(before);
    expect(session.source.querySelector('#h')).toBe(priorEvent);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.cursor).toEqual(result.cursor);
    expect(session.selectionId).toBe(result.selectionId);
    expect(session.score.staves.map(staff => staff.measures.length)).toEqual([3, 3]);
    expect(session.canRedo).toBe(false);
  });

  it('restores the original final barlines and voice cursor in one Undo of Continue piece', () => {
    const session = editor(source.replace('id="upper-2"', 'id="upper-2" end-bar="final"')
      .replace('id="lower-2"', 'id="lower-2" end-bar="final"'));
    selectEnd(session);
    const before = session.project.sourceHtml;
    const result = session.execute({ type: 'continue-piece', cursor: lowerEnd, value: note(), position: 'after', confirmation: 'final-to-single' });
    expect(session.cursor).toEqual(result.cursor);
    expect(session.score.staves.map(staff => staff.measures[1].endBar)).toEqual(['single', 'single']);
    expect(session.score.staves.map(staff => staff.measures.length)).toEqual([3, 3]);
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project.sourceHtml).toBe(before);
    expect(session.score.staves.map(staff => staff.measures[1].endBar)).toEqual(['final', 'final']);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.cursor).toEqual(result.cursor);
    expect(session.selectionId).toBe(result.selectionId);
  });

  it.each(['append-and-insert', 'continue-piece'] as const)('keeps the full cursor and redo branch when %s fails', type => {
    const session = editor(type === 'continue-piece'
      ? source.replace('id="lower-2"', 'id="lower-2" end-bar="final"') : source);
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    session.undo();
    const before = session.project;
    const revision = session.revision;
    const input = { cursor: lowerEnd, value: note('G3', 'breve'), position: 'after' as const };
    expect(() => session.execute(type === 'continue-piece'
      ? { ...input, type, confirmation: 'final-to-single' }
      : { ...input, type })).toThrow();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(revision);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
  });
});

describe('cursor validity across source and project changes', () => {
  it('retains an exact cursor through metadata and unrelated Source edits', () => {
    const session = editor();
    session.select('b');
    session.update('Title', draft => { draft.metadata.title = 'New title'; });
    expect(session.cursor).toEqual(upperNote);
    session.applySource(session.project.sourceHtml.replace('pitch="D3"', 'pitch="G3"'));
    expect(session.cursor).toEqual(upperNote);
    session.applySource(session.project.sourceHtml.replace('pitch="E4"', 'pitch="F4"'));
    expect(session.cursor).toEqual(upperNote);
  });

  it('clears a removed event cursor and restores it only with the source snapshot on Undo', () => {
    const session = editor();
    session.select('b');
    session.applySource(session.project.sourceHtml.replace('<music-note id="b" pitch="E4" duration="whole"></music-note>',
      '<music-rest id="replacement" measure></music-rest>'));
    expect(session.cursor).toBeUndefined();
    expect(session.selectionId).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(upperNote);
    expect(session.selectionId).toBe('b');
    session.redo();
    expect(session.cursor).toBeUndefined();
  });

  it('does not follow an event into a different voice during arbitrary Source editing', () => {
    const session = editor();
    session.select('b');
    session.applySource(session.project.sourceHtml.replace('id="a"', 'id="temporary"')
      .replace('id="b"', 'id="a"').replace('id="temporary"', 'id="b"'));
    expect(session.selectionId).toBe('b');
    expect(session.cursor).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(upperNote);
    session.redo();
    expect(session.cursor).toBeUndefined();
  });

  it('does not keep a measure-only voice index when Source replaces that voice identity', () => {
    const session = editor();
    selectEnd(session);
    session.applySource(session.project.sourceHtml.replace('id="lower-2-v2"', 'id="replacement-voice"'));
    expect(session.selectionId).toBe('lower-2');
    expect(session.cursor).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
  });

  it('does not keep a measure-only voice index when Source reorders the voices', () => {
    const session = editor();
    selectEnd(session);
    const draft = session.source.cloneNode(true) as Element;
    const firstVoice = draft.querySelector('#lower-2-v1')!;
    firstVoice.parentElement!.append(firstVoice);
    session.applySource(draft.outerHTML);
    expect(session.selectionId).toBe('lower-2');
    expect(session.cursor).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    session.redo();
    expect(session.cursor).toBeUndefined();
  });

  it('retains an implicit voice cursor when its stable measure source survives editing', () => {
    const session = editor('<music-staff id="solo"><music-measure id="bar"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
    session.select('note');
    const location = { staffId: 'solo', measureId: 'bar', voiceIndex: 0, eventId: 'note' };
    session.applySource(session.project.sourceHtml.replace('pitch="C4"', 'pitch="D4"'));
    expect(session.cursor).toEqual(location);
    session.undo();
    expect(session.cursor).toEqual(location);
  });

  it('invalidates a voice location when Source converts its implicit owner to an explicit voice', () => {
    const session = editor('<music-staff id="solo"><music-measure id="bar"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
    session.select('note');
    session.applySource(session.project.sourceHtml.replace('<music-note', '<music-voice id="explicit"><music-note')
      .replace('</music-measure>', '</music-voice></music-measure>'));
    expect(session.cursor).toBeUndefined();
    expect(session.selectionId).toBe('note');
    session.undo();
    expect(session.cursor).toEqual({ staffId: 'solo', measureId: 'bar', voiceIndex: 0, eventId: 'note' });
  });

  it('keeps accepted navigation when a pending Source draft is invalid or rejected', () => {
    const session = editor();
    selectEnd(session);
    session.setPendingSource('<music-system>unfinished');
    expect(session.cursor).toEqual(lowerEnd);
    const before = session.project;
    const revision = session.revision;
    expect(() => session.applySource(session.project.pendingSource!)).toThrow();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(revision);
  });

  it('clears cursor on project replacement even when the replacement reuses all source IDs', () => {
    const session = editor();
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Before replacement'; });
    session.replaceProject(createProject(source, 'Other composition'));
    expect(session.cursor).toBeUndefined();
    expect(session.selectionId).toBeUndefined();
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
  });

  it('retains cursor and history when project replacement fails validation', () => {
    const session = editor();
    selectEnd(session);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    session.undo();
    const invalid = session.project;
    invalid.sourceHtml = '<music-system></music-system>';
    const before = session.project;
    expect(() => session.replaceProject(invalid)).toThrow();
    expect(session.cursor).toEqual(lowerEnd);
    expect(session.selectionId).toBe('lower-2');
    expect(session.project).toEqual(before);
    expect(session.canRedo).toBe(true);
  });

  it('clears an existing cursor if a metadata transaction deliberately changes project identity', () => {
    const session = editor();
    selectEnd(session);
    session.update('New identity', draft => { draft.id = 'other-project'; });
    expect(session.cursor).toBeUndefined();
    session.undo();
    expect(session.cursor).toEqual(lowerEnd);
    session.redo();
    expect(session.cursor).toBeUndefined();
  });
});
