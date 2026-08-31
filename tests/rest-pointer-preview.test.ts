// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VexFlow, { Dot, Element as EngravingElement, Formatter, Renderer, Stave } from 'vexflow/bravura';
import { createRestPreview } from '../src/engraving/pointer-preview.js';
import type { RestPreviewOptions } from '../src/engraving/pointer-preview.js';
import { durationTime } from '../src/model/index.js';
import type { Clef, Duration, Staff } from '../src/model/types.js';

const measurement = vi.hoisted(() => ({
  boxes: undefined as undefined | { x: number; y: number; width: number; height: number }[],
}));

// Real pinned VexFlow builds and formats every note and SVG glyph below. Only
// font ink measurement uses fixed metrics because happy-dom lacks native SVG
// and Bravura text measurement. These are adapter tests, not visual proof.
vi.mock('../src/engraving/geometry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/engraving/geometry.js')>();
  return { ...actual, visibleInk: (root: SVGGraphicsElement) => measurement.boxes ??
    [...root.querySelectorAll('text')].filter(leaf => leaf.textContent).map(leaf => ({
      x: Number(leaf.getAttribute('x')) - 1,
      y: Number(leaf.getAttribute('y')) - 8,
      width: leaf.textContent!.length * 8,
      height: 10,
    })) };
});

const defaults: RestPreviewOptions = { clef: 'treble', duration: 'quarter', dots: 0 };
const durations: readonly Duration[] = ['breve', 'whole', 'half', 'quarter', 'eighth',
  'sixteenth', 'thirty-second', 'sixty-fourth', '128th'];
const notations: readonly Staff['notation'][] = ['pitched', 'rhythm', 'three-roads'];
const glyphs: Readonly<Record<Duration, string>> = {
  breve: VexFlow.Glyphs.restDoubleWhole, whole: VexFlow.Glyphs.restWhole,
  half: VexFlow.Glyphs.restHalf, quarter: VexFlow.Glyphs.restQuarter,
  eighth: VexFlow.Glyphs.rest8th, sixteenth: VexFlow.Glyphs.rest16th,
  'thirty-second': VexFlow.Glyphs.rest32nd, 'sixty-fourth': VexFlow.Glyphs.rest64th,
  '128th': VexFlow.Glyphs.rest128th,
};
const dotSpaces: Readonly<Record<Duration, number>> = {
  breve: 0.5, whole: 0.5, half: -0.5, quarter: -0.5, eighth: -0.5,
  sixteenth: -0.5, 'thirty-second': -1.5, 'sixty-fourth': -1.5, '128th': -2.5,
};

beforeEach(() => {
  measurement.boxes = undefined;
  document.body.innerHTML = '<main id="accepted">Accepted music stays untouched.</main>';
  Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => true } });
  const context = { font: '', measureText: (text: string) => ({
    width: text.length * 8, actualBoundingBoxLeft: text ? 1 : 0,
    actualBoundingBoxRight: text ? text.length * 8 - 1 : 0,
    actualBoundingBoxAscent: text ? 8 : 0, actualBoundingBoxDescent: text ? 2 : 0,
    fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2,
    alphabeticBaseline: 0, emHeightAscent: 8, emHeightDescent: 2,
    hangingBaseline: 0, ideographicBaseline: 0,
  }) };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(EngravingElement, 'getTextMeasurementCanvas').mockReturnValue(canvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fonts');
  document.body.replaceChildren();
});

function translation(svg: SVGSVGElement): readonly [number, number] {
  const match = /^translate\(([-\d.]+) ([-\d.]+)\)$/.exec(svg.firstElementChild!.getAttribute('transform')!);
  expect(match).not.toBeNull();
  return [Number(match![1]), Number(match![2])];
}

