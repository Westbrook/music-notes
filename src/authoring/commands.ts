import { readScore } from '../dom/index.js';
import type { ReadScoreResult } from '../dom/index.js';
import {
  add, compare, durationTime, formatRational, meterBoundaries, meterTime, multiply,
  parseMeter, parsePitch, pitchText, rational, subtract, validateAlteration, validateClef, validateKey, validatePitchDirection,
} from '../model/index.js';
import type { Annotation, Duration, Measure, Meter, MusicEvent, Rational, Staff, Voice } from '../model/types.js';
import { applyEventPropertyChange } from './batch-properties.js';
import { analyzeContinuation } from './continuation.js';
import { patchEventFields, validateEventPatchFields } from './event-field-patch.js';
import { applyEventMarkingEdits, applyRoadTieIntervalEdits, assertEventMarkingsCompatible } from './event-markings-commands.js';
import type { AnnotationInput, AuthorCommand, Cursor, EditResult, EventInput, EventMarkingEdit } from './types.js';

const EVENT_TAGS = new Set(['music-note', 'music-chord', 'music-rest', 'music-slash', 'music-rhythm', 'music-road']);
const EVENT_ATTRIBUTES = new Set([
  'pitch', 'pitches', 'accidental', 'accidental-display', 'duration', 'dots', 'dotted',
  'measure', 'rhythmic', 'stem', 'beam', 'direction',
]);
const ANNOTATION_ATTRIBUTES = new Set(['text', 'marking', 'level', 'at', 'placement', 'bpm', 'beat', 'dots', 'dotted']);
const DURATIONS: readonly Duration[] = ['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th'];
const ZERO = rational(0);
const REST_GRID = 1024;
const MAX_FILL_RESTS = 256;
const MAX_FILL_TICKS = 128 * REST_GRID;
let nextIdentity = 0;

interface RestValue { duration: Duration; dots: number; time: Rational; ticks: number }
const REST_VALUES: readonly RestValue[] = DURATIONS.flatMap(duration => [0, 1, 2, 3].map(dots => {
  const time = durationTime(duration, dots);
  return { duration, dots, time, ticks: multiply(time, rational(REST_GRID)).numerator };
})).sort((a, b) => compare(b.time, a.time));

interface MeasureLocation { staff: Staff; staffIndex: number; measure: Measure; measureIndex: number }
interface EventLocation extends MeasureLocation { voice: Voice; voiceIndex: number; event: MusicEvent; eventIndex: number }
interface TieEdge { from: EventLocation; to: EventLocation }
type MusicalContext = Pick<Measure, 'meter' | 'key' | 'clef'>;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function totalTime(voice: Voice): Rational {
  return voice.events.reduce((total, event) => add(total, event.time), ZERO);
}

function setBoolean(element: Element, name: string, enabled: boolean): void {
  if (enabled) element.setAttribute(name, '');
  else element.removeAttribute(name);
}

function directChildren(element: Element, tag: string): Element[] {
  return [...element.children].filter(child => child.localName === tag);
}

function pitchSignature(event: MusicEvent): string {
  return event.pitches.map(pitch => pitchText(pitch)).sort().join(' ');
}

/** A bounded exact coin decomposition; no floating point or guessed tuplet unit. */
function restValues(time: Rational): RestValue[] {
  requireCondition(compare(time, ZERO) >= 0, 'This voice overflows its measure. Shorten the music before filling rests.');
  const ticks = multiply(time, rational(REST_GRID));
  requireCondition(ticks.denominator === 1 && ticks.numerator <= MAX_FILL_TICKS,
    'The remaining time cannot be filled with supported written rests at this scope. Finish the tuplet with explicit notes or rests first.');
  const count = new Uint16Array(ticks.numerator + 1);
  const previous = new Uint8Array(ticks.numerator + 1);
  count.fill(MAX_FILL_RESTS + 1);
  count[0] = 0;
  for (let amount = 1; amount <= ticks.numerator; amount++) {
    for (let index = 0; index < REST_VALUES.length; index++) {
      const value = REST_VALUES[index];
      if (value.ticks <= amount && count[amount - value.ticks] + 1 < count[amount]) {
        count[amount] = count[amount - value.ticks] + 1;
        previous[amount] = index + 1;
      }
    }
  }
  requireCondition(count[ticks.numerator] <= MAX_FILL_RESTS,
    'The remaining time needs unsupported rest values or too many rests. Insert explicit rests in the intended rhythmic scope.');
  const values: RestValue[] = [];
  for (let amount = ticks.numerator; amount > 0;) {
    const value = REST_VALUES[previous[amount] - 1];
    requireCondition(value, 'The remaining time cannot be represented by supported rests.');
    values.push(value);
    amount -= value.ticks;
  }
  return values;
}

function validateEventInput(value: EventInput): void {
  requireCondition(['note', 'chord', 'rest', 'slash', 'rhythm', 'road'].includes(value.kind), 'Choose a note, chord, rest, slash, rhythm note, or 3 roads event.');
  durationTime(value.duration, value.dots);
  if (value.kind === 'road') {
    requireCondition(value.pitchDirection !== undefined, 'A 3 roads event needs an explicit higher, same, or lower direction.');
    validatePitchDirection(value.pitchDirection);
    requireCondition(value.rhythmic === false, 'A 3 roads event already prescribes written rhythm; the rhythmic flag belongs only to slashes.');
  } else requireCondition(value.pitchDirection === undefined, 'Pitch direction belongs only to a 3 roads event.');
  if (value.kind === 'note') parsePitch(value.pitch, undefined, value.accidentalDisplay);
  if (value.kind === 'chord') {
    const pitches = value.pitches.trim().split(/\s+/).filter(Boolean).map(pitch => parsePitch(pitch, undefined, value.accidentalDisplay));
    requireCondition(pitches.length >= 2, 'A chord needs at least two explicitly spelled pitches. Use a note for one pitch.');
    requireCondition(new Set(pitches.map(pitch => pitchText(pitch))).size === pitches.length, 'A chord cannot repeat the same spelled pitch.');
  }
  requireCondition(!value.measureRest || value.kind === 'rest', 'Only a rest can fill an entire measure.');
  requireCondition(!value.measureRest || value.dots === 0, 'A full-measure rest cannot have dots.');
  requireCondition(!value.measureRest || value.beam === 'auto' || value.beam === 'none', 'A full-measure rest cannot belong to a beam group.');
}

function validateStaffEvent(staff: Staff, kind: EventInput['kind']): void {
  requireCondition(kind !== 'road' || staff.notation === 'three-roads',
    'A road event needs a 3 roads music staff. Add that staff type, or explicitly convert incompatible music before changing the staff.');
  requireCondition(staff.notation !== 'three-roads' || kind === 'road' || kind === 'rest',
    'A 3 roads music staff accepts only road events and rests. Use its higher, same, or lower direction instead of a fixed pitch or an ordinary slash.');
  requireCondition(kind !== 'rhythm' || staff.notation === 'rhythm',
    'Rhythm notes need a single-line rhythm staff. Add a rhythm staff, or explicitly convert and change this staff first.');
  requireCondition(staff.notation !== 'rhythm' || (kind !== 'note' && kind !== 'chord'),
    'A rhythm staff has no pitches. Choose Rhythm note, Rest, or Slash; use a pitched staff for notes and chords.');
}

function writeEvent(element: Element, value: EventInput): void {
  for (const name of EVENT_ATTRIBUTES) element.removeAttribute(name);
  if (value.kind === 'note') element.setAttribute('pitch', value.pitch.trim());
  if (value.kind === 'chord') element.setAttribute('pitches', value.pitches.trim().split(/\s+/).join(' '));
  if (value.kind === 'road') element.setAttribute('direction', value.pitchDirection!);
  if (value.kind === 'rest' && value.measureRest) element.setAttribute('measure', '');
  else {
    element.setAttribute('duration', value.duration);
    if (value.dots) element.setAttribute('dots', String(value.dots));
  }
  if ((value.kind === 'note' || value.kind === 'chord') && value.accidentalDisplay !== 'auto') {
    element.setAttribute('accidental-display', value.accidentalDisplay);
  }
  if (value.kind === 'slash' && value.rhythmic) element.setAttribute('rhythmic', '');
  if (value.stem !== 'auto') element.setAttribute('stem', value.stem);
  if (value.beam !== 'auto') element.setAttribute('beam', value.beam);
}

function parseAt(text: string): Rational {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(text.trim() || '0');
  requireCondition(match, 'An annotation position must be a nonnegative whole-note fraction, such as 0, 1/4, or 3/8.');
  return rational(Number(match[1]), Number(match[2] ?? 1));
}

