// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { add, durationTime, parseMeter, parsePitch, pitchText, rational, toNumber } from '../src/model/index.js';
import type { Clef, Duration, Measure, MusicEvent, Rational, Score, Staff, Voice } from '../src/model/types.js';
import type { EventGeometry, InsertionAnchor, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import { findMeasureLane, insertionTarget, pitchAtStaffY, staffPitchY } from '../src/authoring/pointer-targets.js';

const lines = { topLine: 40, bottomLine: 80 };
function event(id: string, onset: Rational, duration: Duration = 'quarter', extra: Partial<MusicEvent> = {}): MusicEvent {
  return { id, kind: 'note', pitches: [parsePitch('C4')], duration, dots: 0, onset, time: durationTime(duration),
    tupletIds: [], beam: 'auto', stem: 'auto', tie: 'none', measureRest: false, rhythmic: false, ...extra };
}
function voice(id = 'canonical-implicit-voice', events = [event('a', rational(0), 'half'), event('b', rational(1, 2), 'half')]): Voice {
  return { id, events, tuplets: [] };
}
function measure(id = 'm1', voices: readonly Voice[] = [voice()], clef: Clef = 'treble'): Measure {
  return { id, number: id, clef, key: 'C', meter: parseMeter(), voices, annotations: [],
    breakBefore: 'auto', keepWithNext: false, endBar: 'single', repeatStart: false, pickup: false, incomplete: false };
}
function score(staves: readonly Staff[] = [{ id: 'staff', label: 'Staff', clef: 'treble', key: 'C', measures: [measure()] }]): Score {
  return { id: 'score', label: 'Fixture', bracket: 'none', staves };
}

/** Synthetic final geometry, deliberately independent of the DOM and VexFlow. */
function geometry(value: Score): SystemGeometry {
  const measures: MeasureGeometry[] = [];
  const events: EventGeometry[] = [];
  const anchors: InsertionAnchor[] = [];
  value.staves.forEach((staff, staffIndex) => {
    staff.measures.forEach((bar, measureIndex) => {
      const topLine = 40 + staffIndex * 140;
      const bottomLine = topLine + (staff.notation === 'rhythm' ? 0 : 40);
      const left = measureIndex * 360;
      const lane: MeasureGeometry = { sourceId: bar.id, system: 0, staffId: staff.id, measureIndex,
        x: left + 30, y: topLine - 15, width: 300, height: 70,
        topLine, bottomLine, notation: staff.notation ?? 'pitched', staffSpace: 10, noteStartX: left + 80, noteEndX: left + 310 };
      measures.push(lane);
      bar.voices.forEach((partVoice, voiceIndex) => {
        // Actual projections can have a different generated implicit voice ID.
        const projectedVoiceId = `projection-voice-${staffIndex}-${measureIndex}-${voiceIndex}`;
        const onsetX = (onset: Rational) => left + 100 + 180 * toNumber(onset);
        partVoice.events.forEach((item, eventIndex) => {
          const x = item.measureRest ? left + 195 : onsetX(item.onset);
          const ink = { x: x - 5, y: topLine + 15, width: 10, height: 30 };
          events.push({ sourceId: item.id, system: 0, ...ink, staffId: staff.id, measureId: bar.id,
            voiceId: projectedVoiceId, eventIndex, anchorX: x, anchorY: topLine + 20,
            onset: item.onset, ink, sharedSourceIds: [item.id] });
        });
        for (let eventIndex = 0; eventIndex <= partVoice.events.length; eventIndex++) {
          const before = partVoice.events[eventIndex]; const after = partVoice.events[eventIndex - 1];
          const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
          anchors.push({ sourceId: projectedVoiceId, system: 0, staffId: staff.id, measureId: bar.id,
            voiceId: projectedVoiceId, eventIndex, ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}),
            onset, x: onsetX(onset), y: topLine, height: bottomLine - topLine });
        }
      });
    });
  });
  return { index: 0, start: 0, end: value.staves[0].measures.length, width: 800, height: 400,
    viewBox: { x: 0, y: 0, width: 800, height: 400 }, ink: { x: 30, y: 25, width: 600, height: 250 },
    pageBreak: false, staves: [], measures, events, anchors, annotations: [], tuplets: [] };
}

