import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { reduceSelection } from '../src/authoring/selection.js';
import type { SelectionAction, SelectionContext, SelectionState } from '../src/authoring/selection.js';
import type { AuthorCommand, Cursor, EventInput } from '../src/authoring/types.js';

const source = `<music-system id="score"><music-staff id="lead" label="Lead">
  <music-measure id="bar-a"><music-direction id="instruction" text="Leave space"></music-direction><music-voice id="voice-a"><music-note id="z" pitch="C4" duration="quarter"><music-articulation id="accent" type="accent"></music-articulation></music-note><music-note id="b" pitch="D4" duration="quarter"></music-note><music-chord id="y" pitches="E4 G4" duration="quarter"></music-chord><music-note id="a" pitch="F4" duration="quarter"></music-note></music-voice><music-voice id="second-a"><music-note id="v2-a" pitch="G4" duration="whole"></music-note></music-voice></music-measure>
  <music-measure id="bar-b"><music-voice id="voice-b"><music-note id="x" pitch="G4" duration="half"></music-note><music-note id="c" pitch="A4" duration="half"></music-note></music-voice><music-voice id="second-b"><music-note id="v2-b" pitch="B4" duration="whole"></music-note></music-voice></music-measure>
</music-staff><music-staff id="other" label="Other"><music-measure id="other-a"><music-voice id="other-a-1"><music-rest id="rest-a-1" measure></music-rest></music-voice><music-voice id="other-a-2"><music-rest id="rest-a-2" measure></music-rest></music-voice></music-measure><music-measure id="other-b"><music-voice id="other-b-1"><music-rest id="rest-b-1" measure></music-rest></music-voice><music-voice id="other-b-2"><music-rest id="rest-b-2" measure></music-rest></music-voice></music-measure></music-staff></music-system>`;
const writing: Cursor = { staffId: 'other', measureId: 'other-b', voiceIndex: 1 };
const input: EventInput = { kind: 'note', pitch: 'Gqf4', pitches: '', duration: 'quarter', dots: 0,
  rhythmic: false, measureRest: false, accidentalDisplay: 'courtesy', stem: 'auto', beam: 'auto' };
const editor = (html = source) => new EditorSession(createProject(html, 'Selection history'));
function context(session: EditorSession, partId = session.selection.partId): SelectionContext {
  const part = session.project.parts.find(part => part.id === partId);
  return { score: session.score, documentId: session.project.id, documentEpoch: session.documentEpoch, partId,
    visibleStaffIds: part?.staffIds ?? session.score.staves.map(staff => staff.id) };
}
function choose(session: EditorSession, action: SelectionAction, partId?: string): void {
  const result = reduceSelection(session.selection, action, context(session, partId));
  expect(result.reason).toBeUndefined(); session.setSelection(result.state);
}
function group(session: EditorSession): void {
  session.setCursor(writing);
  choose(session, { type: 'set', ids: ['z', 'y', 'x'], primaryId: 'y', anchorId: 'z', focusId: 'a' });
}
function semantic(state: SelectionState): Omit<SelectionState, 'version'> {
  const { version: _version, ...rest } = state; return rest;
}