function writeAnnotation(element: Element, value: AnnotationInput): void {
  const onset = parseAt(value.at);
  requireCondition(value.text.trim() || (value.kind === 'tempo' && value.bpm !== undefined), 'An annotation needs text, or a tempo needs a metronome value.');
  if (value.bpm !== undefined) requireCondition(Number.isFinite(value.bpm) && value.bpm > 0, 'Tempo must be a finite positive number.');
  if (value.kind === 'tempo') durationTime(value.beat ?? 'quarter', value.dots ?? 0);
  for (const name of ANNOTATION_ATTRIBUTES) element.removeAttribute(name);
  element.textContent = '';
  element.setAttribute(value.kind === 'tempo' ? 'marking' : value.kind === 'dynamics' ? 'level' : 'text', value.text);
  element.setAttribute('at', formatRational(onset));
  element.setAttribute('placement', value.placement);
  if (value.kind === 'tempo') {
    if (value.bpm !== undefined) element.setAttribute('bpm', String(value.bpm));
    if (value.beat !== undefined) element.setAttribute('beat', value.beat);
    if (value.dots) element.setAttribute('dots', String(value.dots));
  }
}

const ANNOTATION_FIELDS: readonly (keyof AnnotationInput)[] = ['kind', 'text', 'at', 'placement', 'bpm', 'beat', 'dots'];
const ANNOTATION_KINDS: readonly AnnotationInput['kind'][] = ['tempo', 'dynamics', 'direction', 'harmony', 'rehearsal'];

function annotationTextAttribute(kind: AnnotationInput['kind']): string {
  return kind === 'tempo' ? 'marking' : kind === 'dynamics' ? 'level' : 'text';
}

/** Change the active text declaration without removing comments or fallback data. */
function patchAnnotationText(element: Element, kind: AnnotationInput['kind'], text: string): void {
  const primary = annotationTextAttribute(kind);
  if (element.hasAttribute(primary)) { element.setAttribute(primary, text); return; }
  if (element.hasAttribute('text')) { element.setAttribute('text', text); return; }
  // Attribute text can represent whitespace that plain annotation body text
  // would trim. Empty primary text also prevents an implicit dynamics default.
  if (text !== text.trim() || text === '') { element.setAttribute(primary, text); return; }
  const nodes: Node[] = [];
  const collect = (parent: Node): void => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) nodes.push(child);
      else if (child.nodeType === 1) collect(child);
    }
  };
  collect(element);
  if (!nodes.length) element.append(element.ownerDocument.createTextNode(text));
  else {
    nodes[0].nodeValue = text;
    for (const node of nodes.slice(1)) node.nodeValue = '';
  }
}

/** An explicit patch leaves all unnamed authored declarations and defaults alone. */
function patchAnnotation(previous: Element, accepted: Annotation, value: AnnotationInput, fields: readonly (keyof AnnotationInput)[]): EditResult {
  requireCondition(Array.isArray(fields) && fields.every(field => ANNOTATION_FIELDS.includes(field)), 'Choose supported annotation fields to update.');
  const selected = new Set(fields);
  const unchanged = { selectionId: accepted.id, message: 'The annotation already matches these fields; nothing changed.' };
  if (!selected.size) return unchanged;
  const kind = selected.has('kind') ? value.kind : accepted.kind;
  requireCondition(ANNOTATION_KINDS.includes(kind), 'Choose a tempo, dynamics, direction, harmony, or rehearsal annotation.');
  const kindChanged = kind !== accepted.kind;
  const text = selected.has('text') ? value.text : accepted.text;
  requireCondition(typeof text === 'string', 'Annotation text must be text.');
  const bpm = kind === 'tempo' ? selected.has('bpm') ? value.bpm : accepted.bpm : undefined;
  const beat = kind === 'tempo' ? selected.has('beat') ? value.beat : accepted.beat : undefined;
  const dots = kind === 'tempo' ? selected.has('dots') ? value.dots : accepted.dots : undefined;
  if (kind === 'tempo') {
    if (bpm !== undefined) requireCondition(Number.isFinite(bpm) && bpm > 0, 'Tempo must be a finite positive number.');
    if (dots !== undefined) requireCondition(Number.isSafeInteger(dots), 'Dots must be an integer from 0 to 3.');
    durationTime(beat ?? 'quarter', dots ?? 0);
  } else if (!kindChanged) {
    requireCondition(!(['bpm', 'beat', 'dots'] as const).some(field => selected.has(field) && value[field] !== undefined),
      'Metronome fields apply only to tempo annotations. Change the annotation kind explicitly first.');
  }
  requireCondition(text.trim() || (kind === 'tempo' && bpm !== undefined), 'An annotation needs text, or a tempo needs a metronome value.');
  let onset: Rational | undefined;
  if (selected.has('at')) {
    requireCondition(typeof value.at === 'string', 'An annotation position must be a nonnegative whole-note fraction.');
    onset = parseAt(value.at);
  }
  if (selected.has('placement')) requireCondition(value.placement === 'above' || value.placement === 'below', 'Place the annotation above or below the staff.');

  let annotation = previous;
  let changed = kindChanged;
  if (kindChanged) {
    annotation = previous.ownerDocument.createElement(`music-${kind}`);
    for (const attribute of previous.attributes) annotation.setAttribute(attribute.name, attribute.value);
    for (const child of previous.childNodes) annotation.append(child.cloneNode(true));
    annotation.id = accepted.id;
    if (kind !== 'tempo') for (const name of ['marking', 'bpm', 'beat', 'dots', 'dotted']) annotation.removeAttribute(name);
    if (kind !== 'dynamics') annotation.removeAttribute('level');
    // Kind-specific text attributes have different precedence. Transfer the
    // accepted effective text, not an unselected or stale form value.
    annotation.setAttribute(annotationTextAttribute(kind), text);
  } else if (selected.has('text') && text !== accepted.text) {
    patchAnnotationText(annotation, kind, text);
    changed = true;
  }
  if (onset && compare(onset, accepted.onset) !== 0) {
    annotation.setAttribute('at', formatRational(onset));
    changed = true;
  }
  const placement = kindChanged && !previous.hasAttribute('placement') ? kind === 'dynamics' ? 'below' : 'above' : accepted.placement;
  if (selected.has('placement') && value.placement !== placement) {
    annotation.setAttribute('placement', value.placement);
    changed = true;
  }
  if (kind === 'tempo') {
    const clear = (names: readonly string[]): void => {
      for (const name of names) if (annotation.hasAttribute(name)) { annotation.removeAttribute(name); changed = true; }
    };
    if (selected.has('bpm')) {
      if (bpm === undefined) clear(['bpm']);
      else if (bpm !== accepted.bpm) { annotation.setAttribute('bpm', String(bpm)); changed = true; }
    }
    if (selected.has('beat')) {
      if (beat === undefined) clear(['beat']);
      else if (beat !== (accepted.beat ?? 'quarter')) { annotation.setAttribute('beat', beat); changed = true; }
    }
    if (selected.has('dots')) {
      if (dots === undefined) clear(['dots', 'dotted']);
      else if (dots !== (accepted.dots ?? 0)) {
        clear(['dots', 'dotted']);
        if (dots) annotation.setAttribute('dots', String(dots));
        changed = true;
      }
    }
  }
  if (kindChanged) previous.replaceWith(annotation);
  return changed ? { selectionId: accepted.id, message: 'Updated the selected annotation fields; other authored settings are unchanged.' } : unchanged;
}

function writeMeter(element: Element, meter: Meter): void {
  const declaration = directChildren(element, 'music-meter')[0];
  const owner = declaration ?? element;
  if (declaration) {
    const [top, bottom] = meter.display.split('/');
    declaration.setAttribute('top', top);
    declaration.setAttribute('bottom', bottom);
    element.removeAttribute('meter');
    element.removeAttribute('groups');
  } else element.setAttribute('meter', meter.display);
  if (meter.explicitGroups) owner.setAttribute('groups', meter.groups.join('+'));
  else owner.removeAttribute('groups');
}

function sameMeter(a: Meter, b: Meter): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator && a.display === b.display
    && a.explicitGroups === b.explicitGroups && a.groups.length === b.groups.length
    && a.groups.every((group, index) => group === b.groups[index]);
}

function resolvedMeter(element: Element, inherited: Meter): Meter {
  const declaration = directChildren(element, 'music-meter')[0];
  if (declaration) return parseMeter(declaration.getAttribute('top') ?? '4', declaration.getAttribute('bottom') ?? '4', declaration.getAttribute('groups') ?? undefined);
  const signature = element.getAttribute('meter');
  const groups = element.getAttribute('groups');
  if (signature === null && groups === null) return inherited;
  const parts = (signature ?? inherited.display).trim().split('/');
  requireCondition(parts.length === 2, 'Write a meter such as 7/8 or 2+2+3/8.');
  return parseMeter(parts[0], parts[1], groups ?? undefined);
}

function tupletValues(element: Element, values: { actual: number; normal: number; bracket: 'auto' | 'yes' | 'no'; ratio: boolean }): void {
  requireCondition(Number.isInteger(values.actual) && values.actual >= 2 && values.actual <= 64, 'Tuplet actual count must be an integer from 2 to 64.');
  requireCondition(Number.isInteger(values.normal) && values.normal >= 1 && values.normal <= 64, 'Tuplet normal count must be an integer from 1 to 64.');
  element.setAttribute('actual', String(values.actual));
  element.setAttribute('normal', String(values.normal));
  element.setAttribute('bracket', values.bracket);
  setBoolean(element, 'ratio', values.ratio);
}

