import { describe, expect, it } from 'vitest';
import { canShareRest, groupBeams, resolveAccidentals } from '../src/engraving/semantics.js';
import { add, parseMeter, rational } from '../src/model/index.js';
import type { Duration, Measure, Meter, MusicEvent, Pitch, Rational, Voice } from '../src/model/types.js';

const times: Record<Duration, Rational> = {
  breve: { numerator: 2, denominator: 1 }, whole: { numerator: 1, denominator: 1 },
  half: { numerator: 1, denominator: 2 }, quarter: { numerator: 1, denominator: 4 },
  eighth: { numerator: 1, denominator: 8 }, sixteenth: { numerator: 1, denominator: 16 },
  'thirty-second': { numerator: 1, denominator: 32 },
  'sixty-fourth': { numerator: 1, denominator: 64 }, '128th': { numerator: 1, denominator: 128 },
};

function pitch(step: Pitch['step'] = 'F', alter = 0, octave = 4, display: Pitch['display'] = 'auto'): Pitch {
  return { step, alter, octave, display };
}

function note(id: string, extra: Partial<MusicEvent> = {}): MusicEvent {
  const duration = extra.duration ?? 'eighth';
  return {
    id, kind: 'note', pitches: [pitch()], duration, dots: 0,
    onset: rational(0), time: times[duration], tupletIds: [],
    beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: true, ...extra,
  };
}

function voice(events: readonly MusicEvent[], id = 'voice'): Voice {
  let onset = rational(0);
  return {
    id,
    events: events.map(event => {
      const timed = { ...event, onset };
      onset = add(onset, event.time);
      return timed;
    }),
    tuplets: [],
  };
}

function meter(numerator = 4, denominator = 4, groups: readonly number[] = [1, 1, 1, 1]): Meter {
  return { numerator, denominator, groups, explicitGroups: true, display: `${numerator}/${denominator}` };
}

function measure(voices: readonly Voice[], key = 'C'): Measure {
  return {
    id: 'measure', number: '1', meter: meter(), clef: 'treble', key, voices,
    annotations: [], breakBefore: 'auto', keepWithNext: false, endBar: 'single',
    repeatStart: false, pickup: false, incomplete: false,
  };
}

function signs(scoreMeasure: Measure): Record<string, unknown> {
  return Object.fromEntries(resolveAccidentals(scoreMeasure));
}

const sharp = { index: 0, type: '#', courtesy: false };
const natural = { index: 0, type: 'n', courtesy: false };