function nestedScore(): Score {
  let onset = rational(0);
  const events: MusicEvent[] = [];
  const append = (id: string, duration: Duration, time: Rational, tupletIds: string[]) => {
    events.push(event(id, onset, duration, { time, tupletIds })); onset = add(onset, time);
  };
  append('outer-first', 'eighth', rational(1, 12), ['outer']);
  for (let index = 0; index < 5; index++) append(`inner-${index}`, 'thirty-second', rational(1, 60), ['outer', 'inner']);
  append('outer-last', 'eighth', rational(1, 12), ['outer']);
  events.push(event('outside', onset, 'half', { dots: 1, time: rational(3, 4) }));
  const partVoice: Voice = { id: 'canonical-tuplet-voice', events, tuplets: [
    { id: 'outer', actual: 3, normal: 2, eventIds: events.slice(0, 7).map(item => item.id), bracket: 'auto', showRatio: false },
    { id: 'inner', actual: 5, normal: 4, eventIds: events.slice(1, 6).map(item => item.id), bracket: 'yes', showRatio: true },
  ] };
  return score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure('nested', [partVoice])] }]);
}

describe('pitch mapping from actual staff lines', () => {
  it.each(['rhythm', 'three-roads'] as const)('rejects direct pitch mapping for %s even with a full staff span', notation => {
    const geometry = { ...lines, notation };
    expect(() => pitchAtStaffY(60, { clef: 'treble' }, geometry, parsePitch('C4'))).toThrow('no fixed pitches');
    expect(() => staffPitchY(parsePitch('C4'), 'treble', geometry)).toThrow('no fixed pitches');
  });

  it('preserves direct pitch mapping when the geometry explicitly declares pitched notation', () => {
    const geometry = { ...lines, notation: 'pitched' as const };
    expect(pitchText(pitchAtStaffY(80, { clef: 'treble' }, geometry, parsePitch('C4')))).toBe('E4');
    expect(staffPitchY(parsePitch('E4'), 'treble', geometry)).toBe(80);
  });

  for (const [clef, spellings] of Object.entries({
    treble: ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'],
    bass: ['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'],
    alto: ['F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4'],
    tenor: ['D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4'],
  }) as [Clef, string[]][]) {
    it(`round-trips every line and space in ${clef} clef`, () => {
      spellings.forEach((spelling, position) => {
        const y = 80 - position * 5;
        const pitch = pitchAtStaffY(y, { clef }, lines, parsePitch('C4'));
        expect(pitchText(pitch)).toBe(spelling);
        expect(staffPitchY(pitch, clef, lines)).toBe(y);
      });
    });
  }

  it('uses a changed measure clef instead of the staff initial clef', () => {
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure(), measure('m2', [voice()], 'bass')] }]);
    expect(pitchText(pitchAtStaffY(80, value.staves[0].measures[0], lines, parsePitch('C4')))).toBe('E4');
    expect(pitchText(pitchAtStaffY(80, value.staves[0].measures[1], lines, parsePitch('C4')))).toBe('G2');
  });

  it('keeps explicit accidentals/display policy and snaps to the nearest diatonic step', () => {
    const sharp = parsePitch('F#4', undefined, 'courtesy');
    const flat = parsePitch('Bbb4', undefined, 'always');
    expect(pitchAtStaffY(69, { clef: 'treble' }, lines, sharp)).toEqual(parsePitch('G#4', undefined, 'courtesy'));
    expect(pitchAtStaffY(69, { clef: 'treble' }, lines, flat)).toEqual(parsePitch('Gbb4', undefined, 'always'));
    expect(pitchText(pitchAtStaffY(72.5, { clef: 'treble' }, lines, parsePitch('C4')))).toBe('G4');
    expect(sharp).toEqual(parsePitch('F#4', undefined, 'courtesy'));
  });

  it('maps ledger positions and transformed staff spacing without changing spelling semantics', () => {
    expect(staffPitchY(parsePitch('C4'), 'treble', lines)).toBe(90);
    expect(staffPitchY(parsePitch('A5'), 'treble', lines)).toBe(30);
    const expanded = { topLine: 120, bottomLine: 200 };
    expect(pitchText(pitchAtStaffY(220, { clef: 'treble' }, expanded, parsePitch('C4')))).toBe('C4');
    expect(staffPitchY(parsePitch('C4'), 'treble', expanded)).toBe(220);
    expect(staffPitchY(parsePitch('F#4'), 'treble', lines)).toBe(staffPitchY(parsePitch('F4'), 'treble', lines));
  });

  it('accepts the full supported octave range and rejects beyond it without clamping', () => {
    for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const) {
      for (const spelling of ['C-1', 'B9']) {
        const pitch = parsePitch(spelling);
        expect(pitchText(pitchAtStaffY(staffPitchY(pitch, clef, lines), { clef }, lines, parsePitch('C4')))).toBe(spelling);
      }
      expect(() => pitchAtStaffY(staffPitchY(parsePitch('C-1'), clef, lines) + 5, { clef }, lines, parsePitch('C4'))).toThrow('outside');
      expect(() => pitchAtStaffY(staffPitchY(parsePitch('B9'), clef, lines) - 5, { clef }, lines, parsePitch('C4'))).toThrow('outside');
    }
  });

  it('rejects unmeasurable staff lines, invalid spelling, and nonfinite pointer positions', () => {
    for (const invalid of [{ topLine: 80, bottomLine: 40 }, { topLine: 40, bottomLine: 40 }, { topLine: NaN, bottomLine: 80 }]) {
      expect(() => pitchAtStaffY(60, { clef: 'treble' }, invalid, parsePitch('C4'))).toThrow();
      expect(() => staffPitchY(parsePitch('C4'), 'treble', invalid)).toThrow();
    }
    expect(() => pitchAtStaffY(Infinity, { clef: 'treble' }, lines, parsePitch('C4'))).toThrow('finite');
    expect(() => pitchAtStaffY(60, { clef: 'treble' }, lines, { ...parsePitch('C4'), alter: 3 })).toThrow();
  });
});

