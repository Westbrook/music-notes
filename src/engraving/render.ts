import VexFlow, {
  Accidental, Barline, Beam, Dot, Element as EngravingElement, Formatter, Fraction,
  Renderer, Stave, StaveConnector, StaveModifier, StaveNote, StaveTie, Stem,
  SVGContext, Tuplet as EngravedTuplet, Voice as EngravedVoice,
} from 'vexflow/bravura';
import { add, compare, durationTime, equals, formatRational, rational, subtract, toNumber } from '../model/index.js';
import type { Annotation, Clef, Diagnostic, Duration, Measure, MusicEvent, Rational, Score } from '../model/types.js';
import { planSystems } from './layout.js';
import type { SystemLayout } from './layout.js';
import { canShareRest, groupBeams, resolveAccidentals } from './semantics.js';
import { moveInk, overlapsInkX, unionInk, visibleInk } from './geometry.js';
import type { InkBox } from './geometry.js';

const DURATION: Record<Duration, string> = {
  breve: '1/2', whole: 'w', half: 'h', quarter: 'q', eighth: '8',
  sixteenth: '16', 'thirty-second': '32', 'sixty-fourth': '64', '128th': '128',
};
const SLASH_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4', tenor: 'a/3' };
const BARLINE = {
  single: VexFlow.BarlineType.SINGLE, double: VexFlow.BarlineType.DOUBLE,
  final: VexFlow.BarlineType.END, 'repeat-end': VexFlow.BarlineType.REPEAT_END, none: VexFlow.BarlineType.NONE,
} as const;
const ANNOTATION_GAP = 8;
const STAFF_GAP = 24;
const INCOMING_TIE_SPACE = 20;
const RIGHT_MARGIN = 20;
const Glyphs = VexFlow.Glyphs;
const REST_GLYPH: Record<Duration, string> = {
  breve: Glyphs.restDoubleWhole, whole: Glyphs.restWhole, half: Glyphs.restHalf,
  quarter: Glyphs.restQuarter, eighth: Glyphs.rest8th, sixteenth: Glyphs.rest16th,
  'thirty-second': Glyphs.rest32nd, 'sixty-fourth': Glyphs.rest64th, '128th': Glyphs.rest128th,
};

export interface EngravingOptions {
  readonly width: number;
  readonly maxMeasures?: number;
  readonly justifyLast?: boolean;
  readonly measureNumbers?: 'all' | 'system' | 'none';
}

/** Coordinates are in the named system's SVG viewBox, independent of the source DOM. */
export interface HitRegion {
  readonly sourceId: string;
  readonly system: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly onset: Rational;
}

export interface EngravingResult {
  readonly systems: readonly SystemLayout[];
  readonly hitRegions: readonly HitRegion[];
  readonly diagnostics: readonly Diagnostic[];
}

interface TextPart { text: string; family: string; size: number; weight?: string; style?: string }
interface MeasuredAnnotation { annotation: Annotation; parts: TextPart[]; width: number; ink: InkBox }
interface PlacedAnnotation extends MeasuredAnnotation { x: number; y: number }
interface PreparedStaff {
  measure: Measure;
  stave: ContextStave;
  voices: EngravedVoice[];
  notes: Map<string, StaveNote>;
  events: Map<string, MusicEvent>;
  beams: Beam[];
  tuplets: { id: string; tuplet: EngravedTuplet; location: number; ancestors: readonly string[] }[];
}
interface PreparedColumn {
  staves: PreparedStaff[];
  formatter: Formatter;
  voices: EngravedVoice[];
  tail: number;
}
interface DrawnNote { event: MusicEvent; note: StaveNote; group: SVGGElement; staffGroup: SVGGElement; context: SVGContext; system: number }
interface DrawnSystem {
  context: SVGContext;
  renderer: Renderer;
  wrapper: HTMLDivElement;
  columns: PreparedColumn[];
  staffGroups: SVGGElement[];
  width: number;
}

/** Set the clef context without adding a redundant printed clef at key changes. */
class ContextStave extends Stave {
  private incomingTieStart?: number;

  constructor(x: number, width: number, clef: Clef) {
    super(x, 0, width);
    this.clef = clef;
  }

  reserveIncomingTieSpace(): void {
    this.incomingTieStart = this.getNoteStartX();
    this.setNoteStartX(this.incomingTieStart + INCOMING_TIE_SPACE);
  }

  override getTieStartX(): number {
    return this.incomingTieStart ?? super.getTieStartX();
  }
}

function startsWithTie(measure: Measure): boolean {
  return measure.voices.some(voice => voice.events[0]?.tie === 'end' || voice.events[0]?.tie === 'continue');
}

function alignHeaders(staves: ContextStave[], incomingTie: boolean): void {
  Stave.formatBegModifiers(staves);
  if (incomingTie) staves.forEach(stave => stave.reserveIncomingTieSpace());
}

let fontPromise: Promise<void> | undefined;

/** Bravura/Academico are embedded in the pinned package; no runtime CDN requests. */
export function engravingReady(): Promise<void> {
  fontPromise ??= (async () => {
    if (!document.fonts) throw new Error('This browser does not support loading notation fonts.');
    await Promise.all([
      document.fonts.load('40px Bravura'),
      document.fonts.load('16px Academico'),
      document.fonts.load('bold 16px Academico'),
    ]);
    if (!document.fonts.check('40px Bravura')) throw new Error('The bundled Bravura notation font could not be loaded.');
  })().catch((error: unknown) => {
    fontPromise = undefined;
    throw error;
  });
  return fontPromise;
}

