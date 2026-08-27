import '../src/components/index.js';
import { MusicNote as RegisteredMusicNote } from '../src/components/index.js';
import type { MusicSurface, MusicNote, MusicStaff, MusicMeter } from '../src/components/index.js';
import type { Clef, MusicEvent, Score } from '../src/model/types.js';
import { formatRational } from '../src/model/index.js';
import { unionInk, visibleInk } from '../src/engraving/geometry.js';
import { alignmentScore, automaticEnsembleScore, breakScore, durationCases, durationMatrixBar, improvScore, meterRestScore, nestedScore, tieScore, turningEnsembleScore } from './browser-fixtures.js';

interface Fixture { article: HTMLElement; container: HTMLElement; root: MusicSurface }
interface WorkbookFixture { frame: HTMLIFrameElement; doc: Document; view: Window; scores: MusicSurface[] }
interface Result { name: string; passed: boolean; detail: string }
interface Metrics { boundingBoxes: number; svgSystems: number; matrixCases: number }
interface Test { name: string; run: () => Promise<string> }

const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
let metrics: Metrics = { boundingBoxes: 0, svgSystems: 0, matrixCases: 0 };
let alignment: Fixture | undefined;
let upgradeSequence = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, description: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${description}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}

function close(actual: number, expected: number, description: string, tolerance = 0.05): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${description}: expected ${expected}, received ${actual} (tolerance ${tolerance}px).`);
}

/** This is a failure watchdog, not a timing assumption used to advance a test. */
async function waitForRender(promise: Promise<void>, label: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}: rendering promise did not settle within 20 seconds.`)), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function settle(root: MusicSurface): Promise<void> {
  await waitForRender(root.refresh(), root.label || root.localName);
  await waitForRender(root.renderComplete, root.label || root.localName);
}

async function mount(label: string, markup: string, width = 960): Promise<Fixture> {
  const article = document.createElement('article');
  article.className = 'fixture';
  const heading = document.createElement('h3');
  heading.textContent = label;
  const caption = document.createElement('p');
  caption.className = 'fixture-note';
  caption.textContent = 'Live notation; source DOM is kept intact. Open “Read score as text” inside the score for its semantic description.';
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const container = document.createElement('div');
  container.className = 'score-container';
  container.style.width = `${width}px`;
  container.innerHTML = markup;
  const root = container.firstElementChild as MusicSurface;
  assert(root && typeof root.refresh === 'function', `${label}: fixture must start with a music surface.`);
  viewport.append(container);
  article.append(heading, caption, viewport);
  fixtures.append(article);
  await settle(root);
  return { article, container, root };
}

/** Load the actual page, including its production bootstrap, styles and toolbar. */
async function mountWorkbook(label: string, width = 390): Promise<WorkbookFixture> {
  const article = document.createElement('article');
  article.className = 'fixture';
  const heading = document.createElement('h3');
  heading.textContent = label;
  const note = document.createElement('p');
  note.className = 'fixture-note';
  note.textContent = 'The real workbook runs below. These tests intercept only window.print; they verify the request boundary, not a native dialog or physical pages.';
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const frame = document.createElement('iframe');
  frame.title = label;
  frame.style.cssText = `display:block;width:${width}px;height:720px;border:1px solid #cbd5da`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.src = '/';
  viewport.append(frame);
  article.append(heading, note, viewport);
  fixtures.append(article);
  await waitForRender(loaded, 'Load the actual workbook');
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  assert(doc && view, 'The workbook iframe must remain on the same origin.');
  const scores = [...doc.querySelectorAll<MusicSurface>('[data-score]')];
  equal(scores.length, 9, 'The workbook must include all nine actual score roots');
  await waitForRender(Promise.all(scores.map(score => score.renderComplete)).then(() => {}), 'Render all nine workbook scores');
  scores.forEach(score => noErrors(score, score.id));
  assert(doc.querySelector('#workbook-status')!.textContent!.includes('Responsive score layout'),
    'The production workbook controller did not initialize.');
  return { frame, doc, view, scores };
}

async function waitForWorkbookStatus(status: HTMLElement, expected: RegExp, action: () => void): Promise<void> {
  let observer: MutationObserver | undefined;
  try {
    await waitForRender(new Promise<void>(resolve => {
      const check = () => { if (expected.test(status.textContent ?? '')) resolve(); };
      observer = new MutationObserver(check);
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      action();
      check();
    }), `Workbook status ${expected}`);
  } finally {
    observer?.disconnect();
  }
}

function requireScore(root: MusicSurface): Score {
  assert(root.score, 'The component did not expose a parsed score.');
  return root.score;
}

function errors(root: MusicSurface): string[] {
  return root.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    .map(diagnostic => `${diagnostic.code}: ${diagnostic.message} [${diagnostic.sourceId}]`);
}

function noErrors(root: MusicSurface, label = 'Score'): void {
  const failures = errors(root);
  assert(failures.length === 0, `${label} reported notation errors:\n${failures.join('\n')}`);
  assert(root.shadowRoot!.querySelectorAll('.screen svg').length > 0, `${label}: no engraved SVG was produced.`);
}

function allEvents(root: MusicSurface): MusicEvent[] {
  return requireScore(root).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
}

function eventGroups(root: MusicSurface, surface = '.screen'): SVGGElement[] {
  return [...root.shadowRoot!.querySelectorAll<SVGGElement>(`${surface} g[data-source-id][data-measure-id][data-staff-id][data-x]`)];
}

function sourceCoverage(root: MusicSurface, surface = '.screen'): void {
  const events = allEvents(root);
  const expected = events.map(event => event.id).sort();
  equal(eventGroups(root, surface).map(group => group.dataset.sourceId).sort(), expected, 'Every musical event must have exactly one rendered source group');
  equal(root.getHitRegions().map(hit => hit.sourceId).sort(), expected, 'Every musical event must have one hit region');
  for (const hit of root.getHitRegions()) {
    const source = root.getSource(hit.sourceId);
    assert(source && root.contains(source), `Hit region ${hit.sourceId} does not map to a live source element.`);
    assert([hit.x, hit.y, hit.width, hit.height].every(Number.isFinite) && hit.width > 0 && hit.height > 0,
      `Hit region ${hit.sourceId} has invalid geometry: ${JSON.stringify(hit)}.`);
  }
  for (const group of root.shadowRoot!.querySelectorAll<SVGGElement>(`${surface} g[data-source-id]`)) {
    assert(root.getSource(group.dataset.sourceId!), `Rendered source ${group.dataset.sourceId} cannot be mapped back to the author’s DOM.`);
  }
  for (const group of eventGroups(root, surface)) {
    const event = events.find(item => item.id === group.dataset.sourceId)!;
    equal(group.dataset.onset, formatRational(event.onset), `${event.id}: rendered onset must match exact model time`);
    equal(group.dataset.duration, formatRational(event.time), `${event.id}: rendered duration must match exact model time`);
    if (event.kind === 'slash' && !event.rhythmic) {
      equal(group.querySelectorAll('g.vf-stem path').length, 0, `${event.id}: an improvised beat slash must not draw a stem`);
    }
  }
}

/** Check painted ink; SVG text getBBox includes Bravura's unpainted em box. */
function checkBounds(root: MusicSurface, surface = '.screen'): number {
  const svgs = [...root.shadowRoot!.querySelectorAll<SVGSVGElement>(`${surface} svg`)];
  assert(svgs.length > 0, 'Cannot check bounds without rendered SVG systems.');
  for (const [index, svg] of svgs.entries()) {
    const box = unionInk(visibleInk(svg));
    assert(box, `System ${index + 1} has no visible ink.`);
    metrics.boundingBoxes++;
    metrics.svgSystems++;
    const view = svg.viewBox.baseVal;
    assert([view.x, view.y, view.width, view.height, box.x, box.y, box.width, box.height].every(Number.isFinite),
      `System ${index + 1} has nonfinite SVG geometry.`);
    assert(view.width > 0 && view.height > 0 && box.width > 0 && box.height > 0, `System ${index + 1} has empty SVG geometry.`);
    const tolerance = 0.5;
    assert(box.x >= view.x - tolerance && box.y >= view.y - tolerance
      && box.x + box.width <= view.x + view.width + tolerance
      && box.y + box.height <= view.y + view.height + tolerance,
    `System ${index + 1}: rendered glyph bounds exceed the SVG viewBox.\nBounds: ${JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height })}\nViewBox: ${svg.getAttribute('viewBox')}`);
    for (const group of svg.querySelectorAll<SVGGraphicsElement>('g[data-source-id], g.vf-clef, g.vf-stavetie')) {
      const local = unionInk(visibleInk(group));
      metrics.boundingBoxes++;
      if (!local) {
        const peer = [...svg.querySelectorAll<SVGGElement>('g[data-source-id]')]
          .find(candidate => candidate.dataset.sourceId === group.dataset.coalescedWith);
        assert(group.dataset.coalescedWith && peer && unionInk(visibleInk(peer)),
          `No visible or explicitly shared ink on ${group.dataset.sourceId || group.getAttribute('class')}.`);
        continue;
      }
      assert([local.x, local.y, local.width, local.height].every(Number.isFinite),
        `Nonfinite glyph bounds on ${group.dataset.sourceId || group.getAttribute('class')}.`);
    }
  }
  return svgs.length;
}

function synchronizedRows(root: MusicSurface, surface = '.screen'): number {
  const score = requireScore(root);
  const rows = [...root.shadowRoot!.querySelectorAll<HTMLElement>(`${surface} .system-row`)];
  let next = 0;
  for (const row of rows) {
    const start = Number(row.dataset.startMeasure);
    const end = Number(row.dataset.endMeasure);
    equal(start, next, 'System ranges must be contiguous');
    assert(end > start, `Empty system range ${start}–${end}.`);
    for (const staff of score.staves) {
      const actual = new Set([...row.querySelectorAll<SVGGElement>('g[data-staff-id][data-measure-id]')]
        .filter(group => group.dataset.staffId === staff.id).map(group => group.dataset.measureId));
      equal([...actual].sort(), staff.measures.slice(start, end).map(measure => measure.id).sort(),
        `${staff.label || staff.id}: all staves must share system range ${start}–${end}`);
    }
    const clefs = row.querySelectorAll('g.vf-clef').length;
    assert(clefs >= score.staves.length, `System beginning at measure ${start + 1} has ${clefs} clefs for ${score.staves.length} staves.`);
    const number = row.querySelector('g.vf-measure-number');
    assert(number?.textContent?.includes(score.staves[0].measures[start].number), `System ${start} has no useful starting measure number.`);
    next = end;
  }
  equal(next, score.staves[0].measures.length, 'The final system must include the final measure');
  return rows.length;
}

