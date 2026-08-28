import { describe, expect, it } from 'vitest';
import { readScore, serializeScore } from '../src/dom/index';
import {
  ARTICULATION_TYPES, ORNAMENT_TYPES, harmonyIntervalDescription, harmonyIntervalOffset,
  harmonyIntervalSemitones, harmonyIntervalText, parseHarmonyInterval, parsePitch, rational,
  validateHarmonyInterval, validateScore,
} from '../src/model/index';
import type { EventMarking, HarmonyInterval, Score } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}
function read(html: string) { return readScore(element(html)); }
function errors(result: ReturnType<typeof readScore>) {
  return result.diagnostics.filter(issue => issue.severity === 'error').map(issue => issue.code);
}
function road(body: string, attributes = 'direction="same" duration="whole"') {
  return read(`<music-staff notation="three-roads"><music-measure><music-road id="main" ${attributes}>${body}</music-road></music-measure></music-staff>`);
}
function firstEvent(score: Score) { return score.staves[0].measures[0].voices[0].events[0]; }
function roundTrip(score: Score) {
  const html = serializeScore(score);
  const result = read(html);
  expect(errors(result)).toEqual([]);
  expect(result.score).toEqual(score);
  return html;
}
const interval = (value: string, placement = 'above', id?: string) =>
  `<music-interval ${id ? `id="${id}"` : ''} value="${value}" placement="${placement}"></music-interval>`;

describe('relative harmony interval semantics', () => {
  it.each([
    [1, 0], [2, 2], [3, 4], [4, 5], [5, 7], [6, 9], [7, 11],
    [8, 12], [9, 14], [10, 16], [11, 17], [12, 19], [13, 21],
  ])('keeps interval number %i as a major/perfect distance of %i semitones', (number, semitones) => {
    const value = parseHarmonyInterval(String(number));
    expect(value).toEqual({ number, alter: 0 });
    expect(harmonyIntervalText(value)).toBe(String(number));
    expect(harmonyIntervalSemitones(value)).toBe(semitones);
    expect(harmonyIntervalOffset(value, 'above')).toBe(semitones);
    expect(harmonyIntervalOffset(value, 'below')).toBe(semitones ? -semitones : 0);
    expect(harmonyIntervalSemitones(parseHarmonyInterval(`#${number}`))).toBe(semitones + 1);
    if (number > 1) expect(harmonyIntervalSemitones(parseHarmonyInterval(`b${number}`))).toBe(semitones - 1);
  });

  it('implements the requested F plus fifth and Bb minus minor third without altering the destination spelling', () => {
    const height = (text: string) => {
      const pitch = parsePitch(text);
      return pitch.octave * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.step]) + pitch.alter;
    };
    expect(height('F4') + harmonyIntervalOffset(parseHarmonyInterval('5'), 'above')).toBe(height('C5'));
    expect(height('Bb4') + harmonyIntervalOffset(parseHarmonyInterval('b3'), 'below')).toBe(height('G4'));
    expect(height('Bb4') + harmonyIntervalOffset(parseHarmonyInterval('3'), 'below')).toBe(height('Gb4'));
    expect(harmonyIntervalOffset(parseHarmonyInterval('13'), 'above')).toBe(21);
    expect(harmonyIntervalOffset(parseHarmonyInterval('b13'), 'below')).toBe(-20);
    expect(harmonyIntervalDescription(parseHarmonyInterval('5'))).toBe('perfect fifth');
    expect(harmonyIntervalDescription(parseHarmonyInterval('b3'))).toBe('minor third');
    expect(harmonyIntervalDescription(parseHarmonyInterval('#11'))).toBe('augmented eleventh');
  });

  it.each([['♭3', 'b3'], ['♯11', '#11'], [' b13 ', 'b13']])('canonicalizes %s without losing interval quality', (input, canonical) => {
    expect(harmonyIntervalText(parseHarmonyInterval(input))).toBe(canonical);
    const result = road(interval(input));
    expect(errors(result)).toEqual([]);
    expect(roundTrip(result.score)).toContain(`value="${canonical}"`);
  });

  it.each(['', '0', '14', 'b14', '#14', '-3', '+5', '03', '1.5', 'b', 'bb3', '##5', 'n3', 'm3', 'M3', 'b 3', '5/4', 'qf3', 'b1', '♭1'])('rejects unsupported or direction-reversing interval %j', value => {
    expect(() => parseHarmonyInterval(value)).toThrow();
    expect(errors(road(interval(value)))).toContain('invalid-harmony-interval');
  });

  it.each([null, [], { number: 0, alter: 0 }, { number: 14, alter: 0 }, { number: 3.5, alter: 0 },
    { number: '3', alter: 0 }, { number: 3, alter: 0.5 }, { number: 3, alter: '0' }, { number: 1, alter: -1 },
  ])('validates programmatic interval data before computing a distance: %j', value => {
    expect(() => validateHarmonyInterval(value as HarmonyInterval)).toThrow();
    expect(() => harmonyIntervalSemitones(value as HarmonyInterval)).toThrow();
  });

  it('does not treat interval placement as an automatic engraving preference', () => {
    for (const placement of ['', 'auto', 'up', 'down']) {
      expect(errors(road(`<music-interval value="5"${placement ? ` placement="${placement}"` : ''}></music-interval>`))).toContain('invalid-interval-placement');
    }
    expect(() => harmonyIntervalOffset(parseHarmonyInterval('5'), 'auto' as 'above')).toThrow();
  });
});

