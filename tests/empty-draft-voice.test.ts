// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readScore, serializeScore } from '../src/dom/index.js';
import { parseMeter, parsePitch, rational, validateScore } from '../src/model/index.js';
import type { Measure, MusicEvent, Score, StaffNotation, Voice } from '../src/model/types.js';

const empty = (id = 'empty'): Voice => ({ id, events: [], tuplets: [] });
const note = (id: string, tie: MusicEvent['tie'] = 'none'): MusicEvent => ({
  id, kind: 'note', pitches: [parsePitch('F4')], duration: 'whole', dots: 0,
  onset: rational(0), time: rational(1), tupletIds: [], beam: 'auto', stem: 'auto',
  tie, measureRest: false, rhythmic: false,
});
const written = (id: string, event: MusicEvent): Voice => ({ id, events: [event], tuplets: [] });
const measure = (id: string, voices: readonly Voice[], options: Partial<Measure> = {}): Measure => ({
  id, number: id, meter: parseMeter(), clef: 'treble', key: 'C', voices,
  annotations: [], breakBefore: 'auto', keepWithNext: false, endBar: 'single',
  repeatStart: false, pickup: false, incomplete: true, ...options,
});
const score = (measures: readonly Measure[], notation: StaffNotation = 'pitched'): Score => ({
  id: 'score', label: 'Blank draft', bracket: 'none',
  staves: [{ id: 'staff', label: '', notation, clef: 'treble', key: 'C', measures }],
});
function source(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}
const errors = (value: Score) => validateScore(value).filter(item => item.severity === 'error');

describe('empty ordinary draft voices', () => {
  it.each(['pitched', 'rhythm', 'three-roads'] as const)('allows a blank %s voice without inventing a musical event', notation => {
    const value = score([measure('bar', [empty()])], notation);
    const before = JSON.stringify(value);
    const diagnostics = validateScore(value);
    expect(diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'empty-voice', severity: 'warning', sourceId: 'empty', measureId: 'bar',
    }));
    expect(diagnostics.find(item => item.code === 'empty-voice')!.message).toMatch(/write|add/i);
    expect(diagnostics.find(item => item.code === 'empty-voice')!.message).toMatch(/rest/i);
    expect(JSON.stringify(value)).toBe(before);
    expect(value.staves[0].measures[0].voices[0]).toEqual(empty());
  });

  it.each([
    { name: 'complete ordinary measure', incomplete: false, pickup: false },
    { name: 'complete pickup', incomplete: false, pickup: true },
    { name: 'incomplete pickup', incomplete: true, pickup: true },
  ])('keeps an empty $name invalid', ({ incomplete, pickup }) => {
    expect(errors(score([measure('bar', [empty()], { incomplete, pickup })])))
      .toContainEqual(expect.objectContaining({ code: 'empty-voice', sourceId: 'empty', measureId: 'bar' }));
  });

  it.each([0, 1])('keeps an empty voice at index %s independent of written music', emptyIndex => {
    const voices = [written('written', note('retained'))];
    voices.splice(emptyIndex, 0, empty());
    const value = score([measure('bar', voices)]);
    const before = JSON.stringify(value);
    expect(errors(value)).toEqual([]);
    expect(validateScore(value).filter(item => item.code === 'empty-voice')).toEqual([
      expect.objectContaining({ severity: 'warning', sourceId: 'empty', measureId: 'bar' }),
    ]);
    expect(value.staves[0].measures[0].voices[1 - emptyIndex].events).toEqual([note('retained')]);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('does not turn a missing voice collection into an allowed blank voice', () => {
    expect(errors(score([measure('bar', [])]))).toContainEqual(expect.objectContaining({ code: 'empty-measure' }));
    const missing = { ...measure('bar', []), voices: undefined } as unknown as Measure;
    expect(errors(score([missing]))).toContainEqual(expect.objectContaining({ code: 'invalid-structure' }));
  });

  it('keeps missing event arrays and empty tuplets invalid inside a draft voice', () => {
    const missing = { id: 'empty', tuplets: [] } as unknown as Voice;
    expect(errors(score([measure('bar', [missing])]))).toContainEqual(expect.objectContaining({ code: 'invalid-structure' }));
    const tuplet: Voice = { ...empty(), tuplets: [{ id: 'tuplet', actual: 3, normal: 2, eventIds: [], bracket: 'auto', showRatio: false }] };
    expect(errors(score([measure('bar', [tuplet])]))).toContainEqual(expect.objectContaining({ code: 'empty-tuplet', sourceId: 'tuplet' }));
  });

  it('still rejects malformed boolean declarations instead of accepting a truthy draft flag', () => {
    const invalid = { ...measure('bar', [empty()]), incomplete: 'true' } as unknown as Measure;
    expect(errors(score([invalid]))).toContainEqual(expect.objectContaining({ code: 'invalid-boolean' }));
    expect(errors(score([invalid]))).toContainEqual(expect.objectContaining({ code: 'empty-voice' }));
  });

  it('still accepts a written pickup and reports nonempty draft underfill separately', () => {
    const quarter = { ...note('n'), duration: 'quarter' as const, time: rational(1, 4) };
    expect(errors(score([measure('bar', [written('voice', quarter)], { pickup: true, incomplete: false })]))).toEqual([]);
    expect(validateScore(score([measure('bar', [written('voice', quarter)])]))).toEqual([
      expect.objectContaining({ code: 'incomplete-measure', severity: 'warning' }),
    ]);
  });
});