function checkOnsets(root: MusicSurface): number {
  const score = requireScore(root);
  const groups = eventGroups(root);
  let compared = 0;
  for (let column = 0; column < score.staves[0].measures.length; column++) {
    const byOnset = new Map<string, { x: number; row: Element | null; source: string; staff: string }[]>();
    for (const staff of score.staves) {
      const measure = staff.measures[column];
      for (const voice of measure.voices) for (const event of voice.events) {
        if (event.measureRest) continue; // Full-measure rests intentionally center.
        const group = groups.find(candidate => candidate.dataset.sourceId === event.id);
        assert(group, `No rendered group for ${event.id}.`);
        const key = formatRational(event.onset);
        const values = byOnset.get(key) ?? [];
        values.push({ x: Number(group.dataset.x), row: group.closest('.system-row'), source: event.id, staff: staff.id });
        byOnset.set(key, values);
      }
    }
    for (const [onset, attacks] of byOnset) {
      if (new Set(attacks.map(attack => attack.staff)).size < 2) continue;
      for (const attack of attacks.slice(1)) {
        assert(attack.row === attacks[0].row, `Measure ${column + 1} onset ${onset} was split across systems.`);
        close(attack.x, attacks[0].x, `Measure ${column + 1} onset ${onset}: ${attacks[0].source} and ${attack.source}`, 0.01);
        compared++;
      }
    }
  }
  assert(compared > 0, 'The fixture did not contain simultaneous attacks to compare.');
  return compared;
}

function alignmentFixture(): Fixture {
  assert(alignment, 'The alignment fixture is unavailable; see the font/rendering check above.');
  return alignment;
}

function geometrySnapshot(root: MusicSurface, surface = '.screen') {
  return [...root.shadowRoot!.querySelectorAll<HTMLElement>(`${surface} .system-row`)].map(row => ({
    start: row.dataset.startMeasure, end: row.dataset.endMeasure, page: row.classList.contains('page-break'),
    viewBox: row.querySelector('svg')!.getAttribute('viewBox'),
    staves: [...row.querySelectorAll<SVGGElement>('g.vf-music-staff')].map(group => ({
      id: group.dataset.staffId, transform: group.getAttribute('transform'), top: group.dataset.topLine,
    })),
    events: [...row.querySelectorAll<SVGGElement>('g.vf-music-event')].map(group => ({ id: group.dataset.sourceId, x: group.dataset.x })),
    ties: [...row.querySelectorAll<SVGPathElement>('g.vf-stavetie path')].map(path => path.getAttribute('d')),
  }));
}

/** Exercise the native observer, not refresh() (which intentionally rebuilds print). */
async function resizeObserved(fixture: Fixture, width: number): Promise<void> {
  const rendered = new Promise<void>(resolve => fixture.root.addEventListener('notation-render', () => resolve(), { once: true }));
  fixture.container.style.width = `${width}px`;
  await waitForRender(rendered, `Native resize to ${width}px`);
  await waitForRender(fixture.root.renderComplete, `Complete native resize to ${width}px`);
}

function checkJoins(root: MusicSurface): void {
  for (const row of root.shadowRoot!.querySelectorAll('.screen .system-row')) {
    const staves = [...row.querySelectorAll<SVGGElement>('g.vf-music-staff')];
    const gaps = staves.slice(1).map((staff, index) => ({
      top: Number(staves[index].dataset.bottomLine) + 1, bottom: Number(staff.dataset.topLine),
    }));
    for (const rect of row.querySelectorAll<SVGRectElement>('g.vf-music-connector rect')) {
      const y = Number(rect.getAttribute('y'));
      const bottom = y + Number(rect.getAttribute('height'));
      assert(gaps.some(gap => Math.abs(y - gap.top) < 0.02 && Math.abs(bottom - gap.bottom) < 0.02),
        `Connector ${y}–${bottom} must join exactly one inter-staff gap, never cross another system.`);
    }
    for (const tie of row.querySelectorAll<SVGGElement>('g.vf-music-tie[data-boundary="incoming"]')) {
      const ink = unionInk(visibleInk(tie, row.querySelector('svg')!))!;
      assert(ink.width >= 19.5, `Incoming tie is only ${ink.width}px wide and could resemble an articulation.`);
      assert(ink.x >= Number(tie.dataset.headerEndX) - 0.1, 'Incoming tie intrudes into its clef/key/meter header.');
    }
  }
}

function checkNestedTupletClearance(root: MusicSurface): void {
  const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-tuplet')];
  for (const staff of requireScore(root).staves) for (const measure of staff.measures) for (const voice of measure.voices) {
    for (const child of voice.tuplets) {
      const event = voice.events.find(event => event.tupletIds.includes(child.id))!;
      const ancestors = event.tupletIds.slice(0, event.tupletIds.indexOf(child.id));
      const childGroup = groups.find(group => group.dataset.sourceId === child.id)!;
      const svg = childGroup.ownerSVGElement!;
      const childText = unionInk([...childGroup.querySelectorAll<SVGTextElement>('text')].flatMap(text => visibleInk(text, svg)))!;
      for (const ancestor of ancestors) {
        const outer = groups.find(group => group.dataset.sourceId === ancestor)!;
        const outerText = unionInk([...outer.querySelectorAll<SVGTextElement>('text')].flatMap(text => visibleInk(text, svg)))!;
        const gap = Math.max(childText.y - outerText.y - outerText.height, outerText.y - childText.y - childText.height);
        assert(gap >= 5.5, `Nested tuplet numbers ${ancestor}/${child.id} have only ${gap}px separation.`);
      }
    }
  }
}

