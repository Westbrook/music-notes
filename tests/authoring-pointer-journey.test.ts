// @vitest-environment happy-dom
/**
 * Real PointerController → StaffInteraction → EditorSession → Source journeys.
 * Only the renderer, its rectangles/transforms, and engraved previews are doubles.
 * Synthetic host events do not qualify native capture, touch, SVG ink, or layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { StaffInteraction } from '../src/authoring/staff-interaction.js';
import type { AuthorCommand, EventInput } from '../src/authoring/types.js';
import { readScore } from '../src/dom/index.js';
import { add, pitchText, rational, toNumber } from '../src/model/index.js';
import type { Score } from '../src/model/types.js';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';
import type { EventGeometry, InsertionAnchor, MeasureGeometry, SystemGeometry } from '../src/engraving/render.js';
import { createPitchPreview, createRestPreview } from '../src/engraving/pointer-preview.js';

vi.mock('../src/engraving/pointer-preview.js', () => ({ createPitchPreview: vi.fn(), createRestPreview: vi.fn() }));

type Options = ConstructorParameters<typeof StaffInteraction>[0];
type Point = { clientX: number; clientY: number };
const NS = 'http://www.w3.org/2000/svg';
const STAFF = 'journey-staff';
const BAR_IDS = Array.from({ length: 8 }, (_, index) => `journey-bar-${index + 1}`);
const SOURCE = `<music-system id="journey-score"><music-staff id="${STAFF}" clef="treble" meter="4/4">${
  BAR_IDS.map((id, index) => `<music-measure id="${id}" number="${index + 1}" incomplete></music-measure>`).join('')
}</music-staff></music-system>`;
const QUARTER_X = [75, 120, 175, 245, 305] as const;
const interactions: StaffInteraction[] = [];
const descriptors: [object, string, PropertyDescriptor | undefined][] = [];

/** Translation-only screen geometry, deliberately not a browser SVG implementation. */
class Matrix {
  readonly a = 1; readonly b = 0; readonly c = 0; readonly d = 1;
  readonly e: number; readonly f: number;
  constructor(e = 0, f = 0) { this.e = e; this.f = f; }
  inverse(): Matrix { return new Matrix(-this.e, -this.f); }
  multiply(other: Matrix): Matrix { return new Matrix(this.e + other.e, this.f + other.f); }
}
class ScreenPoint {
  readonly x: number; readonly y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  matrixTransform(matrix: Matrix): ScreenPoint { return new ScreenPoint(this.x + matrix.e, this.y + matrix.f); }
}

function preview(kind: 'note' | 'rest'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.dataset.previewKind = kind;
  svg.setAttribute('viewBox', '0 0 20 40');
  Object.defineProperty(svg, 'viewBox', { configurable: true, value: { baseVal: { x: 0, y: 0, width: 20, height: 40 } } });
  return svg;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('DOMPoint', ScreenPoint);
  for (const [name, value] of [['innerWidth', 1180], ['innerHeight', 900]] as const) {
    descriptors.push([window, name, Object.getOwnPropertyDescriptor(window, name)]);
    Object.defineProperty(window, name, { configurable: true, value });
  }
  vi.spyOn(SVGSVGElement.prototype, 'getScreenCTM').mockImplementation(() => new Matrix() as DOMMatrix);
  vi.mocked(createPitchPreview).mockImplementation(() => ({ svg: preview('note'), headX: 10, headY: 20 }));
  vi.mocked(createRestPreview).mockImplementation(() => ({ svg: preview('rest'), anchorX: 10, anchorY: 20 }));
});
afterEach(() => {
  interactions.splice(0).forEach(interaction => interaction.dispose());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
  for (const [object, key, descriptor] of descriptors.splice(0)) {
    if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
  }
});

