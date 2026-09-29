import { describe, expect, it } from 'vitest';
import { readScore } from '../src/dom/index.js';
import { copyMusic, readMusicClipboard } from '../src/authoring/music-clipboard.js';
import { createProject, parseSource } from '../src/authoring/project.js';
import { EditorSession } from '../src/authoring/editor.js';
import { pitchText } from '../src/model/index.js';

const note = (id: string, pitch = 'C4', duration = 'quarter', extra = '') => `<music-note id="${id}" pitch="${pitch}" duration="${duration}" ${extra}></music-note>`;
const bar = (id: string, body: string, extra = '') => `<music-measure id="${id}" incomplete ${extra}>${body}</music-measure>`;
const staff = (body: string) => `<music-staff id="staff">${body}</music-staff>`;
function copy(html: string, ids: string[]) { return copyMusic(readScore(parseSource(html)).score, ids); }
function events(session: EditorSession) { return session.score.staves[0].measures.flatMap(measure => measure.voices[0].events); }

describe('musical clipboard snapshot', () => {
  it('copies exact members in score order, retains pitches and marks, and snapshots independently', () => {
    const root = parseSource(staff(bar('a', note('n1', 'Fqs3').replace('</music-note>', '<music-articulation id="accent" type="accent"></music-articulation></music-note>') + note('n2') + note('n3', 'Ab4', 'eighth'))));
    const before = root.outerHTML;
    const text = copyMusic(readScore(root).score, ['n3', 'n1']);
    const copied = readMusicClipboard(text).score.staves[0].measures[0].voices[0].events;
    expect(copied.map(event => pitchText(event.pitches[0]))).toEqual(['Fqs3', 'Ab4']);
    expect(copied[0].markings?.[0].id).toBe('accent');
    expect(copied[1].onset).toEqual({ numerator: 1, denominator: 4 });
    expect(root.outerHTML).toBe(before);
    root.querySelector('#n1')!.setAttribute('pitch', 'G5');
    expect(pitchText(readMusicClipboard(text).score.staves[0].measures[0].voices[0].events[0].pitches[0])).toBe('Fqs3');
  });
  it('keeps internal ties and detaches tie ends outside the copied passage', () => {
    const html = staff(bar('a', note('n1', 'C4', 'quarter', 'tie="start"') + note('n2', 'C4', 'quarter', 'tie="continue"') + note('n3', 'C4', 'quarter', 'tie="end"')));
    const partial = readMusicClipboard(copy(html, ['n2', 'n3'])).score.staves[0].measures[0].voices[0].events;
    expect(partial.map(event => event.tie)).toEqual(['start', 'end']);
    expect(readMusicClipboard(copy(html, ['n2'])).score.staves[0].measures[0].voices[0].events[0].tie).toBe('none');
  });
  it('rejects arbitrary clipboard text and unsafe markup', () => {
    expect(() => readMusicClipboard('ordinary text')).toThrow(/Copy notes/);
    expect(() => readMusicClipboard('Music Notes passage v1\n{"source":"<script>alert(1)</script>"}')).toThrow();
  });
});

describe('paste is an atomic insertion at the writing cursor', () => {
  const passage = () => copy(staff(bar('original', note('one', 'E4') + note('two', 'G4'))), ['two', 'one']);
  it('shifts following events in order, splits at barlines, adds aligned bars and undoes once', () => {
    const html = `<music-system id="score">${staff(bar('dest', note('before', 'C4') + note('after', 'D4', 'half', 'dots="1"'), 'end-bar="final"'))}<music-staff id="bass">${bar('bass-bar', '<music-rest id="bass-rest" measure></music-rest>', 'end-bar="final"')}</music-staff></music-system>`;
    const session = new EditorSession(createProject(html));
    const before = session.project.sourceHtml;
    session.setCursor({ staffId: 'staff', measureId: 'dest', voiceIndex: 0, eventId: 'before' });
    const result = session.execute({ type: 'paste-music', cursor: session.cursor!, text: passage(), position: 'after' });
    expect(session.score.staves.map(staff => staff.measures.length)).toEqual([2, 2]);
    expect(events(session).map(event => pitchText(event.pitches[0]))).toEqual(['C4', 'E4', 'G4', 'D4', 'D4']);
    expect(events(session).slice(-2).map(event => [event.duration, event.tie])).toEqual([['quarter', 'start'], ['half', 'end']]);
    expect(session.score.staves[1].measures[0].voices[0].events[0].id).toBe('bass-rest');
    expect(session.score.staves.every(staff => staff.measures[0].endBar === 'single' && staff.measures[1].endBar === 'final')).toBe(true);
    expect(result.cursor?.eventId).toBe(events(session)[2].id);
    expect(new Set([...session.source.querySelectorAll('[id]')].map(node => node.id)).size).toBe(session.source.querySelectorAll('[id]').length);
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
    session.redo(); expect(events(session)).toHaveLength(5);
  });
  it('uses later existing bars before appending, leaves untouched voices and trailing bars alone', () => {
    const session = new EditorSession(createProject(staff(bar('a', note('a1', 'C4', 'whole')) + bar('b', note('b1', 'D4')) + bar('c', note('c1', 'F4')))));
    const last = structuredClone(session.score.staves[0].measures[2]);
    session.execute({ type: 'paste-music', cursor: { staffId: 'staff', measureId: 'a', voiceIndex: 0, eventId: 'a1' }, text: passage(), position: 'after' });
    expect(session.score.staves[0].measures).toHaveLength(3);
    expect(session.score.staves[0].measures[1].voices[0].events.map(event => pitchText(event.pitches[0]))).toEqual(['E4', 'G4', 'D4']);
    expect(session.score.staves[0].measures[2]).toEqual(last);
  });
  it('replaces a destination full-bar placeholder and gives repeated pastes fresh IDs', () => {
    const session = new EditorSession(createProject(staff(bar('a', '<music-rest id="placeholder" measure></music-rest>'))));
    session.execute({ type: 'paste-music', cursor: { staffId: 'staff', measureId: 'a', voiceIndex: 0 }, text: passage(), position: 'after' });
    session.execute({ type: 'paste-music', cursor: session.cursor!, text: passage(), position: 'after' });
    expect(events(session).map(event => pitchText(event.pitches[0]))).toEqual(['E4', 'G4', 'E4', 'G4']);
    expect(new Set(events(session).map(event => event.id)).size).toBe(4);
  });
  it('keeps tuplets exact and rejects a tuplet crossing a destination barline without any edit', () => {
    const text = copy(staff(bar('triplets', `<music-tuplet id="t" actual="3" normal="2">${note('t1', 'C4')}${note('t2', 'D4')}${note('t3', 'E4')}</music-tuplet>`)), ['t1', 't2', 't3']);
    const session = new EditorSession(createProject(staff(bar('a', note('n', 'G4', 'half', 'dots="1"')))));
    const before = session.project.sourceHtml;
    expect(() => session.execute({ type: 'paste-music', cursor: { staffId: 'staff', measureId: 'a', voiceIndex: 0, eventId: 'n' }, text, position: 'after' })).toThrow(/tuplet.*barline/i);
    expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
    session.execute({ type: 'paste-music', cursor: { staffId: 'staff', measureId: 'a', voiceIndex: 0, eventId: 'n' }, text, position: 'before' });
    expect(events(session).slice(0, 3).map(event => event.time)).toEqual(Array(3).fill({ numerator: 1, denominator: 6 }));
  });
});