class EditContext {
  readonly source: Element;
  readonly initial: ReadScoreResult;
  readonly measures = new Map<string, MeasureLocation>();
  readonly events = new Map<string, EventLocation>();
  readonly ties: TieEdge[] = [];
  readonly changed = new Set<Element>();
  readonly explicitlyComplete = new Set<Element>();
  readonly completedByFill = new Set<Element>();
  readonly copiedIds: Record<string, string> = Object.create(null) as Record<string, string>;
  readonly desiredContexts = new Map<Element, MusicalContext>();
  private readonly usedIds: Set<string>;
  private readonly originalIds = new Map<Element, string>();

  constructor(source: Element) {
    this.source = source;
    this.initial = readScore(source);
    this.usedIds = new Set([...this.initial.sources.keys(), ...[source, ...source.querySelectorAll('[id]')].map(element => element.id).filter(Boolean)]);
    for (const [id, element] of this.initial.sources) if (!this.originalIds.has(element)) this.originalIds.set(element, element.id || id);
    this.initial.score.staves.forEach((staff, staffIndex) => {
      const pending = new Map<number, EventLocation>();
      staff.measures.forEach((measure, measureIndex) => {
        const location = { staff, staffIndex, measure, measureIndex };
        this.measures.set(measure.id, location);
        this.desiredContexts.set(this.node(measure.id, 'music-measure'), measure);
        for (const index of pending.keys()) if (!measure.voices[index]) pending.delete(index);
        measure.voices.forEach((voice, voiceIndex) => voice.events.forEach((event, eventIndex) => {
          const eventLocation = { ...location, voice, voiceIndex, event, eventIndex };
          this.events.set(event.id, eventLocation);
          const previous = pending.get(voiceIndex);
          if (previous && (event.tie === 'end' || event.tie === 'continue')) this.ties.push({ from: previous, to: eventLocation });
          pending.delete(voiceIndex);
          if (event.tie === 'start' || event.tie === 'continue') pending.set(voiceIndex, eventLocation);
        }));
      });
    });
  }

  id(kind: string): string {
    let id: string;
    do { id = `music-edit-${kind}-${++nextIdentity}`; } while (this.usedIds.has(id));
    this.usedIds.add(id);
    return id;
  }

  create(tag: string): Element {
    const element = this.source.ownerDocument.createElement(tag);
    element.id = this.id(tag.replace(/^music-/, ''));
    return element;
  }

  node(id: string, tag?: string): Element {
    const element = this.initial.sources.get(id);
    requireCondition(element && (!tag || element.localName === tag), `Select an existing ${tag?.replace('music-', '') ?? 'notation element'} to edit.`);
    return element;
  }

  bar(id: string): MeasureLocation {
    const location = this.measures.get(id);
    requireCondition(location, 'Select an existing measure.');
    return location;
  }

  event(id: string): EventLocation {
    const location = this.events.get(id);
    requireCondition(location, 'Select an existing note, chord, rest, slash, rhythm note, or road event.');
    return location;
  }

  selected(ids: readonly string[]): EventLocation[] {
    requireCondition(ids.length > 0 && new Set(ids).size === ids.length, 'Select one or more distinct musical events.');
    return ids.map(id => this.event(id));
  }

  voice(measureId: string, voiceIndex: number): { location: MeasureLocation; voice: Voice; container: Element } {
    const location = this.bar(measureId);
    const voice = location.measure.voices[voiceIndex];
    requireCondition(Number.isInteger(voiceIndex) && voiceIndex >= 0 && voice, 'Choose an existing voice in this measure.');
    return { location, voice, container: this.node(voice.id) };
  }

  changedBar(measure: Measure): void {
    this.changed.add(this.node(measure.id, 'music-measure'));
  }

  replaceEvent(location: EventLocation, value: EventInput): Element {
    validateEventInput(value);
    validateStaffEvent(location.staff, value.kind);
    assertEventMarkingsCompatible(location.event, value);
    requireCondition(!value.measureRest || (location.voice.events.length === 1 && location.event.tupletIds.length === 0),
      'A full-measure rest must be the only event in its voice and cannot be inside a tuplet.');
    requireCondition(location.event.tie === 'none' || value.kind === 'note' || value.kind === 'chord' || value.kind === 'rhythm' || value.kind === 'road', 'Clear the connected tie chain before replacing a tied event with a rest or slash.');
    const previous = this.node(location.event.id);
    let replacement = previous;
    if (previous.localName !== `music-${value.kind}`) {
      replacement = this.source.ownerDocument.createElement(`music-${value.kind}`);
      for (const attribute of previous.attributes) if (!EVENT_ATTRIBUTES.has(attribute.name)) replacement.setAttribute(attribute.name, attribute.value);
      for (const child of previous.childNodes) replacement.append(child.cloneNode(true));
    }
    replacement.id = location.event.id;
    writeEvent(replacement, value);
    if (replacement !== previous) previous.replaceWith(replacement);
    this.changedBar(location.measure);
    return replacement;
  }

  rest(time?: Rational): Element[] {
    if (time === undefined) {
      const rest = this.create('music-rest');
      rest.setAttribute('measure', '');
      return [rest];
    }
    return restValues(time).map(value => {
      const rest = this.create('music-rest');
      rest.setAttribute('duration', value.duration);
      if (value.dots) rest.setAttribute('dots', String(value.dots));
      return rest;
    });
  }

  pinFollowing(location: MeasureLocation, fields: readonly ('meter' | 'key' | 'clef')[]): void {
    const next = location.staff.measures[location.measureIndex + 1];
    if (!next) return;
    const node = this.node(next.id);
    if (fields.includes('meter')) writeMeter(node, next.meter);
    if ((location.staff.notation ?? 'pitched') === 'pitched') {
      if (fields.includes('key')) node.setAttribute('key', next.key);
      if (fields.includes('clef')) node.setAttribute('clef', next.clef);
    }
  }

  /** Pin only contexts actually disturbed by a new order, not every inherited bar. */
  preserveContexts(): void {
    const rootMeter = this.source.localName === 'music-system' ? resolvedMeter(this.source, parseMeter()) : parseMeter();
    for (const staff of this.initial.score.staves) {
      const owner = this.node(staff.id, 'music-staff');
      let inherited: MusicalContext = { clef: staff.clef, key: staff.key, meter: resolvedMeter(owner, rootMeter) };
      for (const bar of directChildren(owner, 'music-measure')) {
        const desired = this.desiredContexts.get(bar);
        requireCondition(desired, 'The edited measure is missing its original musical context.');
        let meter: Meter | undefined;
        // A groups-only declaration can temporarily conflict with its new
        // predecessor. Restore its full original signature rather than guess.
        try { meter = resolvedMeter(bar, inherited.meter); } catch { /* restored below */ }
        if (!meter || !sameMeter(meter, desired.meter)) writeMeter(bar, desired.meter);
        if ((staff.notation ?? 'pitched') === 'pitched') {
          if ((bar.getAttribute('clef') ?? inherited.clef) !== desired.clef) bar.setAttribute('clef', desired.clef);
          if ((bar.getAttribute('key') ?? inherited.key) !== desired.key) bar.setAttribute('key', desired.key);
        }
        inherited = desired;
      }
    }
  }

  column(index: number): MeasureLocation[] {
    return this.initial.score.staves.map((staff, staffIndex) => {
      const measure = staff.measures[index];
      requireCondition(measure, 'All staves must have matching measure counts before editing ensemble columns.');
      return { staff, staffIndex, measure, measureIndex: index };
    });
  }

  refuseCrossingTies(indices: Set<number>, action: string): void {
    requireCondition(!this.ties.some(edge => edge.from.measureIndex !== edge.to.measureIndex
      && (indices.has(edge.from.measureIndex) || indices.has(edge.to.measureIndex))),
    `Cannot ${action} a measure tied across a barline. Clear the connected ties first or keep the complete tied phrase together.`);
  }

  refuseInsertionThroughTie(after: number): void {
    requireCondition(!this.ties.some(edge => edge.from.measureIndex <= after && edge.to.measureIndex > after),
      'Cannot insert a measure between tied events. Clear the connected tie chain first.');
  }

  copied(element: Element): Element {
    const copy = element.cloneNode(true) as Element;
    const originals = [element, ...element.querySelectorAll('*')];
    [copy, ...copy.querySelectorAll('*')].forEach((node, index) => {
      if (node.localName.startsWith('music-') || node.hasAttribute('id')) node.id = this.id(node.localName.replace(/^music-/, ''));
      const originalId = originals[index].id || this.originalIds.get(originals[index]);
      if (originalId) this.copiedIds[originalId] = node.id;
      const context = this.desiredContexts.get(originals[index]);
      if (context) this.desiredContexts.set(node, context);
    });
    return copy;
  }

