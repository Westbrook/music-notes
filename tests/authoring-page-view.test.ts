// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Score, StaffNotation } from '../src/model/types.js';
import type { InkBox } from '../src/engraving/geometry.js';

const mocks = vi.hoisted(() => ({ ready: vi.fn(), render: vi.fn(), ink: vi.fn() }));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: mocks.ready, renderScore: mocks.render }));
vi.mock('../src/engraving/geometry.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/engraving/geometry.js')>(), visibleInk: mocks.ink,
}));

import { inspectPageContainment, renderPageView, updatePagePreflight } from '../src/authoring/page-view.js';
import { createProject } from '../src/authoring/project.js';
import { CSS_PIXELS_PER_MM } from '../src/authoring/pages.js';

const source = `<music-staff id="staff" label="Piano">
  <music-measure id="m1"><music-rest id="r1" measure></music-rest></music-measure>
  <music-measure id="m2"><music-rest id="r2" measure></music-rest></music-measure>
</music-staff>`;
function project() { return createProject(source, 'Paper test', [{ id: 'piano', label: 'Piano', staffIds: ['staff'] }]); }
function notationProject(notations: readonly StaffNotation[]) {
  const staves = notations.map((notation, index) => `<music-staff id="staff-${index}"${notation === 'pitched' ? '' : ` notation="${notation}"`}>
    <music-measure id="m-${index}-1"><music-rest id="r-${index}-1" measure></music-rest></music-measure>
    <music-measure id="m-${index}-2"><music-rest id="r-${index}-2" measure></music-rest></music-measure>
  </music-staff>`).join('\n');
  return createProject(`<music-system>${staves}</music-system>`, 'Notation headings', notations.map((_, index) => ({
    id: `voice-${index}`, label: `Voice ${index + 1}`, staffIds: [`staff-${index}`],
  })));
}
const number = (value: string) => Number.parseFloat(value) || 0;
const rectangle = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);
let titleHeight = 84;
let headerHeight = 24;
let footerHeight = 24;
let intrinsicHeight = 120;
let textOverflow = false;
let unavailable = false;
let overrides: WeakMap<Element, DOMRect>;
let originalFonts: PropertyDescriptor | undefined;

/** Explicit synthetic geometry tests the DOM contract; it is not browser/PDF QA. */
function bounds(element: Element): DOMRect {
  const override = overrides.get(element);
  if (override) return override;
  if (unavailable) return rectangle(0, 0, 0, 0);
  const style = (element as HTMLElement).style;
  if (element.classList.contains('page-measurement')) return rectangle(-20_000, 0, number(style.width), 500);
  const staging = element.closest('.page-measurement');
  if (staging) {
    const height = element.classList.contains('page-title') ? titleHeight
      : element.classList.contains('page-heading') ? headerHeight : footerHeight;
    return rectangle(-20_000, 0, bounds(staging).width, height);
  }
  if (element.classList.contains('score-page')) {
    return rectangle(100, 50 + Number((element as HTMLElement).dataset.pageIndex) * 1300,
      number(style.getPropertyValue('--paper-width')) * CSS_PIXELS_PER_MM,
      number(style.getPropertyValue('--paper-height')) * CSS_PIXELS_PER_MM);
  }
  if (element.classList.contains('page-content')) {
    const paper = element.parentElement!;
    const box = bounds(paper);
    const margin = number((paper as HTMLElement).style.getPropertyValue('--page-margin')) * CSS_PIXELS_PER_MM;
    return rectangle(box.left + margin, box.top + margin, number(style.width), number(style.height));
  }
  const content = element.closest('.page-content');
  if (!content) return rectangle(0, 0, 10, 10);
  const box = bounds(content);
  const header = content.querySelector<HTMLElement>(':scope > .page-heading');
  const title = content.querySelector<HTMLElement>(':scope > .page-title');
  const musicTop = box.top + number(header?.style.height ?? '') + number(title?.style.height ?? '');
  if (element.classList.contains('page-heading')) return rectangle(box.left, box.top, box.width, number(style.height));
  if (element.classList.contains('page-title')) return rectangle(box.left, box.top + number(header!.style.height), box.width, number(style.height));
  if (element.classList.contains('page-footer')) return rectangle(box.left, box.bottom - number(style.height), box.width, number(style.height));
  if (element.classList.contains('page-system')) {
    const preceding = [...element.parentElement!.children].slice(0, [...element.parentElement!.children].indexOf(element)) as HTMLElement[];
    const top = musicTop + preceding.reduce((sum, row) => sum + number(row.style.height) + number(row.style.marginBottom), 0);
    return rectangle(box.left, top, number(style.width), number(style.height));
  }
  if (element.localName === 'svg') return bounds(element.parentElement!);
  const furniture = element.closest('.page-heading,.page-title,.page-footer');
  return furniture ? bounds(furniture) : rectangle(box.left, musicTop, box.width, 100);
}

