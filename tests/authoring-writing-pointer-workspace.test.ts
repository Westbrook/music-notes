// @vitest-environment happy-dom
/**
 * Actual author.html → AuthorWorkspace → StaffInteraction → EditorSession.
 * Only engraving readiness/geometry/ghosts and screen measurements are doubles.
 * No recipe, commit, completion, insertion or render-dispatch callback is replaced.
 * The real in-flow popover fallback is exercised; this is not native pointer,
 * top-layer, CSS layout, font, capture, touch or saved-PDF qualification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult, EventGeometry, InsertionAnchor, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import type { Score } from '../src/model/types.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));
vi.mock('../src/engraving/pointer-preview.js', () => ({ createPitchPreview: vi.fn(), createRestPreview: vi.fn() }));
import '../src/engraving/render.js';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { MusicSurface } from '../src/components/music-surface.js';
import { add, pitchDescription, pitchPosition, pitchText, rational, toNumber } from '../src/model/index.js';
import { createPitchPreview, createRestPreview } from '../src/engraving/pointer-preview.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const NS = 'http://www.w3.org/2000/svg';
const STAFF = 'pointer-lead';
const BARS = Array.from({ length: 8 }, (_, index) => `pointer-bar-${index + 1}`);
const SOURCE = `<music-system id="writing-pointer-score"><music-staff id="${STAFF}" label="Lead" clef="treble" meter="4/4">${
  BARS.map((id, index) => `<music-measure id="${id}" number="${index + 1}" incomplete></music-measure>`).join('')
}</music-staff></music-system>`;
const NOTE_A = 'pointer-inspected-a', NOTE_B = 'pointer-dragged-b', NOTE_C = 'pointer-parked-c';
const INSPECTION_SOURCE = SOURCE
  .replace(`id="${BARS[0]}" number="1" incomplete>`, `id="${BARS[0]}" number="1" incomplete><music-note id="${NOTE_A}" pitch="E4" duration="quarter"></music-note>`)
  .replace(`id="${BARS[1]}" number="2" incomplete>`, `id="${BARS[1]}" number="2" incomplete><music-note id="${NOTE_B}" pitch="Fqs4" duration="quarter" accidental-display="courtesy" stem="down" data-player="keep"><music-articulation id="pointer-b-accent" type="accent"></music-articulation></music-note>`)
  .replace(`id="${BARS[6]}" number="7" incomplete>`, `id="${BARS[6]}" number="7" incomplete><music-note id="${NOTE_C}" pitch="G4" duration="quarter"></music-note>`);
// A deliberately nonuniform renderer timeline. Input uses its published anchors,
// never a beat fraction inferred from the width of a bar.
const QUARTER_X = [75, 120, 175, 245, 305] as const;
const dimensionsBefore = new Map<string, PropertyDescriptor | undefined>();
let app: AuthorWorkspace | undefined;
let sequence = 0;
const actions: string[] = [];

class Matrix {
  readonly a = 1; readonly b = 0; readonly c = 0; readonly d = 1;
  readonly e: number; readonly f: number;
  constructor(e = 0, f = 0) { this.e = e; this.f = f; }
  inverse(): Matrix { return new Matrix(-this.e, -this.f); }
  multiply(other: Matrix): Matrix { return new Matrix(this.e + other.e, this.f + other.f); }
}
class Point {
  readonly x: number; readonly y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  matrixTransform(matrix: Matrix): Point { return new Point(this.x + matrix.e, this.y + matrix.f); }
}
class ResizeObserverDouble implements ResizeObserver {
  observe(): void {} unobserve(): void {} disconnect(): void {}
}
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id); if (!value) throw new Error(`Missing actual Author control #${id}.`);
  return value as T;
}
function surface(): MusicSurface {
  const value = el('score-host').shadowRoot!.querySelector('music-system');
  if (!(value instanceof MusicSurface)) throw new Error('AuthorWorkspace has not mounted its real MusicSurface.');
  return value;
}
function dimensions(element: HTMLElement, width: number, height: number, rect: () => DOMRect): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width }, offsetWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height }, offsetHeight: { configurable: true, value: height },
    clientLeft: { configurable: true, value: 0 }, clientTop: { configurable: true, value: 0 },
    scrollWidth: { configurable: true, value: width }, scrollHeight: { configurable: true, value: height },
    getBoundingClientRect: { configurable: true, value: rect },
  });
}

/** The rendering double receives and retains the real parsed projection IDs. */
function draw(container: HTMLElement, score: Score): EngravingResult {
  const staff = score.staves[0]; const viewport = el('score-scroll');
  const systems: SystemGeometry[] = [];
  const rows: HTMLElement[] = [];
  for (let index = 0; index < 4; index++) {
    const row = document.createElement('div'); row.className = 'system-row'; row.style.overflow = 'auto';
    const svg = document.createElementNS(NS, 'svg'); svg.classList.add('notation-svg');
    svg.setAttribute('viewBox', '0 0 720 160'); svg.setAttribute('width', '720'); svg.setAttribute('height', '160');
    Object.defineProperty(svg, 'getScreenCTM', { value: () => new Matrix(40 - viewport.scrollLeft - row.scrollLeft, 80 + index * 160 - viewport.scrollTop) });
    dimensions(row, 720, 160, () => new DOMRect(40 - viewport.scrollLeft, 80 + index * 160 - viewport.scrollTop, 720, 160));
    row.append(svg); rows.push(row);
    const measures: MeasureGeometry[] = []; const events: EventGeometry[] = []; const anchors: InsertionAnchor[] = [];
    for (let measureIndex = index * 2; measureIndex < index * 2 + 2; measureIndex++) {
      const measure = staff.measures[measureIndex]; const left = measureIndex % 2 * 360;
      const lane: MeasureGeometry = { sourceId: measure.id, staffId: staff.id, system: index, measureIndex,
        x: left + 20, y: 0, width: 320, height: 130, topLine: 40, bottomLine: 80,
        notation: 'pitched', staffSpace: 10, noteStartX: left + 50, noteEndX: left + 330 };
      measures.push(lane);
      const onsetX = (onset: InsertionAnchor['onset']) => {
        const x = QUARTER_X[toNumber(onset) * 4];
        if (x === undefined) throw new Error('The test renderer expects exact written quarter boundaries.');
        return left + x;
      };
      for (const voice of measure.voices) {
        voice.events.forEach((event, eventIndex) => {
          const x = onsetX(event.onset); const y = event.pitches.length ? 80 - 5 * pitchPosition(event.pitches[0], measure.clef) : 60;
          const ink = { x: x - 6, y: y - 25, width: 18, height: 33 };
          events.push({ ...ink, sourceId: event.id, system: index, staffId: staff.id, measureId: measure.id,
            voiceId: voice.id, eventIndex, anchorX: x, anchorY: 60, onset: event.onset, ink, sharedSourceIds: [event.id],
            noteheads: event.pitches.map((_, pitchIndex) => ({ pitchIndex, x: x - 6, y: y - 4, width: 12, height: 8, centerX: x, centerY: y })) });
        });
        for (let eventIndex = 0; eventIndex <= voice.events.length; eventIndex++) {
          const before = voice.events[eventIndex]; const after = voice.events[eventIndex - 1];
          const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
          anchors.push({ sourceId: voice.id, system: index, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
            ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}), onset, x: onsetX(onset), y: 40, height: 40 });
        }
      }
    }
    systems.push({ index, start: index * 2, end: index * 2 + 2, width: 720, height: 160,
      viewBox: { x: 0, y: 0, width: 720, height: 160 }, ink: { x: 20, y: 0, width: 680, height: 130 }, pageBreak: false,
      staves: [{ sourceId: staff.id, system: index, x: 20, y: 0, width: 680, height: 130, topLine: 40, bottomLine: 80,
        notation: 'pitched', staffSpace: 10, measureIds: measures.map(measure => measure.sourceId) }],
      measures, events, anchors, markings: [], annotations: [], tuplets: [] });
  }
  container.replaceChildren(...rows);
  return { systems: [], systemGeometry: systems, hitRegions: systems.flatMap(system => system.events), diagnostics: [] };
}