const tests: Test[] = [
  {
    name: 'The real workbook toolbar switches all nine scores and requests the same print layout in either mode',
    async run() {
      const { frame, doc, view, scores } = await mountWorkbook('Actual workbook controls: all nine examples');
      const preview = doc.querySelector<HTMLInputElement>('#print-preview')!;
      const printButton = doc.querySelector<HTMLButtonElement>('#print-scores')!;
      const status = doc.querySelector<HTMLElement>('#workbook-status')!;
      const automatic = scores.find(score => score.id === 'ensemble-auto-study')!;
      const models = scores.map(score => score.toJSON());
      const markup = scores.map(score => score.innerHTML);
      const sources = scores.map(score => new Map(allEvents(score).map(event => [event.id, score.getSource(event.id)])));
      const printGeometry = scores.map(score => geometrySnapshot(score, '.print'));
      equal(geometrySnapshot(automatic).length, 2, 'The narrow workbook must demonstrate responsive ensemble wrapping');
      equal(geometrySnapshot(automatic, '.print').length, 1, 'The same passage has one system at its 680px print width');
      const originalPrint = view.print;
      const requests: { models: Score[]; geometry: ReturnType<typeof geometrySnapshot>[] }[] = [];
      view.print = () => {
        assert(scores.every(score => errors(score).length === 0), 'A print request contained a score error.');
        requests.push({ models: scores.map(score => score.toJSON()), geometry: scores.map(score => geometrySnapshot(score, '.print')) });
      };
      try {
        await waitForWorkbookStatus(status, /^Print dialog requested\./, () => printButton.click());
        equal(requests.length, 1, 'The production print button must request the dialog once');
        assert(!preview.checked, 'Printing should not turn on the screen preview checkbox.');
        assert(!printButton.disabled, 'The print button must recover after the request returns.');

        preview.click();
        await waitForRender(Promise.all(scores.map(score => score.renderComplete)).then(() => {}), 'Switch all nine workbook projections');
        for (const score of scores) {
          noErrors(score);
          assert(score.hasAttribute('print-preview'), `${score.id} did not follow the actual checkbox.`);
          equal(view.getComputedStyle(score.shadowRoot!.querySelector('.screen')!).display, 'none', 'Preview hides the responsive projection');
          equal(view.getComputedStyle(score.shadowRoot!.querySelector('.print')!).display, 'block', 'Preview displays the print projection');
          sourceCoverage(score, '.print');
          synchronizedRows(score, '.print');
        }
        equal(scores.map(score => geometrySnapshot(score, '.print')), printGeometry, 'The checkbox changes the displayed projection, not the print layout');
        const row = automatic.shadowRoot!.querySelector<HTMLElement>('.print .system-row')!;
        assert(row.scrollWidth > row.clientWidth, 'A fixed-width score should remain readable by scrolling on the narrow screen.');
        await waitForWorkbookStatus(status, /^Print dialog requested\./, () => printButton.click());
        equal(requests.length, 2, 'The print button must also work with screen preview enabled');
        equal(requests[1], requests[0], 'Printing with the checkbox off and on must use identical music and print geometry');

        const resized = new Promise<void>(resolve => automatic.addEventListener('notation-render', () => resolve(), { once: true }));
        frame.style.width = '960px';
        await waitForRender(resized, 'Resize the actual workbook while previewing');
        await waitForRender(Promise.all(scores.map(score => score.renderComplete)).then(() => {}), 'Complete the workbook resize');
        equal(scores.map(score => geometrySnapshot(score, '.print')), printGeometry, 'All nine print layouts remain fixed when the actual workbook viewport changes');
        preview.click();
        await waitForRender(Promise.all(scores.map(score => score.renderComplete)).then(() => {}), 'Return all nine scores to responsive mode');
        for (const [index, score] of scores.entries()) {
          assert(!score.hasAttribute('print-preview'), `${score.id} did not return to responsive mode.`);
          equal(view.getComputedStyle(score.shadowRoot!.querySelector('.screen')!).display, 'block', 'Responsive mode restores the screen projection');
          equal(view.getComputedStyle(score.shadowRoot!.querySelector('.print')!).display, 'none', 'Responsive mode hides the fixed projection');
          for (const [id, source] of sources[index]) assert(score.getSource(id) === source, `The toolbar replaced source ${id}.`);
          sourceCoverage(score);
          synchronizedRows(score);
        }
        equal(scores.map(score => score.toJSON()), models, 'Toolbar changes preserve all nine musical models');
        equal(scores.map(score => score.innerHTML), markup, 'Toolbar changes preserve the authored musical DOM');
        return 'The actual page, stylesheet and production controller switch all nine scores at 390/960px. Both checkbox states request identical print music and geometry; only window.print is intercepted, so physical pagination is not asserted.';
      } finally {
        view.print = originalPrint;
      }
    },
  },
  {
    name: 'The real workbook print button waits for an immediate source edit and blocks errors until repaired',
    async run() {
      const { doc, view, scores } = await mountWorkbook('Actual workbook print readiness: errors and repair', 960);
      const root = scores.find(score => score.id === 'pitch-study')!;
      const note = doc.querySelector('#editable-note')!;
      const pitch = note.getAttribute('pitch')!;
      const model = root.toJSON();
      const printButton = doc.querySelector<HTMLButtonElement>('#print-scores')!;
      const status = doc.querySelector<HTMLElement>('#workbook-status')!;
      const originalPrint = view.print;
      let requests = 0;
      view.print = () => { requests++; };
      try {
        note.setAttribute('pitch', 'not-a-pitch');
        await waitForWorkbookStatus(status, /^Printing blocked:/, () => printButton.click());
        equal(requests, 0, 'A pending invalid edit must block the real print button');
        assert(errors(root).length > 0, 'The invalid musical source must still report its diagnostics.');
        assert(!printButton.disabled, 'An error must not leave the print button disabled.');
        note.setAttribute('pitch', pitch);
        await waitForWorkbookStatus(status, /^Print dialog requested\./, () => printButton.click());
        equal(requests, 1, 'Repairing the source allows one fresh print request');
        noErrors(root);
        equal(root.toJSON(), model, 'Printing and repair preserve the original model and source IDs');
        assert(root.getSource('editable-note') === note, 'The print controller must not replace the edited source element.');
        sourceCoverage(root);
        return 'Clicking the actual print control immediately after an invalid edit waits for diagnostics and blocks the request; repairing the same source node restores printing. The native dialog itself is intercepted.';
      } finally {
        note.setAttribute('pitch', pitch);
        view.print = originalPrint;
      }
    },
  },
  {
    name: 'Bundled fonts, real SVG, and complete source/hit coverage',
    async run() {
      alignment = await mount('Ensemble alignment: shared beats across two staves', alignmentScore());
      noErrors(alignment.root);
      assert(document.fonts.check('40px Bravura'), 'Bravura notation font is not loaded.');
      assert([...document.fonts].some(font => /Bravura/.test(font.family) && font.status === 'loaded'), 'No loaded Bravura FontFace was found.');
      sourceCoverage(alignment.root);
      checkBounds(alignment.root);
      return `${allEvents(alignment.root).length} musical events map to source elements and hit regions; Bravura is loaded.`;
    },
  },
  {
    name: 'Half notes, quarters, triplets and quintuplets share exact onset positions',
    async run() {
      const { root } = alignmentFixture();
      await settle(root);
      noErrors(root);
      return `${checkOnsets(root)} simultaneous attacks agree within 0.01 SVG units.`;
    },
  },
  {
    name: 'Responsive 320 / 600 / 960px systems stay synchronized and repeat clefs',
    async run() {
      const { root, container } = alignmentFixture();
      const counts: number[] = [];
      for (const width of [320, 600, 960]) {
        container.style.width = `${width}px`;
        await settle(root);
        close(root.getBoundingClientRect().width, width, 'Actual score container width');
        noErrors(root, `${width}px score`);
        counts.push(synchronizedRows(root));
        checkOnsets(root);
        checkBounds(root);
        for (const row of root.shadowRoot!.querySelectorAll<HTMLElement>('.screen .system-row.overflow')) {
          equal(row.tabIndex, 0, 'An overflowing system must be keyboard focusable');
          equal(getComputedStyle(row).overflowX, 'auto', 'An overflowing system must expose horizontal scrolling');
        }
      }
      assert(counts[0] >= counts[2], `Narrow layout unexpectedly has fewer systems: ${counts.join(', ')}.`);
      return `320 / 600 / 960px produce ${counts.join(' / ')} systems, with shared ranges, clefs and intact glyph bounds.`;
    },
  },
  {
    name: 'Property and attribute edits preserve source identities and hit mappings',
    async run() {
      const { root } = alignmentFixture();
      const before = allEvents(root).map(event => event.id);
      const first = allEvents(root)[0];
      const source = root.getSource(first.id) as MusicNote;
      assert(source?.localName === 'music-note', 'The first musical event did not map to a note.');
      const hadID = source.hasAttribute('id');
      source.pitch = 'F#5';
      await waitForRender(root.renderComplete, 'Pitch property edit');
      noErrors(root);
      equal(source.getAttribute('pitch'), 'F#5', 'Pitch property must reflect to the source attribute');
      equal(allEvents(root)[0].pitches[0], { step: 'F', octave: 5, alter: 1, display: 'auto' }, 'Pitch property must update semantic data');
      source.setAttribute('pitch', 'A5');
      await waitForRender(root.renderComplete, 'Pitch attribute edit');
      equal(source.pitch, 'A5', 'Pitch attribute must update the reflected property');
      equal(allEvents(root).map(event => event.id), before, 'Source event IDs must remain stable while editing');
      assert(root.getSource(first.id) === source, 'Edited source identity must remain the same DOM node.');
      equal(source.hasAttribute('id'), hadID, 'The renderer must not add source ID attributes');
      sourceCoverage(root);
      checkBounds(root);
      source.pitch = 'C5';
      await settle(root);
      return `${before.length} event identities and source nodes survived both edit paths.`;
    },
  },
  {
    name: 'Staff/context properties and layout properties rerender their descendants',
    async run() {
      const { root } = alignmentFixture();
      const upper = root.querySelector<MusicStaff>('music-staff')!;
      upper.clef = 'alto';
      root.maxMeasures = 2;
      root.label = 'Edited ensemble label';
      await waitForRender(root.renderComplete, 'Staff property edit');
      noErrors(root);
      assert(requireScore(root).staves[0].measures.every(measure => measure.clef === 'alto'), 'The clef property did not reach inherited measure context.');
      assert([...root.shadowRoot!.querySelectorAll<HTMLElement>('.screen .system-row')]
        .every(row => Number(row.dataset.endMeasure) - Number(row.dataset.startMeasure) <= 2), 'maxMeasures property did not constrain line length.');
      equal(root.shadowRoot!.querySelector('.surface')!.getAttribute('aria-label'), 'Edited ensemble label', 'The score label must update its accessible name');
      upper.clef = 'treble';
      root.removeAttribute('max-measures');
      await settle(root);
      checkBounds(root);
      return 'Inherited clef, maximum measure count, and accessible score label update from properties.';
    },
  },
  {
    name: 'Native custom-element upgrade preserves properties assigned before definition',
    async run() {
      const article = document.createElement('article');
      article.className = 'fixture';
      const heading = document.createElement('h3');
      heading.textContent = 'Native upgrade: preassigned properties survive definition';
      const caption = document.createElement('p');
      caption.className = 'fixture-note';
      caption.textContent = 'This temporary note subclass is intentionally outside every score. Its custom tag tests the browser’s native upgrade lifecycle without extending the notation grammar.';
      const name = `music-test-late-note-${Date.now().toString(36)}-${upgradeSequence++}`;
      const source = document.createElement(name) as MusicNote;
      source.pitch = 'F#4';
      source.duration = 'half';
      source.dotted = true;
      assert(Object.hasOwn(source, 'pitch') && Object.hasOwn(source, 'duration'), 'Pre-upgrade assignments did not create native own properties.');
      article.append(heading, caption, source);
      fixtures.append(article);
      class LateMusicNote extends RegisteredMusicNote {}
      customElements.define(name, LateMusicNote);
      customElements.upgrade(source);
      await customElements.whenDefined(name);
      assert(source instanceof LateMusicNote, 'The browser did not upgrade the existing element to its defined class.');
      assert(article.lastElementChild === source, 'Native upgrade replaced the source node instead of retaining its identity.');
      assert(!Object.hasOwn(source, 'pitch') && !Object.hasOwn(source, 'duration') && !Object.hasOwn(source, 'dotted'),
        'Own pre-upgrade properties still shadow the reflected accessors.');
      equal([source.getAttribute('pitch'), source.getAttribute('duration'), source.hasAttribute('dotted')],
        ['F#4', 'half', true], 'Pre-upgrade property values must become authoritative source attributes');
      source.pitch = 'G4';
      source.dotted = false;
      equal([source.getAttribute('pitch'), source.hasAttribute('dotted')], ['G4', false], 'Reflected properties must continue to work after native upgrade');
      caption.textContent += ' Passed: pitch, duration and dotted state became attributes on the same node; later property edits still reflect.';
      return 'A connected, undefined native element kept its identity and transferred three own properties into reflected attributes when defined.';
    },
  },
  {
    name: 'Adding, removing and reconnecting notes and the root remains live',
    async run() {
      const fixture = await mount('DOM lifecycle: an editable incomplete draft', '<music-measure incomplete label="Live editable draft"><music-note pitch="C4"></music-note></music-measure>', 600);
      const { root, container } = fixture;
      noErrors(root);
      const first = root.querySelector<MusicNote>('music-note')!;
      const firstID = allEvents(root)[0].id;
      const added = document.createElement('music-note');
      added.pitch = 'D4';
      root.append(added);
      await waitForRender(root.renderComplete, 'Insert note');
      noErrors(root);
      equal(allEvents(root).length, 2, 'Appending a note must add one rendered event');
      const addedID = allEvents(root)[1].id;
      first.remove();
      await waitForRender(root.renderComplete, 'Remove note');
      equal(allEvents(root).map(event => event.id), [addedID], 'Removing a note must remove its hit/source group');
      root.prepend(first);
      await waitForRender(root.renderComplete, 'Reconnect note');
      equal(allEvents(root).map(event => event.id), [firstID, addedID], 'Reattached notes must preserve identities');
      root.remove();
      await waitForRender(root.renderComplete, 'Disconnect root');
      first.pitch = 'G4';
      container.append(root);
      await settle(root);
      noErrors(root);
      equal(allEvents(root).map(event => event.id), [firstID, addedID], 'Root reconnection must preserve source identities');
      equal(allEvents(root)[0].pitches[0].step, 'G', 'Disconnected source edits must appear on reconnection');
      sourceCoverage(root);
      checkBounds(root);
      return 'Insertion, removal, note reattachment, detached edits, and root reconnection all produced current notation.';
    },
  },
  {
    name: 'Native staff reparenting between a system and the document stays live',
    async run() {
      const { root: system } = await mount('Reparenting: a part can leave and rejoin its ensemble', `<music-system label="Native reparenting" bracket="brace">
        <music-staff label="Upper" clef="treble"><music-measure><music-note pitch="C5" duration="whole"></music-note></music-measure><music-measure><music-note pitch="D5" duration="whole"></music-note></music-measure></music-staff>
        <music-staff label="Lower" clef="bass"><music-measure><music-note pitch="C3" duration="whole"></music-note></music-measure><music-measure><music-note pitch="G2" duration="whole"></music-note></music-measure></music-staff>
      </music-system>`, 600);
      noErrors(system);
      const part = system.querySelector<MusicStaff>('music-staff')!;
      const ids = requireScore(system).staves[0].measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id)));
      const originalStyle = part.getAttribute('style');
      try {
        // A direct body child exercises native disconnect/connect callbacks, not
        // a mocked lifecycle call or a fixture wrapper inside another score.
        part.style.width = '600px';
        document.body.append(part);
        await settle(system);
        await settle(part);
        assert(part.parentElement === document.body, 'The part did not move directly into the document body.');
        noErrors(system, 'Remaining ensemble');
        noErrors(part, 'Detached standalone part');
        equal(requireScore(system).staves.length, 1, 'The ensemble must stop rendering the removed part');
        equal(allEvents(part).map(event => event.id), ids, 'Moving a part into the document must preserve event identities');
        assert(!part.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden, 'A standalone part did not reveal its own notation surface.');
        const note = part.querySelector<MusicNote>('music-note')!;
        note.pitch = 'Bb4';
        await waitForRender(part.renderComplete, 'Edit reparented part');
        noErrors(part);
        equal(allEvents(part)[0].pitches[0].alter, -1, 'The detached part stopped observing note edits');
        sourceCoverage(part);
        checkBounds(part);
        system.prepend(part);
        if (originalStyle === null) part.removeAttribute('style');
        else part.setAttribute('style', originalStyle);
        await settle(system);
        noErrors(system, 'Reunited ensemble');
        assert(part.shadowRoot!.querySelector<HTMLElement>('.surface')!.hidden, 'A reattached part left a duplicate standalone surface visible.');
        equal(requireScore(system).staves.length, 2, 'The ensemble did not restore the reattached part');
        equal(requireScore(system).staves[0].measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => event.id))),
          ids, 'Reattaching a part must preserve event identities');
        equal(requireScore(system).staves[0].measures[0].voices[0].events[0].pitches[0].alter, -1,
          'The ensemble lost edits made while the part was standalone');
        sourceCoverage(system);
        synchronizedRows(system);
        checkBounds(system);
      } finally {
        if (part.parentElement !== system) system.prepend(part);
        if (originalStyle === null) part.removeAttribute('style');
        else part.setAttribute('style', originalStyle);
        await settle(system);
      }
      return 'A staff moved system → document body → system, rendered independently, kept IDs and edits, and hid its redundant surface on rejoining.';
    },
  },
  {
    name: 'Typo diagnostics fail closed and repair restores engraving',
    async run() {
      const { root } = await mount('Validation: repair restores a complete measure', '<music-measure label="Typo repair"><music-note pitch="C5" duration="whole"></music-note></music-measure>', 600);
      const source = root.querySelector<MusicNote>('music-note')!;
      source.setAttribute('duraton', 'half');
      await waitForRender(root.renderComplete, 'Misspelled attribute');
      assert(root.diagnostics.some(diagnostic => diagnostic.code === 'unknown-attribute'), 'A misspelled notation attribute was silently accepted.');
      equal(root.shadowRoot!.querySelectorAll('.screen svg, .print svg').length, 0, 'Invalid notation must clear both rendered surfaces');
      const panel = root.shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!;
      assert(!panel.hidden && panel.open && panel.textContent?.includes('duraton'), 'The author did not receive an open, useful typo diagnostic.');
      equal(root.getHitRegions().length, 0, 'Invalid notation must not leave stale hit regions');
      source.removeAttribute('duraton');
      await waitForRender(root.renderComplete, 'Repair misspelled attribute');
      noErrors(root);
      sourceCoverage(root);
      checkBounds(root);
      return 'A duration typo cleared stale notation, named the bad attribute, and recovered immediately after repair.';
    },
  },
  {
    name: 'Unknown notation elements are never silently discarded',
    async run() {
      const { root } = await mount('Validation: unsupported notation is explicit', '<music-measure label="Unknown notation"><music-note pitch="G4" duration="whole"></music-note></music-measure>', 600);
      const unknown = document.createElement('music-glissando');
      root.append(unknown);
      await waitForRender(root.renderComplete, 'Unknown notation element');
      assert(root.diagnostics.some(diagnostic => diagnostic.code === 'unknown-element' && diagnostic.severity === 'error'), 'Unknown notation was not diagnosed as an error.');
      equal(root.shadowRoot!.querySelectorAll('.screen svg').length, 0, 'Unsupported notation must not produce a misleading partial score');
      unknown.remove();
      await waitForRender(root.renderComplete, 'Remove unsupported notation');
      noErrors(root);
      return 'Unsupported notation blocks the score until its source is repaired or removed.';
    },
  },
  {
    name: 'Meter inheritance edits and full-measure rests keep exact durations',
    async run() {
      const { root } = await mount('Inherited irregular meters and measure rests', meterRestScore(), 960);
      noErrors(root);
      equal(requireScore(root).staves[0].measures.map(measure => measure.meter.display), ['7/8', '7/8', '5/4', '5/4'], 'Initial meter inheritance');
      root.meter = '15/8';
      root.groups = '3+3+3+3+3';
      await waitForRender(root.renderComplete, 'Inherited meter edit');
      noErrors(root);
      equal(requireScore(root).staves[0].measures.map(measure => measure.meter.display), ['15/8', '15/8', '5/4', '5/4'], 'Root meter edit must stop at an explicit later meter');
      const local = root.querySelector<MusicMeter>('music-meter')!;
      local.top = 3;
      local.bottom = 4;
      local.groups = '1+1+1';
      await waitForRender(root.renderComplete, 'Local meter property edit');
      noErrors(root);
      equal(requireScore(root).staves[0].measures.map(measure => measure.meter.display), ['15/8', '15/8', '3/4', '3/4'], 'Local meter edit must propagate into following measures');
      equal(allEvents(root).map(event => formatRational(event.time)), ['15/8', '15/8', '3/4', '3/4'], 'Measure rests must consume the current full bar, not four quarter notes');
      assert(allEvents(root).every(event => event.measureRest), 'Measure rest semantics were lost.');
      sourceCoverage(root);
      checkBounds(root);
      return '7/8 → 15/8 and 5/4 → 3/4 context edits preserve the correct duration of every full-measure rest.';
    },
  },
  {
    name: 'Dotted rests render and retain their exact elapsed durations',
    async run() {
      const { root } = await mount('Dotted rests in irregular and compound meters', `<music-staff label="Dotted rests">
        <music-measure meter="7/8" groups="2+2+3"><music-rest duration="half" dots="2"></music-rest></music-measure>
        <music-measure meter="6/8"><music-rest duration="quarter" dotted></music-rest><music-rest duration="quarter" dotted></music-rest></music-measure>
        <music-measure meter="15/8" groups="3+3+3+3+3"><music-rest duration="whole" dots="3"></music-rest></music-measure>
      </music-staff>`, 960);
      noErrors(root);
      equal(allEvents(root).map(event => formatRational(event.time)), ['7/8', '3/8', '3/8', '15/8'], 'Dotted rest durations');
      equal(allEvents(root).map(event => event.dots), [2, 1, 1, 3], 'Dotted rest counts');
      const notationText = [...root.shadowRoot!.querySelectorAll('.screen svg text')].map(text => text.textContent).join('');
      equal(notationText.split('\uE1E7').length - 1, 7, 'The dotted-rest fixture must draw seven SMuFL augmentation-dot glyphs');
      sourceCoverage(root);
      checkBounds(root);
      return 'Single, double and triple augmentation dots agree with exact model duration and visible dot groups.';
    },
  },
  {
    name: 'Improvised beat slashes omit stems while rhythmic slashes retain them',
    async run() {
      const { root } = await mount('Improvisation notation: open beats versus prescribed rhythm', `<music-measure label="Beat and rhythmic slashes">
        <music-slash></music-slash><music-slash rhythmic></music-slash>
        <music-slash></music-slash><music-slash rhythmic></music-slash>
      </music-measure>`, 600);
      noErrors(root);
      const groups = eventGroups(root);
      equal(groups.map(group => group.querySelectorAll('g.vf-stem path').length), [0, 1, 0, 1],
        'Only the two prescribed quarter-note slashes should have drawn stem paths');
      sourceCoverage(root);
      checkBounds(root);
      return 'Actual SVG stem paths distinguish two open beat slashes from two rhythmic quarter-note slashes.';
    },
  },
  {
    name: 'Prose dynamics retain readable text instead of being mapped into music glyphs',
    async run() {
      const { root } = await mount('Expressive text: subito p and cresc.', `<music-measure label="Plain prose dynamics">
        <music-dynamics text="subito p"></music-dynamics><music-note pitch="C5" duration="half"></music-note>
        <music-dynamics level="cresc."></music-dynamics><music-note pitch="E5" duration="half"></music-note>
      </music-measure>`, 600);
      noErrors(root);
      const annotations = requireScore(root).staves[0].measures[0].annotations;
      equal(annotations.map(annotation => annotation.text), ['subito p', 'cresc.'], 'Prose dynamics must remain unchanged in semantic data');
      const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g[data-kind="dynamics"][data-source-id]')];
      equal(groups.map(group => group.textContent), ['subito p', 'cresc.'], 'Prose dynamics must retain readable SVG text');
      for (const [index, group] of groups.entries()) {
        equal(group.dataset.sourceId, annotations[index].id, 'Prose dynamics must keep their source identity');
        assert(!/[\uE000-\uF8FF]/.test(group.textContent ?? ''), 'Plain prose was partially converted into private-use music glyphs.');
        const text = group.querySelector('text');
        assert(text && !/Bravura/i.test(getComputedStyle(text).fontFamily),
          `${annotations[index].text} is still rendered with a music-symbol font instead of readable text.`);
      }
      sourceCoverage(root);
      checkBounds(root);
      return '“subito p” and “cresc.” keep their source, wording and a readable text font in the actual SVG.';
    },
  },
  {
    name: 'Forced line/page breaks survive dedicated print layout and preview',
    async run() {
      const { root } = await mount('Print surface: explicit line and page breaks', breakScore(), 960);
      noErrors(root);
      for (const surface of ['.screen', '.print']) {
        assert(root.shadowRoot!.querySelector(`${surface} .system-row[data-start-measure="1"]`), `${surface}: explicit line break was lost.`);
        assert(root.shadowRoot!.querySelector(`${surface} .system-row.page-break[data-start-measure="2"]`), `${surface}: explicit page break was lost.`);
      }
      root.printPreview = true;
      await waitForRender(root.renderComplete, 'Print preview');
      noErrors(root);
      equal(getComputedStyle(root.shadowRoot!.querySelector<HTMLElement>('.print')!).display, 'block', 'Print preview must reveal the dedicated print surface');
      equal(getComputedStyle(root.shadowRoot!.querySelector<HTMLElement>('.screen')!).display, 'none', 'Print preview must hide the screen surface');
      sourceCoverage(root, '.print');
      synchronizedRows(root, '.print');
      checkBounds(root, '.print');
      return 'Both layouts retain the authored breaks; print preview is visible with correct source regions and uncropped glyphs.';
    },
  },
  {
    name: 'The text transcript is visible, detailed, and connected to the score',
    async run() {
      const { root } = alignmentFixture();
      await settle(root);
      const transcript = root.shadowRoot!.querySelector<HTMLDetailsElement>('.transcript')!;
      transcript.open = true;
      const text = transcript.querySelector('pre')!;
      assert(text.getBoundingClientRect().height > 0, 'Opening the transcript did not expose visible text.');
      for (const phrase of ['Flute', 'Cello', 'Measure 1', 'half', '3:2', '5:4', 'duration']) {
        assert(text.textContent?.includes(phrase), `The transcript omitted ${phrase}.`);
      }
      const accessible = root.shadowRoot!.querySelector('.surface')!.getAttribute('aria-label');
      assert(accessible && accessible.length > 0, 'The score lacks an accessible label.');
      transcript.open = false;
      return 'The visible transcript names instruments, measures, notes, exact durations, and both tuplet ratios.';
    },
  },
  {
    name: 'Notation selection returns the original authorable source element',
    async run() {
      const { root } = alignmentFixture();
      const group = eventGroups(root)[0];
      assert(group, 'There is no event to select.');
      let selected: { sourceId: string; sourceElement: Element } | undefined;
      root.addEventListener('notation-select', event => {
        selected = (event as CustomEvent<{ sourceId: string; sourceElement: Element }>).detail;
      }, { once: true });
      group.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      assert(selected, 'Clicking a notation group did not dispatch notation-select.');
      equal(selected.sourceId, group.dataset.sourceId, 'Selected source ID');
      assert(selected.sourceElement === root.getSource(selected.sourceId), 'The selection did not return the source DOM element.');
      return 'A rendered event selects the exact original DOM node for a future editor.';
    },
  },
  {
    name: 'All four clefs × nine durations × five musical event forms engrave',
    async run() {
      const fixture = await mount('Duration matrix: final case remains visible', '<music-measure label="Duration matrix" meter="4/4"><music-rest measure></music-rest></music-measure>', 960);
      const failures: string[] = [];
      const root = fixture.root;
      for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const) for (const entry of durationCases) {
        const label = `${clef} / ${entry.duration}`;
        root.clef = clef;
        root.meter = `${entry.numerator * 5}/${entry.denominator}`;
        root.groups = `${entry.numerator * 5}`;
        root.innerHTML = durationMatrixBar(clef, entry.duration);
        await settle(root);
        metrics.matrixCases++;
        try {
          noErrors(root, label);
          equal(allEvents(root).map(event => event.kind), ['note', 'rest', 'chord', 'slash', 'slash'], `${label}: event forms`);
          sourceCoverage(root);
          checkBounds(root);
        } catch (error) {
          failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      assert(failures.length === 0, `${failures.length} duration matrix cases failed:\n${failures.join('\n\n')}`);
      return '36 combinations / 180 events rendered notes, rests, chords, rhythmic slashes and stemless slashes without engine exceptions.';
    },
  },
  {
    name: 'Nested uniform-depth and mixed-depth tuplets work in every clef',
    async run() {
      const failures: string[] = [];
      const { root } = await mount('Advanced subdivisions: nested triplets, quintuplets and septuplets', nestedScore(), 960);
      for (const clef of ['treble', 'bass', 'alto', 'tenor'] as readonly Clef[]) {
        root.clef = clef;
        await settle(root);
        metrics.matrixCases++;
        try {
          noErrors(root, `Nested tuplets in ${clef}`);
          assert(allEvents(root).some(event => event.tupletIds.length === 2), 'No doubly nested events reached the model.');
          assert(root.shadowRoot!.querySelectorAll('.screen g.vf-music-tuplet').length >= 9, 'Some structural tuplets did not render.');
          checkNestedTupletClearance(root);
          sourceCoverage(root);
          checkBounds(root);
        } catch (error) {
          failures.push(`${clef}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      root.clef = 'treble';
      await settle(root);
      assert(failures.length === 0, `Nested tuplet cases failed:\n${failures.join('\n\n')}`);
      return 'Four clefs cover equal nesting depth, mixed nesting, mixed durations, rests/chords/slashes, 5:4, 7:4 and a single dotted-event tuplet.';
    },
  },
  {
    name: 'Shared altered unisons avoid duplicate signs without merging different alterations',
    async run() {
      const { root } = await mount('Polyphonic accidentals: shared signs and explicit pitch conflicts', `<music-measure label="Shared altered unisons">
        <music-voice><music-note pitch="F#4" duration="whole"></music-note></music-voice>
        <music-voice><music-note pitch="F#4" duration="whole"></music-note></music-voice>
      </music-measure>`, 600);
      const notes = [...root.querySelectorAll<MusicNote>('music-note')];
      const ids = allEvents(root).map(event => event.id);
      const assertSigns = (sharp: number, natural: number, description: string): void => {
        noErrors(root, description);
        const text = [...root.shadowRoot!.querySelectorAll('.screen svg text')].map(element => element.textContent).join('');
        equal(text.split('\uE262').length - 1, sharp, `${description}: SMuFL sharp glyph count`);
        equal(text.split('\uE261').length - 1, natural, `${description}: SMuFL natural glyph count`);
        equal(allEvents(root).map(event => event.id), ids, `${description}: sharing a glyph must not merge musical identities`);
        equal(root.getHitRegions().length, 2, `${description}: both authored events need hit regions`);
        sourceCoverage(root);
        checkBounds(root);
      };
      assertSigns(1, 0, 'Two simultaneous F-sharps');
      notes[0].pitch = 'F4';
      await waitForRender(root.renderComplete, 'Simultaneous natural and sharp');
      assertSigns(1, 1, 'F natural against F-sharp');
      notes[0].pitch = 'F#4';
      for (const policies of [['courtesy', 'always'], ['always', 'courtesy']] as const) {
        notes[0].accidentalDisplay = policies[0];
        notes[1].accidentalDisplay = policies[1];
        await waitForRender(root.renderComplete, 'Forced and courtesy accidental requests');
        assertSigns(1, 0, `${policies[0]} / ${policies[1]} shared F-sharp`);
        const text = [...root.shadowRoot!.querySelectorAll('.screen svg text')].map(element => element.textContent).join('');
        assert(!/[\uE26A\uE26B]/.test(text), 'A required normal accidental was incorrectly parenthesized because another voice requested courtesy display.');
      }
      return 'Two F-sharps share one printed sharp and retain two events/hits; F-natural against F-sharp retains both signs; required signs take precedence over courtesy requests.';
    },
  },
  {
    name: 'Reordered chord ties continue correctly across line and page boundaries',
    async run() {
      const { root } = await mount('Ties across authored line and page breaks', tieScore(), 960);
      noErrors(root);
      equal(allEvents(root).map(event => event.tie), ['start', 'continue', 'end'], 'The tie chain must remain intact');
      assert(root.shadowRoot!.querySelectorAll('.screen g.vf-stavetie').length >= 4, 'Cross-system ties did not produce both outgoing and incoming segments.');
      assert(root.shadowRoot!.querySelector('.screen .page-break[data-start-measure="2"]'), 'The final chord did not start at its requested page boundary.');
      sourceCoverage(root);
      checkBounds(root);
      checkJoins(root);
      return 'The same three spelled pitches remain tied after chord source order changes, with segments on both sides of each boundary.';
    },
  },
  {
    name: 'Harmony stays close to visible notation and annotation tiers grow outward',
    async run() {
      const { root } = await mount('Spacing quality: the actual improvisation study', improvScore(), 770.703);
      noErrors(root);
      const measureGaps = () => {
        const svg = root.shadowRoot!.querySelector<SVGSVGElement>('.screen svg')!;
        const top = Number(svg.querySelector<SVGGElement>('g.vf-music-staff')!.dataset.topLine);
        return [...svg.querySelectorAll<SVGGElement>('g.vf-music-annotation[data-kind="harmony"]')].map(group => {
          const box = unionInk(visibleInk(group, svg))!;
          return top - box.y - box.height;
        });
      };
      const before = measureGaps();
      equal(before.length, 3, 'All three harmony changes remain visible');
      assert(before.every(gap => gap >= 7 && gap <= 14), `Harmony is detached from its staff: gaps ${before.join(', ')}px.`);
      const svg = root.shadowRoot!.querySelector<SVGSVGElement>('.screen svg')!;
      const baselines = [...svg.querySelectorAll('g[data-kind="harmony"] text')].map(text => text.getAttribute('y'));
      assert(new Set(baselines).size === 1, 'Harmony changes lost their common baseline.');
      equal(svg.querySelectorAll('g[data-kind="rehearsal"] path').length, 0, 'Boxed rehearsal mark must not redraw a stale staff path');
      assert(svg.viewBox.baseVal.height < 190, `Simple improvisation staff still reserves ${svg.viewBox.baseVal.height}px of height.`);
      const ink = unionInk(visibleInk(svg))!;
      close(ink.y - svg.viewBox.baseVal.y, 8, 'Consistent top ink padding', 1);
      close(svg.viewBox.baseVal.y + svg.viewBox.baseVal.height - ink.y - ink.height, 8, 'Consistent bottom ink padding', 1);
      root.querySelector('music-rehearsal')!.remove();
      root.querySelector('music-direction')!.remove();
      await waitForRender(root.renderComplete, 'Remove outer annotation tiers');
      measureGaps().forEach((gap, index) => close(gap, before[index], 'Outer tiers must not move harmony away from staff'));
      const middle = root.querySelectorAll('music-measure')[1];
      middle.querySelector('music-slash')!.removeAttribute('dots');
      middle.querySelectorAll('music-slash')[1].setAttribute('duration', 'quarter');
      await waitForRender(root.renderComplete, 'Remove dot and flag without changing measure time');
      noErrors(root);
      measureGaps().forEach((gap, index) => close(gap, before[index], 'A dot/flag must not add phantom above-staff space'));
      sourceCoverage(root);
      checkBounds(root);
      return `Harmony ink stays ${before.map(gap => gap.toFixed(1)).join(' / ')}px above the staff, independent of outer directions and invisible font/stem space.`;
    },
  },
  {
    name: 'The paired ensemble demos distinguish automatic wrapping from optional authored breaks',
    async run() {
      const automatic = await mount('Ensemble comparison: without manual interjection', automaticEnsembleScore(), 960);
      const manual = await mount('Ensemble comparison: with manual interjection', turningEnsembleScore(), 960);
      const { root } = automatic;
      const ranges = (score: MusicSurface, surface = '.screen') => geometrySnapshot(score, surface).map(({ start, end, page }) => ({ start, end, page }));
      const automaticRange = [{ start: '0', end: '4', page: false }];
      const manualRanges = [
        { start: '0', end: '2', page: false },
        { start: '2', end: '3', page: false },
        { start: '3', end: '4', page: true },
      ];
      assert(!root.hasAttribute('max-measures') && !root.hasAttribute('justify-last')
        && !root.querySelector('[break-before], [keep-with-next], [max-measures], [justify-last]'),
      'The automatic gallery example must not contain manual layout hints.');
      noErrors(root);
      noErrors(manual.root);
      equal(ranges(root), automaticRange, 'With enough space, default layout combines all four measure columns');
      equal(ranges(manual.root), manualRanges, 'At the same width, the authored line and page choices remain visible');
      equal(ranges(root, '.print'), automaticRange, 'The default print projection has no forced page or measure limit');

      const before = geometrySnapshot(root);
      const model = root.toJSON();
      const sources = new Map(allEvents(root).map(event => [event.id, root.getSource(event.id)]));
      const printed = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      const printGeometry = geometrySnapshot(root, '.print');
      const widths = [680, 560, 520, 519, 420, 390, 337, 336, 335, 320, 300, 290, 289, 278, 600, 960];
      const changes: string[] = [];
      let previous = '';
      for (const width of widths) {
        await resizeObserved(automatic, width);
        await resizeObserved(manual, width);
        for (const fixture of [automatic, manual]) {
          noErrors(fixture.root);
          assert(!fixture.root.diagnostics.some(diagnostic => diagnostic.code === 'layout-overflow'),
            `The simple ensemble should fit at ${width}px.`);
          synchronizedRows(fixture.root);
          checkOnsets(fixture.root);
          sourceCoverage(fixture.root);
          checkBounds(fixture.root);
          checkJoins(fixture.root);
        }
        equal(root.toJSON(), model, 'Automatic wrapping must not edit musical content or layout hints');
        for (const [id, source] of sources) assert(root.getSource(id) === source, `Automatic wrapping replaced source ${id}.`);
        equal(root.shadowRoot!.querySelectorAll('.screen .page-break, .print .page-break').length, 0,
          'Default wrapping must not invent an authored page-turn request');
        equal([...manual.root.shadowRoot!.querySelectorAll<HTMLElement>('.screen .page-break')].map(row => row.dataset.startMeasure), ['3'],
          'Manual page break remains at the same measure');
        assert(manual.root.shadowRoot!.querySelector('.screen .system-row[data-start-measure="2"]'),
          'The manual line break must remain in force.');
        const autoRows = ranges(root);
        const manualRows = ranges(manual.root);
        if (manualRows[0].end === '2') assert(Number(autoRows[0].end) >= 2,
          `Automatic layout unnecessarily orphaned the pickup at ${width}px, where it can fit with bar 1.`);
        const splitTie = autoRows.some(row => row.start === '2');
        for (const boundary of ['within', 'incoming', 'outgoing']) {
          const expected = boundary === 'within' ? (splitTie ? 0 : 3) : (splitTie ? 3 : 0);
          equal(root.shadowRoot!.querySelectorAll(`.screen g.vf-music-tie[data-boundary="${boundary}"]`).length, expected,
            `All three automatic tie continuations remain correct at ${width}px`);
        }
        assert(root.shadowRoot!.querySelector('.print')!.firstElementChild === printed,
          'Automatic screen wrapping recreated its fixed print projection.');
        equal(geometrySnapshot(root, '.print'), printGeometry, 'Automatic print geometry remains independent of screen width');
        const current = autoRows.map(({ start, end }) => `${start}–${end}`).join('|');
        if (current !== previous) changes.push(`${width}px: ${current}`);
        previous = current;
      }
      equal(geometrySnapshot(root), before, 'Default wrapping returns to the same geometry at the same width');
      return `The actual gallery sources share all four columns at 960px automatically, while overrides keep three systems. ${widths.length} paired width changes preserve alignment, musical sources, ties and fixed print geometry. Automatic ranges: ${changes.join('; ')}`;
    },
  },
  {
    name: 'Automatic opening pickup grouping yields to explicit breaks, limits and actual available space',
    async run() {
      const fixture = await mount('Automatic pickup: a musical preference with author overrides', automaticEnsembleScore(), 300);
      const { root } = fixture;
      const before = root.toJSON();
      const geometry = geometrySnapshot(root);
      const sources = new Map(allEvents(root).map(event => [event.id, root.getSource(event.id)]));
      const firstEnd = () => root.shadowRoot!.querySelector<HTMLElement>('.screen .system-row')!.dataset.endMeasure;
      equal(firstEnd(), '2', 'An opening pickup and bar 1 stay together when they fit at 300px');
      assert(before.staves.every(staff => staff.measures[0].pickup && !staff.measures[0].keepWithNext),
        'The automatic preference must not become an authored keep instruction.');
      root.setAttribute('max-measures', '1');
      await waitForRender(root.renderComplete, 'Limit each system to one measure');
      noErrors(root);
      equal(geometrySnapshot(root).map(({ start, end }) => [start, end]),
        [['0', '1'], ['1', '2'], ['2', '3'], ['3', '4']], 'An explicit measure limit overrides the automatic pickup preference');
      root.removeAttribute('max-measures');
      await waitForRender(root.renderComplete, 'Remove the optional measure limit');
      equal(geometrySnapshot(root), geometry, 'Removing the limit restores default pickup grouping');

      const firstBars = [...root.querySelectorAll('music-staff')].map(staff => staff.querySelectorAll('music-measure')[1]);
      for (const breakBefore of ['line', 'page']) {
        for (const bar of firstBars) bar.setAttribute('break-before', breakBefore);
        await waitForRender(root.renderComplete, `Request a ${breakBefore} before bar 1`);
        noErrors(root);
        equal(firstEnd(), '1', 'An explicit break overrides the automatic pickup preference');
        const forced = root.shadowRoot!.querySelector<HTMLElement>('.screen .system-row[data-start-measure="1"]');
        assert(forced, 'The requested break must begin at bar 1.');
        equal(forced.classList.contains('page-break'), breakBefore === 'page', 'Only the explicit page request creates a page marker');
        synchronizedRows(root);
        checkBounds(root);
        checkJoins(root);
      }
      for (const bar of firstBars) bar.removeAttribute('break-before');
      await waitForRender(root.renderComplete, 'Remove explicit breaks');
      equal(geometrySnapshot(root), geometry, 'Removing explicit breaks restores the same automatic geometry');
      for (const width of [290, 289, 300]) {
        await resizeObserved(fixture, width);
        noErrors(root);
        equal(firstEnd(), width >= 290 ? '2' : '1', 'The pickup stays with bar 1 only while the pair fits');
        assert(!root.diagnostics.some(diagnostic => diagnostic.code === 'layout-overflow'),
          'The automatic preference must not force an oversized pair off the page.');
        sourceCoverage(root);
        synchronizedRows(root);
        checkBounds(root);
        checkJoins(root);
      }
      equal(root.toJSON(), before, 'Automatic pickup grouping must not alter the source model');
      for (const [id, source] of sources) assert(root.getSource(id) === source, `Pickup grouping replaced source ${id}.`);
      assert(!root.querySelector('[keep-with-next], [break-before]'), 'Automatic layout wrote manual attributes into the source.');
      return 'Opening pickups stay with bar 1 at 300/290px, split when necessary at 289px, and yield to explicit line/page breaks and max-measures=1 without changing musical content or source IDs.';
    },
  },
  {
    name: 'Adding and removing manual breaks updates both projections without changing source identities',
    async run() {
      const { root } = await mount('Optional layout instructions: authored to automatic and back', turningEnsembleScore(), 960);
      const before = root.toJSON();
      const screen = geometrySnapshot(root);
      const printed = geometrySnapshot(root, '.print');
      const firstPrinted = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      const sources = new Map(allEvents(root).map(event => [event.id, root.getSource(event.id)]));
      const measures = [...root.querySelectorAll('music-measure')].map(element => ({
        element, breakBefore: element.getAttribute('break-before'), keep: element.getAttribute('keep-with-next'),
      }));
      for (const { element } of measures) {
        element.removeAttribute('break-before');
        element.removeAttribute('keep-with-next');
      }
      await waitForRender(root.renderComplete, 'Remove authored breaks and keep preferences');
      noErrors(root);
      const expected = { ...before, staves: before.staves.map(staff => ({ ...staff,
        measures: staff.measures.map(measure => ({ ...measure, breakBefore: 'auto', keepWithNext: false })),
      })) };
      equal(root.toJSON(), expected, 'Removing layout hints must change no other musical fields or IDs');
      for (const [id, source] of sources) assert(root.getSource(id) === source, `Removing layout hints replaced source ${id}.`);
      const automaticPrinted = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      assert(automaticPrinted !== firstPrinted, 'Removing authored breaks did not rebuild the print projection.');
      for (const surface of ['.screen', '.print']) {
        equal(geometrySnapshot(root, surface).map(({ start, end, page }) => ({ start, end, page })),
          [{ start: '0', end: '4', page: false }], 'Omitting manual hints restores automatic layout in both projections');
      }
      sourceCoverage(root);
      checkBounds(root);
      checkJoins(root);
      // A display:none SVG has no usable native transforms. Inspect print ink
      // through the public preview control, just as a reader would display it.
      root.printPreview = true;
      await waitForRender(root.renderComplete, 'Show the automatic print projection');
      checkBounds(root, '.print');
      synchronizedRows(root, '.print');
      sourceCoverage(root, '.print');
      root.printPreview = false;
      await waitForRender(root.renderComplete, 'Return to responsive screen layout');
      const printBeforeRestore = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      for (const { element, breakBefore, keep } of measures) {
        if (breakBefore !== null) element.setAttribute('break-before', breakBefore);
        if (keep !== null) element.setAttribute('keep-with-next', keep);
      }
      await waitForRender(root.renderComplete, 'Restore authored breaks and keep preferences');
      noErrors(root);
      equal(root.toJSON(), before, 'Restoring layout hints restores the exact model');
      equal(geometrySnapshot(root), screen, 'Restoring the overrides restores screen layout');
      equal(geometrySnapshot(root, '.print'), printed, 'Restoring the overrides restores print layout');
      assert(root.shadowRoot!.querySelector('.print')!.firstElementChild !== printBeforeRestore,
        'Restoring authored breaks left stale automatic print output.');
      sourceCoverage(root);
      checkBounds(root);
      checkJoins(root);
      return 'Authored → automatic → authored edits update both screen and print, preserving every event, source element, exact duration and stable ID.';
    },
  },
  {
    name: 'Ensemble joins, ties and authored page boundaries survive width round trips',
    async run() {
      const fixture = await mount('Resize quality: the actual author-directed ensemble study', turningEnsembleScore(), 960);
      const { root } = fixture;
      noErrors(root);
      const before = geometrySnapshot(root);
      const model = root.toJSON();
      const sources = new Map(allEvents(root).map(event => [event.id, root.getSource(event.id)]));
      const printed = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      const printGeometry = geometrySnapshot(root, '.print');
      const widths = [770.703, 680, 521, 520, 519, 390, 337, 336, 335, ...Array.from({ length: 43 }, (_, index) => 320 - index), 960];
      const ranges: string[] = [];
      let previousRange = '';
      for (const width of widths) {
        await resizeObserved(fixture, width);
        noErrors(root, `${width}px ensemble`);
        assert(!root.diagnostics.some(diagnostic => diagnostic.code === 'layout-overflow'),
          `This simple ensemble should fit without a horizontal overflow notice at ${width}px.`);
        equal(root.toJSON(), model, 'Resizing must not change the musical model');
        for (const [id, source] of sources) assert(root.getSource(id) === source, `Resize replaced source ${id}.`);
        synchronizedRows(root);
        sourceCoverage(root);
        checkOnsets(root);
        checkBounds(root);
        checkJoins(root);
        assert(root.shadowRoot!.querySelector('.screen .system-row[data-start-measure="2"]'), 'Authored line break before measure 2 moved.');
        const pages = root.shadowRoot!.querySelectorAll<HTMLElement>('.screen .page-break');
        equal([...pages].map(row => row.dataset.startMeasure), ['3'], 'Page break remains at source measure 3 exactly once');
        equal(root.shadowRoot!.querySelectorAll('.screen g.vf-music-tie[data-boundary="incoming"]').length, 3, 'All three incoming tie continuations survive resizing');
        equal(root.shadowRoot!.querySelectorAll('.screen g.vf-music-tie[data-boundary="outgoing"]').length, 3, 'All three outgoing tie continuations survive resizing');
        assert(root.shadowRoot!.querySelector('.print')!.firstElementChild === printed, 'Viewport-only resize recreated the fixed print projection.');
        equal(geometrySnapshot(root, '.print'), printGeometry, 'Print geometry is independent of screen width');
        if (width >= 390) equal(root.shadowRoot!.querySelector<HTMLElement>('.screen .system-row')!.dataset.endMeasure, '2', 'A readable pickup and first bar stay together');
        const rows = root.shadowRoot!.querySelectorAll<HTMLElement>('.screen .system-row');
        for (const row of rows) {
          assert(row.querySelector('svg')!.viewBox.baseVal.height < 350, 'Simple three-staff system still has excessive vertical padding.');
          if (!row.classList.contains('overflow')) assert(row.scrollWidth <= row.clientWidth, `False horizontal scrollbar at ${width}px.`);
        }
        const range = [...rows].map(row => `${row.dataset.startMeasure}–${row.dataset.endMeasure}`).join('|');
        if (range !== previousRange) ranges.push(`${width}px: ${range}`);
        previousRange = range;
      }
      equal(geometrySnapshot(root), before, 'Returning to the same width restores exactly the same geometry');
      return `${widths.length} native resize steps, including a one-pixel sweep through the pickup wrapping boundary, preserve sources, joins, readable ties and the authored page; fixed print DOM is unchanged. Range changes: ${ranges.join('; ')}`;
    },
  },
  {
    name: 'Fixed print preview stays identical while fractional content widths avoid false scrolling',
    async run() {
      const fixture = await mount('Stable reading: fixed print preview', turningEnsembleScore(), 960);
      const { root } = fixture;
      root.printPreview = true;
      await waitForRender(root.renderComplete, 'Enable stable print reading');
      const projection = root.shadowRoot!.querySelector('.print')!.firstElementChild;
      const geometry = geometrySnapshot(root, '.print');
      const hits = [...root.getHitRegions()];
      for (const width of [320, 600, 960]) {
        await resizeObserved(fixture, width);
        assert(root.shadowRoot!.querySelector('.print')!.firstElementChild === projection, 'Print preview changed DOM on screen resize.');
        equal(geometrySnapshot(root, '.print'), geometry, 'Print preview geometry remains fixed');
        equal(root.getHitRegions(), hits, 'Print preview selection coordinates remain fixed');
        checkBounds(root, '.print');
      }
      const fractional = await mount('Fractional widths: no false scrollbar', '<music-measure justify-last><music-note pitch="C5" duration="whole"></music-note></music-measure>', 770.703);
      fractional.root.style.cssText = 'box-sizing:border-box;padding:12px;border:1px solid transparent;transform:scale(.95);transform-origin:0 0';
      await waitForRender(fractional.root.renderComplete, 'Padded and transformed host');
      noErrors(fractional.root);
      const surface = fractional.root.shadowRoot!.querySelector<HTMLElement>('.surface')!;
      const available = Math.floor(Number.parseFloat(getComputedStyle(surface).width));
      const row = fractional.root.shadowRoot!.querySelector<HTMLElement>('.screen .system-row')!;
      const svg = row.querySelector('svg')!;
      equal(Number(svg.getAttribute('width')), available, 'SVG uses untransformed integer content width, excluding host padding/border');
      assert(row.scrollWidth <= row.clientWidth && svg.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.01,
        'Fractional/padded/transformed host creates a spurious horizontal scrollbar.');
      return 'Print preview DOM, page choices, geometry and hit regions stay fixed across 320/600/960px; a 770.703px padded/transformed host has no phantom overflow.';
    },
  },
  {
    name: 'Single-voice rests retain their conventional staff positions in every clef',
    async run() {
      const pitches = { treble: ['A6', 'C3'], bass: ['A4', 'C1'], alto: ['A5', 'C2'], tenor: ['A5', 'C2'] } as const;
      let checked = 0;
      for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const) {
        const [high, low] = pitches[clef];
        const { root } = await mount(`Rest placement near high and low pitches — ${clef}`, `<music-staff clef="${clef}" max-measures="2">
          <music-measure meter="4/4"><music-note pitch="${high}" duration="half"></music-note><music-rest duration="half"></music-rest></music-measure>
          <music-measure meter="3/2"><music-note pitch="${low}" duration="half"></music-note><music-rest duration="whole"></music-rest></music-measure>
          <music-measure meter="4/4"><music-tuplet actual="3" normal="2"><music-note pitch="${high}"></music-note><music-rest></music-rest><music-note pitch="${low}"></music-note></music-tuplet><music-rest duration="half"></music-rest></music-measure>
          <music-measure end-bar="final"><music-rest measure></music-rest></music-measure>
        </music-staff>`, 680);
        noErrors(root);
        for (const event of allEvents(root).filter(event => event.kind === 'rest')) {
          const group = eventGroups(root).find(group => group.dataset.sourceId === event.id)!;
          const text = group.querySelector('g.vf-notehead text')!;
          assert(text, `${clef}: no rest glyph found.`);
          const whole = event.measureRest || event.duration === 'whole';
          close(Number(text.getAttribute('y')), whole ? 50 : 60, `${clef}: conventional ${whole ? 'whole' : event.duration} rest baseline`, 1);
          const staff = group.closest<SVGGElement>('g.vf-music-staff')!;
          const box = unionInk(visibleInk(group, group.ownerSVGElement!))!;
          if (whole) close(box.y, Number(staff.dataset.topLine) + 10, `${clef}: whole rest hangs from fourth line`, 1);
          else if (event.duration === 'half') close(box.y + box.height, Number(staff.dataset.topLine) + 20, `${clef}: half rest sits on middle line`, 1);
          checked++;
        }
        sourceCoverage(root);
        checkBounds(root);
      }
      return `${checked} ordinary and tuplet rests in four clefs keep their staff positions despite adjacent high/low pitches.`;
    },
  },
  {
    name: 'Coincident rests may share ink without losing either voice or hit region',
    async run() {
      const { root } = await mount('Shared rest glyph: two musical voices remain authorable', `<music-measure>
        <music-voice><music-rest duration="whole"></music-rest></music-voice>
        <music-voice><music-rest duration="whole"></music-rest></music-voice>
      </music-measure>`, 600);
      noErrors(root);
      const groups = eventGroups(root);
      equal(groups.length, 2, 'Both voice events retain source groups');
      const merged = groups.filter(group => group.dataset.coalescedWith);
      equal(merged.length, 1, 'Only one coincident rest is represented by its peer');
      const printed = groups.find(group => group.dataset.sourceId === merged[0].dataset.coalescedWith)!;
      assert(printed && unionInk(visibleInk(printed)), 'The shared rest has no printed peer.');
      equal(root.getHitRegions().map(({ x, y, width, height }) => ({ x, y, width, height })),
        Array.from({ length: 2 }, () => {
          const { x, y, width, height } = root.getHitRegions()[0];
          return { x, y, width, height };
        }), 'Both source identities map to the same actual rest ink');
      sourceCoverage(root);
      checkBounds(root);
      root.insertAdjacentHTML('beforeend', '<music-voice><music-rest duration="whole"></music-rest></music-voice>');
      await waitForRender(root.renderComplete, 'Three equivalent voice rests');
      noErrors(root);
      equal(eventGroups(root).filter(group => group.dataset.coalescedWith).length, 2, 'Three equivalent rests may share one printed glyph');
      sourceCoverage(root);
      checkBounds(root);
      return 'One printed whole rest safely represents two or three equivalent simultaneous rests; every voice, source ID and hit mapping remains available.';
    },
  },
  {
    name: 'Repeat joins match their real header position and mixed barlines remain independent',
    async run() {
      const { root } = await mount('Connector policy: shared repeats and deliberately mixed endings', `<music-system bracket="brace">
        <music-staff clef="treble" key="D"><music-measure repeat-start end-bar="final"><music-rest measure></music-rest></music-measure></music-staff>
        <music-staff clef="bass" key="F"><music-measure repeat-start end-bar="final"><music-rest measure></music-rest></music-measure></music-staff>
      </music-system>`, 680);
      noErrors(root);
      const repeat = root.shadowRoot!.querySelector('.screen g.vf-music-connector[data-boundary="repeat-start"]')!;
      assert(repeat, 'Shared repeat-start join is missing.');
      const strokes = [...repeat.querySelectorAll('rect')].map(rect => ({ x: Number(rect.getAttribute('x')), width: Number(rect.getAttribute('width')) }));
      equal(strokes.map(stroke => stroke.width), [3, 1], 'Repeat strokes retain their actual thick/thin widths');
      for (const staff of root.shadowRoot!.querySelectorAll('.screen g.vf-music-staff')) {
        const local = [...staff.querySelectorAll('g.vf-stavebarline rect')];
        for (const stroke of strokes) assert(local.some(rect => Math.abs(Number(rect.getAttribute('x')) - stroke.x) < 0.02
          && Number(rect.getAttribute('width')) === stroke.width), 'Repeat join is detached from a staff’s actual post-header repeat barline.');
      }
      checkJoins(root);
      const lower = root.querySelectorAll('music-measure')[1];
      lower.setAttribute('end-bar', 'none');
      lower.removeAttribute('repeat-start');
      await waitForRender(root.renderComplete, 'Different authored barline policies');
      noErrors(root);
      equal(root.shadowRoot!.querySelectorAll('.screen g.vf-music-connector[data-boundary="end"], .screen g.vf-music-connector[data-boundary="repeat-start"]').length,
        0, 'A top-staff barline must not be imposed on a differently authored lower staff');
      assert(root.diagnostics.some(diagnostic => diagnostic.code === 'unjoined-barlines'), 'Ambiguous shared barline policy needs an explicit diagnostic.');
      sourceCoverage(root);
      checkBounds(root);
      return 'Repeat connectors meet the aligned post-header strokes exactly; differing ending/repeat policies are diagnosed and left separate.';
    },
  },
  {
    name: 'Annotation clearance follows local notes and includes ties across system breaks',
    async run() {
      const { root } = await mount('Local ink clearance: distant ledger notes and continuation ties', `<music-staff>
        <music-measure><music-harmony text="Cmaj7"></music-harmony>
          <music-note pitch="C4"></music-note><music-note pitch="C4"></music-note><music-note pitch="C4"></music-note><music-note pitch="C7"></music-note>
        </music-measure>
      </music-staff>`, 680);
      noErrors(root);
      const svg = root.shadowRoot!.querySelector<SVGSVGElement>('.screen svg')!;
      const harmony = svg.querySelector<SVGGElement>('g.vf-music-annotation')!;
      const box = unionInk(visibleInk(harmony, svg))!;
      const top = Number(svg.querySelector<SVGGElement>('g.vf-music-staff')!.dataset.topLine);
      assert(top - box.y - box.height < 14, 'A distant ledger note lifted an unrelated harmony symbol.');
      root.innerHTML = `<music-measure><music-harmony text="Cmaj7"></music-harmony><music-note pitch="C7" duration="whole" tie="start"></music-note></music-measure>
        <music-measure break-before="line" key="G" clef="alto"><music-harmony text="Cmaj7"></music-harmony><music-note pitch="C7" duration="whole" tie="end" accidental-display="courtesy"></music-note></music-measure>`;
      await waitForRender(root.renderComplete, 'Ties under harmony across changed clef and key');
      noErrors(root);
      for (const row of root.shadowRoot!.querySelectorAll('.screen .system-row')) {
        const svg = row.querySelector('svg')!;
        const annotation = unionInk(visibleInk(row.querySelector<SVGGElement>('g.vf-music-annotation')!, svg))!;
        const obstacles = [...row.querySelectorAll<SVGGElement>('g.vf-music-event,g.vf-music-tie')].flatMap(group => visibleInk(group, svg));
        for (const obstacle of obstacles) {
          if (annotation.x >= obstacle.x + obstacle.width + 3 || obstacle.x >= annotation.x + annotation.width + 3) continue;
          assert(obstacle.y - annotation.y - annotation.height >= 7.5, 'Harmony collides with a real note or continuation tie.');
        }
      }
      checkJoins(root);
      sourceCoverage(root);
      checkBounds(root);
      return 'Unrelated ledger notes do not move harmony; overlapping notes and both tie halves receive real clearance, including a changed header.';
    },
  },
  {
    name: 'Different polyphonic rests retain every written value, dot and voice',
    async run() {
      const cases = [
        {
          name: 'Quarter versus dotted quarter, different elapsed times',
          voices: `<music-voice><music-rest duration="quarter"></music-rest><music-note pitch="C5" duration="half" dotted></music-note></music-voice>
            <music-voice><music-rest duration="quarter" dotted></music-rest><music-note pitch="G4" duration="eighth"></music-note><music-note pitch="G4" duration="half"></music-note></music-voice>`,
        },
        {
          name: 'Plain quarter versus dotted tuplet quarter, equal elapsed times',
          voices: `<music-voice><music-rest duration="quarter"></music-rest><music-note pitch="C4" duration="half" dotted></music-note></music-voice>
            <music-voice><music-tuplet actual="3" normal="2"><music-rest duration="quarter" dotted></music-rest></music-tuplet><music-note pitch="E4" duration="half" dotted></music-note></music-voice>`,
        },
        {
          name: 'Three voices with different rests',
          voices: `<music-voice><music-rest duration="quarter"></music-rest><music-note pitch="C5" duration="half" dotted></music-note></music-voice>
            <music-voice><music-rest duration="half"></music-rest><music-note pitch="E4" duration="half"></music-note></music-voice>
            <music-voice><music-rest duration="eighth"></music-rest><music-note pitch="G4" duration="eighth"></music-note><music-note pitch="G4" duration="half" dotted></music-note></music-voice>`,
        },
        {
          name: 'Different rests alongside a concurrent pitched voice',
          voices: `<music-voice><music-rest duration="quarter"></music-rest><music-note pitch="C5" duration="half" dotted></music-note></music-voice>
            <music-voice><music-rest duration="quarter" dotted></music-rest><music-note pitch="D4" duration="eighth"></music-note><music-note pitch="D4" duration="half"></music-note></music-voice>
            <music-voice><music-note pitch="E4" duration="whole"></music-note></music-voice>`,
        },
        {
          name: 'Full-measure versus ordinary whole rest',
          voices: '<music-voice><music-rest measure></music-rest></music-voice><music-voice><music-rest duration="whole"></music-rest></music-voice>',
        },
      ];
      let checked = 0;
      for (const entry of cases) {
        const { root } = await mount(`Polyphonic rests: ${entry.name}`, `<music-measure label="${entry.name}">${entry.voices}</music-measure>`, 680);
        noErrors(root, entry.name);
        const events = allEvents(root);
        const groups = eventGroups(root);
        for (const event of events.filter(event => event.kind === 'rest')) {
          const group = groups.find(group => group.dataset.sourceId === event.id)!;
          assert(!group.dataset.coalescedWith, `${entry.name}: a distinct rest was incorrectly merged.`);
          const ink = visibleInk(group, group.ownerSVGElement!);
          assert(ink.length > 0, `${entry.name}: rest ${event.id} has no visible glyph.`);
          equal((group.textContent ?? '').split('\uE1E7').length - 1, event.measureRest ? 0 : event.dots,
            `${entry.name}: every authored rest dot must remain attached to its own source group`);
          if (event.duration === 'quarter' || event.duration === 'eighth') {
            equal(group.querySelectorAll('g.vf-stavenote > path').length, 0, `${entry.name}: displaced quarter/eighth rests must not acquire misleading ledger lines`);
          }
          for (const other of events.filter(other => other.id !== event.id && formatRational(other.onset) === formatRational(event.onset))) {
            const otherGroup = groups.find(group => group.dataset.sourceId === other.id)!;
            const otherInk = visibleInk(otherGroup, otherGroup.ownerSVGElement!);
            for (const box of ink) for (const obstacle of otherInk) {
              assert(!(box.x < obstacle.x + obstacle.width + 1 && obstacle.x < box.x + box.width + 1
                && box.y < obstacle.y + obstacle.height + 1 && obstacle.y < box.y + box.height + 1),
              `${entry.name}: restored rest ink overlaps another voice's notation.`);
            }
          }
          checked++;
        }
        sourceCoverage(root);
        checkBounds(root);
      }
      return `${checked} distinct rests across five polyphonic cases retain their written glyphs, dots, exact times and separate source identities without overlapping another voice.`;
    },
  },
];

