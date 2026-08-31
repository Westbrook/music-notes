import '../src/components/index.js';
import type { MusicSurface } from '../src/components/index.js';
import type { EventGeometry } from '../src/engraving/render.js';
import { engravingReady } from '../src/engraving/render.js';
import type { Clef, Duration, MusicEvent } from '../src/model/types.js';
import { parsePitch, pitchPosition } from '../src/model/index.js';
import { unionInk, visibleInk } from '../src/engraving/geometry.js';
import { createPitchPreview } from '../src/engraving/pointer-preview.js';
import VexFlow from 'vexflow/bravura';

interface Fixture { root: MusicSurface; container: HTMLElement }
interface Result { name: string; passed: boolean; detail: string }
const button = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const Glyphs = VexFlow.Glyphs;
const clefs: readonly Clef[] = ['treble', 'bass', 'alto', 'tenor'];
// Highest pitch first deliberately differs from the engine's ascending sort.
const chordPitches: Record<Clef, string> = {
  treble: 'G4 C4 D4', bass: 'B2 E2 F2', alto: 'A3 D3 E3', tenor: 'F3 B2 C3',
};
const highPitches: Record<Clef, string> = { treble: 'C#6', bass: 'C#4', alto: 'C#5', tenor: 'A#4' };
const lowPitches: Record<Clef, string> = { treble: 'A3', bass: 'C2', alto: 'B2', tenor: 'G2' };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected ${JSON.stringify(expected)}\nReceived ${JSON.stringify(actual)}`);
}
function close(actual: number, expected: number, message: string, tolerance = 0.05): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}.`);
}
async function settle(root: MusicSurface): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      root.refresh().then(() => root.renderComplete),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Engraving did not settle.')), 20000); }),
    ]);
  } finally { clearTimeout(timeout); }
  const errors = root.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(!errors.length, errors.map(diagnostic => diagnostic.message).join('\n'));
}

function measures(clef: Clef, stem: 'up' | 'down', id: string): string {
  const nextClef = clefs[(clefs.indexOf(clef) + 1) % clefs.length];
  return `<music-measure id="${id}-m1">
      <music-chord id="${id}-chord" pitches="${chordPitches[clef]}" duration="half" stem="${stem}"></music-chord>
      <music-rest id="${id}-r1" duration="half"></music-rest>
    </music-measure>
    <music-measure id="${id}-m2">
      <music-note id="${id}-modified" pitch="${highPitches[clef]}" duration="half" dots="1" stem="${stem}" accidental-display="courtesy"></music-note>
      <music-rest id="${id}-r2" duration="quarter"></music-rest>
    </music-measure>
    <music-measure id="${id}-m3">
      <music-note id="${id}-low" pitch="${lowPitches[clef]}" duration="half" stem="${stem}"></music-note>
      <music-slash id="${id}-slash" duration="quarter" rhythmic></music-slash>
      <music-rest id="${id}-r3" duration="quarter"></music-rest>
    </music-measure>
    <music-measure id="${id}-m4" clef="${nextClef}">
      <music-chord id="${id}-changed-clef" pitches="${chordPitches[nextClef]}" duration="whole" stem="${stem}"></music-chord>
    </music-measure>`;
}

async function mount(name: string, markup: string): Promise<Fixture> {
  const article = document.createElement('article');
  const title = document.createElement('h2'); title.textContent = name;
  const container = document.createElement('div'); container.className = 'score-container'; container.style.width = '780px';
  container.innerHTML = markup;
  const root = container.firstElementChild as MusicSurface;
  article.append(title, container); fixtures.append(article);
  await settle(root);
  return { root, container };
}

