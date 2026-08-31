import '../src/components/index.js';
import type { MusicSurface } from '../src/components/index.js';
import { readScore } from '../src/dom/index.js';
import { formatRational } from '../src/model/index.js';
import type { MusicEvent, Score } from '../src/model/types.js';
import { unionInk, visibleInk } from '../src/engraving/geometry.js';
import type { InkBox } from '../src/engraving/geometry.js';
import { createProject } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';

interface Fixture { container: HTMLElement; root: MusicSurface }
interface Test { name: string; run: () => Promise<string> }
interface Result { name: string; passed: boolean; detail: string }

const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
let demo: Fixture | undefined;

// The same SMuFL slash heads used by the existing rhythmic slash notation.
const slashHeads = { short: '\uE100', half: '\uE103', whole: '\uE102', breve: '\uE10A' } as const;

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
  viewport.append(container);
  article.append(heading, viewport);
  fixtures.append(article);
  await settle(root);
  return { container, root };
}

function scoreOf(root: MusicSurface): Score {
  assert(root.score, 'The component did not publish a score.');
  return root.score;
}

function eventsOf(root: MusicSurface): MusicEvent[] {
  return scoreOf(root).staves.flatMap(staff => staff.measures.flatMap(measure =>
    measure.voices.flatMap(voice => [...voice.events])));
}

function noErrors(root: MusicSurface): void {
  const errors = root.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(errors.length === 0, errors.map(error => `${error.code}: ${error.message} [${error.sourceId}]`).join('\n'));
  assert(root.shadowRoot!.querySelector('.screen svg'), 'Validated music has no SVG.');
}

function eventGroup(root: MusicSurface, id: string): SVGGElement {
  const group = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-event')]
    .find(candidate => candidate.dataset.sourceId === id);
  assert(group, `No rendered group for ${id}.`);
  return group;
}

function glyphInk(group: SVGGElement, glyph: string): InkBox {
  const ink = unionInk([...group.querySelectorAll<SVGTextElement>('text')]
    .filter(text => text.textContent?.includes(glyph)).flatMap(text => visibleInk(text, group.ownerSVGElement!)));
  assert(ink && ink.width > 0 && ink.height > 0, `No painted glyph U+${glyph.codePointAt(0)?.toString(16)} on ${group.dataset.sourceId}.`);
  return ink;
}

function roadInk(root: MusicSurface, event: MusicEvent): InkBox {
  return glyphInk(eventGroup(root, event.id), event.duration === 'breve' ? slashHeads.breve
    : event.duration === 'whole' ? slashHeads.whole : event.duration === 'half' ? slashHeads.half : slashHeads.short);
}

function checkBounds(root: MusicSurface, surface = '.screen'): void {
  for (const svg of root.shadowRoot!.querySelectorAll<SVGSVGElement>(`${surface} svg`)) {
    const ink = unionInk(visibleInk(svg));
    assert(ink, 'System has no painted notation.');
    const view = svg.viewBox.baseVal;
    assert([ink.x, ink.y, ink.width, ink.height, view.width, view.height].every(Number.isFinite)
      && ink.x >= view.x - 0.5 && ink.y >= view.y - 0.5
      && ink.x + ink.width <= view.x + view.width + 0.5
      && ink.y + ink.height <= view.y + view.height + 0.5,
    `Painted notation exceeds its SVG: ${JSON.stringify(ink)}; viewBox ${svg.getAttribute('viewBox')}.`);
  }
}

function sourceCoverage(root: MusicSurface): void {
  const events = eventsOf(root);
  const expected = events.map(event => event.id).sort();
  const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-event')];
  equal(groups.map(group => group.dataset.sourceId).sort(), expected, 'Every event retains one rendered source identity');
  equal(root.getHitRegions().map(hit => hit.sourceId).sort(), expected, 'Every event retains one hit region');
  for (const hit of root.getHitRegions()) assert(root.getSource(hit.sourceId)
    && [hit.x, hit.y, hit.width, hit.height].every(Number.isFinite) && hit.width > 0 && hit.height > 0,
  `Invalid source hit geometry for ${hit.sourceId}.`);
  const geometry = root.getLayoutGeometry();
  assert(geometry, 'No completed layout geometry was published.');
  for (const event of events) {
    const group = eventGroup(root, event.id);
    equal(group.dataset.onset, formatRational(event.onset), `${event.id}: exact onset`);
    equal(group.dataset.duration, formatRational(event.time), `${event.id}: exact duration`);
    if (event.kind === 'road') {
      equal(event.pitches, [], `${event.id}: no invented absolute pitch`);
      equal(group.dataset.pitchDirection, event.pitchDirection, `${event.id}: source direction survives rendering`);
      const drawn = geometry.systems.flatMap(system => system.events).find(candidate => candidate.sourceId === event.id);
      equal(drawn?.noteheads, [], `${event.id}: no fake pitched notehead metadata`);
    }
  }
}