describe('ordinary rest preview boundary', () => {
  it.each([
    [{ duration: 'third' }, 'Unsupported duration'],
    [{ duration: 'measure' }, 'Unsupported duration'],
    [{ dots: -1 }, 'Dots must'],
    [{ dots: 4 }, 'Dots must'],
    [{ dots: 0.5 }, 'Dots must'],
    [{ dots: Number.NaN }, 'Dots must'],
    [{ clef: 'percussion' }, 'Unsupported clef'],
    [{ notation: 'tablature' }, 'Preview notation'],
    [{ notation: null }, 'Preview notation'],
  ])('rejects unsupported input %j before mounting measurement DOM', (invalid, message) => {
    const before = document.body.innerHTML;
    const append = vi.spyOn(document.body, 'append');
    expect(() => createRestPreview({ ...defaults, ...invalid } as RestPreviewOptions)).toThrow(message);
    expect(append).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
  });

  it.each([false, undefined])('requires loaded Bravura when font readiness is %s', readiness => {
    const before = document.body.innerHTML;
    if (readiness === undefined) Reflect.deleteProperty(document, 'fonts');
    else Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => readiness } });
    expect(() => createRestPreview(defaults)).toThrow('Wait for notation fonts');
    expect(document.body.innerHTML).toBe(before);
  });

  it('requires a connected document body', () => {
    const body = document.body;
    body.remove();
    try { expect(() => createRestPreview(defaults)).toThrow('connected document body'); }
    finally { document.documentElement.append(body); }
  });

  it('cleans up measurement DOM if engine preparation fails', () => {
    const before = document.body.innerHTML;
    vi.spyOn(Renderer.prototype, 'getContext').mockImplementationOnce(() => { throw new Error('Measurement unavailable.'); });
    expect(() => createRestPreview(Object.freeze({ ...defaults }))).toThrow('Measurement unavailable.');
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('[data-music-pointer-measuring]')).toBeNull();
  });

  it.each([
    [],
    [{ x: Number.NaN, y: 0, width: 10, height: 10 }],
    [{ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }],
    [{ x: 0, y: 0, width: 0, height: 10 }],
  ].map(boxes => ({ boxes })))('refuses unmeasurable or invalid ink $boxes and cleans up', ({ boxes }) => {
    const before = document.body.innerHTML;
    measurement.boxes = boxes;
    expect(() => createRestPreview(defaults)).toThrow('measurable notation ink');
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector('[data-music-pointer-measuring]')).toBeNull();
  });
});

