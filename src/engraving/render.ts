import VexFlow, {
  Accidental, Barline, Beam, Dot, Element as EngravingElement, Formatter, Fraction,
  Renderer, Stave, StaveConnector, StaveModifier, StaveNote, StaveTie, Stem,
  SVGContext, TimeSignature, Tuplet as EngravedTuplet, Voice as EngravedVoice, prefix,
} from 'vexflow/bravura';
import { add, compare, durationTime, equals, formatRational, rational, subtract, toNumber } from '../model/index.js';
import type { Annotation, Clef, Diagnostic, Duration, EventMarking, MarkingPlacement, Measure, MusicEvent, Rational, Score, Staff } from '../model/types.js';
import { planSystems } from './layout.js';
import type { SystemLayout } from './layout.js';
import { canShareRest, groupBeams, hasSimultaneousPitchConflict, resolveAccidentals } from './semantics.js';
import { moveInk, overlapsInkX, unionInk, visibleInk } from './geometry.js';
import type { InkBox } from './geometry.js';
import { drawEventMarkings, MarkedStaveNote, printedHeadInk } from './event-markings.js';

const DURATION: Record<Duration, string> = {
  breve: '1/2', whole: 'w', half: 'h', quarter: 'q', eighth: '8',
  sixteenth: '16', 'thirty-second': '32', 'sixty-fourth': '64', '128th': '128',
};
const SLASH_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4', tenor: 'a/3' };
// These keys select engine coordinates only; road events never acquire pitches.
const ROAD_KEY = { higher: 'f/5', same: 'b/4', lower: 'e/4' } as const;
const BARLINE = {
  single: VexFlow.BarlineType.SINGLE, double: VexFlow.BarlineType.DOUBLE,
  final: VexFlow.BarlineType.END, 'repeat-end': VexFlow.BarlineType.REPEAT_END, none: VexFlow.BarlineType.NONE,
} as const;
const ANNOTATION_GAP = 8;
const STAFF_GAP = 24;
const INCOMING_TIE_SPACE = 20;
const RIGHT_MARGIN = 20;
const LABEL_X = 8;
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

/** Painted source bounds in the named system's SVG viewBox coordinates. */
export interface SourceGeometry extends InkBox {
  readonly sourceId: string;
  readonly system: number;
}

export interface StaffGeometry extends SourceGeometry {
  readonly topLine: number;
  readonly bottomLine: number;
  /** Actual notation and staff-space size; a one-line staff has equal line bounds. */
  readonly notation?: Staff['notation'];
  readonly staffSpace?: number;
  readonly measureIds: readonly string[];
}

/**
 * A selectable measure lane: its barline interval and the final staff ink height.
 * Header and note positions are measured by the adapter, never inferred by UI.
 */
export interface MeasureGeometry extends SourceGeometry {
  readonly staffId: string;
  /** Original, zero-based measure column, independent of displayed numbering. */
  readonly measureIndex: number;
  readonly topLine: number;
  readonly bottomLine: number;
  readonly notation?: Staff['notation'];
  readonly staffSpace?: number;
  readonly noteStartX: number;
  readonly noteEndX: number;
}