function checkRoads(root: MusicSurface): number {
  let measures = 0;
  for (const staff of scoreOf(root).staves.filter(staff => staff.notation === 'three-roads')) {
    const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-staff')]
      .filter(group => group.dataset.staffId === staff.id);
    assert(groups.length > 0, 'No three-roads staff groups were drawn.');
    for (const group of groups) {
      equal(group.dataset.notation, 'three-roads', 'Staff identity includes its notation');
      close(Number(group.dataset.bottomLine) - Number(group.dataset.topLine), 40, 'Roads retain the full ordinary staff span');
      equal(group.querySelectorAll('g.vf-clef, g.vf-keysignature').length, 0, 'Roads must not print a pitched clef/key');
      for (const stave of group.querySelectorAll<SVGGElement>('g.vf-stave')) {
        const paths = [...stave.querySelectorAll<SVGPathElement>(':scope > path')];
        equal(paths.length, 3, 'Exactly three actual staff lines are visible');
        const ys = paths.map(path => path.getBBox().y).sort((a, b) => a - b);
        close(ys[1] - ys[0], 20, 'Top-to-middle road spacing');
        close(ys[2] - ys[1], 20, 'Middle-to-bottom road spacing');
        measures++;
      }
    }
    for (const event of staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))) {
      if (event.kind !== 'road') continue;
      const group = eventGroup(root, event.id);
      const parent = group.closest<SVGGElement>('g.vf-music-staff')!;
      const top = Number(parent.dataset.topLine);
      const expected = top + (event.pitchDirection === 'higher' ? 0 : event.pitchDirection === 'same' ? 20 : 40);
      const ink = roadInk(root, event);
      close(ink.y + ink.height / 2, expected, `${event.id}: slash on the ${event.pitchDirection} road`, 1.5);
      equal(group.querySelectorAll('g.vf-stavenote > path').length, 0, 'Road slashes must not acquire pitched ledger lines');
    }
  }
  assert(measures > 0, 'The fixture contained no road measures.');
  return measures;
}

async function demoFixture(): Promise<Fixture> {
  if (demo) return demo;
  const response = await fetch('/index.html');
  assert(response.ok, 'Could not read the real workbook.');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const study = doc.querySelector('#three-roads-study');
  assert(study, 'The workbook has no three-roads study.');
  demo = await mount('Actual workbook: 3 roads music', study.outerHTML);
  return demo;
}

