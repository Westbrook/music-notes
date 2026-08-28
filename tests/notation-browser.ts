import '../src/components/index.js';
import { Stem } from 'vexflow/bravura';
import type { MusicSurface } from '../src/components/index.js';
import { readScore } from '../src/dom/index.js';
import { formatRational } from '../src/model/index.js';
import type { MusicEvent, Score } from '../src/model/types.js';
import { unionInk, visibleInk } from '../src/engraving/geometry.js';
import type { InkBox } from '../src/engraving/geometry.js';

interface Fixture { container: HTMLElement; root: MusicSurface }
interface Test { name: string; run: () => Promise<string> }
interface Result { name: string; passed: boolean; detail: string }

const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
let demo: Fixture | undefined;
let rhythm: Fixture | undefined;

// SMuFL Stein–Zimmermann glyphs, not generic text or engine accidental aliases.
const signs = { qf: '\uE280', tqf: '\uE281', qs: '\uE282', tqs: '\uE283', natural: '\uE261' } as const;
const heads = { quarter: '\uE0A4', half: '\uE0A3', whole: '\uE0A2' } as const;
const restGlyphs = { half: '\uE4E4', whole: '\uE4E3' } as const;

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

/** Failure watchdog; completion comes from rendering, never an arbitrary delay. */
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
  assert(root && typeof root.refresh === 'function', 'Fixture must contain a registered music surface.');
  viewport.append(container);
  article.append(heading, viewport);
  fixtures.append(article);
  await settle(root);
  return { container, root };
}

function scoreOf(root: MusicSurface): Score {
  assert(root.score, 'The component did not publish its score.');
  return root.score;
}

function eventsOf(root: MusicSurface): MusicEvent[] {
  return scoreOf(root).staves.flatMap(staff => staff.measures.flatMap(measure =>
    measure.voices.flatMap(voice => [...voice.events])));
}

function noErrors(root: MusicSurface): void {
  const errors = root.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(errors.length === 0, errors.map(error => `${error.code}: ${error.message} [${error.sourceId}]`).join('\n'));
  assert(root.shadowRoot!.querySelector('.screen svg'), 'Validated music did not produce an SVG.');
}

function eventGroup(root: MusicSurface, id: string): SVGGElement {
  const group = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-event')]
    .find(candidate => candidate.dataset.sourceId === id);
  assert(group, `No rendered source group for ${id}.`);
  return group;
}

function glyphInk(group: SVGGElement, glyph: string): InkBox {
  const leaves = [...group.querySelectorAll<SVGTextElement>('text')].filter(text => text.textContent?.includes(glyph));
  const ink = unionInk(leaves.flatMap(text => visibleInk(text, group.ownerSVGElement!)));
  assert(ink && ink.width > 0 && ink.height > 0, `The expected music glyph ${glyph.codePointAt(0)?.toString(16)} has no painted ink.`);
  return ink;
}

function sourceCoverage(root: MusicSurface): void {
  const expected = eventsOf(root).map(event => event.id).sort();
  const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-event')];
  equal(groups.map(group => group.dataset.sourceId).sort(), expected, 'Every event must retain its rendered source identity');
  equal(root.getHitRegions().map(hit => hit.sourceId).sort(), expected, 'Every event must retain a hit region');
  for (const hit of root.getHitRegions()) {
    assert(root.getSource(hit.sourceId) && [hit.x, hit.y, hit.width, hit.height].every(Number.isFinite)
      && hit.width > 0 && hit.height > 0, `Invalid source hit geometry for ${hit.sourceId}.`);
  }
  for (const event of eventsOf(root)) {
    const group = eventGroup(root, event.id);
    equal(group.dataset.onset, formatRational(event.onset), `${event.id}: exact onset`);
    equal(group.dataset.duration, formatRational(event.time), `${event.id}: exact duration`);
    if (event.kind === 'rhythm') equal(event.pitches, [], `${event.id}: no fabricated pitch`);
  }
}