beforeEach(() => {
  titleHeight = 84; headerHeight = 24; footerHeight = 24; intrinsicHeight = 120;
  textOverflow = false; unavailable = false; overrides = new WeakMap();
  document.body.replaceChildren();
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded', ready: Promise.resolve() } });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return bounds(this); });
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selected: Element | undefined;
    return {
      selectNodeContents(value: Node) { selected = value as Element; },
      getClientRects() {
        const box = bounds(selected!);
        const excess = textOverflow && selected?.classList.contains('draft-stamp') && selected.textContent ? 30 : 0;
        return [rectangle(box.left + 2, box.top + 2, Math.max(1, box.width - 4), Math.max(1, box.height - 4) + excess)];
      },
    } as unknown as Range;
  });
  mocks.ready.mockReset().mockResolvedValue(undefined);
  mocks.ink.mockReset().mockImplementation((svg: SVGSVGElement): InkBox[] => {
    const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
    return [{ x: 2, y: 2, width: viewBox[2] - 4, height: viewBox[3] - 4 }];
  });
  mocks.render.mockReset().mockImplementation((container: HTMLElement, score: Score, options: { width: number }) => {
    container.replaceChildren();
    const systems = score.staves[0].measures.map((_, index) => ({ index, start: index, end: index + 1,
      width: options.width, height: intrinsicHeight, pageBreak: false }));
    for (const system of systems) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('notation-svg');
      svg.setAttribute('viewBox', `0 0 ${system.width} ${system.height}`);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M2 2H20V20H2Z');
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hit.setAttribute('opacity', '0'); hit.setAttribute('pointer-events', 'all');
      svg.append(path, hit); container.append(svg);
    }
    return { systems, systemGeometry: systems, diagnostics: [], hitRegions: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.getElementById('author-page-size')?.remove();
  document.body.replaceChildren();
});

function host() { const element = document.createElement('div'); document.body.append(element); return element; }

