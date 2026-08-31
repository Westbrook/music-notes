import { Accidental, Dot, Formatter, Renderer, Stave, StaveNote, Stem, SVGContext, prefix } from 'vexflow/bravura';
import { durationTime, pitchText, validateClef } from '../model/index.js';
import type { Clef, Duration, Pitch, Staff, StemDirection } from '../model/types.js';
import { unionInk, visibleInk } from './geometry.js';
import { accidentalType } from './semantics.js';

export interface PitchPreviewOptions {
  readonly pitch: Pitch;
  readonly duration: Duration;
  readonly dots: number;
  readonly stem: StemDirection;
  readonly clef: Clef;
}

export interface PitchPreview {
  /** Detached, transparent SVG with a normalized 0 0 width height viewBox. */
  readonly svg: SVGSVGElement;
  /** Painted notehead center, in the returned SVG's own viewBox coordinates. */
  readonly headX: number;
  readonly headY: number;
}

/**
 * Engrave one real, unbound note for a pointer preview. Call after a surface's
 * renderComplete has loaded Bravura; this function never waits for fonts or
 * changes musical source. Callers can cache and clone the detached result.
 * All accidentals, including naturals, are explicit so the pending spelling is
 * visible independently of the score's key or preceding accidental state.
 */
export function createPitchPreview(options: PitchPreviewOptions): PitchPreview {
  const spelling = pitchText(options.pitch);
  const clef = validateClef(options.clef);
  const written = durationTime(options.duration);
  durationTime(options.duration, options.dots);
  if (!['auto', 'up', 'down'].includes(options.stem)) throw new RangeError('Preview stem must be auto, up, or down.');
  if (!document.fonts?.check('40px Bravura')) throw new Error('Wait for notation fonts before creating a pitch preview.');
  if (!document.body) throw new Error('Pitch previews require a connected document body.');

  const host = document.createElement('div');
  host.dataset.musicPointerMeasuring = '';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:512px;height:512px;visibility:hidden;pointer-events:none;contain:layout style';
  document.body.append(host);
  try {
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    const context = renderer.getContext() as SVGContext;
    context.setFillStyle('#111').setStrokeStyle('#111');
    renderer.resize(512, 512);
    const stave = new Stave(0, 0, 200).setContext(context);
    const pitch = options.pitch;
    const note = new StaveNote({
      // VexFlow's key supplies only the diatonic position. The modifier below
      // carries the complete alteration, including half-semitone spellings.
      clef, keys: [`${pitch.step.toLowerCase()}/${pitch.octave}`],
      duration: written.numerator === 2 ? '1/2' : String(written.denominator),
      dots: options.dots, type: 'n', autoStem: options.stem === 'auto',
      stemDirection: options.stem === 'auto' ? undefined : options.stem === 'up' ? Stem.UP : Stem.DOWN,
    }).setStave(stave);
    const type = accidentalType(pitch.alter);
    if (type === undefined) throw new RangeError('The pitch alteration has no supported accidental glyph.');
    const accidental = new Accidental(type);
    if (pitch.display === 'courtesy') accidental.setAsCautionary();
    note.addModifier(accidental, 0);
    for (let dot = 0; dot < options.dots; dot++) Dot.buildAndAttach([note], { all: true });
    // This formats and draws only the voice. The stave is a coordinate context;
    // it is never drawn, so its staff, clef and barlines cannot enter the ghost.
    Formatter.FormatAndDraw(context, stave, [note], { autoBeam: false, alignRests: false });
    const svg = context.svg;
    svg.querySelectorAll('rect[opacity="0"]').forEach(rect => rect.remove());
    const headId = prefix(note.noteHeads[0].getAttribute('id'));
    const headGroup = [...svg.querySelectorAll<SVGGElement>('g.vf-notehead')].find(group => group.id === headId);
    // NoteHead.draw puts its own glyph before the accidental and dot glyphs.
    const glyph = headGroup?.firstElementChild;
    const head = glyph?.localName === 'text'
      ? unionInk(visibleInk(glyph as SVGGraphicsElement, svg)) : undefined;
    const ink = unionInk(visibleInk(svg));
    if (!head || !ink) throw new Error('The pitch preview has no measurable notation ink.');

    const left = Math.floor(ink.x) - 2;
    const top = Math.floor(ink.y) - 2;
    const width = Math.ceil(ink.x + ink.width) + 2 - left;
    const height = Math.ceil(ink.y + ink.height) + 2 - top;
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    drawing.setAttribute('transform', `translate(${-left} ${-top})`);
    drawing.append(...svg.childNodes);
    svg.append(drawing);
    renderer.resize(width, height);
    context.setViewBox(0, 0, width, height);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    svg.style.background = 'transparent';
    svg.dataset.pitchPreview = spelling;
    // Cached clones are not source projections and must not duplicate engine IDs.
    svg.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    svg.remove();
    return { svg, headX: head.x + head.width / 2 - left, headY: head.y + head.height / 2 - top };
  } finally {
    host.remove();
  }
}