/** Four wrapped systems with two bars each; x comes from published boundaries. */
function geometry(score: Score): SystemGeometry[] {
  const staff = score.staves[0];
  return Array.from({ length: 4 }, (_, systemIndex) => {
    const start = systemIndex * 2;
    const measures: MeasureGeometry[] = []; const events: EventGeometry[] = []; const anchors: InsertionAnchor[] = [];
    for (let measureIndex = start; measureIndex < start + 2; measureIndex++) {
      const measure = staff.measures[measureIndex]; const left = (measureIndex - start) * 360;
      const lane: MeasureGeometry = { sourceId: measure.id, staffId: staff.id, system: systemIndex, measureIndex,
        x: left + 20, y: 20, width: 320, height: 100, topLine: 40, bottomLine: 80,
        notation: 'pitched', staffSpace: 10, noteStartX: left + 50, noteEndX: left + 330 };
      measures.push(lane);
      for (const voice of measure.voices) {
        const xAt = (onset: Parameters<typeof toNumber>[0]) => {
          const column = QUARTER_X[toNumber(onset) * 4];
          if (column === undefined) throw new Error('Journey renderer only accepts exact quarter-note boundaries.');
          return left + column;
        };
        voice.events.forEach((event, eventIndex) => {
          const x = xAt(event.onset); const ink = { x: x - 6, y: 54, width: 12, height: 32 };
          events.push({ ...ink, sourceId: event.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id,
            system: systemIndex, eventIndex, anchorX: x, anchorY: 60, onset: event.onset, ink, sharedSourceIds: [event.id],
            noteheads: event.kind === 'note' ? [{ pitchIndex: 0, x: x - 6, y: 55, width: 12, height: 10, centerX: x, centerY: 60 }] : [] });
        });
        for (let eventIndex = 0; eventIndex <= voice.events.length; eventIndex++) {
          const before = voice.events[eventIndex]; const after = voice.events[eventIndex - 1];
          const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
          anchors.push({ sourceId: voice.id, staffId: staff.id, measureId: measure.id, voiceId: voice.id,
            system: systemIndex, eventIndex, ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}),
            onset, x: xAt(onset), y: 40, height: 40 });
        }
      }
    }
    return { index: systemIndex, start, end: start + 2, width: 720, height: 160, viewBox: { x: 0, y: 0, width: 720, height: 160 },
      ink: { x: 20, y: 20, width: 680, height: 100 }, pageBreak: false, staves: [], measures, events, anchors,
      annotations: [], markings: [], tuplets: [] };
  });
}