/** Check glyph ink independently, then compare its baseline to the source pitch. */
function check(fixture: Fixture): number {
  const { root } = fixture;
  const layout = root.getLayoutGeometry();
  assert(layout && root.score, 'Rendered notation must publish current geometry.');
  equal(layout.revision, root.renderRevision, 'Geometry revision must be current');
  const events = new Map<string, MusicEvent>(root.score.staves.flatMap(staff => staff.measures
    .flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => [event.id, event] as const)))));
  const measures = new Map(root.score.staves.flatMap(staff => staff.measures.map(measure => [measure.id, measure] as const)));
  const svgs = [...root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)];
  let checked = 0;
  for (const system of layout.systems) {
    const svg = svgs[system.index];
    assert(svg, `Missing SVG for system ${system.index}.`);
    const groups = new Map([...svg.querySelectorAll<SVGGElement>('g.vf-music-event')].map(group => [group.dataset.sourceId!, group]));
    for (const geometry of system.events) {
      const event = events.get(geometry.sourceId)!;
      assert(geometry.noteheads, `Event ${event.id} must expose a notehead array.`);
      const pitched = event.kind === 'note' || event.kind === 'chord';
      equal(geometry.noteheads.map(head => head.pitchIndex), pitched ? event.pitches.map((_, index) => index) : [],
        `${event.id}: noteheads must follow the original source pitch order; rests/slashes must have none`);
      if (!pitched) continue;
      const group = groups.get(event.id)!;
      const glyphs = [...group.querySelectorAll<SVGGElement>('g.vf-notehead')]
        .map(head => head.firstElementChild).filter((glyph): glyph is SVGTextElement => glyph?.localName === 'text');
      const unused = new Set(glyphs);
      const lane = system.measures.find(measure => measure.sourceId === geometry.measureId)!;
      const measure = measures.get(geometry.measureId)!;
      for (const head of geometry.noteheads) {
        const glyph = [...unused].find(candidate => {
          const ink = unionInk(visibleInk(candidate, svg));
          return ink && Math.abs(head.x - ink.x) < 0.05 && Math.abs(head.y - ink.y) < 0.05
            && Math.abs(head.width - ink.width) < 0.05 && Math.abs(head.height - ink.height) < 0.05;
        });
        assert(glyph, `${event.id}, pitch ${head.pitchIndex}: public bounds do not match any actual, unclaimed notehead glyph.`);
        unused.delete(glyph);
        assert(head.width > 0 && head.height > 0, `${event.id}: notehead bounds must be nonempty.`);
        close(head.centerX, head.x + head.width / 2, `${event.id}: painted horizontal center`);
        close(head.centerY, head.y + head.height / 2, `${event.id}: painted vertical center`);
        const matrix = svg.getCTM()!.inverse().multiply(glyph.getCTM()!);
        const baseline = new DOMPoint(glyph.x.baseVal[0].value, glyph.y.baseVal[0].value).matrixTransform(matrix);
        const expectedY = lane.bottomLine - pitchPosition(event.pitches[head.pitchIndex], measure.clef)
          * (lane.bottomLine - lane.topLine) / 8;
        close(baseline.y, expectedY, `${event.id}: pitch ${head.pitchIndex} must map through the resolved ${measure.clef} clef`);
        assert(head.x >= geometry.ink.x - 0.05 && head.y >= geometry.ink.y - 0.05
          && head.x + head.width <= geometry.ink.x + geometry.ink.width + 0.05
          && head.y + head.height <= geometry.ink.y + geometry.ink.height + 0.05,
        `${event.id}: the notehead must remain inside its event's actual ink bounds.`);
        checked++;
      }
      equal(unused.size, 0, `${event.id}: every printed head must have exactly one source pitch`);
    }
  }
  return checked;
}

function eventGeometry(root: MusicSurface, id: string): EventGeometry {
  const event = root.getLayoutGeometry()!.systems.flatMap(system => system.events).find(event => event.sourceId === id);
  assert(event, `No public event geometry for ${id}.`);
  return event;
}
function snapshot(root: MusicSurface): string {
  return JSON.stringify(root.getLayoutGeometry()!.systems.map(system => ({
    index: system.index, start: system.start, end: system.end, viewBox: system.viewBox,
    heads: system.events.map(event => ({ id: event.sourceId, heads: event.noteheads })),
  })), (_key, value: unknown) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value);
}