describe('canShareRest', () => {
  const rest = (id: string, extra: Partial<MusicEvent> = {}): MusicEvent => note(id, {
    kind: 'rest', pitches: [], rhythmic: false, duration: 'quarter', ...extra,
  });

  it('shares equal written rests while retaining their distinct identities', () => {
    const first = rest('first-voice-rest');
    const second = rest('second-voice-rest');
    expect(canShareRest(first, second)).toBe(true);
    expect(canShareRest(second, first)).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  it('does not share plain and dotted quarters with different elapsed times', () => {
    const plain = rest('plain');
    const dotted = rest('dotted', { dots: 1, time: rational(3, 8) });
    expect(canShareRest(plain, dotted)).toBe(false);
    expect(canShareRest(dotted, plain)).toBe(false);
  });

  it('does not hide the dot on a 3:2 dotted quarter lasting one ordinary quarter', () => {
    const plain = rest('plain');
    const tuplet = rest('dotted-in-triplet', { dots: 1, time: rational(1, 4), tupletIds: ['triplet'] });
    expect(canShareRest(plain, tuplet)).toBe(false);
    expect(canShareRest(tuplet, plain)).toBe(false);
  });

  it('rejects different effective times even when the written glyphs match', () => {
    const plain = rest('plain');
    const tuplet = rest('quarter-in-triplet', { time: rational(1, 6), tupletIds: ['triplet'] });
    expect(canShareRest(plain, tuplet)).toBe(false);
  });

  it('rejects different written durations even when their effective times match', () => {
    const half = rest('half', { duration: 'half', time: rational(1, 2) });
    const augmentedQuarter = rest('augmented-quarter', { time: rational(1, 2), tupletIds: ['augmentation'] });
    expect(canShareRest(half, augmentedQuarter)).toBe(false);
  });

  it('keeps full-measure and ordinary whole rests distinct', () => {
    const whole = rest('whole', { duration: 'whole', time: rational(1) });
    const measureRest = rest('measure', { duration: 'whole', time: rational(1), measureRest: true });
    expect(canShareRest(whole, measureRest)).toBe(false);
    expect(canShareRest(measureRest, { ...measureRest, id: 'other-measure-rest' })).toBe(true);
    expect(canShareRest(whole, { ...whole, measureRest: undefined as unknown as boolean })).toBe(true);
  });

  it('compares rational values exactly and ignores independent tuplet/source IDs', () => {
    const first = rest('first', { onset: rational(1, 4), time: rational(1, 6), tupletIds: ['triplet-a'] });
    const second = rest('second', { onset: { numerator: 2, denominator: 8 }, time: { numerator: 2, denominator: 12 }, tupletIds: ['triplet-b'] });
    expect(canShareRest(first, second)).toBe(true);
    expect(canShareRest(first, { ...second, onset: rational(1, 2) })).toBe(false);
  });

  it.each(['note', 'chord', 'slash'] as const)('never shares a rest glyph with a %s', kind => {
    const silence = rest('rest');
    const other = note('other', { kind, duration: 'quarter' });
    expect(canShareRest(silence, other)).toBe(false);
    expect(canShareRest(other, silence)).toBe(false);
    expect(canShareRest(other, { ...other, id: 'another' })).toBe(false);
  });

  it('does not modify frozen source events or their exact fractions', () => {
    const first = Object.freeze(rest('first', {
      onset: Object.freeze(rational(1, 4)), time: Object.freeze(rational(1, 6)), tupletIds: Object.freeze(['a']),
    }));
    const second = Object.freeze(rest('second', {
      onset: Object.freeze(rational(2, 8)), time: Object.freeze(rational(2, 12)), tupletIds: Object.freeze(['b']),
    }));
    const before = JSON.stringify([first, second]);
    expect(canShareRest(first, second)).toBe(true);
    expect(JSON.stringify([first, second])).toBe(before);
  });
});

describe('resolveAccidentals', () => {
  it('prints pitch spelling, suppresses repeats, and cancels to natural', () => {
    expect(signs(measure([voice([
      note('a', { pitches: [pitch('F', 1)] }), note('b', { pitches: [pitch('F', 1)] }),
      note('c'), note('d'), note('e', { pitches: [pitch('F', 1)] }),
    ])]))).toEqual({ a: [sharp], b: [], c: [natural], d: [], e: [sharp] });
  });

  it('starts from the key signature without changing absolute pitches', () => {
    expect(signs(measure([voice([
      note('a', { pitches: [pitch('F', 1)] }), note('b'),
      note('c', { pitches: [pitch('F', 1)] }), note('d', { pitches: [pitch('F', 1)] }),
    ])], 'G'))).toEqual({ a: [], b: [natural], c: [sharp], d: [] });
  });

  it('supports flat signatures, double sharps, and double flats', () => {
    expect(signs(measure([voice([
      note('a', { pitches: [pitch('B', -1)] }), note('b', { pitches: [pitch('B', -2)] }),
      note('c', { pitches: [pitch('B', -1)] }), note('d', { pitches: [pitch('F', 2)] }),
    ])], 'F'))).toEqual({
      a: [], b: [{ index: 0, type: 'bb', courtesy: false }],
      c: [{ index: 0, type: 'b', courtesy: false }], d: [{ index: 0, type: '##', courtesy: false }],
    });
  });

  it('keeps accidental state separate for octaves and resets it each bar', () => {
    const first = measure([voice([
      note('a', { pitches: [pitch('F', 1, 4)] }), note('b', { pitches: [pitch('F', 1, 5)] }),
      note('c', { pitches: [pitch('F', 1, 4)] }), note('d', { pitches: [pitch('F', 0, 5)] }),
    ])]);
    expect(signs(first)).toEqual({ a: [sharp], b: [sharp], c: [], d: [natural] });
    expect(signs(measure([voice([note('a', { pitches: [pitch('F', 1)] })])]))).toEqual({ a: [sharp] });
    expect(signs(measure([voice([note('a')])]))).toEqual({ a: [] });
  });

  it('honors forced and parenthesized courtesy accidentals', () => {
    expect(signs(measure([voice([
      note('a', { pitches: [pitch('F', 0, 4, 'always')] }),
      note('b', { pitches: [pitch('F', 0, 4, 'courtesy')] }),
      note('c', { pitches: [pitch('F', 1)] }),
      note('d', { pitches: [pitch('F', 1, 4, 'always')] }),
    ])]))).toEqual({ a: [natural], b: [{ ...natural, courtesy: true }], c: [sharp], d: [sharp] });
  });

  it('indexes chord pitches and does not give rests or slashes accidentals', () => {
    expect(signs(measure([voice([
      note('chord', { kind: 'chord', pitches: [pitch('C'), pitch('F', 1), pitch('B', -1)] }),
      note('rest', { kind: 'rest', pitches: [] }),
      note('slash', { kind: 'slash', pitches: [] }),
    ])]))).toEqual({
      chord: [{ ...sharp, index: 1 }, { index: 2, type: 'b', courtesy: false }], rest: [], slash: [],
    });
  });

  it('resolves simultaneous cross-voice alterations without a voice-order bias', () => {
    const upper = voice([
      note('sharp', { pitches: [pitch('F', 1)] }), note('after', { pitches: [pitch('F', 1)] }),
      note('repeat', { pitches: [pitch('F', 1)] }),
    ], 'upper');
    const lower = voice([note('natural')], 'lower');
    const expected = { sharp: [sharp], natural: [natural], after: [sharp], repeat: [] };
    expect(signs(measure([upper, lower]))).toEqual(expected);
    expect(signs(measure([lower, upper]))).toEqual(expected);
  });

  it('requires a natural after simultaneous conflicting alterations too', () => {
    expect(signs(measure([
      voice([note('sharp', { pitches: [pitch('F', 1)] }), note('after')], 'upper'),
      voice([note('natural')], 'lower'),
    ]))).toEqual({ sharp: [sharp], natural: [natural], after: [natural] });
  });

  it('uses exact rational onsets and establishes same-pitch unisons together', () => {
    const first: Voice = { id: 'first', tuplets: [], events: [
      note('a', { pitches: [pitch('F', 1)], onset: rational(1, 4) }),
      note('c', { pitches: [pitch('F', 1)], onset: rational(3, 8) }),
    ] };
    const second: Voice = { id: 'second', tuplets: [], events: [
      note('b', { pitches: [pitch('F', 1)], onset: { numerator: 2, denominator: 8 } }),
    ] };
    expect(signs(measure([first, second]))).toEqual({ a: [sharp], b: [sharp], c: [] });
  });

  it('processes all voices in musical time rather than DOM voice order', () => {
    const later = { ...voice([note('later')], 'later'),
      events: [note('later', { onset: rational(1, 4) })] };
    const earlier = voice([note('earlier', { pitches: [pitch('F', 1)] })], 'earlier');
    expect(signs(measure([later, earlier]))).toEqual({ later: [natural], earlier: [sharp] });
  });

  it('suppresses tied continuations within a bar', () => {
    expect(signs(measure([voice([
      note('a', { pitches: [pitch('F', 1)], tie: 'start' }),
      note('b', { pitches: [pitch('F', 1)], tie: 'continue' }),
      note('c', { pitches: [pitch('F', 1)], tie: 'end' }),
      note('d', { pitches: [pitch('F', 1)] }),
    ])]))).toEqual({ a: [sharp], b: [], c: [], d: [] });
  });

  it('does not carry a tied alteration into subsequent untied notes in a new bar', () => {
    expect(signs(measure([voice([
      note('tied', { pitches: [pitch('F', 1)], tie: 'end' }),
      note('natural'), note('new', { pitches: [pitch('F', 1)] }),
    ])]))).toEqual({ tied: [], natural: [], new: [sharp] });
  });

  it('preserves the new key signature state for ties crossing a key change', () => {
    expect(signs(measure([voice([
      note('tied', { tie: 'end' }), note('key-note', { pitches: [pitch('F', 1)] }),
      note('natural'),
    ])], 'G'))).toEqual({ tied: [], 'key-note': [], natural: [natural] });
  });

  it('lets an explicit courtesy on a tied continuation establish bar-local state', () => {
    expect(signs(measure([voice([
      note('tied', { pitches: [pitch('F', 1, 4, 'courtesy')], tie: 'end' }),
      note('later', { pitches: [pitch('F', 1)] }), note('cancel'),
    ])]))).toEqual({ tied: [{ ...sharp, courtesy: true }], later: [], cancel: [natural] });
  });

  it('prints simultaneous conflicts even when one occurrence is tied', () => {
    expect(signs(measure([
      voice([note('tied', { pitches: [pitch('F', 1)], tie: 'end' })], 'upper'),
      voice([note('natural')], 'lower'),
    ]))).toEqual({ tied: [sharp], natural: [natural] });
  });

  it('is deterministic, keeps input intact, and freezes returned accidental lists', () => {
    const source = measure([voice([note('a', { pitches: [pitch('F', 1)] }), note('b')])]);
    const before = JSON.stringify(source);
    const first = resolveAccidentals(source);
    expect(resolveAccidentals(source)).toEqual(first);
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(first.get('a'))).toBe(true);
    expect(Object.isFrozen(first.get('a')?.[0])).toBe(true);
  });
});

describe('groupBeams', () => {
  it('groups simple-meter eighths at exact quarter-note boundaries', () => {
    expect(groupBeams(voice(Array.from({ length: 8 }, (_, i) => note(`${i}`))), meter())).toEqual([
      ['0', '1'], ['2', '3'], ['4', '5'], ['6', '7'],
    ]);
  });

  it.each([
    { numerator: 2, groups: [['0', '1']] },
    { numerator: 3, groups: [['0', '1', '2']] },
    { numerator: 4, groups: [['0', '1'], ['2', '3']] },
  ])('uses conventional default beaming in $numerator/8', ({ numerator, groups }) => {
    expect(groupBeams(voice(Array.from({ length: numerator }, (_, i) => note(`${i}`))), parseMeter(numerator, 8)))
      .toEqual(groups);
  });

  it('follows an explicitly grouped 7/8 meter', () => {
    const events = voice(Array.from({ length: 7 }, (_, i) => note(`${i}`)));
    expect(groupBeams(events, meter(7, 8, [2, 2, 3]))).toEqual([['0', '1'], ['2', '3'], ['4', '5', '6']]);
    expect(groupBeams(events, meter(7, 8, [3, 2, 2]))).toEqual([['0', '1', '2'], ['3', '4'], ['5', '6']]);
  });

  it('handles compound 15/8 and an additive alternative', () => {
    const events = voice(Array.from({ length: 15 }, (_, i) => note(`${i}`)));
    expect(groupBeams(events, meter(15, 8, [3, 3, 3, 3, 3]))).toEqual([
      ['0', '1', '2'], ['3', '4', '5'], ['6', '7', '8'], ['9', '10', '11'], ['12', '13', '14'],
    ]);
    expect(groupBeams(events, meter(15, 8, [2, 2, 2, 2, 2, 2, 3])).map(group => group.length)).toEqual([2, 2, 2, 2, 2, 2, 3]);
  });

  it('supports 5/4 with author-selected 3+2 grouping', () => {
    expect(groupBeams(voice(Array.from({ length: 10 }, (_, i) => note(`${i}`))), meter(5, 4, [3, 2]))).toEqual([
      ['0', '1', '2', '3', '4', '5'], ['6', '7', '8', '9'],
    ]);
  });

  it('keeps mixed sixteenth/eighth/sixteenth membership without inventing beam levels', () => {
    expect(groupBeams(voice([
      note('a', { duration: 'sixteenth' }), note('b'), note('c', { duration: 'sixteenth' }),
      note('d', { duration: 'quarter' }),
    ]), meter())).toEqual([['a', 'b', 'c']]);
  });

  it('splits automatic groups when explicit stem directions disagree', () => {
    expect(groupBeams(voice([
      note('a', { duration: 'sixteenth', stem: 'up' }), note('b', { duration: 'sixteenth' }),
      note('c', { duration: 'sixteenth', stem: 'down' }), note('d', { duration: 'sixteenth' }),
    ]), meter())).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('allows a later explicit direction to govern preceding automatic stems', () => {
    expect(groupBeams(voice([
      note('a', { duration: 'sixteenth' }), note('b', { duration: 'sixteenth', stem: 'down' }),
      note('c', { duration: 'sixteenth' }), note('d', { duration: 'sixteenth', stem: 'down' }),
    ]), meter())).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('does not carry explicit stem direction across an automatic-group boundary', () => {
    expect(groupBeams(voice([
      note('a', { stem: 'up' }), note('b'), note('c'), note('d', { stem: 'down' }),
    ]), meter())).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('leaves opposing adjacent explicit stems as individual flagged notes', () => {
    expect(groupBeams(voice([note('a', { stem: 'up' }), note('b', { stem: 'down' })]), meter())).toEqual([]);
  });

  it('handles dotted values using their exact sounding duration', () => {
    expect(groupBeams(voice([
      note('a', { dots: 1, time: rational(3, 16) }), note('b', { duration: 'sixteenth' }),
      note('c'), note('d'),
    ]), meter())).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('isolates triplets and quintuplets at exact rational beat boundaries', () => {
    const events = [
      ...Array.from({ length: 3 }, (_, i) => note(`t${i}`, { time: rational(1, 12), tupletIds: ['triplet'] })),
      ...Array.from({ length: 5 }, (_, i) => note(`q${i}`, { duration: 'sixteenth', time: rational(1, 20), tupletIds: ['quintuplet'] })),
      note('plain1'), note('plain2'),
    ];
    expect(groupBeams(voice(events), meter())).toEqual([
      ['t0', 't1', 't2'], ['q0', 'q1', 'q2', 'q3', 'q4'], ['plain1', 'plain2'],
    ]);
  });

  it('breaks when nested tuplet membership changes even within the same beat', () => {
    expect(groupBeams(voice([
      note('a', { duration: 'sixteenth', tupletIds: ['outer'] }),
      note('b', { duration: 'sixteenth', tupletIds: ['outer'] }),
      note('c', { duration: 'sixteenth', tupletIds: ['outer', 'inner'] }),
      note('d', { duration: 'sixteenth', tupletIds: ['outer', 'inner'] }),
    ]), meter())).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('breaks automatic groups at rests, disabled beams, and stemless slashes', () => {
    const events = voice([
      note('a'), note('rest', { kind: 'rest', pitches: [] }), note('b'), note('c'),
      note('none', { beam: 'none' }), note('d'), note('slash', { kind: 'slash', pitches: [], rhythmic: false }), note('e'),
    ]);
    expect(groupBeams(events, meter(8, 8, [8]))).toEqual([['b', 'c']]);
  });

  it('beams rhythmic slashes and chords but never quarter-or-longer symbols', () => {
    expect(groupBeams(voice([
      note('slash1', { kind: 'slash', pitches: [], rhythmic: true }),
      note('slash2', { kind: 'slash', pitches: [], rhythmic: true }),
      note('long', { duration: 'quarter' }),
      note('chord1', { kind: 'chord', pitches: [pitch('C'), pitch('E')] }),
      note('chord2', { kind: 'chord', pitches: [pitch('D'), pitch('F')] }),
    ]), meter())).toEqual([['slash1', 'slash2'], ['chord1', 'chord2']]);
  });

  it('leaves a syncopated note crossing a beat-group boundary unbeamed', () => {
    expect(groupBeams(voice([
      note('a'), note('crossing', { dots: 1, time: rational(3, 16) }),
      note('b', { duration: 'sixteenth' }), note('c'),
    ]), meter())).toEqual([['b', 'c']]);
  });

  it('honors explicit groups across meter groups and tuplet boundaries', () => {
    expect(groupBeams(voice([
      note('a', { beam: 'start' }), note('b', { beam: 'continue' }),
      note('c', { tupletIds: ['authored'] }), note('d', { beam: 'end', tupletIds: ['authored'] }),
      note('e'), note('f'),
    ]), meter())).toEqual([['a', 'b', 'c', 'd'], ['e', 'f']]);
  });

  it('includes short interior rests in a valid explicit group', () => {
    expect(groupBeams(voice([
      note('a', { beam: 'start' }), note('rest', { kind: 'rest', pitches: [] }), note('b', { beam: 'end' }),
    ]), meter())).toEqual([['a', 'rest', 'b']]);
  });

  it.each([
    [note('a', { beam: 'start' }), note('b')],
    [note('a', { beam: 'start' }), note('b', { beam: 'none' }), note('c', { beam: 'end' })],
    [note('a', { beam: 'start' }), note('b', { duration: 'quarter' }), note('c', { beam: 'end' })],
    [note('a', { beam: 'start' }), note('b', { kind: 'rest', pitches: [], beam: 'end' })],
    [note('a', { kind: 'rest', pitches: [], beam: 'start' }), note('b', { beam: 'end' })],
    [note('a', { beam: 'start' }), note('b', { kind: 'slash', rhythmic: false }), note('c', { beam: 'end' })],
    [note('a', { beam: 'start' }), note('b', { beam: 'start' }), note('c', { beam: 'end' }), note('d', { beam: 'end' })],
  ])('does not reinterpret malformed explicit ranges as automatic beams: %j', (...events) => {
    expect(groupBeams(voice(events), meter(16, 8, [16]))).toEqual([]);
  });

  it('treats orphan continuation/end markers as barriers', () => {
    expect(groupBeams(voice([
      note('orphan', { beam: 'continue' }), note('a'), note('b'), note('end', { beam: 'end' }), note('c'), note('d'),
    ]), meter(6, 8, [6]))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('does not join events across missing time, overlapping time, or zero duration', () => {
    const events: Voice = {
      id: 'invalid', tuplets: [], events: [
        note('a'), note('gap', { onset: rational(1, 4) }),
        note('overlap', { onset: rational(1, 4) }), note('zero', { onset: rational(3, 8), time: rational(0) }),
      ],
    };
    expect(groupBeams(events, meter(8, 8, [8]))).toEqual([]);
  });

  it.each([
    meter(7, 8, [2, 2]), meter(7, 8, [0, 7]), meter(7, 0, [7]), meter(7, 8, [-1, 8]),
    meter(7, 8, []), meter(Number.NaN, 8, [7]),
  ])('leaves automatic groups off for an invalid meter without throwing: %j', invalid => {
    expect(groupBeams(voice([note('a'), note('b')]), invalid)).toEqual([]);
  });

  it('still honors valid author grouping when the meter is invalid', () => {
    expect(groupBeams(voice([note('a', { beam: 'start' }), note('b', { beam: 'end' })]), meter(0, 0, [])))
      .toEqual([['a', 'b']]);
  });

  it('returns immutable, deterministic group lists without changing its input', () => {
    const source = voice([note('a'), note('b'), note('c'), note('d')]);
    const before = JSON.stringify(source);
    const result = groupBeams(source, meter());
    expect(groupBeams(source, meter())).toEqual(result);
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(group => Object.isFrozen(group))).toBe(true);
  });
});