function snapshot(root: MusicSurface, surface = '.screen') {
  return [...root.shadowRoot!.querySelectorAll<HTMLElement>(`${surface} .system-row`)].map(row => ({
    start: row.dataset.startMeasure, end: row.dataset.endMeasure, viewBox: row.querySelector('svg')!.getAttribute('viewBox'),
    staves: [...row.querySelectorAll<SVGGElement>('g.vf-music-staff')].map(group => ({
      id: group.dataset.staffId, top: group.dataset.topLine, bottom: group.dataset.bottomLine,
    })),
    events: [...row.querySelectorAll<SVGGElement>('g.vf-music-event')].map(group => ({
      id: group.dataset.sourceId, x: group.dataset.x, direction: group.dataset.pitchDirection,
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
    name: 'The workbook draws three full-span roads with meaningful slash positions',
    run: async () => {
      const { root } = await demoFixture();
      noErrors(root);
      const count = checkRoads(root);
      sourceCoverage(root);
      const transcript = root.shadowRoot!.querySelector('.transcript')!.textContent!;
      for (const phrase of ['3 roads music', 'higher', 'same', 'lower', 'reference', 'rests', 'without a new attack']) {
        assert(transcript.includes(phrase), `Accessible text omitted ${phrase}.`);
      }
      assert(!transcript.includes('treble clef') && !transcript.includes('key C'), 'Roads were described as a pitched staff.');
      const directions = scoreOf(root).staves[0].measures.flatMap(measure => measure.annotations.map(annotation => annotation.text));
      for (const phrase of ['Top: higher', 'middle: same', 'Bottom: lower', 'reference pitch', 'last main pitch', 'Rests keep']) {
        assert(directions.some(text => text.includes(phrase)), `The performer’s local instructions omit ${phrase}.`);
      }
      checkBounds(root);
      return `${count} actual measure staves retain the 40px outer span; slash positions, local legend, and accessible relative-pitch descriptions agree.`;
    },
  },
  {
    name: 'Slash heads retain their written values, dots, flags, beams, and exact tuplets',
    run: async () => {
      const { root } = await mount('Written slash rhythms: half, whole, breve, flags, and a mixed tuplet', `
        <music-staff id="road-values" notation="three-roads" label="Values" max-measures="2">
          <music-measure meter="4/4">
            <music-road id="road-half" direction="higher" duration="half"></music-road>
            <music-road direction="same" duration="quarter"></music-road><music-road direction="lower" duration="quarter"></music-road>
          </music-measure>
          <music-measure><music-road id="road-whole" direction="same" duration="whole"></music-road></music-measure>
          <music-measure>
            <music-road id="road-dotted" direction="lower" duration="eighth" dots="1"></music-road>
            <music-road direction="higher" duration="sixteenth"></music-road>
            <music-tuplet actual="3" normal="2" ratio bracket="yes">
              <music-road id="road-tuplet-quarter" direction="same" duration="quarter"></music-road>
              <music-rest id="road-tuplet-rest" duration="eighth"></music-rest>
            </music-tuplet>
            <music-road direction="higher" duration="half"></music-road>
          </music-measure>
          <music-measure meter="4/2"><music-road id="road-breve" direction="lower" duration="breve"></music-road></music-measure>
          <music-measure meter="4/4" end-bar="final">
            <music-road id="road-flag" direction="lower" duration="eighth" beam="none"></music-road><music-rest duration="eighth"></music-rest>
            <music-road direction="same" duration="half"></music-road><music-road direction="higher" duration="quarter"></music-road>
          </music-measure>
        </music-staff>`);
      noErrors(root);
      checkRoads(root);
      glyphInk(eventGroup(root, 'road-half'), slashHeads.half);
      glyphInk(eventGroup(root, 'road-whole'), slashHeads.whole);
      glyphInk(eventGroup(root, 'road-breve'), slashHeads.breve);
      equal(eventGroup(root, 'road-dotted').textContent!.split('\uE1E7').length - 1, 1, 'A dotted road event retains its dot');
      const flag = eventGroup(root, 'road-flag').textContent!;
      assert(flag.includes('\uE240') || flag.includes('\uE241'), 'An unbeamed eighth road event lost its actual music-font flag.');
      assert(root.shadowRoot!.querySelector('.screen g.vf-music-beams path'), 'The mixed eighth/sixteenth road group has no beam.');
      equal(eventGroup(root, 'road-whole').querySelectorAll('g.vf-stem path').length, 0, 'A whole slash must not acquire a quarter-note stem');
      const events = new Map(eventsOf(root).map(event => [event.id, event]));
      equal(formatRational(events.get('road-tuplet-quarter')!.time), '1/6', 'Quarter in 3:2');
      equal(formatRational(events.get('road-tuplet-rest')!.time), '1/12', 'Eighth rest in 3:2');
      equal(formatRational(events.get('road-dotted')!.time), '3/16', 'Dotted eighth duration');
      equal(formatRational(events.get('road-breve')!.time), '2', 'Breve duration');
      sourceCoverage(root);
      checkBounds(root);
      return 'True E100/E103/E102/E10A slash heads retain their values; dots, flags, mixed beams, and exact 3:2 timing remain meaningful.';
    },
  },
  {
    name: 'Lower and higher road ties continue on the middle road across systems',
    run: async () => {
      const { root } = await mount('Held pitch: lower → same and higher → same across systems', `
        <music-staff id="road-ties" notation="three-roads" label="Hold">
          <music-measure meter="4/4">
            <music-road direction="same" duration="half"></music-road>
            <music-road id="road-lower-start" direction="lower" duration="half" tie="start"></music-road>
          </music-measure>
          <music-measure break-before="line">
            <music-road id="road-lower-end" direction="same" duration="half" tie="end"></music-road>
            <music-road id="road-higher-start" direction="higher" duration="half" tie="start"></music-road>
          </music-measure>
          <music-measure break-before="line" end-bar="final">
            <music-road id="road-higher-end" direction="same" duration="half" tie="end"></music-road>
            <music-rest duration="half"></music-rest>
          </music-measure>
        </music-staff>`, 600);
      noErrors(root);
      for (const road of ['lower', 'higher']) {
        const startId = `road-${road}-start`;
        const endId = `road-${road}-end`;
        const halves = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-tie')]
          .filter(group => group.dataset.startSourceId === startId && group.dataset.endSourceId === endId);
        equal(halves.map(group => group.dataset.boundary).sort(), ['incoming', 'outgoing'], `${road}: both system-boundary tie halves`);
        const sides = halves.map(group => {
          const ink = unionInk(visibleInk(group, group.ownerSVGElement!));
          assert(ink && ink.width >= 19.5 && group.querySelector('path'), 'A road tie has no legible curved ink.');
          const owner = eventGroup(root, group.dataset.boundary === 'outgoing' ? startId : endId);
          const head = glyphInk(owner, slashHeads.half);
          return Math.sign(ink.y + ink.height / 2 - (head.y + head.height / 2));
        });
        assert(sides[0] !== 0 && sides[0] === sides[1], `${road}: tie halves switched curve sides at the system boundary.`);
      }
      const end = root.querySelector('#road-lower-end')!;
      end.setAttribute('direction', 'higher');
      await bounded(root.renderComplete, 'Reject contradictory tie endpoint');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'A tied higher direction was silently accepted.');
      end.setAttribute('direction', 'same');
      await bounded(root.renderComplete, 'Restore held middle-road continuation');
      noErrors(root);
      checkRoads(root);
      sourceCoverage(root);
      checkBounds(root);
      return 'Both outer-road starts retain matching split tie curves; tied middle-road events hold, and a tied higher endpoint is rejected.';
    },
  },
  {
    name: 'Rests preserve silence and reference, with real support for rectangular glyphs',
    run: async () => {
      const { root } = await mount('Silence between chosen pitches', `
        <music-staff id="road-rests" notation="three-roads" label="Rests" max-measures="2">
          <music-measure meter="4/4">
            <music-direction text="Rests keep the reference"></music-direction>
            <music-road direction="higher" duration="quarter"></music-road><music-rest duration="quarter"></music-rest>
            <music-road id="road-after-rest" direction="same" duration="half"></music-road>
          </music-measure>
          <music-measure><music-rest id="roads-half-rest" duration="half"></music-rest><music-road direction="lower" duration="half"></music-road></music-measure>
          <music-measure><music-rest id="roads-whole-rest" duration="whole"></music-rest></music-measure>
          <music-measure meter="7/8" groups="2+2+3" end-bar="final"><music-rest id="roads-full-rest" measure></music-rest></music-measure>
        </music-staff>`);
      noErrors(root);
      checkRoads(root);
      for (const [id, normal, ledger, below] of [
        ['roads-half-rest', '\uE4E4', '\uE4F5', false],
        ['roads-whole-rest', '\uE4E3', '\uE4F4', true],
        ['roads-full-rest', '\uE4E3', '\uE4F4', true],
      ] as const) {
        const group = eventGroup(root, id);
        const withLedger = group.textContent!.includes(ledger);
        const ink = glyphInk(group, withLedger ? ledger : normal);
        if (!withLedger) {
          const top = Number(group.closest<SVGGElement>('g.vf-music-staff')!.dataset.topLine);
          const support = below ? ink.y : ink.y + ink.height;
          assert([top, top + 20, top + 40].some(line => Math.abs(support - line) <= 1.5), `${id}: no visible staff line or ledger supports the rectangular rest.`);
        }
      }
      const events = new Map(eventsOf(root).map(event => [event.id, event]));
      equal(events.get('road-after-rest')!.pitchDirection, 'same', 'Silence does not rewrite the next directional choice');
      equal(formatRational(events.get('roads-full-rest')!.time), '7/8', 'Full-measure rest follows 7/8');
      equal(formatRational(events.get('roads-whole-rest')!.time), '1', 'Ordinary whole rest retains its written value');
      const transcript = root.shadowRoot!.querySelector('.transcript')!.textContent!;
      assert(transcript.includes('rests preserve the reference'), 'Accessible instructions omit reference continuity through silence.');
      sourceCoverage(root);
      checkBounds(root);
      return 'Rests remain silence, retain whole versus full-measure timing, preserve the reference rule, and have visible support lines.';
    },
  },
  {
    name: 'Direction edits and canonical serialization preserve time and source identities',
    run: async () => {
      const { root } = await demoFixture();
      const note = root.querySelector('music-road[direction="higher"]')!;
      const original = eventsOf(root).find(event => root.getSource(event.id) === note)!;
      const before = { ...original };
      const group = eventGroup(root, original.id);
      const oldHead = glyphInk(group, slashHeads.short);
      const roadElement = note as Element & { direction: string };
      roadElement.direction = 'lower';
      await bounded(root.renderComplete, 'Reflect road direction property');
      noErrors(root);
      equal(note.getAttribute('direction'), 'lower', 'The documented property reflects its attribute');
      const changed = eventsOf(root).find(event => event.id === original.id)!;
      equal({ ...changed, pitchDirection: before.pitchDirection }, before, 'Direction-only editing preserves all timing and unrelated notation');
      const newHead = glyphInk(eventGroup(root, original.id), slashHeads.short);
      // Annotation/beam bounds may translate the complete staff; compare its own line coordinates instead of absolute SVG y.
      const parent = eventGroup(root, original.id).closest<SVGGElement>('g.vf-music-staff')!;
      close(newHead.y + newHead.height / 2, Number(parent.dataset.bottomLine), 'Changed lower slash lies on the bottom road', 1.5);
      assert(oldHead.height > 0 && root.getSource(original.id) === note, 'Direction editing lost source/head identity.');
      note.removeAttribute('direction');
      await bounded(root.renderComplete, 'Diagnose missing direction');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'A missing road direction silently defaulted to same.');
      roadElement.direction = 'higher';
      await bounded(root.renderComplete, 'Restore road direction');
      noErrors(root);
      const doc = new DOMParser().parseFromString(root.toHTML(), 'text/html');
      const restored = readScore(doc.body.firstElementChild!);
      equal(restored.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], 'Canonical road source remains valid');
      equal(restored.score, scoreOf(root), 'Canonical source retains directions, exact time, ties, and IDs');
      sourceCoverage(root);
      checkRoads(root);
      checkBounds(root);
      return 'A property edit moves the slash between roads without changing time or IDs; missing direction is diagnosed and canonical roundtrip preserves the score.';
    },
  },
  {
    name: 'Mixed-staff layout and extracted parts retain road meaning and instructions',
    run: async () => {
      const { root: source } = await demoFixture();
      // Canonical serialization may wrap a standalone staff in music-system.
      // Embed only its actual staff when building this mixed-staff fixture.
      const canonical = new DOMParser().parseFromString(source.toHTML(), 'text/html');
      const roadSource = canonical.querySelector('music-staff');
      assert(roadSource, 'Canonical demo source contains no staff.');
      const fixture = await mount('Road choices beside a separate pitched part', `<music-system id="road-ensemble" clef="bass" key="G" bracket="bracket" max-measures="2">
        ${roadSource.outerHTML}
        <music-staff id="road-companion" label="Pitch" clef="treble">
          ${[1, 2, 3, 4].map(number => `<music-measure meter="4/4"${number === 4 ? ' end-bar="final"' : ''}><music-note pitch="G4" duration="whole"></music-note></music-measure>`).join('')}
        </music-staff>
      </music-system>`);
      noErrors(fixture.root);
      checkRoads(fixture.root);
      const score = scoreOf(fixture.root);
      const roadStaff = score.staves.find(staff => staff.notation === 'three-roads')!;
      const companion = score.staves.find(staff => staff.id === 'road-companion')!;
      for (const [index, measure] of roadStaff.measures.entries()) {
        const road = eventGroup(fixture.root, measure.voices[0].events[0].id);
        const pitched = eventGroup(fixture.root, companion.measures[index].voices[0].events[0].id);
        close(Number(road.dataset.x), Number(pitched.dataset.x), 'Shared measure-start onset alignment', 0.01);
        assert(road.closest('.system-row') === pitched.closest('.system-row'), 'Parallel staves broke independently.');
      }
      const project = createProject(fixture.root.toHTML(), '3 roads music', [{ id: 'roads-part', label: '3 roads', staffIds: [roadStaff.id] }]);
      const projected = buildProjection(project, 'roads-part');
      equal(projected.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], 'Road part projection remains valid');
      equal(projected.score.staves.length, 1, 'The extracted part contains only its selected staff');
      const partStaff = projected.score.staves[0];
      equal(partStaff.notation, 'three-roads', 'The extracted part retains its notation');
      equal(partStaff.measures.flatMap(measure => measure.annotations), roadStaff.measures.flatMap(measure => measure.annotations), 'Every local legend/reference instruction survives extraction');
      equal(partStaff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)),
        roadStaff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)), 'Directions, exact events, and source IDs survive extraction');
      const part = await mount('Extracted 3 roads part with its own legend', projected.source.outerHTML, 680);
      noErrors(part.root);
      checkRoads(part.root);
      sourceCoverage(part.root);
      checkBounds(fixture.root);
      checkBounds(part.root);
      return 'Roads ignore inherited pitched context, align with another staff, and retain their exact events and all local performance instructions in the extracted part.';
    },
  },
  {
    name: 'Responsive wrapping preserves the full road span and cached print layout',
    run: async () => {
      const fixture = await demoFixture();
      await settle(fixture.root);
      const source = fixture.root.innerHTML;
      const before = snapshot(fixture.root);
      const printBefore = snapshot(fixture.root, '.print');
      const printed = [...fixture.root.shadowRoot!.querySelectorAll('.print svg')];
      await resizeObserved(fixture, 330);
      noErrors(fixture.root);
      checkRoads(fixture.root);
      sourceCoverage(fixture.root);
      checkBounds(fixture.root);
      equal(snapshot(fixture.root, '.print'), printBefore, 'Native screen resize leaves fixed print geometry unchanged');
      assert(printed.every((svg, index) => fixture.root.shadowRoot!.querySelectorAll('.print svg')[index] === svg), 'Native resize replaced cached print SVGs.');
      await resizeObserved(fixture, 820);
      equal(snapshot(fixture.root), before, 'Width 820 → 330 → 820 restores the same layout');
      equal(fixture.root.innerHTML, source, 'Resizing does not rewrite source');
      fixture.root.setAttribute('print-preview', '');
      await bounded(fixture.root.renderComplete, 'Activate print view');
      equal(fixture.root.getLayoutGeometry()?.projection, 'print', 'Fixed print geometry is published');
      for (const svg of fixture.root.shadowRoot!.querySelectorAll<SVGSVGElement>('.print svg')) assert(svg.viewBox.baseVal.width <= 681, 'Study exceeds its declared 680px print width.');
      checkBounds(fixture.root, '.print');
      fixture.root.removeAttribute('print-preview');
      await bounded(fixture.root.renderComplete, 'Restore screen view');
      noErrors(fixture.root);
      return 'Native A→B→A resizing preserves the full three-road grid and source; cached print SVGs remain stable and the fixed 680px view fits.';
    },
  },
];

async function run(): Promise<void> {
  button.disabled = true;
  fixtures.replaceChildren();
  results.replaceChildren();
  demo = undefined;
  summary.dataset.state = 'running';
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}. Bundled fonts and actual SVG; no playback or native printing verification.`;
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
  summary.textContent = `${passed}/${tests.length} three-roads checks passed${failed ? `; ${failed} failed` : ''}. Fixtures remain below for visual review.`;
  let output = document.querySelector<HTMLScriptElement>('#three-roads-browser-results');
  if (!output) {
    output = document.createElement('script');
    output.id = 'three-roads-browser-results';
    output.type = 'application/json';
    document.body.append(output);
  }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, results: report }, null, 2);
  button.disabled = false;
}

button.addEventListener('click', () => { void run(); });