async function exercise(clef: Clef, stem: 'up' | 'down'): Promise<string> {
  const id = `heads-${clef}-${stem}`;
  const fixture = await mount(`${clef} · stems ${stem}`, `<music-staff id="${id}" clef="${clef}" print-width="420">${measures(clef, stem, id)}</music-staff>`);
  let checked = check(fixture);
  const chord = eventGeometry(fixture.root, `${id}-chord`);
  const [high, low, second] = chord.noteheads!;
  assert(second.centerX - low.centerX > 4, `${id}: adjacent chord seconds must preserve their actual horizontal displacement.`);
  close(high.centerX, stem === 'up' ? low.centerX : second.centerX, `${id}: the common head position must respect stem direction`);
  const modified = eventGeometry(fixture.root, `${id}-modified`);
  assert(modified.ink.width > modified.noteheads![0].width + 5, `${id}: accidental and dot must not inflate the head bounds.`);
  assert(modified.ink.height > modified.noteheads![0].height + 10, `${id}: stem must not inflate the head bounds.`);
  const before = snapshot(fixture.root);
  const systemsBefore = fixture.root.getLayoutGeometry()!.systems.length;
  fixture.container.style.width = '300px'; await settle(fixture.root); checked += check(fixture);
  assert(fixture.root.getLayoutGeometry()!.systems.length > systemsBefore, `${id}: the narrow check must actually rewrap the score.`);
  fixture.container.style.width = '780px'; await settle(fixture.root); checked += check(fixture);
  equal(snapshot(fixture.root), before, `${id}: width A → B → A must restore the same per-pitch geometry`);
  fixture.root.printPreview = true; await settle(fixture.root); checked += check(fixture);
  equal(fixture.root.getLayoutGeometry()!.projection, 'print', 'Print geometry must identify the fixed projection');
  fixture.root.printPreview = false; await settle(fixture.root);
  return `${checked} real notehead checks across wide, narrow, restored, and print projections; original pitch order, chord displacement, ledger positions and modifier exclusion verified.`;
}

async function previewMatrix(): Promise<string> {
  await engravingReady();
  const durations: readonly Duration[] = ['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th'];
  const accidentalGlyphs = [Glyphs.accidentalDoubleFlat, Glyphs.accidentalFlat, Glyphs.accidentalNatural, Glyphs.accidentalSharp, Glyphs.accidentalDoubleSharp];
  const source = [...fixtures.querySelectorAll('music-system, music-staff')].map(root => root.outerHTML);
  const article = document.createElement('article');
  const title = document.createElement('h2'); title.textContent = 'Actual VexFlow pointer previews'; article.append(title);
  const examples = document.createElement('div'); examples.style.cssText = 'display:flex;flex-wrap:wrap;align-items:end;gap:12px';
  article.append(examples); fixtures.append(article);
  let checked = 0;
  for (const clef of clefs) for (const [durationIndex, duration] of durations.entries()) {
    for (const [stemIndex, stem] of (['auto', 'up', 'down'] as const).entries()) {
      const base = parsePitch(durationIndex % 2 ? highPitches[clef] : lowPitches[clef]);
      const alter = (durationIndex + stemIndex) % 5 - 2;
      const pitch = { ...base, alter, display: stemIndex === 2 ? 'courtesy' as const : 'auto' as const };
      const dots = durationIndex % 4;
      const preview = createPitchPreview({ pitch, clef, duration, dots, stem });
      assert(!preview.svg.isConnected, 'A pointer preview must return a detached SVG.');
      assert(!document.querySelector('[data-music-pointer-measuring]'), 'A pointer preview must remove its temporary measurement host.');
      assert(!preview.svg.querySelector('[id]'), 'Clonable previews must not retain duplicated engine IDs.');
      assert(!preview.svg.querySelector('g.vf-stave, g.vf-clef, g.vf-stavebarline'), 'A ghost must not include a stave, clef or barline.');
      assert(!preview.svg.querySelector('rect'), 'A ghost must not include background or transparent pointer rectangles.');
      equal(preview.svg.getAttribute('aria-hidden'), 'true', 'A visual pointer ghost must not enter the accessibility tree');
      examples.append(preview.svg);
      const view = preview.svg.viewBox.baseVal;
      equal([view.x, view.y], [0, 0], 'Preview coordinates must have a normalized origin');
      const ink = unionInk(visibleInk(preview.svg));
      assert(ink, 'The preview must contain real glyph ink.');
      assert(ink.x >= -0.05 && ink.y >= -0.05 && ink.x + ink.width <= view.width + 0.05 && ink.y + ink.height <= view.height + 0.05,
        `${clef}/${duration}/${stem}: note, accidental, dots, flag and ledger ink must fit the cropped preview.`);
      const head = preview.svg.querySelector<SVGGElement>('g.vf-notehead')!;
      const glyph = head.firstElementChild as SVGTextElement;
      const expectedGlyph = duration === 'breve' ? Glyphs.noteheadDoubleWhole : duration === 'whole' ? Glyphs.noteheadWhole
        : duration === 'half' ? Glyphs.noteheadHalf : Glyphs.noteheadBlack;
      equal(glyph.textContent, expectedGlyph, `${duration}: preview must retain the actual written notehead glyph`);
      const headInk = unionInk(visibleInk(glyph, preview.svg))!;
      close(preview.headX, headInk.x + headInk.width / 2, 'Preview horizontal anchoring uses painted head center');
      close(preview.headY, headInk.y + headInk.height / 2, 'Preview vertical anchoring uses painted head center');
      assert(head.textContent?.includes(accidentalGlyphs[alter + 2]), `${clef}/${duration}: explicit spelling, including natural, must be visible.`);
      equal([...head.querySelectorAll('text')].filter(text => text.textContent === Glyphs.augmentationDot).length, dots,
        `${duration}: every written dot must be rendered`);
      equal(preview.svg.querySelectorAll('g.vf-flag').length, durationIndex >= 4 ? 1 : 0, `${duration}: real flags follow duration`);
      assert(preview.svg.querySelector('g.vf-stavenote > path'), `${clef}: a ledger pitch must keep actual ledger lines.`);
      assert(getComputedStyle(glyph).fontFamily.includes('Bravura'), 'The pointer note must use the same Bravura notation font.');
      checked++;
    }
  }
  equal([...fixtures.querySelectorAll('music-system, music-staff')].map(root => root.outerHTML), source,
    'Pointer previews must never modify any accepted musical source');
  return `${checked} real previews cover all four clefs, every duration, three stem policies, up to three dots, all five accidentals, courtesy display and ledger notes; anchors and cropped SVG bounds verified.`;
}

