import '../src/components/index.js';
import type { MusicSurface } from '../src/components/index.js';
import type { MusicArticulation, MusicInterval } from '../src/components/music-event-markings.js';
import { readScore } from '../src/dom/index.js';
import { formatRational, harmonyIntervalOffset, harmonyIntervalText } from '../src/model/index.js';
import type { EventMarking, MusicEvent, Score } from '../src/model/types.js';
import { transformInk, unionInk, visibleInk } from '../src/engraving/geometry.js';
import type { InkBox } from '../src/engraving/geometry.js';

interface Fixture { container: HTMLElement; root: MusicSurface }
interface Test { name: string; run: () => Promise<string> }
interface Result { name: string; passed: boolean; detail: string }

const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const nativeClickStatus = document.querySelector<HTMLElement>('#native-click-status')!;
const nativeClickInstructions = nativeClickStatus.textContent!;
let activeClick: { trusted: boolean; sourceChain: string[] } | undefined;
let demo: Fixture | undefined;
let dense: Fixture | undefined;

// Direct SMuFL symbols, not the engraving engine's sometimes ambiguous aliases.
const articulations = {
  accent: ['\uE4A0', '\uE4A1'], staccato: ['\uE4A2', '\uE4A3'], tenuto: ['\uE4A4', '\uE4A5'],
  staccatissimo: ['\uE4A6', '\uE4A7'], marcato: ['\uE4AC', '\uE4AD'], fermata: ['\uE4C0', '\uE4C1'],
} as const;
const ornaments = {
  trill: '\uE566', turn: '\uE567', 'inverted-turn': '\uE568', 'upper-mordent': '\uE56C', 'lower-mordent': '\uE56D',
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}

function close(actual: number, expected: number, message: string, tolerance = 0.1): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual} (tolerance ${tolerance}px).`);
}

async function bounded(promise: Promise<unknown>, label: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} did not finish within 20 seconds.`)), 20_000);
    })]);
  } finally { clearTimeout(timeout); }
}

async function settle(root: MusicSurface): Promise<void> {
  await bounded(root.refresh(), 'Refresh notation');
  await bounded(root.renderComplete, 'Complete notation');
}

async function mount(title: string, markup: string, width = 820): Promise<Fixture> {
  const article = document.createElement('article');
  article.className = 'fixture';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const container = document.createElement('div');
  container.className = 'score-container';
  container.style.width = `${width}px`;
  container.innerHTML = markup;
  const root = container.firstElementChild as MusicSurface;
  assert(root && typeof root.refresh === 'function', 'Fixture requires a registered music surface.');
  const selection = document.createElement('p');
  selection.className = 'fixture-note native-selection-readout';
  selection.textContent = 'No selection observed in this fixture.';
  const clickOrigin = document.createElement('p');
  clickOrigin.className = 'fixture-note click-origin-readout';
  clickOrigin.textContent = 'No originating click observed in this fixture.';
  viewport.append(container);
  article.append(heading, viewport, clickOrigin, selection);
  fixtures.append(article);
  await settle(root);
  return { container, root };
}

function scoreOf(root: MusicSurface): Score {
  assert(root.score, 'The component did not publish its score.');
  return root.score;
}

function eventsOf(root: MusicSurface): MusicEvent[] {
  return scoreOf(root).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
}

function markingsOf(root: MusicSurface): { event: MusicEvent; marking: EventMarking }[] {
  return eventsOf(root).flatMap(event => (event.markings ?? []).map(marking => ({ event, marking })));
}

function unmarkedEvents(root: MusicSurface) {
  return eventsOf(root).map(({ markings: _markings, ...event }) => event);
}

function noErrors(root: MusicSurface): void {
  const errors = root.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(errors.length === 0, errors.map(error => `${error.code}: ${error.message} [${error.sourceId}]`).join('\n'));
  assert(root.shadowRoot!.querySelector('.screen svg'), 'Validated music has no SVG.');
}

function sourceGroup(root: MusicSurface, id: string, marking = false): SVGGElement {
  const selector = marking ? '.screen g.vf-music-marking' : '.screen g.vf-music-event';
  const group = [...root.shadowRoot!.querySelectorAll<SVGGElement>(selector)].find(candidate => candidate.dataset.sourceId === id);
  assert(group, `No rendered ${marking ? 'marking' : 'event'} group for ${id}.`);
  return group;
}

function inkOf(group: SVGGElement): InkBox {
  const ink = unionInk(visibleInk(group, group.ownerSVGElement!));
  assert(ink && ink.width > 0 && ink.height > 0, `${group.dataset.sourceId}: no visible ink.`);
  return ink;
}

function requireGlyph(group: SVGGElement, glyph: string): void {
  const leaves = [...group.querySelectorAll<SVGTextElement>('text')].filter(text => text.textContent?.includes(glyph));
  assert(leaves.length > 0, `${group.dataset.sourceId}: expected glyph U+${glyph.codePointAt(0)?.toString(16)}.`);
  assert(leaves.some(text => getComputedStyle(text).fontFamily.includes('Bravura')), 'A music symbol was replaced with ordinary text.');
  assert(unionInk(leaves.flatMap(text => visibleInk(text, group.ownerSVGElement!))), 'The expected music glyph has no painted ink.');
}

