import { add, compare, equals, keyAlterations, meterBoundaries } from '../model/index.js';
import type { Measure, Meter, MusicEvent, Pitch, Rational, Voice } from '../model/types.js';

export interface EngravedAccidental {
  readonly index: number;
  readonly type: '#' | 'b' | 'n' | '##' | 'bb';
  readonly courtesy: boolean;
}

/**
 * Validated rests may share a glyph only when their written notation and exact
 * elapsed interval agree. Equal elapsed time alone does not preserve dots or
 * the distinction between a full-measure rest and a written whole rest.
 * Source identities remain separate; each tuplet keeps its own bracket/number.
 */
export function canShareRest(a: MusicEvent, b: MusicEvent): boolean {
  return a.kind === 'rest' && b.kind === 'rest'
    && a.duration === b.duration && a.dots === b.dots
    && Boolean(a.measureRest) === Boolean(b.measureRest)
    && equals(a.onset, b.onset) && equals(a.time, b.time);
}

const accidentalTypes: ReadonlyMap<number, EngravedAccidental['type']> = new Map([
  [-2, 'bb'], [-1, 'b'], [0, 'n'], [1, '#'], [2, '##'],
]);

interface PitchOccurrence {
  readonly event: MusicEvent;
  readonly pitch: Pitch;
  readonly index: number;
}

function isNonnegativeTime(value: Rational): boolean {
  return Number.isSafeInteger(value.numerator) && value.numerator >= 0
    && Number.isSafeInteger(value.denominator) && value.denominator > 0;
}

/**
 * Resolve absolute pitch spellings to printed accidentals for one staff/bar.
 * Accidentals apply to a step and octave, and all voices at an onset read the
 * same previous state. Conflicting simultaneous alterations are all printed;
 * the next attack must re-establish the accidental for that staff position.
 *
 * A validated tie continuation inherits its sound from its tie, so `auto`
 * neither repeats its accidental nor establishes a new bar-local accidental.
 * This means an untied altered note after a tie crossing a barline still gets
 * an accidental. `always`/`courtesy` on a tie prints and establishes that state.
 * Courtesy accidentals at system breaks are an explicit author choice because
 * this function deliberately has no layout or preceding-measure dependency.
 *
 * Necessary accidentals are retained on each simultaneous unison event;
 * merging coincident glyphs belongs to the renderer, not voice traversal order.
 * Keys and tie relationships are validated by the score model before engraving.
 */
export function resolveAccidentals(measure: Measure): ReadonlyMap<string, readonly EngravedAccidental[]> {
  const key = keyAlterations(measure.key);
  const allEvents = measure.voices.flatMap(voice => voice.events);
  const result = new Map<string, EngravedAccidental[]>(allEvents.map(event => [event.id, []]));
  const events = allEvents
    .filter(event => (event.kind === 'note' || event.kind === 'chord') && isNonnegativeTime(event.onset))
    .sort((left, right) => compare(left.onset, right.onset));
  // `null` means simultaneous voices left this staff position ambiguous.
  const state = new Map<string, number | null>();

  for (let first = 0; first < events.length;) {
    let end = first + 1;
    while (end < events.length && compare(events[first].onset, events[end].onset) === 0) end++;
    const occurrences = new Map<string, PitchOccurrence[]>();
    for (let cursor = first; cursor < end; cursor++) {
      const event = events[cursor];
      event.pitches.forEach((pitch, index) => {
        const position = `${pitch.step}:${pitch.octave}`;
        const group = occurrences.get(position) ?? [];
        group.push({ event, pitch, index });
        occurrences.set(position, group);
      });
    }

    for (const [position, group] of occurrences) {
      const previous = state.has(position) ? state.get(position) : key[group[0].pitch.step];
      const conflict = new Set(group.map(({ pitch }) => pitch.alter)).size > 1;
      let establishesState = false;
      for (const { event, pitch, index } of group) {
        const continuation = event.tie === 'end' || event.tie === 'continue';
        const forced = pitch.display === 'always' || pitch.display === 'courtesy';
        if (conflict || forced || (!continuation && previous !== pitch.alter)) {
          const type = accidentalTypes.get(pitch.alter);
          // Unsupported alterations are score errors; never disguise one as a natural.
          if (type !== undefined) {
            result.get(event.id)!.push(Object.freeze({ index, type, courtesy: pitch.display === 'courtesy' }));
          }
        }
        if (!continuation || forced) establishesState = true;
      }
      if (conflict) state.set(position, null);
      else if (establishesState) state.set(position, group[0].pitch.alter);
    }
    first = end;
  }

  return new Map(Array.from(result, ([id, accidentals]) => [id, Object.freeze(accidentals)]));
}

const flaggedDurations = new Set<MusicEvent['duration']>([
  'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th',
]);