export interface RestPreviewOptions {
  readonly duration: Duration;
  readonly dots: number;
  readonly clef: Clef;
  readonly notation?: Staff['notation'];
}

export interface RestPreview {
  /** Detached, transparent SVG with a normalized 0 0 width height viewBox. */
  readonly svg: SVGSVGElement;
  /** Engine onset reference, in the returned SVG's own viewBox coordinates. */
  readonly anchorX: number;
  /** Virtual staff center, not glyph center; it may fall outside the ink crop. */
  readonly anchorY: number;
}

/**
 * Engrave one ordinary written rest, never a meter-filling full-measure rest.
 * Call after renderComplete has loaded Bravura, and align anchorY with the
 * published staff center rather than the pointer's vertical position. The
 * invisible five-line stave supplies a common coordinate system for every
 * notation: reduced staves place their rest on its middle line, just as the
 * score renderer does. Nothing from that stave is drawn into the preview.
 * Callers may keep a bounded cache and clone the detached SVG.
 */
export function createRestPreview(options: RestPreviewOptions): RestPreview {
  const clef = validateClef(options.clef);
  const written = durationTime(options.duration);
  durationTime(options.duration, options.dots);
  const notation = options.notation === undefined ? 'pitched' : options.notation;
  if (!['pitched', 'rhythm', 'three-roads'].includes(notation)) {
    throw new RangeError('Preview notation must be pitched, rhythm, or three-roads.');
  }
  if (!document.fonts?.check('40px Bravura')) throw new Error('Wait for notation fonts before creating a rest preview.');
  if (!document.body) throw new Error('Rest previews require a connected document body.');

  const host = document.createElement('div');
  host.dataset.musicPointerMeasuring = '';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:512px;height:512px;visibility:hidden;pointer-events:none;contain:layout style';
  document.body.append(host);
  try {
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    const context = renderer.getContext() as SVGContext;
    context.setFillStyle('#111').setStrokeStyle('#111');
    renderer.resize(512, 512);
    const stave = new Stave(0, 0, 200).setContext(context);
    const note = new StaveNote({
      clef, keys: ['r/4'], type: 'r',
      duration: written.numerator === 2 ? '1/2' : String(written.denominator),
      dots: options.dots,
    });
    // Whole rests retain their conventional fourth-line position on pitched
    // staves. Rhythm and three-roads use the visible middle line for all rests.
    if (notation !== 'pitched') note.setKeyLine(0, 3);
    note.setStave(stave);
    for (let dot = 0; dot < options.dots; dot++) Dot.buildAndAttach([note], { all: true });
    Formatter.FormatAndDraw(context, stave, [note], { autoBeam: false, alignRests: false });
    const svg = context.svg;
    svg.querySelectorAll('rect[opacity="0"]').forEach(rect => rect.remove());
    const ink = unionInk(visibleInk(svg));
    const onsetX = note.getAbsoluteX();
    const centerY = stave.getYForNote(3);
    if (!ink || ink.width <= 0 || ink.height <= 0 ||
      ![ink.x, ink.y, ink.width, ink.height, onsetX, centerY].every(Number.isFinite)) {
      throw new Error('The rest preview has no measurable notation ink.');
    }

    const left = Math.floor(ink.x) - 2;
    const top = Math.floor(ink.y) - 2;
    const width = Math.ceil(ink.x + ink.width) + 2 - left;
    const height = Math.ceil(ink.y + ink.height) + 2 - top;
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    drawing.setAttribute('transform', `translate(${-left} ${-top})`);
    drawing.append(...svg.childNodes);
    svg.append(drawing);
    renderer.resize(width, height);
    context.setViewBox(0, 0, width, height);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    svg.style.background = 'transparent';
    svg.dataset.restPreview = options.duration;
    svg.removeAttribute('id');
    svg.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    svg.remove();
    return { svg, anchorX: onsetX - left, anchorY: centerY - top };
  } finally {
    host.remove();
  }
}