function fixture() {
  const session = new EditorSession(createProject(SOURCE, 'Eight-bar pointer journey'));
  session.select(BAR_IDS[0]);
  const workbench = document.createElement('main');
  workbench.innerHTML = '<section id="score-editor"><div id="score-scroll"><div id="score-host"></div></div></section>'
    + '<section id="workspace-dock"><button id="drag-entry">Drag</button><button id="drag-pitch">Drag pitch</button><p id="pointer-status"></p></section>';
  document.body.append(workbench);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => workbench.querySelector<T>(`#${id}`)!;
  const editor = el('score-editor'); const scroller = el('score-scroll'); const host = el('score-host');
  const shadow = host.attachShadow({ mode: 'open' }); const mount = document.createElement('div'); shadow.append(mount);
  const surface = document.createElement('music-system') as MusicSurface; surface.id = 'journey-score'; mount.append(surface);
  const screen = document.createElement('div'); screen.className = 'screen'; surface.attachShadow({ mode: 'open' }).append(screen);
  const viewport = new DOMRect(40, 80, 720, 640);
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(viewport);
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(viewport);
  vi.spyOn(el('workspace-dock'), 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 730, 720, 48));
  for (const [key, value] of Object.entries({ clientWidth: 720, offsetWidth: 720, clientHeight: 640, offsetHeight: 640, clientLeft: 0, clientTop: 0 })) {
    Object.defineProperty(scroller, key, { configurable: true, value });
  }
  let projected: ReturnType<typeof readScore>; let layout: LayoutGeometry; let revision = 0;
  const render = () => {
    // New projected elements deliberately acquire new implicit voice aliases.
    // No accepted Source node or ID is rewritten by this rendering double.
    const clone = session.source.cloneNode(true) as Element;
    surface.replaceChildren(...clone.childNodes);
    projected = readScore(surface);
    const systems = geometry(projected.score); revision++;
    layout = { projection: 'screen', projectionId: `journey-screen-${revision}`, revision, scoreId: projected.score.id, systems };
    screen.replaceChildren(...systems.map(system => {
      const row = document.createElement('div'); row.className = 'system-row';
      const svg = document.createElementNS(NS, 'svg'); svg.classList.add('notation-svg');
      Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => new Matrix(40, 80 + system.index * 160) });
      row.append(svg); return row;
    }));
  };
  Object.defineProperties(surface, {
    score: { get: () => projected.score }, getSource: { value: (id: string) => projected.sources.get(id) },
    getLayoutGeometry: { value: () => layout }, renderRevision: { get: () => revision },
  });
  render();
  const entry: EventInput = { kind: 'note', pitch: 'C4', pitches: '', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };
  const state: ReturnType<Options['state']> = { mode: 'write', entryMode: true, voiceIndex: 0, partId: 'score', position: 'after', surface, ready: true };
  let dispatching: string | undefined;
  const commitPhases: (string | undefined)[] = []; const commands: AuthorCommand[] = [];
  const execute = vi.spyOn(session, 'execute');
  const commit = vi.fn<Options['commit']>(command => {
    commitPhases.push(dispatching); commands.push(structuredClone(command));
    session.execute(command); render();
  });
  const completed = vi.fn<Options['completed']>((_kind, pitch) => {
    // This is the public completion contract, not AuthorWorkspace/private entry.
    // Rest completion must not replace a dormant pitch with a fabricated value.
    if (pitch !== undefined) entry.pitch = pitch;
  });
  const rejected = vi.fn<NonNullable<Options['rejected']>>(() => false); const error = vi.fn<Options['error']>();
  const interaction = new StaffInteraction({ session, host, editor, entryHandle: el<HTMLButtonElement>('drag-entry'),
    pitchHandle: el<HTMLButtonElement>('drag-pitch'), status: el('pointer-status'), state: () => state, readEntry: () => entry,
    selection: () => ({ fingerprint: JSON.stringify([session.documentEpoch, session.selectionVersion, session.selection]),
      eventIds: session.selection.ids, selectMore: false }), commit, completed, rejected, error });
  interactions.push(interaction);
  const pointer = (type: 'pointermove' | 'pointerdown' | 'pointerup', point: Point, buttons = type === 'pointerup' ? 0 : 1) => {
    const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 71,
      pointerType: 'mouse', isPrimary: true, button: 0, buttons, ...point });
    dispatching = type;
    try { host.dispatchEvent(event); } finally { dispatching = undefined; }
    return event;
  };
  const point = (barIndex: number, beatIndex: number, y = 60): Point => ({
    clientX: 40 + barIndex % 2 * 360 + QUARTER_X[beatIndex], clientY: 80 + Math.floor(barIndex / 2) * 160 + y,
  });
  return { session, entry, surface, host, shadow, render, point, pointer, commit, commands, commitPhases, execute, completed, rejected, error,
    status: el('pointer-status'), projected: () => projected.score, layout: () => layout };
}