async function nextTask(): Promise<void> { await new Promise<void>(resolve => setTimeout(resolve, 0)); }
async function settled(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await nextTask();
    if (document.body.dataset.renderState === 'error') throw new Error(el('author-errors').textContent || 'Author rendering failed.');
    if (document.body.dataset.renderState === 'ready' && surface().getLayoutGeometry()) return;
  }
  throw new Error(`Actual Author rendering did not settle: ${document.body.dataset.renderState}.`);
}
function available(element: HTMLElement): boolean {
  if (element.closest('[hidden],[inert],[aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}
async function click(id: string): Promise<void> {
  const target = el(id); expect(available(target), `#${id} is available in the real shell`).toBe(true);
  actions.push(`click:${id}`); target.click(); await nextTask();
}
async function field(id: string, value: string): Promise<void> {
  const target = el<HTMLInputElement | HTMLSelectElement>(id); expect(available(target), `#${id} is available`).toBe(true);
  if (target instanceof HTMLSelectElement) expect([...target.options].some(option => option.value === value && !option.disabled)).toBe(true);
  actions.push(`field:${id}`); target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); await nextTask();
}
function recipe() {
  return { values: Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
    'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position'].map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked };
}
function accepted() {
  return { source: app!.session.project.sourceHtml, pending: app!.session.project.pendingSource, revision: app!.session.revision,
    cursor: app!.session.cursor, selection: app!.session.selection, undo: app!.session.canUndo, redo: app!.session.canRedo };
}
function writing(): void {
  expect(document.body.dataset.entryMode).toBe('true'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
  expect(el('select-mode').getAttribute('aria-pressed')).toBe('false');
  expect(el('palette-owner-label').textContent).toMatch(/^New notes/i);
  expect([...el('workspace-mode-slot').querySelectorAll('button')].filter(available).map(button => button.id)).toEqual(['toggle-entry', 'select-mode']);
}
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', point: { x: number; y: number }): PointerEvent {
  actions.push(`pointer:${type}`);
  const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true,
    pointerId: 73, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
    clientX: point.x, clientY: point.y });
  el('score-host').dispatchEvent(event); return event;
}
function target(barIndex: number, y: number): Point {
  const score = surface().score!; const voice = score.staves[0].measures[barIndex].voices[0];
  const layout = surface().getLayoutGeometry()!; const system = layout.systems.find(system => system.measures.some(measure => measure.sourceId === BARS[barIndex]))!;
  const anchor = system.anchors.find(anchor => anchor.measureId === BARS[barIndex] && anchor.voiceId === voice.id && anchor.eventIndex === voice.events.length)!;
  expect(anchor).toBeDefined(); expect(surface().getSource(voice.id)).toBe(surface().getSource(BARS[barIndex]));
  const svg = surface().shadowRoot!.querySelectorAll<SVGSVGElement>('.screen svg.notation-svg')[system.index];
  return new Point(anchor.x, y).matrixTransform(svg.getScreenCTM() as unknown as Matrix);
}
function expectMusic(ids: readonly string[], kinds: readonly ('note' | 'rest')[], pitches: readonly (string | undefined)[]): void {
  const score = app!.session.score;
  expect(score.staves[0].measures.map(measure => measure.id)).toEqual(BARS);
  expect(app!.session.source.querySelectorAll('music-voice')).toHaveLength(0);
  score.staves[0].measures.forEach((measure, barIndex) => {
    expect(measure.voices).toHaveLength(1);
    expect(measure.voices[0].events).toHaveLength(Math.min(4, Math.max(0, ids.length - barIndex * 4)));
    measure.voices[0].events.forEach((event, beatIndex) => {
      const index = barIndex * 4 + beatIndex;
      expect(event).toMatchObject({ id: ids[index], kind: kinds[index], duration: 'quarter', dots: 0, measureRest: false,
        onset: rational(beatIndex, 4), time: rational(1, 4), tupletIds: [] });
      expect(event.pitches.map(pitchText)).toEqual(pitches[index] === undefined ? [] : [pitches[index]]);
      expect(surface().getSource(event.id)?.closest('music-measure')?.id).toBe(measure.id);
    });
  });
  expect(new Set(ids).size).toBe(ids.length); expect(app!.session.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  expect(document.body.dataset.authorRevision).toBe(String(app!.session.revision));
}
async function mountProject(sourceHtml = SOURCE) {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `writing-pointer-shell-${++sequence}`, writerId: 'writing-pointer-shell',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(sourceHtml, 'Actual-shell pointer journey'), recovery });
  const viewport = el('score-scroll');
  dimensions(el('score-host').shadowRoot!.querySelector<HTMLElement>('.score-mount')!, 720, 640,
    () => new DOMRect(40 - viewport.scrollLeft, 80 - viewport.scrollTop, 720, 640));
  await settled();
  return vi.spyOn(app.session, 'execute'); // Observe calls; retain the real method.
}
async function mount() {
  const execute = await mountProject();
  expectMusic([], [], []); expect(app!.session.source.querySelector('music-note,music-rest')).toBeNull();
  expect(app!.session.score.staves[0].measures.every(measure => measure.incomplete && measure.voices[0].events.length === 0)).toBe(true);
  const before = accepted();
  await click('toggle-entry'); await settled(); writing();
  expect(accepted()).toEqual(before); expect(document.activeElement).toBe(el('score-editor'));
  await click('entry-value-trigger'); await field('event-duration', 'quarter'); await field('event-dots', '0'); await click('close-entry-value');
  writing(); expect(accepted()).toEqual(before); expect(execute).not.toHaveBeenCalled();
  expect(el<HTMLSelectElement>('insert-position').value).toBe('after');
  return execute;
}