describe('bounded staff writing lanes', () => {
  it('excludes headers and positions beyond the note interval while admitting its edges', () => {
    const system = geometry(score());
    expect(findMeasureLane(system, 79, 60)).toBeUndefined();
    expect(findMeasureLane(system, 80, 60)).toBe(system.measures[0]);
    expect(findMeasureLane(system, 310, 60)).toBe(system.measures[0]);
    expect(findMeasureLane(system, 311, 60)).toBeUndefined();
  });

  it('admits bounded ledger space but ignores large annotation ink outside it', () => {
    const system = geometry(score());
    expect(findMeasureLane(system, 120, 0)).toBe(system.measures[0]);
    expect(findMeasureLane(system, 120, 120)).toBe(system.measures[0]);
    expect(findMeasureLane(system, 120, -1)).toBeUndefined();
    expect(findMeasureLane(system, 120, 121)).toBeUndefined();
    expect(findMeasureLane({ ...system, measures: [{ ...system.measures[0], y: -1000, height: 2000 }] }, 120, -100)).toBeUndefined();
  });

  it('prefers an actual staff band but refuses overlapping ledger-only lanes', () => {
    const system = geometry(score());
    const lower = { ...system.measures[0], sourceId: 'lower-measure', staffId: 'lower', topLine: 120, bottomLine: 160 };
    const pair = { ...system, measures: [...system.measures, lower] };
    expect(findMeasureLane(pair, 120, 80)).toBe(system.measures[0]);
    expect(findMeasureLane(pair, 120, 120)).toBe(lower);
    expect(findMeasureLane(pair, 120, 100)).toBeUndefined();
    const overlapping = { ...lower, topLine: 70, bottomLine: 110 };
    expect(findMeasureLane({ ...system, measures: [...system.measures, overlapping] }, 120, 75)).toBeUndefined();
  });

  it('does not guess at an ambiguous horizontal boundary, stale system, or nonfinite point', () => {
    const system = geometry(score());
    const next = { ...system.measures[0], sourceId: 'm2', measureIndex: 1, noteStartX: 310, noteEndX: 500 };
    expect(findMeasureLane({ ...system, end: 2, measures: [...system.measures, next] }, 310, 60)).toBeUndefined();
    expect(findMeasureLane({ ...system, index: 1 }, 120, 60)).toBeUndefined();
    expect(findMeasureLane(system, NaN, 60)).toBeUndefined();
    expect(findMeasureLane(system, 120, Infinity)).toBeUndefined();
  });
});

