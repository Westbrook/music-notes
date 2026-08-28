import { describe, expect, it } from 'vitest';
import { groupBeams, hasSimultaneousPitchConflict, resolveAccidentals } from '../src/engraving/semantics.js';
import { add, durationTime, parseMeter, rational } from '../src/model/index.js';
import type { Measure, MusicEvent, Voice } from '../src/model/types.js';

function road(id: string, pitchDirection: NonNullable<MusicEvent['pitchDirection']>, changes: Partial<MusicEvent> = {}): MusicEvent {
  const duration = changes.duration ?? 'eighth';
  const dots = changes.dots ?? 0;
  return {
    id, kind: 'road', pitches: [], pitchDirection, duration, dots,
    onset: rational(0), time: durationTime(duration, dots), tupletIds: [],
    beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: false, ...changes,
  };
}

function voice(id: string, events: readonly MusicEvent[]): Voice {
  let onset = rational(0);
  return { id, tuplets: [], events: events.map(event => {
    const value = { ...event, onset };
    onset = add(onset, event.time);
    return value;
  }) };
}

function measure(voices: readonly Voice[]): Measure {
  return {
    id: 'm', number: '1', clef: 'treble', key: 'C', meter: parseMeter(4, 4), voices,
    annotations: [], breakBefore: 'auto', keepWithNext: false, endBar: 'single',
    repeatStart: false, pickup: false, incomplete: false,
  };
}

describe('three roads keep relative pitch separate from exact written rhythm', () => {
  it('beams across road changes according to the exact additive meter', () => {
    const directions = ['same', 'higher', 'lower', 'same', 'higher', 'higher', 'lower'] as const;
    const rhythm = voice('v', directions.map((direction, index) => road(`r${index}`, direction)));
    const source = JSON.stringify(rhythm);
    expect(groupBeams(rhythm, parseMeter('2+2+3', 8))).toEqual([
      ['r0', 'r1'], ['r2', 'r3'], ['r4', 'r5', 'r6'],
    ]);
    expect(JSON.stringify(rhythm)).toBe(source);
    expect(rhythm.events.map(event => event.pitchDirection)).toEqual(directions);
    expect(rhythm.events.every(event => event.pitches.length === 0 && !event.rhythmic)).toBe(true);
  });

  it('does not turn repeated middle-road instructions into a single attack', () => {
    const rhythm = voice('v', [road('first', 'same'), road('repeat', 'same'), road('higher', 'higher')]);
    expect(groupBeams(rhythm, parseMeter(3, 8))).toEqual([['first', 'repeat', 'higher']]);
    expect(rhythm.events.map(event => event.onset)).toEqual([rational(0), rational(1, 8), rational(1, 4)]);
    expect(rhythm.events.map(event => event.tie)).toEqual(['none', 'none', 'none']);
  });

  it('retains mixed written values and dots inside an explicit beam through a rest', () => {
    const rhythm = voice('v', [
      road('higher', 'higher', { duration: 'sixteenth', beam: 'start' }),
      road('silence', 'same', { kind: 'rest', pitchDirection: undefined, duration: 'sixteenth', beam: 'continue' }),
      road('lower', 'lower', { dots: 1, beam: 'continue' }),
      road('same', 'same', { duration: 'sixteenth', beam: 'end' }),
    ]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['higher', 'silence', 'lower', 'same']]);
    expect(rhythm.events.map(event => event.time)).toEqual([
      rational(1, 16), rational(1, 16), rational(3, 16), rational(1, 16),
    ]);
  });

  it('does not beam automatically through a rest or incompatible explicit stems', () => {
    const rhythm = voice('v', [
      road('up', 'higher', { stem: 'up' }), road('down', 'lower', { stem: 'down' }),
      road('third', 'higher'), road('silence', 'same', { kind: 'rest', pitchDirection: undefined }),
      road('same', 'same'), road('lower', 'lower'),
    ]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['same', 'lower']]);
  });

  it('preserves nested-tuplet boundaries despite adjacent beamable road events', () => {
    const rhythm = voice('v', [
      road('a', 'higher', { duration: 'sixteenth', time: rational(1, 24), tupletIds: ['outer'] }),
      road('b', 'same', { duration: 'sixteenth', time: rational(1, 24), tupletIds: ['outer'] }),
      road('c', 'lower', { duration: 'sixteenth', time: rational(1, 36), tupletIds: ['outer', 'inner'] }),
      road('d', 'same', { duration: 'sixteenth', time: rational(1, 36), tupletIds: ['outer', 'inner'] }),
      road('e', 'higher', { duration: 'sixteenth', time: rational(1, 36), tupletIds: ['outer', 'inner'] }),
      road('f', 'lower', { duration: 'sixteenth', time: rational(1, 24), tupletIds: ['outer'] }),
      road('g', 'same', { duration: 'sixteenth', time: rational(1, 24), tupletIds: ['outer'] }),
    ]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['a', 'b'], ['c', 'd', 'e'], ['f', 'g']]);
    expect(add(rhythm.events.at(-1)!.onset, rhythm.events.at(-1)!.time)).toEqual(rational(1, 4));
  });

  it('retains a tied middle-road continuation in its written rhythmic group', () => {
    const rhythm = voice('v', [road('held', 'same', { tie: 'end' }), road('next-attack', 'lower')]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['held', 'next-attack']]);
    expect(rhythm.events[0].tie).toBe('end');
    expect(rhythm.events[1].tie).toBe('none');
  });

  it('never turns different relative directions into pitches or accidental conflicts', () => {
    const scoreMeasure = measure([
      voice('upper', [road('up', 'higher')]), voice('middle', [road('same', 'same')]),
      voice('lower', [road('down', 'lower')]),
    ]);
    expect(Object.fromEntries(resolveAccidentals(scoreMeasure))).toEqual({ up: [], same: [], down: [] });
    expect(hasSimultaneousPitchConflict(scoreMeasure)).toBe(false);
  });
});
