import { describe, expect, it } from 'vitest';
import {
  add, compare, divide, durationTime, equals, formatRational, keyAlterations, meterBoundaries, meterTime,
  multiply, parseDuration, parseMeter, parsePitch, pitchPosition, pitchText, rational, subtract, toNumber,
  validateClef, validateKey, validateScore,
} from '../src/model/index';
import type { Duration, Measure, MusicEvent, Score, Staff, Tuplet, Voice } from '../src/model/index';

let nextId = 1;
const id = (kind: string): string => `${kind}-${nextId++}`;

function event(duration: Duration = 'quarter', extra: Partial<MusicEvent> = {}): MusicEvent {
  const actualDuration = extra.duration ?? duration;
  const kind = extra.kind ?? 'note';
  return {
    id: id('event'), kind, pitches: kind === 'note' ? [parsePitch('C4')] : [],
    duration: actualDuration, dots: extra.dots ?? 0, onset: rational(0), time: durationTime(actualDuration, extra.dots ?? 0),
    tupletIds: [], beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: kind === 'slash',
    ...extra,
  };
}

function voice(events: readonly MusicEvent[], tuplets: readonly Tuplet[] = []): Voice {
  let onset = rational(0);
  return {
    id: id('voice'), tuplets,
    events: events.map(value => {
      const result = { ...value, onset };
      onset = add(onset, value.time);
      return result;
    }),
  };
}

function measure(voices: readonly Voice[] = [voice([event('whole')])], extra: Partial<Measure> = {}): Measure {
  return {
    id: id('measure'), number: '1', meter: parseMeter(), clef: 'treble', key: 'C', voices,
    annotations: [], breakBefore: 'auto', keepWithNext: false, endBar: 'single', repeatStart: false, pickup: false, incomplete: false,
    ...extra,
  };
}

function staff(measures: readonly Measure[]): Staff {
  return { id: id('staff'), label: '', clef: 'treble', key: 'C', measures };
}

function score(measures: readonly Measure[], otherStaves: readonly Staff[] = []): Score {
  return { id: id('score'), label: 'Test score', bracket: 'none', staves: [staff(measures), ...otherStaves] };
}

function tuplet(events: readonly MusicEvent[], actual: number, normal: number): { events: MusicEvent[]; tuplet: Tuplet } {
  const tupletId = id('tuplet');
  return {
    events: events.map(value => ({ ...value, time: multiply(value.time, rational(normal, actual)), tupletIds: [tupletId, ...value.tupletIds] })),
    tuplet: { id: tupletId, actual, normal, eventIds: events.map(value => value.id), bracket: 'auto', showRatio: false },
  };
}

function errors(value: Score): string[] {
  return validateScore(value).filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code);
}

describe('exact rational musical time', () => {
  it('normalizes signs and zero without losing exactness', () => {
    expect(rational(-6, -8)).toEqual({ numerator: 3, denominator: 4 });
    expect(rational(6, -8)).toEqual({ numerator: -3, denominator: 4 });
    expect(rational(0, -3)).toEqual({ numerator: 0, denominator: 1 });
    expect(formatRational(rational(6, 3))).toBe('2');
    expect(formatRational({ numerator: 6, denominator: 8 })).toBe('3/4');
  });

  it('adds, subtracts, multiplies, and divides exact fractions', () => {
    expect(add(rational(1, 3), rational(1, 6))).toEqual(rational(1, 2));
    expect(subtract(rational(1, 6), rational(1, 3))).toEqual(rational(-1, 6));
    expect(multiply(rational(5, 7), rational(7, 10))).toEqual(rational(1, 2));
    expect(divide(rational(3, 8), rational(3, 2))).toEqual(rational(1, 4));
    expect(toNumber(rational(3, 8))).toBe(0.375);
    expect(equals(rational(1, 3), { numerator: 3, denominator: 9 })).toBe(true);
  });

  it('avoids floating equality and intermediate overflow', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const a = rational(maximum - 1, maximum);
    const b = rational(maximum - 2, maximum - 1);
    expect(toNumber(a)).toBe(toNumber(b));
    expect(compare(a, b)).toBe(1);
    expect(equals(a, b)).toBe(false);
    expect(multiply(rational(maximum, 2), rational(2, maximum))).toEqual(rational(1));
    expect(divide(rational(maximum, 2), rational(maximum, 2))).toEqual(rational(1));
  });

  it('guards invalid input, zero division, and unrepresentable results', () => {
    for (const value of [NaN, Infinity, 0.25, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => rational(value)).toThrow(/safe integer/);
    }
    expect(() => rational(1, 0)).toThrow(/zero/);
    expect(() => divide(rational(1), rational(0))).toThrow(/zero/);
    expect(() => add(rational(Number.MAX_SAFE_INTEGER), rational(1))).toThrow(/safe integer/);
    expect(() => multiply(rational(1, Number.MAX_SAFE_INTEGER), rational(1, 2))).toThrow(/safe integer/);
    expect(() => compare({ numerator: 1, denominator: 0 }, rational(1))).toThrow();
  });
});