describe('exact insertion targets', () => {
  it('uses existing nonuniform anchors and their exact musical times, not proportional pixels', () => {
    const value = score(); const original = geometry(value);
    const system = { ...original, anchors: original.anchors.map(anchor => ({ ...anchor, x: [100, 250, 280][anchor.eventIndex] })) };
    const target = insertionTarget({ system, score: value, x: 230, y: 60, voiceIndex: 0, position: 'before' });
    expect(target).toMatchObject({ anchorX: 250, onset: rational(1, 2), position: 'before', scopeLabel: 'voice', starterRest: false });
    expect(target?.cursor).toEqual({ staffId: 'staff', measureId: 'm1', voiceIndex: 0, eventId: 'b' });
    expect(target?.voice.id).toBe('canonical-implicit-voice');
    expect(system.anchors[1].voiceId).not.toBe(target?.voice.id);
  });

  it('selects only the active voice and never falls back when it is unavailable', () => {
    const second = voice('canonical-second', [event('c', rational(0), 'quarter'), event('d', rational(1, 4), 'half', { dots: 1, time: rational(3, 4) })]);
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure('m1', [voice(), second])] }]);
    const system = geometry(value);
    const target = insertionTarget({ system, score: value, x: 145, y: 60, voiceIndex: 1, position: 'before' });
    expect(target?.cursor.eventId).toBe('d');
    expect(target?.onset).toEqual(rational(1, 4));
    for (const voiceIndex of [-1, 2, 0.5, NaN]) expect(insertionTarget({ system, score: value, x: 145, y: 60, voiceIndex, position: 'before' })).toBeUndefined();
    const missing = { ...system, anchors: system.anchors.filter(anchor => anchor.beforeId !== 'c' && anchor.beforeId !== 'd' && anchor.afterId !== 'd') };
    expect(insertionTarget({ system: missing, score: value, x: 145, y: 60, voiceIndex: 1, position: 'before' })).toBeUndefined();
  });

  it('explicitly replaces a lone full-measure rest for all requested positions', () => {
    const rest = event('rest', rational(0), 'whole', { kind: 'rest', pitches: [], measureRest: true });
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure('m1', [voice('silent', [rest])])] }]);
    const system = geometry(value);
    for (const position of ['before', 'after', 'replace'] as const) {
      const target = insertionTarget({ system, score: value, x: 110, y: 60, voiceIndex: 0, position });
      expect(target).toMatchObject({ position: 'replace', starterRest: true, anchorX: 195, onset: rational(0), scopeLabel: 'voice' });
      expect(target?.cursor.eventId).toBe('rest');
    }
  });

  it('does not treat an ordinary whole rest as a replaceable starter', () => {
    const rest = event('rest', rational(0), 'whole', { kind: 'rest', pitches: [] });
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure('m1', [voice('ordinary-rest', [rest])])] }]);
    const system = geometry(value);
    expect(insertionTarget({ system, score: value, x: 280, y: 60, voiceIndex: 0, position: 'after' })).toMatchObject({ position: 'after', starterRest: false, onset: rational(1) });
    expect(insertionTarget({ system, score: value, x: 100, y: 60, voiceIndex: 0, position: 'replace' })).toMatchObject({ position: 'replace', starterRest: false });
  });

  it('resolves replacement by actual event anchors, not the larger ink box or voice ID', () => {
    const value = score(); const original = geometry(value);
    const system = { ...original, events: original.events.map(item => ({ ...item, x: 90, width: 220,
      anchorX: item.sourceId === 'a' ? 120 : 270 })) };
    const target = insertionTarget({ system, score: value, x: 250, y: 60, voiceIndex: 0, position: 'replace' });
    expect(target?.cursor.eventId).toBe('b');
    expect(target?.anchorX).toBe(270);
    expect(target?.onset).toEqual(rational(1, 2));
  });

  it('keeps separate source choices when two voices share one printed rest', () => {
    const rest = (id: string) => event(id, rational(0), 'whole', { kind: 'rest', pitches: [], measureRest: true });
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C', measures: [measure('m1', [voice('one', [rest('r1')]), voice('two', [rest('r2')])])] }]);
    const original = geometry(value);
    const system = { ...original, events: original.events.map(item => ({ ...item, sharedSourceIds: ['r1', 'r2'] })) };
    expect(insertionTarget({ system, score: value, x: 195, y: 60, voiceIndex: 1, position: 'replace' })?.cursor.eventId).toBe('r2');
  });

  it('preserves both sides of a nested tuplet exit without changing the reference scope', () => {
    const value = nestedScore(); const system = geometry(value);
    const boundary = system.anchors.find(anchor => anchor.beforeId === 'outer-last')!;
    const base = { system, score: value, x: boundary.x, y: 60, voiceIndex: 0 };
    const before = insertionTarget({ ...base, position: 'before' });
    const after = insertionTarget({ ...base, position: 'after' });
    expect(before?.cursor.eventId).toBe('outer-last');
    expect(before?.scopeLabel).toBe('tuplet 3:2');
    expect(after?.cursor.eventId).toBe('inner-4');
    expect(after?.scopeLabel).toBe('tuplets 3:2 → 5:4');
    expect(before?.onset).toEqual(rational(1, 6));
    expect(after?.onset).toEqual(before?.onset);
  });

  it('preserves both sides of a nested tuplet entrance and outer-wrapper exit', () => {
    const value = nestedScore(); const system = geometry(value);
    for (const [beforeId, afterId, beforeScope, afterScope, onset] of [
      ['inner-0', 'outer-first', 'tuplets 3:2 → 5:4', 'tuplet 3:2', rational(1, 12)],
      ['outside', 'outer-last', 'voice', 'tuplet 3:2', rational(1, 4)],
    ] as const) {
      const boundary = system.anchors.find(anchor => anchor.beforeId === beforeId)!;
      const base = { system, score: value, x: boundary.x, y: 60, voiceIndex: 0 };
      expect(insertionTarget({ ...base, position: 'before' })).toMatchObject({ cursor: { eventId: beforeId }, scopeLabel: beforeScope, onset });
      expect(insertionTarget({ ...base, position: 'after' })).toMatchObject({ cursor: { eventId: afterId }, scopeLabel: afterScope, onset });
    }
  });

  it('refuses a missing side at the closest edge instead of skipping to a distant eligible anchor', () => {
    const value = score(); const system = geometry(value);
    const before = insertionTarget({ system, score: value, x: 310, y: 60, voiceIndex: 0, position: 'before' });
    expect(before).toBeUndefined();
    const after = insertionTarget({ system, score: value, x: 80, y: 60, voiceIndex: 0, position: 'after' });
    expect(after).toBeUndefined();
    expect(insertionTarget({ system: { ...system, anchors: system.anchors.filter(anchor => !anchor.beforeId) }, score: value, x: 280, y: 60, voiceIndex: 0, position: 'before' })).toBeUndefined();
  });

  it('refuses stale event order/onsets and stale measure identity instead of guessing', () => {
    const value = score(); const original = geometry(value);
    const stale = { ...original, anchors: original.anchors.map(anchor => ({ ...anchor, onset: rational(9) })),
      events: original.events.map(item => ({ ...item, eventIndex: 9 })) };
    for (const position of ['before', 'after', 'replace'] as const) expect(insertionTarget({ system: stale, score: value, x: 190, y: 60, voiceIndex: 0, position })).toBeUndefined();
    expect(insertionTarget({ system: { ...original, measures: [{ ...original.measures[0], sourceId: 'gone' }] }, score: value, x: 190, y: 60, voiceIndex: 0, position: 'before' })).toBeUndefined();
  });

  it('is deterministic without mutating the score, geometry, or time fractions', () => {
    const value = nestedScore(); const system = geometry(value);
    const before = JSON.stringify({ value, system });
    const options = { system, score: value, x: 130, y: 60, voiceIndex: 0, position: 'before' as const };
    const first = insertionTarget(options);
    expect(insertionTarget(options)).toEqual(first);
    expect(first?.staff).toBe(value.staves[0]);
    expect(first?.geometry).toBe(system.measures[0]);
    expect(JSON.stringify({ value, system })).toBe(before);
    expect(insertionTarget({ ...options, x: 70 })).toBeUndefined();
  });
});

