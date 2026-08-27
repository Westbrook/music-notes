import { durationTime } from './duration';
import { meterTime, parseMeter } from './meter';
import { pitchText, validateClef, validateKey } from './pitch';
import { add, compare, divide, equals, formatRational, multiply, rational } from './rational';
import type { Diagnostic, Duration, Measure, Meter, MusicEvent, Rational, Score, Tuplet, Voice } from './types';

const ZERO = rational(0);
const WRITTEN_UNITS = (['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th'] satisfies Duration[])
  .flatMap(duration => [0, 1, 2, 3].map(dots => durationTime(duration, dots)));

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface EventInfo {
  event: MusicEvent;
  id: string;
  onset?: Rational;
  time?: Rational;
  written?: Rational;
  pitchSignature?: string;
  tupletIds: readonly string[];
}

interface VoiceInfo { id: string; events: EventInfo[]; total?: Rational }
interface MeasureInfo { measure: Measure; id: string; meter?: Meter; capacity?: Rational; voices: VoiceInfo[] }
interface TupletInfo { tuplet: Tuplet; id: string; ratio?: Rational; eventIds: readonly string[]; start: number; end: number }

/** Validation never mutates the model and never substitutes guessed notes for invalid input. */
class ScoreValidator {
  readonly diagnostics: Diagnostic[] = [];
  private readonly ids = new Set<string>();

  issue(code: string, message: string, sourceId: string, measureId?: string, severity: Diagnostic['severity'] = 'error'): void {
    this.diagnostics.push({ severity, code, message, sourceId, ...(measureId ? { measureId } : {}) });
  }

  attempt<T>(fn: () => T, code: string, sourceId: string, measureId?: string): T | undefined {
    try { return fn(); }
    catch (error) {
      this.issue(code, error instanceof Error ? error.message : String(error), sourceId, measureId);
      return undefined;
    }
  }

  id(value: unknown, fallback: string, measureId?: string): string {
    if (typeof value !== 'string' || !value || /[\s\0]/u.test(value)) {
      this.issue('invalid-id', 'Every score object must have a nonempty string ID without whitespace or null characters.', fallback, measureId);
      return fallback;
    }
    if (this.ids.has(value)) this.issue('duplicate-id', `The ID "${value}" is used more than once in this score.`, value, measureId);
    this.ids.add(value);
    return value;
  }

  array<T>(value: readonly T[], label: string, sourceId: string, measureId?: string): readonly T[] {
    if (Array.isArray(value)) return value;
    this.issue('invalid-structure', `${label} must be an array.`, sourceId, measureId);
    return [];
  }

  choice(value: unknown, choices: readonly string[], label: string, sourceId: string, measureId?: string): boolean {
    if (typeof value === 'string' && choices.includes(value)) return true;
    this.issue('unsupported-value', `${label} must be ${choices.join(', ')}.`, sourceId, measureId);
    return false;
  }

  boolean(value: unknown, label: string, sourceId: string, measureId?: string): void {
    if (typeof value !== 'boolean') this.issue('invalid-boolean', `${label} must be a boolean.`, sourceId, measureId);
  }

  string(value: unknown, label: string, sourceId: string, measureId?: string): void {
    if (typeof value !== 'string') this.issue('invalid-text', `${label} must be a string.`, sourceId, measureId);
  }

  clefAndKey(clef: string, key: string, sourceId: string, measureId?: string): void {
    this.attempt(() => {
      const canonical = validateClef(clef);
      if (canonical !== clef) throw new RangeError(`Use the canonical clef "${canonical}" in the score model.`);
    }, 'invalid-clef', sourceId, measureId);
    this.attempt(() => {
      const canonical = validateKey(key);
      if (canonical !== key) throw new RangeError(`Use the canonical key "${canonical}" in the score model.`);
    }, 'invalid-key', sourceId, measureId);
  }

  time(value: Rational, label: string, sourceId: string, measureId: string, positive = false): Rational | undefined {
    return this.attempt(() => {
      if (!isObject(value) || value.denominator <= 0) throw new RangeError(`${label} must have a positive denominator.`);
      const normalized = rational(value.numerator, value.denominator);
      if (compare(normalized, ZERO) < 0 || (positive && equals(normalized, ZERO))) {
        throw new RangeError(`${label} must be ${positive ? 'positive' : 'nonnegative'}.`);
      }
      return normalized;
    }, 'invalid-time', sourceId, measureId);
  }

