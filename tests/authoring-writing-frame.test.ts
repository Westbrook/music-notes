// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WritingFrame } from '../src/authoring/writing-frame.js';
import type { WritingFrameOptions } from '../src/authoring/writing-frame.js';

const frames: WritingFrame[] = [];

function fixture(width = 1400, options: WritingFrameOptions = {}) {
  document.body.innerHTML = '<main id="parent"><div id="workbench"><section id="score-editor"><div id="score-host">accepted music</div></section><aside id="workspace-tools"><input value="retained draft"></aside></div></main>';
  const workbench = document.getElementById('workbench')!;
  let clientWidth = width;
  Object.defineProperty(workbench, 'clientWidth', { get: () => clientWidth });
  const frame = new WritingFrame(workbench, options);
  frames.push(frame);
  return { frame, workbench, resize: (next: number) => { clientWidth = next; } };
}

afterEach(() => {
  frames.splice(0).forEach(frame => frame.dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('WritingFrame independent paper width', () => {
  it('does not invent a measured paper width or spare space before the owner measures', () => {
    const { frame, workbench } = fixture();
    expect(frame.state).toEqual({ width: 0, availableWidth: 0, paneWidth: 320, gap: 16, paneFits: false, measured: false });
    expect(workbench.style.getPropertyValue('--writing-frame-width')).toBe('');
    expect(workbench.style.getPropertyValue('--tools-pane-width')).toBe('320px');
    expect(workbench.style.getPropertyValue('--writing-frame-gap')).toBe('16px');
  });

  it.each([1, 240, 390, 680, 960])('uses a positive %spx workbench for the outer paper without reserving pane width', width => {
    const { frame, workbench } = fixture(width);
    expect(frame.measure()).toEqual({ width, availableWidth: width, paneWidth: 320, gap: 16, paneFits: false, measured: true });
    expect(workbench.style.getPropertyValue('--writing-frame-width')).toBe(`${width}px`);
  });

  it.each([[1295, false], [1296, true], [1297, true], [2400, true]] as const)('caps paper at 960 and checks the actual side-pane threshold at %spx', (availableWidth, paneFits) => {
    const { frame } = fixture(availableWidth);
    expect(frame.measure()).toEqual({ width: 960, availableWidth, paneWidth: 320, gap: 16, paneFits, measured: true });
  });

  it('measures the workbench content box, excluding padding and ignoring border-box/transformed rectangles', () => {
    const { frame, workbench, resize } = fixture(1328);
    workbench.style.paddingInline = '16px';
    workbench.style.paddingLeft = '20px'; workbench.style.paddingRight = '12px';
    workbench.style.border = '10px solid black';
    const rect = vi.spyOn(workbench, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2500, 800));
    expect(frame.measure()).toMatchObject({ width: 960, availableWidth: 1296, paneFits: true });
    resize(1327);
    expect(frame.measure()).toMatchObject({ width: 960, availableWidth: 1295, paneFits: false });
    expect(rect).not.toHaveBeenCalled();
  });

  it('supports an explicitly configured comfortable width, usable pane, and gap', () => {
    const { frame, workbench, resize } = fixture(1284, { maxWidth: 900, paneWidth: 360, gap: 24 });
    expect(frame.measure()).toMatchObject({ width: 900, paneWidth: 360, gap: 24, paneFits: true });
    expect(workbench.style.getPropertyValue('--tools-pane-width')).toBe('360px');
    expect(workbench.style.getPropertyValue('--writing-frame-gap')).toBe('24px');
    resize(1283); expect(frame.measure().paneFits).toBe(false);
  });

  it('does not derive width from a resized, hidden, or scrolled score column when a task pane opens', () => {
    const { frame, workbench } = fixture();
    const first = frame.measure(), editor = document.getElementById('score-editor')!, score = document.getElementById('score-host')!;
    const source = score.innerHTML, field = workbench.querySelector<HTMLInputElement>('input')!;
    const fieldValue = field.value;
    editor.scrollLeft = 112; editor.scrollTop = 48;
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 600));
    vi.spyOn(score, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 420, 500));
    document.getElementById('workspace-tools')!.hidden = false;
    expect(frame.measure()).toEqual(first);
    editor.style.visibility = 'hidden'; editor.setAttribute('inert', '');
    expect(frame.measure()).toEqual(first);
    expect(workbench.style.getPropertyValue('--writing-frame-width')).toBe('960px');
    expect(score.innerHTML).toBe(source); expect(field.value).toBe(fieldValue);
    expect(editor.scrollLeft).toBe(112); expect(editor.scrollTop).toBe(48);
  });

  it('changes the chosen frame only when the owner measures or refits after workbench resizing', () => {
    const { frame, resize } = fixture(390);
    const first = frame.measure();
    resize(1600); window.dispatchEvent(new Event('resize'));
    expect(frame.state).toEqual(first);
    expect(frame.refit()).toMatchObject({ width: 960, availableWidth: 1600, paneFits: true });
    resize(980); expect(frame.measure()).toMatchObject({ width: 960, availableWidth: 980, paneFits: false });
    resize(360); expect(frame.refit()).toMatchObject({ width: 360, availableWidth: 360, paneFits: false });
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('retains all measured state for an invalid workbench reading %s', invalid => {
    const { frame, workbench, resize } = fixture();
    const first = frame.measure(), style = workbench.getAttribute('style');
    resize(invalid);
    expect(frame.measure()).toEqual(first);
    expect(workbench.getAttribute('style')).toBe(style);
  });

  it('keeps an initial zero or wholly padded measurement unknown until real space is available', () => {
    const { frame, workbench, resize } = fixture(0);
    expect(frame.measure()).toMatchObject({ width: 0, availableWidth: 0, paneFits: false, measured: false });
    resize(20); workbench.style.paddingLeft = '12px'; workbench.style.paddingRight = '12px';
    expect(frame.measure().measured).toBe(false);
    expect(workbench.style.getPropertyValue('--writing-frame-width')).toBe('');
    resize(1000);
    expect(frame.measure()).toMatchObject({ width: 960, availableWidth: 976, measured: true });
  });

  it.each(['hidden', 'display', 'visibility', 'detached'] as const)('retains the last writing frame while the workbench is %s', condition => {
    const { frame, workbench, resize } = fixture();
    const first = frame.measure(); resize(390);
    const parent = document.getElementById('parent')!;
    if (condition === 'hidden') parent.hidden = true;
    if (condition === 'display') parent.style.display = 'none';
    if (condition === 'visibility') parent.style.visibility = 'hidden';
    if (condition === 'detached') workbench.remove();
    expect(frame.measure()).toEqual(first);
    expect(workbench.style.getPropertyValue('--writing-frame-width')).toBe('960px');
  });

  it('returns defensive state copies and becomes inert after disposal', () => {
    const { frame, workbench, resize } = fixture();
    const first = frame.measure();
    (first as { width: number }).width = 1;
    expect(frame.state.width).toBe(960);
    const retained = frame.state, style = workbench.getAttribute('style');
    frame.dispose(); frame.dispose(); resize(390);
    expect(frame.measure()).toEqual(retained); expect(frame.refit()).toEqual(retained);
    expect(workbench.getAttribute('style')).toBe(style);
  });

  it.each([
    { maxWidth: 0 }, { maxWidth: -1 }, { maxWidth: Number.NaN }, { maxWidth: Number.POSITIVE_INFINITY },
    { paneWidth: 0 }, { paneWidth: -1 }, { paneWidth: Number.NaN }, { paneWidth: Number.POSITIVE_INFINITY },
    { gap: -1 }, { gap: Number.NaN }, { gap: Number.POSITIVE_INFINITY },
  ])('rejects invalid frame policy %j before publishing it', options => {
    const element = document.createElement('div'); document.body.append(element);
    expect(() => new WritingFrame(element, options)).toThrow(RangeError);
    expect(element.getAttribute('style')).toBeNull();
  });

  it('allows an explicitly zero gap without making a pane fit early', () => {
    const { frame, resize } = fixture(1280, { gap: 0 });
    expect(frame.measure().paneFits).toBe(true);
    resize(1279); expect(frame.measure().paneFits).toBe(false);
  });
});