describe('independent session selection navigation', () => {
  it('starts with an empty complete selection and a session-owned document epoch', () => {
    const session = editor();
    expect(session.selection).toMatchObject({ ids: [], version: 0, documentId: session.project.id, documentEpoch: session.documentEpoch, partId: 'score' });
    expect(session.selectionVersion).toBe(0); expect(session.cursor).toBeUndefined(); expect(session.selectionId).toBeUndefined();
  });

  it('changes full membership without changing source, cursor, revision, history, events or Redo', () => {
    const session = editor(); session.setCursor(writing);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; }); session.undo();
    const before = session.project, revision = session.revision; const events: Event[] = [];
    session.addEventListener('change', event => events.push(event)); group(session);
    expect(session.selection.ids).toEqual(['z', 'y', 'x']); expect(session.selectionId).toBe('y');
    expect(session.cursor).toEqual(writing); expect(session.project).toEqual(before); expect(session.revision).toBe(revision);
    expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(true); expect(events).toEqual([]);
  });

  it('keeps structural inspection separate from writing, with unambiguous Clear', () => {
    const session = editor(); session.setCursor(writing);
    choose(session, { type: 'source', id: 'instruction' });
    expect(session.selection.sourceId).toBe('instruction'); expect(session.selection.ids).toEqual([]);
    expect(session.selectionId).toBe('instruction'); expect(session.cursor).toEqual(writing);
    choose(session, { type: 'clear' }); expect(session.selectionId).toBeUndefined(); expect(session.selection.sourceId).toBeUndefined();
    expect(session.cursor).toEqual(writing); expect(session.canUndo).toBe(false);
  });

  it('accepts reducer focus navigation from a structural target without creating event membership', () => {
    const session = editor(); session.setCursor(writing); choose(session, { type: 'source', id: 'instruction' });
    choose(session, { type: 'focus', id: 'b' });
    expect(session.selection).toMatchObject({ ids: [], focusId: 'b' }); expect(session.selection.sourceId).toBeUndefined();
    expect(session.selectionId).toBeUndefined(); expect(session.cursor).toEqual(writing); expect(session.canUndo).toBe(false);
  });

  it('rejects generated implicit-voice model IDs as structural source identities', () => {
    const session = editor('<music-staff id="solo"><music-measure id="bar"><music-rest id="rest" measure></music-rest></music-measure></music-staff>');
    const implicitId = session.score.staves[0].measures[0].voices[0].id; const before = session.selection;
    expect(() => session.setSelection({ ...before, sourceId: implicitId, version: before.version + 1 })).toThrow(/authored|source|voice/i);
    expect(session.selection).toEqual(before); expect(session.selectionId).toBeUndefined(); expect(session.canUndo).toBe(false);
    choose(session, { type: 'source', id: 'bar' });
    session.setCursor({ staffId: 'solo', measureId: 'bar', voiceIndex: 0 });
    session.update('Title', draft => { draft.metadata.title = 'Changed'; }); session.undo();
    expect(session.selection.sourceId).toBe('bar'); expect(session.cursor).toMatchObject({ staffId: 'solo', measureId: 'bar', voiceIndex: 0 });
  });

  it.each(['primaryId', 'anchorId', 'focusId', 'sourceId'] as const)('rejects an explicitly empty %s at the session boundary', field => {
    const session = editor(); group(session); const before = session.selection;
    const next = { ...before, [field]: '', version: before.version + 1 };
    expect(() => session.setSelection(next)).toThrow(); expect(session.selection).toEqual(before); expect(session.cursor).toEqual(writing);
  });

  it('rejects sparse incoming membership without changing state or musical history', () => {
    const session = editor(); const before = session.selection;
    expect(() => session.setSelection({ ...before, ids: new Array<string>(1), version: before.version + 1 })).toThrow();
    expect(session.selection).toEqual(before); expect(session.canUndo).toBe(false); expect(session.revision).toBe(0);
  });

  it('copies incoming membership and every returned state', () => {
    const session = editor(); const next = reduceSelection(session.selection, { type: 'set', ids: ['z', 'x'] }, context(session)).state;
    session.setSelection(next); (next.ids as string[]).push('b');
    const returned = session.selection; (returned.ids as string[]).splice(0); (returned as { primaryId?: string }).primaryId = 'c';
    expect(session.selection.ids).toEqual(['z', 'x']); expect(session.selectionId).toBe('z');
  });

  it('does not increment selection version for equivalent normalized membership', () => {
    const session = editor(); group(session); const state = session.selection;
    session.setSelection(state); expect(session.selection).toEqual(state);
    choose(session, { type: 'set', ids: ['x', 'z', 'y', 'z'], primaryId: 'y', anchorId: 'z', focusId: 'a' });
    expect(session.selection).toEqual(state);
  });

  it.each(['documentId', 'documentEpoch', 'partId', 'ids', 'scope', 'mixed'] as const)('rejects invalid %s state without any mutation', defect => {
    const session = editor(); group(session); const before = session.selection; const project = session.project;
    const next: SelectionState = { ...before, ids: [...before.ids], version: before.version + 1,
      ...(defect === 'documentId' ? { documentId: 'other-document' } : {}),
      ...(defect === 'documentEpoch' ? { documentEpoch: before.documentEpoch + 1 } : {}),
      ...(defect === 'partId' ? { partId: 'missing-part' } : {}),
      ...(defect === 'ids' ? { ids: ['z', 'missing'] } : {}),
      ...(defect === 'scope' ? { staffId: 'other' } : {}),
      ...(defect === 'mixed' ? { sourceId: 'instruction' } : {}),
    };
    expect(() => session.setSelection(next)).toThrow();
    expect(session.selection).toEqual(before); expect(session.cursor).toEqual(writing); expect(session.project).toEqual(project);
    expect(session.revision).toBe(0); expect(session.canUndo).toBe(false);
  });

  it('keeps legacy select behavior and its historical same-primary no-op', () => {
    const session = editor(); session.select('accent');
    expect(session.selectionId).toBe('z'); expect(session.selection.ids).toEqual(['z']);
    expect(session.cursor).toMatchObject({ staffId: 'lead', measureId: 'bar-a', voiceIndex: 0, eventId: 'z' });
    group(session); const groupBefore = session.selection;
    session.select('y'); expect(session.selection).toEqual(groupBefore); expect(session.cursor).toEqual(writing);
    session.select('instruction'); expect(session.selectionId).toBe('instruction'); expect(session.selection.sourceId).toBe('instruction');
    expect(session.cursor).toMatchObject({ staffId: 'lead', measureId: 'bar-a', voiceIndex: 0 });
  });
});

