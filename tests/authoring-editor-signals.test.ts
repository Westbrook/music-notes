import { describe, expect, it } from 'vitest';
import { Signal } from 'signal-polyfill';
import { batchedEffect } from 'signal-utils/subtle/batched-effect';
import { reaction } from 'signal-utils/subtle/reaction';
import { EditorSession } from '../src/authoring/editor.js';
import type { EditorChangeDetail } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { createSelection, reduceSelection } from '../src/authoring/selection.js';
import type { EventInput } from '../src/authoring/types.js';

const html = `<music-staff id="staff" meter="4/4"><music-measure id="measure"><music-note id="note" pitch="C4" duration="whole"></music-note></music-measure></music-staff>`;
function editor(): EditorSession { return new EditorSession(createProject(html, 'Signals')); }
function note(pitch = 'D4'): EventInput {
  return { kind: 'note', pitch, pitches: '', duration: 'whole', dots: 0, rhythmic: false,
    measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };
}

function observe(session: EditorSession) {
  const state = session.signals;
  return {
    revision: state.revision.get(), undo: state.canUndo.get(), redo: state.canRedo.get(),
    pitch: state.score.get().staves[0].measures[0].voices[0].events[0].pitches[0].step,
    sourcePitch: session.source.querySelector('#note')!.getAttribute('pitch'),
    selected: state.selectionId.get(), pending: state.pendingSource.get(),
  };
}

