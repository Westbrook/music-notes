import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readScore } from '../src/dom/index.js';
import { parseSource } from '../src/authoring/project.js';
import { createPlaybackPlan } from '../src/authoring/playback-plan.js';
import { encodeWav } from '../src/authoring/playback-audio.js';

function plan(contents: string, bpm?: number) {
  return createPlaybackPlan(readScore(parseSource(`<music-staff clef="bass"><music-measure><music-meter top="4" bottom="4"></music-meter>${contents}</music-measure></music-staff>`)).score, bpm);
}

describe('accepted score playback', () => {
  it('plays the actual edited octaves, mixed meters, rests and articulations', () => {
    const source = readFileSync('tests/fixtures/listen-score.music.html', 'utf8');
    const score = readScore(parseSource(source)).score;
    const result = createPlaybackPlan(score);
    expect(result.duration).toBe(8.25);
    expect(result.cues).toHaveLength(18);
    expect(result.notes.map(note => Math.round(69 + 12 * Math.log2(note.frequency / 440)))).toEqual([55,55,55,48,56,52,51,62,57,59,53,61,58,54]);
    expect(result.notes[0].end).toBe(.75); // Tenuto spans the full quarter.
    expect(result.notes[4].end - result.notes[4].start).toBe(.28125); // Staccato halves the dotted eighth's sounding time.
    expect(result.notes[10].start).toBe(6.9375); // Beat 3 begins with a sixteenth rest.
    expect(result.notices).toEqual([]);
  });
  it('integrates tempo changes within a sustained note and scales them proportionally', () => {
    const music = '<music-tempo bpm="120" at="0"></music-tempo><music-tempo bpm="60" at="1/2"></music-tempo><music-note pitch="C3" duration="whole"><music-articulation type="tenuto"></music-articulation></music-note>';
    expect(plan(music).duration).toBe(3);
    expect(plan(music).notes[0].end).toBe(3);
    expect(plan(music, 60).duration).toBe(6);
    expect(plan('<music-tempo bpm="80" beat="eighth" dots="1"></music-tempo><music-rest measure></music-rest>').duration).toBe(4);
  });
  it('sustains ties without a new attack while preserving separate highlight cues', () => {
    const result = plan('<music-note pitch="C3" duration="half" tie="start"></music-note><music-note pitch="C3" duration="half" tie="end"></music-note>', 120);
    expect(result.notes).toHaveLength(1); expect(result.cues).toHaveLength(2);
    expect(result.notes[0].end).toBeCloseTo(1.94);
    expect(result.cues[1].start).toBe(1);
  });
  it('plays chord pitches and quarter-tones using authored pitch rather than the key signature', () => {
    const result = plan('<music-chord pitches="Cqs3 E3 G3" duration="whole"></music-chord>');
    expect(result.notes).toHaveLength(3);
    expect(result.notes[0].frequency).toBeCloseTo(440 * 2 ** ((48.5 - 69) / 12));
    expect(result.notes.every(note => note.start === 0)).toBe(true);
  });
  it('uses exact tuplet durations already resolved by the musical model', () => {
    const result = plan('<music-tuplet actual="3" normal="2"><music-note pitch="C3" duration="quarter"></music-note><music-note pitch="D3" duration="quarter"></music-note><music-note pitch="E3" duration="quarter"></music-note></music-tuplet><music-rest duration="half"></music-rest>', 120);
    expect(result.duration).toBe(2);
    expect(result.notes[1].start).toBeCloseTo(1 / 3);
    expect(result.notes[2].start).toBeCloseTo(2 / 3);
  });
  it('plays an empty draft as a silent measure without inventing written events', () => {
    const empty = readScore(parseSource('<music-staff><music-measure incomplete></music-measure></music-staff>')).score;
    const result = createPlaybackPlan(empty);
    expect(result.duration).toBe(3);
    expect(result.notes).toEqual([]); expect(result.cues).toEqual([]);
    expect(result.notices.join(' ')).toMatch(/play as rests/);
  });
  it('pads consecutive short and empty measures across meter changes without changing the score', () => {
    const score = readScore(parseSource(`<music-staff>
      <music-measure incomplete><music-note id="first" pitch="C3" duration="quarter"></music-note></music-measure>
      <music-measure incomplete meter="3/4"></music-measure>
      <music-measure incomplete><music-note id="last" pitch="G3" duration="16th"></music-note></music-measure>
    </music-staff>`)).score;
    const before = structuredClone(score);
    const result = createPlaybackPlan(score, 120);
    expect(result.duration).toBe(5);
    expect(result.cues).toEqual([{ id: 'first', start: 0, end: .5 }, { id: 'last', start: 3.5, end: 3.625 }]);
    expect(result.notes).toHaveLength(2);
    expect(result.notices).toHaveLength(1);
    expect(score).toEqual(before);
  });
  it('keeps staves and voices aligned when they have different amounts of unwritten time', () => {
    const score = readScore(parseSource(`<music-system>
      <music-staff><music-measure incomplete>
        <music-voice><music-note id="short" pitch="C3" duration="quarter"></music-note></music-voice>
        <music-voice><music-note id="long" pitch="E3" duration="half"></music-note></music-voice>
      </music-measure><music-measure><music-note id="next-a" pitch="G3" duration="whole"></music-note></music-measure></music-staff>
      <music-staff><music-measure incomplete></music-measure>
        <music-measure><music-note id="next-b" pitch="C4" duration="whole"></music-note></music-measure>
      </music-staff>
    </music-system>`)).score;
    const result = createPlaybackPlan(score, 120);
    expect(result.duration).toBe(4);
    expect(result.cues).toEqual([{ id: 'short', start: 0, end: .5 }, { id: 'long', start: 0, end: 1 },
      { id: 'next-a', start: 2, end: 4 }, { id: 'next-b', start: 2, end: 4 }]);
  });
  it('keeps a pickup short while padding the following unfinished ordinary measure', () => {
    const score = readScore(parseSource(`<music-staff>
      <music-measure pickup><music-note pitch="C3" duration="quarter"></music-note></music-measure>
      <music-measure incomplete><music-note pitch="D3" duration="half"></music-note></music-measure>
    </music-staff>`)).score;
    const result = createPlaybackPlan(score, 120);
    expect(result.duration).toBe(2.5);
    expect(result.notes[1].start).toBe(.5);
  });
  it('honors tempo changes during padded silence', () => {
    const score = readScore(parseSource(`<music-staff>
      <music-measure incomplete><music-tempo bpm="120"></music-tempo><music-note pitch="C3" duration="quarter"></music-note><music-tempo bpm="60" at="1/2"></music-tempo></music-measure>
      <music-measure incomplete><music-note pitch="D3" duration="quarter"></music-note></music-measure>
    </music-staff>`)).score;
    const result = createPlaybackPlan(score);
    expect(result.notes[1].start).toBe(3);
    expect(result.duration).toBe(7);
  });
  it('still rejects overflowing measures, unsupported pitches and invalid tempos', () => {
    expect(() => plan('<music-note pitch="C3" duration="whole"></music-note><music-rest duration="quarter"></music-rest>')).toThrow(/exceed|overflow|contains/i);
    expect(() => plan('<music-slash duration="whole"></music-slash>')).toThrow(/written pitches/);
    expect(() => plan('<music-rest measure></music-rest>', NaN)).toThrow(/tempo/);
    expect(() => plan('<music-rest measure></music-rest>', 0)).toThrow(/tempo/);
  });
  it('discloses notation without a playback interpretation', () => {
    const result = plan('<music-note pitch="C3" duration="whole"><music-articulation type="fermata"></music-articulation></music-note>');
    expect(result.notices.join(' ')).toMatch(/fermata/);
  });
});

describe('portable WAV output', () => {
  it('writes a valid interleaved PCM header and exact signed sample values', () => {
    const bytes = encodeWav({ numberOfChannels: 2, length: 3, sampleRate: 44100, getChannelData: channel => new Float32Array(channel ? [.5, -.5, 0] : [-1, 0, 1]) });
    const data = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(data.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(data.getUint16(22, true)).toBe(2); expect(data.getUint32(24, true)).toBe(44100);
    expect(data.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_, i) => data.getInt16(44 + i * 2, true))).toEqual([-32768, 16384, 0, -16384, 32767, 0]);
  });
});