describe('full selection snapshots and independent command cursors', () => {
  it('preserves an exact group and writing cursor through a property edit, Undo and Redo', () => {
    const session = editor(); group(session); const selected = semantic(session.selection); const before = session.project.sourceHtml;
    session.execute({ type: 'set-note-accidental', eventId: 'z', alter: 1, ties: 'reject' });
    expect(semantic(session.selection)).toEqual(selected); expect(session.selectionId).toBe('y'); expect(session.cursor).toEqual(writing);
    const edited = session.project.sourceHtml, version = session.selectionVersion;
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(semantic(session.selection)).toEqual(selected);
    expect(session.cursor).toEqual(writing); expect(session.selectionVersion).toBeGreaterThan(version);
    const restoredVersion = session.selectionVersion;
    session.redo(); expect(session.project.sourceHtml).toBe(edited); expect(semantic(session.selection)).toEqual(selected);
    expect(session.cursor).toEqual(writing); expect(session.selectionVersion).toBeGreaterThan(restoredVersion);
  });

  it('does not collapse a group because a batch command reports one selectionId', () => {
    const session = editor(); group(session); const before = semantic(session.selection);
    const result = session.execute({ type: 'convert-events', eventIds: ['z', 'y', 'x'], kind: 'slash', rhythmic: true, pitch: '' });
    expect(result.selectionId).toBe('z'); expect(semantic(session.selection)).toEqual(before); expect(session.selectionId).toBe('y');
    expect(session.cursor).toEqual(writing); expect(session.revision).toBe(1);
    session.undo(); expect(semantic(session.selection)).toEqual(before); expect(session.canUndo).toBe(false);
  });

  it.each<AuthorCommand>([
    { type: 'add-staff', label: 'Cello', clef: 'bass', key: 'Eb' },
    { type: 'add-voice', measureId: 'bar-a' },
    { type: 'duplicate-measures', measureIds: ['bar-a'] },
    { type: 'add-annotation', measureId: 'bar-b', value: { kind: 'direction', text: 'New instruction', at: '0', placement: 'above' } },
  ])('inspects the explicit $type result without moving writing, restoring both contexts through Undo/Redo', command => {
    const session = editor(); group(session); const before = session.project.sourceHtml; const prior = semantic(session.selection);
    const result = session.execute(command);
    expect(result.selectionId).toBeTruthy(); expect(session.selectionId).toBe(result.selectionId);
    expect(session.selection.sourceId).toBe(result.selectionId); expect(session.selection.ids).toEqual([]);
    expect(session.cursor).toEqual(writing); expect(session.revision).toBe(1);
    if (command.type === 'add-staff') expect(session.score.staves.find(staff => staff.id === result.selectionId)?.key).toBe('Eb');
    const accepted = session.project.sourceHtml; const destination = semantic(session.selection);
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(semantic(session.selection)).toEqual(prior);
    expect(session.cursor).toEqual(writing); expect(session.canUndo).toBe(false);
    session.redo(); expect(session.project.sourceHtml).toBe(accepted); expect(semantic(session.selection)).toEqual(destination);
    expect(session.cursor).toEqual(writing);
  });

  it.each<{ selectedId: string; command: AuthorCommand }>([
    { selectedId: 'z', command: { type: 'remove-event', eventId: 'z' } },
    { selectedId: 'instruction', command: { type: 'remove-annotation', annotationId: 'instruction' } },
    { selectedId: 'bar-a', command: { type: 'remove-measure', measureId: 'bar-a' } },
    { selectedId: 'triplet', command: { type: 'unwrap-tuplet', tupletId: 'triplet' } },
  ])('uses the explicit $command.type fallback when the inspected target is removed completely', ({ selectedId, command }) => {
    const html = command.type === 'unwrap-tuplet' ? source.replace('<music-measure id="bar-a">', '<music-measure id="bar-a" incomplete>')
      .replace('<music-note id="z"', '<music-tuplet id="triplet" actual="3" normal="2"><music-note id="z"')
      .replace('<music-note id="a"', '</music-tuplet><music-note id="a"') : source;
    const session = editor(html); session.setCursor(writing); choose(session, { type: 'source', id: selectedId });
    const before = session.project.sourceHtml; const prior = semantic(session.selection);
    const result = session.execute(command);
    expect(result.selectionId).toBeTruthy(); expect(session.selectionId).toBe(result.selectionId);
    expect(session.selection.primaryId ?? session.selection.sourceId).toBe(result.selectionId);
    expect(session.cursor).toEqual(writing); const destination = semantic(session.selection);
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(semantic(session.selection)).toEqual(prior);
    expect(session.cursor).toEqual(writing); expect(session.canUndo).toBe(false);
    session.redo(); expect(semantic(session.selection)).toEqual(destination); expect(session.cursor).toEqual(writing);
  });

  it('does not replace a surviving exact group with a deletion fallback outside that group', () => {
    const session = editor(); group(session);
    const result = session.execute({ type: 'remove-event', eventId: 'y' });
    expect(result.selectionId).toBe('a'); expect(session.selection.ids).toEqual(['z', 'x']);
    expect(session.selectionId).toBe('z'); expect(session.selection.sourceId).toBeUndefined(); expect(session.cursor).toEqual(writing);
  });

  it('does not invent inspection from an off-selection deletion when only keyboard focus exists', () => {
    const session = editor(); session.setCursor(writing); choose(session, { type: 'focus', id: 'b' });
    const result = session.execute({ type: 'remove-event', eventId: 'z' });
    expect(result.selectionId).toBe('b'); expect(session.selection.ids).toEqual([]); expect(session.selection.focusId).toBe('b');
    expect(session.selectionId).toBeUndefined(); expect(session.cursor).toEqual(writing);
  });

  it('keeps the selected event group when wrapping it in a new tuplet', () => {
    const session = editor(); session.setCursor(writing);
    choose(session, { type: 'set', ids: ['z', 'b', 'y'], primaryId: 'y', anchorId: 'z', focusId: 'y' });
    const prior = semantic(session.selection);
    const result = session.execute({ type: 'wrap-tuplet', eventIds: ['z', 'b', 'y'], actual: 3, normal: 2, bracket: 'auto', ratio: false });
    expect(session.source.querySelector(`[id="${result.selectionId}"]`)?.localName).toBe('music-tuplet');
    expect(semantic(session.selection)).toEqual(prior); expect(session.cursor).toEqual(writing);
    session.undo(); expect(semantic(session.selection)).toEqual(prior); expect(session.canUndo).toBe(false);
  });

  it('preserves group, cursor and Redo for a no-op musical command', () => {
    const session = editor(); group(session); session.update('Title', draft => { draft.metadata.title = 'Changed'; }); session.undo();
    const before = session.selection, revision = session.revision;
    session.execute({ type: 'set-note-pitch', eventId: 'z', pitch: 'C4', ties: 'reject' });
    expect(session.selection).toEqual(before); expect(session.cursor).toEqual(writing);
    expect(session.revision).toBe(revision); expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(true);
  });

  it('restores a structural inspection and independent voice-two cursor in history', () => {
    const session = editor(); session.setCursor(writing); choose(session, { type: 'source', id: 'instruction' });
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    choose(session, { type: 'source', id: 'bar-b' }); session.undo();
    expect(session.selection.sourceId).toBe('instruction'); expect(session.selectionId).toBe('instruction'); expect(session.cursor).toEqual(writing);
    session.redo(); expect(session.selection.sourceId).toBe('bar-b'); expect(session.selectionId).toBe('bar-b'); expect(session.cursor).toEqual(writing);
  });

  it.each(['insert-event', 'append-and-insert'] as const)('advances %s deliberately and restores the entire earlier inspection set with one Undo', type => {
    const html = type === 'append-and-insert' ? source.replace('<music-rest id="rest-b-2" measure></music-rest>', '<music-note id="rest-b-2" pitch="C3" duration="whole"></music-note>') : source;
    const session = editor(html); group(session); const before = session.project.sourceHtml; const selected = semantic(session.selection);
    const result = session.execute({ type, cursor: writing, position: 'after', value: input });
    expect(session.selection.ids).toEqual([result.selectionId]); expect(session.selectionId).toBe(result.selectionId);
    expect(session.cursor).toMatchObject({ staffId: 'other', voiceIndex: 1, eventId: result.selectionId });
    const destination = session.cursor;
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(semantic(session.selection)).toEqual(selected);
    expect(session.cursor).toEqual(writing); expect(session.canUndo).toBe(false);
    session.redo(); expect(session.selection.ids).toEqual([result.selectionId]); expect(session.cursor).toEqual(destination);
  });

  it('captures subsequent independent selection navigation for Redo', () => {
    const session = editor(); group(session); const before = semantic(session.selection);
    session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    choose(session, { type: 'replace', id: 'c' }); const after = semantic(session.selection);
    session.undo(); expect(semantic(session.selection)).toEqual(before);
    choose(session, { type: 'replace', id: 'b' }); expect(session.canRedo).toBe(true);
    session.redo(); expect(semantic(session.selection)).toEqual(after); expect(session.cursor).toEqual(writing);
  });

  it('does not make an old selection token current again through Undo', () => {
    const session = editor(); group(session); const stale = reduceSelection(session.selection, { type: 'replace', id: 'c' }, context(session)).state;
    session.update('Title', draft => { draft.metadata.title = 'Changed'; }); session.undo();
    const before = session.selection;
    expect(() => session.setSelection(stale)).toThrow(/selection|changed/i); expect(session.selection).toEqual(before);
  });
});