describe('existing empty-voice insertion anchors', () => {
  function empty(voices = [voice('empty', [])]) {
    const value = score([{ id: 'staff', label: '', clef: 'treble', key: 'C',
      measures: [{ ...measure('m1', voices), incomplete: true }] }]);
    const system = geometry(value);
    const projectedVoiceIds = new Map(voices.map((item, index) => [item.id, `projection-voice-0-0-${index}`]));
    return { system, score: value, x: 190, y: 60, voiceIndex: 0, position: 'after' as const, projectedVoiceIds };
  }

  it.each(['before', 'after'] as const)('uses the published zero anchor for %s without inventing a reference event or rest', position => {
    const options = { ...empty(), position }; const original = JSON.stringify({ score: options.score, system: options.system });
    const target = insertionTarget(options);
    expect(target).toMatchObject({ anchorX: 100, onset: rational(0), position, scopeLabel: 'voice', starterRest: false });
    expect(target?.cursor).toEqual({ staffId: 'staff', measureId: 'm1', voiceIndex: 0 });
    expect(target?.voice.events).toEqual([]);
    expect(JSON.stringify({ score: options.score, system: options.system })).toBe(original);
  });

  it('can use the exact canonical voice ID when an adapter does not need an alias bridge', () => {
    const options = empty(); const system = { ...options.system, anchors: options.system.anchors.map(anchor => ({ ...anchor, sourceId: 'empty', voiceId: 'empty' })) };
    expect(insertionTarget({ ...options, system, projectedVoiceIds: undefined })?.cursor).toEqual({ staffId: 'staff', measureId: 'm1', voiceIndex: 0 });
  });

  it('refuses Replace because there is no event to replace', () => {
    expect(insertionTarget({ ...empty(), position: 'replace' })).toBeUndefined();
  });

  it('does not infer a generated alias or fall back after an explicit bridge failure', () => {
    const options = empty();
    expect(insertionTarget({ ...options, projectedVoiceIds: undefined })).toBeUndefined();
    expect(insertionTarget({ ...options, projectedVoiceIds: new Map() })).toBeUndefined();
    const canonical = { ...options.system, anchors: options.system.anchors.map(anchor => ({ ...anchor, sourceId: 'empty', voiceId: 'empty' })) };
    expect(insertionTarget({ ...options, system: canonical, projectedVoiceIds: new Map() })).toBeUndefined();
  });

  it('distinguishes two empty voices at the same onset and refuses a missing current-voice anchor', () => {
    const options = { ...empty([voice('first', []), voice('second', [])]), voiceIndex: 1 };
    expect(options.system.anchors[0].x).toBe(options.system.anchors[1].x);
    const target = insertionTarget(options); expect(target?.voice.id).toBe('second'); expect(target?.cursor.voiceIndex).toBe(1);
    expect(insertionTarget({ ...options, system: { ...options.system, anchors: options.system.anchors.slice(0, 1) } })).toBeUndefined();
    expect(insertionTarget({ ...options, voiceIndex: 2 })).toBeUndefined();
  });

  it('does not target a populated neighboring voice when the requested voice is empty', () => {
    const options = { ...empty([voice('first'), voice('second', [])]), voiceIndex: 1 };
    const target = insertionTarget(options); expect(target?.voice.id).toBe('second'); expect(target?.cursor.eventId).toBeUndefined();
    const missing = { ...options.system, anchors: options.system.anchors.filter(anchor => anchor.voiceId !== 'projection-voice-0-0-1') };
    expect(insertionTarget({ ...options, system: missing })).toBeUndefined();
  });

  it.each([
    { sourceId: 'other' }, { voiceId: 'other' }, { voiceId: undefined }, { staffId: 'other' }, { measureId: 'other' },
    { system: 2 }, { eventIndex: 1 }, { beforeId: 'gone' }, { afterId: 'gone' }, { onset: rational(1, 4) },
    { x: 79 }, { x: Infinity }, { y: NaN }, { height: 0 },
  ])('rejects malformed or unrelated empty-anchor geometry %o', change => {
    const options = empty(); const system = { ...options.system, anchors: options.system.anchors.map(anchor => ({ ...anchor, ...change })) };
    expect(insertionTarget({ ...options, system })).toBeUndefined();
  });

  it('rejects duplicate empty anchors and the renderer’s distinct zero-voice measure fallback', () => {
    const options = empty();
    expect(insertionTarget({ ...options, system: { ...options.system, anchors: [...options.system.anchors, ...options.system.anchors] } })).toBeUndefined();
    const fallback = { ...options.system.anchors[0], sourceId: 'm1', voiceId: undefined };
    expect(insertionTarget({ ...options, system: { ...options.system, anchors: [fallback] } })).toBeUndefined();
  });

  it.each(['complete', 'pickup', 'tuplet', 'rhythm', 'three-roads'] as const)('retains the %s guard for empty pointer targets', kind => {
    const options = empty(); const staff = options.score.staves[0]; const original = staff.measures[0];
    const bar: Measure = kind === 'complete' ? { ...original, incomplete: false } : kind === 'pickup' ? { ...original, pickup: true }
      : kind === 'tuplet' ? { ...original, voices: [{ ...original.voices[0], tuplets: [{ id: 'empty-tuplet', actual: 3, normal: 2, eventIds: [], bracket: 'auto', showRatio: false }] }] } : original;
    const score = { ...options.score, staves: [{ ...staff, measures: [bar], ...(kind === 'rhythm' || kind === 'three-roads' ? { notation: kind } : {}) }] };
    expect(insertionTarget({ ...options, score })).toBeUndefined();
  });
});