  finish(result: EditResult): EditResult {
    if (!this.changed.size) return result;
    const parsed = readScore(this.source);
    let drafts = 0;
    for (const staff of parsed.score.staves) for (const measure of staff.measures) {
      const node = parsed.sources.get(measure.id)!;
      if (!this.changed.has(node)) continue;
      const capacity = meterTime(measure.meter);
      const short = measure.voices.some(voice => compare(totalTime(voice), capacity) < 0);
      if (short && !measure.pickup) {
        requireCondition(!this.explicitlyComplete.has(node), 'This measure is still short. Add explicit notes or rests, or keep it marked as an incomplete draft.');
        node.setAttribute('incomplete', '');
        drafts++;
      } else if (this.completedByFill.has(node) && measure.voices.every(voice => compare(totalTime(voice), capacity) === 0)) {
        node.removeAttribute('incomplete');
      }
    }
    return drafts ? { ...result, message: `${result.message} ${drafts === 1 ? 'The short measure remains an incomplete draft.' : `${drafts} short measures remain incomplete drafts.`}` } : result;
  }
}

function insertEvent(context: EditContext, command: Extract<AuthorCommand, { type: 'insert-event' }>): EditResult {
  const { location, voice, container } = context.voice(command.cursor.measureId, command.cursor.voiceIndex);
  requireCondition(location.staff.id === command.cursor.staffId, 'The insertion cursor must belong to the selected staff and measure.');
  validateEventInput(command.value);
  validateStaffEvent(location.staff, command.value.kind);
  const selected = command.cursor.eventId ? context.event(command.cursor.eventId) : undefined;
  requireCondition(!selected || (selected.measure.id === location.measure.id && selected.voiceIndex === command.cursor.voiceIndex), 'The insertion event must belong to the selected measure and voice.');
  const placeholder = voice.events.length === 1 && voice.events[0].measureRest ? context.event(voice.events[0].id) : undefined;
  if (placeholder || command.position === 'replace') {
    const target = placeholder ?? selected;
    requireCondition(target, voice.events.length === 0
      ? 'This voice is empty. In Next entry → Position, choose Before or After to start writing. Replace needs an existing event.'
      : 'Select an event to replace, or insert before or after the current voice.');
    const replacement = context.replaceEvent(target, command.value);
    return { selectionId: replacement.id, message: placeholder ? 'Replaced the full-measure rest.' : 'Replaced the selected event.' };
  }
  requireCondition(!command.value.measureRest || voice.events.length === 0,
    'A full-measure rest must occupy an otherwise empty voice, not sit beside other events.');
  const position = selected ? selected.eventIndex + (command.position === 'after' ? 1 : 0) : voice.events.length;
  const previous = voice.events[position - 1];
  const next = voice.events[position];
  requireCondition(!(previous && (previous.tie === 'start' || previous.tie === 'continue'))
    && !(next && (next.tie === 'end' || next.tie === 'continue')), 'Clear the connected tie chain before inserting between tied events.');
  const event = context.create(`music-${command.value.kind}`);
  writeEvent(event, command.value);
  if (selected) {
    const anchor = context.node(selected.event.id);
    if (command.position === 'before') anchor.before(event);
    else anchor.after(event);
  } else container.append(event);
  context.changedBar(location.measure);
  return { selectionId: event.id, message: `Inserted ${command.value.kind === 'slash' ? command.value.rhythmic ? 'a rhythmic slash' : 'an open slash' : command.value.kind === 'rhythm' ? 'a rhythm note' : command.value.kind === 'road' ? `a ${command.value.pitchDirection} road event` : `a ${command.value.kind}`}.` };
}

function removeEvents(context: EditContext, ids: readonly string[]): EditResult {
  // Validate every member before touching source; array iteration must expose
  // sparse holes rather than silently omitting a requested selection member.
  requireCondition(Array.isArray(ids) && ids.length > 0
    && [...ids].every(id => typeof id === 'string' && id.length > 0 && !/[\s\0]/.test(id)),
  'Select one or more distinct existing musical events.');
  const selected = context.selected(ids).sort((a, b) => a.measureIndex - b.measureIndex || a.eventIndex - b.eventIndex);
  const first = selected[0];
  requireCondition(selected.every(location => location.staff.id === first.staff.id && location.voiceIndex === first.voiceIndex),
    'Remove events from the same staff and voice. Select each other voice separately.');
  requireCondition(selected.every(location => location.event.tie === 'none'),
    'Clear connected ties before removing any tied event. Then select the music and remove it again.');

  const chosen = new Set(ids);
  const voices = new Map<string, { location: EventLocation; container: Element }>();
  for (const location of selected) {
    if (voices.has(location.measure.id)) continue;
    const empty = location.voice.events.every(event => chosen.has(event.id));
    requireCondition(!empty || !location.measure.pickup,
      `${location.staff.label || location.staff.id}, bar ${location.measure.number}, voice ${location.voiceIndex + 1}: this would empty a pickup. Replace the selected music with written rests preserving its written values, dots, and tuplet ratios.`);
    for (const tuplet of location.voice.tuplets) {
      if (context.node(tuplet.id).localName === 'music-tuplet') continue;
      // Legacy boundaries live on events: deleting both would otherwise make
      // unselected members lose their ratio without a parser error.
      const removesBoundary = chosen.has(tuplet.eventIds[0]) || chosen.has(tuplet.eventIds.at(-1)!);
      requireCondition(!removesBoundary || tuplet.eventIds.every(id => chosen.has(id)),
        'Removing a legacy triplet boundary would change the remaining rhythm. Select the whole triplet, or convert its boundaries to a music-tuplet wrapper in Source first.');
    }
    const { container } = context.voice(location.measure.id, location.voiceIndex);
    voices.set(location.measure.id, { location, container });
  }
  const nodes = selected.map(location => context.node(location.event.id));

  for (const node of nodes) {
    let parent = node.parentElement;
    node.remove();
    while (parent?.localName === 'music-tuplet'
      && !parent.querySelector('music-note, music-chord, music-rest, music-slash, music-rhythm, music-road')) {
      const outer = parent.parentElement;
      parent.replaceWith(...parent.childNodes);
      parent = outer;
    }
  }
  // Empty rhythm is an unfinished draft, not authored silence. finish marks
  // the short measure incomplete; neither notes nor rests are synthesized.
  for (const { location } of voices.values()) context.changedBar(location.measure);
  const following = first.voice.events.slice(first.eventIndex + 1).find(event => !chosen.has(event.id));
  const preceding = first.voice.events.slice(0, first.eventIndex).reverse().find(event => !chosen.has(event.id));
  // Inspect an emptied explicit voice by its own source ID so a parked writing
  // cursor in another voice cannot silently redirect the next Start here action.
  const container = voices.get(first.measure.id)!.container;
  const emptyTarget = container.localName === 'music-voice' ? first.voice.id : first.measure.id;
  return {
    selectionId: following?.id ?? preceding?.id ?? emptyTarget,
    message: `Removed ${selected.length === 1 ? 'the selected event' : `${selected.length} selected events`} without adding replacement music.`,
  };
}

function fillRests(context: EditContext, command: Extract<AuthorCommand, { type: 'fill-rests' }>): EditResult {
  const { location, voice, container } = context.voice(command.measureId, command.voiceIndex);
  requireCondition(!command.tupletId, 'A tuplet ratio does not declare its intended total span. Insert explicit rests inside the tuplet, then complete the measure.');
  requireCondition(!location.measure.pickup, 'A pickup has no separately declared target length. Insert explicit rests to set its duration, or turn off Pickup before completing a full bar.');
  requireCondition(!context.initial.diagnostics.some(diagnostic => diagnostic.code === 'tuplet-span' && voice.tuplets.some(tuplet => tuplet.id === diagnostic.sourceId)),
    'Finish the incomplete tuplet with explicit notes or rests before filling the rest of this voice.');
  let onset = totalTime(voice);
  requireCondition(compare(onset, meterTime(location.measure.meter)) <= 0, 'This voice overflows its measure. Shorten the music before filling rests.');
  const additions: Element[] = [];
  for (const boundary of meterBoundaries(location.measure.meter)) {
    if (compare(boundary, onset) <= 0) continue;
    additions.push(...context.rest(subtract(boundary, onset)));
    requireCondition(additions.length <= MAX_FILL_RESTS, 'Completing this measure would add too many rests. Complete smaller rhythmic scopes explicitly.');
    onset = boundary;
  }
  container.append(...additions);
  const bar = context.node(location.measure.id);
  context.changed.add(bar);
  context.completedByFill.add(bar);
  return { selectionId: additions.at(-1)?.id ?? location.measure.id, message: additions.length ? `Added ${additions.length} ${additions.length === 1 ? 'rest' : 'rests'} without changing existing music.` : 'This voice already fills its measure.' };
}