describe('event-local markings and strict HTML grammar', () => {
  it('gives each attached instruction an identity without adding events, onsets, or pitches', () => {
    const root = element(`<music-staff notation="three-roads"><music-measure>
      <music-harmony id="symbol" text="Optional realization"></music-harmony>
      <music-road id="main" direction="same" duration="whole">
        <music-articulation id="accent" type="accent"></music-articulation>
        <music-ornament id="trill" type="trill"></music-ornament>
        ${interval('5', 'above', 'upper')}${interval('b3', 'below', 'lower')}
      </music-road></music-measure></music-staff>`);
    const before = root.outerHTML;
    const result = readScore(root);
    expect(errors(result)).toEqual([]);
    const measure = result.score.staves[0].measures[0];
    expect(measure.voices[0].events).toHaveLength(1);
    expect(firstEvent(result.score)).toMatchObject({ kind: 'road', pitches: [], onset: rational(0), time: rational(1), markings: [
      { id: 'accent', kind: 'articulation', type: 'accent', placement: 'auto' },
      { id: 'trill', kind: 'ornament', type: 'trill', placement: 'above' },
      { id: 'upper', kind: 'interval', interval: { number: 5, alter: 0 }, placement: 'above' },
      { id: 'lower', kind: 'interval', interval: { number: 3, alter: -1 }, placement: 'below' },
    ] });
    expect(measure.annotations.map(annotation => annotation.id)).toEqual(['symbol']);
    for (const id of ['accent', 'trill', 'upper', 'lower']) expect(result.sources.get(id)).toBe(root.querySelector(`#${id}`));
    expect(root.outerHTML).toBe(before);
    roundTrip(result.score);
  });

  it.each(ARTICULATION_TYPES)('supports %s on notes, chords, rhythm notes, road notes, and prescribed slashes', type => {
    for (const [notation, tag, attributes] of [
      ['pitched', 'music-note', 'pitch="C4"'], ['pitched', 'music-chord', 'pitches="C4 E4 G4"'],
      ['rhythm', 'music-rhythm', ''], ['three-roads', 'music-road', 'direction="same"'],
      ['pitched', 'music-slash', 'rhythmic'],
    ]) {
      const result = read(`<music-staff notation="${notation}"><music-measure><${tag} ${attributes} duration="whole"><music-articulation type="${type}" placement="below"></music-articulation></${tag}></music-measure></music-staff>`);
      expect(errors(result), `${type} on ${tag}`).toEqual([]);
      expect(firstEvent(result.score).time).toEqual(rational(1));
      roundTrip(result.score);
    }
  });

  it.each(ORNAMENT_TYPES)('supports an explicit %s without generating auxiliary notes', type => {
    for (const [notation, tag, attributes] of [['pitched', 'music-note', 'pitch="Fqs4"'], ['three-roads', 'music-road', 'direction="higher"']]) {
      const result = read(`<music-staff notation="${notation}"><music-measure><${tag} ${attributes} duration="whole"><music-ornament type="${type}" placement="below"></music-ornament></${tag}></music-measure></music-staff>`);
      expect(errors(result)).toEqual([]);
      expect(firstEvent(result.score).pitches).toHaveLength(tag === 'music-note' ? 1 : 0);
      expect(firstEvent(result.score).markings?.[0]).toMatchObject({ kind: 'ornament', type, placement: 'below' });
      roundTrip(result.score);
    }
  });

  it('supports fermatas on full-measure rests and open slashes without rewriting their time', () => {
    for (const body of [
      '<music-rest measure><music-articulation type="fermata"></music-articulation></music-rest>',
      '<music-slash duration="half" dots="2"><music-articulation type="fermata" placement="below"></music-articulation></music-slash>',
    ]) {
      const result = read(`<music-staff meter="7/8" groups="2+2+3"><music-measure>${body}</music-measure></music-staff>`);
      expect(errors(result)).toEqual([]);
      expect(firstEvent(result.score).time).toEqual(rational(7, 8));
      roundTrip(result.score);
    }
  });

  it('keeps child markings out of nested tuplet membership and exact rhythmic time', () => {
    const result = read(`<music-staff notation="three-roads"><music-measure><music-tuplet id="outer" actual="3" normal="2">
      <music-road id="a" direction="same" duration="eighth">${interval('13', 'above', 'compound')}</music-road>
      <music-tuplet id="inner" actual="3" normal="2">
        <music-road id="b" direction="higher" duration="sixteenth"><music-articulation id="dot" type="staccato"></music-articulation></music-road>
        <music-rest id="r" duration="sixteenth"></music-rest><music-road id="c" direction="lower" duration="sixteenth"></music-road>
      </music-tuplet><music-road id="d" direction="same" duration="eighth"></music-road>
      </music-tuplet><music-rest duration="half" dots="1"></music-rest></music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    const voice = result.score.staves[0].measures[0].voices[0];
    expect(voice.events.map(event => event.time)).toEqual([rational(1, 12), rational(1, 36), rational(1, 36), rational(1, 36), rational(1, 12), rational(3, 4)]);
    expect(voice.tuplets[0].eventIds).toEqual(['a', 'b', 'r', 'c', 'd']);
    expect(voice.tuplets[1].eventIds).toEqual(['b', 'r', 'c']);
    roundTrip(result.score);
  });

  it('allows different simultaneous harmonies but rejects duplicate canonical labels on one side', () => {
    expect(errors(road(interval('5') + interval('b3') + interval('5', 'below')))).toEqual([]);
    expect(errors(road(interval('b3') + interval('♭3')))).toContain('duplicate-event-marking');
    // Equal chromatic distances do not erase distinct written interval spellings.
    const enharmonic = road(interval('#4') + interval('b5'));
    expect(errors(enharmonic)).toEqual([]);
    roundTrip(enharmonic.score);
  });

  it('accepts combined articulation types but not repeated types in different positions', () => {
    const combined = road('<music-articulation type="accent"></music-articulation><music-articulation type="staccato"></music-articulation>');
    expect(errors(combined)).toEqual([]);
    roundTrip(combined.score);
    for (const tag of ['music-articulation', 'music-ornament']) {
      const type = tag === 'music-articulation' ? 'accent' : 'trill';
      expect(errors(road(`<${tag} type="${type}" placement="above"></${tag}><${tag} type="${type}" placement="below"></${tag}>`))).toContain('duplicate-event-marking');
    }
  });

  it('rejects an interval on any event other than a road and never treats chord text as an interval', () => {
    for (const [notation, tag, attributes] of [
      ['pitched', 'music-note', 'pitch="C4"'], ['pitched', 'music-chord', 'pitches="C4 E4"'],
      ['pitched', 'music-slash', 'rhythmic'], ['rhythm', 'music-rhythm', ''], ['three-roads', 'music-rest', ''],
    ]) {
      expect(errors(read(`<music-staff notation="${notation}"><music-measure><${tag} duration="whole" ${attributes}>${interval('5')}</${tag}></music-measure></music-staff>`))).toContain('interval-on-non-road-event');
    }
    expect(errors(road('<music-harmony text="5"></music-harmony>'))).toContain('nonempty-rhythm-element');
  });

  it('rejects meaningless attack/ornament contexts and unmodeled chord-tone targets', () => {
    for (const body of [
      '<music-rest duration="whole"><music-articulation type="staccato"></music-articulation></music-rest>',
      '<music-slash duration="whole"><music-articulation type="accent"></music-articulation></music-slash>',
      '<music-rest duration="whole"><music-ornament type="trill"></music-ornament></music-rest>',
      '<music-chord pitches="C4 E4" duration="whole"><music-ornament type="trill"></music-ornament></music-chord>',
      '<music-slash rhythmic duration="whole"><music-ornament type="trill"></music-ornament></music-slash>',
    ]) expect(errors(read(`<music-measure>${body}</music-measure>`))).toContain('invalid-marking-context');
  });

  it('diagnoses malformed, misplaced, nested, and timed children instead of swallowing music', () => {
    expect(errors(road('<music-articulation></music-articulation>'))).toContain('invalid-articulation');
    expect(errors(road('<music-ornament type="mordent"></music-ornament>'))).toContain('invalid-ornament');
    expect(errors(road('<music-ornament type="trill" placement="auto"></music-ornament>'))).toContain('invalid-attribute');
    expect(errors(road('<music-articulation type="accent" duration="eighth"></music-articulation>'))).toContain('unknown-attribute');
    expect(errors(road('<music-interval value="5" placement="above" at="1/4"></music-interval>'))).toContain('unknown-attribute');
    expect(errors(road('<music-ornament type="trill">text</music-ornament>'))).toContain('nonempty-rhythm-element');
    expect(errors(road('<music-ornament type="trill"><music-articulation type="accent"></music-articulation></music-ornament>'))).toContain('nonempty-rhythm-element');
    expect(errors(road('<music-road direction="lower"></music-road>'))).toContain('nonempty-rhythm-element');
    expect(errors(read('<music-measure><music-articulation type="accent"></music-articulation><music-rest measure></music-rest></music-measure>'))).toContain('unexpected-element');
  });

  it('validates child IDs, intervals, and timing-free model shapes before serialization', () => {
    const original = road(interval('5', 'above', 'h')).score;
    for (const [patch, code] of [
      [{ id: 'main' }, 'duplicate-id'], [{ interval: { number: 14, alter: 0 } }, 'invalid-harmony-interval'],
      [{ placement: 'auto' }, 'unsupported-value'], [{ onset: rational(1, 4) }, 'invalid-event-marking'],
    ] as const) {
      const score = structuredClone(original);
      Object.assign(firstEvent(score).markings![0], patch);
      expect(validateScore(score).map(issue => issue.code)).toContain(code);
      expect(() => serializeScore(score)).toThrow();
    }
    for (const markings of [null, 'accent', [null], [{ id: 'h', kind: 'unknown' }]]) {
      const score = structuredClone(original);
      Object.assign(firstEvent(score), { markings: markings as EventMarking[] });
      expect(() => serializeScore(score)).toThrow();
    }
  });
});

describe('tied road harmony consistency', () => {
  function tied(a: string, b: string) {
    return read(`<music-staff notation="three-roads"><music-measure><music-road direction="higher" duration="whole" tie="start">${a}</music-road></music-measure>
      <music-measure break-before="line"><music-road direction="same" duration="whole" tie="end">${b}</music-road></music-measure></music-staff>`);
  }

  it('sustains the whole harmony set regardless of child ID and source order', () => {
    const result = tied(interval('5', 'above', 'a') + interval('b3', 'below', 'b'), interval('b3', 'below', 'c') + interval('5', 'above', 'd'));
    expect(errors(result)).toEqual([]);
    roundTrip(result.score);
  });

  it.each([
    [interval('5'), ''], ['', interval('5')], [interval('5'), interval('b5')],
    [interval('5'), interval('5', 'below')], [interval('#4'), interval('b5')],
    [interval('5'), interval('5') + interval('b3', 'below')],
  ])('rejects a hidden change to the held harmony set', (start, end) => {
    const result = tied(start, end);
    expect(errors(result)).toContain('road-tie-harmony-mismatch');
    expect(() => serializeScore(result.score)).toThrow(/complete harmony/);
  });

  it('keeps authored attack and release markings at their tied segments without adding time or an attack', () => {
    const result = tied(interval('5') + '<music-articulation type="accent"></music-articulation>', interval('5') + '<music-articulation type="staccato"></music-articulation><music-articulation type="fermata"></music-articulation>');
    expect(errors(result)).toEqual([]);
    const events = result.score.staves[0].measures.map(measure => measure.voices[0].events[0]);
    expect(events.map(event => event.tie)).toEqual(['start', 'end']);
    expect(events.map(event => event.time)).toEqual([rational(1), rational(1)]);
    roundTrip(result.score);
  });
});
