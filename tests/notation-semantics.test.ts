import { describe, expect, it } from 'vitest';
import { accidentalType, groupBeams, hasSimultaneousPitchConflict, resolveAccidentals } from '../src/engraving/semantics.js';
import { add, durationTime, parseMeter, parsePitch, rational } from '../src/model/index.js';
import type { Measure, MusicEvent, Voice } from '../src/model/types.js';

function event(id: string, pitch?: string, changes: Partial<MusicEvent> = {}): MusicEvent {
  const duration = changes.duration ?? 'eighth';
  return {
    id, kind: pitch ? 'note' : 'rhythm', pitches: pitch ? [parsePitch(pitch)] : [],
    duration, dots: 0, onset: rational(0), time: durationTime(duration), tupletIds: [],
    beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: false, ...changes,
  };
}

function voice(id: string, events: readonly MusicEvent[]): Voice {
  let onset = rational(0);
  return { id, tuplets: [], events: events.map(item => {
    const timed = { ...item, onset };
    onset = add(onset, item.time);
    return timed;
  }) };
}

function measure(voices: readonly Voice[], key = 'C'): Measure {
  return {
    id: 'measure', number: '1', clef: 'treble', key, meter: parseMeter(4, 4), voices,
    annotations: [], breakBefore: 'auto', keepWithNext: false, endBar: 'single',
    repeatStart: false, pickup: false, incomplete: false,
  };
}

const sign = (type: NonNullable<ReturnType<typeof accidentalType>>, index = 0, courtesy = false) => ({ index, type, courtesy });