type Fixture = ReturnType<typeof fixture>;
function snapshot(f: Fixture) {
  return { source: f.session.project.sourceHtml, revision: f.session.revision, undo: f.session.canUndo, redo: f.session.canRedo,
    cursor: f.session.cursor, selection: f.session.selection, commits: f.commit.mock.calls.length, executions: f.execute.mock.calls.length };
}
function previewWithoutEdit(f: Fixture, point: Point, kind: 'note' | 'rest'): void {
  const before = snapshot(f);
  f.pointer('pointermove', point, 0);
  expect(f.shadow.querySelector('.pointer-ghost[data-valid="true"]'), f.status.textContent ?? '').not.toBeNull();
  expect(f.shadow.querySelector(`.pointer-ghost [data-preview-kind="${kind}"]`)).not.toBeNull();
  expect(snapshot(f)).toEqual(before);
}
function cancelWithoutEdit(f: Fixture, point: Point, reason: 'escape' | 'rerender'): void {
  const before = snapshot(f); f.pointer('pointerdown', point);
  expect(snapshot(f)).toEqual(before);
  if (reason === 'escape') f.host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
  else f.render();
  f.pointer('pointerup', point);
  expect(snapshot(f)).toEqual(before); expect(f.shadow.querySelector('.pointer-ghost')).toBeNull();
}
function place(f: Fixture, point: Point): void {
  const before = snapshot(f);
  const previousLayout = f.layout();
  const previousVoices = f.projected().staves[0].measures.map(measure => measure.voices[0].id);
  f.pointer('pointerdown', point); expect(snapshot(f)).toEqual(before);
  f.pointer('pointerup', point);
  expect(f.commit, f.status.textContent ?? '').toHaveBeenCalledTimes(before.commits + 1);
  expect(f.session.revision).toBe(before.revision + 1);
  expect(f.commitPhases.at(-1)).toBe('pointerup');
  expect(f.layout()).not.toBe(previousLayout); expect(f.layout().revision).toBe(previousLayout.revision + 1);
  expect(f.surface.getLayoutGeometry()).toBe(f.layout());
  f.projected().staves[0].measures.forEach((measure, index) => expect(measure.voices[0].id).not.toBe(previousVoices[index]));
  expect(f.rejected).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled();
}
function expectScore(f: Fixture, ids: readonly string[], kinds: readonly ('note' | 'rest')[], pitches: readonly (string | undefined)[]): void {
  const score = f.session.score;
  expect(score.staves.map(staff => staff.id)).toEqual([STAFF]);
  expect(score.staves[0].measures.map(measure => measure.id)).toEqual(BAR_IDS);
  expect(f.session.source.querySelectorAll('music-voice')).toHaveLength(0);
  const acceptedIds: string[] = [];
  score.staves[0].measures.forEach((measure, barIndex) => {
    expect(measure.voices).toHaveLength(1);
    const projectedVoice = f.projected().staves[0].measures[barIndex].voices[0];
    expect(projectedVoice.id).not.toBe(measure.voices[0].id);
    expect(f.surface.getSource(projectedVoice.id)).toBe(f.surface.getSource(measure.id));
    expect(measure.voices[0].events).toHaveLength(Math.min(4, Math.max(0, ids.length - barIndex * 4)));
    measure.voices[0].events.forEach((event, beatIndex) => {
      const index = barIndex * 4 + beatIndex; acceptedIds.push(event.id);
      expect(event).toMatchObject({ id: ids[index], kind: kinds[index], duration: 'quarter', dots: 0,
        onset: rational(beatIndex, 4), time: rational(1, 4), measureRest: false, tupletIds: [] });
      expect(event.pitches.map(pitchText)).toEqual(pitches[index] === undefined ? [] : [pitches[index]]);
      expect(f.surface.getSource(event.id)?.closest('music-measure')?.id).toBe(measure.id);
    });
  });
  expect(acceptedIds).toEqual(ids); expect(new Set(ids).size).toBe(ids.length);
  expect(f.session.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  expect(f.surface.getLayoutGeometry()?.revision).toBe(f.surface.renderRevision);
}
function undoJourney(f: Fixture, sources: readonly string[]): void {
  for (let remaining = sources.length - 2; remaining >= 0; remaining--) {
    expect(f.session.canUndo).toBe(true); f.session.undo(); f.render();
    expect(f.session.project.sourceHtml).toBe(sources[remaining]);
  }
  expect(f.session.canUndo).toBe(false); expect(f.session.canRedo).toBe(true);
  expect(f.session.source.querySelectorAll('music-note, music-rest')).toHaveLength(0);
  expect(f.session.score.staves[0].measures.every(measure => measure.incomplete && measure.voices[0].events.length === 0)).toBe(true);
  expect(f.execute).toHaveBeenCalledTimes(32); expect(f.commit).toHaveBeenCalledTimes(32);
}

describe('eight-bar pointer entry journeys through the real transaction boundary', () => {
  it('enters 32 quarter notes across fresh empty-voice projections, with one Undo per release and no hover/cancel writes', () => {
    const f = fixture(); const sources = [f.session.project.sourceHtml]; const ids: string[] = [];
    const kinds: 'note'[] = []; const pitches: string[] = [];
    const notes = [{ y: 55, pitch: 'C5' }, { y: 65, pitch: 'A4' }, { y: 75, pitch: 'F4' }, { y: 50, pitch: 'D5' }];
    expectScore(f, ids, kinds, pitches); expect(f.session.canUndo).toBe(false);
    for (let index = 0; index < 32; index++) {
      const bar = Math.floor(index / 4); const beat = index % 4; const note = notes[beat]; const point = f.point(bar, beat, note.y);
      previewWithoutEdit(f, point, 'note');
      if (index === 0 || index === 7 || index === 31) cancelWithoutEdit(f, point, 'escape');
      if (index === 16) cancelWithoutEdit(f, point, 'rerender');
      place(f, point);
      ids.push(f.session.cursor!.eventId!); kinds.push('note'); pitches.push(note.pitch); sources.push(f.session.project.sourceHtml);
      expectScore(f, ids, kinds, pitches);
      expect(f.completed).toHaveBeenLastCalledWith('insert', note.pitch);
      expect(f.commands[index]).toMatchObject({ type: 'insert-event', position: 'after', cursor: { staffId: STAFF, measureId: BAR_IDS[bar], voiceIndex: 0 } });
    }
    expect(f.commands.every(command => command.type === 'insert-event')).toBe(true);
    expect(f.completed).toHaveBeenCalledTimes(32); expect(f.commitPhases).toEqual(Array(32).fill('pointerup'));
    const completedSource = sources.at(-1)!;
    undoJourney(f, sources);
    for (let index = 1; index < sources.length; index++) {
      expect(f.session.canRedo).toBe(true); f.session.redo(); f.render(); expect(f.session.project.sourceHtml).toBe(sources[index]);
    }
    expect(f.session.canRedo).toBe(false); expect(f.session.project.sourceHtml).toBe(completedSource);
    expectScore(f, ids, kinds, pitches); expect(f.execute).toHaveBeenCalledTimes(32);
  }, 20_000);

  it('alternates 16 notes and 16 ordinary rests without parsing or replacing the dormant rest pitch', () => {
    const f = fixture(); const sources = [f.session.project.sourceHtml]; const ids: string[] = [];
    const kinds: ('note' | 'rest')[] = []; const pitches: (string | undefined)[] = [];
    for (let index = 0; index < 32; index++) {
      const bar = Math.floor(index / 4); const beat = index % 4; const rest = index % 2 === 1;
      f.entry.kind = rest ? 'rest' : 'note';
      f.entry.pitch = rest && beat === 3 ? 'unfinished pitch text' : 'Fqs5';
      const recipe = { ...f.entry }; const point = f.point(bar, beat, rest ? 67 : 40);
      previewWithoutEdit(f, point, rest ? 'rest' : 'note'); expect(f.entry).toEqual(recipe);
      if (index === 1 || index === 3) { cancelWithoutEdit(f, point, 'escape'); expect(f.entry).toEqual(recipe); }
      place(f, point);
      ids.push(f.session.cursor!.eventId!); kinds.push(rest ? 'rest' : 'note'); pitches.push(rest ? undefined : 'Fqs5');
      sources.push(f.session.project.sourceHtml); expectScore(f, ids, kinds, pitches);
      expect(f.entry).toEqual(recipe);
      expect(f.completed).toHaveBeenLastCalledWith('insert', rest ? undefined : 'Fqs5');
      const command = f.commands[index]; expect(command).toMatchObject({ type: 'insert-event', value: { kind: rest ? 'rest' : 'note', pitch: recipe.pitch, measureRest: false } });
      if (rest) {
        const source = f.session.source.querySelector(`[id="${ids[index]}"]`)!;
        expect(source.localName).toBe('music-rest'); expect(source.hasAttribute('pitch')).toBe(false);
        expect(source.hasAttribute('pitches')).toBe(false); expect(source.hasAttribute('measure')).toBe(false);
      }
    }
    expect(f.completed).toHaveBeenCalledTimes(32); expect(f.commitPhases).toEqual(Array(32).fill('pointerup'));
    expect(f.session.source.querySelectorAll('music-note')).toHaveLength(16);
    expect(f.session.source.querySelectorAll('music-rest')).toHaveLength(16);
    undoJourney(f, sources);
  }, 20_000);
});
