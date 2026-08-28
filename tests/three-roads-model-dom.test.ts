import { describe, expect, it } from 'vitest';
import { readScore, serializeScore } from '../src/dom/index';
import { parsePitch, rational, validatePitchDirection, validateScore } from '../src/model/index';
import type { Score } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}
function read(html: string) { return readScore(element(html)); }
function errors(result: ReturnType<typeof readScore>) {
  return result.diagnostics.filter(issue => issue.severity === 'error').map(issue => issue.code);
}
function roads(body: string, meter = '4/4') {
  return read(`<music-staff notation="three-roads" meter="${meter}">${body}</music-staff>`);
}
function roundTrip(score: Score): string {
  const html = serializeScore(score);
  const result = read(html);
  expect(errors(result)).toEqual([]);
  expect(result.score).toEqual(score);
  return html;
}

describe('3 roads music model and DOM grammar', () => {
  it('preserves relative instructions and written attacks without inventing performed pitches', () => {
    const root = element(`<music-staff notation="three-roads" label="3 roads music">
      <music-measure><music-direction>Choose a comfortable reference pitch.</music-direction>
        <music-road id="start" direction="same"></music-road>
        <music-road id="up1" direction="higher" duration="eighth"></music-road>
        <music-road id="up2" direction="higher" duration="eighth"></music-road>
        <music-road direction="same"></music-road><music-road direction="lower"></music-road>
      </music-measure><music-measure>
        <music-road direction="lower"></music-road><music-rest></music-rest>
        <music-road direction="same"></music-road><music-road direction="higher"></music-road>
      </music-measure></music-staff>`);
    const before = root.outerHTML;
    const result = readScore(root);
    expect(errors(result)).toEqual([]);
    const events = result.score.staves[0].measures.flatMap(measure => measure.voices[0].events);
    expect(events.map(event => event.pitchDirection)).toEqual(['same', 'higher', 'higher', 'same', 'lower', 'lower', undefined, 'same', 'higher']);
    expect(events.every(event => event.pitches.length === 0 && !event.rhythmic)).toBe(true);
    expect(events.slice(0, 5).map(event => event.onset)).toEqual([rational(0), rational(1, 4), rational(3, 8), rational(1, 2), rational(3, 4)]);
    expect(result.sources.get('up2')).toBe(root.querySelector('#up2'));
    expect(root.outerHTML).toBe(before);
    const html = roundTrip(result.score);
    expect(html).toContain('direction="higher" duration="eighth"');
    expect(html).not.toMatch(/\s(?:pitch|pitches|clef|key|rhythmic)=/);
  });

  it('inherits only meter and groups from a pitched ensemble', () => {
    const result = read(`<music-system clef="bass" key="Bb" meter="7/8" groups="2+2+3">
      <music-staff notation="three-roads"><music-measure>
        <music-road direction="higher" duration="quarter"></music-road>
        <music-road direction="same" duration="quarter"></music-road>
        <music-road direction="lower" duration="quarter" dots="1"></music-road>
      </music-measure></music-staff>
      <music-staff><music-measure><music-rest measure></music-rest></music-measure></music-staff>
    </music-system>`);
    expect(errors(result)).toEqual([]);
    const [staff, pitched] = result.score.staves;
    expect(staff).toMatchObject({ notation: 'three-roads', clef: 'treble', key: 'C' });
    expect(staff.measures[0]).toMatchObject({ clef: 'treble', key: 'C', meter: { numerator: 7, denominator: 8, groups: [2, 2, 3] } });
    expect(pitched).toMatchObject({ clef: 'bass', key: 'Bb' });
    roundTrip(result.score);
  });

  it.each(['', 'up', 'down', 'middle', 'Higher', ' same ', 'C4'])('requires an explicit valid road direction, rejecting %j without a guessed event', value => {
    expect(() => validatePitchDirection(value)).toThrow(/higher.*same.*lower/);
    const result = roads(`<music-measure incomplete><music-road ${value ? `direction="${value}"` : ''}></music-road></music-measure>`);
    expect(errors(result)).toContain('invalid-road-direction');
    expect(result.score.staves[0].measures[0].voices[0].events).toEqual([]);
  });

  it.each(['higher', 'same', 'lower'] as const)('accepts %s as an opening instruction against a chosen reference, with no mandatory fixed pitch', direction => {
    expect(validatePitchDirection(direction)).toBe(direction);
    const result = roads(`<music-measure><music-road direction="${direction}" duration="whole"></music-road></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ kind: 'road', pitchDirection: direction, pitches: [], rhythmic: false });
    roundTrip(result.score);
  });

  it('retains nested ratios, exact onsets, rest durations, explicit beams, and dots', () => {
    const result = roads(`<music-measure><music-tuplet actual="3" normal="2">
      <music-road direction="same" duration="eighth" beam="start"></music-road>
      <music-tuplet actual="3" normal="2">
        <music-road direction="higher" duration="sixteenth" beam="continue"></music-road>
        <music-rest duration="sixteenth" beam="continue"></music-rest>
        <music-road direction="lower" duration="sixteenth" beam="continue"></music-road>
      </music-tuplet><music-road direction="same" duration="eighth" beam="end"></music-road>
      </music-tuplet><music-rest duration="half" dots="1"></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    const events = result.score.staves[0].measures[0].voices[0].events;
    expect(events.map(event => event.time)).toEqual([rational(1, 12), rational(1, 36), rational(1, 36), rational(1, 36), rational(1, 12), rational(3, 4)]);
    expect(events.map(event => event.onset)).toEqual([rational(0), rational(1, 12), rational(1, 9), rational(5, 36), rational(1, 6), rational(1, 4)]);
    roundTrip(result.score);
  });

  it('retains full-measure rests in uneven meter and successive meter changes', () => {
    const result = roads(`<music-measure><music-rest measure></music-rest></music-measure>
      <music-measure meter="3/4"><music-road direction="same" duration="half" dots="1"></music-road></music-measure>`, '7/8');
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ kind: 'rest', measureRest: true, duration: 'whole', time: rational(7, 8) });
    roundTrip(result.score);
  });

  it.each([['clef="treble"', ''], ['key="C"', ''], ['', 'clef="bass"'], ['', 'key="Bb"']])('rejects local pitch context: staff %s, measure %s', (staffContext, measureContext) => {
    expect(errors(read(`<music-staff notation="three-roads" ${staffContext}><music-measure ${measureContext}><music-rest measure></music-rest></music-measure></music-staff>`))).toContain('three-roads-pitch-context');
  });

  it.each([
    '<music-note pitch="C4" duration="whole"></music-note>',
    '<music-chord pitches="C4 E4" duration="whole"></music-chord>',
    '<music-rhythm duration="whole"></music-rhythm>',
    '<music-slash duration="whole"></music-slash>',
    '<music-slash rhythmic duration="whole"></music-slash>',
  ])('rejects ambiguous or pitched events on the three roads: %s', event => {
    expect(errors(roads(`<music-measure>${event}</music-measure>`))).toContain('incompatible-event-on-three-roads-staff');
  });

  it('does not permit road instructions on pitched or single-line rhythm staves', () => {
    for (const notation of ['pitched', 'rhythm']) {
      const result = read(`<music-staff notation="${notation}"><music-measure><music-road direction="same" duration="whole"></music-road></music-measure></music-staff>`);
      expect(errors(result)).toContain('road-event-on-other-staff');
    }
  });

  it.each(['pitch="C4"', 'pitches="C4 E4"', 'accidental="sharp"', 'accidental-display="always"', 'rhythmic', 'notehead="x"'])('does not silently discard an incompatible road attribute: %s', attribute => {
    const result = roads(`<music-measure><music-road direction="same" duration="whole" ${attribute}></music-road></music-measure>`);
    expect(errors(result)).toContain('unknown-attribute');
  });

  it('validates programmatic direction, pitchless data, and context before serialization', () => {
    const valid = roads('<music-measure><music-road direction="higher" duration="whole"></music-road></music-measure>').score;
    for (const [patch, code] of [
      [{ pitchDirection: undefined }, 'invalid-road-direction'], [{ pitchDirection: 'up' }, 'invalid-road-direction'],
      [{ pitches: [parsePitch('C4')] }, 'invalid-event-pitches'], [{ rhythmic: true }, 'invalid-rhythmic-flag'],
      [{ kind: 'rest', pitchDirection: 'same' }, 'invalid-road-direction'],
    ] as const) {
      const copy = structuredClone(valid);
      Object.assign(copy.staves[0].measures[0].voices[0].events[0], patch);
      expect(validateScore(copy).map(issue => issue.code)).toContain(code);
      expect(() => serializeScore(copy)).toThrow();
    }
    for (const target of ['staff', 'measure']) {
      const copy = structuredClone(valid);
      Object.assign(target === 'staff' ? copy.staves[0] : copy.staves[0].measures[0], { key: 'G' });
      expect(validateScore(copy).map(issue => issue.code)).toContain('three-roads-pitch-context');
      expect(() => serializeScore(copy)).toThrow();
    }
  });
});

