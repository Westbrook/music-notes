import VexFlow, { Element as EngravingElement, StaveNote, Stem, prefix } from 'vexflow/bravura';
import type { SVGContext } from 'vexflow/bravura';
import type { ArticulationType, EventMarking, MarkingPlacement, MusicEvent, OrnamentType } from '../model/types.js';
import { eventMarkingOrder, eventMarkingPlacement, placeEventMarking } from './semantics.js';
import { unionInk, visibleInk } from './geometry.js';
import type { InkBox } from './geometry.js';

const Glyphs = VexFlow.Glyphs;
const ARTICULATION: Record<ArticulationType, Record<MarkingPlacement, string>> = {
  accent: { above: Glyphs.articAccentAbove, below: Glyphs.articAccentBelow },
  staccato: { above: Glyphs.articStaccatoAbove, below: Glyphs.articStaccatoBelow },
  tenuto: { above: Glyphs.articTenutoAbove, below: Glyphs.articTenutoBelow },
  marcato: { above: Glyphs.articMarcatoAbove, below: Glyphs.articMarcatoBelow },
  staccatissimo: { above: Glyphs.articStaccatissimoAbove, below: Glyphs.articStaccatissimoBelow },
  fermata: { above: Glyphs.fermataAbove, below: Glyphs.fermataBelow },
};
const ORNAMENT: Record<OrnamentType, string> = {
  trill: Glyphs.ornamentTrill,
  turn: Glyphs.ornamentTurn,
  // VexFlow's turnInverted alias selects the separate slashed-turn variant.
  'inverted-turn': Glyphs.ornamentTurnInverted,
  'upper-mordent': Glyphs.ornamentShortTrill,
  'lower-mordent': Glyphs.ornamentMordent,
};
const FIGURE_SHIFT = 4;

interface MarkingPart {
  readonly element: EngravingElement;
  readonly x: number;
  readonly y: number;
  readonly ink: InkBox;
}
interface MeasuredMarking {
  readonly parts: readonly MarkingPart[];
  readonly ink: InkBox;
}

function part(text: string, family: string, size: number, x = 0, y = 0): MarkingPart {
  const element = new EngravingElement().setFont(family, `${size}px`).setText(text);
  const metrics = element.getTextMetrics();
  return { element, x, y, ink: {
    x: x - metrics.actualBoundingBoxLeft, y: y - metrics.actualBoundingBoxAscent,
    width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
  } };
}

function measureMarking(marking: EventMarking, placement: MarkingPlacement): MeasuredMarking {
  if (marking.kind !== 'interval') {
    const glyph = marking.kind === 'articulation' ? ARTICULATION[marking.type][placement] : ORNAMENT[marking.type];
    const glyphPart = part(glyph, 'Bravura', 40);
    return { parts: [glyphPart], ink: glyphPart.ink };
  }
  const number = part(String(marking.interval.number), 'Academico', 12);
  const parts: MarkingPart[] = [];
  if (marking.interval.alter !== 0) {
    const accidental = part(marking.interval.alter < 0 ? Glyphs.accidentalFlat : Glyphs.accidentalSharp, 'Bravura', 22);
    // Align the painted centers, not the two fonts' unrelated baselines. A flat
    // prefixes the interval quality; it is not an accidental on the main pitch.
    const y = number.ink.y + number.ink.height / 2 - accidental.ink.y - accidental.ink.height / 2;
    parts.push(part(accidental.element.getText(), 'Bravura', 22, 0, y));
    parts.push(part(String(marking.interval.number), 'Academico', 12,
      accidental.ink.x + accidental.ink.width + 1.5 - number.ink.x));
  } else parts.push(number);
  return { parts, ink: unionInk(parts.map(item => item.ink))! };
}

/**
 * Add only the unreserved overhang to the formatter's modifier margins. Both
 * minimum-width calculation and final spacing consume these same metrics;
 * changing glyphWidth would instead distort heads, stems and voice displacement.
 */
export class MarkedStaveNote extends StaveNote {
  private markingWidth = 0;

  reserveMarkings(markings: readonly EventMarking[]): this {
    this.markingWidth = Math.max(0, ...markings.map(marking => {
      // The final stem can change during voice/beam formatting. A legacy side
      // on a standard symbol cannot constrain either its final side or width.
      const width = marking.kind === 'interval' ? measureMarking(marking, marking.placement).ink.width
        : Math.max(measureMarking(marking, 'above').ink.width, measureMarking(marking, 'below').ink.width);
      return width + (marking.kind === 'interval' ? FIGURE_SHIFT * 2 : 0) + 4;
    }));
    return this;
  }

  private markingPadding(): { left: number; right: number } {
    if (!this.markingWidth) return { left: 0, right: 0 };
    const overhang = Math.max(0, (this.markingWidth - this.getGlyphWidth()) / 2);
    const state = this.getModifierContext()?.getState();
    const leftHead = this.getLeftDisplacedHeadPx();
    const rightHead = this.getRightDisplacedHeadPx();
    const centerShift = this.getXShift() + (rightHead - leftHead) / 2;
    // Voice collision shifts occupy the shared modifier margin themselves;
    // they cannot also count as padding beyond that voice's shifted marking.
    return { left: Math.max(0, overhang - centerShift - (state?.leftShift ?? 0) - leftHead),
      right: Math.max(0, overhang + centerShift - (state?.rightShift ?? 0) - rightHead) };
  }

  override getWidth(): number {
    const padding = this.markingPadding();
    return super.getWidth() + padding.left + padding.right;
  }