describe('written durations and absolute pitches', () => {
  it('accepts readable names and denominator aliases but rejects malformed durations', () => {
    expect(parseDuration('  Quarter ')).toBe('quarter');
    expect(parseDuration('4')).toBe('quarter');
    expect(parseDuration('1/8')).toBe('eighth');
    expect(parseDuration('32nd')).toBe('thirty-second');
    expect(parseDuration('128')).toBe('128th');
    expect(parseDuration('double-whole')).toBe('breve');
    for (const value of ['', 'quarter-ish', '256', '0', '3', 'quarter.']) expect(() => parseDuration(value)).toThrow();
    expect(durationTime('breve')).toEqual(rational(2));
    expect(durationTime('quarter', 1)).toEqual(rational(3, 8));
    expect(durationTime('quarter', 2)).toEqual(rational(7, 16));
    expect(durationTime('quarter', 3)).toEqual(rational(15, 32));
    for (const dots of [-1, 0.5, 4, NaN]) expect(() => durationTime('eighth', dots)).toThrow();
  });

  it('preserves absolute spelling and all supported accidental forms', () => {
    expect(parsePitch('F4')).toEqual({ step: 'F', octave: 4, alter: 0, display: 'auto' });
    expect(parsePitch('B4', 'flat')).toEqual(parsePitch('Bb4'));
    expect(parsePitch('C4', 'double-sharp', 'courtesy')).toEqual({ step: 'C', octave: 4, alter: 2, display: 'courtesy' });
    expect(parsePitch('F𝄪4')).toEqual(parsePitch('F##4'));
    expect(parsePitch('F𝄫4')).toEqual(parsePitch('Fbb4'));
    expect(parsePitch('E♮4')).toEqual(parsePitch('E4'));
    expect(parsePitch('g♭-1')).toEqual({ step: 'G', octave: -1, alter: -1, display: 'auto' });
    expect(parsePitch('Bb4', 'flat')).toEqual(parsePitch('Bb4'));
    expect(() => parsePitch('Bb4', 'sharp')).toThrow(/conflicts/);
    expect(() => parsePitch('B#4', 'natural')).toThrow(/conflicts/);
    expect(pitchText(parsePitch('F𝄪4'))).toBe('F##4');
    expect(pitchText(parsePitch('C-1'))).toBe('C-1');
  });

  it('rejects absent octaves, unknown pitch syntax, and unsafe ranges', () => {
    for (const value of ['', 'C', 'H4', 'C4garbage', 'C4.5', 'C10', 'C-2', 'C###4', 'C#b4', '440']) expect(() => parsePitch(value)).toThrow();
    expect(() => parsePitch('C4', 'quarter-sharp')).toThrow();
    expect(() => parsePitch('C4', undefined, 'hidden' as 'auto')).toThrow();
    expect(() => pitchText({ ...parsePitch('C4'), alter: 3 })).toThrow();
  });

  it('uses correct reference lines in treble, bass, alto, and tenor clefs', () => {
    expect(pitchPosition(parsePitch('E4'), 'treble')).toBe(0);
    expect(pitchPosition(parsePitch('G2'), 'bass')).toBe(0);
    expect(pitchPosition(parsePitch('C4'), 'alto')).toBe(4);
    expect(pitchPosition(parsePitch('C4'), 'tenor')).toBe(6);
    expect(pitchPosition(parsePitch('G#4'), 'treble')).toBe(pitchPosition(parsePitch('G4'), 'treble'));
    expect(pitchPosition(parsePitch('C-1'), 'treble')).toBe(-37);
    expect(validateClef(' Alto ')).toBe('alto');
    expect(() => validateClef('percussion')).toThrow();
  });

  it('validates standard major/minor keys and supplies their diatonic alterations', () => {
    expect(validateKey('B♭')).toBe('Bb');
    expect(validateKey('f# minor')).toBe('F#m');
    expect(validateKey('C major')).toBe('C');
    expect(keyAlterations('G')).toEqual({ C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0 });
    expect(keyAlterations('Bbm')).toEqual({ C: 0, D: -1, E: -1, F: 0, G: -1, A: -1, B: -1 });
    expect(Object.values(keyAlterations('Cb'))).toEqual(Array(7).fill(-1));
    expect(Object.values(keyAlterations('A#m'))).toEqual(Array(7).fill(1));
    expect(() => validateKey('D#')).toThrow(/seven/);
    expect(() => validateKey('C dorian')).toThrow();
    expect(() => validateKey('nonsense')).toThrow();
  });
});