async function run(): Promise<void> {
  button.disabled = true; fixtures.replaceChildren(); results.replaceChildren(); summary.dataset.state = 'running';
  const report: Result[] = [];
  const cases = clefs.flatMap(clef => (['up', 'down'] as const).map(stem => ({
    name: `${clef} clef, ${stem} stems and a local clef change`, run: () => exercise(clef, stem),
  })));
  cases.push({ name: 'Final vertical placement across two annotated staves', run: async () => {
    const fixture = await mount('Two-staff final geometry', `<music-system id="heads-ensemble" bracket="brace">
      <music-staff id="heads-upper" clef="treble" label="Upper">${measures('treble', 'up', 'heads-upper')}</music-staff>
      <music-staff id="heads-lower" clef="bass" label="Lower">${measures('bass', 'down', 'heads-lower')}</music-staff>
    </music-system>`);
    const instruction = document.createElement('music-direction'); instruction.textContent = 'A long instruction above the lower staff';
    fixture.root.querySelector('#heads-lower-m1')!.prepend(instruction); await settle(fixture.root);
    const checked = check(fixture);
    assert(eventGeometry(fixture.root, 'heads-lower-chord').noteheads![0].centerY
      > eventGeometry(fixture.root, 'heads-upper-chord').noteheads![0].centerY + 60,
    'Lower-staff heads must use the final translated staff group.');
    return `${checked} notehead bounds follow final staff placement, including a lower-staff instruction and brace.`;
  } });
  cases.push({ name: 'Single-note pointer previews use actual notation glyphs', run: previewMatrix });
  for (const entry of cases) {
    summary.textContent = `Checking ${entry.name}…`;
    const item = document.createElement('li'); results.append(item);
    try {
      const detail = await entry.run(); item.dataset.state = 'passed'; item.textContent = `PASS — ${entry.name}: ${detail}`;
      report.push({ name: entry.name, passed: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      item.dataset.state = 'failed'; item.textContent = `FAIL — ${entry.name}: ${detail}`;
      report.push({ name: entry.name, passed: false, detail });
    }
  }
  const passed = report.filter(item => item.passed).length;
  const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed';
  summary.textContent = `${passed}/${report.length} notehead geometry checks passed${failed ? `; ${failed} failed` : ''}. Actual SVG fixtures remain below.`;
  let output = document.querySelector<HTMLScriptElement>('#notehead-geometry-results');
  if (!output) { output = document.createElement('script'); output.id = 'notehead-geometry-results'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, results: report }, null, 2);
  button.disabled = false;
}
button.addEventListener('click', () => { void run(); });