  meter(value: Meter, sourceId: string): Meter | undefined {
    return this.attempt(() => {
      if (!isObject(value)) throw new TypeError('A measure must declare a meter.');
      if (!Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator)) {
        throw new TypeError('A model meter must have integer numerator and denominator values.');
      }
      if (!Array.isArray(value.groups)) throw new TypeError('Meter groups must be an array.');
      if (value.groups.some(group => !Number.isSafeInteger(group))) throw new TypeError('Model meter groups must contain integer numbers.');
      const parsed = parseMeter(value.numerator, value.denominator, value.groups);
      if (typeof value.explicitGroups !== 'boolean') throw new TypeError('Meter explicitGroups must be a boolean.');
      if (typeof value.display !== 'string') throw new TypeError('Meter display must be a time signature string.');
      const match = /^([\d+]+)\/(\d+)$/.exec(value.display);
      if (!match) throw new RangeError('Meter display must be a signature such as 7/8 or 2+2+3/8.');
      const printed = parseMeter(match[1], match[2]);
      if (printed.display !== value.display) throw new RangeError(`Use the canonical time signature display "${printed.display}" in the score model.`);
      if (printed.numerator !== parsed.numerator || printed.denominator !== parsed.denominator) {
        throw new RangeError('The printed time signature disagrees with the measure meter.');
      }
      if (match[1].includes('+') && (!value.explicitGroups || printed.groups.some((group, index) => group !== value.groups[index]) || printed.groups.length !== value.groups.length)) {
        throw new RangeError('The printed additive signature must agree with explicit meter groups.');
      }
      if (!value.explicitGroups) {
        const defaults = parseMeter(value.numerator, value.denominator);
        if (defaults.groups.length !== value.groups.length || defaults.groups.some((group, index) => group !== value.groups[index])) {
          throw new RangeError('Custom meter groups must be marked explicitGroups.');
        }
      }
      return value;
    }, 'invalid-meter', sourceId, sourceId);
  }

  event(event: MusicEvent, index: number, voiceId: string, measureId: string): EventInfo | undefined {
    if (!isObject(event)) {
      this.issue('invalid-event', 'Each voice event must be a musical event object.', voiceId, measureId);
      return undefined;
    }
    const id = this.id(event.id, `${voiceId}:event-${index + 1}`, measureId);
    this.choice(event.kind, ['note', 'chord', 'rest', 'slash'], 'Event kind', id, measureId);
    this.choice(event.beam, ['auto', 'start', 'continue', 'end', 'none'], 'Beam policy', id, measureId);
    this.choice(event.stem, ['auto', 'up', 'down'], 'Stem direction', id, measureId);
    this.choice(event.tie, ['none', 'start', 'continue', 'end'], 'Tie policy', id, measureId);
    this.boolean(event.measureRest, 'measureRest', id, measureId);
    this.boolean(event.rhythmic, 'rhythmic', id, measureId);
    if (event.rhythmic && event.kind !== 'slash') this.issue('invalid-rhythmic-flag', 'Only slash events can have the rhythmic flag; pitched notes already carry their written rhythm.', id, measureId);
    const pitches = this.array(event.pitches, 'Event pitches', id, measureId);
    const pitchNames = pitches.map(pitch => this.attempt(() => pitchText(pitch), 'invalid-pitch', id, measureId));
    if ((event.kind === 'note' && pitches.length !== 1)
      || (event.kind === 'chord' && pitches.length < 2)
      || ((event.kind === 'rest' || event.kind === 'slash') && pitches.length !== 0)) {
      this.issue('invalid-event-pitches', 'Notes need one pitch, chords need at least two, and rests/slashes cannot contain pitches.', id, measureId);
    }
    if (new Set(pitchNames.filter(name => name !== undefined)).size !== pitchNames.filter(name => name !== undefined).length) {
      this.issue('duplicate-chord-pitch', 'A chord cannot repeat the same spelled pitch.', id, measureId);
    }
    const ids = this.array(event.tupletIds, 'Event tupletIds', id, measureId);
    if (ids.some(value => typeof value !== 'string' || !value)) this.issue('invalid-tuplet-reference', 'Tuplet references must be nonempty IDs.', id, measureId);
    if (new Set(ids).size !== ids.length) this.issue('duplicate-tuplet-reference', 'An event cannot belong to the same tuplet twice.', id, measureId);
    return {
      event, id,
      onset: this.time(event.onset, 'Event onset', id, measureId),
      time: this.time(event.time, 'Event time', id, measureId, true),
      written: this.attempt(() => {
        if (!Number.isSafeInteger(event.dots)) throw new RangeError('Event dots must be an integer from 0 to 3.');
        return durationTime(event.duration, event.dots);
      }, 'invalid-duration', id, measureId),
      pitchSignature: pitches.length > 0 && pitchNames.every(name => name !== undefined) ? [...pitchNames].sort().join('|') : undefined,
      tupletIds: ids.filter(value => typeof value === 'string'),
    };
  }

  tuplets(voice: Voice, events: readonly EventInfo[], voiceId: string, measureId: string): Map<string, TupletInfo> {
    const result = new Map<string, TupletInfo>();
    const eventIndex = new Map(events.map((info, index) => [info.id, index]));
    for (const [index, tuplet] of this.array(voice.tuplets, 'Voice tuplets', voiceId, measureId).entries()) {
      if (!isObject(tuplet)) {
        this.issue('invalid-tuplet', 'Each tuplet must be an object.', voiceId, measureId);
        continue;
      }
      const id = this.id(tuplet.id, `${voiceId}:tuplet-${index + 1}`, measureId);
      const ratio = this.attempt(() => {
        if (!Number.isSafeInteger(tuplet.actual) || tuplet.actual < 2 || tuplet.actual > 64
          || !Number.isSafeInteger(tuplet.normal) || tuplet.normal < 1 || tuplet.normal > 64) {
          throw new RangeError('Tuplet actual must be an integer from 2 to 64; normal must be an integer from 1 to 64.');
        }
        return rational(tuplet.normal, tuplet.actual);
      }, 'invalid-tuplet-ratio', id, measureId);
      this.choice(tuplet.bracket, ['auto', 'yes', 'no'], 'Tuplet bracket', id, measureId);
      this.boolean(tuplet.showRatio, 'Tuplet showRatio', id, measureId);
      const eventIds = this.array(tuplet.eventIds, 'Tuplet eventIds', id, measureId);
      const indices = eventIds.map(eventId => eventIndex.get(eventId));
      if (eventIds.length === 0) this.issue('empty-tuplet', 'A tuplet must contain at least one event.', id, measureId);
      if (eventIds.some(eventId => typeof eventId !== 'string' || !eventIndex.has(eventId))) {
        this.issue('invalid-tuplet-reference', 'Every tuplet event must belong to this voice.', id, measureId);
      }
      if (new Set(eventIds).size !== eventIds.length) this.issue('duplicate-tuplet-event', 'A tuplet cannot list the same event twice.', id, measureId);
      if (indices.some((value, i) => i > 0 && value !== (indices[i - 1] ?? -2) + 1)) {
        this.issue('noncontiguous-tuplet', 'Tuplet events must be consecutive and listed in voice order.', id, measureId);
      }
      result.set(id, { tuplet, id, ratio, eventIds, start: indices[0] ?? -1, end: indices.at(-1) ?? -1 });
    }
    const intervals = [...result.values()].filter(info => info.start >= 0 && info.end >= info.start).sort((a, b) => a.start - b.start || b.end - a.end);
    const stack: TupletInfo[] = [];
    for (const info of intervals) {
      while (stack.length && stack[stack.length - 1].end < info.start) stack.pop();
      if (stack.length && info.end > stack[stack.length - 1].end) {
        this.issue('crossing-tuplets', 'Tuplets may be nested or separate, but their spans cannot cross.', info.id, measureId);
      }
      stack.push(info);
    }
    const ancestry = new Set<string>();
    for (const info of events) {
      for (const id of info.tupletIds) {
        const tuplet = result.get(id);
        if (!tuplet || !tuplet.eventIds.includes(info.id)) this.issue('invalid-tuplet-reference', `Event and tuplet "${id}" must reference one another in the same voice.`, info.id, measureId);
      }
      for (const tuplet of result.values()) {
        if (tuplet.eventIds.includes(info.id) && !info.tupletIds.includes(tuplet.id)) this.issue('invalid-tuplet-reference', `Event is missing its membership in tuplet "${tuplet.id}".`, info.id, measureId);
      }
      for (let i = 0; i < info.tupletIds.length; i++) {
        for (let j = i + 1; j < info.tupletIds.length; j++) {
          const outer = result.get(info.tupletIds[i]);
          const inner = result.get(info.tupletIds[j]);
          if (!outer || !inner) continue;
          const ordered = JSON.stringify([outer.id, inner.id]);
          const reversed = JSON.stringify([inner.id, outer.id]);
          if (outer.start > inner.start || outer.end < inner.end || ancestry.has(reversed)) {
            this.issue('invalid-tuplet-order', 'Event tupletIds must list enclosing tuplets consistently, from outermost to innermost.', info.id, measureId);
          }
          ancestry.add(ordered);
        }
      }
    }
    return result;
  }

  beams(events: readonly EventInfo[], measureId: string): void {
    let group: EventInfo[] | undefined;
    const beamable = (info: EventInfo): boolean => {
      try {
        return !info.event.measureRest && (info.event.kind !== 'slash' || info.event.rhythmic)
          && compare(durationTime(info.event.duration), rational(1, 8)) <= 0;
      } catch { return false; }
    };
    const anchor = (info: EventInfo): boolean => info.event.kind !== 'rest' && beamable(info);
    for (const info of events) {
      const policy = info.event.beam;
      if (policy === 'start') {
        if (group) this.issue('unclosed-beam', 'Close the current beam before starting another.', group[0].id, measureId);
        group = [];
      } else if ((policy === 'continue' || policy === 'end') && !group) {
        this.issue('orphan-beam', `beam="${policy}" needs a preceding beam="start" in this voice and measure.`, info.id, measureId);
      }
      if (!group) continue;
      group.push(info);
      if (policy === 'none' || !beamable(info)) {
        this.issue('invalid-beam-member', 'Explicit beams need eighth notes or shorter, may contain interior short rests, and cannot contain beam="none" or stemless slashes.', info.id, measureId);
      }
      if (policy === 'end') {
        if (!anchor(group[0]) || !anchor(info) || group.filter(anchor).length < 2) {
          this.issue('invalid-beam-anchors', 'A beam must begin and end on beamable notes/chords/rhythmic slashes and have at least two such anchors.', group[0].id, measureId);
        }
        const directions = new Set(group.filter(anchor).map(value => value.event.stem).filter(value => value !== 'auto'));
        if (directions.size > 1) this.issue('beam-stem-conflict', 'One beam cannot contain conflicting explicit stem directions.', group[0].id, measureId);
        group = undefined;
      }
    }
    if (group) this.issue('unclosed-beam', 'An explicit beam must end in the same voice and measure.', group[0].id, measureId);
  }

  tupletSpans(tuplets: ReadonlyMap<string, TupletInfo>, events: readonly EventInfo[], measure: Measure, measureId: string): void {
    const eventMap = new Map(events.map(info => [info.id, info]));
    for (const tuplet of tuplets.values()) {
      if (!tuplet.ratio || tuplet.eventIds.length === 0) continue;
      let span: Rational | undefined = ZERO;
      for (const id of tuplet.eventIds) {
        const event = eventMap.get(id);
        const ownIndex = event?.tupletIds.indexOf(tuplet.id) ?? -1;
        if (!event?.written || ownIndex < 0) { span = undefined; break; }
        let part: Rational | undefined = event.written;
        // An outer tuplet counts the elapsed written time of its inner tuplets.
        // Its own ratio and all ancestors are deliberately excluded here.
        for (const innerId of event.tupletIds.slice(ownIndex + 1)) {
          const ratio = tuplets.get(innerId)?.ratio;
          part = part && ratio ? this.attempt(() => multiply(part!, ratio), 'time-overflow', tuplet.id, measureId) : undefined;
        }
        span = span && part ? this.attempt(() => add(span!, part!), 'time-overflow', tuplet.id, measureId) : undefined;
        if (!span) break;
      }
      if (!span) continue;
      const unit = this.attempt(() => divide(span!, rational(tuplet.tuplet.actual)), 'time-overflow', tuplet.id, measureId);
      if (unit && !WRITTEN_UNITS.some(candidate => equals(candidate, unit))) {
        this.issue('tuplet-span', `Tuplet ${tuplet.tuplet.actual}:${tuplet.tuplet.normal} must span ${tuplet.tuplet.actual} written units (breve through 128th, with up to three dots) after inner tuplets. Its inferred unit is ${formatRational(unit)} whole notes; mixed durations are allowed, but incomplete groups need missing notes/rests.`, tuplet.id, measureId, measure.incomplete ? 'warning' : 'error');
      }
    }
  }

  voice(voice: Voice, index: number, measure: Measure, measureId: string, capacity?: Rational): VoiceInfo | undefined {
    if (!isObject(voice)) {
      this.issue('invalid-voice', 'Each voice must be an object.', measureId, measureId);
      return undefined;
    }
    const id = this.id(voice.id, `${measureId}:voice-${index + 1}`, measureId);
    const events = this.array(voice.events, 'Voice events', id, measureId).flatMap((event, eventIndex) => {
      const info = this.event(event, eventIndex, id, measureId);
      return info ? [info] : [];
    });
    if (events.length === 0) this.issue('empty-voice', 'A voice must contain notes, rests, or slashes; use a measure rest for a silent bar.', id, measureId);
    const tuplets = this.tuplets(voice, events, id, measureId);
    let total: Rational | undefined = ZERO;
    for (const info of events) {
      if (total && info.onset && !equals(info.onset, total)) {
        this.issue('noncontiguous-voice', `Event onset ${formatRational(info.onset)} must equal ${formatRational(total)}; write rests for silence.`, info.id, measureId);
      }
      total = total && info.time ? this.attempt(() => add(total!, info.time!), 'time-overflow', info.id, measureId) : undefined;
      if (info.event.measureRest) {
        if (info.event.kind !== 'rest' || info.event.duration !== 'whole' || info.event.dots !== 0
          || info.tupletIds.length > 0 || events.length !== 1 || info.event.tie !== 'none'
          || (info.event.beam !== 'none' && info.event.beam !== 'auto')) {
          this.issue('invalid-measure-rest', 'A measure rest must be the only event in its voice: a whole-rest glyph without dots, tuplets, beams, or ties.', info.id, measureId);
        }
        if (capacity && info.time && !equals(info.time, capacity)) this.issue('incorrect-event-time', 'A measure rest must last exactly the measure meter, regardless of its whole-rest glyph.', info.id, measureId);
      } else if (info.written && info.time) {
        let expected: Rational | undefined = info.written;
        for (const tupletId of info.tupletIds) {
          const ratio = tuplets.get(tupletId)?.ratio;
          expected = expected && ratio ? this.attempt(() => multiply(expected!, ratio), 'time-overflow', info.id, measureId) : undefined;
        }
        if (expected && !equals(info.time, expected)) {
          this.issue('incorrect-event-time', `Event time must be ${formatRational(expected)} after dots and every enclosing tuplet ratio.`, info.id, measureId);
        }
      }
    }
    this.tupletSpans(tuplets, events, measure, measureId);
    this.beams(events, measureId);
    if (total && capacity) {
      const filling = compare(total, capacity);
      if (filling > 0) this.issue('measure-overfull', `Voice contains ${formatRational(total)} whole notes; this meter allows ${formatRational(capacity)}. Split or remove the excess.`, id, measureId);
      else if (filling < 0 && !measure.pickup) {
        this.issue(measure.incomplete ? 'incomplete-measure' : 'measure-underfull', `Voice contains ${formatRational(total)} of ${formatRational(capacity)} whole notes. ${measure.incomplete ? 'This measure is an incomplete draft.' : 'Add explicit rests or mark an intentional pickup/incomplete measure.'}`, id, measureId, measure.incomplete ? 'warning' : 'error');
      }
    }
    return { id, events, total };
  }

  measure(measure: Measure, index: number, staffId: string): MeasureInfo | undefined {
    if (!isObject(measure)) {
      this.issue('invalid-measure', 'Each staff measure must be an object.', staffId);
      return undefined;
    }
    const id = this.id(measure.id, `${staffId}:measure-${index + 1}`);
    this.string(measure.number, 'Measure number', id, id);
    const meter = this.meter(measure.meter, id);
    const capacity = meter ? meterTime(meter) : undefined;
    this.clefAndKey(measure.clef, measure.key, id, id);
    this.choice(measure.breakBefore, ['auto', 'line', 'page'], 'Measure breakBefore', id, id);
    this.choice(measure.endBar, ['single', 'double', 'final', 'repeat-end', 'none'], 'Measure endBar', id, id);
    this.boolean(measure.keepWithNext, 'keepWithNext', id, id);
    this.boolean(measure.repeatStart, 'repeatStart', id, id);
    this.boolean(measure.pickup, 'pickup', id, id);
    this.boolean(measure.incomplete, 'incomplete', id, id);
    if (meter && !meter.explicitGroups && meter.numerator > 4 && meter.numerator % 3 !== 0) {
      this.issue('ambiguous-meter-grouping', `${meter.display} does not specify its beat groups. Assuming ${meter.groups.join('+')}; write explicit groups to state the intended accents.`, id, id, 'warning');
    }
    const voices = this.array(measure.voices, 'Measure voices', id, id).flatMap((voice, voiceIndex) => {
      const info = this.voice(voice, voiceIndex, measure, id, capacity);
      return info ? [info] : [];
    });
    if (voices.length === 0) this.issue('empty-measure', 'A measure must contain at least one voice.', id, id);
    const pickupTime = voices[0]?.total;
    if (measure.pickup && pickupTime) {
      for (const voice of voices.slice(1)) {
        if (voice.total && !equals(voice.total, pickupTime)) this.issue('pickup-voice-mismatch', 'Every voice in a pickup must have the same exact duration.', voice.id, id);
      }
    }
    const annotationLimit = measure.pickup && pickupTime ? pickupTime : capacity;
    for (const [annotationIndex, annotation] of this.array(measure.annotations, 'Measure annotations', id, id).entries()) {
      if (!isObject(annotation)) {
        this.issue('invalid-annotation', 'Each annotation must be an object.', id, id);
        continue;
      }
      const annotationId = this.id(annotation.id, `${id}:annotation-${annotationIndex + 1}`, id);
      this.choice(annotation.kind, ['tempo', 'dynamics', 'direction', 'harmony', 'rehearsal'], 'Annotation kind', annotationId, id);
      this.choice(annotation.placement, ['above', 'below'], 'Annotation placement', annotationId, id);
      this.string(annotation.text, 'Annotation text', annotationId, id);
      if ((typeof annotation.text !== 'string' || !annotation.text.trim()) && !(annotation.kind === 'tempo' && annotation.bpm !== undefined)) {
        this.issue('empty-annotation', 'An annotation needs text, or a tempo needs a bpm value.', annotationId, id);
      }
      const onset = this.time(annotation.onset, 'Annotation onset', annotationId, id);
      if (onset && annotationLimit && compare(onset, annotationLimit) > 0) this.issue('annotation-outside-measure', 'Annotation onset cannot fall after the end of its measure.', annotationId, id);
      if (annotation.kind === 'tempo') {
        if (annotation.bpm !== undefined && (typeof annotation.bpm !== 'number' || !Number.isFinite(annotation.bpm) || annotation.bpm <= 0)) {
          this.issue('invalid-tempo', 'Tempo bpm must be a finite positive number.', annotationId, id);
        }
        this.attempt(() => durationTime(annotation.beat ?? 'quarter', annotation.dots ?? 0), 'invalid-tempo-beat', annotationId, id);
      } else if (annotation.bpm !== undefined || annotation.beat !== undefined || annotation.dots !== undefined) {
        this.issue('invalid-annotation', 'Only tempo annotations can declare bpm, beat, or dots.', annotationId, id);
      }
    }
    return { measure, id, meter, capacity, voices };
  }

  ties(measures: readonly MeasureInfo[]): void {
    const pending = new Map<number, { event: EventInfo; measureId: string }>();
    for (const measure of measures) {
      for (const [voiceIndex, previous] of pending) {
        if (!measure.voices[voiceIndex]) {
          this.issue('unclosed-tie', 'A tied voice cannot disappear before the tie ends.', previous.event.id, previous.measureId);
          pending.delete(voiceIndex);
        }
      }
      measure.voices.forEach((voice, voiceIndex) => {
        for (const event of voice.events) {
          const policy = event.event.tie;
          const pitched = (event.event.kind === 'note' || event.event.kind === 'chord') && event.pitchSignature !== undefined;
          if (policy !== 'none' && !pitched) this.issue('invalid-tie', 'Ties require pitched notes or complete pitched chords; rest and slash ties are not supported.', event.id, measure.id);
          const previous = pending.get(voiceIndex);
          if (previous && (policy === 'end' || policy === 'continue')) {
            if (!pitched || event.pitchSignature !== previous.event.pitchSignature) this.issue('tie-pitch-mismatch', 'Tied events must have exactly the same spelled pitches and octaves, including every chord pitch.', event.id, measure.id);
          } else {
            if (previous) this.issue('unclosed-tie', 'A tie must continue or end on the immediately following event in this voice.', previous.event.id, previous.measureId);
            if (policy === 'continue' || policy === 'end') this.issue('orphan-tie', `tie="${policy}" needs a preceding tie start in the same voice.`, event.id, measure.id);
          }
          pending.delete(voiceIndex);
          if ((policy === 'start' || policy === 'continue') && pitched) pending.set(voiceIndex, { event, measureId: measure.id });
        }
      });
    }
    for (const previous of pending.values()) this.issue('unclosed-tie', 'The score ends before this tie is closed.', previous.event.id, previous.measureId);
  }

  alignment(staves: readonly { id: string; measures: MeasureInfo[] }[]): void {
    const first = staves[0];
    if (!first) return;
    for (const staff of staves.slice(1)) {
      if (staff.measures.length !== first.measures.length) {
        this.issue('staff-measure-count', `Aligned staves must have the same number of measures; expected ${first.measures.length}, found ${staff.measures.length}.`, staff.id);
      }
      staff.measures.forEach((measure, index) => {
        const reference = first.measures[index];
        if (!reference) return;
        if (measure.meter && reference.meter && (measure.meter.numerator !== reference.meter.numerator
          || measure.meter.denominator !== reference.meter.denominator
          || measure.meter.groups.length !== reference.meter.groups.length
          || measure.meter.groups.some((group, i) => group !== reference.meter!.groups[i]))) {
          this.issue('staff-meter-mismatch', 'Aligned measures must use the same meter and beat grouping; polymeter is not supported.', measure.id, measure.id);
        }
        if (measure.measure.pickup !== reference.measure.pickup) this.issue('staff-pickup-mismatch', 'An aligned pickup must be marked pickup on every staff.', measure.id, measure.id);
        if (measure.measure.pickup || reference.measure.pickup) {
          const time = measure.voices[0]?.total;
          const referenceTime = reference.voices[0]?.total;
          if (time && referenceTime && !equals(time, referenceTime)) this.issue('staff-pickup-duration-mismatch', 'Aligned pickup measures must have the same exact duration on every staff.', measure.id, measure.id);
        }
      });
    }
  }

  score(score: Score): void {
    if (!isObject(score)) {
      this.issue('invalid-score', 'A score must be an object.', 'score');
      return;
    }
    const id = this.id(score.id, 'score');
    this.string(score.label, 'Score label', id);
    this.choice(score.bracket, ['none', 'brace', 'bracket'], 'Score bracket', id);
    const staves: { id: string; measures: MeasureInfo[] }[] = [];
    for (const [staffIndex, staff] of this.array(score.staves, 'Score staves', id).entries()) {
      if (!isObject(staff)) {
        this.issue('invalid-staff', 'Each staff must be an object.', id);
        continue;
      }
      const staffId = this.id(staff.id, `${id}:staff-${staffIndex + 1}`);
      this.string(staff.label, 'Staff label', staffId);
      this.clefAndKey(staff.clef, staff.key, staffId);
      const measures = this.array(staff.measures, 'Staff measures', staffId).flatMap((measure, measureIndex) => {
        const info = this.measure(measure, measureIndex, staffId);
        return info ? [info] : [];
      });
      if (measures.length === 0) this.issue('empty-staff', 'A staff must contain at least one measure.', staffId);
      this.ties(measures);
      staves.push({ id: staffId, measures });
    }
    if (staves.length === 0) this.issue('empty-score', 'A score must contain at least one staff.', id);
    this.alignment(staves);
  }
}

export function validateScore(score: Score): Diagnostic[] {
  const validator = new ScoreValidator();
  validator.score(score);
  return validator.diagnostics;
}