function appendMeasure(context: EditContext, command: Extract<AuthorCommand, { type: 'append-measure' }>): EditResult {
  const staves = context.initial.score.staves;
  requireCondition(staves.length > 0, 'Add a staff before adding measures.');
  const after = command.afterMeasureId ? context.bar(command.afterMeasureId).measureIndex : staves[0].measures.length - 1;
  const selectedStaff = command.afterMeasureId ? context.bar(command.afterMeasureId).staffIndex : 0;
  const selectedVoice = command.voiceIndex ?? 0;
  const reference = staves[selectedStaff].measures[after] ?? staves[selectedStaff].measures[after + 1];
  requireCondition(Number.isInteger(selectedVoice) && selectedVoice >= 0 && selectedVoice < (reference?.voices.length ?? 1),
    'Choose an existing voice before adding a measure.');
  context.refuseInsertionThroughTie(after);
  let selectionId: string | undefined;
  let cursor: Cursor | undefined;
  staves.forEach((staff, staffIndex) => {
    const owner = context.node(staff.id, 'music-staff');
    const previous = staff.measures[after];
    const next = staff.measures[after + 1];
    const bar = context.create('music-measure');
    const inherited = previous ?? next;
    const defaults = context.source.localName === 'music-system' ? resolvedMeter(context.source, parseMeter()) : parseMeter();
    context.desiredContexts.set(bar, inherited ?? { meter: resolvedMeter(owner, defaults), clef: staff.clef, key: staff.key });
    const voiceCount = previous?.voices.length ?? next?.voices.length ?? 1;
    for (let index = 0; index < voiceCount; index++) {
      const voice = voiceCount > 1 ? context.create('music-voice') : bar;
      const rests = context.rest();
      voice.append(...rests);
      if (voice !== bar) bar.append(voice);
      if (staffIndex === selectedStaff && index === selectedVoice) {
        const eventId = command.voiceIndex === undefined ? undefined : rests[0].id;
        cursor = { staffId: staff.id, measureId: bar.id, voiceIndex: selectedVoice, ...(eventId ? { eventId } : {}) };
        selectionId = eventId ?? bar.id;
      }
    }
    owner.insertBefore(bar, next ? context.node(next.id) : null);
  });
  context.preserveContexts();
  return { selectionId, cursor, message: 'Added a silent measure across every staff.' };
}

function continueEntry(context: EditContext, command: Extract<AuthorCommand, { type: 'append-and-insert' | 'continue-piece' }>): EditResult {
  const reopenEnding = command.type === 'continue-piece';
  if (reopenEnding) requireCondition(command.confirmation === 'final-to-single',
    'Confirm changing the final barlines to single before continuing this piece.');
  const analysis = analyzeContinuation(context.source, command);
  requireCondition(reopenEnding ? analysis.ending : analysis.eligible,
    reopenEnding && analysis.eligible ? 'This column has no final barline to reopen. Use Add measure and insert.' : analysis.reason);
  validateEventInput(command.value);
  if (reopenEnding) {
    for (const member of analysis.affectedStaves) {
      if (member.endBar === 'final') context.node(member.measureId, 'music-measure').setAttribute('end-bar', 'single');
    }
  }
  const appended = appendMeasure(context, { type: 'append-measure', afterMeasureId: command.cursor.measureId, voiceIndex: command.cursor.voiceIndex });
  requireCondition(appended.cursor?.eventId, 'The new measure is missing its target voice. No continuation can be accepted.');
  // The first context describes only the original source. Re-read after append
  // so replacement locates the newly created voice and its own silent rest.
  const next = new EditContext(context.source);
  const inserted = insertEvent(next, { type: 'insert-event', cursor: appended.cursor, value: command.value, position: 'replace' });
  requireCondition(inserted.selectionId, 'The new measure is missing its inserted event. No continuation can be accepted.');
  const cursor = { ...appended.cursor, eventId: inserted.selectionId };
  const staff = analysis.affectedStaves.find(member => member.staffId === command.cursor.staffId);
  return next.finish({
    selectionId: inserted.selectionId, cursor,
    message: `${reopenEnding ? 'Changed final barlines to single and added' : 'Added'} measure ${analysis.newMeasureLabel} across every staff; inserted the event in ${staff?.label || 'the selected staff'}, voice ${cursor.voiceIndex + 1}.`,
  });
}

function duplicateMeasures(context: EditContext, command: Extract<AuthorCommand, { type: 'duplicate-measures' }>): EditResult {
  requireCondition(command.measureIds.length > 0, 'Select at least one measure to duplicate.');
  const first = context.bar(command.measureIds[0]);
  const indices = [...new Set(command.measureIds.map(id => context.bar(id).measureIndex))].sort((a, b) => a - b);
  requireCondition(indices.every((index, position) => index === indices[0] + position), 'Select a contiguous measure range to duplicate.');
  const selected = new Set(indices);
  requireCondition(!context.ties.some(edge => selected.has(edge.from.measureIndex) !== selected.has(edge.to.measureIndex)),
    'Select the complete tied phrase before duplicating; a tie crosses this selection boundary.');
  context.refuseInsertionThroughTie(indices.at(-1)!);
  let selectionId: string | undefined;
  context.initial.score.staves.forEach((staff, staffIndex) => {
    const owner = context.node(staff.id, 'music-staff');
    const following = staff.measures[indices.at(-1)! + 1];
    const anchor = following ? context.node(following.id) : null;
    for (const index of indices) {
      const original = staff.measures[index];
      requireCondition(original, 'All staves must contain the selected measure range.');
      const copy = context.copied(context.node(original.id));
      owner.insertBefore(copy, anchor);
      if (selectionId === undefined && staffIndex === first.staffIndex) selectionId = copy.id;
    }
  });
  context.preserveContexts();
  return { selectionId, copiedIds: context.copiedIds, message: `Duplicated ${indices.length === 1 ? 'the measure' : `${indices.length} measures`} across every staff with new source IDs.` };
}

function addStaff(context: EditContext, command: Extract<AuthorCommand, { type: 'add-staff' }>): EditResult {
  requireCondition(context.source.localName === 'music-system', 'Adding a staff requires a music-system root. Open this score as a project system first.');
  const notation = command.notation ?? 'pitched';
  requireCondition(notation === 'pitched' || notation === 'rhythm' || notation === 'three-roads', 'Staff notation must be pitched, rhythm, or three-roads.');
  if (notation === 'pitched') validateClef(command.clef);
  const initialKey = notation === 'pitched' && command.key !== undefined ? validateKey(command.key) : undefined;
  const reference = context.initial.score.staves[0];
  requireCondition(reference && reference.measures.length, 'Create a first staff with at least one measure before adding another staff.');
  const staff = context.create('music-staff');
  staff.setAttribute('label', command.label);
  if (notation !== 'pitched') staff.setAttribute('notation', notation);
  else {
    staff.setAttribute('clef', command.clef);
    staff.setAttribute('key', initialKey ?? reference.key);
  }
  let previousMeter = resolvedMeter(context.source, parseMeter());
  let previousKey = reference.key;
  for (const [index, original] of reference.measures.entries()) {
    const bar = context.create('music-measure');
    if (!sameMeter(original.meter, previousMeter)) writeMeter(bar, original.meter);
    // The requested initial key governs the opening; later reference key
    // changes retain their bar positions without transposing existing music.
    if (notation === 'pitched' && (index > 0 || initialKey === undefined) && original.key !== previousKey) {
      bar.setAttribute('key', original.key);
    }
    previousMeter = original.meter;
    previousKey = original.key;
    const number = context.node(original.id).getAttribute('number');
    if (number !== null) bar.setAttribute('number', number);
    setBoolean(bar, 'pickup', original.pickup);
    setBoolean(bar, 'repeat-start', original.repeatStart);
    setBoolean(bar, 'keep-with-next', original.keepWithNext);
    if (original.breakBefore !== 'auto') bar.setAttribute('break-before', original.breakBefore);
    if (original.endBar !== 'single') bar.setAttribute('end-bar', original.endBar);
    bar.append(...context.rest(original.pickup ? totalTime(original.voices[0]) : undefined));
    staff.append(bar);
  }
  context.source.append(staff);
  return { selectionId: staff.id, message: `Added ${notation === 'rhythm' ? 'a single-line rhythm staff' : notation === 'three-roads' ? 'a 3 roads music staff' : 'a staff'} with explicit rests aligned to the existing score.` };
}

function addVoice(context: EditContext, measureId: string): EditResult {
  const { measure } = context.bar(measureId);
  const bar = context.node(measureId, 'music-measure');
  const newVoice = context.create('music-voice');
  newVoice.append(...context.rest(measure.pickup ? totalTime(measure.voices[0]) : undefined));
  if (!directChildren(bar, 'music-voice').length) {
    const existing = context.create('music-voice');
    existing.id = measure.voices[0].id;
    // Sequential imported annotations must stay with the original rhythm. Moving
    // them outside the voice would reset their onset; adding at would freeze an
    // authored sequential relationship into a different anchoring policy.
    for (const child of [...bar.childNodes]) {
      if (child.nodeType === 1 && (child as Element).localName === 'music-meter') continue;
      existing.append(child);
    }
    bar.append(existing);
  }
  bar.append(newVoice);
  context.changed.add(bar);
  return { selectionId: newVoice.id, message: 'Added a silent voice without changing the existing voice order.' };
}

