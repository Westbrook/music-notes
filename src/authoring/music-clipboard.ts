import { readScore, serializeScore } from '../dom/index.js';
import { add, rational } from '../model/index.js';
import type { MusicEvent, Score } from '../model/types.js';
import { parseSource } from './project.js';

export const MUSIC_CLIPBOARD_TYPE = 'application/x-music-notes-passage';
const PREFIX = 'Music Notes passage v1\n';
const LIMIT = 1_000_000;

/** A portable snapshot of exact membership, ordered by the score, never click order. */
export function copyMusic(score: Score, ids: readonly string[]): string {
  const chosen = new Set(ids);
  if (!ids.length || chosen.size !== ids.length || ids.length > 4096) throw new Error('Select up to 4,096 notes or rests to copy.');
  const places = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap((voice, voiceIndex) =>
    voice.events.filter(event => chosen.has(event.id)).map(event => ({ staff, voiceIndex, event })))));
  const first = places[0];
  if (places.length !== ids.length || !first || places.some(place => place.staff.id !== first.staff.id || place.voiceIndex !== first.voiceIndex)) {
    throw new Error('Copy notes from one staff and voice at a time.');
  }
  const all = first.staff.measures.flatMap(measure => measure.voices[first.voiceIndex]?.events ?? []);
  const retained = new Map<string, MusicEvent>();
  all.forEach((event, index) => {
    if (!chosen.has(event.id)) return;
    const incoming = (event.tie === 'end' || event.tie === 'continue') && chosen.has(all[index - 1]?.id);
    const outgoing = (event.tie === 'start' || event.tie === 'continue') && chosen.has(all[index + 1]?.id);
    retained.set(event.id, { ...event, tie: incoming ? outgoing ? 'continue' : 'end' : outgoing ? 'start' : 'none',
      // The destination beat grouping may differ, and a selection can cut an authored beam.
      beam: event.beam === 'none' ? 'none' : 'auto' });
  });
  const measures = first.staff.measures.flatMap(measure => {
    const voice = measure.voices[first.voiceIndex];
    if (!voice) return [];
    let onset = rational(0);
    const events = voice.events.flatMap(event => {
      const copied = retained.get(event.id);
      if (!copied) return [];
      const result = { ...copied, onset }; onset = add(onset, event.time); return [result];
    });
    if (!events.length) return [];
    return [{ ...measure, pickup: false, incomplete: true, annotations: [], repeatStart: false, endBar: 'single' as const,
      voices: [{ ...voice, events, tuplets: voice.tuplets.map(tuplet => ({ ...tuplet, eventIds: tuplet.eventIds.filter(id => chosen.has(id)) })).filter(tuplet => tuplet.eventIds.length) }] }];
  });
  const html = serializeScore({ ...score, bracket: 'none', staves: [{ ...first.staff, measures }] });
  const text = PREFIX + JSON.stringify({ source: html });
  if (text.length > LIMIT) throw new Error('This passage is too large to copy. Select a shorter passage.');
  return text;
}

/** Clipboard contents are untrusted; reuse the inert, allowlisted musical parser. */
export function readMusicClipboard(text: string): ReturnType<typeof readScore> {
  if (!text.startsWith(PREFIX)) throw new Error('Copy notes in Select mode before pasting music here.');
  if (text.length > LIMIT) throw new Error('This clipboard passage is too large. Copy a shorter passage.');
  let payload: unknown;
  try { payload = JSON.parse(text.slice(PREFIX.length)); } catch { throw new Error('The copied music is damaged. Copy the passage again.'); }
  if (!payload || typeof payload !== 'object' || !('source' in payload) || typeof payload.source !== 'string') throw new Error('The copied music is damaged. Copy the passage again.');
  const parsed = readScore(parseSource(payload.source));
  const count = parsed.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).length;
  if (parsed.score.staves.length !== 1 || !count || count > 4096
    || parsed.score.staves[0].measures.some(measure => measure.voices.length !== 1 || measure.annotations.length)) {
    throw new Error('Paste needs a copied passage from one staff and voice.');
  }
  return parsed;
}