function roadHead(root: MusicSurface, event: MusicEvent): InkBox {
  const group = sourceGroup(root, event.id);
  const glyph = event.duration === 'breve' ? '\uE10A' : event.duration === 'whole' ? '\uE102' : event.duration === 'half' ? '\uE103' : '\uE100';
  const ink = unionInk([...group.querySelectorAll<SVGTextElement>('g.vf-notehead text')]
    .filter(text => text.textContent?.includes(glyph) && !text.closest('g.vf-music-marking'))
    .flatMap(text => visibleInk(text, group.ownerSVGElement!)));
  assert(ink, `No actual slash head for ${event.id}.`);
  return ink;
}

function printedEvent(root: MusicSurface, event: MusicEvent): { head: InkBox; stem?: InkBox; direction: 'up' | 'down' | 'none' } {
  const group = sourceGroup(root, event.id);
  const head = unionInk([...group.querySelectorAll<SVGGElement>('g.vf-notehead')]
    .filter(notehead => !notehead.closest('g.vf-music-marking'))
    .flatMap(notehead => notehead.firstElementChild instanceof SVGGraphicsElement
      ? visibleInk(notehead.firstElementChild, group.ownerSVGElement!) : []));
  assert(head, `${event.id}: no painted head or rest glyph.`);
  const stemId = group.dataset.stemId;
  assert(stemId, `${event.id}: no engine stem identity for independent painted-stem inspection.`);
  // A beam draws its stems outside the event group. The engine stem ID only
  // locates that object; it does not claim that a stem was actually painted.
  const staff = group.closest<SVGGElement>('g.vf-music-staff')!;
  const stemGroup = [...staff.querySelectorAll<SVGGElement>('g.vf-stem')].find(stem => stem.id === stemId);
  const stem = stemGroup ? unionInk(visibleInk(stemGroup, group.ownerSVGElement!)) : undefined;
  const direction = stem ? stem.y + stem.height / 2 < head.y + head.height / 2 ? 'up' : 'down' : 'none';
  return { head, stem, direction };
}

function checkWorkbookRoadMarks(root: MusicSurface): void {
  const staff = scoreOf(root).staves.find(candidate => candidate.id === 'marked-road-part');
  assert(staff, 'The actual workbook lost its marked road part.');
  const roads = staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)).filter(event => event.kind === 'road');
  for (const [event, type] of [[roads[1], 'staccato'], [roads.at(-1), 'tenuto']] as const) {
    assert(event, `The workbook has no road event for the ${type} regression.`);
    const marking = event.markings?.find(mark => mark.kind === 'articulation' && mark.type === type);
    assert(marking, `${event.id}: the expected ${type} is missing.`);
    const printed = printedEvent(root, event);
    equal(printed.direction, 'down', `Workbook road ${type} keeps its actual downward stem`);
    const group = sourceGroup(root, marking.id, true);
    equal(group.dataset.placement, 'above', `Workbook road ${type} must be above its head`);
    const ink = inkOf(group);
    assert(ink.y + ink.height < printed.head.y, `Workbook road ${type} moved below its down-stem head.`);
    const belowHarmony = event.markings?.find(mark => mark.kind === 'interval' && mark.placement === 'below');
    assert(belowHarmony, `Workbook road ${type} no longer exercises an independent lower harmony.`);
    const harmonyInk = inkOf(sourceGroup(root, belowHarmony.id, true));
    assert(harmonyInk.y > printed.head.y + printed.head.height, 'The below harmony must not follow a standard marking above the head.');
  }
}

function checkBounds(root: MusicSurface, surface = '.screen'): void {
  for (const svg of root.shadowRoot!.querySelectorAll<SVGSVGElement>(`${surface} svg`)) {
    const ink = unionInk(visibleInk(svg));
    assert(ink, 'System has no painted notation.');
    const view = svg.viewBox.baseVal;
    assert([ink.x, ink.y, ink.width, ink.height, view.width, view.height].every(Number.isFinite)
      && ink.x >= view.x - 0.5 && ink.y >= view.y - 0.5
      && ink.x + ink.width <= view.x + view.width + 0.5 && ink.y + ink.height <= view.y + view.height + 0.5,
    `Painted notation exceeds its SVG: ${JSON.stringify(ink)}; viewBox ${svg.getAttribute('viewBox')}.`);
  }
}

