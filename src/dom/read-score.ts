import {
  add, durationTime, meterTime, multiply, parseDuration, parseMeter,
  parsePitch, rational, validateClef, validateKey, validateScore,
} from '../model/index';
import type {
  Annotation, Clef, Diagnostic, Duration, Measure, Meter, MusicEvent, Rational,
  Score, Staff, Tuplet, Voice,
} from '../model/types';
import { isKnownAttribute, MUSIC_ATTRIBUTES } from './attributes';

export interface ReadScoreResult {
  readonly score: Score;
  readonly diagnostics: Diagnostic[];
  /** Includes generated model nodes, such as the implicit voice of a measure. */
  readonly sources: ReadonlyMap<string, Element>;
}

interface Context { meter: Meter; clef: Clef; key: string }
interface TupletDraft extends Omit<Tuplet, 'eventIds'> { eventIds: string[] }
interface VoiceDraft { id: string; events: MusicEvent[]; tuplets: TupletDraft[]; onset: Rational }

// Identity survives edits and reordering without adding attributes to the source DOM.
const identities = new WeakMap<Element, Map<string, string>>();
let identitySequence = 0;
const MAX_TUPLET_DEPTH = 16;
const rhythmTags = new Set(['music-note', 'music-chord', 'music-rest', 'music-slash']);
const annotationTags = new Set(['music-tempo', 'music-dynamics', 'music-direction', 'music-harmony', 'music-rehearsal']);
const zero = rational(0);
const one = rational(1);