function setMeasure(context: EditContext, command: Extract<AuthorCommand, { type: 'set-measure' }>): EditResult {
  const selected = context.bar(command.measureId);
  const values = command.values;
  requireCondition((selected.staff.notation ?? 'pitched') === 'pitched' || (values.key === undefined && values.clef === undefined),
    'Rhythm and 3 roads music staves have no clef or key signature. Omit clef and key when editing their measures.');
  let meter: Meter | undefined;
  if (values.meter !== undefined || values.groups !== undefined) {
    const parts = (values.meter ?? selected.measure.meter.display).trim().split('/');
    requireCondition(parts.length === 2, 'Write a meter such as 7/8 or 2+2+3/8.');
    meter = parseMeter(parts[0], parts[1], values.groups?.trim() || undefined);
  }
  if (values.key !== undefined) validateKey(values.key);
  if (values.clef !== undefined) validateClef(values.clef);
  const column = context.column(selected.measureIndex);
  if (meter || values.pickup !== undefined) for (const location of column) {
    const bar = context.node(location.measure.id);
    if (meter) {
      if (!sameMeter(meter, location.measure.meter)) context.pinFollowing(location, ['meter']);
      writeMeter(bar, meter);
    }
    if (values.pickup !== undefined) setBoolean(bar, 'pickup', values.pickup);
    context.changed.add(bar);
  }
  const bar = context.node(command.measureId);
  const changedContext: ('key' | 'clef')[] = [];
  if (values.key !== undefined && values.key !== selected.measure.key) changedContext.push('key');
  if (values.clef !== undefined && values.clef !== selected.measure.clef) changedContext.push('clef');
  context.pinFollowing(selected, changedContext);
  if (values.key !== undefined) bar.setAttribute('key', values.key);
  if (values.clef !== undefined) bar.setAttribute('clef', values.clef);
  if (values.incomplete !== undefined) {
    setBoolean(bar, 'incomplete', values.incomplete);
    if (!values.incomplete) context.explicitlyComplete.add(bar);
  }
  if (values.endBar !== undefined) bar.setAttribute('end-bar', values.endBar);
  if (values.repeatStart !== undefined) setBoolean(bar, 'repeat-start', values.repeatStart);
  context.changed.add(bar);
  return { selectionId: command.measureId, message: meter || values.pickup !== undefined ? 'Updated this measure column; following musical context is unchanged.' : 'Updated this measure; following musical context is unchanged.' };
}

function wrapTuplet(context: EditContext, command: Extract<AuthorCommand, { type: 'wrap-tuplet' }>): EditResult {
  const selection = context.selected(command.eventIds).sort((a, b) => a.eventIndex - b.eventIndex);
  const first = selection[0];
  requireCondition(selection.every(location => location.measure.id === first.measure.id && location.voiceIndex === first.voiceIndex), 'A tuplet must stay within one voice and measure.');
  requireCondition(selection.every((location, index) => location.eventIndex === first.eventIndex + index), 'Select contiguous events for a tuplet.');
  const nodes = selection.map(location => context.node(location.event.id));
  requireCondition(!selection.some(location => location.event.measureRest), 'A full-measure rest cannot belong to a tuplet. Replace it with written rests first.');
  let parent = nodes[0].parentElement;
  while (parent && !nodes.every(node => parent!.contains(node))) parent = parent.parentElement;
  requireCondition(parent && ['music-measure', 'music-voice', 'music-tuplet'].includes(parent.localName), 'Select a contiguous rhythmic group inside one voice.');
  requireCondition(!parent.querySelector('[triplet]'), 'Convert legacy triplet markers to music-tuplet wrappers in source before editing group structure.');
  const branch = (node: Element): Element => {
    let current = node;
    while (current.parentElement !== parent) {
      requireCondition(current.parentElement, 'The tuplet selection is no longer in this score.');
      current = current.parentElement;
    }
    return current;
  };
  const children = [...parent.childNodes];
  const start = children.indexOf(branch(nodes[0]));
  const end = children.indexOf(branch(nodes.at(-1)!));
  const content = children.slice(start, end + 1);
  const selectedNodes = new Set(nodes);
  for (const child of content) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const events = EVENT_TAGS.has(element.localName) ? [element] : [...element.querySelectorAll('music-note, music-chord, music-rest, music-slash, music-rhythm, music-road')];
    requireCondition(events.every(event => selectedNodes.has(event)), 'Select the whole nested tuplet, or select a group entirely inside it. Tuplet boundaries cannot be split.');
  }
  const wrapper = context.create('music-tuplet');
  tupletValues(wrapper, command);
  parent.insertBefore(wrapper, content[0]);
  wrapper.append(...content);
  context.changedBar(first.measure);
  return { selectionId: wrapper.id, message: 'Grouped the selected written values in an exact tuplet ratio.' };
}

function tieEvents(context: EditContext, ids: readonly string[]): EditResult {
  const selected = context.selected(ids);
  requireCondition(selected.length >= 2, 'Select at least two consecutive pitched events, rhythm notes, or road events to tie.');
  const first = selected[0];
  requireCondition(selected.every(location => location.staff.id === first.staff.id && location.voiceIndex === first.voiceIndex), 'Ties must connect events in the same staff and voice.');
  const timeline = first.staff.measures.flatMap(measure => measure.voices[first.voiceIndex]?.events ?? []);
  const order = new Map(timeline.map((event, index) => [event.id, index]));
  selected.sort((a, b) => order.get(a.event.id)! - order.get(b.event.id)!);
  const start = order.get(selected[0].event.id)!;
  requireCondition(selected.every((location, index) => order.get(location.event.id) === start + index), 'Ties connect consecutive events; include every intervening event in this voice.');
  const signature = pitchSignature(selected[0].event);
  const rhythm = selected.every(location => location.event.kind === 'rhythm');
  const roads = selected.every(location => location.event.kind === 'road');
  requireCondition(rhythm || roads || (signature && selected.every(location => (location.event.kind === 'note' || location.event.kind === 'chord') && pitchSignature(location.event) === signature)),
    'Ties require exactly the same spelled pitches and octaves, including every chord pitch, consecutive rhythm notes, or consecutive road events. Rests and slashes cannot be tied. A tie is not a slur.');
  requireCondition(!roads || selected.slice(1).every(location => location.event.pitchDirection === 'same'),
    'A tied road continuation sustains the chosen pitch. Set every event after the first to Same (middle) before tying; higher and lower require a new attack.');
  for (let index = selected[0].measureIndex; index <= selected.at(-1)!.measureIndex; index++) {
    requireCondition(first.staff.measures[index].voices[first.voiceIndex], 'The tied voice must exist in every intervening measure.');
  }
  const chosen = new Set(ids);
  requireCondition(!context.ties.some(edge => chosen.has(edge.from.event.id) !== chosen.has(edge.to.event.id)), 'Include the complete existing tie chain or clear it before creating a new tie.');
  selected.forEach((location, index) => context.node(location.event.id).setAttribute('tie', index === 0 ? 'start' : index === selected.length - 1 ? 'end' : 'continue'));
  return { selectionId: selected.at(-1)!.event.id, message: `Tied ${selected.length} consecutive events in the same voice.` };
}

function clearTies(context: EditContext, ids: readonly string[]): EditResult {
  context.selected(ids);
  const chosen = new Set(ids);
  const adjacent = new Map<string, string[]>();
  for (const edge of context.ties) {
    adjacent.set(edge.from.event.id, [...adjacent.get(edge.from.event.id) ?? [], edge.to.event.id]);
    adjacent.set(edge.to.event.id, [...adjacent.get(edge.to.event.id) ?? [], edge.from.event.id]);
  }
  const queue = [...ids];
  for (let index = 0; index < queue.length; index++) for (const id of adjacent.get(queue[index]) ?? []) {
    if (chosen.has(id)) continue;
    chosen.add(id);
    queue.push(id);
  }
  let cleared = 0;
  for (const id of chosen) {
    const node = context.node(id);
    if (node.hasAttribute('tie')) cleared++;
    node.removeAttribute('tie');
  }
  return { selectionId: ids[0], message: cleared ? `Cleared ties on ${cleared} events, including their connected chains.` : 'The selected events have no ties.' };
}