function coverage(root: MusicSurface): void {
  const events = eventsOf(root);
  const entries = markingsOf(root);
  equal([...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-event')].map(group => group.dataset.sourceId).sort(),
    events.map(event => event.id).sort(), 'Every event has one rendered source group');
  equal(root.getHitRegions().map(hit => hit.sourceId).sort(), events.map(event => event.id).sort(), 'Hit regions remain event-based');
  const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-marking')];
  equal(groups.map(group => group.dataset.sourceId).sort(), entries.map(({ marking }) => marking.id).sort(), 'Every child marking is rendered once');
  const geometry = root.getLayoutGeometry();
  assert(geometry, 'No completed geometry was published.');
  const measured = geometry.systems.flatMap(system => system.markings ?? []);
  equal(measured.map(marking => marking.sourceId).sort(), entries.map(({ marking }) => marking.id).sort(), 'Child marking geometry retains each source identity');
  for (const { event, marking } of entries) {
    const group = sourceGroup(root, marking.id, true);
    const source = root.getSource(marking.id);
    assert(source && source.parentElement === root.getSource(event.id), `${marking.id}: source is not attached to its original event.`);
    equal(group.dataset.eventId, event.id, `${marking.id}: rendered owner`);
    equal(group.dataset.kind, marking.kind, `${marking.id}: marking kind`);
    assert(group.closest('g.vf-music-event') === sourceGroup(root, event.id), 'A marking became a detached staff-wide annotation.');
    const ink = inkOf(group);
    const targets = [...group.querySelectorAll<SVGRectElement>(':scope > rect[data-marking-hit]')];
    equal(targets.length, 1, `${marking.id}: one exact marking target is required`);
    const target = targets[0];
    equal(getComputedStyle(target).pointerEvents, root.localName === 'music-system' ? 'none' : 'all',
      `${marking.id}: system ink stays pointer-inert while standalone staff marking targets remain active`);
    equal(Number(getComputedStyle(target).opacity), 0, `${marking.id}: pointer target does not add visible ink`);
    assert([...group.querySelectorAll('text')].every(text => getComputedStyle(text).pointerEvents === 'none'),
      `${marking.id}: the music font's oversized text cells must not intercept nearby clicks.`);
    const svgMatrix = group.ownerSVGElement!.getCTM();
    const targetMatrix = target.getCTM();
    assert(svgMatrix && targetMatrix, `${marking.id}: pointer geometry has no completed transform.`);
    const targetInk = transformInk(target.getBBox(), svgMatrix.inverse().multiply(targetMatrix));
    for (const key of ['x', 'y', 'width', 'height'] as const) close(targetInk[key], ink[key], `${marking.id}: pointer target matches actual ${key} ink`, 0.2);
    const recorded = measured.find(entry => entry.sourceId === marking.id)!;
    equal(recorded.eventId, event.id, 'Public marking geometry identifies its event');
    for (const key of ['x', 'y', 'width', 'height'] as const) close(recorded[key], ink[key], `${marking.id}: actual ${key} geometry`, 0.2);
    equal(recorded.placement, group.dataset.placement, 'Public geometry records the rendered marking side');
    if (marking.kind === 'interval') equal(group.dataset.placement, marking.placement, 'An interval retains its authored musical direction');
    else {
      const printed = printedEvent(root, event);
      const side = printed.direction === 'up' ? 'below' : 'above';
      equal(group.dataset.placement, side, `${marking.id}: standard markings are opposite the actual stem, or above if stemless`);
      assert(side === 'above' ? ink.y + ink.height < printed.head.y : ink.y > printed.head.y + printed.head.height,
        `${marking.id}: standard marking is not on the required side of its actual head.`);
      if (marking.kind === 'articulation') requireGlyph(group, articulations[marking.type][side === 'above' ? 0 : 1]);
    }
  }
}

function checkIntervals(root: MusicSurface): number {
  let checked = 0;
  for (const { event, marking } of markingsOf(root)) {
    if (marking.kind !== 'interval') continue;
    const group = sourceGroup(root, marking.id, true);
    const figure = inkOf(group);
    const head = roadHead(root, event);
    const center = head.x + head.width / 2;
    equal(event.pitches, [], 'An interval figure must not turn a chosen road pitch into a stored absolute pitch');
    equal(group.dataset.interval, harmonyIntervalText(marking.interval), 'Rendered interval retains its canonical figure');
    assert(marking.placement === 'above' ? figure.y + figure.height < head.y : figure.y > head.y + head.height,
      `${marking.id}: figure moved to the wrong side of its actual head.`);
    // A narrow shift can clear an intersecting stem, while the head remains
    // within the figure's horizontal span and its pitch direction never flips.
    close(figure.x + figure.width / 2, center, `${marking.id}: figure remains attached to its head`, 4.1);
    assert(center >= figure.x - 0.2 && center <= figure.x + figure.width + 0.2,
      `${marking.id}: figure no longer spans its owning head center.`);
    if (marking.interval.alter === -1) requireGlyph(group, '\uE260');
    if (marking.interval.alter === 1) requireGlyph(group, '\uE262');
    assert(group.textContent!.includes(String(marking.interval.number)), 'An interval figure lost its number.');
    checked++;
  }
  assert(checked > 0, 'No interval figures were tested.');
  return checked;
}

function overlap(a: InkBox, b: InkBox, gap = 0.5): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
    && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

function checkCollisions(root: MusicSurface): number {
  let comparisons = 0;
  for (const svg of root.shadowRoot!.querySelectorAll<SVGSVGElement>('.screen svg')) {
    const markings = [...svg.querySelectorAll<SVGGElement>('g.vf-music-marking')].map(group => ({ id: group.dataset.sourceId!, ink: inkOf(group) }));
    // Tuplet number ink is tested separately from the hollow bracket's large
    // bounding box. The adapter conservatively clears the beam's full bounds,
    // including the sloped beam across three different roads in this fixture.
    const obstacles = [...svg.querySelectorAll<SVGGraphicsElement>(
      'g.vf-notehead text, g.vf-notehead path, g.vf-stem path, g.vf-music-beams path, g.vf-music-tuplet text, g.vf-music-tie path, g.vf-stave > path',
    )].filter(leaf => !leaf.closest('g.vf-music-marking')).flatMap(leaf => visibleInk(leaf, svg));
    for (const [index, marking] of markings.entries()) {
      for (const other of markings.slice(index + 1)) {
        assert(!overlap(marking.ink, other.ink), `Markings ${marking.id} and ${other.id} overlap.`);
        comparisons++;
      }
      for (const obstacle of obstacles) {
        assert(!overlap(marking.ink, obstacle), `${marking.id} collides with a head, stem, beam, tuplet number, tie, or visible staff line: ${JSON.stringify({ marking: marking.ink, obstacle })}.`);
        comparisons++;
      }
    }
  }
  return comparisons;
}

async function demoFixture(): Promise<Fixture> {
  if (demo) return demo;
  const response = await fetch('/index.html');
  assert(response.ok, 'Could not read the real workbook.');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const study = doc.querySelector('#event-markings-study');
  assert(study, 'The workbook has no event-marking study.');
  demo = await mount('Actual workbook: mark the attack; add a harmony', study.outerHTML);
  return demo;
}

async function denseFixture(): Promise<Fixture> {
  if (dense) return dense;
  dense = await mount('Dense combinations: interval figures, marks, beams, a tuplet, and a held harmony', `
    <music-staff id="dense-marked-roads" notation="three-roads" label="Dense" print-width="680">
      <music-measure meter="4/4">
        <music-tuplet actual="3" normal="2" ratio bracket="yes">
          <music-road id="dense-first" direction="higher" duration="eighth" stem="up">
            <music-interval id="dense-first-five" value="5" placement="above"></music-interval>
            <music-interval value="b3" placement="below"></music-interval>
            <music-articulation type="staccato" placement="above"></music-articulation>
            <music-ornament type="trill" placement="above"></music-ornament>
          </music-road>
          <music-road direction="same" duration="eighth" stem="up"><music-interval value="#11" placement="above"></music-interval><music-articulation type="accent" placement="below"></music-articulation></music-road>
          <music-road direction="lower" duration="eighth" stem="up"><music-interval value="13" placement="below"></music-interval><music-ornament type="turn" placement="above"></music-ornament></music-road>
        </music-tuplet>
        <music-road direction="higher" duration="quarter"><music-interval value="3" placement="above"></music-interval><music-articulation type="staccato" placement="above"></music-articulation></music-road>
        <music-road id="dense-tie-start" direction="lower" duration="half" tie="start">
          <music-interval id="dense-start-five" value="5" placement="above"></music-interval>
          <music-interval id="dense-start-third" value="b3" placement="below"></music-interval>
          <music-articulation id="dense-attack" type="accent" placement="above"></music-articulation>
        </music-road>
      </music-measure>
      <music-measure break-before="line" end-bar="final">
        <music-road id="dense-tie-end" direction="same" duration="half" tie="end">
          <music-interval id="dense-end-third" value="b3" placement="below"></music-interval>
          <music-interval id="dense-end-five" value="5" placement="above"></music-interval>
          <music-articulation id="dense-release" type="tenuto" placement="below"></music-articulation>
          <music-articulation type="fermata" placement="above"></music-articulation>
        </music-road>
        <music-road direction="higher" duration="quarter"><music-articulation type="staccatissimo" placement="below"></music-articulation><music-interval value="#11" placement="below"></music-interval><music-ornament type="upper-mordent"></music-ornament></music-road>
        <music-road direction="lower" duration="quarter"><music-interval value="13" placement="above"></music-interval><music-articulation type="marcato" placement="above"></music-articulation></music-road>
      </music-measure>
    </music-staff>`, 680);
  return dense;
}

function snapshot(root: MusicSurface, surface = '.screen') {
  return [...root.shadowRoot!.querySelectorAll<HTMLElement>(`${surface} .system-row`)].map(row => ({
    start: row.dataset.startMeasure, end: row.dataset.endMeasure, viewBox: row.querySelector('svg')!.getAttribute('viewBox'),
    events: [...row.querySelectorAll<SVGGElement>('g.vf-music-event')].map(group => ({ id: group.dataset.sourceId, x: group.dataset.x })),
    markings: [...row.querySelectorAll<SVGGElement>('g.vf-music-marking')].map(group => ({
      id: group.dataset.sourceId, kind: group.dataset.kind, placement: group.dataset.placement, transform: group.getAttribute('transform'),
      text: group.textContent, ink: inkOf(group),
    })),
    ties: [...row.querySelectorAll<SVGPathElement>('g.vf-music-tie path')].map(path => path.getAttribute('d')),
  }));
}

async function resizeObserved(fixture: Fixture, width: number): Promise<void> {
  const rendered = new Promise<void>(resolve => fixture.root.addEventListener('notation-render', () => resolve(), { once: true }));
  fixture.container.style.width = `${width}px`;
  await bounded(rendered, `Native resize to ${width}px`);
  await bounded(fixture.root.renderComplete, 'Complete native resize');
}

const tests: Test[] = [
  {
    name: 'Articulations follow actual stems; stemless notes and rests use above glyphs',
    run: async () => {
      const types = Object.keys(articulations) as (keyof typeof articulations)[];
      const { root } = await mount('Articulation glyph matrix: opposite actual stems, even with conflicting legacy placements', `<music-staff id="articulation-matrix" clef="treble" max-measures="2">
        ${types.map(type => `<music-measure meter="2/4"><music-note pitch="C5" duration="quarter" stem="down"><music-articulation id="${type}-above" type="${type}" placement="below"></music-articulation></music-note><music-note pitch="A4" duration="quarter" stem="up"><music-articulation id="${type}-below" type="${type}" placement="above"></music-articulation></music-note></music-measure>`).join('')}
        <music-measure meter="4/4" end-bar="final"><music-rest duration="half"><music-articulation id="rest-fermata" type="fermata" placement="below"></music-articulation></music-rest><music-slash duration="half"><music-articulation id="open-fermata" type="fermata" placement="below"></music-articulation></music-slash></music-measure>
      </music-staff>`);
      noErrors(root);
      for (const type of types) for (const [index, side] of ['above', 'below'].entries()) {
        requireGlyph(sourceGroup(root, `${type}-${side}`, true), articulations[type][index]);
      }
      requireGlyph(sourceGroup(root, 'rest-fermata', true), articulations.fermata[0]);
      requireGlyph(sourceGroup(root, 'open-fermata', true), articulations.fermata[0]);
      for (const side of ['above', 'below']) assert(!sourceGroup(root, `staccato-${side}`, true).textContent!.includes('\uE1E7'), 'A staccato was replaced by an augmentation dot.');
      coverage(root);
      checkBounds(root);
      const polyphony = await mount('Two stemless voices: full-measure rests both take fermatas above', `<music-staff id="marked-rest-voices" notation="three-roads" label="Holds">
        <music-measure meter="4/4" end-bar="final">
          <music-voice><music-rest id="upper-marked-rest" measure><music-articulation id="upper-auto-fermata" type="fermata" placement="below"></music-articulation></music-rest></music-voice>
          <music-voice><music-rest id="lower-marked-rest" measure><music-articulation id="lower-auto-fermata" type="fermata" placement="below"></music-articulation></music-rest></music-voice>
        </music-measure>
      </music-staff>`, 540);
      noErrors(polyphony.root);
      for (const voice of ['upper', 'lower']) {
        const rest = sourceGroup(polyphony.root, `${voice}-marked-rest`);
        const fermata = sourceGroup(polyphony.root, `${voice}-auto-fermata`, true);
        assert(!rest.dataset.coalescedWith, 'Individually marked rests must not merge into one printed rest.');
        const headInk = unionInk([...rest.querySelectorAll<SVGTextElement>('g.vf-notehead text')]
          .filter(text => !text.closest('g.vf-music-marking') && /[\uE4E3\uE4F4]/u.test(text.textContent ?? ''))
          .flatMap(text => visibleInk(text, rest.ownerSVGElement!)));
        assert(headInk, `${voice}: a full-measure rest lost its own visible rest glyph.`);
        requireGlyph(fermata, articulations.fermata[0]);
        const event = eventsOf(polyphony.root).find(candidate => candidate.id === `${voice}-marked-rest`)!;
        equal(printedEvent(polyphony.root, event).direction, 'none', 'Full-measure rests have no actual stem');
        equal(fermata.dataset.placement, 'above', 'A stemless fermata is above, regardless of voice or legacy placement');
        const markInk = inkOf(fermata);
        assert(markInk.y + markInk.height < headInk.y, `${voice}: a stemless fermata must be above its rest.`);
        equal(formatRational(event.time), '1', 'A fermata does not change the full-measure rest time');
      }
      coverage(polyphony.root);
      checkCollisions(polyphony.root);
      checkBounds(polyphony.root);
      const wholes = await mount('Two stemless whole notes: no virtual voice direction may put a mark below', `<music-staff id="marked-whole-voices" clef="treble" label="Whole">
        <music-measure meter="4/4" end-bar="final">
          <music-voice><music-note id="upper-marked-whole" pitch="G5" duration="whole" stem="up"><music-articulation type="fermata" placement="below"></music-articulation></music-note></music-voice>
          <music-voice><music-note id="lower-marked-whole" pitch="C4" duration="whole" stem="down"><music-articulation type="fermata" placement="below"></music-articulation><music-ornament type="trill" placement="below"></music-ornament></music-note></music-voice>
        </music-measure>
      </music-staff>`, 540);
      noErrors(wholes.root);
      for (const event of eventsOf(wholes.root)) equal(printedEvent(wholes.root, event).direction, 'none', 'Whole notes have no actual stem even with an authored stem preference');
      coverage(wholes.root);
      checkCollisions(wholes.root);
      checkBounds(wholes.root);
      return 'All six articulations use glyphs opposite actual stems; half rests, open slashes, both full-rest voices, and both whole-note voices put standard markings above without changing written time.';
    },
  },
  {
    name: 'Ornaments preserve upper/lower mordent and inverted-turn meaning',
    run: async () => {
      const types = Object.keys(ornaments) as (keyof typeof ornaments)[];
      const { root } = await mount('Ornament glyph matrix: trill, turns, and distinct mordents', `<music-staff id="ornament-matrix" clef="treble" max-measures="2">
        ${types.map(type => `<music-measure meter="4/4"><music-note pitch="G5" duration="half" stem="down"><music-ornament id="${type}-upper" type="${type}" placement="below"></music-ornament></music-note><music-note pitch="E4" duration="half" stem="up"><music-ornament id="${type}-lower" type="${type}" placement="above"></music-ornament></music-note></music-measure>`).join('')}
      </music-staff>`);
      noErrors(root);
      for (const type of types) for (const side of ['upper', 'lower']) requireGlyph(sourceGroup(root, `${type}-${side}`, true), ornaments[type]);
      assert(!sourceGroup(root, 'inverted-turn-upper', true).textContent!.includes('\uE569'), 'Inverted turn was replaced with a different slashed-turn glyph.');
      assert(!sourceGroup(root, 'upper-mordent-upper', true).textContent!.includes('\uE56D'), 'Upper mordent acquired the lower-mordent bar.');
      coverage(root);
      checkBounds(root);
      return 'All five ornaments remain opposite the actual stem despite conflicting legacy placement; upper E56C, lower E56D, and inverted-turn E568 retain their exact symbols.';
    },
  },
  {
    name: 'Interval figures stay above/below the actual head on all three roads',
    run: async () => {
      const { root } = await mount('Harmonies from a chosen main pitch: all three roads and compound intervals', `<music-staff id="interval-road-matrix" notation="three-roads" label="Harmony" max-measures="2">
        ${['higher', 'same', 'lower'].map(direction => `<music-measure meter="4/4"><music-road id="interval-${direction}" direction="${direction}" duration="whole"><music-interval id="fifth-${direction}" value="5" placement="above"></music-interval><music-interval id="third-${direction}" value="♭3" placement="below"></music-interval></music-road></music-measure>`).join('')}
        <music-measure end-bar="final"><music-road direction="same" duration="whole"><music-interval value="5" placement="above"></music-interval><music-interval value="9" placement="above"></music-interval><music-interval id="compound-eleventh" value="♯11" placement="above"></music-interval><music-interval id="compound-thirteenth" value="13" placement="below"></music-interval></music-road></music-measure>
      </music-staff>`);
      noErrors(root);
      const count = checkIntervals(root);
      const entries = new Map(markingsOf(root).map(({ marking }) => [marking.id, marking]));
      const fifth = entries.get('fifth-same')!;
      const third = entries.get('third-same')!;
      const thirteenth = entries.get('compound-thirteenth')!;
      assert(fifth.kind === 'interval' && third.kind === 'interval' && thirteenth.kind === 'interval', 'Interval data was lost.');
      equal(harmonyIntervalOffset(fifth.interval, fifth.placement), 7, '5 above F reaches C above');
      equal(harmonyIntervalOffset(third.interval, third.placement), -3, 'b3 below Bb reaches G below');
      equal(harmonyIntervalOffset(thirteenth.interval, thirteenth.placement), -21, '13 retains its compound descending distance');
      const html = root.toHTML();
      assert(html.includes('value="b3"') && html.includes('value="#11"'), 'Unicode interval aliases did not canonicalize.');
      const transcript = root.shadowRoot!.querySelector('.transcript')!.textContent!;
      assert(transcript.includes('minor third below the main pitch') && transcript.includes('major thirteenth below the main pitch'), 'Interval qualities/directions are missing from accessible text.');
      assert(transcript.includes('Harmony tones and ornament auxiliaries do not change that reference'), 'The main-pitch reference rule is ambiguous.');
      coverage(root);
      checkBounds(root);
      return `${count} independent interval figures remain attached to their own heads; the user’s fifth/minor-third examples and compound thirteenth retain the right distances.`;
    },
  },
  {
    name: 'Dense marks clear heads, stems, staff lines, beams, tuplet numbers, and split ties',
    run: async () => {
      const { root } = await denseFixture();
      noErrors(root);
      coverage(root);
      checkIntervals(root);
      const comparisons = checkCollisions(root);
      const first = eventsOf(root).find(event => event.id === 'dense-first')!;
      equal(formatRational(first.time), '1/12', 'A marked triplet eighth keeps its exact elapsed time');
      equal(first.duration, 'eighth', 'A marked triplet keeps its written value');
      equal(eventsOf(root).slice(0, 3).map(event => event.pitchDirection), ['higher', 'same', 'lower'], 'The marked triplet crosses all three roads');
      assert(root.shadowRoot!.querySelector('.screen g.vf-music-beams path'), 'The dense fixture did not contain an actual beam.');
      const ties = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-tie')]
        .filter(group => group.dataset.startSourceId === 'dense-tie-start' && group.dataset.endSourceId === 'dense-tie-end');
      equal(ties.map(group => group.dataset.boundary).sort(), ['incoming', 'outgoing'], 'Both halves of the held harmony tie are drawn');
      checkBounds(root);
      return `${comparisons} bounds comparisons preserve separate markings and nearby musical ink; the tuplet and held harmony keep exact time and both tie halves.`;
    },
  },
  {
    name: 'Tied harmonies compare complete sets without relocating articulation children',
    run: async () => {
      const { root } = await denseFixture();
      noErrors(root);
      const timeBefore = unmarkedEvents(root);
      equal(sourceGroup(root, 'dense-attack', true).dataset.eventId, 'dense-tie-start', 'The attack mark stays on the authored start');
      equal(sourceGroup(root, 'dense-release', true).dataset.eventId, 'dense-tie-end', 'The release mark stays on the authored end');
      const interval = root.querySelector<MusicInterval>('#dense-end-five')!;
      interval.value = '6';
      await bounded(root.renderComplete, 'Reject changed tied harmony');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'Changing a harmony halfway through a tie was accepted.');
      interval.value = '5';
      await bounded(root.renderComplete, 'Restore tied harmony');
      noErrors(root);
      const parent = interval.parentElement!;
      interval.remove();
      await bounded(root.renderComplete, 'Reject missing tied harmony');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'A missing interval was silently inherited across the tie.');
      parent.append(interval);
      await bounded(root.renderComplete, 'Restore reordered harmony child');
      noErrors(root);
      equal(unmarkedEvents(root), timeBefore, 'Harmony changes never rewrite written time or tie policy');
      assert(root.getSource('dense-end-five') === interval, 'Restoring the same child lost its source identity.');
      coverage(root);
      checkIntervals(root);
      checkBounds(root);
      return 'Changed/missing tied intervals are diagnosed, reordered identical sets are accepted, and attack/release markings remain on their explicitly authored segments.';
    },
  },
  {
    name: 'Workbook marking sides, child edits, and selection preserve musical identity',
    run: async () => {
      const { root } = await demoFixture();
      noErrors(root);
      checkWorkbookRoadMarks(root);
      const before = unmarkedEvents(root);
      const articulation = root.querySelector<MusicArticulation>('music-articulation[type="accent"]')!;
      const entry = markingsOf(root).find(({ marking }) => root.getSource(marking.id) === articulation)!;
      articulation.type = 'staccato';
      await bounded(root.renderComplete, 'Reflect articulation type property');
      noErrors(root);
      equal(articulation.getAttribute('type'), 'staccato', 'Type property reflects source');
      requireGlyph(sourceGroup(root, entry.marking.id, true), articulations.staccato[printedEvent(root, entry.event).direction === 'up' ? 1 : 0]);
      equal(unmarkedEvents(root), before, 'Staccato does not shorten written notes or add rests');
      let selected: { sourceId: string; sourceElement: Element } | undefined;
      root.addEventListener('notation-select', event => { selected = (event as CustomEvent<typeof selected>).detail; }, { once: true });
      sourceGroup(root, entry.marking.id, true).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      assert(selected?.sourceId === entry.marking.id && selected.sourceElement === articulation, 'Marking selection lost the child source identity.');
      articulation.type = 'accent';
      await bounded(root.renderComplete, 'Restore articulation');
      const interval = root.querySelector<MusicInterval>('music-interval[value="#11"]')!;
      interval.value = '♯13';
      await bounded(root.renderComplete, 'Reflect interval alias property');
      noErrors(root);
      assert(root.toHTML().includes('value="#13"'), 'Interval property edit did not reach canonical musical data.');
      interval.value = '14';
      await bounded(root.renderComplete, 'Reject out-of-range interval');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'An out-of-range interval rendered without a diagnostic.');
      interval.value = '#11';
      await bounded(root.renderComplete, 'Repair interval');
      noErrors(root);
      equal(unmarkedEvents(root), before, 'All marking edits preserve musical events and exact time');
      coverage(root);
      checkIntervals(root);
      checkWorkbookRoadMarks(root);
      checkBounds(root);
      return 'The workbook’s second road staccato and final road tenuto sit above their down-stem heads while their lower harmonies stay below; edits, child IDs, exact rhythm, and invalid-value diagnostics are preserved.';
    },
  },
  {
    name: 'Canonical source preserves every attached marking',
    run: async () => {
      const { root } = await demoFixture();
      noErrors(root);
      const doc = new DOMParser().parseFromString(root.toHTML(), 'text/html');
      const reread = readScore(doc.body.firstElementChild!);
      equal(reread.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], 'Canonical source remains valid');
      equal(reread.score, scoreOf(root), 'Canonical roundtrip retains marking types, interval sets, IDs, and time');
      return 'Canonical source keeps the original child markings, source IDs, exact durations, interval sets, and local instructions.';
    },
  },
  {
    name: 'Reflow preserves event attachments and cached fixed-print geometry',
    run: async () => {
      const fixture = await demoFixture();
      await settle(fixture.root);
      const source = fixture.root.innerHTML;
      const before = snapshot(fixture.root);
      const printBefore = snapshot(fixture.root, '.print');
      const printed = [...fixture.root.shadowRoot!.querySelectorAll('.print svg')];
      await resizeObserved(fixture, 330);
      noErrors(fixture.root);
      coverage(fixture.root);
      checkIntervals(fixture.root);
      checkWorkbookRoadMarks(fixture.root);
      checkBounds(fixture.root);
      equal(snapshot(fixture.root, '.print'), printBefore, 'Native screen resizing leaves print markings fixed');
      assert(printed.every((svg, index) => fixture.root.shadowRoot!.querySelectorAll('.print svg')[index] === svg), 'Native resize replaced cached print SVGs.');
      await resizeObserved(fixture, 820);
      equal(snapshot(fixture.root), before, 'Width 820 → 330 → 820 restores the same attachment geometry');
      equal(fixture.root.innerHTML, source, 'Resizing does not rewrite source children');
      fixture.root.setAttribute('print-preview', '');
      await bounded(fixture.root.renderComplete, 'Activate fixed print view');
      equal(fixture.root.getLayoutGeometry()?.projection, 'print', 'Print view exposes print geometry');
      for (const svg of fixture.root.shadowRoot!.querySelectorAll<SVGSVGElement>('.print svg')) assert(svg.viewBox.baseVal.width <= 681, 'The study exceeds its 680px print width.');
      checkBounds(fixture.root, '.print');
      fixture.root.removeAttribute('print-preview');
      await bounded(fixture.root.renderComplete, 'Restore responsive view');
      noErrors(fixture.root);
      return 'Native A→B→A resizing retains child attachments and source, reuses cached print SVGs, and keeps the fixed 680px print projection bounded.';
    },
  },
];