function checkBounds(root: MusicSurface, surface = '.screen'): void {
  for (const svg of root.shadowRoot!.querySelectorAll<SVGSVGElement>(`${surface} svg`)) {
    const ink = unionInk(visibleInk(svg));
    assert(ink, 'Rendered system has no painted notation.');
    const view = svg.viewBox.baseVal;
    assert([view.width, view.height, ink.x, ink.y, ink.width, ink.height].every(Number.isFinite)
      && ink.x >= view.x - 0.5 && ink.y >= view.y - 0.5
      && ink.x + ink.width <= view.x + view.width + 0.5
      && ink.y + ink.height <= view.y + view.height + 0.5,
    `Notation extends outside its SVG: ${JSON.stringify(ink)}; viewBox ${svg.getAttribute('viewBox')}.`);
  }
}

function checkLines(root: MusicSurface): number {
  let checked = 0;
  for (const staff of scoreOf(root).staves) {
    const rhythmStaff = staff.notation === 'rhythm';
    const groups = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-staff')]
      .filter(group => group.dataset.staffId === staff.id);
    for (const group of groups) {
      const staves = [...group.querySelectorAll<SVGGElement>('g.vf-stave')];
      assert(staves.length > 0, 'The staff contains no actual stave objects.');
      for (const stave of staves) {
        equal(stave.querySelectorAll(':scope > path').length, rhythmStaff ? 1 : 5, 'Actual printed staff-line count');
        checked++;
      }
      if (rhythmStaff) {
        equal(group.querySelectorAll('g.vf-clef, g.vf-keysignature').length, 0, 'A rhythm staff must not print a pitched clef/key');
        close(Number(group.dataset.topLine), Number(group.dataset.bottomLine), 'The sole line is both top and bottom');
      }
    }
  }
  return checked;
}

async function demoFixture(): Promise<Fixture> {
  if (demo) return demo;
  const response = await fetch('/index.html');
  assert(response.ok, 'Could not load the real workbook source.');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const study = doc.querySelector('#microtone-rhythm-study');
  assert(study, 'The workbook does not contain the added notation study.');
  demo = await mount('Actual workbook: quarter-tones and a clapped pulse', study.outerHTML);
  return demo;
}

async function rhythmFixture(): Promise<Fixture> {
  if (rhythm) return rhythm;
  rhythm = await mount('Rhythm reading: beams, held duration, mixed tuplet, silence', `
    <music-staff id="rhythm-reading" notation="rhythm" label="Rhythm" max-measures="2" print-width="680">
      <music-measure meter="4/4">
        <music-direction text="Read; ties continue duration"></music-direction>
        ${[1, 2, 3, 4].map(number => `<music-rhythm id="rhythm-eighth-${number}" duration="eighth"></music-rhythm>`).join('')}
        <music-rhythm id="rhythm-held" duration="half" tie="start"></music-rhythm>
      </music-measure>
      <music-measure break-before="line">
        <music-rhythm id="rhythm-continued" duration="quarter" tie="end"></music-rhythm>
        <music-rest duration="quarter"></music-rest>
        <music-rhythm duration="eighth"></music-rhythm><music-rhythm duration="eighth"></music-rhythm>
        <music-rhythm duration="quarter"></music-rhythm>
      </music-measure>
      <music-measure meter="7/8" groups="2+2+3">
        <music-rhythm duration="quarter"></music-rhythm>
        <music-tuplet id="rhythm-mixed-tuplet" actual="3" normal="2" ratio bracket="yes">
          <music-rhythm id="rhythm-mixed-quarter" duration="quarter"></music-rhythm>
          <music-rest id="rhythm-mixed-rest" duration="eighth"></music-rest>
        </music-tuplet>
        <music-rhythm id="rhythm-dotted" duration="quarter" dots="1"></music-rhythm>
      </music-measure>
      <music-measure end-bar="final"><music-rest id="rhythm-full-rest" measure></music-rest></music-measure>
    </music-staff>`);
  return rhythm;
}

