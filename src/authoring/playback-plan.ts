import { durationTime, meterTime, toNumber, validateScore } from '../model/index.js';
import type { MusicEvent, Score } from '../model/types.js';

export interface PlaybackNote { readonly frequency: number; readonly start: number; readonly end: number; readonly gain: number }
export interface PlaybackCue { readonly id: string; readonly start: number; readonly end: number }
export interface PlaybackPlan {
  readonly notes: readonly PlaybackNote[];
  readonly cues: readonly PlaybackCue[];
  readonly duration: number;
  readonly baseBpm: number;
  readonly startBpm: number;
  readonly notices: readonly string[];
}
interface RawNote { midi: number; start: number; end: number; off: number; gain: number }
const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const dynamics: Record<string, number> = { pppp: .2, ppp: .3, pp: .4, p: .5, mp: .65, mf: .8, f: .95, ff: 1.1, fff: 1.2, ffff: 1.3, sfz: 1.15, sf: 1.1, fp: .8 };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-8;

function attack(event: MusicEvent): { gate: number; gain: number } {
  const marks = new Set(event.markings?.filter(mark => mark.kind === 'articulation').map(mark => mark.type));
  return { gate: marks.has('staccatissimo') ? .25 : marks.has('staccato') ? .5 : marks.has('tenuto') ? 1 : marks.has('marcato') ? .75 : .94,
    gain: marks.has('marcato') ? 1.3 : marks.has('accent') ? 1.2 : 1 };
}

/** Musical timing comes from the accepted model, never SVG positions or saved files. */
export function createPlaybackPlan(score: Score, startingBpm?: number): PlaybackPlan {
  if (startingBpm !== undefined && (!Number.isFinite(startingBpm) || startingBpm < 20 || startingBpm > 300)) throw new Error('Choose a starting tempo from 20 to 300 quarter notes per minute.');
  const diagnostics = validateScore(score);
  const error = diagnostics.find(item => item.severity === 'error');
  if (error) throw new Error(`Correct the music before listening. ${error.message}`);
  const reference = score.staves[0];
  if (!reference?.measures.length) throw new Error('Write some music before listening.');
  const offsets: number[] = [];
  let total = 0;
  for (const measure of reference.measures) {
    offsets.push(total);
    const length = measure.pickup ? measure.voices[0].events.reduce((sum, event) => sum + toNumber(event.time) * 4, 0) : toNumber(meterTime(measure.meter)) * 4;
    total += length;
  }
  const notices = new Set<string>();
  const tempos = new Map<number, number>();
  const notes: RawNote[] = [];
  const cues: PlaybackCue[] = [];
  for (const staff of score.staves) {
    let level = .8;
    const ties = new Map<string, RawNote>();
    staff.measures.forEach((measure, index) => {
      const offset = offsets[index];
      if (measure.repeatStart || measure.endBar === 'repeat-end') notices.add('Repeat signs are not expanded yet; this preview plays the written measures once.');
      const changes: { beat: number; gain: number }[] = [{ beat: 0, gain: level }];
      for (const annotation of [...measure.annotations].sort((a, b) => toNumber(a.onset) - toNumber(b.onset))) {
        const beat = toNumber(annotation.onset) * 4;
        if (annotation.kind === 'tempo' && annotation.bpm !== undefined) {
          const bpm = annotation.bpm * toNumber(durationTime(annotation.beat ?? 'quarter', annotation.dots ?? 0)) * 4;
          const at = offset + beat;
          if (tempos.has(at) && !near(tempos.get(at)!, bpm)) throw new Error('Conflicting tempo marks occur at the same position. Resolve them before listening.');
          if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('Tempo must be positive.');
          tempos.set(at, bpm);
        } else if (annotation.kind === 'tempo') notices.add('Text-only tempo instructions use the starting tempo setting.');
        if (annotation.kind === 'dynamics') {
          const next = dynamics[annotation.text.trim().toLowerCase()];
          if (next !== undefined) { level = next; changes.push({ beat, gain: next }); }
          else notices.add('Unrecognized dynamic text is not interpreted.');
        }
      }
      measure.voices.forEach((voice, voiceIndex) => {
        const written = voice.events.reduce((sum, event) => sum + toNumber(event.time) * 4, 0);
        // Ordinary bar offsets already span the full meter. Scheduling only
        // authored events leaves the unwritten remainder silent in every voice.
        if (!measure.pickup && !near(written, toNumber(meterTime(measure.meter)) * 4)) notices.add('Unwritten beats in incomplete measures play as rests. Your score is unchanged.');
        for (const event of voice.events) {
          const local = toNumber(event.onset) * 4;
          const start = offset + local;
          const length = toNumber(event.time) * 4;
          const end = start + length;
          cues.push({ id: event.id, start, end });
          for (const mark of event.markings ?? []) if (mark.kind === 'ornament' || mark.kind === 'articulation' && mark.type === 'fermata') notices.add('Ornaments and fermatas are shown in the score but are not interpreted in this preview.');
          if (event.kind === 'rest') continue;
          if (event.kind !== 'note' && event.kind !== 'chord') throw new Error('Listen needs written pitches. Rhythm, slash and 3 roads events do not yet have a playback interpretation. Choose a pitched part.');
          const articulation = attack(event);
          const gain = changes.filter(change => change.beat <= local).at(-1)!.gain * articulation.gain;
          for (const pitch of event.pitches) {
            const midi = (pitch.octave + 1) * 12 + semitones[pitch.step] + pitch.alter;
            const key = `${voiceIndex}:${midi}`;
            if (event.tie === 'continue' || event.tie === 'end') {
              const previous = ties.get(key);
              if (!previous || !near(previous.end, start)) throw new Error('A tie cannot be played without its adjacent starting note.');
              previous.end = end; previous.off = start + length * articulation.gate;
              if (event.tie === 'end') ties.delete(key);
            } else {
              const note = { midi, start, end, off: start + length * articulation.gate, gain };
              notes.push(note);
              if (event.tie === 'start') ties.set(key, note);
            }
          }
        }
      });
    });
    if (ties.size) throw new Error('Finish open ties before listening.');
  }
  const baseBpm = tempos.get(0) ?? 80;
  if (!tempos.has(0)) tempos.set(0, baseBpm);
  const scale = (startingBpm ?? baseBpm) / baseBpm;
  const segments = [...tempos].sort((a, b) => a[0] - b[0]);
  const seconds = (beat: number): number => {
    let result = 0;
    for (let i = 0; i < segments.length && segments[i][0] < beat; i++) {
      const [start, bpm] = segments[i];
      result += (Math.min(beat, segments[i + 1]?.[0] ?? beat) - start) * 60 / (bpm * scale);
    }
    return result;
  };
  const duration = seconds(total);
  if (!Number.isFinite(duration) || duration > 600 || notes.length > 25_000) throw new Error('This preview supports up to 10 minutes and 25,000 sounding notes. Choose a shorter part or a faster tempo.');
  return { notes: notes.map(note => ({ frequency: 440 * 2 ** ((note.midi - 69) / 12), start: seconds(note.start), end: seconds(note.off), gain: note.gain })),
    cues: cues.map(cue => ({ ...cue, start: seconds(cue.start), end: seconds(cue.end) })), duration, baseBpm, startBpm: startingBpm ?? baseBpm, notices: [...notices] };
}