function textElement(part: TextPart): EngravingElement {
  return new EngravingElement()
    .setFont(part.family, `${part.size}px`, part.weight ?? 'normal', part.style ?? 'normal')
    .setText(part.text);
}

function textWidth(text: string, size = 13): number {
  return textElement({ text, family: 'Academico', size }).getWidth();
}

function measureAnnotation(annotation: Annotation): MeasuredAnnotation {
  const parts: TextPart[] = [];
  if (annotation.kind === 'dynamics' && /^[pfmsrz]+$/.test(annotation.text)) {
    const glyphs: Record<string, string> = {
      p: Glyphs.dynamicPiano, f: Glyphs.dynamicForte, m: Glyphs.dynamicMezzo,
      s: Glyphs.dynamicSforzando, z: Glyphs.dynamicZ, r: Glyphs.dynamicRinforzando,
    };
    parts.push({ text: [...annotation.text].map((letter) => glyphs[letter] ?? letter).join(''), family: 'Bravura', size: 26 });
  } else {
    const isHarmony = annotation.kind === 'harmony';
    parts.push({ text: annotation.text, family: 'Academico', size: isHarmony ? 15 : 13,
      weight: isHarmony || annotation.kind === 'rehearsal' ? 'bold' : 'normal',
      style: annotation.kind === 'direction' || annotation.kind === 'dynamics' ? 'italic' : 'normal' });
    if (annotation.kind === 'tempo' && annotation.bpm !== undefined) {
      const glyphs: Record<Duration, string> = {
        breve: Glyphs.metNoteDoubleWhole, whole: Glyphs.metNoteWhole, half: Glyphs.metNoteHalfUp,
        quarter: Glyphs.metNoteQuarterUp, eighth: Glyphs.metNote8thUp, sixteenth: Glyphs.metNote16thUp,
        'thirty-second': Glyphs.metNote32ndUp, 'sixty-fourth': Glyphs.metNote64thUp, '128th': Glyphs.metNote128thUp,
      };
      parts.push({ text: ` ${glyphs[annotation.beat ?? 'quarter']}${Glyphs.metAugmentationDot.repeat(annotation.dots ?? 0)}`, family: 'Bravura', size: 27 });
      parts.push({ text: ` = ${annotation.bpm}`, family: 'Academico', size: 13 });
    }
  }
  let advance = 0;
  const boxes = parts.map((part) => {
    const element = textElement(part);
    const metrics = element.getTextMetrics();
    const box = { x: advance - metrics.actualBoundingBoxLeft, y: -metrics.actualBoundingBoxAscent,
      width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
    advance += element.getWidth() + 4;
    return box;
  });
  const width = advance + 4;
  if (annotation.kind === 'rehearsal') boxes.push({ x: -4.5, y: -15.5, width: width + 3, height: 21 });
  return { annotation, parts, width, ink: unionInk(boxes)! };
}

function createStave(measure: Measure, previous: Measure | undefined, x: number, width: number, firstInLine: boolean): ContextStave {
  const stave = new ContextStave(x, width, measure.clef);
  const changedKey = previous !== undefined && previous.key !== measure.key;
  const changedClef = previous !== undefined && previous.clef !== measure.clef;
  if (firstInLine || changedClef) stave.addClef(measure.clef);
  if (firstInLine || changedKey) stave.addKeySignature(measure.key, changedKey ? previous?.key : undefined);
  if (!previous || previous.meter.display !== measure.meter.display) stave.addTimeSignature(measure.meter.display);
  stave.setBegBarType(measure.repeatStart ? VexFlow.BarlineType.REPEAT_BEGIN : firstInLine ? VexFlow.BarlineType.SINGLE : VexFlow.BarlineType.NONE);
  stave.setEndBarType(BARLINE[measure.endBar]);
  return stave;
}

function createNote(event: MusicEvent, measure: Measure, voiceIndex: number): StaveNote {
  const silentRhythm = event.kind === 'slash' && !event.rhythmic;
  const duration = event.measureRest ? 'w' : silentRhythm ? 'q' : DURATION[event.duration];
  const keys = event.kind === 'rest' ? ['r/4'] : event.kind === 'slash' ? [SLASH_KEY[measure.clef]]
    : event.pitches.map((pitch) => `${pitch.step.toLowerCase()}${pitch.alter > 0 ? '#'.repeat(pitch.alter) : 'b'.repeat(-pitch.alter)}/${pitch.octave}`);
  const direction = event.stem === 'up' ? Stem.UP : event.stem === 'down' ? Stem.DOWN
    : measure.voices.length > 1 ? voiceIndex % 2 === 0 ? Stem.UP : Stem.DOWN : undefined;
  const note = new StaveNote({
    clef: measure.clef, keys, duration,
    dots: silentRhythm || event.measureRest ? 0 : event.dots,
    type: event.kind === 'rest' ? 'r' : event.kind === 'slash' ? 's' : 'n',
    autoStem: direction === undefined,
    stemDirection: direction,
    alignCenter: event.measureRest,
    ...(event.measureRest || silentRhythm ? { durationOverride: new Fraction(
      event.measureRest ? event.time.numerator : durationTime(event.duration, event.dots).numerator,
      event.measureRest ? event.time.denominator : durationTime(event.duration, event.dots).denominator,
    ) } : {}),
  });
  if (silentRhythm) note.getStem()?.setVisibility(false);
  if (!silentRhythm && !event.measureRest) {
    for (let dot = 0; dot < event.dots; dot++) Dot.buildAndAttach([note], { all: true });
  }
  return note;
}

function coalesceAccidentals(measure: Measure) {
  const requests = resolveAccidentals(measure);
  const owners = new Map<string, { eventId: string; index: number; courtesy: boolean }>();
  const events = measure.voices.flatMap((voice) => voice.events);
  const key = (event: MusicEvent, index: number) => {
    const pitch = event.pitches[index];
    return `${formatRational(event.onset)}:${pitch.step}:${pitch.octave}:${pitch.alter}`;
  };
  for (const event of events) for (const request of requests.get(event.id) ?? []) {
    const previous = owners.get(key(event, request.index));
    if (!previous || (previous.courtesy && !request.courtesy)) {
      owners.set(key(event, request.index), { eventId: event.id, ...request });
    }
  }
  // Two voices on the same altered pitch share a printed sign. Different
  // alterations remain distinct; an operative sign takes priority over courtesy.
  return new Map(events.map((event) => [event.id, (requests.get(event.id) ?? []).filter((request) => {
    const owner = owners.get(key(event, request.index));
    return owner?.eventId === event.id && owner.index === request.index;
  })]));
}

function prepareStaff(measure: Measure, previous: Measure | undefined, x: number, width: number, firstInLine: boolean): PreparedStaff {
  const stave = createStave(measure, previous, x, width, firstInLine);
  const notes = new Map<string, StaveNote>();
  const events = new Map<string, MusicEvent>();
  const beams: Beam[] = [];
  const tuplets: PreparedStaff['tuplets'] = [];
  const accidentals = coalesceAccidentals(measure);
  const voices = measure.voices.map((voice, voiceIndex) => {
    const restLines = new Map<StaveNote, number>();
    const voiceNotes = voice.events.map((event) => {
      const note = createNote(event, measure, voiceIndex).setStave(stave);
      if (event.kind === 'rest') restLines.set(note, note.getKeyLine(0));
      for (const accidental of accidentals.get(event.id) ?? []) {
        const modifier = new Accidental(accidental.type);
        if (accidental.courtesy) modifier.setAsCautionary();
        note.addModifier(modifier, accidental.index);
      }
      notes.set(event.id, note);
      events.set(event.id, event);
      return note;
    });
    // Attach every structural tuplet before adding tickables to a voice. VexFlow
    // composes their exact ratios, rather than treating a tuplet as decoration.
    for (const group of voice.tuplets) {
      const members = group.eventIds.map((id) => notes.get(id)!);
      const location = measure.voices.length > 1 && voiceIndex % 2 === 1 ? -1 : 1;
      const memberEvents = group.eventIds.map((id) => events.get(id)!);
      const ownDepth = memberEvents[0].tupletIds.indexOf(group.id);
      const minDepth = Math.min(...memberEvents.map((event) => event.tupletIds.length));
      const tuplet = new EngravedTuplet(members, {
        numNotes: group.actual, notesOccupied: group.normal,
        ratioed: group.showRatio || Math.abs(group.actual - group.normal) > 1,
        bracketed: true,
        location,
        yOffset: -location * EngravedTuplet.NESTING_OFFSET * Math.max(0, minDepth - ownDepth - 1),
      });
      tuplets.push({ id: group.id, tuplet, location, ancestors: memberEvents[0].tupletIds.slice(0, ownDepth) });
    }
    for (const ids of groupBeams(voice, measure.meter)) {
      const members = ids.map((id) => notes.get(id)!);
      const requestedStem = ids.map((id) => events.get(id)!.stem).find((stem) => stem !== 'auto');
      if (requestedStem) members.forEach((note) => note.setStemDirection(requestedStem === 'up' ? Stem.UP : Stem.DOWN));
      const autoStem = measure.voices.length === 1 && ids.every((id) => events.get(id)?.stem === 'auto');
      beams.push(new Beam(members, autoStem));
    }
    for (const group of voice.tuplets) {
      const item = tuplets.find((entry) => entry.id === group.id)!;
      const members = group.eventIds.map((id) => notes.get(id)!);
      const beam = members[0]?.getBeam();
      const oneCompleteBeam = beam !== undefined && members.every((note) => note.getBeam() === beam)
        && beam.getNotes().length === members.length;
      item.tuplet.setBracketed(group.bracket === 'yes' || (group.bracket === 'auto' && !oneCompleteBeam));
    }
    // Tuplet construction may move rests toward nearby pitches. Ordinary
    // single-voice, unbeamed rests retain their conventional staff positions;
    // beamed and polyphonic rests still participate in the engine's collision work.
    if (measure.voices.length === 1) for (const [note, line] of restLines) {
      if (!note.getBeam()) note.setKeyLine(0, line);
    }
    // This assertion protects the boundary between the semantic model and engine.
    voice.events.forEach((event, index) => {
      const ticks = voiceNotes[index].getTicks();
      const engineTime = rational(ticks.numerator, ticks.denominator * VexFlow.RESOLUTION);
      if (!equals(event.time, engineTime)) throw new Error(`Engraving duration disagrees with event ${event.id}.`);
    });
    return new EngravedVoice({ numBeats: measure.meter.numerator, beatValue: measure.meter.denominator })
      .setMode(EngravedVoice.Mode.SOFT).setStave(stave).addTickables(voiceNotes);
  });
  return { measure, stave, voices, notes, events, beams, tuplets };
}

function prepareColumn(score: Score, index: number, x: number, width: number, firstInLine: boolean): PreparedColumn {
  const staves = score.staves.map((staff) => prepareStaff(staff.measures[index], staff.measures[index - 1], x, width, firstInLine));
  alignHeaders(staves.map(staff => staff.stave), firstInLine && staves.some(staff => startsWithTie(staff.measure)));
  const formatter = new Formatter();
  staves.forEach((staff) => { if (staff.voices.length) formatter.joinVoices(staff.voices); });
  const voices = staves.flatMap((staff) => staff.voices);
  // Non-initial directions get real trailing space, so text at the final attack
  // cannot be lost beyond the bar/system edge. Initial directions affect minima.
  const tail = Math.max(14, ...staves.flatMap((staff) => staff.measure.annotations
    .filter((annotation) => annotation.onset.numerator > 0).map((annotation) => measureAnnotation(annotation).width + 12)));
  return { staves, formatter, voices, tail };
}

function rhythmicWeight(staves: readonly PreparedStaff[]): number {
  const measure = staves[0].measure;
  const events = staves.flatMap((staff) => staff.measure.voices.flatMap((voice) => voice.events));
  const ends = events.map((event) => add(event.onset, event.time));
  const end = measure.pickup ? ends.reduce((latest, value) => compare(value, latest) > 0 ? value : latest, rational(0))
    : rational(measure.meter.numerator, measure.meter.denominator);
  const grid = new Map([rational(0), ...events.map((event) => event.onset), ...ends, end]
    .filter((time) => compare(time, end) <= 0).map((time) => [formatRational(time), time]));
  const onsets = [...grid.values()].sort(compare);
  // Headers have fixed width. Only musical intervals attract surplus space;
  // a short pickup must not stretch merely because it also carries a clef.
  return onsets.slice(1).reduce((sum, time, index) => sum + Math.sqrt(toNumber(subtract(time, onsets[index]))), 0) || 1;
}

function columnSizes(score: Score) {
  return score.staves[0].measures.map((_, index) => {
    const column = prepareColumn(score, index, 0, 2000, false);
    const prefix = Math.max(...column.staves.map((staff) => staff.stave.getNoteStartX()));
    const firstStaves = score.staves.map((staff) => createStave(
      staff.measures[index], staff.measures[index - 1], 0, 2000, true,
    ));
    alignHeaders(firstStaves, score.staves.some(staff => startsWithTie(staff.measures[index])));
    const firstPrefix = Math.max(...firstStaves.map(stave => stave.getNoteStartX()));
    const musicWidth = column.voices.some((voice) => voice.getTickables().length)
      ? column.formatter.preCalculateMinTotalWidth(column.voices) : 40;
    const initialText = Math.max(0, ...column.staves.flatMap((staff) => staff.measure.annotations
      .filter((annotation) => annotation.onset.numerator === 0).map((annotation) => measureAnnotation(annotation).width)));
    const minimum = Math.ceil(prefix + Math.max(musicWidth + column.tail, initialText + 12) + 28);
    const measures = column.staves.map((staff) => staff.measure);
    const first = measures[0];
    const lastEvent = first.voices[0]?.events.at(-1);
    // An opening upbeat belongs with its following bar when they fit. Derive
    // this preference without adding an authored keep hint to the score. Later
    // short bars do not imply a new phrase; explicit breaks and limits still win.
    const openingPickup = index === 0 && score.staves[0].measures.length > 1
      && measures.every(measure => measure.pickup) && lastEvent !== undefined
      && compare(add(lastEvent.onset, lastEvent.time), rational(first.meter.numerator, first.meter.denominator)) < 0;
    return {
      minimum, preferred: minimum + Math.max(24, musicWidth * 0.22),
      startExtra: Math.max(0, firstPrefix - prefix),
      stretchWeight: rhythmicWeight(column.staves),
      breakBefore: measures.some((measure) => measure.breakBefore === 'page') ? 'page' as const
        : measures.some((measure) => measure.breakBefore === 'line') ? 'line' as const : 'auto' as const,
      keepWithNext: openingPickup || measures.some((measure) => measure.keepWithNext),
    };
  });
}

function annotationX(annotation: Annotation, column: PreparedColumn): number {
  const all = column.staves.flatMap((staff) => [...staff.events.values()].map((event) => ({
    onset: event.onset, x: staff.notes.get(event.id)!.getAbsoluteX(),
  }))).sort((a, b) => compare(a.onset, b.onset));
  const exact = all.find((entry) => equals(entry.onset, annotation.onset));
  if (exact) return exact.x;
  const stave = column.staves[0].stave;
  const duration = toNumber(column.staves[0].measure.meter.numerator === 0 ? rational(1) : rational(
    column.staves[0].measure.meter.numerator, column.staves[0].measure.meter.denominator));
  let left = { onset: rational(0), x: stave.getNoteStartX() + 10 };
  let right = { onset: rational(column.staves[0].measure.meter.numerator, column.staves[0].measure.meter.denominator), x: stave.getNoteEndX() - column.tail };
  for (const entry of all) {
    if (compare(entry.onset, annotation.onset) < 0) left = entry;
    if (compare(entry.onset, annotation.onset) > 0) { right = entry; break; }
  }
  const range = toNumber(right.onset) - toNumber(left.onset);
  const position = range > 0 ? (toNumber(annotation.onset) - toNumber(left.onset)) / range : toNumber(annotation.onset) / duration;
  return left.x + Math.max(0, Math.min(1, position)) * (right.x - left.x);
}

function placeAnnotations(columns: PreparedColumn[], staffIndex: number, musicInk: readonly InkBox[]): PlacedAnnotation[] {
  const measured = columns.flatMap((column) => column.staves[staffIndex].measure.annotations.map((annotation) => ({
    ...measureAnnotation(annotation), x: annotationX(annotation, column), y: 0,
  })));
  for (const placement of ['above', 'below'] as const) {
    const obstacles = [...musicInk];
    // Priority controls collisions, not an unconditional extra row per kind.
    // A harmony lane has a common baseline, but only notation under its actual
    // horizontal spans can lift it. Directions and navigation grow outward.
    for (const kind of ['harmony', 'dynamics', 'direction', 'tempo', 'rehearsal'] as const) {
      const lanes: PlacedAnnotation[][] = [];
      const group = measured.filter((item) => item.annotation.placement === placement && item.annotation.kind === kind)
        .sort((a, b) => a.x - b.x);
      for (const item of group) {
        const lane = lanes.find(items => items.every(other => !overlapsInkX(
          moveInk(item.ink, item.x, 0), moveInk(other.ink, other.x, 0), ANNOTATION_GAP,
        )));
        if (lane) lane.push(item);
        else lanes.push([item]);
      }
      for (const lane of lanes) {
        const above = placement === 'above';
        const positions = lane.map((item) => {
          const inset = above ? item.ink.y + item.ink.height : item.ink.y;
          const relevant = obstacles.filter(box => overlapsInkX(moveInk(item.ink, item.x, 0), box));
          const edges = relevant.map(box => above ? box.y : box.y + box.height);
          return above ? Math.min(40, ...edges) - ANNOTATION_GAP - inset
            : Math.max(80, ...edges) + ANNOTATION_GAP - inset;
        });
        const y = above ? Math.min(...positions) : Math.max(...positions);
        for (const item of lane) {
          item.y = y;
          obstacles.push(moveInk(item.ink, item.x, y));
        }
      }
    }
  }
  return measured;
}

function drawAnnotation(item: PlacedAnnotation, context: SVGContext): SVGGElement {
  const group = context.openGroup('music-annotation');
  group.dataset.sourceId = item.annotation.id;
  group.dataset.kind = item.annotation.kind;
  group.dataset.onset = formatRational(item.annotation.onset);
  let x = item.x;
  // SVGContext.rect emits its own stroke. Calling stroke() here would draw the
  // previous retained path again inside this annotation (often a staff line).
  if (item.annotation.kind === 'rehearsal') context.setLineWidth(1).rect(x - 4, item.y - 15, item.width + 2, 20);
  for (const part of item.parts) {
    const element = textElement(part);
    element.renderText(context, x, item.y);
    x += element.getWidth() + 4;
  }
  context.closeGroup();
  return group;
}

function drawTuplets(staff: PreparedStaff, context: SVGContext, staffGroup: SVGGElement): void {
  const groups = new Map<string, SVGGElement>();
  for (const { id, tuplet } of staff.tuplets) {
    const group = context.openGroup('music-tuplet');
    group.dataset.sourceId = id;
    tuplet.setContext(context).draw();
    context.closeGroup();
    staffGroup.append(group);
    groups.set(id, group);
  }
  // VexFlow's fixed 15px nesting offset is no taller than some tuplet numbers.
  // Move each outer bracket and number together, after its inner groups have
  // settled, using only their overlapping painted spans and a 6px clearance.
  for (const outer of [...staff.tuplets].sort((a, b) => b.ancestors.length - a.ancestors.length)) {
    const children = staff.tuplets.filter(item => item.ancestors.includes(outer.id));
    if (!children.length) continue;
    const group = groups.get(outer.id)!;
    const boxes = visibleInk(group, staffGroup);
    const inner = children.flatMap(item => visibleInk(groups.get(item.id)!, staffGroup));
    let shift = 0;
    for (const box of boxes) for (const child of inner) {
      if (!overlapsInkX(box, child)) continue;
      shift = outer.location > 0 ? Math.min(shift, child.y - 6 - box.y - box.height)
        : Math.max(shift, child.y + child.height + 6 - box.y);
    }
    if (shift !== 0) group.setAttribute('transform', `translate(0 ${shift})`);
  }
}

/** Move a rest by whole staff spaces, retaining its tick context and modifiers. */
function redrawRest(drawn: DrawnNote, line: number): InkBox {
  const { note, event, context, group, staffGroup } = drawn;
  const duration = event.measureRest ? 'whole' : event.duration;
  const outside = line < 1 || line > note.checkStave().getNumLines();
  let glyph = REST_GLYPH[duration];
  if (outside) {
    if (duration === 'whole') glyph = Glyphs.restWholeLegerLine;
    else if (duration === 'half') glyph = Glyphs.restHalfLegerLine;
    else if (duration === 'breve') glyph = Glyphs.restDoubleWholeLegerLine;
  }
  note.setKeyLine(0, line);
  // Choose the glyph explicitly after rebuilding the head. Only rectangular
  // rests require a supporting ledger line; displaced shorter rests do not.
  note.noteHeads[0].setText(glyph);
  note.preFormat();
  const ink = context.openGroup('rest-ink');
  note.setContext(context).draw();
  context.closeGroup();
  // Keep the drawing group's inherited font attributes when reparenting it.
  group.replaceChildren(ink);
  group.dataset.restLine = String(line);
  return unionInk(visibleInk(group, staffGroup))!;
}

/**
 * VexFlow sometimes hides unequal rests because only their base duration was
 * compared. Repair those onsets locally; never rerun its shared modifier pass.
 * Exact equivalent rests retain one printed owner and separate source identities.
 */
function recoverHiddenRests(staff: PreparedStaff, staffGroup: SVGGElement, drawnNotes: Map<string, DrawnNote>): boolean {
  const rests = staff.measure.voices.flatMap((voice, voiceIndex) => voice.events
    .filter(event => event.kind === 'rest').map(event => ({ event, voiceIndex, drawn: drawnNotes.get(event.id)! })));
  const unsafeOnsets = new Set(rests.filter(({ event, drawn }) => drawn.note.renderOptions.draw === false
    && !rests.some(peer => peer.event.id !== event.id && peer.drawn.note.renderOptions.draw !== false
      && canShareRest(event, peer.event))).map(({ event }) => formatRational(event.onset)));
  if (!unsafeOnsets.size) return false;

  const affected = rests.filter(({ event }) => unsafeOnsets.has(formatRational(event.onset)));
  const affectedIds = new Set(affected.map(({ event }) => event.id));
  const partitions: (typeof affected)[] = [];
  for (const rest of affected) {
    const partition = partitions.find(items => canShareRest(items[0].event, rest.event));
    if (partition) partition.push(rest);
    else partitions.push([rest]);
  }
  const owners = partitions.map((items) => {
    const owner = items.find(item => item.drawn.note.renderOptions.draw !== false) ?? items[0];
    for (const item of items) {
      item.drawn.note.renderOptions.draw = item === owner;
      item.drawn.group.replaceChildren();
    }
    return owner;
  }).sort((a, b) => compare(a.event.onset, b.event.onset) || a.voiceIndex - b.voiceIndex);

  // Ignore staff lines and the old tuplet brackets. Pitched notes, accidentals,
  // dots, beams and ties have now been drawn and provide real collision bounds.
  const obstacles = [...staffGroup.querySelectorAll<SVGGElement>('g.vf-music-event, g.vf-music-beams, g.vf-music-tie')]
    .filter(group => !affectedIds.has(group.dataset.sourceId ?? ''))
    .flatMap(group => visibleInk(group, staffGroup));
  const gap = 6;
  const spacing = staff.stave.getSpacingBetweenLines();
  for (const { drawn } of owners) {
    const direction = drawn.note.getStemDirection();
    let line = direction === Stem.UP ? 4 : 2;
    let ink = redrawRest(drawn, line);
    // Each move passes at least one obstructing vertical interval. Integer
    // staff-line positions preserve the relation of half/whole rests to a line.
    for (let attempt = 0; attempt <= obstacles.length + 1; attempt++) {
      const collisions = obstacles.filter(box => overlapsInkX(ink, box)
        && ink.y < box.y + box.height + gap && box.y < ink.y + ink.height + gap);
      if (!collisions.length) break;
      const distance = direction === Stem.UP
        ? Math.max(...collisions.map(box => ink.y + ink.height + gap - box.y))
        : Math.max(...collisions.map(box => box.y + box.height + gap - ink.y));
      line += direction * Math.max(1, Math.ceil(distance / spacing));
      ink = redrawRest(drawn, line);
    }
    drawn.group.dataset.restRecovery = 'true';
    obstacles.push(...visibleInk(drawn.group, staffGroup));
  }
  return true;
}

function drawTies(score: Score, notes: Map<string, DrawnNote>): void {
  const draw = (owner: DrawnNote, tie: StaveTie, first: DrawnNote, last: DrawnNote, boundary: string) => {
    const group = owner.context.openGroup('music-tie');
    group.dataset.startSourceId = first.event.id;
    group.dataset.endSourceId = last.event.id;
    group.dataset.boundary = boundary;
    if (boundary === 'incoming') group.dataset.headerEndX = String(owner.note.checkStave().getTieStartX());
    tie.setContext(owner.context).draw();
    owner.context.closeGroup();
    owner.staffGroup.append(group);
  };
  for (const staff of score.staves) {
    const pending = new Map<number, DrawnNote>();
    for (const measure of staff.measures) measure.voices.forEach((voice, voiceIndex) => {
      for (const event of voice.events) {
        const current = notes.get(event.id)!;
        if (event.tie === 'end' || event.tie === 'continue') {
          const first = pending.get(voiceIndex);
          if (first) {
            const indexes = first.event.pitches.map((_, index) => index);
            const lastIndexes = first.event.pitches.map((pitch) => event.pitches.findIndex((candidate) =>
              candidate.step === pitch.step && candidate.octave === pitch.octave && candidate.alter === pitch.alter));
            if (first.system === current.system) {
              draw(current, new StaveTie({ firstNote: first.note, lastNote: current.note, firstIndexes: indexes, lastIndexes }), first, current, 'within');
            } else {
              draw(first, new StaveTie({ firstNote: first.note, firstIndexes: indexes, lastIndexes: indexes }), first, current, 'outgoing');
              draw(current, new StaveTie({ lastNote: current.note, firstIndexes: lastIndexes, lastIndexes }), first, current, 'incoming');
            }
          }
          pending.delete(voiceIndex);
        }
        if (event.tie === 'start' || event.tie === 'continue') pending.set(voiceIndex, current);
      }
    });
  }
}

/** Fill only the gaps between staves; do not overpaint their own barline strokes. */
function drawConnectors(system: DrawnSystem, score: Score, diagnostics: Diagnostic[]): void {
  if (score.staves.length < 2) return;
  const { context } = system;
  system.columns.forEach((column, offset) => {
    const staves = column.staves.map(staff => staff.stave);
    const first = staves[0];
    const last = staves[staves.length - 1];
    const join = (boundary: string, barline: string, strokes: readonly { x: number; width: number }[]) => {
      const group = context.openGroup('music-connector');
      group.dataset.measureId = column.staves[0].measure.id;
      group.dataset.boundary = boundary;
      group.dataset.barline = barline;
      for (let index = 1; index < staves.length; index++) {
        const y = staves[index - 1].getBottomLineBottomY();
        const height = staves[index].getTopLineTopY() - y;
        for (const stroke of strokes) context.fillRect(stroke.x, y, stroke.width, height);
      }
      context.closeGroup();
    };
    if (offset === 0) {
      join('system', 'single', [{ x: first.getX(), width: 1 }]);
      if (score.bracket !== 'none') new StaveConnector(first, last).setType(score.bracket).setContext(context).draw();
    }
    if (score.bracket === 'none') return;
    const measure = column.staves[0].measure;
    if (column.staves.some(staff => staff.measure.endBar !== measure.endBar)) {
      diagnostics.push({ severity: 'warning', code: 'unjoined-barlines', sourceId: measure.id,
        message: `Measure ${measure.number} has different ending barlines across staves; these barlines remain separate.` });
    } else if (measure.endBar !== 'none') {
      const x = first.getX() + first.getWidth();
      const strokes = measure.endBar === 'final' || measure.endBar === 'repeat-end'
        ? [{ x: x - 5, width: 1 }, { x: x - 2, width: 3 }]
        : measure.endBar === 'double' ? [{ x: x - 3, width: 1 }, { x, width: 1 }] : [{ x, width: 1 }];
      join('end', measure.endBar, strokes);
    }
    if (column.staves.some(staff => staff.measure.repeatStart !== measure.repeatStart)) {
      diagnostics.push({ severity: 'warning', code: 'unjoined-barlines', sourceId: measure.id,
        message: `Measure ${measure.number} has different repeat starts across staves; these repeat barlines remain separate.` });
    } else if (measure.repeatStart) {
      const repeat = first.getModifiers(StaveModifier.Position.BEGIN, Barline.CATEGORY)
        .find((modifier): modifier is Barline => modifier instanceof Barline && modifier.getType() === VexFlow.BarlineType.REPEAT_BEGIN);
      if (repeat) join('repeat-start', 'repeat-start', [{ x: repeat.getX() - 2, width: 3 }, { x: repeat.getX() + 3, width: 1 }]);
    }
  });
}

/** Engrave a validated score. All staves share one formatter per measure column. */
export function renderScore(container: HTMLElement, score: Score, options: EngravingOptions): EngravingResult {
  const diagnostics: Diagnostic[] = [];
  const hitRegions: HitRegion[] = [];
  container.replaceChildren();
  if (!score.staves.length || !score.staves[0].measures.length) return { systems: [], hitRegions, diagnostics };
  const labelsWidth = Math.max(0, ...score.staves.map((staff) => staff.label ? textWidth(staff.label) + 14 : 0));
  const left = 12 + labelsWidth + (score.bracket === 'none' ? 0 : 20);
  const viewportWidth = Number.isFinite(options.width) ? Math.max(1, Math.floor(options.width)) : 1;
  const systems = planSystems(columnSizes(score), Math.max(1, viewportWidth - left - RIGHT_MARGIN), {
    maxMeasures: options.maxMeasures, justifyLast: options.justifyLast, maxStretch: 1.5,
  });
  const drawnNotes = new Map<string, DrawnNote>();
  const drawnSystems: DrawnSystem[] = [];
  systems.forEach((system, systemIndex) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'system-row';
    wrapper.dataset.startMeasure = String(system.start);
    wrapper.dataset.endMeasure = String(system.end);
    if (system.pageBreak) wrapper.classList.add('page-break');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', `Measures ${score.staves[0].measures[system.start].number} to ${score.staves[0].measures[system.end - 1].number}`);
    container.append(wrapper);
    const renderer = new Renderer(wrapper, Renderer.Backends.SVG);
    const context = renderer.getContext() as SVGContext;
    context.setFillStyle('#111').setStrokeStyle('#111');
    renderer.resize(system.width + left + RIGHT_MARGIN, 300 * score.staves.length);
    context.svg.setAttribute('aria-hidden', 'true');
    context.svg.setAttribute('focusable', 'false');
    context.svg.classList.add('notation-svg');
    let x = left;
    const columns: PreparedColumn[] = [];
    system.widths.forEach((width, offset) => {
      const column = prepareColumn(score, system.start + offset, x, width, offset === 0);
      const noteStart = Math.max(...column.staves.map((staff) => staff.stave.getNoteStartX()));
      column.staves.forEach((staff) => staff.stave.setNoteStartX(noteStart).setContext(context));
      const noteEnd = Math.min(...column.staves.map((staff) => staff.stave.getNoteEndX()));
      if (column.voices.some((voice) => voice.getTickables().length)) {
        column.formatter.format(column.voices, Math.max(20, noteEnd - noteStart - column.tail - 12), { alignRests: false, context });
      }
      columns.push(column);
      x += width;
    });
    const staffGroups: SVGGElement[] = [];
    // First draw every staff at the same neutral origin. Flags, accidentals and
    // dots acquire their real positions only during drawing. Ties are added
    // before measuring too, including both halves at a system/page boundary.
    score.staves.forEach((staffModel, staffIndex) => {
      const staffGroup = context.openGroup('music-staff');
      staffGroup.dataset.staffId = staffModel.id;
      staffGroups.push(staffGroup);
      columns.forEach((column) => {
        const staff = column.staves[staffIndex];
        staff.stave.draw();
        for (const [id, note] of staff.notes) {
          const event = staff.events.get(id)!;
          const group = context.openGroup('music-event');
          group.dataset.sourceId = id;
          group.dataset.onset = formatRational(event.onset);
          group.dataset.staffId = staffModel.id;
          group.dataset.measureId = staff.measure.id;
          group.dataset.kind = event.kind;
          group.dataset.x = String(note.getAbsoluteX());
          group.dataset.duration = formatRational(event.time);
          note.setContext(context).draw();
          context.closeGroup();
          drawnNotes.set(id, { event, note, group, staffGroup, context, system: systemIndex });
        }
        context.openGroup('music-beams');
        staff.beams.forEach((beam) => beam.setContext(context).draw());
        context.closeGroup();
        drawTuplets(staff, context, staffGroup);
      });
      context.closeGroup();
    });
    drawnSystems.push({ context, renderer, wrapper, columns, staffGroups, width: system.width + left + RIGHT_MARGIN });
  });
  drawTies(score, drawnNotes);
  drawnSystems.forEach((system, index) => {
    const { context, columns } = system;
    let cursor = 8;
    system.staffGroups.forEach((group, staffIndex) => {
      for (const column of columns) {
        const staff = column.staves[staffIndex];
        if (recoverHiddenRests(staff, group, drawnNotes)) {
          // Brackets must follow recovered rests, including nested groups.
          const ids = new Set(staff.tuplets.map(tuplet => tuplet.id));
          group.querySelectorAll<SVGGElement>('g.vf-music-tuplet').forEach(tuplet => {
            if (ids.has(tuplet.dataset.sourceId ?? '')) tuplet.remove();
          });
          drawTuplets(staff, context, group);
        }
      }
      const annotations = placeAnnotations(columns, staffIndex, visibleInk(group));
      annotations.forEach(item => group.append(drawAnnotation(item, context)));
      const label = score.staves[staffIndex].label;
      if (label) {
        const labelGroup = context.openGroup('staff-label');
        context.setFont('Academico', '13px').fillText(label, 8, 64);
        context.closeGroup();
        group.append(labelGroup);
      }
      if (staffIndex === 0 && options.measureNumbers !== 'none') {
        const top = unionInk(visibleInk(group))!.y;
        columns.forEach((column, offset) => {
          if (offset > 0 && options.measureNumbers !== 'all') return;
          const staff = column.staves[staffIndex];
          const number = textElement({ text: staff.measure.number, family: 'Academico', size: 11 });
          const numberGroup = context.openGroup('measure-number');
          numberGroup.dataset.measureId = staff.measure.id;
          number.renderText(context, staff.stave.getX() + 3, top - ANNOTATION_GAP - number.getTextMetrics().actualBoundingBoxDescent);
          context.closeGroup();
          group.append(numberGroup);
        });
      }
      const bounds = unionInk(visibleInk(group))!;
      const shift = cursor - bounds.y;
      group.setAttribute('transform', `translate(0 ${shift})`);
      group.dataset.topLine = String(40 + shift);
      group.dataset.bottomLine = String(80 + shift);
      for (const column of columns) {
        const staff = column.staves[staffIndex];
        staff.stave.setY(shift);
        const noteInk = new Map([...staff.events.keys()].map(id => [id, unionInk(visibleInk(drawnNotes.get(id)!.group, group))]));
        for (const [id, event] of staff.events) {
          const drawn = drawnNotes.get(id)!;
          const noteGroup = drawn.group;
          // Replace the engine's invisible full-font/stem hit box with a small
          // hit area around the visible event. Neither participates in spacing.
          noteGroup.querySelectorAll('rect[opacity="0"][pointer-events="auto"]').forEach(rect => rect.remove());
          let ink = noteInk.get(id);
          if (!ink && event.kind === 'rest' && drawn.note.renderOptions.draw === false) {
            // VexFlow prints coincident, equal rests in two voices only once.
            // Keep both musical identities and map their hits to that shared ink.
            const peer = [...staff.events.values()].find(candidate => candidate.id !== id && canShareRest(candidate, event)
              && noteInk.has(candidate.id)
              && noteInk.get(candidate.id));
            if (peer) {
              ink = noteInk.get(peer.id);
              noteGroup.dataset.coalescedWith = peer.id;
            }
          }
          if (!ink) throw new Error(`No printed notation could be located for event ${id}.`);
          const width = Math.max(10, ink.width);
          const height = Math.max(12, ink.height);
          const box = { x: ink.x - (width - ink.width) / 2, y: ink.y - (height - ink.height) / 2, width, height };
          const target = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const [name, value] of Object.entries(box)) target.setAttribute(name, String(value));
          target.setAttribute('opacity', '0');
          target.setAttribute('pointer-events', 'all');
          if (!noteGroup.dataset.coalescedWith) noteGroup.append(target);
          hitRegions.push({ sourceId: id, system: index, ...moveInk(box, 0, shift), onset: event.onset });
        }
      }
      cursor = shift + bounds.y + bounds.height + STAFF_GAP;
    });
    drawConnectors(system, score, diagnostics);
    const box = unionInk(visibleInk(system.context.svg))!;
    const minX = Math.min(0, box.x - 8);
    const minY = Math.min(0, box.y - 8);
    // Outer padding follows painted glyphs, not Bravura's much taller em box.
    // A left overhang may consume some of the reserved right margin. Do not
    // enlarge an otherwise fitting viewport just to preserve unused padding.
    const width = Math.ceil(Math.max(system.width, box.x + box.width + 8 - minX) - 1e-7);
    const height = Math.ceil(box.y + box.height + 8 - minY);
    system.renderer.resize(width, height);
    system.context.setViewBox(minX, minY, width, height);
    if (width > viewportWidth) {
      system.wrapper.classList.add('overflow');
      system.wrapper.tabIndex = 0;
      diagnostics.push({ severity: 'warning', code: 'layout-overflow', sourceId: score.staves[0].measures[systems[index].start].id,
        message: `System ${index + 1} needs ${width}px to keep its notation readable. Scroll horizontally or use a wider page.` });
    }
  });
  return { systems, hitRegions, diagnostics };
}