/** Public Location and score-list controls establish an independent inspection. */
async function selectNote(id: string, barIndex: number): Promise<void> {
  if (document.body.dataset.entryMode === 'true') await click('select-mode');
  await click('location-trigger'); await field('measure-select', BARS[barIndex]); await click('close-location');
  const panel = el<HTMLDetailsElement>('navigator-panel');
  if (!panel.open) panel.querySelector('summary')!.click();
  const button = el('event-navigator').querySelector<HTMLButtonElement>(`button[data-source-id="${id}"]`);
  expect(button).not.toBeNull(); expect(available(button!)).toBe(true);
  actions.push(`select:${id}`); button!.click(); await nextTask(); await settled();
  expect(app!.session.selection.ids).toEqual([id]);
  panel.querySelector('summary')!.click();
}
function notePoint(id: string): Point {
  const layout = surface().getLayoutGeometry()!;
  const system = layout.systems.find(system => system.events.some(event => event.sourceId === id))!;
  const head = system.events.find(event => event.sourceId === id)!.noteheads![0];
  const svg = surface().shadowRoot!.querySelectorAll<SVGSVGElement>('.screen svg.notation-svg')[system.index];
  return new Point(head.centerX, head.centerY).matrixTransform(svg.getScreenCTM() as unknown as Matrix);
}
function event(id: string) {
  return app!.session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))
    .find(item => item.id === id)!;
}
function expectInspection(id: string, barIndex: number): void {
  const selected = event(id);
  expect(app!.session.selection.ids).toEqual([id]); expect(app!.session.selectionId).toBe(id);
  expect(app!.session.selection).toMatchObject({ primaryId: id, anchorId: id, focusId: id, staffId: STAFF, voiceIndex: 0 });
  expect(el('selection-controls').dataset.eventId).toBe(id);
  expect(el('selection-controls').dataset.eventIds).toBe(JSON.stringify([id]));
  expect(available(el('selection-pitch'))).toBe(true);
  expect(el('selection-pitch').getAttribute('aria-label')).toBe(`Pitch: ${pitchDescription(selected.pitches[0])}`);
  expect(el('selection-controls-context').textContent).toContain(`bar ${barIndex + 1} · voice 1`);
  expect(el<HTMLSelectElement>('measure-select').value).toBe(BARS[barIndex]);
  expect(el('selection-compact-context').textContent).toBe(`Bar ${barIndex + 1} · V1`);
  expect([...el('score-host').shadowRoot!.querySelectorAll<HTMLElement>('.author-selection:not(.author-event-focus)')]
    .map(outline => outline.dataset.sourceId)).toEqual([id]);
  expect(document.body.dataset.entryMode).toBe('false');
}
async function openProperties(editable = true): Promise<void> {
  if (el('workspace-tools').hidden) await click('edit-selected-event');
  expect(available(el('selection-inspector'))).toBe(true);
  const details = el<HTMLDetailsElement>('event-details'); if (!details.open) details.querySelector('summary')!.click();
  expect(available(el('selected-pitch'))).toBe(editable);
  expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(!editable);
}
async function parkWriterAndInspect(dirty: boolean) {
  const execute = await mountProject(INSPECTION_SOURCE);
  await selectNote(NOTE_A, 0);
  const originalSource = app!.session.project.sourceHtml;
  await click('selection-pitch'); await click('selection-chooser-sharp'); await settled();
  await click('close-selection-pitch'); await click('undo'); await settled();
  expect(app!.session.project.sourceHtml).toBe(originalSource);
  expect(app!.session.canUndo).toBe(false); expect(app!.session.canRedo).toBe(true);
  await selectNote(NOTE_C, 6);
  await click('location-trigger'); await click('start-entry-here'); await settled(); writing();
  await click('entry-settings-trigger'); await field('event-pitch', 'D#6'); await click('close-entry-settings');
  await click('entry-value-trigger'); await field('event-duration', 'half'); await field('event-dots', '1'); await click('close-entry-value');
  const writer = app!.session.cursor, palette = recipe();
  expect(writer).toEqual({ staffId: STAFF, measureId: BARS[6], voiceIndex: 0, eventId: NOTE_C });
  await selectNote(NOTE_A, 0); await openProperties();
  if (dirty) await field('selected-pitch', 'D5');
  expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_A);
  expect(el<HTMLInputElement>('selected-pitch').value).toBe(dirty ? 'D5' : 'E4');
  expect(app!.session.cursor).toEqual(writer); expect(recipe()).toEqual(palette); expectInspection(NOTE_A, 0);
  execute.mockClear();
  return { execute, writer, palette };
}
async function dragNote(id: string, changed: boolean): Promise<void> {
  const origin = notePoint(id), before = accepted(), palette = recipe();
  const destination = new Point(origin.x + 12, origin.y - (changed ? 5 : 0));
  pointer('pointerdown', origin); expect(accepted()).toEqual(before);
  // happy-dom's capture bookkeeping is used; this does not qualify native capture.
  pointer('pointermove', destination);
  expect(el('score-host').hasPointerCapture(73)).toBe(true);
  expect(el('score-host').shadowRoot!.querySelector('.pointer-ghost[data-valid="true"]'), el('pointer-status').textContent || '').not.toBeNull();
  expect(accepted()).toEqual(before); expect(recipe()).toEqual(palette);
  pointer('pointerup', destination); expect(el('score-host').hasPointerCapture(73)).toBe(false);
  await settled(); expect(document.activeElement).toBe(el('score-editor'));
}
async function place(point: Point, kind: 'note' | 'rest', expectedPitch?: string, admittedHover = true): Promise<string> {
  const before = accepted(), palette = recipe(), oldLayout = surface().getLayoutGeometry()!;
  pointer('pointermove', point);
  const preview = () => el('score-host').shadowRoot!.querySelector(`.pointer-ghost[data-valid="true"][data-entry-kind="${kind}"]`);
  if (admittedHover) expect(preview(), el('pointer-status').textContent || '').not.toBeNull();
  else expect(preview()).toBeNull();
  expect(accepted()).toEqual(before); expect(recipe()).toEqual(palette);
  pointer('pointerdown', point); expect(accepted()).toEqual(before); expect(recipe()).toEqual(palette);
  expect(preview(), el('pointer-status').textContent || '').not.toBeNull();
  pointer('pointerup', point);
  expect(app!.session.revision, el('pointer-status').textContent || el('author-errors').textContent || '').toBe(before.revision + 1);
  await settled(); writing(); expect(document.activeElement).toBe(el('score-editor'));
  expect(surface().getLayoutGeometry()!.revision).toBeGreaterThan(oldLayout.revision);
  const expected = structuredClone(palette); if (expectedPitch !== undefined) expected.values['event-pitch'] = expectedPitch;
  expect(recipe()).toEqual(expected); expect(el('entry-settings-label').textContent).toBe(kind === 'rest' ? 'Rest' : 'Note');
  expect(app!.session.selection.ids).toEqual([app!.session.cursor!.eventId!]);
  return app!.session.cursor!.eventId!;
}
async function undoAll(checkpoints: readonly string[]): Promise<void> {
  const palette = recipe();
  for (let index = checkpoints.length - 2; index >= 0; index--) {
    await click('undo'); await settled();
    expect(app!.session.project.sourceHtml).toBe(checkpoints[index]); writing(); expect(recipe()).toEqual(palette);
  }
  expect(app!.session.canUndo).toBe(false); expect(app!.session.canRedo).toBe(true);
  expect(app!.session.source.querySelector('music-note,music-rest')).toBeNull();
}