describe('page furniture and mounted verification', () => {
  it.each([
    { partId: 'score', label: 'Full score · authored pitch' },
    { partId: 'piano', label: 'Piano · authored pitch' },
  ])('prints the authored-pitch label once for $partId and retains vector SVG without interaction rectangles', async ({ partId, label }) => {
    const output = host();
    const view = await renderPageView(output, project(), partId);
    expect(output.querySelector('.page-part-label')?.textContent).toBe(label);
    expect(output.querySelectorAll('svg.notation-svg')).toHaveLength(2);
    expect(output.querySelectorAll('svg path')).toHaveLength(2);
    expect(output.querySelectorAll('svg rect[opacity="0"]')).toHaveLength(0);
    expect(view.containmentIssues).toEqual([]);
    expect(document.getElementById('author-page-size')?.textContent).toBe('@page { size: 215.9mm 279.4mm; margin: 0; }');
  });

  it.each<{ notations: StaffNotation[]; partId: string; label: string }>([
    { notations: ['three-roads'], partId: 'score', label: 'Full score · 3 roads music' },
    { notations: ['three-roads'], partId: 'voice-0', label: 'Voice 1 · 3 roads music' },
    { notations: ['rhythm'], partId: 'score', label: 'Full score · rhythm notation' },
    { notations: ['rhythm'], partId: 'voice-0', label: 'Voice 1 · rhythm notation' },
    { notations: ['pitched', 'three-roads'], partId: 'score', label: 'Full score · mixed notation' },
    { notations: ['pitched', 'rhythm'], partId: 'score', label: 'Full score · mixed notation' },
    { notations: ['three-roads', 'rhythm'], partId: 'score', label: 'Full score · mixed notation' },
    { notations: ['pitched', 'three-roads'], partId: 'voice-1', label: 'Voice 2 · 3 roads music' },
    { notations: ['three-roads', 'rhythm'], partId: 'voice-1', label: 'Voice 2 · rhythm notation' },
    { notations: ['three-roads', 'pitched'], partId: 'voice-1', label: 'Voice 2 · authored pitch' },
  ])('uses the included staves for the title and every running heading: $label', async ({ notations, partId, label }) => {
    intrinsicHeight = 500;
    const output = host();
    const view = await renderPageView(output, notationProject(notations), partId);
    expect(view.projection.label).toBe(label);
    expect(output.querySelector('.page-part-label')?.textContent).toBe(label);
    expect(view.plan.pages).toHaveLength(2);
    expect([...output.querySelectorAll('.page-heading span:last-child')].map(element => element.textContent)).toEqual([label, label]);
    expect(view.containmentIssues).toEqual([]);
  });

  it('budgets actual wrapping headers and the complete draft footer before pagination', async () => {
    const value = project(); value.layouts.score.marginMm = 80;
    titleHeight = 150; headerHeight = 58.5; footerHeight = 44.2; intrinsicHeight = 60;
    const output = host();
    const view = await renderPageView(output, value, 'score');
    expect(view.reservations).toMatchObject({ titleHeightPx: 150, headerHeightPx: 59, footerHeightPx: 45 });
    expect(view.containmentIssues).toEqual([]);
    const before = JSON.stringify(view.plan);
    const preflight = document.createElement('div');
    expect(updatePagePreflight(output, preflight, value, view, true, false)).toBe(true);
    expect(output.querySelector('.draft-stamp')?.textContent).toBe('DRAFT - not ready for performance');
    expect(updatePagePreflight(output, preflight, value, view, false, false)).toBe(true);
    expect(JSON.stringify(view.plan)).toBe(before);
  });

  it('applies staff scale once to SVG dimensions while leaving furniture and paper physical', async () => {
    const value = project(); value.layouts.score.staffScale = 1.5;
    const output = host();
    const view = await renderPageView(output, value, 'score');
    const row = output.querySelector<HTMLElement>('.page-system')!;
    const svg = row.querySelector<SVGSVGElement>('svg')!;
    expect(number(row.style.height)).toBe(intrinsicHeight * 1.5);
    expect(svg.style.height).toBe(row.style.height);
    expect(number(row.style.width)).toBe(view.plan.pages[0].systems[0].width * 1.5);
    expect(output.querySelector<HTMLElement>('.page-title')?.style.height).toBe('84px');
    expect(view.containmentIssues).toEqual([]);
  });

  it('blocks changed real system bounds even when layout warnings are acknowledged', async () => {
    const value = project(); const output = host();
    const view = await renderPageView(output, value, 'score');
    const row = output.querySelector<HTMLElement>('.page-system')!;
    const box = bounds(row);
    overrides.set(row, rectangle(box.left, box.top, box.width + 30, box.height));
    const preflight = document.createElement('div');
    expect(updatePagePreflight(output, preflight, value, view, false, true)).toBe(false);
    expect(preflight.textContent).toContain('does not fit its planned physical bounds');
    expect(document.body.dataset.authorPrintReady).toBe('false');
    overrides.delete(row);
    expect(updatePagePreflight(output, preflight, value, view, false, false)).toBe(true);
  });

  it('checks draft text after stamping and does not accept a footer that actually overflows', async () => {
    const value = project(); const output = host();
    const view = await renderPageView(output, value, 'score');
    textOverflow = true;
    const preflight = document.createElement('div');
    expect(updatePagePreflight(output, preflight, value, view, true, true)).toBe(false);
    expect(preflight.textContent).toContain('footer text does not fit');
  });

  it('blocks ink escaping the SVG viewBox even when the outer system still fits', async () => {
    const value = project(); const output = host();
    const view = await renderPageView(output, value, 'score');
    mocks.ink.mockReturnValue([{ x: -20, y: 0, width: 100, height: 100 }]);
    const preflight = document.createElement('div');
    expect(updatePagePreflight(output, preflight, value, view, false, true)).toBe(false);
    expect(preflight.textContent).toContain('notation outside its vector viewport');
  });

  it('fails closed for unavailable, missing, or mismatched physical page DOM', async () => {
    const value = project(); const output = host();
    const view = await renderPageView(output, value, 'score');
    unavailable = true;
    expect(inspectPageContainment(output, view.plan, view.projection.profile, view.reservations).join(' ')).toContain('cannot be measured');
    unavailable = false;
    output.querySelector('.page-system')!.remove();
    expect(inspectPageContainment(output, view.plan, view.projection.profile, view.reservations).join(' ')).toContain('missing or duplicated systems');
    output.replaceChildren();
    expect(inspectPageContainment(output, view.plan, view.projection.profile, view.reservations).join(' ')).toContain('preview is incomplete');
  });

  it('blocks a changed paper box and a new font-loading interval', async () => {
    const value = project(); const output = host();
    const view = await renderPageView(output, value, 'score');
    const sheet = output.querySelector('.score-page')!; const box = bounds(sheet);
    overrides.set(sheet, rectangle(box.left, box.top, box.width / 2, box.height / 2));
    expect(inspectPageContainment(output, view.plan, view.projection.profile, view.reservations).join(' ')).toContain('physical paper dimensions');
    overrides.delete(sheet);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready: Promise.resolve() } });
    expect(updatePagePreflight(output, document.createElement('div'), value, view, false, true)).toBe(false);
  });

  it('does not replace current pages when an asynchronous request is obsolete', async () => {
    const output = host(); output.textContent = 'Current pages';
    await expect(renderPageView(output, project(), 'score', () => false)).rejects.toMatchObject({ name: 'AbortError' });
    expect(output.textContent).toBe('Current pages');
    expect(document.querySelector('.page-measurement')).toBeNull();
  });

  it('does not accept missing header measurement as a zero-height success', async () => {
    headerHeight = 0;
    const output = host();
    await expect(renderPageView(output, project(), 'score')).rejects.toThrow('running header could not be measured');
    expect(document.querySelector('.page-measurement')).toBeNull();
  });
});