describe('selection ownership across Source and view changes', () => {
  it('prunes a deleted primary using its prior musical position and restores exact membership with Undo', () => {
    const session = editor(); group(session); const before = semantic(session.selection);
    session.applySource(session.project.sourceHtml.replace('id="y"', 'id="replacement"'));
    expect(session.selection).toMatchObject({ ids: ['z', 'x'], primaryId: 'z', anchorId: 'z', focusId: 'a' });
    expect(session.selectionId).toBe('z'); expect(session.cursor).toEqual(writing);
    session.undo(); expect(semantic(session.selection)).toEqual(before);
    session.redo(); expect(session.selection.ids).toEqual(['z', 'x']);
  });

  it.each(['voice-id', 'voice-reorder', 'event-voice', 'event-kind'] as const)('does not retarget existing IDs after Source changes their %s ownership', change => {
    const session = editor(); group(session); const before = semantic(session.selection);
    let html = session.project.sourceHtml;
    if (change === 'voice-id') html = html.replace('id="voice-a"', 'id="new-voice"');
    if (change === 'voice-reorder') {
      const staged = session.source.cloneNode(true) as Element; const voice = staged.querySelector('#voice-a')!;
      voice.parentElement!.append(voice); html = staged.outerHTML;
    }
    if (change === 'event-voice') html = html.replace('id="z"', 'id="temporary"').replace('id="v2-a"', 'id="z"').replace('id="temporary"', 'id="v2-a"');
    if (change === 'event-kind') html = html.replace('<music-note id="z" pitch="C4" duration="quarter"><music-articulation id="accent" type="accent"></music-articulation></music-note>', '<music-rest id="z" duration="quarter"></music-rest>');
    session.applySource(html);
    expect(session.selection.ids).toEqual(change === 'voice-id' || change === 'voice-reorder' ? ['x'] : ['y', 'x']);
    expect(session.cursor).toEqual(writing); session.undo(); expect(semantic(session.selection)).toEqual(before);
  });

  it('preserves implicit voice ownership through ordinary edits but not an explicit voice replacement', () => {
    const html = '<music-staff id="solo"><music-measure id="bar"><music-note id="a" pitch="C4" duration="half"></music-note><music-note id="b" pitch="D4" duration="half"></music-note></music-measure></music-staff>';
    const session = editor(html); choose(session, { type: 'set', ids: ['a', 'b'] });
    session.applySource(session.project.sourceHtml.replace('pitch="C4"', 'pitch="C#4"'));
    expect(session.selection.ids).toEqual(['a', 'b']);
    session.applySource(session.project.sourceHtml.replace('<music-note id="a"', '<music-voice id="explicit"><music-note id="a"').replace('</music-measure>', '</music-voice></music-measure>'));
    expect(session.selection.ids).toEqual([]); expect(session.selectionId).toBeUndefined();
    session.undo(); expect(session.selection.ids).toEqual(['a', 'b']);
  });

  it('prunes a selected instruction reparented to another measure', () => {
    const session = editor(); session.setCursor(writing); choose(session, { type: 'source', id: 'instruction' });
    const staged = session.source.cloneNode(true) as Element;
    staged.querySelector('#bar-b')!.prepend(staged.querySelector('#instruction')!);
    session.applySource(staged.outerHTML); expect(session.selection.sourceId).toBeUndefined(); expect(session.selectionId).toBeUndefined();
    session.undo(); expect(session.selection.sourceId).toBe('instruction'); expect(session.cursor).toEqual(writing);
  });

  it('prunes targets hidden by changed part membership without selecting another staff', () => {
    const session = editor(); const part = session.project.parts.find(part => part.staffIds.includes('lead'))!;
    choose(session, { type: 'set', ids: ['z', 'x'] }, part.id); session.setCursor(writing);
    session.update('Change part', project => { project.parts.find(item => item.id === part.id)!.staffIds = ['other']; });
    expect(session.selection.ids).toEqual([]); expect(session.selectionId).toBeUndefined(); expect(session.cursor).toEqual(writing);
    session.undo(); expect(session.selection.ids).toEqual(['z', 'x']); expect(session.selection.partId).toBe(part.id);
  });

  it('keeps selection and history unchanged when Source or replacement is invalid', () => {
    const session = editor(); group(session); session.update('Title', project => { project.metadata.title = 'Changed'; }); session.undo();
    const before = session.selection, epoch = session.documentEpoch, revision = session.revision;
    expect(() => session.applySource('<music-staff>broken')).toThrow();
    const replacement = session.project; replacement.sourceHtml = '<music-staff>broken';
    expect(() => session.replaceProject(replacement)).toThrow();
    expect(session.selection).toEqual(before); expect(session.documentEpoch).toBe(epoch); expect(session.revision).toBe(revision);
    expect(session.canRedo).toBe(true); expect(session.cursor).toEqual(writing);
  });

  it('keeps navigation on accepted music while Source is pending without pretending the draft was applied', () => {
    const session = editor(); group(session); session.setPendingSource('<music-staff>unfinished');
    const revision = session.revision; choose(session, { type: 'replace', id: 'b' });
    expect(session.selection.ids).toEqual(['b']); expect(session.cursor).toEqual(writing);
    expect(session.project.pendingSource).toBe('<music-staff>unfinished'); expect(session.revision).toBe(revision);
  });

  it.each([false, true])('advances document epoch and clears selection/history on replacement, even with reused project ID: %s', reuseId => {
    const session = editor(); group(session); session.update('Title', draft => { draft.metadata.title = 'Changed'; });
    const old = session.selection, epoch = session.documentEpoch; const replacement = createProject(source, 'Replacement');
    if (reuseId) replacement.id = session.project.id;
    session.replaceProject(replacement);
    expect(session.documentEpoch).toBeGreaterThan(epoch); expect(session.selection.ids).toEqual([]); expect(session.selectionId).toBeUndefined();
    expect(session.cursor).toBeUndefined(); expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(false);
    expect(() => session.setSelection({ ...old, version: session.selectionVersion + 1 })).toThrow(/document|composition/i);
  });
});