async function run(): Promise<void> {
  button.disabled = true;
  fixtures.replaceChildren();
  results.replaceChildren();
  demo = undefined;
  dense = undefined;
  nativeClickStatus.textContent = nativeClickInstructions;
  delete nativeClickStatus.dataset.sourceId;
  delete nativeClickStatus.dataset.kind;
  delete nativeClickStatus.dataset.trusted;
  activeClick = undefined;
  summary.dataset.state = 'running';
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}. Bundled glyphs and native SVG measurements; no playback or native printing verification.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    summary.textContent = `Running ${index + 1} of ${tests.length}: ${test.name}`;
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = `Running: ${test.name}`;
    item.append(name);
    results.append(item);
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
  summary.textContent = `${passed}/${tests.length} event marking checks passed${failed ? `; ${failed} failed` : ''}. Fixtures remain below for visual review.`;
  let output = document.querySelector<HTMLScriptElement>('#event-markings-browser-results');
  if (!output) {
    output = document.createElement('script');
    output.id = 'event-markings-browser-results';
    output.type = 'application/json';
    document.body.append(output);
  }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, results: report }, null, 2);
  button.disabled = false;
}

button.addEventListener('click', () => { void run(); });

// The component emits a CustomEvent for both real and synthetic selections.
// Report the originating click separately so untrusted bridge/synthetic clicks
// cannot be mistaken for evidence of native browser hit testing.
fixtures.addEventListener('click', event => {
  const sourceChain = event.composedPath()
    .filter((node): node is Element => node instanceof Element && node.hasAttribute('data-source-id'))
    .map(node => `${node.localName}#${node.getAttribute('data-source-id')}`);
  activeClick = { trusted: event.isTrusted, sourceChain };
  const text = `Click captured: isTrusted=${event.isTrusted}; source chain: ${sourceChain.join(' → ') || '(none)'}.`;
  const article = (event.target as Element).closest('.fixture');
  const readout = article?.querySelector<HTMLElement>('.click-origin-readout');
  if (readout) {
    readout.textContent = text;
    readout.dataset.trusted = String(event.isTrusted);
    readout.dataset.sourceChain = JSON.stringify(sourceChain);
  }
}, { capture: true });
fixtures.addEventListener('click', () => { activeClick = undefined; });
fixtures.addEventListener('notation-select', event => {
  const detail = (event as CustomEvent<{ sourceId: string; sourceElement?: Element }>).detail;
  const source = detail.sourceElement;
  const isMarking = source?.matches('music-articulation, music-ornament, music-interval') ?? false;
  const origin = activeClick ? `isTrusted=${activeClick.trusted}` : 'no captured click origin';
  const text = `Selection (${origin}): ${source?.localName ?? 'an unresolved source'} #${detail.sourceId} (${isMarking ? 'marking child' : 'event or other source'}).`;
  nativeClickStatus.textContent = text;
  nativeClickStatus.dataset.sourceId = detail.sourceId;
  nativeClickStatus.dataset.kind = isMarking ? 'marking' : 'event';
  nativeClickStatus.dataset.trusted = activeClick ? String(activeClick.trusted) : 'unknown';
  const article = (event.target as Element).closest('.fixture');
  const readout = article?.querySelector<HTMLElement>('.native-selection-readout');
  if (readout) readout.textContent = text;
});