describe('quarter-tone engraving semantics', () => {
  it('uses one consistent Stein–Zimmermann glyph family and never substitutes an unknown alteration', () => {
    expect([-1.5, -0.5, 0.5, 1.5].map(accidentalType)).toEqual(['db', 'd', '+', '++']);
    for (const unsupported of [-3, -0.25, 0.25, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(accidentalType(unsupported)).toBeUndefined();
    }
  });

  it('keeps absolute quarter-tone spellings distinct from a key signature and cancels them correctly', () => {
    const bar = measure([voice('v', [
      event('key', 'F#4'), event('quarter', 'Fqs4'), event('repeat', 'Fqs4'),
      event('three', 'Ftqs4'), event('natural', 'F4'), event('sharp', 'F#4'),
    ])], 'G');
    expect(Object.fromEntries(resolveAccidentals(bar))).toEqual({
      key: [], quarter: [sign('+')], repeat: [], three: [sign('++')],
      natural: [sign('n')], sharp: [sign('#')],
    });
  });

  it('retains chord pitch indices and explicit courtesy parentheses for quarter-tone flats', () => {
    const chord = event('chord', undefined, {
      kind: 'chord', pitches: [parsePitch('Cqf4'), parsePitch('Etqf4'), parsePitch('Gqs4', undefined, 'courtesy')],
    });
    expect(resolveAccidentals(measure([voice('v', [chord])])).get('chord')).toEqual([
      sign('d'), sign('db', 1), sign('+', 2, true),
    ]);
  });

  it('prints conflicting simultaneous quarter-tones and requires the next attack to establish state', () => {
    const bar = measure([
      voice('upper', [event('upper-a', 'Fqs4'), event('upper-b', 'Fqs4')]),
      voice('lower', [event('lower-a', 'Ftqs4'), event('lower-b', 'Fqs4')]),
    ]);
    expect(Object.fromEntries(resolveAccidentals(bar))).toEqual({
      'upper-a': [sign('+')], 'upper-b': [sign('+')],
      'lower-a': [sign('++')], 'lower-b': [sign('+')],
    });
  });

  it('requires separate heads for simultaneous differing alterations, including a chord unison', () => {
    expect(hasSimultaneousPitchConflict(measure([
      voice('upper', [event('u', 'Fqf4')]), voice('lower', [event('l', 'Fqs4')]),
    ]))).toBe(true);
    expect(hasSimultaneousPitchConflict(measure([voice('v', [event('chord', undefined, {
      kind: 'chord', pitches: [parsePitch('Fqf4'), parsePitch('Fqs4')],
    })])]))).toBe(true);
  });

  it('shares compatible spellings and does not confuse different octaves or onsets', () => {
    expect(hasSimultaneousPitchConflict(measure([
      voice('upper', [event('u1', 'Fqf4'), event('u2', 'Fqs4')]),
      voice('lower', [event('l1', 'Fqf4'), event('l2', 'Ftqs5')]),
    ]))).toBe(false);
    const upper = { id: 'upper', tuplets: [], events: [event('u', 'Fqf4', { onset: rational(1, 8) })] };
    const lower = { id: 'lower', tuplets: [], events: [event('l', 'Fqs4', { onset: { numerator: 2, denominator: 16 } })] };
    expect(hasSimultaneousPitchConflict(measure([upper, lower]))).toBe(true);
  });

  it('does not let an automatic tied continuation establish the new bar accidental', () => {
    const bar = measure([voice('v', [
      event('continuation', 'Btqf4', { tie: 'end' }), event('next-attack', 'Btqf4'), event('cancel', 'B4'),
    ])]);
    expect(Object.fromEntries(resolveAccidentals(bar))).toEqual({
      continuation: [], 'next-attack': [sign('db')], cancel: [sign('n')],
    });
  });

  it('lets an explicit courtesy on a tied quarter-tone establish accidental state', () => {
    const continuation = event('continuation', 'Fqs4', {
      tie: 'end', pitches: [parsePitch('Fqs4', undefined, 'courtesy')],
    });
    const bar = measure([voice('v', [continuation, event('next-attack', 'Fqs4')])]);
    expect(Object.fromEntries(resolveAccidentals(bar))).toEqual({
      continuation: [sign('+', 0, true)], 'next-attack': [],
    });
  });
});

describe('pitchless rhythm engraving semantics', () => {
  it('beams exact attacks according to the additive meter without assigning pitches', () => {
    const rhythm = voice('v', Array.from({ length: 7 }, (_, index) => event(`r${index}`)));
    expect(groupBeams(rhythm, parseMeter('2+2+3', 8))).toEqual([
      ['r0', 'r1'], ['r2', 'r3'], ['r4', 'r5', 'r6'],
    ]);
    expect([...resolveAccidentals(measure([rhythm])).values()]).toEqual(Array.from({ length: 7 }, () => []));
    expect(rhythm.events.every(item => item.pitches.length === 0 && item.kind === 'rhythm')).toBe(true);
  });

  it('preserves explicit rhythmic beams through rests and mixed written beam levels', () => {
    const rhythm = voice('v', [
      event('a', undefined, { beam: 'start' }),
      event('b', undefined, { kind: 'rest', duration: 'sixteenth', beam: 'continue' }),
      event('c', undefined, { duration: 'sixteenth', beam: 'end' }),
    ]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['a', 'b', 'c']]);
    expect(rhythm.events.map(item => item.time)).toEqual([rational(1, 8), rational(1, 16), rational(1, 16)]);
  });

  it('does not infer a prescribed rhythm from open slashes or join across a rest', () => {
    const rhythm = voice('v', [
      event('a'), event('rest', undefined, { kind: 'rest' }),
      event('open-a', undefined, { kind: 'slash' }), event('open-b', undefined, { kind: 'slash' }),
      event('prescribed-a', undefined, { kind: 'slash', rhythmic: true }), event('prescribed-b'),
    ]);
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['prescribed-a', 'prescribed-b']]);
  });

  it('keeps two adjacent exact tuplet groups separate', () => {
    const rhythm = voice('v', Array.from({ length: 6 }, (_, index) => event(`r${index}`, undefined, {
      time: rational(1, 12), tupletIds: [index < 3 ? 'first' : 'second'],
    })));
    expect(groupBeams(rhythm, parseMeter(4, 4))).toEqual([['r0', 'r1', 'r2'], ['r3', 'r4', 'r5']]);
  });
});