describe('EditorSession signals', () => {
  it('publishes a complete edit and history transition before synchronous listeners inspect it', () => {
    const session = editor();
    session.select('note');
    const effects: ReturnType<typeof observe>[] = [];
    const events: { detail: EditorChangeDetail; state: ReturnType<typeof observe> }[] = [];
    const stop = batchedEffect(() => { effects.push(observe(session)); });
    session.addEventListener('change', event => {
      events.push({ detail: (event as CustomEvent<EditorChangeDetail>).detail, state: observe(session) });
    });
    try {
      session.execute({ type: 'update-event', eventId: 'note', value: note('Dqs4') });
      session.undo();
      session.redo();
      expect(effects).toEqual([
        { revision: 0, undo: false, redo: false, pitch: 'C', sourcePitch: 'C4', selected: 'note', pending: null },
        { revision: 1, undo: true, redo: false, pitch: 'D', sourcePitch: 'Dqs4', selected: 'note', pending: null },
        { revision: 2, undo: false, redo: true, pitch: 'C', sourcePitch: 'C4', selected: 'note', pending: null },
        { revision: 3, undo: true, redo: false, pitch: 'D', sourcePitch: 'Dqs4', selected: 'note', pending: null },
      ]);
      expect(events.map(event => event.state)).toEqual(effects.slice(1));
      expect(events.map(event => [event.detail.kind, event.detail.revision])).toEqual([
        ['edit', 1], ['history', 2], ['history', 3],
      ]);
      expect(session.signals.score.get().staves[0].measures[0].voices[0].events[0].pitches[0].alter).toBe(0.5);
    } finally { stop(); }
  });

  it('keeps failed edits and no-op edits out of both reactive updates and history', () => {
    const session = editor();
    session.select('note');
    const effects: ReturnType<typeof observe>[] = [];
    const stop = batchedEffect(() => { effects.push(observe(session)); });
    const accepted = session.signals.project.get();
    const score = session.signals.score.get();
    try {
      expect(() => session.execute({ type: 'update-event', eventId: 'note', value: note('H4') })).toThrow();
      session.update('No change', draft => { draft.metadata.title = 'Signals'; });
      session.setCursor(session.cursor!);
      expect(effects).toHaveLength(1);
      expect(session.signals.project.get()).toBe(accepted);
      expect(session.signals.score.get()).toBe(score);
      expect(session.signals.canUndo.get()).toBe(false);
    } finally { stop(); }
  });

  it('exposes cached immutable accepted data through get-only facades', () => {
    const session = editor();
    session.select('note');
    for (const signal of Object.values(session.signals)) {
      expect(Object.keys(signal)).toEqual(['get']);
      expect(Object.isFrozen(signal)).toBe(true);
    }
    const project = session.signals.project.get();
    const score = session.signals.score.get();
    expect(() => Object.assign(project.metadata, { title: 'Injected' })).toThrow();
    expect(() => Object.assign(score.staves[0].measures[0].voices[0].events[0].pitches[0], { step: 'F' })).toThrow();
    expect(() => (session.signals.selection.get().ids as string[]).push('missing')).toThrow();
    expect(() => Object.assign(session.signals.cursor.get()!, { measureId: 'missing' })).toThrow();
    const mutable = session.project;
    mutable.metadata.title = 'Mutable copy';
    expect(session.signals.project.get()).toBe(project);
    expect(session.signals.project.get().metadata.title).toBe('Signals');
    expect(session.signals.score.get()).toBe(score);
  });

  it('reuses score projections across navigation, metadata, and source drafts', () => {
    const session = editor();
    const score = session.signals.score.get();
    const diagnostics = session.signals.diagnostics.get();
    let scoreReads = 0;
    const eventCount = new Signal.Computed(() => {
      scoreReads++;
      return session.signals.score.get().staves[0].measures[0].voices[0].events.length;
    });
    expect(eventCount.get()).toBe(1);
    session.select('note');
    session.setCursor({ staffId: 'staff', measureId: 'measure', voiceIndex: 0 });
    session.setPendingSource('A recoverable draft');
    session.update('Rename', draft => { draft.metadata.title = 'Another title'; });
    expect(session.signals.score.get()).toBe(score);
    expect(session.signals.diagnostics.get()).toBe(diagnostics);
    expect(eventCount.get()).toBe(1);
    expect(scoreReads).toBe(1);
    session.execute({ type: 'update-event', eventId: 'note', value: note() });
    expect(session.signals.score.get()).not.toBe(score);
    expect(eventCount.get()).toBe(1);
    expect(scoreReads).toBe(2);
    // Implicit voice identities are derived from reconciled source nodes.
    expect(session.signals.score.get().staves[0].measures[0].voices[0].id)
      .toBe(session.score.staves[0].measures[0].voices[0].id);
  });

  it('publishes explicit inspection and cursor navigation without save events or history edits', () => {
    const session = editor();
    const changes: Event[] = [];
    session.addEventListener('change', event => changes.push(event));
    const context = { score: session.score, documentId: session.project.id, documentEpoch: session.documentEpoch, partId: 'score' };
    const selected = reduceSelection(createSelection(context), { type: 'replace', id: 'note' }, context).state;
    session.setSelection(selected);
    session.setCursor({ staffId: 'staff', measureId: 'measure', voiceIndex: 0 });
    expect(session.signals.selection.get().ids).toEqual(['note']);
    expect(session.signals.selectionVersion.get()).toBe(1);
    expect(session.signals.cursor.get()).toEqual({ staffId: 'staff', measureId: 'measure', voiceIndex: 0 });
    expect(session.signals.revision.get()).toBe(0);
    expect(session.signals.canUndo.get()).toBe(false);
    expect(changes).toEqual([]);
    const epoch = session.signals.documentEpoch.get();
    session.replaceProject(session.project);
    expect(session.signals.documentEpoch.get()).toBeGreaterThan(epoch);
    expect(session.signals.selection.get().documentEpoch).toBe(session.signals.documentEpoch.get());
    expect(session.signals.selection.get().ids).toEqual([]);
  });

  it('keeps live-source guards fresh and refreshes cached projections when that source is accepted', () => {
    const session = editor();
    const accepted = session.signals.score.get();
    session.source.querySelector('#note')!.setAttribute('pitch', 'E4');
    expect(session.score.staves[0].measures[0].voices[0].events[0].pitches[0].step).toBe('E');
    expect(session.signals.score.get()).toBe(accepted);
    session.setPendingSource('Recoverable source buffer');
    session.update('Accept current source and title', draft => { draft.metadata.title = 'Current source'; });
    expect(session.signals.score.get().staves[0].measures[0].voices[0].events[0].pitches[0].step).toBe('E');
  });

  it('retains unapplied source and redo semantics in reactive history controls', () => {
    const session = editor();
    session.setPendingSource('Draft before edit');
    session.execute({ type: 'update-event', eventId: 'note', value: note() });
    session.undo();
    expect(session.signals.canRedo.get()).toBe(true);
    session.setCursor({ staffId: 'staff', measureId: 'measure', voiceIndex: 0 });
    expect(session.signals.canRedo.get()).toBe(true);
    session.setPendingSource('New draft');
    expect(session.signals.canRedo.get()).toBe(false);
    expect(session.signals.canUndo.get()).toBe(false);
    expect(session.signals.hasPendingSource.get()).toBe(true);
    expect(session.signals.pendingSource.get()).toBe('New draft');
    session.setPendingSource(null);
    expect(session.signals.hasPendingSource.get()).toBe(false);
  });

  it('lets disconnected consumers discard queued work and reconnect across later changes', async () => {
    const session = editor();
    const revisions: number[] = [];
    const connect = () => reaction(() => session.signals.revision.get(), value => { revisions.push(value); });
    const stop = connect();
    session.setPendingSource('Queued draft');
    stop();
    await Promise.resolve();
    expect(revisions).toEqual([]);
    const stopAgain = connect();
    try {
      session.setPendingSource('Second draft');
      await Promise.resolve();
      session.setPendingSource('Third draft');
      await Promise.resolve();
      expect(revisions).toEqual([2, 3]);
    } finally { stopAgain(); }
    session.setPendingSource(null);
    await Promise.resolve();
    expect(revisions).toEqual([2, 3]);
  });
});