describe('simple, compound, and irregular meter', () => {
  it('uses conventional compound groups and readable simple-meter beam groups', () => {
    expect(parseMeter().groups).toEqual([1, 1, 1, 1]);
    expect(parseMeter(3, 4).groups).toEqual([1, 1, 1]);
    expect(parseMeter(2, 8).groups).toEqual([2]);
    expect(parseMeter(3, 8).groups).toEqual([3]);
    expect(parseMeter(4, 8).groups).toEqual([2, 2]);
    expect(parseMeter(6, 4).groups).toEqual([3, 3]);
    expect(parseMeter(15, 8).groups).toEqual([3, 3, 3, 3, 3]);
    expect(parseMeter(12, 16).groups).toEqual([3, 3, 3, 3]);
  });

  it('distinguishes printed additive signatures from explicit hidden beat groups', () => {
    expect(parseMeter('2+2+3', 8)).toEqual({ numerator: 7, denominator: 8, groups: [2, 2, 3], explicitGroups: true, display: '2+2+3/8' });
    expect(parseMeter(7, 8, '3+2+2')).toEqual({ numerator: 7, denominator: 8, groups: [3, 2, 2], explicitGroups: true, display: '7/8' });
    expect(parseMeter('7', '8', '2 2 3').groups).toEqual([2, 2, 3]);
    expect(parseMeter(7, 8, '2,2,3').groups).toEqual([2, 2, 3]);
    expect(meterTime(parseMeter(5, 4, [3, 2]))).toEqual(rational(5, 4));
    expect(meterBoundaries(parseMeter('2+2+3', 8))).toEqual([rational(1, 4), rational(1, 2), rational(7, 8)]);
  });

  it('rejects malformed signatures, nonbinary denominators, and inconsistent groups', () => {
    for (const top of [0, -1, 4.5, 129, '3junk', '3.0', '2++3', '2+0+3', '']) expect(() => parseMeter(top)).toThrow();
    for (const bottom of [0, -8, 3, 6, 256, '8x']) expect(() => parseMeter(4, bottom)).toThrow();
    for (const groups of [[], [0, 7], [3, 3], [3.5, 3.5], '2,,2,3', '2+2+']) expect(() => parseMeter(7, 8, groups)).toThrow();
    expect(() => parseMeter('2+2+3', 8, [3, 2, 2])).toThrow(/conflicts/);
  });

  it('warns when irregular beat intent has not been declared', () => {
    for (const meter of [parseMeter(7, 8), parseMeter(5, 4)]) {
      const bar = measure([voice([event('whole', { time: meterTime(meter), kind: 'rest', measureRest: true })])], { meter });
      expect(validateScore(score([bar])).filter(value => value.code === 'ambiguous-meter-grouping')).toHaveLength(1);
      expect(errors(score([bar]))).toEqual([]);
    }
    const meter = parseMeter(15, 8);
    const bar = measure([voice([event('whole', { kind: 'rest', measureRest: true, time: meterTime(meter) })])], { meter });
    expect(validateScore(score([bar]))).toEqual([]);
  });
});