function checkAlignment(root: MusicSurface): number {
  const score = scoreOf(root);
  let comparisons = 0;
  for (let column = 0; column < score.staves[0].measures.length; column++) {
    const onsets = new Map<string, SVGGElement[]>();
    for (const staff of score.staves) for (const voice of staff.measures[column].voices) for (const event of voice.events) {
      if (event.measureRest) continue;
      const key = formatRational(event.onset);
      onsets.set(key, [...(onsets.get(key) ?? []), eventGroup(root, event.id)]);
    }
    for (const groups of onsets.values()) {
      if (new Set(groups.map(group => group.dataset.staffId)).size < 2) continue;
      for (const group of groups.slice(1)) {
        assert(group.closest('.system-row') === groups[0].closest('.system-row'), 'Common attacks were split across systems.');
        close(Number(group.dataset.x), Number(groups[0].dataset.x), 'Common onset across pitched/rhythm staves', 0.01);
        comparisons++;
      }
    }
  }
  assert(comparisons > 0, 'Fixture had no shared onsets to test.');
  return comparisons;
}

function snapshot(root: MusicSurface, surface = '.screen') {
  return [...root.shadowRoot!.querySelectorAll<HTMLElement>(`${surface} .system-row`)].map(row => ({
    start: row.dataset.startMeasure, end: row.dataset.endMeasure,
    viewBox: row.querySelector('svg')!.getAttribute('viewBox'),
    staves: [...row.querySelectorAll<SVGGElement>('g.vf-music-staff')].map(group => ({
      id: group.dataset.staffId, top: group.dataset.topLine, bottom: group.dataset.bottomLine,
    })),
    events: [...row.querySelectorAll<SVGGElement>('g.vf-music-event')].map(group => ({ id: group.dataset.sourceId, x: group.dataset.x })),
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
    name: 'All four quarter-tone glyphs, natural cancellation, and repeated-note state',
    run: async () => {
      const { root } = await mount('24-EDO: four signs, cancellation, repetition, and a chord', `
        <music-staff id="microtone-signs" clef="treble" key="G" max-measures="2">
          <music-measure meter="4/4">
            <music-direction text="24-EDO; Stein–Zimmermann"></music-direction>
            <music-note id="micro-qf" pitch="Fqf4" duration="quarter"></music-note>
            <music-note id="micro-tqf" pitch="Ftqf4" duration="quarter"></music-note>
            <music-note id="micro-qs" pitch="Fqs4" duration="quarter"></music-note>
            <music-note id="micro-tqs" pitch="Ftqs4" duration="quarter"></music-note>
          </music-measure>
          <music-measure>
            <music-note id="micro-first" pitch="Fqs4" duration="eighth"></music-note>
            <music-note id="micro-repeat" pitch="Fqs4" duration="eighth"></music-note>
            <music-note id="micro-natural" pitch="F4" duration="quarter"></music-note>
            <music-note id="micro-octave" pitch="Fqs5" duration="quarter"></music-note>
            <music-rest duration="quarter"></music-rest>
          </music-measure>
          <music-measure end-bar="final"><music-chord id="micro-chord" pitches="Cqs4 Eqs4 Gtqf4" duration="whole"></music-chord></music-measure>
        </music-staff>`);
      noErrors(root);
      for (const name of ['qf', 'tqf', 'qs', 'tqs'] as const) glyphInk(eventGroup(root, `micro-${name}`), signs[name]);
      glyphInk(eventGroup(root, 'micro-first'), signs.qs);
      assert(!eventGroup(root, 'micro-repeat').textContent?.includes(signs.qs), 'A repeated quarter-sharp acquired an unnecessary operative sign.');
      glyphInk(eventGroup(root, 'micro-natural'), signs.natural);
      glyphInk(eventGroup(root, 'micro-octave'), signs.qs);
      glyphInk(eventGroup(root, 'micro-chord'), signs.qs);
      glyphInk(eventGroup(root, 'micro-chord'), signs.tqf);
      assert(root.shadowRoot!.querySelector('.transcript')!.textContent!.includes('quarter-sharp'), 'Accessible pitch text omitted the named accidental.');
      sourceCoverage(root);
      checkBounds(root);
      return 'U+E280–U+E283 are painted music glyphs; cancellation, octave separation, repeated-note suppression, and chord accidentals survive.';
    },
  },
  {
    name: 'Conflicting simultaneous microtones remain readable and reestablish state',
    run: async () => {
      const { root } = await mount('Two voices: quarter-flat against quarter-sharp', `
        <music-staff id="microtone-voices" clef="treble">
          <music-measure meter="4/4">
            <music-voice>
              <music-note id="conflict-flat" pitch="Fqf4" duration="quarter" stem="up"></music-note>
              <music-note id="conflict-next-up" pitch="Fqs4" duration="quarter" stem="up"></music-note>
              <music-rest duration="half"></music-rest>
            </music-voice>
            <music-voice>
              <music-note id="conflict-sharp" pitch="Fqs4" duration="quarter" stem="down"></music-note>
              <music-note id="conflict-next-down" pitch="Fqs4" duration="quarter" stem="down"></music-note>
              <music-rest duration="half"></music-rest>
            </music-voice>
          </music-measure>
          <music-measure end-bar="final">
            <music-chord id="same-line-microtone-chord" pitches="Fqf4 Fqs4" duration="half"></music-chord>
            <music-rest duration="half"></music-rest>
          </music-measure>
        </music-staff>`, 540);
      noErrors(root);
      const flat = glyphInk(eventGroup(root, 'conflict-flat'), signs.qf);
      const sharp = glyphInk(eventGroup(root, 'conflict-sharp'), signs.qs);
      assert(flat.x + flat.width <= sharp.x + 0.2 || sharp.x + sharp.width <= flat.x + 0.2
        || flat.y + flat.height <= sharp.y + 0.2 || sharp.y + sharp.height <= flat.y + 0.2,
      'Conflicting quarter-tone accidental glyphs overlap.');
      const next = eventGroup(root, 'conflict-next-up').textContent! + eventGroup(root, 'conflict-next-down').textContent!;
      equal(next.split(signs.qs).length - 1, 1, 'The next common spelling must reestablish one visible operative sign');
      const geometry = root.getLayoutGeometry();
      assert(geometry, 'Conflicting microtones did not publish source geometry.');
      const rendered = geometry.systems.flatMap(system => system.events);
      const flatHead = rendered.find(event => event.sourceId === 'conflict-flat')?.noteheads?.[0];
      const sharpHead = rendered.find(event => event.sourceId === 'conflict-sharp')?.noteheads?.[0];
      assert(flatHead && sharpHead && Math.abs(flatHead.centerX - sharpHead.centerX) >= Math.min(flatHead.width, sharpHead.width) - 0.5,
        'Different simultaneous pitches must not share one notehead.');
      const chordHeads = rendered.find(event => event.sourceId === 'same-line-microtone-chord')?.noteheads;
      assert(chordHeads && chordHeads.length === 2, 'A chord with two different alterations must retain two measured noteheads.');
      equal(chordHeads.map(head => head.pitchIndex), [0, 1], 'Same-position chord heads preserve their original pitch indices');
      // Adjacent heads on one shared stem may overlap by that stem's width.
      // Separate voices above still require separate heads without that join.
      assert(Math.abs(chordHeads[0].centerX - chordHeads[1].centerX) >= Math.min(chordHeads[0].width, chordHeads[1].width) - Stem.WIDTH,
        `Two differently altered pitches in one chord must retain distinct head positions. Center separation: ${Math.abs(chordHeads[0].centerX - chordHeads[1].centerX)}; heads: ${JSON.stringify(chordHeads)}.`);
      glyphInk(eventGroup(root, 'same-line-microtone-chord'), signs.qf);
      glyphInk(eventGroup(root, 'same-line-microtone-chord'), signs.qs);
      sourceCoverage(root);
      checkBounds(root);
      return 'Conflicting voices and a same-position microtonal chord retain distinct heads and signs; the following shared spelling reestablishes accidental state.';
    },
  },
  {
    name: 'A rhythm staff draws one line, ordinary heads, and real beams',
    run: async () => {
      const { root } = await rhythmFixture();
      noErrors(root);
      const count = checkLines(root);
      for (const event of eventsOf(root).filter(event => event.kind === 'rhythm')) {
        const group = eventGroup(root, event.id);
        const ink = glyphInk(group, event.duration === 'half' ? heads.half : heads.quarter);
        const staff = group.closest<SVGGElement>('g.vf-music-staff')!;
        close(ink.y + ink.height / 2, Number(staff.dataset.topLine), `${event.id}: ordinary head centered on the sole line`, 1.5);
        equal(group.querySelectorAll('g.vf-stavenote > path').length, 0, 'A rhythm head must not acquire a pitched ledger line');
      }
      assert(root.shadowRoot!.querySelector('.screen g.vf-music-beams path'), 'Written eighths did not acquire actual beams.');
      const geometry = root.getLayoutGeometry();
      assert(geometry, 'No completed geometry was published.');
      for (const system of geometry.systems) for (const event of system.events) {
        if (eventsOf(root).some(source => source.id === event.sourceId && source.kind === 'rhythm')) {
          equal(event.noteheads, [], 'Pitch-free rhythm events must not publish fabricated pitched head metadata');
        }
      }
      const transcript = root.shadowRoot!.querySelector('.transcript')!.textContent!;
      assert(transcript.includes('single-line rhythm staff') && transcript.includes('rhythm note')
        && !transcript.includes('treble clef') && !transcript.includes('key C'), 'Rhythm transcript implies pitched notation.');
      sourceCoverage(root);
      checkBounds(root);
      return `${count} measure staves each draw exactly one line; pitch-free ordinary heads, beams, and accessible descriptions agree.`;
    },
  },
  {
    name: 'Rhythm ties cross a system and mixed-value tuplets preserve exact time',
    run: async () => {
      const { root } = await rhythmFixture();
      noErrors(root);
      const ties = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-tie')]
        .filter(group => group.dataset.startSourceId === 'rhythm-held' && group.dataset.endSourceId === 'rhythm-continued');
      equal(ties.map(tie => tie.dataset.boundary).sort(), ['incoming', 'outgoing'], 'A rhythm tie crossing systems needs both halves');
      for (const tie of ties) {
        const ink = unionInk(visibleInk(tie, tie.ownerSVGElement!));
        assert(ink && ink.width >= 19.5 && tie.querySelector('path'), 'A rhythm tie has no legible curved ink.');
      }
      const events = new Map(eventsOf(root).map(event => [event.id, event]));
      equal(formatRational(events.get('rhythm-mixed-quarter')!.time), '1/6', 'Quarter in 3:2');
      equal(formatRational(events.get('rhythm-mixed-rest')!.time), '1/12', 'Eighth rest in 3:2');
      equal(formatRational(events.get('rhythm-dotted')!.onset), '1/2', 'Dotted-quarter onset after two quarter spans');
      equal(formatRational(events.get('rhythm-dotted')!.time), '3/8', 'Dotted-quarter elapsed time');
      equal(formatRational(events.get('rhythm-full-rest')!.time), '7/8', 'Full-measure rest in 7/8');
      const tuplet = [...root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-music-tuplet')]
        .find(group => group.dataset.sourceId === 'rhythm-mixed-tuplet');
      assert(tuplet && unionInk(visibleInk(tuplet)), 'The mixed-value rhythm tuplet has no printed number/bracket.');
      checkBounds(root);
      return 'Both halves of the held rhythm tie are present; the two-child 3:2 group spans exactly 1/4, followed by 3/8.';
    },
  },
  {
    name: 'One-line rest orientation, meter, barlines, and repeat dots',
    run: async () => {
      const { root } = await mount('One-line rests and repeat barlines', `
        <music-staff id="rhythm-rests" notation="rhythm" label="Rests" max-measures="2">
          <music-measure meter="4/4"><music-rest id="one-line-half-rest" duration="half"></music-rest><music-rhythm duration="half"></music-rhythm></music-measure>
          <music-measure><music-rest id="one-line-whole-rest" duration="whole"></music-rest></music-measure>
          <music-measure meter="7/8" groups="2+2+3" repeat-start end-bar="repeat-end"><music-rest id="one-line-measure-rest" measure></music-rest></music-measure>
        </music-staff>`);
      noErrors(root);
      checkLines(root);
      for (const [id, glyph, below] of [
        ['one-line-half-rest', restGlyphs.half, false],
        ['one-line-whole-rest', restGlyphs.whole, true],
        ['one-line-measure-rest', restGlyphs.whole, true],
      ] as const) {
        const group = eventGroup(root, id);
        const ink = glyphInk(group, glyph);
        const line = Number(group.closest<SVGGElement>('g.vf-music-staff')!.dataset.topLine);
        assert(below ? ink.y + ink.height / 2 > line : ink.y + ink.height / 2 < line, `${id}: rest lies on the wrong side of the sole line.`);
        close(below ? ink.y : ink.y + ink.height, line, `${id}: rectangular rest meets the staff line`, 1.5);
      }
      for (const bar of root.shadowRoot!.querySelectorAll<SVGGElement>('.screen g.vf-stavebarline')) {
        for (const rect of bar.querySelectorAll<SVGRectElement>('rect')) close(rect.getBBox().height, 21, 'Single-line barline extent');
      }
      const last = eventGroup(root, 'one-line-measure-rest').closest<SVGGElement>('g.vf-music-staff')!;
      const line = Number(last.dataset.topLine);
      const dots = [...last.querySelectorAll<SVGGraphicsElement>('g.vf-stavebarline path, g.vf-stavebarline circle')]
        .flatMap(dot => visibleInk(dot, last.ownerSVGElement!))
        .filter(ink => ink.width >= 3.5 && ink.width <= 4.5 && ink.height >= 3.5 && ink.height <= 4.5);
      equal(dots.length, 4, 'Repeat start/end each require two real dots');
      for (const dot of dots) close(Math.abs(dot.y + dot.height / 2 - (line + 0.5)), 5, 'Repeat dots straddle the sole line', 0.2);
      const signature = last.querySelector<SVGGElement>('g.vf-timesignature');
      assert(signature, 'Meter change on the rhythm staff was lost.');
      const meterInk = unionInk(visibleInk(signature, last.ownerSVGElement!));
      assert(meterInk, 'Time signature has no visible digits.');
      close(meterInk.y + meterInk.height / 2, line, 'Meter is centered on the sole line', 2);
      sourceCoverage(root);
      checkBounds(root);
      const polyphony = await mount('One-line voices: distinct half rests with and without a dot', `
        <music-staff id="rhythm-polyphonic-rests" notation="rhythm" label="Voices">
          <music-measure meter="4/4" end-bar="final">
            <music-voice>
              <music-rest id="dotted-poly-rest" duration="half" dots="1"></music-rest>
              <music-rhythm duration="quarter"></music-rhythm>
            </music-voice>
            <music-voice>
              <music-rest id="plain-poly-rest" duration="half"></music-rest>
              <music-rhythm duration="half"></music-rhythm>
            </music-voice>
          </music-measure>
        </music-staff>`, 540);
      noErrors(polyphony.root);
      const dotted = eventGroup(polyphony.root, 'dotted-poly-rest');
      const plain = eventGroup(polyphony.root, 'plain-poly-rest');
      assert(!dotted.dataset.coalescedWith && !plain.dataset.coalescedWith, 'Different half-rest durations must not share one printed rest.');
      equal(dotted.textContent!.split('\uE1E7').length - 1, 1, 'The dotted half rest retains one visible augmentation dot');
      equal(plain.textContent!.split('\uE1E7').length - 1, 0, 'The plain half rest must not acquire the other voice’s dot');
      assert(dotted.textContent!.includes('\uE4F5') || plain.textContent!.includes('\uE4F5'), 'A displaced rectangular rest requires a visible supporting ledger.');
      const restInk = glyphInk(dotted, dotted.textContent!.includes('\uE4F5') ? '\uE4F5' : restGlyphs.half);
      const dotInk = glyphInk(dotted, '\uE1E7');
      assert(Math.abs(dotInk.y + dotInk.height / 2 - (restInk.y + restInk.height)) >= 3,
        `The displaced half-rest dot sits on its supporting line: ${JSON.stringify({ restInk, dotInk })}.`);
      sourceCoverage(polyphony.root);
      checkLines(polyphony.root);
      checkBounds(polyphony.root);
      return 'Rest orientation, 21px barlines, centered 7/8, and repeat dots are correct; distinct polyphonic half rests retain their ledger and dot placement.';
    },
  },
  {
    name: 'Ordinary rhythm, rhythmic slash, and open slash remain distinct',
    run: async () => {
      const { root } = await mount('Three different commitments to rhythm', `
        <music-staff id="rhythm-slash-modes" notation="rhythm" label="Rhythm">
          <music-measure meter="4/4" end-bar="final">
            <music-rhythm id="ordinary-rhythm" duration="quarter"></music-rhythm>
            <music-slash id="prescribed-slash" duration="quarter" rhythmic></music-slash>
            <music-slash id="open-slash" duration="quarter"></music-slash>
            <music-rest duration="quarter"></music-rest>
          </music-measure>
        </music-staff>`, 540);
      noErrors(root);
      glyphInk(eventGroup(root, 'ordinary-rhythm'), heads.quarter);
      assert(eventGroup(root, 'prescribed-slash').querySelector('g.vf-stem path'), 'A rhythmic slash lost its prescribed stem.');
      equal(eventGroup(root, 'open-slash').querySelectorAll('g.vf-stem path').length, 0, 'An open slash must not prescribe a stemmed attack');
      const transcript = root.shadowRoot!.querySelector('.transcript')!.textContent!;
      for (const term of ['rhythm note', 'rhythmic slash', 'improvised beat slash']) assert(transcript.includes(term), `Transcript omitted ${term}.`);
      checkLines(root);
      sourceCoverage(root);
      checkBounds(root);
      return 'Ordinary heads, stemmed slashes, and open slashes remain separate in the model, engraving, and transcript.';
    },
  },
  {
    name: 'The real workbook aligns pitched and rhythm parts without changing source',
    run: async () => {
      const { root } = await demoFixture();
      noErrors(root);
      const before = root.innerHTML;
      const lines = checkLines(root);
      const aligned = checkAlignment(root);
      const doc = new DOMParser().parseFromString(root.toHTML(), 'text/html');
      const roundTrip = readScore(doc.body.firstElementChild!);
      equal(roundTrip.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), [], 'Canonical source must remain valid');
      equal(roundTrip.score, scoreOf(root), 'Canonical serialization retains exact notation and source identities');
      await settle(root);
      equal(root.innerHTML, before, 'Rendering must not rewrite the authored study');
      sourceCoverage(root);
      checkBounds(root);
      return `${lines} measure staves retain their actual line counts; ${aligned} common onsets align across the original workbook study.`;
    },
  },
  {
    name: 'Native width changes are deterministic and preserve the fixed print projection',
    run: async () => {
      const fixture = await demoFixture();
      await settle(fixture.root);
      const source = fixture.root.innerHTML;
      const before = snapshot(fixture.root);
      const printBefore = snapshot(fixture.root, '.print');
      const printed = [...fixture.root.shadowRoot!.querySelectorAll('.print svg')];
      await resizeObserved(fixture, 330);
      noErrors(fixture.root);
      checkLines(fixture.root);
      checkAlignment(fixture.root);
      sourceCoverage(fixture.root);
      checkBounds(fixture.root);
      equal(snapshot(fixture.root, '.print'), printBefore, 'Screen-only native resize must not change print geometry');
      assert(printed.every((svg, index) => fixture.root.shadowRoot!.querySelectorAll('.print svg')[index] === svg), 'Native resize replaced cached print SVGs.');
      await resizeObserved(fixture, 820);
      equal(snapshot(fixture.root), before, 'Width 820 → 330 → 820 must restore the same measured layout');
      equal(fixture.root.innerHTML, source, 'Resizing must preserve authored notation');
      fixture.root.setAttribute('print-preview', '');
      await bounded(fixture.root.renderComplete, 'Activate fixed print view');
      equal(fixture.root.getLayoutGeometry()?.projection, 'print', 'Print view must publish print geometry');
      for (const svg of fixture.root.shadowRoot!.querySelectorAll<SVGSVGElement>('.print svg')) {
        assert(svg.viewBox.baseVal.width <= 681, 'The demonstration exceeds its declared 680px print width.');
      }
      checkBounds(fixture.root, '.print');
      fixture.root.removeAttribute('print-preview');
      await bounded(fixture.root.renderComplete, 'Restore responsive view');
      noErrors(fixture.root);
      return 'Native A→B→A resizing preserves source and restores geometry; print SVGs are reused, and the 680px print view remains bounded.';
    },
  },
  {
    name: 'Live source edits change glyphs and reject misleading pitch on a rhythm event',
    run: async () => {
      const { root } = await demoFixture();
      const note = root.querySelector('music-note[pitch="Fqs4"]')!;
      const id = eventsOf(root).find(event => root.getSource(event.id) === note)!.id;
      note.setAttribute('pitch', 'Fqf4');
      await bounded(root.renderComplete, 'Apply microtonal source edit');
      noErrors(root);
      glyphInk(eventGroup(root, id), signs.qf);
      assert(root.getSource(id) === note, 'Changing an accidental replaced the source identity.');
      note.setAttribute('pitch', 'Fqs4');
      await bounded(root.renderComplete, 'Restore microtonal source');
      const rhythmNote = root.querySelector('music-rhythm')!;
      rhythmNote.setAttribute('pitch', 'C4');
      await bounded(root.renderComplete, 'Reject pitch on a rhythm note');
      assert(root.diagnostics.some(diagnostic => diagnostic.severity === 'error'), 'A pitch attribute on a rhythm event was silently accepted.');
      assert(root.shadowRoot!.querySelector('.diagnostics')!.textContent!.trim(), 'Invalid source did not produce visible diagnostics.');
      rhythmNote.removeAttribute('pitch');
      await bounded(root.renderComplete, 'Repair rhythm source');
      noErrors(root);
      glyphInk(eventGroup(root, id), signs.qs);
      sourceCoverage(root);
      checkBounds(root);
      return 'The component updates real accidental glyphs without replacing source nodes, diagnoses a fabricated rhythm pitch, and recovers after repair.';
    },
  },
];

async function run(): Promise<void> {
  button.disabled = true;
  fixtures.replaceChildren();
  results.replaceChildren();
  demo = undefined;
  rhythm = undefined;
  summary.dataset.state = 'running';
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}. Bundled fonts and native SVG geometry; no playback or native print verification.`;
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
  summary.textContent = `${passed}/${tests.length} notation expansion checks passed${failed ? `; ${failed} failed` : ''}. Fixtures remain below for visual review.`;
  let output = document.querySelector<HTMLScriptElement>('#notation-browser-results');
  if (!output) {
    output = document.createElement('script');
    output.id = 'notation-browser-results';
    output.type = 'application/json';
    document.body.append(output);
  }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, results: report }, null, 2);
  button.disabled = false;
}

button.addEventListener('click', () => { void run(); });