describe('ordinary rest boundaries on every notation staff', () => {
  function restOptions(notation: NonNullable<Staff['notation']>, voices: readonly Voice[] = [voice('rests', [
    event('r1', rational(0), 'quarter', { kind: 'rest', pitches: [] }),
    event('r2', rational(1, 4), 'half', { kind: 'rest', pitches: [] }),
  ])]) {
    const value = score([{ id: 'staff', label: 'Rest staff', notation, clef: 'treble', key: 'C',
      measures: [{ ...measure('rest-bar', voices), incomplete: true }] }]);
    return { score: value, system: geometry(value), x: 145, y: notation === 'rhythm' ? 40 : 60,
      voiceIndex: 0, position: 'before' as const, entryKind: 'rest' as const };
  }

  it.each(['pitched', 'rhythm', 'three-roads'] as const)('uses existing time and voice for an ordinary rest on %s', notation => {
    const options = restOptions(notation); const before = JSON.stringify(options);
    expect(insertionTarget(options)).toMatchObject({ cursor: { staffId: 'staff', measureId: 'rest-bar', voiceIndex: 0, eventId: 'r2' },
      onset: rational(1, 4), position: 'before', anchorX: 145, starterRest: false, scopeLabel: 'voice' });
    expect(insertionTarget({ ...options, position: 'after' })).toMatchObject({ cursor: { eventId: 'r1' }, onset: rational(1, 4) });
    expect(insertionTarget({ ...options, position: 'replace' })).toMatchObject({ cursor: { eventId: 'r2' }, onset: rational(1, 4) });
    expect(JSON.stringify(options)).toBe(before);
  });

  it.each(['pitched', 'rhythm', 'three-roads'] as const)('uses an exact empty-voice zero anchor on %s without creating a rest yet', notation => {
    const options = restOptions(notation, [voice('empty', [])]);
    const projectedVoiceIds = new Map([['empty', 'projection-voice-0-0-0']]);
    for (const position of ['before', 'after'] as const) {
      expect(insertionTarget({ ...options, position, projectedVoiceIds })).toMatchObject({ cursor: { staffId: 'staff', measureId: 'rest-bar', voiceIndex: 0 },
        onset: rational(0), anchorX: 100, starterRest: false });
    }
    expect(insertionTarget({ ...options, position: 'replace', projectedVoiceIds })).toBeUndefined();
    expect(insertionTarget({ ...options, projectedVoiceIds: new Map() })).toBeUndefined();
    expect(options.score.staves[0].measures[0].voices[0].events).toEqual([]);
  });

  it('requires the one-line staff’s actual space and bounds its vertical lane without inferring pitch', () => {
    const options = restOptions('rhythm'); const system = options.system; const lane = system.measures[0];
    for (const y of [20, 30, 40, 50, 60]) expect(findMeasureLane(system, 145, y, 'rest')).toBe(lane);
    for (const y of [19, 61]) expect(findMeasureLane(system, 145, y, 'rest')).toBeUndefined();
    expect(insertionTarget({ ...options, y: 20 })?.cursor).toEqual(insertionTarget({ ...options, y: 60 })?.cursor);
    for (const staffSpace of [undefined, 0, -10, Infinity, NaN]) {
      const changed = { ...system, measures: [{ ...lane, staffSpace }] };
      expect(findMeasureLane(changed, 145, 40, 'rest')).toBeUndefined();
    }
    expect(findMeasureLane({ ...system, measures: [{ ...lane, notation: 'pitched' as const }] }, 145, 40, 'rest')).toBeUndefined();
  });

  it('prefers a measured rhythm band but refuses overlapping rhythm bands and mixed extensions', () => {
    const options = restOptions('rhythm'); const lane = options.system.measures[0];
    const upper = { ...lane, sourceId: 'upper', staffId: 'upper', notation: 'pitched' as const, topLine: -30, bottomLine: 10 };
    const pair = { ...options.system, measures: [upper, lane] };
    expect(findMeasureLane(pair, 145, 30, 'rest')).toBe(lane);
    expect(findMeasureLane(pair, 145, 25, 'rest')).toBeUndefined();
    const lower = { ...lane, sourceId: 'lower', staffId: 'lower', topLine: 55, bottomLine: 55 };
    expect(findMeasureLane({ ...pair, measures: [lane, lower] }, 145, 48, 'rest')).toBeUndefined();
  });

  it.each(['rhythm', 'three-roads'] as const)('does not broaden single-pitch targeting to %s', notation => {
    const options = restOptions(notation);
    expect(insertionTarget({ ...options, entryKind: 'note' })).toBeUndefined();
    expect(insertionTarget({ ...options, entryKind: undefined })).toBeUndefined();
    expect(insertionTarget({ ...options, system: { ...options.system, measures: options.system.measures.map(lane => ({ ...lane, notation: 'pitched' as const })) } })).toBeUndefined();
  });

  it('keeps an ordinary written whole rest distinct from a full-measure starter', () => {
    const ordinary = restOptions('three-roads', [voice('silent', [event('ordinary', rational(0), 'whole', { kind: 'rest', pitches: [] })])]);
    expect(insertionTarget({ ...ordinary, x: 280, position: 'after' })).toMatchObject({ position: 'after', onset: rational(1), starterRest: false });
    const full = restOptions('three-roads', [voice('silent', [event('full', rational(0), 'whole', { kind: 'rest', pitches: [], measureRest: true })])]);
    expect(insertionTarget(full)).toMatchObject({ position: 'replace', onset: rational(0), starterRest: true, cursor: { eventId: 'full' } });
  });

  it('retains nested tuplet side and exact rational onset for rest entry', () => {
    const value = nestedScore(); const system = geometry(value); const anchor = system.anchors.find(item => item.beforeId === 'inner-0')!;
    const options = { system, score: value, x: anchor.x, y: 60, voiceIndex: 0, entryKind: 'rest' as const };
    expect(insertionTarget({ ...options, position: 'before' })).toMatchObject({ onset: rational(1, 12), scopeLabel: 'tuplets 3:2 → 5:4', cursor: { eventId: 'inner-0' } });
    expect(insertionTarget({ ...options, position: 'after' })).toMatchObject({ onset: rational(1, 12), scopeLabel: 'tuplet 3:2', cursor: { eventId: 'outer-first' } });
  });

  it('retains active voice identity when simultaneous rests share painted ink', () => {
    const options = restOptions('rhythm', [voice('one', [event('r1', rational(0), 'whole', { kind: 'rest', pitches: [], measureRest: true })]),
      voice('two', [event('r2', rational(0), 'whole', { kind: 'rest', pitches: [], measureRest: true })])]);
    expect(insertionTarget({ ...options, voiceIndex: 1 })).toMatchObject({ cursor: { voiceIndex: 1, eventId: 'r2' }, position: 'replace' });
    expect(insertionTarget({ ...options, voiceIndex: 2 })).toBeUndefined();
    expect(insertionTarget({ ...options, voiceIndex: 1, system: { ...options.system, events: options.system.events.filter(event => event.sourceId === 'r1') } })).toBeUndefined();
  });
});
