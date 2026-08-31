// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Element as EngravingElement, Formatter, StaveNote, Stem, Voice as EngravedVoice } from 'vexflow/bravura';
import { readScore } from '../src/dom/index.js';
import { renderScore } from '../src/engraving/render.js';
import { rational } from '../src/model/index.js';
import type { Score } from '../src/model/types.js';

// This local adapter test uses the real pinned engine for tickables, formatting,
// and SVG construction. Fixed text metrics/painted bounds stand in for the font
// and SVG measurement APIs absent from happy-dom; they do not qualify native ink.
vi.mock('../src/engraving/geometry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/engraving/geometry.js')>();
  return { ...actual, visibleInk: (root: SVGGraphicsElement) => {
    const leaf = root.matches('text,path,rect,line,circle,ellipse,polygon,polyline')
      ? root : root.querySelector('text,path,rect,line,circle,ellipse,polygon,polyline');
    return leaf ? [{ x: 0, y: 0, width: 100, height: 60 }] : [];
  } };
});

function model(html: string): { source: Element; score: Score } {
  const template = document.createElement('template');
  template.innerHTML = html;
  const source = template.content.firstElementChild!;
  const result = readScore(source);
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  return { source, score: result.score };
}

function render(score: Score) {
  const container = document.createElement('div');
  document.body.append(container);
  return { container, ...renderScore(container, score, { width: 900, measureNumbers: 'none' }) };
}

const notes = (prefix = 'n', stem = 'up') => ['C4', 'D4', 'E4', 'F4'].map((pitch, index) =>
  `<music-note id="${prefix}${index}" pitch="${pitch}" duration="quarter" stem="${stem}"></music-note>`).join('');
const emptyVoice = '<music-voice id="empty"></music-voice>';
const fullVoice = (stem = 'up') => `<music-voice id="written">${notes('n', stem)}</music-voice>`;
const staff = (content: string, id = 'staff') => `<music-staff id="${id}"><music-measure id="${id}-bar" incomplete>${content}</music-measure></music-staff>`;