async function run(): Promise<void> {
  button.disabled = true;
  fixtures.replaceChildren();
  results.replaceChildren();
  alignment = undefined;
  metrics = { boundingBoxes: 0, svgSystems: 0, matrixCases: 0 };
  summary.dataset.state = 'running';
  summary.textContent = `Running ${tests.length} browser regression checks…`;
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}. No external font service or test framework is used by this page.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    const item = document.createElement('li');
    item.dataset.state = 'running';
    const name = document.createElement('strong');
    name.textContent = `Running: ${test.name}`;
    item.append(name);
    results.append(item);
    summary.textContent = `Running ${index + 1} of ${tests.length}: ${test.name}`;
    try {
      const detail = await test.run();
      item.dataset.state = 'passed';
      name.textContent = `PASS — ${test.name}`;
      const explanation = document.createElement('div');
      explanation.textContent = detail;
      item.append(explanation);
      report.push({ name: test.name, passed: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      item.dataset.state = 'failed';
      name.textContent = `FAIL — ${test.name}`;
      const explanation = document.createElement('pre');
      explanation.textContent = detail;
      item.append(explanation);
      report.push({ name: test.name, passed: false, detail });
    }
  }
  const passed = report.filter(result => result.passed).length;
  const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed';
  summary.textContent = `${passed}/${tests.length} browser regressions passed${failed ? `; ${failed} failed` : ''}. ${metrics.matrixCases} matrix cases; ${metrics.boundingBoxes} visible-ink bounds checks across ${metrics.svgSystems} rendered systems. Fixtures remain below for visual review.`;
  // Machine-readable results are also exposed as ordinary page output, for CI or
  // browser inspection without requiring access to component internals.
  let output = document.querySelector<HTMLScriptElement>('#browser-results');
  if (!output) {
    output = document.createElement('script');
    output.id = 'browser-results';
    output.type = 'application/json';
    document.body.append(output);
  }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, metrics, results: report }, null, 2);
  button.disabled = false;
}

button.addEventListener('click', () => { void run(); });