function convertEvents(context: EditContext, command: Extract<AuthorCommand, { type: 'convert-events' }>): EditResult {
  const selected = context.selected(command.eventIds);
  if (command.kind === 'note') parsePitch(command.pitch);
  if (command.kind === 'road') {
    requireCondition(command.pitchDirection !== undefined, 'Choose Higher, Same, or Lower explicitly before converting to road events.');
    validatePitchDirection(command.pitchDirection);
  } else requireCondition(command.pitchDirection === undefined, 'Pitch direction belongs only to a 3 roads event.');
  const chosen = new Set(command.eventIds);
  const inspectedVoices = new Set<string>();
  for (const location of selected) {
    validateStaffEvent(location.staff, command.kind);
    assertEventMarkingsCompatible(location.event, { kind: command.kind, rhythmic: command.kind === 'slash' && command.rhythmic });
    requireCondition(location.event.tie === 'none', 'Clear the connected tie chain before converting tied events.');
    requireCondition(!location.event.measureRest || command.kind === 'rest', 'Replace a full-measure rest with an explicit duration before converting it to a note, rhythm note, road event, or slash.');
    if (command.kind === 'slash' && !command.rhythmic && !inspectedVoices.has(location.voice.id)) {
      inspectedVoices.add(location.voice.id);
      let group: MusicEvent[] | undefined;
      for (const event of location.voice.events) {
        if (event.beam === 'start') group = [];
        if (group) group.push(event);
        if (event.beam === 'end' && group) {
          if (group.some(member => chosen.has(member.id))) requireCondition(group.every(member => chosen.has(member.id)), 'Select the complete explicit beam group before converting it to open slashes.');
          group = undefined;
        }
      }
    }
  }
  for (const location of selected) {
    const event = location.event;
    context.replaceEvent(location, {
      kind: command.kind, pitch: command.pitch, pitches: '', duration: event.duration, dots: event.dots,
      ...(command.kind === 'road' ? { pitchDirection: command.pitchDirection } : {}),
      rhythmic: command.kind === 'slash' && command.rhythmic, measureRest: event.measureRest && command.kind === 'rest',
      accidentalDisplay: event.pitches[0]?.display ?? 'auto', stem: event.stem,
      beam: command.kind === 'slash' && !command.rhythmic ? 'none' : event.beam,
    });
  }
  return { selectionId: selected[0].event.id, message: command.kind === 'slash'
    ? command.rhythmic ? 'Converted to rhythmic slashes: written attacks remain specified; pitches were removed.' : 'Converted to open slashes: pitches and required attacks were removed; nominal musical positions remain.'
    : command.kind === 'rest' ? 'Converted to written silence, preserving exact duration.'
      : command.kind === 'rhythm' ? 'Converted to rhythm notes: the written durations are specified without pitches.'
        : command.kind === 'road' ? `Converted to ${command.pitchDirection} road events, preserving written rhythm without choosing pitches.`
        : 'Converted to the explicitly entered pitch, preserving written rhythm.' };
}

function editEventMarkings(context: EditContext, eventId: string, edits: readonly EventMarkingEdit[], intervalScope?: 'tie-chain'): EditResult {
  requireCondition(intervalScope === undefined || intervalScope === 'tie-chain', 'Choose the explicit tie-chain interval scope, or omit scope to edit only this event.');
  const { event } = context.event(eventId);
  const changed = intervalScope === 'tie-chain'
    ? applyRoadTieIntervalEdits(context.initial.score, eventId, context.initial.sources, edits, tag => context.create(tag))
    : applyEventMarkingEdits(context.node(eventId), event, context.initial.sources, edits, tag => context.create(tag));
  return { selectionId: event.id, message: changed
    ? intervalScope === 'tie-chain' ? 'Updated the complete tied interval set and this event’s local markings; ties, written rhythm and unrelated source data are unchanged.'
      : 'Updated the attached event markings; written rhythm and unrelated source data are unchanged.'
    : 'The attached event markings already match; nothing changed.' };
}

/**
 * Edit an isolated source tree. The caller validates and commits the whole transaction.
 * Existing ties are retained by event updates; invalid tie/beam edits are never repaired.
 * Structural changes preserve resolved context, and clear-ties clears complete chains.
 */
