// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from 'vexflow/bravura';
import { createPitchPreview } from '../src/engraving/pointer-preview.js';
import type { PitchPreviewOptions } from '../src/engraving/pointer-preview.js';
import { parsePitch } from '../src/model/index.js';

const options: PitchPreviewOptions = {
  pitch: parsePitch('F#4'), clef: 'treble', duration: 'quarter', dots: 0, stem: 'auto',
};

beforeEach(() => { document.body.innerHTML = '<main id="accepted">Accepted music stays untouched.</main>'; });
afterEach(() => { Reflect.deleteProperty(document, 'fonts'); document.body.replaceChildren(); });

describe('single-note preview boundary', () => {
  it.each([
    { pitch: { ...options.pitch, step: 'H' } },
    { pitch: { ...options.pitch, octave: 10 } },
    { pitch: { ...options.pitch, alter: 3 } },
    { clef: 'percussion' },
    { duration: 'third' },
    { dots: -1 },
    { dots: 4 },
    { dots: Number.NaN },
    { stem: 'sideways' },
  ])('rejects unsupported input %j before mounting any measurement DOM', invalid => {
    const source = document.body.innerHTML;
    expect(() => createPitchPreview({ ...options, ...invalid } as PitchPreviewOptions)).toThrow();
    expect(document.body.innerHTML).toBe(source);
    expect(document.querySelector('[data-music-pointer-measuring]')).toBeNull();
  });

  it('requires prepared notation fonts instead of silently using a substitute glyph', () => {
    const source = document.body.innerHTML;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => false } });
    expect(() => createPitchPreview(options)).toThrow('Wait for notation fonts');
    expect(document.body.innerHTML).toBe(source);
  });

  it('removes the measurement host even if SVG preparation fails', () => {
    const source = document.body.innerHTML;
    Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => true } });
    vi.spyOn(Renderer.prototype, 'getContext').mockImplementationOnce(() => { throw new Error('Measurement unavailable.'); });
    expect(() => createPitchPreview(Object.freeze({ ...options, pitch: Object.freeze({ ...options.pitch }) })))
      .toThrow('Measurement unavailable.');
    expect(document.body.innerHTML).toBe(source);
    expect(document.querySelector('[data-music-pointer-measuring]')).toBeNull();
  });
});