beforeEach(async () => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell; document.body.className = 'author-app'; actions.length = 0;
  for (const [name, value] of Object.entries({ innerWidth: 1360, innerHeight: 900 })) {
    dimensionsBefore.set(name, Object.getOwnPropertyDescriptor(window, name)); Object.defineProperty(window, name, { configurable: true, value });
  }
  vi.stubGlobal('DOMPoint', Point); vi.stubGlobal('ResizeObserver', ResizeObserverDouble);
  vi.spyOn(SVGSVGElement.prototype, 'getScreenCTM').mockImplementation(() => new Matrix() as unknown as DOMMatrix);
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const style = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = style(element, pseudo);
    return element.classList.contains('surface') ? new Proxy(computed, { get(target, property) {
      return property === 'width' ? '720px' : Reflect.get(target, property, target);
    } }) : computed;
  });
  const viewport = el('score-scroll'); viewport.style.overflow = 'auto';
  dimensions(viewport, 720, 640, () => new DOMRect(40, 80, 720, 640));
  dimensions(el('score-host'), 720, 640, () => new DOMRect(40 - viewport.scrollLeft, 80 - viewport.scrollTop, 720, 640));
  dimensions(el('author-workbench'), 1320, 740, () => new DOMRect(20, 60, 1320, 740));
  dimensions(el('workspace-dock'), 720, 52, () => new DOMRect(40, 730, 720, 52));
  engine.ready.mockReset().mockResolvedValue(); engine.render.mockReset().mockImplementation(draw);
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready); vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
  const ghost = () => {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 20 40');
    Object.defineProperty(svg, 'viewBox', { configurable: true, value: { baseVal: { x: 0, y: 0, width: 20, height: 40 } } }); return svg;
  };
  vi.mocked(createPitchPreview).mockImplementation(() => ({ svg: ghost(), headX: 10, headY: 20 }));
  vi.mocked(createRestPreview).mockImplementation(() => ({ svg: ghost(), anchorX: 10, anchorY: 20 }));
});
afterEach(async () => {
  app?.dispose(); app = undefined; document.body.replaceChildren(); await nextTask();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [name, descriptor] of dimensionsBefore) if (descriptor) Object.defineProperty(window, name, descriptor);
  dimensionsBefore.clear();
});

