import { describe, expect, it } from 'vitest';
import { readScore, serializeScore } from '../src/dom/index';
import { parsePitch, pitchDescription, pitchPosition, pitchText, rational, validateAlteration, validateScore } from '../src/model/index';
import type { Score } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}
function read(html: string) { return readScore(element(html)); }
function errors(result: ReturnType<typeof readScore>) {
  return result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code);
}
function rhythm(body: string, meter = '4/4') {
  return read(`<music-staff notation="rhythm" meter="${meter}">${body}</music-staff>`);
}
function roundTrip(score: Score): Score {
  const result = read(serializeScore(score));
  expect(errors(result)).toEqual([]);
  expect(result.score).toEqual(score);
  return result.score;
}

describe('quarter-tone pitch spelling', () => {
  it.each([
    ['qf', 'quarter-flat', -0.5], ['qs', 'quarter-sharp', 0.5],
    ['tqf', 'three-quarter-flat', -1.5], ['tqs', 'three-quarter-sharp', 1.5],
  ] as const)('preserves %s as an absolute alteration in aliases, chords and readable text', (suffix, name, alter) => {
    const pitch = parsePitch(`F${suffix}4`, undefined, 'courtesy');
    expect(pitch).toEqual({ step: 'F', octave: 4, alter, display: 'courtesy' });
    expect(parsePitch('F4', name, 'courtesy')).toEqual(pitch);
    expect(parsePitch(`F${suffix}4`, name, 'courtesy')).toEqual(pitch);
    expect(pitchText(pitch)).toBe(`F${suffix}4`);
    expect(pitchDescription(pitch)).toBe(`F ${name} 4`);
    expect(pitchPosition(pitch, 'alto')).toBe(pitchPosition(parsePitch('F4'), 'alto'));
    expect(pitchText(parsePitch(`B${suffix}-1`))).toBe(`B${suffix}-1`);
    const result = read(`<music-staff key="G"><music-measure>
      <music-note pitch="F4" accidental="${name}" duration="half" accidental-display="courtesy"></music-note>
      <music-chord pitches="C4 F${suffix}4 Gtqs4" duration="half"></music-chord>
    </music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events[0].pitches[0]).toEqual(pitch);
    expect(serializeScore(result.score)).toContain(`pitch="F${suffix}4"`);
    roundTrip(result.score);
  });

  it('never rounds or substitutes an unsupported tuning', () => {
    for (const value of [-2.5, -0.25, 1 / 3, 0.500000001, 2.5, Infinity, NaN]) {
      expect(() => validateAlteration(value)).toThrow(/0.5/);
      expect(() => pitchText({ ...parsePitch('C4'), alter: value })).toThrow();
    }
    expect(() => validateAlteration('0.5' as unknown as number)).toThrow();
    for (const value of [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]) expect(validateAlteration(value)).toBe(value);
    for (const spelling of ['Fqs', 'Fqs#4', 'Fq4', 'F+4', 'F50c4']) expect(() => parsePitch(spelling)).toThrow();
    expect(() => parsePitch('Fqs4', 'sharp')).toThrow(/conflicts/);
    expect(() => parsePitch('F#4', 'quarter-sharp')).toThrow(/conflicts/);
    expect(() => parsePitch('Fn4', 'quarter-sharp')).toThrow(/conflicts/);
  });

  it('preserves quarter-tone identity through complete chord ties', () => {
    const result = read(`<music-staff><music-measure>
      <music-chord pitches="Cqs4 Etqf4 G4" duration="whole" tie="start"></music-chord>
      </music-measure><music-measure>
      <music-chord pitches="G4 Etqf4 Cqs4" duration="whole" tie="end" accidental-display="courtesy"></music-chord>
    </music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    roundTrip(result.score);
    const different = read(serializeScore(result.score).replace('G4 Etqf4 Cqs4', 'G4 Etqf4 C#4'));
    expect(errors(different)).toContain('tie-pitch-mismatch');
  });

  it('diagnoses same-position chord clusters that would hide a third head', () => {
    const result = read('<music-measure><music-chord pitches="Fqf4 F4 Fqs4" duration="whole"></music-chord></music-measure>');
    expect(errors(result)).toContain('unsupported-chord-cluster');
    expect(() => serializeScore(result.score)).toThrow(/two pitches/);
    const distinct = read('<music-measure><music-chord pitches="Eqs4 F4 Fqs4" duration="whole"></music-chord></music-measure>');
    expect(errors(distinct)).toEqual([]);
    roundTrip(distinct.score);
  });
});

describe('explicit single-line rhythm staff model and grammar', () => {
  it('ignores system pitch context but inherits exact meter and groups without changing source', () => {
    const root = element(`<music-system clef="bass" key="Bb" meter="7/8" groups="2+2+3">
      <music-staff notation="rhythm" label="Clap"><music-measure>
        <music-rhythm id="attack" duration="quarter"></music-rhythm><music-rest duration="quarter"></music-rest>
        <music-rhythm duration="quarter" dots="1"></music-rhythm>
      </music-measure></music-staff>
      <music-staff><music-measure><music-rest measure></music-rest></music-measure></music-staff>
    </music-system>`);
    const before = root.outerHTML;
    const result = readScore(root);
    expect(errors(result)).toEqual([]);
    const [staff, pitched] = result.score.staves;
    expect(staff).toMatchObject({ notation: 'rhythm', clef: 'treble', key: 'C', label: 'Clap' });
    expect(staff.measures[0]).toMatchObject({ clef: 'treble', key: 'C', meter: { numerator: 7, denominator: 8, groups: [2, 2, 3] } });
    expect(pitched).toMatchObject({ clef: 'bass', key: 'Bb' });
    expect(pitched.notation).toBeUndefined();
    expect(staff.measures[0].voices[0].events[0]).toMatchObject({ kind: 'rhythm', pitches: [], rhythmic: false, onset: rational(0), time: rational(1, 4) });
    expect(result.sources.get('attack')).toBe(root.querySelector('music-rhythm'));
    expect(root.outerHTML).toBe(before);
    roundTrip(result.score);
  });

  it('serializes explicit pitched mode and omitted legacy mode without changing their meaning', () => {
    for (const attribute of ['', ' notation="pitched"']) {
      const result = read(`<music-staff${attribute}><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff>`);
      expect(errors(result)).toEqual([]);
      expect(result.score.staves[0].notation).toBe(attribute ? 'pitched' : undefined);
      roundTrip(result.score);
    }
  });

  it('retains exact dots, explicit beams, and mixed-value tuplets with rests', () => {
    const result = rhythm(`<music-measure groups="2+2+3">
      <music-rhythm duration="sixteenth" beam="start"></music-rhythm>
      <music-rhythm duration="sixteenth" beam="end"></music-rhythm>
      <music-rest duration="eighth"></music-rest>
      <music-tuplet actual="3" normal="2"><music-rhythm duration="quarter"></music-rhythm><music-rest duration="eighth"></music-rest></music-tuplet>
      <music-rhythm duration="quarter" dots="1"></music-rhythm>
    </music-measure>`, '7/8');
    expect(errors(result)).toEqual([]);
    const voice = result.score.staves[0].measures[0].voices[0];
    expect(voice.events.map(event => event.time)).toEqual([rational(1, 16), rational(1, 16), rational(1, 8), rational(1, 6), rational(1, 12), rational(3, 8)]);
    expect(voice.events.map(event => event.onset)).toEqual([rational(0), rational(1, 16), rational(1, 8), rational(1, 4), rational(5, 12), rational(1, 2)]);
    expect(voice.tuplets[0].eventIds).toHaveLength(2);
    roundTrip(result.score);
  });

  it('composes nested ratios on pitchless events without invented pitches', () => {
    const result = rhythm(`<music-measure><music-tuplet actual="3" normal="2">
      <music-rhythm duration="eighth"></music-rhythm>
      <music-tuplet actual="3" normal="2"><music-rhythm duration="sixteenth"></music-rhythm><music-rest duration="sixteenth"></music-rest><music-rhythm duration="sixteenth"></music-rhythm></music-tuplet>
      <music-rhythm duration="eighth"></music-rhythm>
    </music-tuplet><music-rest duration="half" dots="1"></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    const events = result.score.staves[0].measures[0].voices[0].events;
    expect(events.map(event => event.time)).toEqual([rational(1, 12), rational(1, 36), rational(1, 36), rational(1, 36), rational(1, 12), rational(3, 4)]);
    expect(events.every(event => event.pitches.length === 0)).toBe(true);
    roundTrip(result.score);
  });

  it('supports sustained rhythm ties over barlines and layout boundaries in the same voice', () => {
    const result = rhythm(`<music-measure><music-rhythm duration="whole" tie="start"></music-rhythm></music-measure>
      <music-measure break-before="line"><music-rhythm duration="half" tie="continue"></music-rhythm><music-rhythm duration="half" tie="end"></music-rhythm></music-measure>`);
    expect(errors(result)).toEqual([]);
    roundTrip(result.score);
    expect(errors(rhythm(`<music-measure><music-rhythm duration="whole" tie="start"></music-rhythm></music-measure>`))).toContain('unclosed-tie');
    expect(errors(rhythm(`<music-measure><music-rhythm duration="whole" tie="end"></music-rhythm></music-measure>`))).toContain('orphan-tie');
    expect(errors(rhythm(`<music-measure><music-voice><music-rhythm duration="whole" tie="start"></music-rhythm></music-voice><music-voice><music-rhythm duration="whole" tie="end"></music-rhythm></music-voice></music-measure>`))).toContain('orphan-tie');
  });

  it('keeps specified rhythm, rhythmic slashes, and open improvisation distinct', () => {
    const result = rhythm(`<music-measure><music-rhythm></music-rhythm><music-slash rhythmic></music-slash><music-slash></music-slash><music-rest></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events.map(event => [event.kind, event.rhythmic])).toEqual([
      ['rhythm', false], ['slash', true], ['slash', false], ['rest', false],
    ]);
    roundTrip(result.score);
    for (const tag of ['music-rest', 'music-slash']) {
      expect(errors(rhythm(`<music-measure><music-rhythm duration="half" tie="start"></music-rhythm><${tag} duration="half" tie="end"></${tag}></music-measure>`))).toContain('invalid-tie');
    }
  });

  it('distinguishes a full-measure rest from a whole-note duration in 7/8', () => {
    const result = rhythm('<music-measure groups="2+2+3"><music-rest measure></music-rest></music-measure>', '7/8');
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ duration: 'whole', measureRest: true, time: rational(7, 8) });
    roundTrip(result.score);
    expect(errors(rhythm('<music-measure groups="2+2+3"><music-rest duration="whole"></music-rest></music-measure>', '7/8'))).toContain('measure-overfull');
  });

  it.each([
    ['clef="treble"', ''], ['key="C"', ''], ['', 'clef="bass"'], ['', 'key="Bb"'],
  ])('rejects local pitched context even if its value is neutral: staff %s measure %s', (staffContext, measureContext) => {
    const result = read(`<music-staff notation="rhythm" ${staffContext}><music-measure ${measureContext}><music-rest measure></music-rest></music-measure></music-staff>`);
    expect(errors(result)).toContain('rhythm-pitch-context');
  });

  it('rejects incompatible staff/event kinds and does not silently drop pitch attributes', () => {
    expect(errors(rhythm('<music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure>'))).toContain('pitched-event-on-rhythm-staff');
    expect(errors(rhythm('<music-measure><music-chord pitches="C4 E4" duration="whole"></music-chord></music-measure>'))).toContain('pitched-event-on-rhythm-staff');
    expect(errors(read('<music-measure><music-rhythm duration="whole"></music-rhythm></music-measure>'))).toContain('rhythm-event-on-pitched-staff');
    for (const attribute of ['pitch="C4"', 'accidental="quarter-sharp"', 'rhythmic', 'notehead="x"']) {
      expect(errors(rhythm(`<music-measure><music-rhythm ${attribute} duration="whole"></music-rhythm></music-measure>`))).toContain('unknown-attribute');
    }
    expect(errors(read('<music-staff notation="drum"><music-measure><music-rest measure></music-rest></music-measure></music-staff>'))).toContain('invalid-attribute');
  });

  it('validates programmatic rhythm models before serializing', () => {
    const valid = rhythm('<music-measure><music-rhythm duration="whole"></music-rhythm></music-measure>').score;
    const copy = (): Score => JSON.parse(JSON.stringify(valid)) as Score;
    const invalidPitch = copy();
    Object.assign(invalidPitch.staves[0].measures[0].voices[0].events[0], { pitches: [parsePitch('C4')] });
    expect(validateScore(invalidPitch).map(issue => issue.code)).toContain('invalid-event-pitches');
    expect(() => serializeScore(invalidPitch)).toThrow();
    const invalidContext = copy();
    Object.assign(invalidContext.staves[0], { key: 'G' });
    expect(validateScore(invalidContext).map(issue => issue.code)).toContain('rhythm-pitch-context');
    expect(() => serializeScore(invalidContext)).toThrow();
    const unsupported = copy();
    Object.assign(unsupported.staves[0], { notation: 'tab' });
    expect(validateScore(unsupported).map(issue => issue.code)).toContain('unsupported-value');
  });
});
