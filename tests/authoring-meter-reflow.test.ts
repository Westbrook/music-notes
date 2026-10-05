import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { add, meterTime, rational } from '../src/model/index.js';

const note = (id: string, duration = 'quarter', extra = '') => `<music-note id="${id}" pitch="C4" duration="${duration}" ${extra}></music-note>`;
const bar = (id: string, music: string, extra = '') => `<music-measure id="${id}" ${extra}>${music}</music-measure>`;
const staff = (music: string, id = 'staff') => `<music-staff id="${id}">${music}</music-staff>`;
const change = (session: EditorSession, meter = '3/4') => session.execute({ type: 'set-measure', measureId: 'bar', values: { meter } });
const measures = (session: EditorSession) => session.score.staves[0].measures;

describe('shorter meter preserves overflowing music', () => {
  it('moves excess notes into a new target-meter bar before existing following music and undoes once', () => {
    const session = new EditorSession(createProject(staff(bar('bar', ['a', 'b', 'c', 'd'].map(id => note(id)).join('')) + bar('next', note('e', 'whole')))));
    const before = session.project.sourceHtml;
    const following = structuredClone(measures(session)[1]);
    change(session);
    expect(measures(session).map(m => m.meter.display)).toEqual(['3/4', '3/4', '4/4']);
    expect(measures(session).map(m => m.voices[0].events.map(e => e.id))).toEqual([['a', 'b', 'c'], ['d'], ['e']]);
    expect(measures(session)[1].incomplete).toBe(true);
    expect(measures(session)[2]).toEqual({ ...following, number: '3' });
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
    session.redo(); expect(measures(session)).toHaveLength(3);
  });

  it('splits a long marked note with ties, preserves its original ID and moves the closing barline', () => {
    const music = note('a', 'whole').replace('</music-note>', '<music-articulation id="accent" type="accent"></music-articulation></music-note>');
    const session = new EditorSession(createProject(staff(bar('bar', music, 'end-bar="final"'))));
    change(session);
    const events = measures(session).flatMap(m => m.voices[0].events);
    expect(events.map(e => [e.duration, e.dots, e.tie])).toEqual([['half', 1, 'start'], ['quarter', 0, 'end']]);
    expect(events[0].id).toBe('a'); expect(events[1].id).not.toBe('a');
    expect(events[0].markings?.[0].id).toBe('accent'); expect(events[1].markings ?? []).toHaveLength(0);
    expect(measures(session).map(m => m.endBar)).toEqual(['single', 'final']);
  });

  it('adds as many aligned columns as needed across voices and hidden staves without filling unwritten time', () => {
    const voices = `<music-voice id="v1">${note('a', 'whole')}</music-voice><music-voice id="v2">${note('b', 'half')}</music-voice>`;
    const session = new EditorSession(createProject(`<music-system>${staff(bar('bar', voices, 'incomplete'))}${staff(bar('bassbar', '<music-rest id="r" measure></music-rest>'), 'bass')}</music-system>`));
    change(session, '1/4');
    expect(session.score.staves.map(s => s.measures.length)).toEqual([4, 4]);
    expect(measures(session).every(m => m.voices.length === 2 && m.meter.display === '1/4')).toBe(true);
    expect(measures(session).map(m => m.voices[1].events.length)).toEqual([1, 1, 0, 0]);
    expect(session.score.staves[1].measures[0].voices[0].events[0].id).toBe('r');
    expect(session.score.staves[1].measures.slice(1).every(m => m.incomplete && !m.voices[0].events.length)).toBe(true);
    expect(measures(session).flatMap(m => m.voices[0].events).reduce((t, e) => add(t, e.time), rational(0))).toEqual(rational(1));
  });

  it('moves instructions at exact offsets and retains following key/clef context', () => {
    const session = new EditorSession(createProject(staff(bar('bar', note('a', 'whole') + '<music-dynamics id="dyn" at="7/8" level="f"></music-dynamics>', 'key="G" clef="bass"') + bar('next', note('b', 'whole')))));
    session.execute({ type: 'set-measure', measureId: 'bar', values: { meter: '3/4', key: 'D', clef: 'alto' } });
    expect(measures(session).map(m => [m.key, m.clef])).toEqual([['D', 'alto'], ['D', 'alto'], ['G', 'bass']]);
    expect(measures(session)[1].annotations[0]).toMatchObject({ id: 'dyn', onset: rational(1, 8) });
  });

  it('retains complete tuplets and rejects a cross-bar tuplet atomically', () => {
    const tuplet = `<music-tuplet id="triplet" actual="3" normal="2">${['a', 'b', 'c'].map(id => note(id)).join('')}</music-tuplet>`;
    const session = new EditorSession(createProject(staff(bar('bar', tuplet + note('d', 'half')))));
    change(session, '2/4');
    expect(measures(session)[0].voices[0].tuplets[0].id).toBe('triplet');
    expect(measures(session)[1].voices[0].events[0].id).toBe('d');
    session.undo(); const before = session.project.sourceHtml;
    expect(() => change(session, '1/4')).toThrow(/tuplet.*barline/);
    expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
  });

  it.each([
    ['pitched', '<music-rest id="event" duration="whole"></music-rest>', 'none'],
    ['pitched', '<music-chord id="event" pitches="Cqs4 E4 G4" duration="whole"></music-chord>', 'start'],
    ['rhythm', '<music-rhythm id="event" duration="whole"></music-rhythm>', 'start'],
    ['three-roads', '<music-road id="event" direction="higher" duration="whole"><music-interval id="harmony" value="5" placement="above"></music-interval></music-road>', 'start'],
  ])('preserves %s event semantics when splitting %s', (notation, body, tie) => {
    const session = new EditorSession(createProject(`<music-staff id="staff" notation="${notation}">${bar('bar', body)}</music-staff>`));
    change(session);
    const events = measures(session).flatMap(m => m.voices[0].events);
    expect(events).toHaveLength(2); expect(events[0]).toMatchObject({ id: 'event', tie });
    expect(events[1].tie).toBe(tie === 'none' ? 'none' : 'end');
    expect(events[1].pitches).toEqual(events[0].pitches);
    if (notation === 'three-roads') {
      expect(events[1].pitchDirection).toBe('same');
      expect(events[1].markings?.[0]).toMatchObject({ ...events[0].markings![0], id: expect.any(String) });
      expect(events[1].markings?.[0].id).not.toBe('harmony');
    }
  });

  it('keeps explicit pickup requests atomic instead of silently overriding them', () => {
    const session = new EditorSession(createProject(staff(bar('bar', note('a', 'whole')))));
    const before = session.project.sourceHtml;
    expect(() => session.execute({ type: 'set-measure', measureId: 'bar', values: { meter: '3/4', pickup: true } })).toThrow(/cannot be a pickup/);
    expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
  });

  it('does not expand a full-measure rest or a measure that already fits', () => {
    for (const body of ['<music-rest id="r" measure></music-rest>', note('a', 'half')]) {
      const session = new EditorSession(createProject(staff(bar('bar', body, 'incomplete'))));
      change(session); expect(measures(session)).toHaveLength(1);
      expect(meterTime(measures(session)[0].meter)).toEqual(rational(3, 4));
    }
  });
});