describe('real Author workspace pointer writing journeys', () => {
  it('writes 32 notes into eight genuinely empty bars through fixed Write and actual host releases, then undoes every edit', async () => {
    const execute = await mount(); const checkpoints = [app!.session.project.sourceHtml];
    const ids: string[] = [], pitches: string[] = [], kinds: 'note'[] = [];
    const notes = [{ y: 80, pitch: 'E4' }, { y: 75, pitch: 'F4' }, { y: 70, pitch: 'G4' }, { y: 65, pitch: 'A4' }];
    actions.length = 0;
    for (let index = 0; index < 32; index++) {
      const bar = Math.floor(index / 4), note = notes[index % 4], point = target(bar, note.y);
      if (index === 0 || index === 16) {
        const before = accepted(), palette = recipe();
        pointer('pointerdown', point);
        el('score-host').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
        pointer('pointerup', point); expect(accepted()).toEqual(before); expect(recipe()).toEqual(palette); writing();
        expect(execute).toHaveBeenCalledTimes(index);
      }
      ids.push(await place(point, 'note', note.pitch)); kinds.push('note'); pitches.push(note.pitch);
      checkpoints.push(app!.session.project.sourceHtml); expectMusic(ids, kinds, pitches);
      expect(execute).toHaveBeenCalledTimes(index + 1);
      expect(execute.mock.calls[index][0]).toMatchObject({ type: 'insert-event', position: 'after', cursor: { staffId: STAFF, measureId: BARS[bar], voiceIndex: 0 },
        value: { kind: 'note', pitch: note.pitch, duration: 'quarter', dots: 0, measureRest: false } });
    }
    expect(actions.every(action => action.startsWith('pointer:'))).toBe(true);
    expect(app!.session.source.querySelectorAll('music-note')).toHaveLength(32); expect(app!.session.source.querySelector('music-rest')).toBeNull();
    await undoAll(checkpoints); expect(execute).toHaveBeenCalledTimes(32);
    expect(actions.filter(action => action === 'click:undo')).toHaveLength(32);
  }, 30_000);

  it('uses real Note and Rest controls, preserves Fqs5 and invalid dormant pitch on rest completion, and never inserts through an open options surface', async () => {
    const execute = await mount(); const checkpoints = [app!.session.project.sourceHtml];
    const ids: string[] = [], kinds: ('note' | 'rest')[] = [], pitches: (string | undefined)[] = [];
    for (let index = 0; index < 8; index++) {
      const rest = index % 2 === 1, invalidDormant = index % 4 === 3, beforeControls = accepted();
      await click('entry-settings-trigger'); await click('entry-choose-note');
      await field('event-pitch', invalidDormant ? 'unfinished pitch text' : 'Fqs5');
      if (rest) await click('entry-choose-rest');
      expect(accepted()).toEqual(beforeControls); writing();
      expect(el('entry-choose-note').getAttribute('aria-pressed')).toBe(String(!rest));
      expect(el('entry-choose-rest').getAttribute('aria-pressed')).toBe(String(rest));
      const point = target(Math.floor(index / 4), rest ? 67 : 40);
      if (index === 1) {
        pointer('pointerdown', point); pointer('pointerup', point);
        expect(accepted()).toEqual(beforeControls); expect(execute).toHaveBeenCalledTimes(index); writing();
        expect(el('entry-settings').hidden).toBe(false);
      }
      await click('close-entry-settings'); expect(el('entry-settings').hidden).toBe(true);
      const dormant = el<HTMLInputElement>('event-pitch').value;
      // A click-only (keyboard-equivalent) Close does not invent a new pointer
      // press. The denied press remains inert through hover; this next actual
      // staff down must reset admission and produce the valid rest preview.
      ids.push(await place(point, rest ? 'rest' : 'note', rest ? undefined : 'Fqs5', index !== 1));
      kinds.push(rest ? 'rest' : 'note'); pitches.push(rest ? undefined : 'Fqs5');
      checkpoints.push(app!.session.project.sourceHtml); expectMusic(ids, kinds, pitches);
      expect(execute).toHaveBeenCalledTimes(index + 1); expect(el<HTMLInputElement>('event-pitch').value).toBe(dormant);
      expect(execute.mock.calls[index][0]).toMatchObject({ type: 'insert-event', value: { kind: rest ? 'rest' : 'note', pitch: dormant, duration: 'quarter', dots: 0, measureRest: false } });
      if (rest) {
        const source = app!.session.source.querySelector(`[id="${ids[index]}"]`)!;
        expect(source.localName).toBe('music-rest'); expect(source.hasAttribute('pitch')).toBe(false); expect(source.hasAttribute('measure')).toBe(false);
      }
    }
    expect(app!.session.source.querySelectorAll('music-note')).toHaveLength(4); expect(app!.session.source.querySelectorAll('music-rest')).toHaveLength(4);
    await undoAll(checkpoints); expect(execute).toHaveBeenCalledTimes(8);
  }, 30_000);
});