/** One pitched notehead's painted ink, excluding its stem, accidental and dots. */
export interface NoteheadGeometry extends InkBox {
  /** Original index into MusicEvent.pitches, not the engine's vertical sort order. */
  readonly pitchIndex: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface EventGeometry extends HitRegion {
  readonly staffId: string;
  readonly measureId: string;
  readonly voiceId: string;
  readonly eventIndex: number;
  /** The formatter's onset x and the final staff's center line y. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Actual painted bounds, before the minimum pointer target is added. */
  readonly ink: InkBox;
  /** All source events sharing this ink, including this event itself. */
  readonly sharedSourceIds: readonly string[];
  /** Always supplied by renderScore; pitchless events have none. Optional for older adapters. */
  readonly noteheads?: readonly NoteheadGeometry[];
}

export interface AnnotationGeometry extends SourceGeometry {
  readonly staffId: string;
  readonly measureId: string;
  readonly kind: Annotation['kind'];
  readonly onset: Rational;
}

/** Event-local symbols retain their child source IDs without becoming event hits. */
export interface MarkingGeometry extends SourceGeometry {
  readonly staffId: string;
  readonly measureId: string;
  readonly voiceId: string;
  readonly eventId: string;
  readonly kind: EventMarking['kind'];
  /** Resolved display side; an interval always retains its authored musical side. */
  readonly placement: MarkingPlacement;
}

export interface TupletGeometry extends SourceGeometry {
  readonly staffId: string;
  readonly measureId: string;
  readonly voiceId: string;
  readonly eventIds: readonly string[];
}

/**
 * A musical boundary in one voice, including its start and its append position.
 * sourceId is the voice's original source (or the measure for a voiceless draft).
 * beforeId/afterId preserve adjacent event identities, including inside tuplets.
 * x follows the shared formatter timeline; y/height span the final staff lines.
 */
export interface InsertionAnchor {
  readonly sourceId: string;
  readonly system: number;
  readonly staffId: string;
  readonly measureId: string;
  readonly voiceId?: string;
  readonly eventIndex: number;
  readonly beforeId?: string;
  readonly afterId?: string;
  readonly onset: Rational;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** Complete, final SVG dimensions and source geometry for one unbroken system. */
export interface SystemGeometry {
  readonly index: number;
  readonly start: number;
  /** Exclusive end index into the original measure columns. */
  readonly end: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox: InkBox;
  readonly ink: InkBox;
  readonly pageBreak: boolean;
  readonly staves: readonly StaffGeometry[];
  readonly measures: readonly MeasureGeometry[];
  readonly events: readonly EventGeometry[];
  readonly annotations: readonly AnnotationGeometry[];
  /** Always supplied by renderScore; optional for older adapters. */
  readonly markings?: readonly MarkingGeometry[];
  readonly tuplets: readonly TupletGeometry[];
  readonly anchors: readonly InsertionAnchor[];
}

export interface EngravingResult {
  readonly systems: readonly SystemLayout[];
  readonly hitRegions: readonly HitRegion[];
  readonly diagnostics: readonly Diagnostic[];
  /** Always supplied by renderScore; optional for older adapter implementations. */
  readonly systemGeometry?: readonly SystemGeometry[];
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
  separateUnisons: boolean;
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

/** Center repeat dots on the single line, independently of its extended barline. */
class RhythmBarline extends Barline {
  override drawRepeatBar(stave: Stave, x: number, begin: boolean): void {
    const context = stave.checkContext();
    const top = stave.getTopLineTopY();
    const bottom = stave.getBottomLineBottomY();
    context.fillRect(x + (begin ? 3 : -5), top, 1, bottom - top);
    context.fillRect(x - 2, top, 3, bottom - top);
    const center = stave.getYForLine(0) + 0.5;
    const dotX = x + (begin ? 8 : -8);
    for (const offset of [-0.5, 0.5]) {
      context.beginPath();
      context.arc(dotX, center + offset * stave.getSpacingBetweenLines(), 2, 0, Math.PI * 2, false);
      context.fill();
    }
  }
}

/** Set musical context without inventing pitches for rhythm or relative roads. */
class ContextStave extends Stave {
  private incomingTieStart?: number;
  readonly rhythm: boolean;
  readonly threeRoads: boolean;

  constructor(x: number, width: number, clef: Clef, notation: Staff['notation']) {
    super(x, 0, width, { numLines: notation === 'rhythm' ? 1 : 5 });
    this.clef = clef;
    this.rhythm = notation === 'rhythm';
    this.threeRoads = notation === 'three-roads';
    if (this.threeRoads) {
      // Keep the original five-line coordinates and full outer span. The roads
      // are its top, middle, and bottom lines, not three adjacent staff lines.
      this.setConfigForLines([true, false, true, false, true].map(visible => ({ visible })));
    }
    if (this.rhythm) {
      this.modifiers[0] = new RhythmBarline(VexFlow.BarlineType.SINGLE).setStave(this);
      this.modifiers[1] = new RhythmBarline(VexFlow.BarlineType.SINGLE)
        .setPosition(StaveModifier.Position.END).setStave(this);
    }
  }