export function applyCommand(source: Element, command: AuthorCommand): EditResult {
  const context = new EditContext(source);
  let result: EditResult;
  switch (command.type) {
    case 'insert-event': result = insertEvent(context, command); break;
    case 'append-and-insert':
    case 'continue-piece': result = continueEntry(context, command); break;
    case 'set-events-property': {
      const applied = applyEventPropertyChange(context.initial.score, context.initial.sources,
        command.eventIds, command.change, tag => context.create(tag));
      for (const id of applied.rhythmChangedEventIds) context.changedBar(context.event(id).measure);
      // A batch retains the user's exact set/primary and independent entry cursor.
      // Returning the first member would silently collapse that selection.
      result = { message: applied.changedEventIds.length
        ? 'Updated ' + applied.changedEventIds.length + ' selected event' + (applied.changedEventIds.length === 1 ? '' : 's')
          + '; unrelated source fields, ties and tuplet ratios are preserved.'
        : 'Every selected event already matches this property; nothing changed.' };
      break;
    }
    case 'update-event': {
      const location = context.event(command.eventId);
      if (command.fields !== undefined) {
        validateEventPatchFields(command.fields);
        if (!command.fields.includes('kind') || command.value.kind === location.event.kind) {
          if (command.fields.includes('rhythmic') && typeof command.value.rhythmic === 'boolean'
            && command.value.rhythmic !== location.event.rhythmic) {
            assertEventMarkingsCompatible(location.event, { kind: location.event.kind, rhythmic: command.value.rhythmic });
          }
          const patch = patchEventFields(context.node(command.eventId), location.event, command.value, command.fields);
          if (patch.rhythmChanged) context.changedBar(location.measure);
          result = { selectionId: command.eventId, message: patch.changed
            ? 'Updated the selected event fields; other authored settings are unchanged and ties remain subject to validation.'
            : 'The event already matches these fields; nothing changed.' };
          break;
        }
      }
      const replacement = context.replaceEvent(location, command.value);
      result = { selectionId: replacement.id, message: 'Updated the event; existing ties remain subject to validation.' };
      break;
    }
    case 'add-event-marking': result = editEventMarkings(context, command.eventId, [{ type: 'add', value: command.value }]); break;
    case 'update-event-marking': result = editEventMarkings(context, command.eventId, [{ type: 'update', markingId: command.markingId, value: command.value, fields: command.fields }]); break;
    case 'remove-event-marking': result = editEventMarkings(context, command.eventId, [{ type: 'remove', markingId: command.markingId }]); break;
    case 'edit-event-markings': result = editEventMarkings(context, command.eventId, command.edits, command.intervalScope); break;
    case 'set-note-pitch': {
      requireCondition(command.ties === 'reject', 'Pitch-only editing does not change tied chains.');
      const { event } = context.event(command.eventId);
      requireCondition(event.kind === 'note' && event.pitches.length === 1,
        'Pitch dragging edits a single note only. Use the inspector for chords; rests, slashes, rhythm notes, and road events have no fixed pitch.');
      const previous = event.pitches[0];
      const next = parsePitch(command.pitch, undefined, previous.display);
      if (next.step === previous.step && next.octave === previous.octave && next.alter === previous.alter) {
        result = { selectionId: event.id, message: 'The note already has this pitch; nothing changed.' };
        break;
      }
      requireCondition(event.tie === 'none',
        'Pitch dragging cannot change a tied note. Clear the connected tie chain before changing a single note.');
      const node = context.node(event.id, 'music-note');
      // Pitch-only editing must not normalize rhythmic, engraving, or metadata
      // attributes. Explicit spelling replaces the legacy alteration attribute.
      node.setAttribute('pitch', pitchText(next));
      node.removeAttribute('accidental');
      result = { selectionId: event.id, message: `Changed pitch to ${pitchText(next)}; rhythm and notation settings are unchanged.` };
      break;
    }
    case 'set-note-accidental': {
      requireCondition(command.ties === 'reject', 'Accidental editing does not change tied chains.');
      validateAlteration(command.alter);
      const { event } = context.event(command.eventId);
      requireCondition(event.kind === 'note' && event.pitches.length === 1,
        'Accidental controls edit a single note only. Use the inspector to spell chord pitches; rests, slashes, rhythm notes, and road events have no fixed pitch.');
      const previous = event.pitches[0];
      if (command.alter === previous.alter) {
        result = { selectionId: event.id, message: 'The note already has this accidental; nothing changed.' };
        break;
      }
      requireCondition(event.tie === 'none',
        'Cannot change the accidental of a tied note. Clear the connected tie chain before changing a single note.');
      const next = pitchText({ ...previous, alter: command.alter });
      const node = context.node(event.id, 'music-note');
      // Choose an absolute alteration on the existing letter and octave, not a
      // semitone shift or a key-relative pitch. Leave display policy untouched.
      node.setAttribute('pitch', next);
      node.removeAttribute('accidental');
      result = { selectionId: event.id, message: `Changed accidental to ${next}; rhythm and notation settings are unchanged.` };
      break;
    }
    case 'set-event-rhythm': {
      requireCondition(Number.isSafeInteger(command.dots) && command.dots >= 0 && command.dots <= 3,
        'Dots must be an integer from 0 to 3.');
      durationTime(command.duration, command.dots);
      const location = context.event(command.eventId);
      const { event } = location;
      requireCondition(!event.measureRest,
        'A full-measure rest follows the meter. Replace it with an ordinary written rest before choosing a duration.');
      requireCondition(event.kind !== 'slash' || event.rhythmic,
        'An open slash does not prescribe a written attack. Use the inspector to change its nominal duration or explicitly convert it to a rhythmic slash.');
      if (command.duration === event.duration && command.dots === event.dots) {
        result = { selectionId: event.id, message: 'The event already has this written rhythm; nothing changed.' };
        break;
      }
      const node = context.node(event.id);
      // Narrow changes preserve spelling, ties, tuplets, engraving, and source
      // metadata. Keep a legacy dotted spelling unless its dot count changes.
      if (command.duration !== event.duration) node.setAttribute('duration', command.duration);
      if (command.dots !== event.dots) {
        node.removeAttribute('dotted');
        if (command.dots) node.setAttribute('dots', String(command.dots));
        else node.removeAttribute('dots');
      }
      context.changedBar(location.measure);
      result = { selectionId: event.id, message: 'Changed the written rhythm; pitches, ties, and tuplet ratios remain subject to validation.' };
      break;
    }
    case 'remove-events': result = removeEvents(context, command.eventIds); break;
    case 'remove-event': {
      const location = context.event(command.eventId);
      requireCondition(location.voice.events.length > 1, 'Removing this event would leave an empty voice. Replace it with an explicit rest, or remove the whole measure.');
      requireCondition(location.event.tie === 'none', 'Clear the connected tie chain before removing a tied event.');
      const node = context.node(command.eventId);
      let parent = node.parentElement;
      node.remove();
      while (parent?.localName === 'music-tuplet' && !parent.querySelector('music-note, music-chord, music-rest, music-slash, music-rhythm, music-road')) {
        const outer = parent.parentElement;
        parent.replaceWith(...parent.childNodes);
        parent = outer;
      }
      context.changedBar(location.measure);
      result = { selectionId: location.voice.events[location.eventIndex + 1]?.id ?? location.voice.events[location.eventIndex - 1]?.id ?? location.measure.id, message: 'Removed the event without inventing replacement music.' };
      break;
    }
    case 'fill-rests': result = fillRests(context, command); break;
    case 'append-measure': result = appendMeasure(context, command); break;
    case 'duplicate-measures': result = duplicateMeasures(context, command); break;
    case 'move-measure': {
      const location = context.bar(command.measureId);
      requireCondition(command.direction === -1 || command.direction === 1, 'Move a measure one column left or right.');
      const target = location.measureIndex + command.direction;
      requireCondition(target >= 0 && target < location.staff.measures.length, 'This measure is already at that end of the score.');
      context.refuseCrossingTies(new Set([location.measureIndex, target]), 'move');
      for (const member of context.column(location.measureIndex)) {
        const bar = context.node(member.measure.id);
        const adjacent = context.node(member.staff.measures[target].id);
        if (command.direction === -1) adjacent.before(bar);
        else adjacent.after(bar);
      }
      context.preserveContexts();
      result = { selectionId: command.measureId, message: 'Moved the whole measure column, preserving voices and musical context.' };
      break;
    }
    case 'remove-measure': {
      const location = context.bar(command.measureId);
      requireCondition(location.staff.measures.length > 1, 'Keep at least one measure in the score. Replace its contents with explicit rests instead.');
      context.refuseCrossingTies(new Set([location.measureIndex]), 'remove');
      for (const member of context.column(location.measureIndex)) context.node(member.measure.id).remove();
      context.preserveContexts();
      result = { selectionId: location.staff.measures[location.measureIndex + 1]?.id ?? location.staff.measures[location.measureIndex - 1]?.id, message: 'Removed the whole measure column; following musical context is unchanged.' };
      break;
    }
    case 'add-staff': result = addStaff(context, command); break;
    case 'set-staff': {
      const staff = context.node(command.staffId, 'music-staff');
      const original = context.initial.score.staves.find(item => item.id === command.staffId)!;
      const notation = command.notation ?? original.notation ?? 'pitched';
      requireCondition(notation === 'pitched' || notation === 'rhythm' || notation === 'three-roads', 'Staff notation must be pitched, rhythm, or three-roads.');
      const events = original.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events));
      if (notation === 'three-roads') {
        requireCondition(events.every(event => event.kind === 'road' || event.kind === 'rest'),
          '3 roads music accepts only road events and rests. Explicitly convert incompatible events to rests, or clear them, before changing the staff.');
      } else if (notation === 'rhythm') {
        requireCondition(!events.some(event => event.kind === 'note' || event.kind === 'chord'),
          'This staff still contains pitched notes or chords. Explicitly convert them to rests or slashes, or clear them, before changing to rhythm notation.');
        requireCondition(!events.some(event => event.kind === 'road'),
          'This staff still contains road directions. Explicitly convert those events to rests, or clear them, before changing to rhythm notation.');
      } else {
        requireCondition(!events.some(event => event.kind === 'rhythm'),
          'This staff still contains rhythm notes. Explicitly convert them to rests or slashes, or clear them, before changing to pitched notation.');
        requireCondition(!events.some(event => event.kind === 'road'),
          'This staff still contains road directions. Explicitly convert those events to rests, or clear them, before changing to pitched notation.');
        validateClef(command.clef);
        validateKey(command.key);
      }
      staff.setAttribute('label', command.label);
      if (notation !== 'pitched') {
        staff.setAttribute('notation', notation);
        // Changing staff notation is explicit. Remove its incompatible pitch
        // context only after checking that no written pitches would be lost.
        for (const owner of [staff, ...directChildren(staff, 'music-measure')]) {
          owner.removeAttribute('clef'); owner.removeAttribute('key');
        }
      } else {
        if (staff.getAttribute('notation') === 'rhythm' || staff.getAttribute('notation') === 'three-roads') staff.removeAttribute('notation');
        staff.setAttribute('clef', command.clef);
        staff.setAttribute('key', command.key);
      }
      result = { selectionId: command.staffId, message: notation === 'rhythm'
        ? 'Updated the single-line rhythm staff; it has no clef, key signature, or pitch mapping.'
        : notation === 'three-roads' ? 'Updated the 3 roads music staff; directions guide chosen pitches without a clef, key signature, or fixed-pitch mapping.'
        : 'Updated the staff defaults; explicit measure changes remain in force and pitches are not transposed.' };
      break;
    }
    case 'add-voice': result = addVoice(context, command.measureId); break;
    case 'set-measure': result = setMeasure(context, command); break;
    case 'add-annotation': {
      const bar = context.node(command.measureId, 'music-measure');
      const annotation = context.create(`music-${command.value.kind}`);
      writeAnnotation(annotation, command.value);
      bar.append(annotation);
      result = { selectionId: annotation.id, message: command.value.kind === 'harmony' || command.value.kind === 'direction' ? 'Added text at an exact musical position; it does not create playback or harmonic semantics.' : 'Added the annotation at an exact musical position.' };
      break;
    }
    case 'update-annotation': {
      const previous = context.node(command.annotationId);
      const accepted = [...context.measures.values()].flatMap(({ measure }) => measure.annotations).find(annotation => annotation.id === command.annotationId);
      requireCondition(accepted, 'Select an existing annotation to edit.');
      if (command.fields !== undefined) {
        result = patchAnnotation(previous, accepted, command.value, command.fields);
        break;
      }
      const annotation = previous.localName === `music-${command.value.kind}` ? previous : source.ownerDocument.createElement(`music-${command.value.kind}`);
      if (annotation !== previous) for (const attribute of previous.attributes) if (!ANNOTATION_ATTRIBUTES.has(attribute.name)) annotation.setAttribute(attribute.name, attribute.value);
      annotation.id = command.annotationId;
      writeAnnotation(annotation, command.value);
      if (annotation !== previous) previous.replaceWith(annotation);
      result = { selectionId: annotation.id, message: 'Updated the annotation without interpreting its prose as music.' };
      break;
    }
    case 'remove-annotation': {
      const location = [...context.measures.values()].find(({ measure }) => measure.annotations.some(annotation => annotation.id === command.annotationId));
      requireCondition(location, 'Select an existing annotation to remove.');
      context.node(command.annotationId).remove();
      result = { selectionId: location.measure.id, message: 'Removed the annotation.' };
      break;
    }
    case 'wrap-tuplet': result = wrapTuplet(context, command); break;
    case 'set-tuplet': {
      const tuplet = context.node(command.tupletId, 'music-tuplet');
      const bar = tuplet.closest('music-measure');
      requireCondition(bar, 'Select a tuplet inside a measure.');
      tupletValues(tuplet, command);
      context.changed.add(bar);
      result = { selectionId: command.tupletId, message: 'Updated the tuplet ratio and display; written values remain unchanged.' };
      break;
    }
    case 'unwrap-tuplet': {
      const tuplet = context.node(command.tupletId, 'music-tuplet');
      const bar = tuplet.closest('music-measure');
      requireCondition(bar, 'Select a tuplet inside a measure.');
      const location = [...context.measures.values()].find(member => context.node(member.measure.id) === bar)!;
      tuplet.replaceWith(...tuplet.childNodes);
      context.changed.add(bar);
      result = { selectionId: location.measure.id, message: 'Removed the tuplet multiplier, preserving its written events and nested groups.' };
      break;
    }
    case 'tie-events': result = tieEvents(context, command.eventIds); break;
    case 'clear-ties': result = clearTies(context, command.eventIds); break;
    case 'convert-events': result = convertEvents(context, command); break;
  }
  return context.finish(result);
}