describe('completed pitch drags inspect their target independently of the writer', () => {
  it.each([false, true])('selects previously unselected B after changed=%s drag, updates Pitch and Properties, and preserves parked writer C', async changed => {
    const { execute, writer, palette } = await parkWriterAndInspect(false);
    const before = accepted(), project = app!.session.project, originalB = event(NOTE_B), originalA = event(NOTE_A), originalC = event(NOTE_C);
    const sourceB = app!.session.source.querySelector(`[id="${NOTE_B}"]`), sourceMark = app!.session.source.querySelector('#pointer-b-accent');
    const renderCount = engine.render.mock.calls.length;
    await dragNote(NOTE_B, changed);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-pitch', eventId: NOTE_B, pitch: changed ? 'Gqs4' : 'Fqs4', ties: 'reject' });
    expectInspection(NOTE_B, 1);
    expect(app!.session.cursor).toEqual(writer); expect(recipe()).toEqual(palette);
    expect(event(NOTE_A)).toEqual(originalA); expect(event(NOTE_C)).toEqual(originalC);
    expect(event(NOTE_B)).toEqual({ ...originalB, pitches: [{ ...originalB.pitches[0], step: changed ? 'G' : 'F' }] });
    expect(app!.session.source.querySelector(`[id="${NOTE_B}"]`)).toBe(sourceB);
    expect(app!.session.source.querySelector('#pointer-b-accent')).toBe(sourceMark);
    expect(sourceB?.getAttribute('data-player')).toBe('keep');
    expect(available(el('selection-inspector'))).toBe(true);
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_B);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe(changed ? 'Gqs4' : 'Fqs4');
    expect(el<HTMLSelectElement>('selected-duration').value).toBe('quarter');
    expect(el<HTMLSelectElement>('selected-dots').value).toBe('0');
    expect(el<HTMLSelectElement>('selected-accidental-display').value).toBe('courtesy');
    expect(el<HTMLSelectElement>('selected-stem').value).toBe('down');
    expect(app!.session.revision).toBe(before.revision + Number(changed));
    expect(app!.session.canUndo).toBe(changed); expect(app!.session.canRedo).toBe(!changed);
    if (!changed) {
      expect(app!.session.project).toEqual(project); expect(app!.session.project.sourceHtml).toBe(before.source);
      expect(engine.render).toHaveBeenCalledTimes(renderCount);
      expect(el('pointer-status').textContent).toContain('unchanged');
    }
    const afterDrag = accepted();
    await click('selection-pitch');
    expect(available(el('selection-note-step'))).toBe(true);
    expect(el<HTMLSelectElement>('selection-note-step').value).toBe(changed ? 'G' : 'F');
    expect(el<HTMLSelectElement>('selection-note-octave').value).toBe('4');
    expect(el<HTMLSelectElement>('selection-alteration').value).toBe('0.5');
    await click('close-selection-pitch');
    await click('tools-hide'); await openProperties();
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_B);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe(changed ? 'Gqs4' : 'Fqs4');
    expect(accepted()).toEqual(afterDrag); expect(recipe()).toEqual(palette);
    if (changed) {
      await click('undo'); await settled();
      expect(app!.session.project.sourceHtml).toBe(before.source);
      expect(event(NOTE_B)).toEqual(originalB); expect(event(NOTE_A)).toEqual(originalA); expect(event(NOTE_C)).toEqual(originalC);
      expect(app!.session.revision).toBe(before.revision + 2);
      expect(app!.session.canUndo).toBe(false); expect(app!.session.canRedo).toBe(true);
      expect(app!.session.cursor).toEqual(writer); expectInspection(NOTE_A, 0); expect(recipe()).toEqual(palette);
    }
    const beforeResume = accepted();
    await click('toggle-entry'); await settled(); writing();
    expect(app!.session.cursor).toEqual(writer); expect(el<HTMLSelectElement>('measure-select').value).toBe(BARS[6]);
    expect(recipe()).toEqual(palette); expect(accepted()).toEqual(beforeResume);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([false, true])('keeps dirty Properties on A while changed=%s drag deliberately selects B, until explicit discard and reload', async changed => {
    const { execute, writer, palette } = await parkWriterAndInspect(true);
    const before = accepted(), originalA = event(NOTE_A), originalB = event(NOTE_B);
    await dragNote(NOTE_B, changed); expectInspection(NOTE_B, 1);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-pitch', eventId: NOTE_B, pitch: changed ? 'Gqs4' : 'Fqs4', ties: 'reject' });
    expect(app!.session.cursor).toEqual(writer); expect(recipe()).toEqual(palette);
    expect(event(NOTE_A)).toEqual(originalA);
    expect(event(NOTE_B)).toEqual({ ...originalB, pitches: [{ ...originalB.pitches[0], step: changed ? 'G' : 'F' }] });
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_A);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('D5');
    expect(el('selected-draft-status').textContent).toMatch(/draft|unapplied|return|discard/i);
    expect(el<HTMLButtonElement>('update-event').disabled).toBe(true);
    expect(el<HTMLButtonElement>('remove-event').disabled).toBe(true);
    expect(available(el('return-selected-draft'))).toBe(true);
    expect(available(el('load-event-values'))).toBe(true);
    expect(app!.session.revision).toBe(before.revision + Number(changed));
    expect(app!.session.canUndo).toBe(changed); expect(app!.session.canRedo).toBe(!changed);
    if (!changed) expect(app!.session.project.sourceHtml).toBe(before.source);
    const afterDrag = accepted();
    await click('selection-pitch');
    expect(el<HTMLSelectElement>('selection-note-step').value).toBe(changed ? 'G' : 'F');
    expect(el<HTMLSelectElement>('selection-alteration').value).toBe('0.5');
    await click('close-selection-pitch');
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_A);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('D5');
    await click('tools-hide'); await openProperties(false);
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_A);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('D5');
    expect(accepted()).toEqual(afterDrag); expect(recipe()).toEqual(palette);
    await click('load-event-values');
    expect(el('selection-inspector').dataset.draftTarget).toBe(NOTE_B);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe(changed ? 'Gqs4' : 'Fqs4');
    expect(el<HTMLInputElement>('selected-pitch').disabled).toBe(false);
    expect(el('load-event-values').hidden).toBe(true);
    expect(el<HTMLButtonElement>('update-event').disabled).toBe(true); // Clean accepted B has no draft to apply.
    expect(accepted()).toEqual(afterDrag); expect(recipe()).toEqual(palette);
    expect(execute).toHaveBeenCalledOnce();
  });
});