beforeEach(() => {
  document.body.replaceChildren();
  const context = { font: '', measureText: (text: string) => ({
    width: text.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 8,
    actualBoundingBoxAscent: text ? 8 : 0, actualBoundingBoxDescent: text ? 2 : 0,
    fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2,
    alphabeticBaseline: 0, emHeightAscent: 8, emHeightDescent: 2, hangingBaseline: 0, ideographicBaseline: 0,
  }) };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(EngravingElement, 'getTextMeasurementCanvas').mockReturnValue(canvas);
});

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('empty draft rendering with fixed measurement boundaries', () => {
  it.each([
    ['implicit', ''],
    ['explicit', emptyVoice],
    ['two explicit', `${emptyVoice}<music-voice id="other-empty"></music-voice>`],
  ])('draws an all-empty %s bar with context and one original anchor per voice', (_, voices) => {
    const fixture = model(`<music-staff id="staff" key="Eb"><music-measure id="bar" meter="3/4" incomplete end-bar="double">${voices}</music-measure></music-staff>`);
    const before = fixture.source.outerHTML;
    const modelBefore = JSON.stringify(fixture.score);
    const joined = vi.spyOn(Formatter.prototype, 'joinVoices');
    const minimum = vi.spyOn(Formatter.prototype, 'preCalculateMinTotalWidth');
    const formatted = vi.spyOn(Formatter.prototype, 'format');
    const added = vi.spyOn(EngravedVoice.prototype, 'addTickables');
    const result = render(fixture.score);
    expect(result.systems).toHaveLength(1);
    expect(result.hitRegions).toEqual([]);
    expect(result.systemGeometry![0].events).toEqual([]);
    expect(result.container.querySelectorAll('g.vf-music-event')).toHaveLength(0);
    expect(result.container.querySelector('g.vf-music-staff path')).not.toBeNull();
    expect(result.container.querySelectorAll('g.vf-music-staff text').length).toBeGreaterThan(0);
    for (const kind of ['stavebarline', 'clef', 'keysignature', 'timesignature']) {
      expect(result.container.querySelector(`g.vf-${kind}`)).not.toBeNull();
    }
    expect(joined.mock.calls.length).toBe(0);
    expect(minimum.mock.calls.length).toBe(0);
    expect(formatted.mock.calls.length).toBe(0);
    expect(added.mock.calls.length).toBeGreaterThan(0);
    expect(added.mock.calls.every(([tickables]) => tickables.length === 0)).toBe(true);
    const geometry = result.systemGeometry![0];
    expect(geometry.staves.map(value => value.sourceId)).toEqual(['staff']);
    expect(geometry.measures.map(value => value.sourceId)).toEqual(['bar']);
    expect(geometry.anchors).toHaveLength(fixture.score.staves[0].measures[0].voices.length);
    geometry.anchors.forEach((anchor, index) => {
      expect(anchor).toMatchObject({ sourceId: fixture.score.staves[0].measures[0].voices[index].id,
        voiceId: fixture.score.staves[0].measures[0].voices[index].id, measureId: 'bar', staffId: 'staff',
        eventIndex: 0, onset: rational(0) });
      expect(anchor).not.toHaveProperty('beforeId');
      expect(anchor).not.toHaveProperty('afterId');
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(anchor.x).toBeGreaterThan(geometry.measures[0].noteStartX);
      expect(anchor.x).toBeLessThan(geometry.measures[0].noteEndX);
    });
    expect([geometry.width, geometry.height, geometry.staves[0].height, geometry.measures[0].width].every(Number.isFinite)).toBe(true);
    expect(fixture.source.outerHTML).toBe(before);
    expect(JSON.stringify(fixture.score)).toBe(modelBefore);
  });

  it.each([0, 1])('excludes empty engine voice %s from formatting without changing the sounding timeline', emptyIndex => {
    const baseline = render(model(staff(fullVoice())).score);
    const contents = emptyIndex === 0 ? emptyVoice + fullVoice() : fullVoice() + emptyVoice;
    const fixture = model(staff(contents));
    const before = JSON.stringify(fixture.score);
    const joined = vi.spyOn(Formatter.prototype, 'joinVoices');
    const minimum = vi.spyOn(Formatter.prototype, 'preCalculateMinTotalWidth');
    const formatted = vi.spyOn(Formatter.prototype, 'format');
    const result = render(fixture.score);
    expect(result.systems).toEqual(baseline.systems);
    expect(result.systemGeometry![0].events.map(event => [event.sourceId, event.onset, event.anchorX]))
      .toEqual(baseline.systemGeometry![0].events.map(event => [event.sourceId, event.onset, event.anchorX]));
    for (const spy of [joined, minimum, formatted]) {
      expect(spy).toHaveBeenCalled();
      for (const [voices] of spy.mock.calls) {
        expect(voices).toHaveLength(1);
        expect(voices[0].getTickables()).toHaveLength(4);
      }
    }
    const geometry = result.systemGeometry![0];
    const anchor = geometry.anchors.find(item => item.voiceId === 'empty')!;
    expect(anchor).toMatchObject({ sourceId: 'empty', eventIndex: 0, onset: rational(0) });
    expect(anchor.x).toBe(geometry.events[0].anchorX);
    expect(geometry.events.every(event => event.voiceId === 'written')).toBe(true);
    expect(result.container.querySelectorAll('g.vf-music-event')).toHaveLength(4);
    expect(JSON.stringify(fixture.score)).toBe(before);
  });

  it.each([0, 1])('preserves model voice indices and automatic stems with empty voice at index %s', emptyIndex => {
    const drawnDirections: number[] = [];
    const original = StaveNote.prototype.draw;
    vi.spyOn(StaveNote.prototype, 'draw').mockImplementation(function (this: StaveNote) {
      drawnDirections.push(this.getStemDirection());
      return original.call(this);
    });
    const content = emptyIndex === 0 ? emptyVoice + fullVoice('auto') : fullVoice('auto') + emptyVoice;
    render(model(staff(content)).score);
    expect(drawnDirections).toEqual(Array(4).fill(emptyIndex === 0 ? Stem.DOWN : Stem.UP));
  });

  it.each([0, 1])('retains an entirely blank staff at index %s alongside a sounding staff without adding spacing', blankIndex => {
    const baseline = render(model(staff(fullVoice(), 'written-staff')).score);
    const content = [staff(fullVoice(), 'written-staff')];
    content.splice(blankIndex, 0, staff(emptyVoice, 'empty-staff'));
    const fixture = model(`<music-system id="score">${content.join('')}</music-system>`);
    const result = render(fixture.score);
    expect(result.systems).toEqual(baseline.systems);
    const geometry = result.systemGeometry![0];
    expect(geometry.staves.map(item => item.sourceId)).toEqual(fixture.score.staves.map(item => item.id));
    expect(geometry.measures).toHaveLength(2);
    expect(geometry.events.map(item => item.anchorX)).toEqual(baseline.systemGeometry![0].events.map(item => item.anchorX));
    expect(geometry.events.every(item => item.staffId === 'written-staff')).toBe(true);
    const anchor = geometry.anchors.find(item => item.voiceId === 'empty')!;
    expect(anchor).toMatchObject({ staffId: 'empty-staff', measureId: 'empty-staff-bar', sourceId: 'empty', eventIndex: 0, onset: rational(0) });
    expect(anchor.x).toBe(geometry.events[0].anchorX);
    const blank = result.container.querySelector('g.vf-music-staff[data-staff-id="empty-staff"]')!;
    expect(blank.querySelector('path')).not.toBeNull();
    expect(blank.querySelector('g.vf-music-event')).toBeNull();
    expect(fixture.source.querySelectorAll('music-rest')).toHaveLength(0);
  });
});