describe('real rest engraving with fixed measurement boundaries', () => {
  it.each(durations.flatMap(duration => notations.flatMap(notation => [0, 1, 2, 3].map(dots => ({ duration, notation, dots })))))
  ('draws $duration with $dots dots on $notation using the actual rest glyph', options => {
    const before = document.body.innerHTML;
    const format = vi.spyOn(Formatter, 'FormatAndDraw');
    const drawStave = vi.spyOn(Stave.prototype, 'draw');
    const preview = createRestPreview(Object.freeze({ ...defaults, ...options }));
    expect(format).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.any(Stave), expect.any(Array),
      { autoBeam: false, alignRests: false });
    expect(drawStave).not.toHaveBeenCalled();
    const [, stave, notes] = format.mock.calls[0];
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.isRest()).toBe(true);
    expect(note.getKeys()).toEqual(['r/4']);
    expect(note.isCenterAligned()).toBe(false);
    const written = durationTime(options.duration, options.dots);
    expect(note.getTicks().value()).toBe(VexFlow.RESOLUTION * written.numerator / written.denominator);
    expect(Dot.getDots(note)).toHaveLength(options.dots);
    const glyphNodes = [...preview.svg.querySelectorAll('text')].filter(leaf => leaf.textContent);
    const text = glyphNodes.map(leaf => leaf.textContent);
    expect(text).toEqual([glyphs[options.duration], ...Array<string>(options.dots).fill(VexFlow.Glyphs.augmentationDot)]);
    expect(preview.svg.querySelector('path,line,circle,ellipse,rect,polygon,polyline')).toBeNull();
    expect(preview.svg.querySelector('g.vf-stave,g.vf-clef,g.vf-stavebarline,g.vf-keysignature,g.vf-timesignature,g.vf-accidental')).toBeNull();
    const [tx, ty] = translation(preview.svg);
    expect(preview.anchorX).toBe(note.getAbsoluteX() + tx);
    const center = (stave.getYForLine(0) + stave.getYForLine(stave.getNumLines() - 1)) / 2;
    expect(preview.anchorY).toBe(center + ty);
    const restOffset = options.notation === 'pitched' && options.duration === 'whole' ? -10 : 0;
    expect(note.getYs()[0] - center).toBe(restOffset);
    for (const dot of glyphNodes.slice(1)) {
      expect(Number(dot.getAttribute('y')) - center).toBe(restOffset + dotSpaces[options.duration] * stave.getSpacingBetweenLines());
    }
    expect(document.body.innerHTML).toBe(before);
    expect(preview.svg.isConnected).toBe(false);
    expect(document.querySelector('[data-music-pointer-measuring]')).toBeNull();
  });

  it.each((['treble', 'bass', 'alto', 'tenor'] as readonly Clef[]).flatMap(clef => notations.map(notation => ({ clef, notation }))))
  ('retains conventional rest coordinates under $clef clef on $notation', options => {
    const format = vi.spyOn(Formatter, 'FormatAndDraw');
    const preview = createRestPreview({ ...defaults, ...options, duration: 'whole' });
    const [, stave, notes] = format.mock.calls[0];
    const [tx, ty] = translation(preview.svg);
    expect(preview.anchorX).toBe(notes[0].getAbsoluteX() + tx);
    expect(preview.anchorY).toBe(stave.getYForNote(3) + ty);
    expect(notes[0].getYs()[0] + ty - preview.anchorY).toBe(options.notation === 'pitched' ? -10 : 0);
  });

  it('defaults omitted notation to a five-line pitched staff', () => {
    const format = vi.spyOn(Formatter, 'FormatAndDraw');
    const preview = createRestPreview({ ...defaults, duration: 'whole' });
    const [, stave, notes] = format.mock.calls[0];
    const [, ty] = translation(preview.svg);
    expect(stave.getNumLines()).toBe(5);
    expect(notes[0].getYs()[0] + ty - preview.anchorY).toBe(-10);
  });

  it('returns transparent cropped SVG without engine IDs, ready for independent caller clones', () => {
    const preview = createRestPreview({ ...defaults, dots: 3 });
    const [tx, ty] = translation(preview.svg);
    const boxes = [...preview.svg.querySelectorAll('text')].filter(leaf => leaf.textContent).map(leaf => ({
      left: Number(leaf.getAttribute('x')) - 1 + tx, top: Number(leaf.getAttribute('y')) - 8 + ty,
      right: Number(leaf.getAttribute('x')) + leaf.textContent!.length * 8 - 1 + tx,
      bottom: Number(leaf.getAttribute('y')) + 2 + ty,
    }));
    const width = Number(preview.svg.getAttribute('width'));
    const height = Number(preview.svg.getAttribute('height'));
    expect(preview.svg.getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(2);
      expect(box.top).toBeGreaterThanOrEqual(2);
      expect(box.right).toBeLessThanOrEqual(width - 2);
      expect(box.bottom).toBeLessThanOrEqual(height - 2);
    }
    expect(preview.svg.getAttribute('aria-hidden')).toBe('true');
    expect(preview.svg.getAttribute('focusable')).toBe('false');
    expect(preview.svg.style.pointerEvents).toBe('none');
    expect(preview.svg.style.background).toBe('transparent');
    expect(preview.svg.dataset.restPreview).toBe('quarter');
    expect(preview.svg.hasAttribute('id')).toBe(false);
    expect(preview.svg.querySelector('[id]')).toBeNull();
    const copy = preview.svg.cloneNode(true) as SVGSVGElement;
    expect(copy.outerHTML).toBe(preview.svg.outerHTML);
    copy.dataset.restPreview = 'independent';
    expect(preview.svg.dataset.restPreview).toBe('quarter');
  });

  it('anchors to the staff rather than the measured rest center', () => {
    const preview = createRestPreview({ ...defaults, duration: 'whole' });
    const height = Number(preview.svg.getAttribute('height'));
    expect(preview.anchorY).not.toBe(height / 2);
    // A small whole-rest crop can exclude the virtual staff center. Keeping that
    // reference outside the ink is necessary to hang the preview on line four.
    expect(preview.anchorY).toBeGreaterThan(height);
  });
});