function tagOf(element: Element): string { return element.localName.toLowerCase(); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class Reader {
  readonly diagnostics: Diagnostic[] = [];
  readonly sources = new Map<string, Element>();
  private readonly explicitOwners = new Map<string, Element>();
  private readonly checkedAttributes = new WeakSet<Element>();

  constructor(root: Element) {
    const elements = [root, ...root.querySelectorAll('[id]')];
    for (const element of elements) {
      const id = element.getAttribute('id');
      if (id && !/[\s\0]/.test(id) && !this.explicitOwners.has(id)) this.explicitOwners.set(id, element);
    }
    for (const element of elements) {
      const id = element.getAttribute('id');
      if (id === null) continue;
      if (!id || /[\s\0]/.test(id)) {
        this.problem(element, 'invalid-id', 'An id must be nonempty and must not contain whitespace or null characters.');
      } else if (this.explicitOwners.get(id) !== element) {
        this.problem(element, 'duplicate-id', `The id "${id}" is already used in this score. Give each source element its own id.`);
      }
    }
  }

  id(element: Element, role = 'element'): string {
    const explicit = role === 'element' ? element.getAttribute('id') : null;
    if (explicit && this.explicitOwners.get(explicit) === element) {
      this.sources.set(explicit, element);
      return explicit;
    }
    let roles = identities.get(element);
    if (!roles) { roles = new Map(); identities.set(element, roles); }
    let id = roles.get(role);
    if (!id || this.explicitOwners.has(id) || (this.sources.has(id) && this.sources.get(id) !== element)) {
      do { id = `music-auto-${role === 'element' ? tagOf(element).replace(/^music-/, '') : role}-${++identitySequence}`; }
      while (this.explicitOwners.has(id) || this.sources.has(id));
      roles.set(role, id);
    }
    this.sources.set(id, element);
    return id;
  }

  problem(element: Element, code: string, message: string, measureId?: string, severity: Diagnostic['severity'] = 'error'): void {
    this.diagnostics.push({ severity, code, message, sourceId: this.id(element), ...(measureId ? { measureId } : {}) });
  }

  attempt<T>(element: Element, code: string, operation: () => T, measureId?: string): T | undefined {
    try { return operation(); }
    catch (error) { this.problem(element, code, messageOf(error), measureId); return undefined; }
  }

  attributes(element: Element, measureId?: string): void {
    if (this.checkedAttributes.has(element)) return;
    this.checkedAttributes.add(element);
    const tag = tagOf(element);
    for (const attribute of element.attributes) {
      if (!isKnownAttribute(tag, attribute.name)) {
        this.problem(element, 'unknown-attribute', `Unknown attribute "${attribute.name}" on <${tag}>. Check the spelling, or use data-* for application metadata.`, measureId);
      }
    }
  }

  boolean(element: Element, name: string, measureId?: string): boolean {
    const value = element.getAttribute(name);
    if (value === null) return false;
    if (value !== '' && value !== name && value !== 'true') {
      this.problem(element, 'invalid-boolean', `"${name}" is a boolean attribute: its presence enables it. Use ${name} without a value, or remove the attribute to disable it.`, measureId);
    }
    return true;
  }

  choice<T extends string>(element: Element, name: string, values: readonly T[], fallback: T, measureId?: string): T {
    const value = element.getAttribute(name);
    if (value === null) return fallback;
    if (values.includes(value as T)) return value as T;
    this.problem(element, 'invalid-attribute', `"${name}" must be ${values.map(v => `"${v}"`).join(', ')}; received "${value}".`, measureId);
    return fallback;
  }

  integer(element: Element, name: string, minimum: number, maximum: number, fallback?: number, measureId?: string): number | undefined {
    const value = element.getAttribute(name);
    if (value === null && fallback !== undefined) return fallback;
    const number = value === null ? NaN : Number(value);
    if (value !== null && /^\d+$/.test(value.trim()) && Number.isSafeInteger(number) && number >= minimum && number <= maximum) return number;
    this.problem(element, 'invalid-number', `"${name}" must be an integer from ${minimum} to ${maximum}.`, measureId);
    return undefined;
  }

  dots(element: Element, measureId?: string): number | undefined {
    const dotted = this.boolean(element, 'dotted', measureId);
    const dots = this.integer(element, 'dots', 0, 3, dotted ? 1 : 0, measureId);
    if (element.hasAttribute('dots') && dotted && dots !== 1) {
      this.problem(element, 'conflicting-dots', 'Use dots for the dot count, or the legacy dotted attribute for one dot; do not give conflicting values.', measureId);
    }
    return dots;
  }

  leaf(element: Element, measureId: string): void {
    if (element.children.length || element.textContent?.trim()) {
      this.problem(element, 'nonempty-rhythm-element', `<${tagOf(element)}> cannot contain children or text. Custom HTML elements require an explicit closing tag; XML-style <music-note /> does not close an HTML element.`, measureId);
    }
  }

  unexpected(element: Element, parent: Element, measureId?: string): void {
    const tag = tagOf(element);
    const code = Object.hasOwn(MUSIC_ATTRIBUTES, tag) ? 'unexpected-element' : 'unknown-element';
    this.problem(element, code, `<${tag}> is not valid inside <${tagOf(parent)}>. Put measures directly in a staff, and rhythm directly in a measure, voice, or tuplet.`, measureId);
  }

  containerText(element: Element, measureId?: string): void {
    if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim())) {
      this.problem(element, 'unexpected-text', `Text inside <${tagOf(element)}> must be placed in a music-direction, music-harmony, or another annotation element.`, measureId);
    }
  }

  context(element: Element, inherited: Context, measureId?: string): Context {
    let { meter, clef, key } = inherited;
    if (element.hasAttribute('clef')) clef = this.attempt(element, 'invalid-clef', () => validateClef(element.getAttribute('clef')!), measureId) ?? clef;
    if (element.hasAttribute('key')) key = this.attempt(element, 'invalid-key', () => validateKey(element.getAttribute('key')!), measureId) ?? key;
    const signature = element.getAttribute('meter');
    const groups = element.getAttribute('groups');
    if (signature !== null || groups !== null) {
      const next = this.attempt(element, 'invalid-meter', () => {
        const value = signature ?? meter.display;
        const parts = value.trim().split('/');
        if (parts.length !== 2) throw new RangeError('A meter must have a numerator and denominator, such as 7/8 or 2+2+3/8.');
        return parseMeter(parts[0], parts[1], groups ?? undefined);
      }, measureId);
      if (next) meter = next;
    }
    return { meter, clef, key };
  }

  meterElement(element: Element, measureId: string): Meter | undefined {
    this.attributes(element, measureId);
    this.leaf(element, measureId);
    return this.attempt(element, 'invalid-meter', () => parseMeter(
      element.getAttribute('top') ?? '4',
      element.getAttribute('bottom') ?? '4',
      element.getAttribute('groups') ?? undefined,
    ), measureId);
  }

  annotation(element: Element, onset: Rational, measureId: string): Annotation | undefined {
    this.attributes(element, measureId);
    const kind = tagOf(element).replace('music-', '') as Annotation['kind'];
    let text = element.getAttribute(kind === 'tempo' ? 'marking' : kind === 'dynamics' ? 'level' : 'text');
    text ??= element.getAttribute('text') ?? element.textContent?.trim() ?? '';
    if (kind === 'dynamics' && !element.hasAttribute('level') && !element.hasAttribute('text') && !text.trim()) text = 'mf';
    // Annotation content is plain text, not a second notation tree.
    if ([...element.querySelectorAll('*')].some(child => tagOf(child).startsWith('music-'))) {
      this.problem(element, 'nested-notation', 'An annotation cannot contain music elements. Close the annotation before writing the next musical event.', measureId);
    }
    const at = element.getAttribute('at');
    if (at !== null) {
      const parsed = this.attempt(element, 'invalid-onset', () => {
        const match = /^(\d+)(?:\/(\d+))?$/.exec(at.trim());
        if (!match) throw new RangeError('"at" must be a nonnegative whole-note fraction, such as 0, 1/4, or 3/8.');
        return rational(Number(match[1]), Number(match[2] ?? 1));
      }, measureId);
      if (!parsed) return undefined;
      onset = parsed;
    }
    const result: Annotation = {
      id: this.id(element), kind, onset, text,
      placement: this.choice(element, 'placement', ['above', 'below'], kind === 'dynamics' ? 'below' : 'above', measureId),
    };
    if (kind !== 'tempo') {
      if (!text.trim()) { this.problem(element, 'empty-annotation', `<${tagOf(element)}> needs text${kind === 'dynamics' ? ' or a level attribute' : ''}.`, measureId); return undefined; }
      return result;
    }
    let bpm: number | undefined;
    const value = element.getAttribute('bpm');
    if (value !== null) {
      bpm = Number(value);
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || !Number.isFinite(bpm) || bpm <= 0) {
        this.problem(element, 'invalid-tempo', '"bpm" must be a positive number. Omit it for a tempo instruction without a metronome mark.', measureId);
        return undefined;
      }
    }
    let beat: Duration | undefined;
    if (element.hasAttribute('beat')) {
      beat = this.attempt(element, 'invalid-duration', () => parseDuration(element.getAttribute('beat')!), measureId);
      if (!beat) return undefined;
    }
    let dots: number | undefined;
    if (element.hasAttribute('dots') || element.hasAttribute('dotted')) {
      dots = this.dots(element, measureId);
      if (dots === undefined) return undefined;
    }
    if (!text.trim() && bpm === undefined) {
      this.problem(element, 'empty-annotation', 'A tempo needs a marking, text, or bpm; no metronome value is assumed.', measureId);
      return undefined;
    }
    return { ...result, ...(bpm !== undefined ? { bpm } : {}), ...(beat ? { beat } : {}), ...(dots !== undefined ? { dots } : {}) };
  }

  event(element: Element, context: Context, voice: VoiceDraft, tuplets: readonly TupletDraft[], multiplier: Rational, measureId: string): void {
    this.attributes(element, measureId);
    this.leaf(element, measureId);
    const kind = tagOf(element).replace('music-', '') as MusicEvent['kind'];
    const measureRest = kind === 'rest' && this.boolean(element, 'measure', measureId);
    const duration = this.attempt(element, 'invalid-duration', () => parseDuration(element.getAttribute('duration') ?? (measureRest ? 'whole' : 'quarter')), measureId);
    const dots = this.dots(element, measureId);
    if (!duration || dots === undefined) return;
    const display = this.choice(element, 'accidental-display', ['auto', 'always', 'courtesy'], 'auto', measureId);
    const pitches = this.attempt(element, 'invalid-pitch', () => {
      if (kind === 'note') {
        const value = element.getAttribute('pitch');
        if (value === null || !value.trim()) throw new RangeError('A music-note needs an explicit pitch, such as C4 or F#4.');
        return [parsePitch(value, element.getAttribute('accidental') ?? undefined, display)];
      }
      if (kind === 'chord') {
        const values = element.getAttribute('pitches')?.trim().split(/\s+/).filter(Boolean);
        if (!values?.length) throw new RangeError('A music-chord needs space-separated pitches, such as pitches="C4 E4 G4".');
        return values.map(value => parsePitch(value, undefined, display));
      }
      return [];
    }, measureId);
    if (!pitches) return;
    const beam = this.choice(element, 'beam', ['auto', 'start', 'continue', 'end', 'none'], measureRest ? 'none' : 'auto', measureId);
    const stem = this.choice(element, 'stem', ['auto', 'up', 'down'], 'auto', measureId);
    const tie = this.choice(element, 'tie', ['none', 'start', 'continue', 'end'], 'none', measureId);
    if (measureRest && (duration !== 'whole' || dots !== 0 || tuplets.length || (beam !== 'none' && beam !== 'auto') || tie !== 'none')) {
      this.problem(element, 'invalid-measure-rest', 'A measure rest fills the meter: use music-rest measure without dots, tuplets, beams, ties, or another duration.', measureId);
      return;
    }
    const time = this.attempt(element, 'invalid-time', () => measureRest ? meterTime(context.meter) : multiply(durationTime(duration, dots), multiplier), measureId);
    if (!time) return;
    const next = this.attempt(element, 'invalid-time', () => add(voice.onset, time), measureId);
    if (!next) return;
    const event: MusicEvent = {
      id: this.id(element), kind, pitches, duration, dots, onset: voice.onset, time,
      tupletIds: tuplets.map(tuplet => tuplet.id), beam, stem, tie, measureRest,
      rhythmic: kind === 'slash' && this.boolean(element, 'rhythmic', measureId),
    };
    voice.events.push(event);
    for (const tuplet of tuplets) tuplet.eventIds.push(event.id);
    voice.onset = next;
  }

  sequence(parent: Element, children: readonly Element[], context: Context, voice: VoiceDraft, annotations: Annotation[], measureId: string, tuplets: readonly TupletDraft[] = [], multiplier: Rational = one): void {
    this.containerText(parent, measureId);
    let legacy: TupletDraft | undefined;
    let legacySource: Element | undefined;
    for (const child of children) {
      const tag = tagOf(child);
      const marker = rhythmTags.has(tag) ? child.getAttribute('triplet') : null;
      if (marker !== null && marker !== 'start' && marker !== 'end') this.problem(child, 'invalid-triplet', 'Legacy triplet must be "start" or "end". Prefer a music-tuplet wrapper.', measureId);
      if (marker === 'start') {
        if (legacy) this.problem(child, 'nested-legacy-triplet', 'A legacy triplet starts before the previous one ends. Use nested music-tuplet elements for nested ratios.', measureId);
        else if (tuplets.length >= MAX_TUPLET_DEPTH) this.problem(child, 'tuplet-depth', `Tuplet nesting is limited to ${MAX_TUPLET_DEPTH} levels.`, measureId);
        else {
          legacy = { id: this.id(child, 'triplet'), actual: 3, normal: 2, eventIds: [], bracket: 'auto', showRatio: false };
          legacySource = child;
          voice.tuplets.push(legacy);
        }
      }
      const active = legacy ? [...tuplets, legacy] : tuplets;
      const scale = legacy ? this.attempt(child, 'invalid-time', () => multiply(multiplier, rational(2, 3)), measureId) : multiplier;
      if (!scale) continue;
      if (rhythmTags.has(tag)) this.event(child, context, voice, active, scale, measureId);
      else if (annotationTags.has(tag)) {
        const annotation = this.annotation(child, voice.onset, measureId);
        if (annotation) annotations.push(annotation);
      } else if (tag === 'music-tuplet') {
        this.attributes(child, measureId);
        if (active.length >= MAX_TUPLET_DEPTH) {
          this.problem(child, 'tuplet-depth', `Tuplet nesting is limited to ${MAX_TUPLET_DEPTH} levels.`, measureId);
          continue;
        }
        const actual = this.integer(child, 'actual', 2, 64, undefined, measureId);
        const normal = this.integer(child, 'normal', 1, 64, undefined, measureId);
        if (actual === undefined || normal === undefined) continue;
        const nextScale = this.attempt(child, 'invalid-time', () => multiply(scale, rational(normal, actual)), measureId);
        if (!nextScale) continue;
        const tuplet: TupletDraft = {
          id: this.id(child), actual, normal, eventIds: [],
          bracket: this.choice(child, 'bracket', ['auto', 'yes', 'no'], 'auto', measureId),
          showRatio: this.boolean(child, 'ratio', measureId),
        };
        voice.tuplets.push(tuplet);
        this.sequence(child, [...child.children], context, voice, annotations, measureId, [...active, tuplet], nextScale);
        if (!tuplet.eventIds.length) this.problem(child, 'empty-tuplet', 'A tuplet needs rhythmic events.', measureId);
      } else this.unexpected(child, parent, measureId);
      if (marker === 'end') {
        if (!legacy) this.problem(child, 'unmatched-triplet-end', 'This legacy triplet ends without a matching start in the same container.', measureId);
        legacy = undefined;
        legacySource = undefined;
      }
    }
    if (legacySource) this.problem(legacySource, 'unclosed-triplet', 'This legacy triplet has no end in the same container. Prefer a music-tuplet wrapper.', measureId);
  }

  voice(element: Element, context: Context, annotations: Annotation[], measureId: string, implicit: boolean, children: readonly Element[] = [...element.children]): Voice {
    if (!implicit) this.attributes(element, measureId);
    const voice: VoiceDraft = { id: this.id(element, implicit ? 'voice' : 'element'), events: [], tuplets: [], onset: zero };
    this.sequence(element, children, context, voice, annotations, measureId);
    return { id: voice.id, events: voice.events, tuplets: voice.tuplets };
  }

  measure(element: Element, inherited: Context, defaultNumber: number): { measure: Measure; context: Context } {
    const id = this.id(element);
    this.attributes(element, id);
    let context = this.context(element, inherited, id);
    const children = [...element.children];
    let seenRhythm = false;
    let seenMeter = false;
    for (const child of children) {
      const tag = tagOf(child);
      if (tag !== 'music-meter') {
        if (rhythmTags.has(tag) || tag === 'music-tuplet' || tag === 'music-voice') seenRhythm = true;
        continue;
      }
      const meter = this.meterElement(child, id);
      if (seenRhythm) this.problem(child, 'late-meter', 'A music-meter must precede the rhythm in its measure. Start another measure for a meter change.', id);
      else if (seenMeter || element.hasAttribute('meter') || element.hasAttribute('groups')) this.problem(child, 'conflicting-meter', 'Declare a measure meter and its groups together, using either measure attributes or one music-meter child.', id);
      else if (meter) context = { ...context, meter };
      seenMeter = true;
    }
    const annotations: Annotation[] = [];
    let voices: Voice[];
    if (children.some(child => tagOf(child) === 'music-voice')) {
      this.containerText(element, id);
      voices = [];
      for (const child of children) {
        const tag = tagOf(child);
        if (tag === 'music-voice') voices.push(this.voice(child, context, annotations, id, false));
        else if (annotationTags.has(tag)) {
          const annotation = this.annotation(child, zero, id);
          if (annotation) annotations.push(annotation);
        } else if (rhythmTags.has(tag) || tag === 'music-tuplet') this.problem(child, 'mixed-voices', 'When a measure has music-voice children, put all of its rhythm inside those voices.', id);
        else if (tag !== 'music-meter') this.unexpected(child, element, id);
      }
    } else voices = [this.voice(element, context, annotations, id, true, children.filter(child => tagOf(child) !== 'music-meter'))];
    const measure: Measure = {
      id, number: element.getAttribute('number') ?? String(defaultNumber), ...context, voices, annotations,
      breakBefore: this.choice(element, 'break-before', ['auto', 'line', 'page'], 'auto', id),
      keepWithNext: this.boolean(element, 'keep-with-next', id),
      endBar: this.choice(element, 'end-bar', ['single', 'double', 'final', 'repeat-end', 'none'], 'single', id),
      repeatStart: this.boolean(element, 'repeat-start', id),
      pickup: this.boolean(element, 'pickup', id), incomplete: this.boolean(element, 'incomplete', id),
    };
    return { measure, context };
  }

  staff(element: Element, inherited: Context, standaloneMeasure = false): Staff {
    if (!standaloneMeasure) { this.attributes(element); this.containerText(element); }
    const initial = standaloneMeasure ? inherited : this.context(element, inherited);
    let context = initial;
    const measures: Measure[] = [];
    for (const child of standaloneMeasure ? [element] : [...element.children]) {
      if (tagOf(child) !== 'music-measure') { this.unexpected(child, element); continue; }
      const openingPickup = measures.length ? measures[0].pickup : child.hasAttribute('pickup');
      const result = this.measure(child, context, measures.length + (openingPickup ? 0 : 1));
      measures.push(result.measure);
      context = result.context;
    }
    return {
      id: this.id(element, standaloneMeasure ? 'staff' : 'element'),
      label: standaloneMeasure ? '' : element.getAttribute('label') ?? '',
      clef: initial.clef, key: initial.key, measures,
    };
  }

  score(root: Element): Score {
    const defaults: Context = { meter: parseMeter(), clef: 'treble', key: 'C' };
    const tag = tagOf(root);
    const label = root.getAttribute('label') ?? root.getAttribute('aria-label') ?? '';
    if (tag === 'music-staff' || tag === 'music-measure') {
      return { id: this.id(root, 'score'), label, bracket: 'none', staves: [this.staff(root, defaults, tag === 'music-measure')] };
    }
    this.attributes(root);
    this.containerText(root);
    const id = this.id(root);
    if (tag !== 'music-system') {
      this.problem(root, 'invalid-root', 'readScore expects a music-system, music-staff, or music-measure element.');
      return { id, label, bracket: 'none', staves: [] };
    }
    const context = this.context(root, defaults);
    const staves: Staff[] = [];
    for (const child of root.children) {
      if (tagOf(child) === 'music-staff') staves.push(this.staff(child, context));
      else this.unexpected(child, root);
    }
    return { id, label, bracket: this.choice(root, 'bracket', ['none', 'brace', 'bracket'], 'none'), staves };
  }
}

/** Read light DOM only. Invalid input produces diagnostics, never rewritten source markup. */
export function readScore(root: Element): ReadScoreResult {
  const reader = new Reader(root);
  const score = reader.score(root);
  const validation = reader.attempt(root, 'invalid-score', () => validateScore(score));
  if (validation) reader.diagnostics.push(...validation);
  return { score, diagnostics: reader.diagnostics, sources: reader.sources };
}