  override getYForNote(line: number): number {
    // VexFlow fixes the center of a five-line staff at note line 3 even when
    // numLines changes. Keep its note/rest coordinates centered on our line.
    return this.rhythm ? this.getYForLine(3 - line) : super.getYForNote(line);
  }

  hasVisibleLineForNote(line: number): boolean {
    const staffLine = (this.rhythm ? 3 : 5) - line;
    return Number.isInteger(staffLine) && this.getConfigForLines()[staffLine]?.visible === true;
  }

  override getTopLineTopY(): number {
    // These engine methods bound barlines/connectors, not published staff-line
    // geometry. Single-line bars extend one staff space in either direction.
    return super.getTopLineTopY() - (this.rhythm ? this.getSpacingBetweenLines() : 0);
  }

  override getBottomLineBottomY(): number {
    return super.getBottomLineBottomY() + (this.rhythm ? this.getSpacingBetweenLines() : 0);
  }

  reserveIncomingTieSpace(): void {
    this.incomingTieStart = this.getNoteStartX();
    this.setNoteStartX(this.incomingTieStart + INCOMING_TIE_SPACE);
  }

  override getTieStartX(): number {
    return this.incomingTieStart ?? super.getTieStartX();
  }
}

/** VexFlow otherwise reserves the missing four lines below a rhythm tuplet. */
class StaffTuplet extends EngravedTuplet {
  override getYPosition(): number {
    const stave = this.notes[0].checkStave();
    if (!(stave instanceof ContextStave) || !stave.rhythm || this.options.location !== -1) {
      return super.getYPosition();
    }
    const spacing = stave.getSpacingBetweenLines();
    let y = stave.getYForLine(0) + 2 * spacing;
    for (const member of this.notes) {
      const note = member as StaveNote;
      const textLine = note.getModifierContext()?.getState().textLine ?? 0;
      if (textLine > 0) y = Math.max(y, stave.getYForLine(textLine + 1) + 2 * spacing);
      if (note.hasStem() || note.isRest()) {
        const extents = note.getStemExtents();
        y = Math.max(y, note.getStemDirection() === Stem.UP ? extents.baseY + 2 * spacing : extents.topY + spacing);
      }
    }
    return y + this.getNestedTupletCount() * EngravedTuplet.NESTING_OFFSET + this.options.yOffset;
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

function createStave(measure: Measure, previous: Measure | undefined, x: number, width: number, firstInLine: boolean, notation: Staff['notation']): ContextStave {
  const stave = new ContextStave(x, width, measure.clef, notation);
  const changedKey = previous !== undefined && previous.key !== measure.key;
  const changedClef = previous !== undefined && previous.clef !== measure.clef;
  if (!stave.rhythm && !stave.threeRoads) {
    if (firstInLine || changedClef) stave.addClef(measure.clef);
    if (firstInLine || changedKey) stave.addKeySignature(measure.key, changedKey ? previous?.key : undefined);
  }
  if (!previous || previous.meter.display !== measure.meter.display) {
    const signature = new TimeSignature(measure.meter.display);
    if (stave.rhythm) { signature.topLine = -1; signature.bottomLine = 1; }
    stave.addModifier(signature);
  }
  stave.setBegBarType(measure.repeatStart ? VexFlow.BarlineType.REPEAT_BEGIN : firstInLine ? VexFlow.BarlineType.SINGLE : VexFlow.BarlineType.NONE);
  stave.setEndBarType(BARLINE[measure.endBar]);
  return stave;
}

function createNote(event: MusicEvent, measure: Measure, voiceIndex: number, stave: ContextStave): StaveNote {
  const silentRhythm = event.kind === 'slash' && !event.rhythmic;
  const duration = event.measureRest ? 'w' : silentRhythm ? 'q' : DURATION[event.duration];
  // Engine keys carry diatonic position only. Printed accidentals below carry
  // the exact alteration; fractional alterations must never be rounded here.
  const keys = event.kind === 'rest' ? ['r/4'] : event.kind === 'rhythm' ? ['b/4']
    : event.kind === 'road' ? [ROAD_KEY[event.pitchDirection!]]
    : event.kind === 'slash' ? [SLASH_KEY[measure.clef]]
    : event.pitches.map((pitch) => `${pitch.step.toLowerCase()}/${pitch.octave}`);
  const direction = event.stem === 'up' ? Stem.UP : event.stem === 'down' ? Stem.DOWN
    : measure.voices.length > 1 ? voiceIndex % 2 === 0 ? Stem.UP : Stem.DOWN
      : stave.rhythm ? Stem.UP : undefined;
  const note = new MarkedStaveNote({
    clef: measure.clef, keys, duration,
    dots: silentRhythm || event.measureRest ? 0 : event.dots,
    type: event.kind === 'rest' ? 'r' : event.kind === 'slash' || event.kind === 'road' ? 's' : 'n',
    autoStem: direction === undefined,
    stemDirection: direction,
    alignCenter: event.measureRest,
    ...(event.measureRest || silentRhythm ? { durationOverride: new Fraction(
      event.measureRest ? event.time.numerator : durationTime(event.duration, event.dots).numerator,
      event.measureRest ? event.time.denominator : durationTime(event.duration, event.dots).denominator,
    ) } : {}),
  }).reserveMarkings(event.markings ?? []);
  // Whole rests normally hang from the fourth of five lines. On reduced staves
  // use the visible middle line; half rests sit on it, whole rests hang below.
  if ((stave.rhythm || stave.threeRoads) && event.kind === 'rest') note.setKeyLine(0, 3);
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

function prepareStaff(measure: Measure, previous: Measure | undefined, x: number, width: number, firstInLine: boolean, notation: Staff['notation']): PreparedStaff {
  const stave = createStave(measure, previous, x, width, firstInLine, notation);
  const notes = new Map<string, StaveNote>();
  const events = new Map<string, MusicEvent>();
  const beams: Beam[] = [];
  const tuplets: PreparedStaff['tuplets'] = [];
  const accidentals = coalesceAccidentals(measure);
  const voices = measure.voices.map((voice, voiceIndex) => {
    const restLines = new Map<StaveNote, number>();
    const voiceNotes = voice.events.map((event) => {
      const note = createNote(event, measure, voiceIndex, stave).setStave(stave);
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
      const tuplet = new StaffTuplet(members, {
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
      const autoStem = !stave.rhythm && measure.voices.length === 1 && ids.every((id) => events.get(id)?.stem === 'auto');
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
  const staves = score.staves.map((staff) => prepareStaff(staff.measures[index], staff.measures[index - 1], x, width, firstInLine, staff.notation));
  alignHeaders(staves.map(staff => staff.stave), firstInLine && staves.some(staff => startsWithTie(staff.measure)));
  const formatter = new Formatter();
  // Empty drafts keep their model voices and anchors. Passing empty engine
  // voices to the formatter would add spacing to their sounding companions.
  const voices = staves.flatMap((staff) => {
    const written = staff.voices.filter(voice => voice.getTickables().length > 0);
    if (written.length) formatter.joinVoices(written);
    return written;
  });
  // Non-initial directions get real trailing space, so text at the final attack
  // cannot be lost beyond the bar/system edge. Initial directions affect minima.
  const tail = Math.max(14, ...staves.flatMap((staff) => staff.measure.annotations
    .filter((annotation) => annotation.onset.numerator > 0).map((annotation) => measureAnnotation(annotation).width + 12)));
  return { staves, formatter, voices, tail,
    separateUnisons: staves.some(staff => hasSimultaneousPitchConflict(staff.measure)) };
}

function formatColumn<T>(column: PreparedColumn, format: () => T): T {
  // VexFlow's shared-head rule ignores alterations. Disable it for a column
  // containing conflicting spellings, in both width measurement and drawing.
  // Formatting is synchronous; always restore the engine's global preference.
  const unison = VexFlow.UNISON;
  try {
    if (column.separateUnisons) VexFlow.UNISON = false;
    return format();
  } finally {
    VexFlow.UNISON = unison;
  }
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
      staff.measures[index], staff.measures[index - 1], 0, 2000, true, staff.notation,
    ));
    alignHeaders(firstStaves, score.staves.some(staff => startsWithTie(staff.measures[index])));
    const firstPrefix = Math.max(...firstStaves.map(stave => stave.getNoteStartX()));
    const musicWidth = column.voices.some((voice) => voice.getTickables().length)
      ? formatColumn(column, () => column.formatter.preCalculateMinTotalWidth(column.voices)) : 40;
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

function onsetX(onset: Rational, column: PreparedColumn): number {
  const all = column.staves.flatMap((staff) => [...staff.events.values()].map((event) => ({
    onset: event.onset, x: staff.notes.get(event.id)!.getAbsoluteX(),
  }))).sort((a, b) => compare(a.onset, b.onset));
  const exact = all.find((entry) => equals(entry.onset, onset));
  if (exact) return exact.x;
  const stave = column.staves[0].stave;
  const duration = toNumber(column.staves[0].measure.meter.numerator === 0 ? rational(1) : rational(
    column.staves[0].measure.meter.numerator, column.staves[0].measure.meter.denominator));
  let left = { onset: rational(0), x: stave.getNoteStartX() + 10 };
  let right = { onset: rational(column.staves[0].measure.meter.numerator, column.staves[0].measure.meter.denominator), x: stave.getNoteEndX() - column.tail };
  for (const entry of all) {
    if (compare(entry.onset, onset) < 0) left = entry;
    if (compare(entry.onset, onset) > 0) { right = entry; break; }
  }
  const range = toNumber(right.onset) - toNumber(left.onset);
  const position = range > 0 ? (toNumber(onset) - toNumber(left.onset)) / range : toNumber(onset) / duration;
  return left.x + Math.max(0, Math.min(1, position)) * (right.x - left.x);
}

function placeAnnotations(columns: PreparedColumn[], staffIndex: number, musicInk: readonly InkBox[]): PlacedAnnotation[] {
  const stave = columns[0].staves[staffIndex].stave;
  const topLine = stave.getYForLine(0);
  const bottomLine = stave.getYForLine(stave.getNumLines() - 1);
  const measured = columns.flatMap((column) => column.staves[staffIndex].measure.annotations.map((annotation) => ({
    ...measureAnnotation(annotation), x: onsetX(annotation.onset, column), y: 0,
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
          return above ? Math.min(topLine, ...edges) - ANNOTATION_GAP - inset
            : Math.max(bottomLine, ...edges) + ANNOTATION_GAP - inset;
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

/** Rectangular rests need a real supporting glyph when displaced off a line. */
function restGlyph(note: StaveNote, event: MusicEvent, line: number): string {
  const duration = event.measureRest ? 'whole' : event.duration;
  const stave = note.checkStave();
  const outside = stave instanceof ContextStave ? !stave.hasVisibleLineForNote(line)
    : line < 1 || line > stave.getNumLines();
  let glyph = REST_GLYPH[duration];
  if (outside) {
    if (duration === 'whole') glyph = Glyphs.restWholeLegerLine;
    else if (duration === 'half') glyph = Glyphs.restHalfLegerLine;
    else if (duration === 'breve') glyph = Glyphs.restDoubleWholeLegerLine;
  }
  return glyph;
}

function positionLedgerRestDots(note: StaveNote, glyph: string): void {
  // VexFlow recognizes the standard rest glyphs when locating modifiers, but
  // not their supporting-ledger variants. Keep dots off that supporting line.
  const shift = glyph === Glyphs.restHalfLegerLine ? -0.5
    : glyph === Glyphs.restWholeLegerLine || glyph === Glyphs.restDoubleWholeLegerLine ? 0.5 : undefined;
  if (shift !== undefined) for (const dot of Dot.getDots(note)) dot.setDotShiftY(shift);
}

/** Move a rest by whole staff spaces, retaining its tick context and modifiers. */
function redrawRest(drawn: DrawnNote, line: number): InkBox {
  const { note, event, context, group, staffGroup } = drawn;
  note.setKeyLine(0, line);
  // Choose the glyph explicitly after rebuilding the head. Only rectangular
  // rests require a supporting ledger line; displaced shorter rests do not.
  const glyph = restGlyph(note, event, line);
  note.noteHeads[0].setText(glyph);
  note.preFormat();
  positionLedgerRestDots(note, glyph);
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
    // An outer road can have the opposite automatic stem from its middle-road
    // continuation. Match the unbroken tie's direction on both system halves.
    if (first.event.kind === 'road') tie.setDirection(last.note.getStemDirection());
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
            const pitchless = (first.event.kind === 'rhythm' && event.kind === 'rhythm')
              || (first.event.kind === 'road' && event.kind === 'road');
            const indexes = pitchless ? [0] : first.event.pitches.map((_, index) => index);
            const lastIndexes = pitchless ? [0] : first.event.pitches.map((pitch) => event.pitches.findIndex((candidate) =>
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

function noteheadGeometry(drawn: DrawnNote): readonly NoteheadGeometry[] {
  if (drawn.event.kind !== 'note' && drawn.event.kind !== 'chord') return [];
  // VexFlow 5's public noteHeads getter keeps the original key indices even
  // though its chord-displacement calculation sorts pitches internally. Our
  // keys were created in event.pitches order, so this is a stable source map.
  return printedHeadInk(drawn.note, drawn.group, drawn.context.svg, drawn.event.id).map((bounds, pitchIndex) => {
    return { pitchIndex, ...bounds, centerX: bounds.x + bounds.width / 2, centerY: bounds.y + bounds.height / 2 };
  });
}

/** Publish only final geometry, after rest recovery, tuplets, staff shifts and ties. */
function systemGeometry(
  drawn: DrawnSystem, score: Score, layout: SystemLayout, index: number,
  viewBox: InkBox, ink: InkBox, hits: readonly HitRegion[],
  notes: ReadonlyMap<string, DrawnNote>, eventInk: ReadonlyMap<string, InkBox>,
): SystemGeometry {
  const staves: StaffGeometry[] = [];
  const measures: MeasureGeometry[] = [];
  const events: EventGeometry[] = [];
  const annotations: AnnotationGeometry[] = [];
  const markings: MarkingGeometry[] = [];
  const tuplets: TupletGeometry[] = [];
  const anchors: InsertionAnchor[] = [];
  const hitById = new Map(hits.map(hit => [hit.sourceId, hit]));
  drawn.staffGroups.forEach((group, staffIndex) => {
    const staffModel = score.staves[staffIndex];
    const staffInk = unionInk(visibleInk(group, drawn.context.svg))!;
    const firstStave = drawn.columns[0].staves[staffIndex].stave;
    staves.push({ sourceId: staffModel.id, system: index, ...staffInk,
      topLine: firstStave.getYForLine(0), bottomLine: firstStave.getYForLine(firstStave.getNumLines() - 1),
      notation: staffModel.notation ?? 'pitched', staffSpace: firstStave.getSpacingBetweenLines(),
      measureIds: drawn.columns.map(column => column.staves[staffIndex].measure.id) });
    const annotationGroups = new Map([...group.querySelectorAll<SVGGElement>('g.vf-music-annotation')]
      .map(element => [element.dataset.sourceId!, element]));
    const markingGroups = new Map([...group.querySelectorAll<SVGGElement>('g.vf-music-marking')]
      .map(element => [element.dataset.sourceId!, element]));
    const tupletGroups = new Map([...group.querySelectorAll<SVGGElement>('g.vf-music-tuplet')]
      .map(element => [element.dataset.sourceId!, element]));
    drawn.columns.forEach((column, offset) => {
      const staff = column.staves[staffIndex];
      const measure = staff.measure;
      const topLine = staff.stave.getYForLine(0);
      const bottomLine = staff.stave.getYForLine(staff.stave.getNumLines() - 1);
      const ancestry = { system: index, staffId: staffModel.id, measureId: measure.id };
      measures.push({ sourceId: measure.id, system: index, staffId: staffModel.id, measureIndex: layout.start + offset,
        x: staff.stave.getX(), y: staffInk.y, width: staff.stave.getWidth(), height: staffInk.height,
        topLine, bottomLine, notation: staffModel.notation ?? 'pitched', staffSpace: staff.stave.getSpacingBetweenLines(),
        noteStartX: staff.stave.getNoteStartX(), noteEndX: staff.stave.getNoteEndX() });

      const inkOwners = new Map<string, string[]>();
      for (const id of staff.events.keys()) {
        const owner = notes.get(id)!.group.dataset.coalescedWith ?? id;
        const siblings = inkOwners.get(owner) ?? [];
        siblings.push(id);
        inkOwners.set(owner, siblings);
      }
      for (const voice of measure.voices) {
        voice.events.forEach((event, eventIndex) => {
          const note = notes.get(event.id)!;
          const owner = note.group.dataset.coalescedWith ?? event.id;
          events.push({ ...hitById.get(event.id)!, staffId: staffModel.id, measureId: measure.id,
            voiceId: voice.id, eventIndex, anchorX: note.note.getAbsoluteX(), anchorY: (topLine + bottomLine) / 2,
            ink: eventInk.get(event.id)!, sharedSourceIds: inkOwners.get(owner)!, noteheads: noteheadGeometry(note) });
          for (const marking of event.markings ?? []) {
            const element = markingGroups.get(marking.id);
            const bounds = element && unionInk(visibleInk(element, drawn.context.svg));
            if (!bounds) throw new Error(`No printed geometry could be located for event marking ${marking.id}.`);
            markings.push({ sourceId: marking.id, ...ancestry, voiceId: voice.id, eventId: event.id,
              kind: marking.kind, placement: element!.dataset.placement as MarkingPlacement, ...bounds });
          }
        });
        for (let eventIndex = 0; eventIndex <= voice.events.length; eventIndex++) {
          const before = voice.events[eventIndex];
          const after = voice.events[eventIndex - 1];
          const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
          anchors.push({ sourceId: voice.id, ...ancestry, voiceId: voice.id, eventIndex,
            ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}),
            onset, x: onsetX(onset, column), y: topLine, height: bottomLine - topLine });
        }
        for (const tuplet of voice.tuplets) {
          const element = tupletGroups.get(tuplet.id);
          const bounds = element && unionInk(visibleInk(element, drawn.context.svg));
          if (bounds) tuplets.push({ sourceId: tuplet.id, ...ancestry, voiceId: voice.id,
            eventIds: [...tuplet.eventIds], ...bounds });
        }
      }
      if (!measure.voices.length) {
        const onset = rational(0);
        anchors.push({ sourceId: measure.id, ...ancestry, eventIndex: 0, onset,
          x: onsetX(onset, column), y: topLine, height: bottomLine - topLine });
      }
      for (const annotation of measure.annotations) {
        const element = annotationGroups.get(annotation.id);
        const bounds = element && unionInk(visibleInk(element, drawn.context.svg));
        if (bounds) annotations.push({ sourceId: annotation.id, ...ancestry,
          kind: annotation.kind, onset: annotation.onset, ...bounds });
      }
    });
  });
  return { index, start: layout.start, end: layout.end, width: viewBox.width, height: viewBox.height,
    viewBox, ink, pageBreak: layout.pageBreak, staves, measures, events, annotations, markings, tuplets, anchors };
}

/** Engrave a validated score. All staves share one formatter per measure column. */
export function renderScore(container: HTMLElement, score: Score, options: EngravingOptions): EngravingResult {
  const diagnostics: Diagnostic[] = [];
  const hitRegions: HitRegion[] = [];
  const geometry: SystemGeometry[] = [];
  const eventInk = new Map<string, InkBox>();
  container.replaceChildren();
  if (!score.staves.length || !score.staves[0].measures.length) return { systems: [], hitRegions, diagnostics, systemGeometry: geometry };
  const labelsWidth = Math.max(0, ...score.staves.map((staff) => staff.label ? textWidth(staff.label) + 14 : 0));
  const connectorSpace = score.bracket === 'none' ? 0 : 20;
  const firstLeft = 12 + labelsWidth + connectorSpace;
  const continuationLeft = labelsWidth ? LABEL_X + connectorSpace : firstLeft;
  const viewportWidth = Number.isFinite(options.width) ? Math.max(1, Math.floor(options.width)) : 1;
  const systems = planSystems(columnSizes(score), Math.max(1, viewportWidth - continuationLeft - RIGHT_MARGIN), {
    maxMeasures: options.maxMeasures, justifyLast: options.justifyLast, maxStretch: 1.5,
    firstSystemIndent: firstLeft - continuationLeft,
  });
  const drawnNotes = new Map<string, DrawnNote>();
  const drawnSystems: DrawnSystem[] = [];
  systems.forEach((system, systemIndex) => {
    const left = systemIndex === 0 ? firstLeft : continuationLeft;
    const wrapper = document.createElement('div');
    wrapper.className = 'system-row';
    wrapper.dataset.systemIndex = String(systemIndex);
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
        formatColumn(column, () => column.formatter.format(column.voices,
          Math.max(20, noteEnd - noteStart - column.tail - 12), { alignRests: false, context }));
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
      staffGroup.dataset.notation = staffModel.notation ?? 'pitched';
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
          // A lookup ID, not a claim that a stem is printed. Beam strokes live
          // outside this event group; whole values and hidden stems have no ink.
          const stem = note.getStem();
          if (stem) group.dataset.stemId = prefix(stem.getAttribute('id'));
          if (event.kind === 'road') group.dataset.pitchDirection = event.pitchDirection;
          group.dataset.x = String(note.getAbsoluteX());
          group.dataset.duration = formatRational(event.time);
          // Voice collision formatting may displace a rectangular rest onto a
          // hidden line. Give it a supporting SMuFL ledger-rest glyph instead.
          if ((staff.stave.rhythm || staff.stave.threeRoads) && event.kind === 'rest') {
            const glyph = restGlyph(note, event, note.getKeyLine(0));
            note.noteHeads[0].setText(glyph);
            positionLedgerRestDots(note, glyph);
          }
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
    const firstHit = hitRegions.length;
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
      drawEventMarkings(columns.flatMap(column => {
        const measure = column.staves[staffIndex].measure;
        return measure.voices.flatMap(voice => voice.events.map(event => drawnNotes.get(event.id)!));
      }), group);
      const annotations = placeAnnotations(columns, staffIndex, visibleInk(group));
      annotations.forEach(item => group.append(drawAnnotation(item, context)));
      const label = score.staves[staffIndex].label;
      // Instrument identity belongs to the opening system, including across page breaks.
      if (label && index === 0) {
        const labelGroup = context.openGroup('staff-label');
        const stave = columns[0].staves[staffIndex].stave;
        const center = (stave.getYForLine(0) + stave.getYForLine(stave.getNumLines() - 1)) / 2;
        context.setFont('Academico', '13px').fillText(label, LABEL_X, center + 4);
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
      const firstStave = columns[0].staves[staffIndex].stave;
      group.dataset.topLine = String(firstStave.getYForLine(0) + shift);
      group.dataset.bottomLine = String(firstStave.getYForLine(firstStave.getNumLines() - 1) + shift);
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
          eventInk.set(id, moveInk(ink, 0, shift));
          const width = Math.max(10, ink.width);
          const height = Math.max(12, ink.height);
          const box = { x: ink.x - (width - ink.width) / 2, y: ink.y - (height - ink.height) / 2, width, height };
          const target = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const [name, value] of Object.entries(box)) target.setAttribute(name, String(value));
          target.setAttribute('opacity', '0');
          target.setAttribute('pointer-events', 'all');
          // Keep the event's enlarged fallback target behind its painted
          // children. A rectangle above them would swallow native clicks on
          // child markings and incorrectly select their parent event instead.
          if (!noteGroup.dataset.coalescedWith) noteGroup.prepend(target);
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
    geometry.push(systemGeometry(system, score, systems[index], index,
      { x: minX, y: minY, width, height }, box, hitRegions.slice(firstHit), drawnNotes, eventInk));
    if (width > viewportWidth) {
      system.wrapper.classList.add('overflow');
      system.wrapper.tabIndex = 0;
      diagnostics.push({ severity: 'warning', code: 'layout-overflow', sourceId: score.staves[0].measures[systems[index].start].id,
        message: `System ${index + 1} needs ${width}px to keep its notation readable. Scroll horizontally or use a wider page.` });
    }
  });
  return { systems, hitRegions, diagnostics, systemGeometry: geometry };
}
