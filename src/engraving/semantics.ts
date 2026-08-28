import { add, compare, equals, formatRational, keyAlterations, meterBoundaries } from '../model/index.js';
import type { EventMarking, MarkingPlacement, Measure, Meter, MusicEvent, Pitch, Rational, Voice } from '../model/types.js';
import type { InkBox } from './geometry.js';

export interface EngravedAccidental {
  readonly index: number;
  readonly type: '#' | 'b' | 'n' | '##' | 'bb' | 'd' | 'db' | '+' | '++';
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
    // A marked rest owns its own fermata and source target, even when another
    // voice has an otherwise identical rest and marking.
    && !a.markings?.length && !b.markings?.length
    && a.duration === b.duration && a.dots === b.dots
    && Boolean(a.measureRest) === Boolean(b.measureRest)
    && equals(a.onset, b.onset) && equals(a.time, b.time);
}

/** Standard symbols always oppose the printed stem; only intervals author a side. */
export function eventMarkingPlacement(marking: EventMarking, stem: 'up' | 'down' | 'none'): MarkingPlacement {
  if (marking.kind === 'interval') return marking.placement;
  // Legacy standard-mark placement remains serializable source data, but it
  // cannot override this rule, including for fermatas, ornaments or polyphony.
  return stem === 'up' ? 'below' : 'above';
}

/** Intervals stay nearest their head; longer symbols occupy successively outer positions. */
export function eventMarkingOrder(marking: EventMarking): number {
  if (marking.kind === 'interval') return marking.interval.number * 0.02 + marking.interval.alter * 0.001;
  if (marking.kind === 'ornament') return 8;
  return { staccato: 1, tenuto: 2, staccatissimo: 3, accent: 4, marcato: 5, fermata: 6 }[marking.type];
}

export interface MarkingPlacementRequest {
  readonly head: InkBox;
  readonly width: number;
  readonly height: number;
  readonly placement: MarkingPlacement;
  readonly obstacles: readonly InkBox[];
  /** Fermatas, marcato and ornaments conventionally stay outside the staff. */
  readonly outsideStaff?: { readonly top: number; readonly bottom: number };
  /** A bounded shift can avoid a stem without separating a wide figure from its head. */
  readonly lateralShift?: number;
  readonly preferredShift?: -1 | 1;
}

/**
 * Find the closest clear ink box on the requested side. Every vertical move
 * passes at least one obstacle, so crowded notation cannot create an unbounded
 * retry loop. The algorithm does not move source notes or flip interval meaning.
 */
export function placeEventMarking(request: MarkingPlacementRequest): InkBox {
  const { head, width, height, placement, obstacles, outsideStaff } = request;
  const gap = 2;
  const center = head.x + head.width / 2;
  const limit = Math.min(Math.max(0, request.lateralShift ?? 0), width / 2);
  const preferred = request.preferredShift ?? -1;
  const shifts = limit ? [0, preferred * limit / 2, -preferred * limit / 2, preferred * limit, -preferred * limit] : [0];
  const nearest = placement === 'above' ? head.y - height - 3 : head.y + head.height + 3;
  const initial = outsideStaff ? placement === 'above'
    ? Math.min(nearest, outsideStaff.top - height - 4)
    : Math.max(nearest, outsideStaff.bottom + 4) : nearest;
  let best: InkBox | undefined;
  let bestCost = Infinity;
  for (const shift of shifts) {
    const x = center + shift - width / 2;
    let y = initial;
    const horizontal = obstacles.filter(box => x < box.x + box.width + gap && box.x < x + width + gap);
    for (let iteration = 0; iteration <= horizontal.length; iteration++) {
      const collisions = horizontal.filter(box => y < box.y + box.height + gap && box.y < y + height + gap);
      if (!collisions.length) break;
      y = placement === 'above'
        ? Math.min(...collisions.map(box => box.y - gap - height))
        : Math.max(...collisions.map(box => box.y + box.height + gap));
    }
    // A local lateral adjustment is preferable to jumping an entire stem,
    // but never displace a clear centered symbol merely to save a pixel.
    const cost = Math.abs(y - initial) + Math.abs(shift) * 1.5;
    if (cost < bestCost) {
      bestCost = cost;
      best = { x, y, width, height };
    }
  }
  return best!;
}

const accidentalTypes: ReadonlyMap<number, EngravedAccidental['type']> = new Map([
  [-2, 'bb'], [-1.5, 'db'], [-1, 'b'], [-0.5, 'd'], [0, 'n'],
  [0.5, '+'], [1, '#'], [1.5, '++'], [2, '##'],
]);

/** VexFlow's Stein–Zimmermann glyph codes stay inside the engraving adapter. */
export function accidentalType(alter: number): EngravedAccidental['type'] | undefined {
  return accidentalTypes.get(alter);
}

/** Differently altered notes on the same staff position cannot share a head. */
export function hasSimultaneousPitchConflict(measure: Measure): boolean {
  const positions = new Map<string, number>();
  for (const voice of measure.voices) for (const event of voice.events) {
    if (event.kind !== 'note' && event.kind !== 'chord') continue;
    for (const pitch of event.pitches) {
      const position = `${formatRational(event.onset)}:${pitch.step}:${pitch.octave}`;
      if (positions.has(position) && positions.get(position) !== pitch.alter) return true;
      positions.set(position, pitch.alter);
    }
  }
  return false;
}

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
          const type = accidentalType(pitch.alter);
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
    || event.kind === 'rhythm' || event.kind === 'road'
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