describe('blank voices remain blank through authored DOM roundtrips', () => {
  it.each([
    ['implicit', ''],
    ['explicit', '<music-voice id="blank"></music-voice>'],
  ])('retains a %s voice, context, and annotations without manufacturing a rest', (_, content) => {
    const root = source(`<music-staff id="lead" key="Eb"><music-measure id="bar" number="A" meter="7/8" groups="2+2+3" incomplete end-bar="double">
      <music-direction id="cue" at="1/2">Await a cue</music-direction>${content}
    </music-measure></music-staff>`);
    const original = root.outerHTML;
    const accepted = readScore(root);
    expect(accepted.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    const bar = accepted.score.staves[0].measures[0];
    expect(bar).toMatchObject({ id: 'bar', number: 'A', key: 'Eb', incomplete: true, pickup: false, endBar: 'double' });
    expect(bar.voices).toHaveLength(1);
    expect(bar.voices[0].events).toEqual([]);
    expect(bar.voices[0].tuplets).toEqual([]);
    expect(accepted.sources.get(bar.voices[0].id)).toBe(root.querySelector('music-voice') ?? root.querySelector('music-measure'));
    const serialized = serializeScore(accepted.score);
    expect(serialized).not.toMatch(/<music-(?:rest|note|chord|rhythm|road|slash)\b/);
    const reread = readScore(source(serialized));
    expect(reread.score).toEqual(accepted.score);
    expect(reread.diagnostics).toContainEqual(expect.objectContaining({
      code: 'empty-voice', severity: 'warning', sourceId: bar.voices[0].id, measureId: 'bar',
    }));
    expect(root.outerHTML).toBe(original);
  });

  it('roundtrips mixed written and empty voices with exact independent identities', () => {
    const root = source('<music-measure id="bar" incomplete><music-voice id="upper"><music-note id="held" pitch="G4" duration="whole"></music-note></music-voice><music-voice id="lower"></music-voice></music-measure>');
    const accepted = readScore(root);
    expect(accepted.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    const serialized = serializeScore(accepted.score);
    expect(readScore(source(serialized)).score).toEqual(accepted.score);
    expect(accepted.score.staves[0].measures[0].voices.map(voice => [voice.id, voice.events.map(event => event.id)]))
      .toEqual([['upper', ['held']], ['lower', []]]);
    expect(source(serialized).querySelectorAll('music-note')).toHaveLength(1);
    expect(source(serialized).querySelectorAll('music-rest')).toHaveLength(0);
  });

  it.each(['', 'pickup', 'pickup incomplete'])('does not allow blank source with measure attributes "%s"', attributes => {
    const result = readScore(source(`<music-measure id="bar" ${attributes}><music-voice id="blank"></music-voice></music-measure>`));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'empty-voice', severity: 'error' }));
  });

  it('still rejects an authored empty tuplet in a blank draft', () => {
    const result = readScore(source('<music-measure incomplete><music-voice id="blank"><music-tuplet id="empty-tuplet" actual="3" normal="2"></music-tuplet></music-voice></music-measure>'));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'empty-tuplet', severity: 'error' }));
  });
});

describe('a blank voice cannot imply a sustained tied event', () => {
  it('stops a pending tie at an empty voice and rejects the later orphan continuation', () => {
    const value = score([
      measure('start-bar', [written('start-voice', note('start', 'start'))], { incomplete: false }),
      measure('blank-bar', [empty()]),
      measure('end-bar', [written('end-voice', note('end', 'end'))], { incomplete: false }),
    ]);
    expect(errors(value)).toContainEqual(expect.objectContaining({ code: 'unclosed-tie', sourceId: 'start', measureId: 'start-bar', message: expect.stringMatching(/empty voice/i) }));
    expect(errors(value)).toContainEqual(expect.objectContaining({ code: 'orphan-tie', sourceId: 'end', measureId: 'end-bar' }));
  });

  it('does not break another simultaneous voice’s explicit tied continuation', () => {
    const value = score([
      measure('start-bar', [written('upper-start', note('start', 'start')), written('lower-start', note('other-start', 'start'))]),
      measure('blank-bar', [empty(), written('lower-mid', note('other-mid', 'continue'))]),
      measure('end-bar', [written('upper-end', note('end', 'end')), written('lower-end', note('other-end', 'end'))]),
    ]);
    expect(errors(value).map(item => [item.code, item.sourceId])).toEqual([['unclosed-tie', 'start'], ['orphan-tie', 'end']]);
  });

  it('preserves the existing missing-voice barrier', () => {
    const value = score([
      measure('start-bar', [written('voice', note('start', 'start'))]),
      measure('missing-bar', []),
      measure('end-bar', [written('end-voice', note('end', 'end'))]),
    ]);
    expect(errors(value)).toContainEqual(expect.objectContaining({ code: 'unclosed-tie', sourceId: 'start', message: expect.stringMatching(/disappear/) }));
    expect(errors(value)).toContainEqual(expect.objectContaining({ code: 'orphan-tie', sourceId: 'end' }));
  });
});