  override getMetrics(): ReturnType<StaveNote['getMetrics']> {
    // The base implementation calls our virtual getWidth. Keep that extra
    // space in modifier margins, not in its derived notehead width.
    const metrics = super.getMetrics();
    const padding = this.markingPadding();
    return { ...metrics, notePx: metrics.notePx - padding.left - padding.right,
      modLeftPx: metrics.modLeftPx + padding.left, modRightPx: metrics.modRightPx + padding.right };
  }
}

/** Internal painted targets for every kind of head; these are not model pitches. */
export function printedHeadInk(note: StaveNote, group: SVGGElement, relativeTo: SVGGraphicsElement, eventId: string): readonly InkBox[] {
  const groups = new Map([...group.querySelectorAll<SVGGElement>('g.vf-notehead')].map(head => [head.id, head]));
  return note.noteHeads.map((head, index) => {
    // Resolve within the event's Shadow DOM subtree; engine document ID lookup
    // cannot find it. The first text is the head, excluding accidentals and dots.
    const glyph = groups.get(prefix(head.getAttribute('id')))?.firstElementChild;
    const ink = glyph?.localName === 'text' && glyph.textContent === head.getText()
      ? unionInk(visibleInk(glyph as SVGGraphicsElement, relativeTo)) : undefined;
    if (!ink) throw new Error(`No printed notehead could be located for head ${index + 1} of event ${eventId}.`);
    return ink;
  });
}

export interface MarkedEvent {
  readonly event: MusicEvent;
  readonly note: StaveNote;
  readonly group: SVGGElement;
  readonly context: SVGContext;
}

/** Draw after final stems/beams/ties/tuplets and rest recovery, before annotation lanes. */
export function drawEventMarkings(events: readonly MarkedEvent[], staffGroup: SVGGElement): void {
  const obstacles = visibleInk(staffGroup, staffGroup);
  // Beams draw their stems outside the event group. The public Stem ID connects
  // that painted stroke to its note without guessing from pitch or voice order.
  const stems = new Map([...staffGroup.querySelectorAll<SVGGElement>('g.vf-stem')].map(group => [group.id, group]));
  const requests = events.flatMap(drawn => {
    if (!drawn.event.markings?.length) return [];
    const head = unionInk(printedHeadInk(drawn.note, drawn.group, staffGroup, drawn.event.id))!;
    const engineStem = drawn.note.getStem();
    const stemGroup = engineStem && stems.get(prefix(engineStem.getAttribute('id')));
    // Whole values, rests and open slashes may retain a hidden engine stem.
    // Only actual ink establishes a stem; every stemless event resolves above.
    const stem = stemGroup && unionInk(visibleInk(stemGroup, staffGroup))
      ? drawn.note.getStemDirection() === Stem.UP ? 'up' : 'down' : 'none';
    return drawn.event.markings.map(marking => ({ drawn, marking, head, stem,
      placement: eventMarkingPlacement(marking, stem) }));
  }).sort((a, b) => eventMarkingOrder(a.marking) - eventMarkingOrder(b.marking));
  for (const { drawn, marking, head, stem, placement } of requests) {
    const measured = measureMarking(marking, placement);
    const stave = drawn.note.checkStave();
    const outside = marking.kind === 'ornament'
      || (marking.kind === 'articulation' && (marking.type === 'fermata' || marking.type === 'marcato'));
    const box = placeEventMarking({ head, placement, width: measured.ink.width, height: measured.ink.height,
      obstacles, ...(outside ? { outsideStaff: { top: stave.getYForLine(0), bottom: stave.getYForLine(stave.getNumLines() - 1) } } : {}),
      lateralShift: marking.kind === 'interval' ? FIGURE_SHIFT : 0, preferredShift: stem === 'down' ? 1 : -1 });
    const group = drawn.context.openGroup('music-marking');
    // VexFlow's SVG disables pointer events by default. Keep font character
    // cells inert: their em boxes are far larger than the painted symbols.
    group.setAttribute('pointer-events', 'none');
    group.dataset.sourceId = marking.id;
    group.dataset.eventId = drawn.event.id;
    group.dataset.kind = marking.kind;
    group.dataset.placement = placement;
    group.dataset.requestedPlacement = marking.placement;
    group.dataset.headX = String(head.x + head.width / 2);
    group.dataset.headY = String(head.y + head.height / 2);
    if (marking.kind !== 'interval') group.dataset.type = marking.type;
    else group.dataset.interval = `${marking.interval.alter < 0 ? 'b' : marking.interval.alter > 0 ? '#' : ''}${marking.interval.number}`;
    for (const item of measured.parts) item.element.renderText(drawn.context,
      box.x - measured.ink.x + item.x, box.y - measured.ink.y + item.y);
    drawn.context.closeGroup();
    drawn.group.append(group);
    // Read the actual SVG projection rather than assuming our font request was
    // honored. This also makes subsequent stacking use final painted metrics.
    const ink = unionInk(visibleInk(group, staffGroup));
    if (!ink) throw new Error(`No printed notation could be located for event marking ${marking.id}.`);
    obstacles.push(ink);
    const target = group.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
    // Geometry is local to the marking group so a later staff translation moves
    // its ink and hit together. These targets do not enter public event hits or
    // spacing, but the child source ID remains reachable by a real pointer.
    const localInk = unionInk(visibleInk(group, group))!;
    for (const [name, value] of Object.entries(localInk)) target.setAttribute(name, String(value));
    target.dataset.markingHit = '';
    target.setAttribute('opacity', '0');
    target.setAttribute('pointer-events', 'all');
    group.append(target);
  }
}