describe('score invariants', () => {
  it('accepts complete voices and remains serializable and unchanged', () => {
    const value = score([measure([voice([event(), event(), event(), event()])])]);
    const before = JSON.stringify(value);
    expect(validateScore(value)).toEqual([]);
    expect(validateScore(JSON.parse(before) as Score)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('reports exact underfill and never lets pickup/incomplete hide overfill', () => {
    expect(errors(score([measure([voice([event()])])]))).toContain('measure-underfull');
    expect(errors(score([measure([voice([event()])], { pickup: true })]))).toEqual([]);
    const draft = validateScore(score([measure([voice([event()])], { incomplete: true })]));
    expect(draft).toEqual([expect.objectContaining({ code: 'incomplete-measure', severity: 'warning' })]);
    for (const extra of [{}, { pickup: true }, { incomplete: true }]) {
      expect(errors(score([measure([voice([event('whole'), event()])], extra)]))).toContain('measure-overfull');
    }
  });

  it('requires sequential onsets and matching written/effective durations', () => {
    const written = voice([event('whole')]);
    const noncontiguous = { ...written, events: [{ ...written.events[0], onset: rational(1, 4) }] };
    expect(errors(score([measure([noncontiguous])]))).toContain('noncontiguous-voice');
    expect(errors(score([measure([voice([event('half', { time: rational(1) })])])]))).toContain('incorrect-event-time');
  });

  it('uses full measure rests independently of their whole-rest glyph', () => {
    const meter = parseMeter(7, 8, [2, 2, 3]);
    const wholeRest = event('whole', { kind: 'rest', measureRest: true, time: rational(7, 8) });
    expect(errors(score([measure([voice([wholeRest])], { meter })]))).toEqual([]);
    expect(errors(score([measure([voice([{ ...wholeRest, time: rational(1) }])], { meter })]))).toContain('incorrect-event-time');
    expect(errors(score([measure([voice([wholeRest, event('eighth')])])]))).toContain('invalid-measure-rest');
  });

  it('requires every pickup voice and aligned staff to have the same duration', () => {
    const pickup = measure([voice([event()])], { pickup: true });
    expect(errors(score([pickup], [staff([measure([voice([event()])], { pickup: true })])]))).toEqual([]);
    expect(errors(score([pickup], [staff([measure([voice([event('half')])], { pickup: true })])]))).toContain('staff-pickup-duration-mismatch');
    expect(errors(score([pickup], [staff([measure()])]))).toContain('staff-pickup-mismatch');
    expect(errors(score([measure([voice([event()]), voice([event('half')])], { pickup: true })]))).toContain('pickup-voice-mismatch');
  });

  it('rejects missing measures, polymeter, and conflicting beat groups', () => {
    expect(errors(score([measure(), measure()], [staff([measure()])]))).toContain('staff-measure-count');
    const three = measure([voice([event('half', { dots: 1 })])], { meter: parseMeter(3, 4) });
    expect(errors(score([measure()], [staff([three])]))).toContain('staff-meter-mismatch');
    const odd = (groups: number[]): Measure => measure([voice(Array.from({ length: 7 }, () => event('eighth')))], { meter: parseMeter(7, 8, groups) });
    expect(errors(score([odd([2, 2, 3])], [staff([odd([3, 2, 2])])]))).toContain('staff-meter-mismatch');
  });

  it('validates IDs, event shapes, and malformed external JSON without throwing', () => {
    const duplicate = event('half');
    expect(errors(score([measure([voice([duplicate, duplicate])])]))).toContain('duplicate-id');
    expect(errors(score([measure([voice([event('whole', { kind: 'rest', pitches: [parsePitch('C4')] })])])]))).toContain('invalid-event-pitches');
    expect(errors(score([measure([voice([event('whole', { kind: 'chord', pitches: [parsePitch('C4'), parsePitch('C4')] })])])]))).toContain('duplicate-chord-pitch');
    for (const invalid of [null, {}, { id: 'score', staves: [null] }, { id: 'score', staves: [{ id: 'staff', measures: [null] }] }]) {
      expect(() => validateScore(invalid as unknown as Score)).not.toThrow();
      expect(validateScore(invalid as unknown as Score).some(value => value.severity === 'error')).toBe(true);
    }
  });

  it('rejects model spellings that would change at serialization/rendering boundaries', () => {
    expect(errors(score([measure([], { key: 'C major' })]))).toContain('invalid-key');
    expect(errors(score([measure([], { clef: 'Treble' as 'treble' })]))).toContain('invalid-clef');
    expect(errors(score([measure([], { meter: { ...parseMeter(), display: '04/4' } })]))).toContain('invalid-meter');
    expect(errors(score([measure([], { meter: { ...parseMeter(7, 8, [2, 2, 3]), groups: [2, '2', 3] as number[] } })]))).toContain('invalid-meter');
    expect(errors(score([measure([], { id: 'invalid id' })]))).toContain('invalid-id');
    expect(errors(score([measure([voice([event('whole', { rhythmic: true })])])]))).toContain('invalid-rhythmic-flag');
    expect(errors(score([measure([voice([event('whole', { dots: undefined as unknown as number })])])]))).toContain('invalid-duration');
  });

  it('checks text, exact annotation onsets, and metronome beat values', () => {
    const bar = measure([], {
      voices: [voice([event('whole')])],
      annotations: [{ id: id('tempo'), kind: 'tempo', onset: rational(0), text: '', placement: 'above', bpm: 132, beat: 'quarter', dots: 1 }],
    });
    expect(errors(score([bar]))).toEqual([]);
    const badTempo = { ...bar, annotations: [{ ...bar.annotations[0], bpm: Infinity }] };
    expect(errors(score([badTempo]))).toContain('invalid-tempo');
    const outside = { ...bar, annotations: [{ ...bar.annotations[0], onset: rational(5, 4) }] };
    expect(errors(score([outside]))).toContain('annotation-outside-measure');
    const atEnd = { ...bar, annotations: [{ ...bar.annotations[0], onset: rational(1) }] };
    expect(errors(score([atEnd]))).toEqual([]);
  });

  it('diagnoses malformed nested JSON instead of throwing while traversing it', () => {
    const group = tuplet([event('eighth'), event('eighth'), event('eighth')], 3, 2);
    const source = score([measure([voice([...group.events, event('half', { dots: 1 })], [group.tuplet])], {
      annotations: [{ id: id('annotation'), kind: 'tempo', onset: rational(0), text: 'Swing', placement: 'above', bpm: 144, beat: 'quarter', dots: 0 }],
    })]);
    const paths: string[][] = [];
    const collect = (value: unknown, prefix: string[]): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const path = [...prefix, key];
        paths.push(path);
        collect(child, path);
      }
    };
    collect(source, []);
    for (const path of paths) {
      for (const replacement of [undefined, null, {}, [], false, 3.5, 'not-valid']) {
        const candidate = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
        let parent = candidate;
        for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
        parent[path[path.length - 1]] = replacement;
        expect(() => validateScore(candidate as unknown as Score), `replacing ${path.join('.')}`).not.toThrow();
      }
    }
  });
});

describe('tuplets count written units, not child elements', () => {
  it('accepts mixed note lengths, rests, and quintuplets with fewer than five events', () => {
    const group = tuplet([event('quarter'), event('eighth'), event('eighth', { kind: 'rest' }), event('eighth')], 5, 4);
    const bar = measure([voice([...group.events, event('half')], [group.tuplet])]);
    expect(errors(score([bar]))).toEqual([]);
    expect(group.events.map(value => value.time)).toEqual([rational(1, 5), rational(1, 10), rational(1, 10), rational(1, 10)]);
    const triplet = tuplet([event('quarter'), event('eighth')], 3, 2);
    expect(errors(score([measure([voice([...triplet.events, event('half', { dots: 1 })], [triplet.tuplet])])]))).toEqual([]);
  });

  it('accepts nested tuplets using inner elapsed time to validate outer units', () => {
    const inner = tuplet([event('sixteenth'), event('sixteenth', { kind: 'rest' }), event('sixteenth')], 3, 2);
    const outer = tuplet([event('quarter'), ...inner.events], 3, 2);
    const bar = measure([voice([...outer.events, event('half', { dots: 1 })], [outer.tuplet, inner.tuplet])]);
    expect(errors(score([bar]))).toEqual([]);
    expect(outer.events.map(value => value.time)).toEqual([rational(1, 6), rational(1, 36), rational(1, 36), rational(1, 36)]);
  });

  it('supports dotted base units and a tuplet represented by one dotted event', () => {
    const dotted = tuplet([event('eighth', { dots: 1 }), event('eighth', { dots: 1 })], 2, 3);
    expect(errors(score([measure([voice(dotted.events, [dotted.tuplet])], { pickup: true })]))).toEqual([]);
    const single = tuplet([event('quarter', { dots: 1 })], 3, 2);
    expect(errors(score([measure([voice([...single.events, event('half', { dots: 1 })], [single.tuplet])])]))).toEqual([]);
  });

  it('rejects incomplete spans but permits them as explicit draft warnings', () => {
    const group = tuplet([event('eighth'), event('eighth')], 3, 2);
    const bar = measure([voice(group.events, [group.tuplet])], { pickup: true });
    expect(errors(score([bar]))).toContain('tuplet-span');
    const diagnostics = validateScore(score([{ ...bar, incomplete: true }]));
    expect(diagnostics.find(value => value.code === 'tuplet-span')?.severity).toBe('warning');
  });

  it('rejects crossing groups, inconsistent membership, and invalid ratios', () => {
    const a = id('tuplet');
    const b = id('tuplet');
    const notes = [event('eighth', { tupletIds: [a] }), event('eighth', { tupletIds: [a, b] }), event('eighth', { tupletIds: [b] })];
    const groups: Tuplet[] = [
      { id: a, actual: 2, normal: 2, eventIds: notes.slice(0, 2).map(value => value.id), bracket: 'auto', showRatio: false },
      { id: b, actual: 2, normal: 2, eventIds: notes.slice(1).map(value => value.id), bracket: 'auto', showRatio: false },
    ];
    expect(errors(score([measure([voice(notes, groups)], { pickup: true })]))).toContain('crossing-tuplets');
    const group = tuplet([event('eighth'), event('eighth'), event('eighth')], 3, 2);
    const missing = [{ ...group.events[0], tupletIds: [] }, ...group.events.slice(1)];
    expect(errors(score([measure([voice(missing, [group.tuplet])], { pickup: true })]))).toContain('invalid-tuplet-reference');
    expect(errors(score([measure([voice(group.events, [{ ...group.tuplet, actual: 65 }])], { pickup: true })]))).toContain('invalid-tuplet-ratio');
  });

  it('reports deep exact-time overflow as a diagnostic instead of crashing', () => {
    const ids = Array.from({ length: 10 }, () => id('tuplet'));
    const note = event('whole', { tupletIds: ids });
    const groups: Tuplet[] = ids.map(value => ({ id: value, actual: 64, normal: 1, eventIds: [note.id], bracket: 'auto', showRatio: true }));
    const value = score([measure([voice([note], groups)])]);
    expect(() => validateScore(value)).not.toThrow();
    expect(errors(value)).toContain('time-overflow');
  });
});

describe('explicit beams and ties', () => {
  it('allows short interior rests and implicit continuations inside an explicit beam', () => {
    const bar = measure([voice([event('eighth', { beam: 'start' }), event('sixteenth', { kind: 'rest' }), event('sixteenth', { beam: 'end' })])], { pickup: true });
    expect(errors(score([bar]))).toEqual([]);
    const slash = measure([voice([event('eighth', { kind: 'slash', beam: 'start' }), event('eighth', { kind: 'slash', beam: 'end' })])], { pickup: true });
    expect(errors(score([slash]))).toEqual([]);
  });

  it('rejects open beams, long notes, invalid anchors, exclusions, and conflicting stems', () => {
    const run = (events: MusicEvent[]): string[] => errors(score([measure([voice(events)], { pickup: true })]));
    expect(run([event('eighth', { beam: 'start' })])).toContain('unclosed-beam');
    expect(run([event('eighth', { beam: 'end' })])).toContain('orphan-beam');
    expect(run([event('eighth', { beam: 'start' }), event('quarter', { beam: 'end' })])).toContain('invalid-beam-member');
    expect(run([event('eighth', { kind: 'rest', beam: 'start' }), event('eighth', { beam: 'end' })])).toContain('invalid-beam-anchors');
    expect(run([event('eighth', { beam: 'start' }), event('eighth', { beam: 'none' }), event('eighth', { beam: 'end' })])).toContain('invalid-beam-member');
    expect(run([event('eighth', { beam: 'start', stem: 'up' }), event('eighth', { beam: 'end', stem: 'down' })])).toContain('beam-stem-conflict');
    expect(run([event('eighth', { kind: 'slash', rhythmic: false, beam: 'start' }), event('eighth', { beam: 'end' })])).toContain('invalid-beam-member');
  });

  it('connects identical spelled pitches across measures and key changes', () => {
    const bars = [
      measure([voice([event('whole', { pitches: [parsePitch('F#4')], tie: 'start' })])], { key: 'G' }),
      measure([voice([event('whole', { pitches: [parsePitch('F#4')], tie: 'continue' })])], { key: 'C' }),
      measure([voice([event('whole', { pitches: [parsePitch('F#4')], tie: 'end' })])]),
    ];
    expect(errors(score(bars))).toEqual([]);
    const chord = (pitches: string[], tie: MusicEvent['tie']): MusicEvent => event('whole', { kind: 'chord', pitches: pitches.map(value => parsePitch(value)), tie });
    expect(errors(score([measure([voice([chord(['C4', 'E4', 'G4'], 'start')])]), measure([voice([chord(['G4', 'C4', 'E4'], 'end')])])]))).toEqual([]);
  });

  it('rejects enharmonic substitutions, orphan markers, dangling ties, and intervening rests', () => {
    const start = measure([voice([event('whole', { pitches: [parsePitch('F#4')], tie: 'start' })])]);
    const end = measure([voice([event('whole', { pitches: [parsePitch('Gb4')], tie: 'end' })])]);
    expect(errors(score([start, end]))).toContain('tie-pitch-mismatch');
    expect(errors(score([start]))).toContain('unclosed-tie');
    expect(errors(score([end]))).toContain('orphan-tie');
    expect(errors(score([start, measure([voice([event('whole', { kind: 'rest' })])])]))).toContain('unclosed-tie');
    expect(errors(score([measure([voice([event('whole', { kind: 'slash', tie: 'start' })])])]))).toContain('invalid-tie');
  });
});