describe('3 roads sustained pitch ties', () => {
  it.each(['higher', 'same', 'lower'] as const)('sustains a %s attack into same continuations across barlines and a system break', direction => {
    const result = roads(`<music-measure><music-road direction="${direction}" duration="whole" tie="start"></music-road></music-measure>
      <music-measure break-before="line"><music-road direction="same" duration="half" tie="continue"></music-road>
        <music-road direction="same" duration="half" tie="end"></music-road></music-measure>`);
    expect(errors(result)).toEqual([]);
    roundTrip(result.score);
  });

  it.each(['higher', 'lower'])('rejects a %s continuation, even when both tied heads would use the same road', direction => {
    const result = roads(`<music-measure><music-road direction="${direction}" duration="half" tie="start"></music-road>
      <music-road direction="${direction}" duration="half" tie="end"></music-road></music-measure>`);
    expect(errors(result)).toContain('invalid-road-tie-direction');
    expect(() => serializeScore(result.score)).toThrow(/sustain/);
  });

  it('requires consecutive continuations in the same voice, not across a rest or another voice', () => {
    const throughRest = roads(`<music-measure><music-road direction="higher" tie="start"></music-road>
      <music-rest></music-rest><music-road direction="same" duration="half" tie="end"></music-road></music-measure>`);
    expect(errors(throughRest)).toContain('unclosed-tie');
    expect(errors(throughRest)).toContain('orphan-tie');
    const acrossVoices = roads(`<music-measure><music-voice><music-road direction="higher" duration="whole" tie="start"></music-road></music-voice>
      <music-voice><music-road direction="same" duration="whole" tie="end"></music-road></music-voice></music-measure>`);
    expect(errors(acrossVoices)).toContain('unclosed-tie');
    expect(errors(acrossVoices)).toContain('orphan-tie');
  });

  it('keeps independent road tie chains in their own voices', () => {
    const result = roads(`<music-measure>
      <music-voice><music-road direction="higher" duration="half" tie="start"></music-road><music-road direction="same" duration="half" tie="end"></music-road></music-voice>
      <music-voice><music-road direction="lower" duration="half" tie="start"></music-road><music-road direction="same" duration="half" tie="end"></music-road></music-voice>
    </music-measure>`);
    expect(errors(result)).toEqual([]);
    roundTrip(result.score);
  });
});