function beamableAttack(event: MusicEvent): boolean {
  if (event.measureRest || !flaggedDurations.has(event.duration)) return false;
  return ((event.kind === 'note' || event.kind === 'chord') && event.pitches.length > 0)
    || (event.kind === 'slash' && event.rhythmic);
}

function beamableInterior(event: MusicEvent): boolean {
  return beamableAttack(event)
    || (event.kind === 'rest' && !event.measureRest && flaggedDurations.has(event.duration));
}

interface Interval {
  readonly onset: Rational;
  readonly end: Rational;
}

function interval(event: MusicEvent): Interval | undefined {
  if (!isNonnegativeTime(event.onset) || !isNonnegativeTime(event.time) || event.time.numerator === 0) return;
  try {
    return { onset: event.onset, end: add(event.onset, event.time) };
  } catch {
    // Invalid/overflowing user durations are diagnosed by validateScore.
    return;
  }
}

function sameTuplets(left: MusicEvent, right: MusicEvent): boolean {
  return left.tupletIds.length === right.tupletIds.length
    && left.tupletIds.every((id, index) => id === right.tupletIds[index]);
}

function boundariesFor(meter: Meter): readonly Rational[] {
  if (!Number.isSafeInteger(meter.numerator) || meter.numerator <= 0
    || !Number.isSafeInteger(meter.denominator) || meter.denominator <= 0
    || !meter.groups.length
    || meter.groups.some(group => !Number.isSafeInteger(group) || group <= 0)
    || meter.groups.reduce((sum, group) => sum + group, 0) !== meter.numerator) return [];
  try {
    return meterBoundaries(meter);
  } catch {
    return [];
  }
}

/**
 * Choose event membership only; the engraving backend draws duration-specific
 * beam levels, hooks, slopes, and stems. Automatic groups never cross a beat
 * group, a rest, a tuplet boundary, a conflicting explicit stem direction, or a
 * discontinuity in the voice's time. A single explicit direction can govern
 * otherwise automatic stems anywhere within its group.
 *
 * A complete explicit start..end range overrides meter and tuplet grouping and
 * may contain short rests. It needs beamable attacks at both ends. Corrupt or
 * unfinished ranges are left unbeamed (including their contents), never partly
 * interpreted as a different group; validation reports the source error.
 */
export function groupBeams(voice: Voice, meter: Meter): readonly (readonly string[])[] {
  const boundaries = boundariesFor(meter);
  const groups: (readonly string[])[] = [];
  let automatic: MusicEvent[] = [];
  let automaticSlot = -1;
  let automaticStem: MusicEvent['stem'] = 'auto';
  let previousInterval: Interval | undefined;

  const flush = () => {
    if (automatic.length > 1) groups.push(Object.freeze(automatic.map(event => event.id)));
    automatic = [];
    automaticSlot = -1;
    automaticStem = 'auto';
    previousInterval = undefined;
  };

  for (let index = 0; index < voice.events.length;) {
    const event = voice.events[index];
    if (event.beam === 'start') {
      flush();
      let depth = 0;
      let last = index;
      let valid = true;
      let preceding: Interval | undefined;
      for (; last < voice.events.length; last++) {
        const member = voice.events[last];
        if (member.beam === 'start') {
          depth++;
          if (depth > 1) valid = false;
        }
        if (member.beam === 'end') depth--;
        const span = interval(member);
        if (!beamableInterior(member) || member.beam === 'none' || !span
          || (preceding && span && compare(preceding.end, span.onset) !== 0)) valid = false;
        preceding = span;
        if (depth === 0) break;
      }
      if (last < voice.events.length && valid && last > index
        && beamableAttack(event) && beamableAttack(voice.events[last])) {
        groups.push(Object.freeze(voice.events.slice(index, last + 1).map(member => member.id)));
      }
      index = last + 1;
      continue;
    }

    const span = interval(event);
    if (event.beam !== 'auto' || !beamableAttack(event) || !span) {
      flush();
      index++;
      continue;
    }
    const slot = boundaries.findIndex(boundary => compare(span.onset, boundary) < 0);
    // A single syncopated note that crosses a group boundary stays flagged.
    if (slot < 0 || compare(span.end, boundaries[slot]) > 0) {
      flush();
      index++;
      continue;
    }
    const conflictingStem = event.stem !== 'auto' && automaticStem !== 'auto' && event.stem !== automaticStem;
    if (automatic.length && (slot !== automaticSlot || !sameTuplets(automatic[0], event) || conflictingStem
      || !previousInterval || compare(previousInterval.end, span.onset) !== 0)) flush();
    automatic.push(event);
    automaticSlot = slot;
    if (event.stem !== 'auto') automaticStem = event.stem;
    previousInterval = span;
    index++;
  }
  flush();
  return Object.freeze(groups);
}
