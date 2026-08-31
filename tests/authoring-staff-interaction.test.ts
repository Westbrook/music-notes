import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { StaffInteraction } from '../src/authoring/staff-interaction.js';
import type { PointerSelection } from '../src/authoring/staff-interaction.js';
import type { EventInput } from '../src/authoring/types.js';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';
import { createPitchPreview, createRestPreview } from '../src/engraving/pointer-preview.js';
import type { SystemGeometry } from '../src/engraving/render.js';
import { add, rational, toNumber } from '../src/model/index.js';
import type { Score, Staff } from '../src/model/types.js';
import { readScore } from '../src/dom/index.js';

vi.mock('../src/engraving/pointer-preview.js', () => ({ createPitchPreview: vi.fn(), createRestPreview: vi.fn() }));

type Options = ConstructorParameters<typeof StaffInteraction>[0];
type ExpectedFeedback = { message: string; kind: 'selection' | 'gesture' | 'notice' | 'info' };
const NS = 'http://www.w3.org/2000/svg';
const fullMeasure = '<music-staff id="staff" label="Solo"><music-measure id="bar"><music-note id="last" pitch="C4" duration="whole"></music-note></music-measure></music-staff>';
const shortMeasure = fullMeasure.replace('id="bar"', 'id="bar" incomplete').replace('duration="whole"', 'duration="half"');
const interactions: StaffInteraction[] = [];

/** Geometry is deliberately synthetic. These tests qualify routing, not painted ink or hardware capture. */
class TestMatrix {
  readonly a = 1; readonly b = 0; readonly c = 0; readonly d = 1;
  readonly e: number; readonly f: number;
  constructor(e = 0, f = 0) { this.e = e; this.f = f; }
  inverse(): TestMatrix { return new TestMatrix(-this.e, -this.f); }
  multiply(other: TestMatrix): TestMatrix { return new TestMatrix(this.e + other.e, this.f + other.f); }
}
class TestPoint {
  readonly x: number; readonly y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  matrixTransform(matrix: TestMatrix): TestPoint {
    return new TestPoint(this.x * matrix.a + this.y * matrix.c + matrix.e, this.x * matrix.b + this.y * matrix.d + matrix.f);
  }
}

function geometry(session: EditorSession): SystemGeometry {
  const staff = session.score.staves[0]; const measure = staff.measures[0];
  const bottomLine = staff.notation === 'rhythm' ? 140 : 180;
  const lane = { sourceId: measure.id, system: 0, staffId: staff.id, measureIndex: 0,
    x: 100, y: 110, width: 400, height: 130, topLine: 140, bottomLine, notation: staff.notation ?? 'pitched', staffSpace: 10, noteStartX: 120, noteEndX: 450 };
  const xAt = (value: number) => 180 + 180 * value;
  return {
    index: 0, start: 0, end: 1, width: 720, height: 450,
    viewBox: { x: 0, y: 0, width: 720, height: 450 }, ink: { x: 100, y: 125, width: 400, height: 90 }, pageBreak: false,
    staves: [], measures: [lane], annotations: [], tuplets: [],
    events: measure.voices.flatMap(voice => voice.events.map((event, eventIndex) => {
      const x = xAt(toNumber(event.onset)); const ink = { x: x - 6, y: 186, width: 12, height: 8 };
      return { ...ink, sourceId: event.id, system: 0, staffId: staff.id, measureId: measure.id, voiceId: voice.id,
        eventIndex, anchorX: x, anchorY: 160, onset: event.onset, ink, sharedSourceIds: [event.id],
        noteheads: event.pitches.length ? [{ ...ink, pitchIndex: 0, centerX: x, centerY: 190 }] : [] };
    })),
    anchors: measure.voices.flatMap(voice => Array.from({ length: voice.events.length + 1 }, (_, eventIndex) => {
      const before = voice.events[eventIndex]; const after = voice.events[eventIndex - 1];
      const onset = before?.onset ?? (after ? add(after.onset, after.time) : rational(0));
      return { sourceId: voice.id, system: 0, staffId: staff.id, measureId: measure.id, voiceId: voice.id, eventIndex,
        ...(before ? { beforeId: before.id } : {}), ...(after ? { afterId: after.id } : {}), onset,
        x: xAt(toNumber(onset)), y: 140, height: bottomLine - 140 };
    })),
  };
}

function fixture(html = fullMeasure) {
  const session = new EditorSession(createProject(html, 'Rejected pointer insertion'));
  session.select('last');
  const editor = document.createElement('section');
  editor.innerHTML = '<div id="pointer-tools"><button id="entry">Drag note</button><button id="pitch">Drag pitch</button></div>'
    + '<div id="score-scroll"><div id="score-host"></div></div><p id="status"></p>';
  document.body.append(editor);
  const host = editor.querySelector<HTMLElement>('#score-host')!;
  const scroller = editor.querySelector<HTMLElement>('#score-scroll')!;
  const toolbar = editor.querySelector<HTMLElement>('#pointer-tools')!;
  const entryHandle = editor.querySelector<HTMLButtonElement>('#entry')!;
  const pitchHandle = editor.querySelector<HTMLButtonElement>('#pitch')!;
  const status = editor.querySelector<HTMLElement>('#status')!;
  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div'); shadow.append(mount);
  const overlayMount = document.createElement('div'); shadow.append(overlayMount);
  const surface = document.createElement('music-system') as MusicSurface;
  mount.append(surface);
  const surfaceShadow = surface.attachShadow({ mode: 'open' });
  const rendered = document.createElement('div'); surfaceShadow.append(rendered);
  const svg = document.createElementNS(NS, 'svg'); rendered.append(svg);
  const bounds = { host: new DOMRect(20, 100, 700, 400), viewport: new DOMRect(20, 100, 700, 300), scale: 1 };
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => bounds.host);
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => bounds.viewport);
  vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 35, 700, 50));
  for (const field of ['clientWidth', 'clientHeight', 'clientLeft', 'clientTop', 'offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(scroller, field, { configurable: true, get: () => field === 'clientWidth' || field === 'offsetWidth'
      ? bounds.viewport.width / bounds.scale : field === 'clientHeight' || field === 'offsetHeight' ? bounds.viewport.height / bounds.scale : 0 });
  }
  let matrix = new TestMatrix();
  Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => matrix });
  let layout: LayoutGeometry = { projection: 'screen', projectionId: 'pointer-fixture', revision: 1,
    scoreId: session.score.id, systems: [geometry(session)] };
  let projectionAvailable = true;
  let nativeControlBounds: readonly DOMRectReadOnly[] = [];
  Object.defineProperties(surface, {
    getLayoutGeometry: { value: () => layout },
    getRenderedProjection: { value: (): ReturnType<MusicSurface['getRenderedProjection']> => projectionAvailable ? {
      surface, renderRevision: layout.revision, layout, frames: layout.systems.map(system => ({ system, svg, row: rendered })),
    } : undefined },
    getNativeControlBounds: { value: () => nativeControlBounds },
    renderRevision: { get: () => layout.revision },
  });
  surfaceShadow.addEventListener('scroll', event => {
    surface.dispatchEvent(new CustomEvent('notation-viewport-change', {
      bubbles: true, composed: true, detail: { scroller: event.target, layout },
    }));
  }, { capture: true });
  const state: ReturnType<Options['state']> = { mode: 'write', ready: true, entryMode: true,
    voiceIndex: 0, partId: 'score', position: 'after', surface };
  const entry: EventInput = { kind: 'note', pitch: 'D#4', pitches: '', duration: 'quarter', dots: 1,
    rhythmic: false, measureRest: false, accidentalDisplay: 'courtesy', stem: 'down', beam: 'none' };
  const readEntry = vi.fn(() => entry);
  const commit = vi.fn<Options['commit']>(command => { session.execute(command); });
  const completed = vi.fn<Options['completed']>();
  const rejected = vi.fn<NonNullable<Options['rejected']>>(() => false);
  const error = vi.fn<Options['error']>();
  const feedback = vi.fn<(value: ExpectedFeedback) => void>();
  const options: Options & { feedback?: (value: ExpectedFeedback) => void } = {
    session, host, overlayMount, getViewport: () => scroller, getChromeBounds: () => [toolbar.getBoundingClientRect()],
    entryHandle, pitchHandle, status, state: () => state,
    readEntry, commit, completed, rejected, error, feedback };
  const interaction = new StaffInteraction(options); interactions.push(interaction);
  return { session, editor, host, mount, overlayMount, rendered, scroller, toolbar, entryHandle, pitchHandle, status, surface, svg, bounds,
    state, entry, readEntry, commit, completed, rejected, error, feedback, interaction, options,
    layout: () => layout, setLayout: (next: LayoutGeometry) => { layout = next; },
    setProjectionAvailable: (value: boolean) => { projectionAvailable = value; },
    setNativeControlBounds: (value: readonly DOMRectReadOnly[]) => { nativeControlBounds = value; },
    changeMatrix: () => { matrix = new TestMatrix(0, -20); },
    changeLayout: () => { layout = { ...layout, revision: layout.revision + 1 }; } };
}

function pointer(type: string, target: EventTarget, extra: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true,
    pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: 355, clientY: 160, ...extra });
  target.dispatchEvent(event);
  return event;
}
function tap(f: ReturnType<typeof fixture>, extra: PointerEventInit = {}): void {
  pointer('pointerdown', f.host, extra);
  pointer('pointerup', window, extra);
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('DOMPoint', TestPoint);
  vi.spyOn(SVGSVGElement.prototype, 'getScreenCTM').mockImplementation(() => new TestMatrix() as DOMMatrix);
  vi.mocked(createPitchPreview).mockImplementation(() => {
    const svg = document.createElementNS(NS, 'svg');
    Object.defineProperty(svg, 'viewBox', { configurable: true, value: { baseVal: { x: 0, y: 0, width: 20, height: 40 } } });
    return { svg, headX: 10, headY: 30 };
  });
  vi.mocked(createRestPreview).mockImplementation(() => {
    const svg = document.createElementNS(NS, 'svg');
    Object.defineProperty(svg, 'viewBox', { configurable: true, value: { baseVal: { x: 0, y: 0, width: 16, height: 32 } } });
    return { svg, anchorX: 8, anchorY: 16 };
  });
});
afterEach(() => {
  for (const interaction of interactions.splice(0)) interaction.dispose();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('native ownership and exact selection before mutation gestures', () => {
  function selection(f: ReturnType<typeof fixture>): PointerSelection {
    const state: PointerSelection = { fingerprint: 'document:1/selection:1', eventIds: ['last'], selectMore: false };
    f.options.selection = () => state;
    return state;
  }

  it.each(['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const)('never inserts or repitches on a press carrying %s', modifier => {
    const f = fixture(); selection(f);
    const before = f.session.project;
    pointer('pointerdown', f.host, { [modifier]: true });
    pointer('pointermove', window, { [modifier]: true, clientX: 370 });
    pointer('pointerup', window, { [modifier]: true, clientX: 370 });
    expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
    expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.project).toEqual(before);
    expect(document.body.dataset.pointerGesture).toBeUndefined();
  });

  it('parks entry before a Shift selection press without creating an insertion snapshot', () => {
    const f = fixture(); selection(f);
    const park = vi.fn(() => { expect(f.state.entryMode).toBe(true); f.state.entryMode = false; });
    f.options.beforeSelectionGesture = park;
    tap(f, { shiftKey: true });
    expect(park).toHaveBeenCalledTimes(1); expect(f.readEntry).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('parks entry for the modifier-free Select more mode before either handle or staff mutation', () => {
    const f = fixture(); const selected = selection(f); selected.selectMore = true;
    const park = vi.fn(() => { f.state.entryMode = false; }); f.options.beforeSelectionGesture = park;
    tap(f);
    pointer('pointerdown', f.entryHandle); pointer('pointermove', window, { clientX: 380 }); pointer('pointerup', window, { clientX: 380 });
    expect(park).toHaveBeenCalledTimes(1); expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  });

  it('leaves macOS Control-click native and does not park writing or mutate music', () => {
    const f = fixture(); selection(f); const park = vi.fn(); f.options.beforeSelectionGesture = park;
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const down = pointer('pointerdown', f.host, { ctrlKey: true }); pointer('pointerup', window, { ctrlKey: true });
    expect(down.defaultPrevented).toBe(false); expect(park).not.toHaveBeenCalled();
    expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(['group', 'empty', 'child'] as const)('does not pitch-drag the primary of a %s selection', kind => {
    const f = fixture(); f.state.entryMode = false;
    const selected = selection(f);
    if (kind === 'group') selected.eventIds = ['last', 'other'];
    if (kind === 'empty') selected.eventIds = [];
    if (kind === 'child') selected.activeMarkingId = 'attached-mark';
    pointer('pointerdown', f.pitchHandle, { clientX: 650, clientY: 55 });
    pointer('pointermove', window, { clientX: 180, clientY: 160 }); pointer('pointerup', window, { clientX: 180, clientY: 160 });
    pointer('pointerdown', f.host, { clientX: 180, clientY: 190 });
    pointer('pointermove', window, { clientX: 180, clientY: 160 }); pointer('pointerup', window, { clientX: 180, clientY: 160 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
    expect(document.body.dataset.pointerGesture).toBeUndefined();
  });

  it.each(['fingerprint', 'membership', 'select-more', 'child', 'provider-removed'] as const)('cancels when %s changes while the primary and music revision stay fixed', change => {
    const f = fixture(); const selected = selection(f); const before = f.session.project;
    pointer('pointerdown', f.host);
    if (change === 'fingerprint') selected.fingerprint = 'document:2/selection:1';
    if (change === 'membership') selected.eventIds = ['last', 'other'];
    if (change === 'select-more') selected.selectMore = true;
    if (change === 'child') selected.activeMarkingId = 'attached-mark';
    if (change === 'provider-removed') delete f.options.selection;
    pointer('pointerup', window);
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before); expect(document.body.dataset.pointerGesture).toBeUndefined();
  });

  it('copies selection membership so an in-place mutation cannot validate a stale press', () => {
    const f = fixture(); const selected = selection(f); const ids = ['last']; selected.eventIds = ids;
    pointer('pointerdown', f.host); ids.push('other'); pointer('pointerup', window);
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
  });

  it.each(['pointermove', 'pointerup'] as const)('cancels a mutation when a modifier first appears at %s', when => {
    const f = fixture(); selection(f); pointer('pointerdown', f.host);
    pointer(when, window, { shiftKey: true, clientX: 365 });
    if (when === 'pointermove') pointer('pointerup', window, { shiftKey: true, clientX: 365 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
    expect(document.body.dataset.pointerGesture).toBeUndefined();
  });

  it.each(['transcript', 'diagnostics', 'editable', 'plain-editable', 'radio'] as const)('does not preview or start staff entry from native %s content', kind => {
    const f = fixture(); const native = document.createElement('div'); const child = document.createElement('span'); native.append(child);
    if (kind === 'transcript' || kind === 'diagnostics') native.className = kind;
    if (kind === 'editable') native.setAttribute('contenteditable', '');
    if (kind === 'plain-editable') native.contentEditable = 'plaintext-only';
    if (kind === 'radio') native.setAttribute('role', 'radio');
    f.surface.shadowRoot!.append(native);
    pointer('pointermove', child); pointer('pointerdown', child); pointer('pointerup', window);
    expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
    expect(f.feedback).not.toHaveBeenCalled();
  });

  it('retains a normal eligible single-note drag with the richer selection provider', () => {
    const f = fixture(); f.state.entryMode = false; selection(f);
    pointer('pointerdown', f.host, { clientX: 180, clientY: 190 });
    pointer('pointermove', window, { clientX: 180, clientY: 180 }); pointer('pointerup', window, { clientX: 180, clientY: 180 });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.commit.mock.calls[0][0]).toMatchObject({ type: 'set-note-pitch', eventId: 'last' });
  });
});

describe('released insertion recovery contract', () => {
  it('reports the exact captured command only after a rejected tap, without inserting or adding a measure', () => {
    const f = fixture(); const before = f.session.project; const cursor = f.session.cursor;
    f.rejected.mockImplementation((command, error) => {
      expect(f.session.project).toEqual(before);
      expect(f.session.cursor).toEqual(cursor);
      expect(f.session.selectionId).toBe('last');
      expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
      expect(command).toEqual({ type: 'insert-event', position: 'after',
        cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'last' },
        value: { ...f.entry, pitch: 'B#4' } });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('11/8');
      return true;
    });
    pointer('pointerdown', f.host);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    pointer('pointerup', window);
    pointer('pointerup', window);
    expect(f.rejected).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.completed).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before);
    expect(f.session.score.staves[0].measures).toHaveLength(1);
    expect(f.session.canUndo).toBe(false);
  });

  it('does not offer recovery for hover previews', () => {
    const f = fixture();
    pointer('pointermove', f.host, { buttons: 0 });
    expect(f.status.textContent).toContain('Cannot place B#4');
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('keeps press-time values even if the readEntry object is later mutated without a form event', () => {
    const f = fixture(); const captured = { ...f.entry, pitch: 'B#4' };
    pointer('pointerdown', f.host);
    Object.assign(f.entry, { pitch: 'Fbb3', duration: 'eighth', dots: 0, accidentalDisplay: 'always', stem: 'up', beam: 'auto' });
    pointer('pointerup', window);
    expect(f.readEntry).toHaveBeenCalledTimes(1);
    expect(f.rejected.mock.calls[0]?.[0].value).toEqual(captured);
    expect(f.entry.pitch).toBe('Fbb3');
  });

  it('reports a handle drop at its released pitch, not the initial handle position', () => {
    const f = fixture();
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointermove', window, { clientX: 355, clientY: 155 });
    expect(f.rejected).not.toHaveBeenCalled();
    pointer('pointerup', window, { clientX: 355, clientY: 145 });
    expect(f.rejected).toHaveBeenCalledTimes(1);
    expect(f.rejected.mock.calls[0][0].value.pitch).toBe('E#5');
    expect(f.rejected.mock.calls[0][0].cursor.eventId).toBe('last');
  });

  it.each(['qf', 'qs', 'tqf', 'tqs'])('retains supported %s alteration and display policy in the captured drop', alteration => {
    const f = fixture(); f.entry.pitch = `D${alteration}4`;
    tap(f);
    expect(f.rejected.mock.calls[0][0].value).toMatchObject({ pitch: `B${alteration}4`, accidentalDisplay: 'courtesy' });
  });

  it('keeps optional recovery backward compatible when no callback is supplied', () => {
    const f = fixture(); delete f.options.rejected;
    tap(f);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
    expect(f.status.textContent).toContain('Cannot place');
  });

  it('preserves ordinary rejected preview feedback when recovery declines the offer', () => {
    const f = fixture();
    tap(f);
    expect(f.rejected).toHaveBeenCalledTimes(1);
    expect(f.error).not.toHaveBeenCalled();
    expect(f.status.textContent).toContain('Cannot place B#4');
  });

  it('commits an accepted insertion once without invoking recovery', () => {
    const f = fixture(shortMeasure);
    tap(f, { clientX: 268 });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.completed).toHaveBeenCalledExactlyOnceWith('insert', 'B#4');
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.session.score.staves[0].measures[0].voices[0].events).toHaveLength(2);
    expect(f.session.revision).toBe(1);
  });

  it.each([false, true])('hands off the original real-commit error only while source is unchanged (handled: %s)', handled => {
    const f = fixture(shortMeasure);
    const failure = new Error('The atomic transaction was rejected.');
    f.commit.mockImplementation(() => { throw failure; });
    f.rejected.mockImplementation(() => {
      if (handled) f.status.textContent = 'Review the new measure before adding it.';
      return handled;
    });
    const before = f.session.project;
    tap(f, { clientX: 268 });
    expect(f.rejected).toHaveBeenCalledTimes(1);
    expect(f.rejected.mock.calls[0][1]).toBe(failure);
    expect(f.error).toHaveBeenCalledTimes(handled ? 0 : 1);
    expect(f.status.textContent).toBe(handled ? 'Review the new measure before adding it.' : `No music changed. ${failure.message}`);
    expect(f.session.project).toEqual(before);
  });

  it('does not offer a second insertion when a callback throws after a successful commit', () => {
    const f = fixture(shortMeasure);
    f.completed.mockImplementation(() => { throw new Error('Post-commit UI failed.'); });
    tap(f, { clientX: 268 });
    expect(f.session.revision).toBe(1);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(1);
    expect(f.status.textContent).not.toContain('No music changed');
  });

  it.each(['selection', 'cursor', 'revision', 'source'] as const)('does not claim an atomic rejection if commit changes %s before throwing', change => {
    const f = fixture(shortMeasure);
    f.commit.mockImplementation(() => {
      if (change === 'selection') f.session.select('bar');
      if (change === 'cursor') f.session.setCursor({ staffId: 'staff', measureId: 'bar', voiceIndex: 0 });
      if (change === 'revision') f.session.update('Changed title', draft => { draft.metadata.title = 'Changed'; });
      if (change === 'source') f.session.source.setAttribute('data-mutated', 'true');
      throw new Error('Failure after changing accepted context.');
    });
    tap(f, { clientX: 268 });
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(1);
    expect(f.status.textContent).not.toContain('No music changed');
  });

  it('cleans up the gesture when the recovery callback itself fails', () => {
    const f = fixture(); const failure = new Error('Recovery could not open.');
    f.rejected.mockImplementation(() => { throw failure; });
    tap(f);
    expect(f.rejected).toHaveBeenCalledTimes(1);
    expect(f.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
    expect(document.body.dataset.pointerGesture).toBeUndefined();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.session.canUndo).toBe(false);
  });

  it('does not pass mutable gesture or palette references to recovery', () => {
    const f = fixture(); const original = { ...f.entry };
    f.rejected.mockImplementation(command => {
      command.value.pitch = 'G9'; command.cursor.eventId = 'other'; return true;
    });
    tap(f);
    expect(f.entry).toEqual(original);
    expect(f.session.source.querySelector('#last')?.getAttribute('pitch')).toBe('C4');
    f.rejected.mockReset();
    tap(f);
    expect(f.rejected.mock.calls[0][0].value.pitch).toBe('B#4');
    expect(f.rejected.mock.calls[0][0].cursor.eventId).toBe('last');
  });
});

describe('recovery rejects unsafe or unattempted targets', () => {
  it.each(['selection', 'cursor', 'revision', 'source', 'layout', 'transform', 'part', 'position', 'voice', 'view', 'entry-mode', 'ready', 'pending', 'project'] as const)(
    'never offers recovery after captured %s changes', change => {
      const f = fixture();
      pointer('pointerdown', f.host);
      if (change === 'selection') f.session.select('bar');
      if (change === 'cursor') f.session.setCursor({ staffId: 'staff', measureId: 'bar', voiceIndex: 0 });
      if (change === 'revision') f.session.update('Title', draft => { draft.metadata.title = 'Changed'; });
      if (change === 'source') f.session.source.setAttribute('data-stale', 'changed outside a transaction');
      if (change === 'layout') f.changeLayout();
      if (change === 'transform') f.changeMatrix();
      if (change === 'part') f.state.partId = 'other';
      if (change === 'position') f.state.position = 'before';
      if (change === 'voice') f.state.voiceIndex = 1;
      if (change === 'view') f.state.mode = 'read';
      if (change === 'entry-mode') f.state.entryMode = false;
      if (change === 'ready') f.state.ready = false;
      if (change === 'pending') f.session.setPendingSource('<music-staff>unfinished');
      if (change === 'project') f.session.replaceProject(createProject(fullMeasure, 'Another document'));
      pointer('pointerup', window);
      expect(f.rejected).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    });

  it('does not prepare entry when cached geometry has no available rendered projection', () => {
    const f = fixture(shortMeasure); const layout = f.surface.getLayoutGeometry();
    f.setProjectionAvailable(false);
    tap(f, { clientX: 268 });
    expect(f.surface.getLayoutGeometry()).toBe(layout);
    expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
    expect(f.rejected).not.toHaveBeenCalled(); expect(f.overlayMount.querySelector('.pointer-ghost')).toBeNull();
  });

  it('cancels a captured gesture when its public projection becomes unavailable', () => {
    const f = fixture(shortMeasure); const before = f.session.project;
    pointer('pointerdown', f.host, { clientX: 268 });
    expect(f.overlayMount.querySelector('.pointer-ghost')).not.toBeNull();
    f.setProjectionAvailable(false);
    pointer('pointerup', window, { clientX: 268 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before); expect(f.overlayMount.querySelector('.pointer-ghost')).toBeNull();
    expect(document.body.dataset.pointerGesture).toBeUndefined();
  });

  it.each(['chord', 'slash', 'rhythm'] as const)('does not offer continuation for unsupported %s pointer entry', kind => {
    const f = fixture(); f.entry.kind = kind;
    tap(f);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not offer continuation for pending Source or an invalid entry form', () => {
    const f = fixture();
    f.session.setPendingSource('<music-staff>unfinished');
    tap(f);
    expect(f.rejected).not.toHaveBeenCalled();
    f.session.setPendingSource(null);
    f.readEntry.mockImplementation(() => { throw new Error('Choose a valid duration.'); });
    tap(f);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not offer continuation when the final engraved preview cannot be drawn', () => {
    const f = fixture();
    vi.mocked(createPitchPreview).mockImplementation(() => { throw new Error('No preview glyph is available.'); });
    tap(f);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.status.textContent).toContain('Preview unavailable');
  });

  it('does not offer continuation for a drop with no exact musical boundary', () => {
    const f = fixture();
    tap(f, { clientX: 50 });
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('never passes a rejected pitch edit into insertion recovery', () => {
    const f = fixture(); f.state.entryMode = false;
    f.commit.mockImplementation(() => { throw new Error('Pitch transaction rejected.'); });
    pointer('pointerdown', f.pitchHandle, { clientX: 80, clientY: 50 });
    pointer('pointerup', window, { clientX: 180, clientY: 175 });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.commit.mock.calls[0][0].type).toBe('set-note-pitch');
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(1);
  });
});

describe('score viewport movement and clipping', () => {
  it.each(['score-scroll', 'inner-shadow-scroll', 'document-scroll'] as const)('cancels on %s without preventing native scrolling or offering recovery', target => {
    const f = fixture(); pointer('pointerdown', f.host);
    const event = new Event('scroll', { bubbles: false, composed: false, cancelable: true });
    (target === 'score-scroll' ? f.scroller : target === 'inner-shadow-scroll' ? f.rendered : document).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
    pointer('pointerup', window);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('lets a touch swipe scroll rather than becoming an insertion attempt', () => {
    const f = fixture();
    const down = pointer('pointerdown', f.host, { pointerType: 'touch' });
    const move = pointer('pointermove', window, { pointerType: 'touch', clientY: 180 });
    const up = pointer('pointerup', window, { pointerType: 'touch', clientY: 180 });
    expect(down.defaultPrevented || move.defaultPrevented || up.defaultPrevented).toBe(false);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.status.textContent).toContain('Scroll the score');
  });

  it.each(['above', 'below', 'left', 'right'] as const)('does not target clipped score content %s the score pane', edge => {
    const f = fixture();
    if (edge === 'above') f.bounds.viewport = new DOMRect(20, 170, 700, 200);
    if (edge === 'below') f.bounds.viewport = new DOMRect(20, 100, 700, 50);
    if (edge === 'left') f.bounds.viewport = new DOMRect(370, 100, 300, 300);
    if (edge === 'right') f.bounds.viewport = new DOMRect(20, 100, 300, 300);
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointerup', window);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not target the score viewport scrollbar', () => {
    const f = fixture();
    f.bounds.viewport = new DOMRect(20, 100, 340, 300);
    Object.defineProperty(f.scroller, 'clientWidth', { configurable: true, value: 325 });
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointerup', window, { clientX: 352 });
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not target an empty clipped viewport even at its exact boundary', () => {
    const f = fixture();
    f.bounds.viewport = new DOMRect(355, 100, 0, 300);
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointerup', window);
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it.each(['right', 'bottom'] as const)('clips at the rendered %s edge of a scaled score pane', edge => {
    const f = fixture(); f.bounds.scale = 0.5;
    f.bounds.viewport = new DOMRect(20, 100, 350, edge === 'bottom' ? 75 : 150);
    f.scroller.style.transform = 'matrix(0.5, 0, 0, 0.5, 0, 0)';
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointerup', window, edge === 'right' ? { clientX: 400 } : { clientY: 180 });
    expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('still permits an exact rejected target inside a scaled score pane', () => {
    const f = fixture(); f.bounds.scale = 0.5;
    f.bounds.viewport = new DOMRect(20, 100, 350, 150);
    f.scroller.style.transform = 'matrix(0.5, 0, 0, 0.5, 0, 0)';
    tap(f);
    expect(f.rejected).toHaveBeenCalledTimes(1);
  });

  it.each(['matrix(1, 0.25, 0, 1, 0, 0)', 'matrix(0, 1, -1, 0, 0, 0)', 'matrix(-1, 0, 0, 1, 0, 0)'])(
    'does not infer a rectangular clip through unsupported ancestor transform %s', transform => {
      const f = fixture(); f.editor.style.transform = transform;
      tap(f);
      expect(f.rejected).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
    });
});

describe('relocated workspace dock exclusion', () => {
  function dock(f: ReturnType<typeof fixture>, bounds = new DOMRect(20, 160, 700, 96)): HTMLElement {
    const element = document.createElement('section'); element.id = 'workspace-dock';
    f.toolbar.append(f.status); element.append(f.toolbar); f.editor.after(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
    vi.mocked(f.toolbar.getBoundingClientRect).mockReturnValue(new DOMRect(bounds.left, bounds.bottom - 48, bounds.width, 48));
    f.options.getChromeBounds = () => element.hidden || element.style.display === 'none' ? [] : [element.getBoundingClientRect()];
    expect(f.editor.contains(element)).toBe(false); return element;
  }
  function measuredLabel(): void {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('pointer-target-label')) {
        return new DOMRect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, 120, 24);
      }
      return original.call(this);
    });
  }

  it('rejects release on the shared score/dock edge, even outside the dock’s pointer-tools row', () => {
    const f = fixture(shortMeasure); const chrome = dock(f); const before = f.session.project;
    f.bounds.viewport = new DOMRect(20, 100, 700, 60);
    expect(chrome.getBoundingClientRect().top).toBe(f.scroller.getBoundingClientRect().bottom);
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 220 });
    pointer('pointermove', window, { clientX: 268, clientY: 145 });
    expect(f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-ghost')?.dataset.valid).toBe('true');
    pointer('pointerup', window, { clientX: 268, clientY: 160 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before); expect(f.session.canUndo).toBe(false);
    expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
  });

  it('still permits one valid release in the clipped score area above the relocated dock', () => {
    const f = fixture(shortMeasure); dock(f); f.bounds.viewport = new DOMRect(20, 100, 700, 60);
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 220 });
    pointer('pointermove', window, { clientX: 268, clientY: 145 }); pointer('pointerup', window, { clientX: 268, clientY: 145 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.revision).toBe(1);
    expect(f.commit.mock.calls[0][0]).toMatchObject({ type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 } });
  });

  it.each(['hidden', 'display-none'] as const)('permits notation when the chrome provider excludes a %s dock', kind => {
    const f = fixture(shortMeasure); const chrome = dock(f);
    if (kind === 'hidden') chrome.hidden = true; else chrome.style.display = 'none';
    tap(f, { clientX: 268 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.session.revision).toBe(1);
  });

  it('retains a clear local label when the legacy toolbar is at the bottom, without using its bottom as a top limit', () => {
    const f = fixture(shortMeasure); measuredLabel();
    vi.mocked(f.toolbar.getBoundingClientRect).mockReturnValue(new DOMRect(20, 350, 700, 50));
    const before = f.session.project;
    pointer('pointermove', f.host, { clientX: 268, clientY: 160, buttons: 0 });
    const label = f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-target-label'); expect(label).not.toBeNull();
    expect(label!.getBoundingClientRect().top).toBeGreaterThanOrEqual(f.scroller.getBoundingClientRect().top);
    expect(label!.getBoundingClientRect().bottom).toBeLessThan(f.toolbar.getBoundingClientRect().top);
    expect(f.session.project).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
  });

  it('treats actual relocated chrome bounds as a label obstacle rather than an assumed top toolbar', () => {
    const f = fixture(shortMeasure);
    // Deliberately overlapping rectangles qualify obstacle safety, not native CSS layout.
    const chrome = dock(f, new DOMRect(505, 120, 210, 80)); measuredLabel(); const before = f.session.project;
    pointer('pointermove', f.host, { clientX: 268, clientY: 160, buttons: 0 });
    const label = f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-target-label'); expect(label).not.toBeNull();
    const box = label!.getBoundingClientRect(); const cover = chrome.getBoundingClientRect();
    expect(box.right <= cover.left || box.left >= cover.right || box.bottom <= cover.top || box.top >= cover.bottom,
      JSON.stringify({ label: box.toJSON(), chrome: cover.toJSON(), styles: label!.style.cssText })).toBe(true);
    expect(box.top).toBeGreaterThanOrEqual(f.scroller.getBoundingClientRect().top);
    expect(box.bottom).toBeLessThanOrEqual(f.scroller.getBoundingClientRect().bottom);
    expect(f.session.project).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
  });

  it('keeps the preview label clear of public native-control bounds', () => {
    const f = fixture(shortMeasure); measuredLabel(); const before = f.session.project;
    pointer('pointermove', f.host, { clientX: 268, clientY: 160, buttons: 0 });
    expect(f.overlayMount.querySelector('.pointer-target-label')).not.toBeNull();
    f.setNativeControlBounds([f.bounds.viewport]);
    pointer('pointermove', f.host, { clientX: 268, clientY: 150, buttons: 0 });
    expect(f.overlayMount.querySelector('.pointer-target-label')).toBeNull();
    expect(f.overlayMount.querySelector('.pointer-ghost')).not.toBeNull();
    expect(f.session.project).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
  });
});

function emptyFixture(voices = '', notation: NonNullable<Staff['notation']> = 'pitched') {
    const f = fixture(`<music-staff id="staff" label="Solo" notation="${notation}"><music-measure id="bar" incomplete>${voices}</music-measure></music-staff>`);
    f.session.select('bar');
    const source = f.session.source.cloneNode(true) as Element; f.surface.append(source);
    const parsed = readScore(source); let projected = parsed.score; const sourceMap = new Map(parsed.sources);
    Object.defineProperty(f.surface, 'score', { configurable: true, get: () => projected });
    Object.defineProperty(f.surface, 'getSource', { configurable: true, value: (id: string) => sourceMap.get(id) });
    const canonical = f.session.score.staves[0].measures[0].voices;
    const original = f.layout();
    f.setLayout({ ...original, systems: original.systems.map(system => ({ ...system, anchors: system.anchors.map(anchor => {
      const voiceIndex = canonical.findIndex(voice => voice.id === anchor.voiceId);
      const id = projected.staves[0].measures[0].voices[voiceIndex].id;
      return { ...anchor, sourceId: id, voiceId: id };
    }) })) });
    return { ...f, sourceMap, projectedSource: source, projected: () => projected, setProjected: (next: Score) => { projected = next; } };
}

describe('pointer insertion into an existing empty voice', () => {
  it.each([
    { explicit: false, position: 'before' }, { explicit: false, position: 'after' },
    { explicit: true, position: 'before' }, { explicit: true, position: 'after' },
  ] as const)('previews and commits one note with no invented rest (explicit=$explicit, position=$position)', ({ explicit, position }) => {
    const f = emptyFixture(explicit ? '<music-voice id="empty"></music-voice>' : ''); f.state.position = position;
    const before = f.session.project.sourceHtml;
    const canonicalVoice = f.session.score.staves[0].measures[0].voices[0]; const projectedVoice = f.projected().staves[0].measures[0].voices[0];
    if (!explicit) expect(projectedVoice.id).not.toBe(canonicalVoice.id);
    pointer('pointermove', f.host, { clientX: 180, clientY: 160, buttons: 0 });
    expect(f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-ghost')?.dataset.valid).toBe('true');
    expect(f.status.textContent).toBe('B#4, quarter · 1 dot · Start empty voice · Solo, bar 1, voice 1 · 0 whole-note onset · voice.');
    expect(f.session.project.sourceHtml).toBe(before);
    tap(f, { clientX: 180, clientY: 160 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.rejected).not.toHaveBeenCalled();
    expect(f.commit.mock.calls[0][0]).toMatchObject({ type: 'insert-event', position, cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: { kind: 'note', pitch: 'B#4' } });
    expect('eventId' in (f.commit.mock.calls[0][0] as Extract<Parameters<Options['commit']>[0], { type: 'insert-event' }>).cursor).toBe(false);
    expect(f.session.score.staves[0].measures[0].voices[0].events).toMatchObject([{ kind: 'note', onset: rational(0) }]);
    expect(f.session.source.querySelector('music-rest')).toBeNull(); expect(f.session.revision).toBe(1);
    f.session.undo(); expect(f.session.project.sourceHtml).toBe(before); expect(f.session.score.staves[0].measures[0].voices[0].events).toEqual([]);
  });

  it('allows the deliberate note handle to drop at the empty implicit voice’s actual start anchor', () => {
    const f = emptyFixture();
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointermove', window, { clientX: 180, clientY: 160 }); pointer('pointerup', window, { clientX: 180, clientY: 160 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.session.score.staves[0].measures[0].voices[0].events[0].onset).toEqual(rational(0));
  });

  it.each([0, 1])('inserts in empty active voice %i without changing its populated neighbor', voiceIndex => {
    const voices = [0, 1].map(index => `<music-voice id="voice-${index}">${index === voiceIndex ? '' : '<music-note id="last" pitch="C4" duration="whole"></music-note>'}</music-voice>`).join('');
    const f = emptyFixture(voices); f.state.voiceIndex = voiceIndex;
    const other = f.session.score.staves[0].measures[0].voices[1 - voiceIndex];
    tap(f, { clientX: 180, clientY: 160 });
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.session.score.staves[0].measures[0].voices[voiceIndex].events).toHaveLength(1);
    expect(f.session.score.staves[0].measures[0].voices[1 - voiceIndex]).toEqual(other);
  });

  it('starts only voice two when both voices have the same empty onset and coordinates', () => {
    const f = emptyFixture('<music-voice id="one"></music-voice><music-voice id="two"></music-voice>'); f.state.voiceIndex = 1;
    tap(f, { clientX: 180, clientY: 160 });
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.session.score.staves[0].measures[0].voices.map(voice => voice.events.length)).toEqual([0, 1]);
  });

  it('explains empty Replace without changing the insertion mode, source, or history', () => {
    const f = emptyFixture(); f.state.position = 'replace'; const before = f.session.project;
    tap(f, { clientX: 180, clientY: 160 });
    expect(f.status.textContent).toContain('Empty voice: choose Before or After to start writing');
    expect(f.state.position).toBe('replace'); expect(f.session.project).toEqual(before);
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.canUndo).toBe(false);
  });

  it.each(['missing-source', 'wrong-owner', 'hidden-staff', 'wrong-measure', 'populated-projection', 'tuplet-projection', 'explicit-projection'] as const)(
    'rejects an unproved implicit bridge: %s', kind => {
      const f = emptyFixture(); const projected = f.projected(); const staff = projected.staves[0]; const measure = staff.measures[0]; const voice = measure.voices[0];
      if (kind === 'missing-source') f.sourceMap.delete(voice.id);
      if (kind === 'wrong-owner') f.sourceMap.set(voice.id, f.projectedSource);
      if (kind === 'hidden-staff') f.setProjected({ ...projected, staves: [{ ...staff, id: 'other-staff' }] });
      if (kind === 'wrong-measure') f.setProjected({ ...projected, staves: [{ ...staff, measures: [{ ...measure, id: 'other-measure' }] }] });
      if (kind === 'populated-projection') {
        const event = new EditorSession(createProject(shortMeasure, 'Other source')).score.staves[0].measures[0].voices[0].events[0];
        f.setProjected({ ...projected, staves: [{ ...staff, measures: [{ ...measure, voices: [{ ...voice, events: [event] }] }] }] });
      }
      if (kind === 'tuplet-projection') f.setProjected({ ...projected, staves: [{ ...staff, measures: [{ ...measure,
        voices: [{ ...voice, tuplets: [{ id: 'empty-tuplet', actual: 3, normal: 2, eventIds: [], bracket: 'auto', showRatio: false }] }] }] }] });
      if (kind === 'explicit-projection') f.sourceMap.get(measure.id)!.append(document.createElement('music-voice'));
      const before = f.session.project; tap(f, { clientX: 180, clientY: 160 });
      expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.project).toEqual(before);
    });

  it('does not mistake a sole explicit voice for an implicit measure-backed alias', () => {
    const f = emptyFixture('<music-voice id="explicit-empty"></music-voice>');
    const projected = f.projected(); const staff = projected.staves[0]; const measure = staff.measures[0]; const voice = measure.voices[0];
    f.setProjected({ ...projected, staves: [{ ...staff, measures: [{ ...measure, voices: [{ ...voice, id: 'unexpected-alias' }] }] }] });
    f.sourceMap.set('unexpected-alias', f.sourceMap.get(measure.id)!);
    f.setLayout({ ...f.layout(), systems: f.layout().systems.map(system => ({ ...system,
      anchors: system.anchors.map(anchor => ({ ...anchor, sourceId: 'unexpected-alias', voiceId: 'unexpected-alias' })) })) });
    const before = f.session.project; tap(f, { clientX: 180, clientY: 160 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.project).toEqual(before);
  });

  it.each(['read', 'pages', 'pending-source', 'stale-layout', 'chord-recipe'] as const)('retains the %s guard for an empty voice', kind => {
    const f = emptyFixture(); const before = f.session.project.sourceHtml;
    if (kind === 'read' || kind === 'pages') f.state.mode = kind;
    if (kind === 'chord-recipe') f.entry.kind = 'chord';
    pointer('pointerdown', f.host, { clientX: 180, clientY: 160 });
    if (kind === 'pending-source') f.session.setPendingSource(`${before}\n<!-- pending -->`);
    if (kind === 'stale-layout') f.changeLayout();
    pointer('pointerup', window, { clientX: 180, clientY: 160 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.session.project.sourceHtml).toBe(before);
    expect(f.session.canUndo).toBe(false);
  });
});

describe('ordinary rest pointer entry', () => {
  function restFixture(notation: NonNullable<Staff['notation']>) {
    const sounding = notation === 'rhythm' ? '<music-rhythm id="last" duration="half"></music-rhythm>'
      : notation === 'three-roads' ? '<music-road id="last" direction="higher" duration="half"></music-road>'
        : '<music-note id="last" pitch="C4" duration="half"></music-note>';
    const f = fixture(`<music-staff id="staff" label="Rest study" notation="${notation}"><music-measure id="bar" incomplete>${sounding}</music-measure></music-staff>`);
    f.entry.kind = 'rest'; f.entry.dots = 0; f.entry.pitch = 'Fqs5';
    return f;
  }

  const kinds = ['pitched', 'rhythm', 'three-roads'] as const;
  it.each(kinds)('leads empty %s voice feedback with the dotted rest and retains its exact location', notation => {
    const f = emptyFixture('<music-voice id="one"></music-voice><music-voice id="two"></music-voice>', notation);
    f.state.voiceIndex = 1; f.entry.kind = 'rest'; f.entry.pitch = 'unfinished pitch text';
    const before = f.session.project;
    pointer('pointermove', f.host, { clientX: 180, clientY: 145, buttons: 0 });
    expect(f.status.textContent).toBe('quarter rest · 1 dot · Start empty voice · Solo, bar 1, voice 2 · 0 whole-note onset · voice.');
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'gesture' });
    expect(createPitchPreview).not.toHaveBeenCalled();
    expect(f.entry.pitch).toBe('unfinished pitch text'); expect(f.commit).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before);
  });

  it.each(kinds.flatMap(notation => ['Fqs5', 'unfinished pitch text'].map(pitch => ({ notation, pitch })) ))(
    'clicks a written rest on $notation without reading dormant pitch "$pitch"', ({ notation, pitch }) => {
      const f = restFixture(notation); f.entry.pitch = pitch; const before = f.session.project.sourceHtml;
      const value = { ...f.entry }; const preceding = f.session.score.staves[0].measures[0].voices[0].events[0];
      pointer('pointermove', f.host, { clientX: 268, clientY: 145, buttons: 0 });
      expect(f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-ghost')?.dataset.entryKind).toBe('rest');
      expect(f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-ghost')?.dataset.valid).toBe('true');
      expect(createPitchPreview).not.toHaveBeenCalled(); expect(createRestPreview).toHaveBeenCalled();
      expect(f.session.project.sourceHtml).toBe(before); expect(f.commit).not.toHaveBeenCalled();
      tap(f, { clientX: 268, clientY: 145 });
      expect(f.commit).toHaveBeenCalledOnce(); expect(f.completed).toHaveBeenCalledExactlyOnceWith('insert', undefined);
      expect(f.error).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled();
      const events = f.session.score.staves[0].measures[0].voices[0].events;
      expect(events[0]).toEqual(preceding);
      expect(events[1]).toMatchObject({ kind: 'rest', pitches: [], duration: 'quarter', dots: 0, onset: rational(1, 2), time: rational(1, 4), measureRest: false });
      expect(f.session.source.querySelector('music-rest')?.hasAttribute('pitch')).toBe(false);
      expect(f.entry).toEqual(value); expect(f.status.textContent).toContain('quarter rest'); expect(f.session.revision).toBe(1);
      f.session.undo(); expect(f.session.project.sourceHtml).toBe(before);
    });

  it.each(kinds)('drops the configured rest from its deliberate handle on %s', notation => {
    const f = restFixture(notation); const before = f.session.project.sourceHtml;
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    pointer('pointermove', window, { clientX: 268, clientY: 145 });
    expect(f.session.project.sourceHtml).toBe(before); expect(f.commit).not.toHaveBeenCalled();
    pointer('pointerup', window, { clientX: 268, clientY: 145 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.session.score.staves[0].measures[0].voices[0].events.at(-1)?.kind).toBe('rest');
    expect(f.entry.pitch).toBe('Fqs5'); expect(f.completed).toHaveBeenCalledExactlyOnceWith('insert', undefined);
  });

  it.each(kinds)('keeps %s rest height fixed while the pointer moves within its staff lane', notation => {
    const f = restFixture(notation);
    pointer('pointermove', f.host, { clientX: 268, clientY: 125, buttons: 0 });
    const first = f.host.shadowRoot!.querySelector('.pointer-geometry g svg');
    expect(first).not.toBeNull(); const coordinates = [first!.getAttribute('x'), first!.getAttribute('y')];
    pointer('pointermove', f.host, { clientX: 268, clientY: 155, buttons: 0 });
    const second = f.host.shadowRoot!.querySelector('.pointer-geometry g svg');
    expect([second?.getAttribute('x'), second?.getAttribute('y')]).toEqual(coordinates);
    expect(createRestPreview).toHaveBeenCalledExactlyOnceWith({ duration: 'quarter', dots: 0, clef: 'treble', notation });
    expect(createPitchPreview).not.toHaveBeenCalled(); expect(f.session.revision).toBe(0);
  });

  it.each(kinds.flatMap(notation => [false, true].map(explicit => ({ notation, explicit }))))(
    'starts an empty $notation voice with a rest (explicit=$explicit)', ({ notation, explicit }) => {
      const f = emptyFixture(explicit ? '<music-voice id="empty"></music-voice>' : '', notation);
      f.entry.kind = 'rest'; f.entry.dots = 0; f.entry.pitch = 'unfinished pitch text';
      tap(f, { clientX: 180, clientY: 145 });
      expect(f.commit).toHaveBeenCalledOnce(); expect(f.completed).toHaveBeenCalledExactlyOnceWith('insert', undefined);
      const events = f.session.score.staves[0].measures[0].voices[0].events;
      expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: 'rest', duration: 'quarter', onset: rational(0), time: rational(1, 4), measureRest: false });
      expect(f.entry.pitch).toBe('unfinished pitch text'); expect(f.session.source.querySelector('music-note')).toBeNull();
    });

  it.each(kinds)('refuses full-measure rest gestures on %s with an honest Insert path', notation => {
    const f = emptyFixture('', notation); f.entry.kind = 'rest'; f.entry.measureRest = true; f.entry.dots = 0;
    const before = f.session.project; tap(f, { clientX: 180, clientY: 145 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
    expect(createRestPreview).not.toHaveBeenCalled(); expect(f.session.project).toEqual(before);
    expect(f.status.textContent).toContain('Use Insert'); expect(f.status.textContent).toContain('full-measure rest');
    expect(f.entry.measureRest).toBe(true);
  });

  it('preserves the written whole value without silently creating a full-measure rest', () => {
    const f = emptyFixture(); f.entry.kind = 'rest'; f.entry.duration = 'whole'; f.entry.dots = 0;
    tap(f, { clientX: 180, clientY: 145 });
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.session.score.staves[0].measures[0].voices[0].events[0]).toMatchObject({ kind: 'rest', duration: 'whole', measureRest: false, time: rational(1) });
    expect(f.session.source.querySelector('music-rest')?.hasAttribute('measure')).toBe(false);
  });

  it('keeps an overflowing written rest uncommitted instead of splitting, padding, or changing its value', () => {
    const f = restFixture('pitched'); f.entry.duration = 'whole'; const before = f.session.project;
    pointer('pointerdown', f.host, { clientX: 268 });
    expect(f.host.shadowRoot!.querySelector<HTMLElement>('.pointer-ghost')?.dataset.valid).toBe('false');
    expect(f.status.textContent).toContain('Cannot place whole rest');
    pointer('pointerup', window, { clientX: 268 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled(); expect(f.rejected).toHaveBeenCalledOnce();
    expect(f.session.project).toEqual(before); expect(f.session.canUndo).toBe(false); expect(f.entry.duration).toBe('whole');
  });

  it('inserts a rest inside the exact existing tuplet without inventing a beat grid', () => {
    const f = fixture('<music-staff id="staff"><music-measure id="bar" incomplete><music-tuplet id="triplet" actual="3" normal="2">'
      + '<music-note id="first" pitch="C4" duration="eighth"></music-note><music-note id="last" pitch="D4" duration="eighth"></music-note>'
      + '</music-tuplet></music-measure></music-staff>');
    f.entry.kind = 'rest'; f.entry.duration = 'eighth'; f.entry.dots = 0; f.entry.pitch = 'not a pitch';
    const before = f.session.project.sourceHtml;
    pointer('pointerdown', f.host, { clientX: 195, clientY: 145 });
    expect(f.status.textContent).toBe('eighth rest · Add after C4 · Staff, bar 1, voice 1 · 1/12 whole-note onset · tuplet 3:2.');
    expect(f.session.project.sourceHtml).toBe(before); expect(f.commit).not.toHaveBeenCalled();
    pointer('pointerup', window, { clientX: 195, clientY: 145 });
    expect(f.commit).toHaveBeenCalledOnce();
    const events = f.session.score.staves[0].measures[0].voices[0].events;
    expect(events.map(event => event.kind)).toEqual(['note', 'rest', 'note']);
    expect(events[1]).toMatchObject({ onset: rational(1, 12), duration: 'eighth', dots: 0, time: rational(1, 12), tupletIds: ['triplet'] });
    expect(f.session.source.querySelector('music-rest')?.parentElement?.id).toBe('triplet');
    f.session.undo(); expect(f.session.project.sourceHtml).toBe(before);
  });

  it('targets the active empty voice even if another voice already occupies the same time and staff', () => {
    const f = emptyFixture('<music-voice id="one"><music-note id="last" pitch="C4" duration="whole"></music-note></music-voice><music-voice id="two"></music-voice>');
    f.state.voiceIndex = 1; f.entry.kind = 'rest'; f.entry.dots = 0;
    const other = f.session.score.staves[0].measures[0].voices[0]; tap(f, { clientX: 180, clientY: 145 });
    expect(f.commit).toHaveBeenCalledOnce(); expect(f.session.score.staves[0].measures[0].voices[0]).toEqual(other);
    expect(f.session.score.staves[0].measures[0].voices[1].events[0]).toMatchObject({ kind: 'rest', onset: rational(0) });
  });

  it('preserves native touch panning while admitting a stationary rest tap', () => {
    const f = restFixture('rhythm'); const before = f.session.project;
    const down = pointer('pointerdown', f.host, { clientX: 268, clientY: 140, pointerType: 'touch' });
    const move = pointer('pointermove', window, { clientX: 268, clientY: 155, pointerType: 'touch' });
    const up = pointer('pointerup', window, { clientX: 268, clientY: 155, pointerType: 'touch' });
    expect([down.defaultPrevented, move.defaultPrevented, up.defaultPrevented]).toEqual([false, false, false]);
    expect(f.session.project).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
    tap(f, { clientX: 268, clientY: 140, pointerType: 'touch' }); expect(f.commit).toHaveBeenCalledOnce();
  });

  it('rejects a rest release if its engraved preview cannot be produced', () => {
    const f = restFixture('rhythm'); const before = f.session.project;
    vi.mocked(createRestPreview).mockImplementation(() => { throw new Error('Rest glyph unavailable.'); });
    tap(f, { clientX: 268, clientY: 145 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
    expect(f.session.project).toEqual(before); expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
    expect(f.status.textContent).toContain('Rest glyph unavailable');
  });

  it.each(['escape', 'scroll', 'stale-layout', 'voice', 'part', 'source-draft', 'read', 'pages'] as const)(
    'cancels an ordinary rest gesture on %s without adding musical history', reason => {
      const f = restFixture('three-roads'); const before = f.session.project.sourceHtml;
      pointer('pointerdown', f.host, { clientX: 268, clientY: 145 });
      if (reason === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      if (reason === 'scroll') f.scroller.dispatchEvent(new Event('scroll'));
      if (reason === 'stale-layout') f.changeLayout();
      if (reason === 'voice') f.state.voiceIndex = 1;
      if (reason === 'part') f.state.partId = 'another-part';
      if (reason === 'source-draft') f.session.setPendingSource(`${before}\n<!-- draft -->`);
      if (reason === 'read' || reason === 'pages') f.state.mode = reason;
      pointer('pointerup', window, { clientX: 268, clientY: 145 });
      expect(f.commit).not.toHaveBeenCalled(); expect(f.rejected).not.toHaveBeenCalled(); expect(f.completed).not.toHaveBeenCalled();
      expect(f.session.project.sourceHtml).toBe(before); expect(f.session.canUndo).toBe(false); expect(f.entry.pitch).toBe('Fqs5');
    });
});

describe('optional score-surface gesture admission', () => {
  it('does not park writing or read a recipe on a blocked selection-modifier press', () => {
    const f = fixture(shortMeasure); f.options.canStartGesture = () => false;
    const park = vi.fn(); f.options.beforeSelectionGesture = park;
    tap(f, { clientX: 268, shiftKey: true });
    expect(park).not.toHaveBeenCalled(); expect(f.readEntry).not.toHaveBeenCalled(); expect(f.commit).not.toHaveBeenCalled();
    expect(f.state.entryMode).toBe(true); expect(f.session.revision).toBe(0);
  });

  it('clears a hover preview when a task surface blocks entry without changing writing intent', () => {
    const f = fixture(shortMeasure); let allowed = true; f.options.canStartGesture = () => allowed;
    pointer('pointermove', f.host, { clientX: 268, buttons: 0 }); expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).not.toBeNull();
    allowed = false; pointer('pointermove', f.host, { clientX: 269, buttons: 0 });
    expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
    expect(f.state.entryMode).toBe(true); expect(f.session.revision).toBe(0);
  });

  it('never starts on a blocked press and cannot turn its later unblocked release into an insertion', () => {
    const f = fixture(shortMeasure); let allowed = false; f.options.canStartGesture = () => allowed;
    pointer('pointerdown', f.host, { clientX: 268 }); allowed = true; pointer('pointerup', window, { clientX: 268 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.state.entryMode).toBe(true);
    tap(f, { clientX: 268 }); expect(f.commit).toHaveBeenCalledOnce();
  });

  it('cancels a captured gesture if admission closes before release and permits the next deliberate gesture', () => {
    const f = fixture(shortMeasure); let allowed = true; f.options.canStartGesture = () => allowed;
    pointer('pointerdown', f.host, { clientX: 268 }); allowed = false; pointer('pointerup', window, { clientX: 268 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.host.shadowRoot!.querySelector('.pointer-ghost')).toBeNull();
    allowed = true; tap(f, { clientX: 268 }); expect(f.commit).toHaveBeenCalledOnce();
  });

  it('cannot revive a gesture when the root cancels for a blocker that opens and closes between pointer samples', () => {
    const f = fixture(shortMeasure); let allowed = true; f.options.canStartGesture = () => allowed;
    const before = f.session.project;
    pointer('pointerdown', f.host, { clientX: 268 });
    allowed = false; f.interaction.cancel('score-surface-blocked'); allowed = true;
    pointer('pointerup', window, { clientX: 268 });
    expect(f.commit).not.toHaveBeenCalled(); expect(f.session.project).toEqual(before); expect(f.state.entryMode).toBe(true);
    tap(f, { clientX: 268 }); expect(f.commit).toHaveBeenCalledOnce();
  });

  it('uses inherited insertion, paper, ink and error tokens in the isolated preview layer', () => {
    const f = fixture(shortMeasure); const css = f.host.shadowRoot!.querySelector('style')!.textContent!;
    for (const token of ['--author-insertion', '--author-insertion-fill', '--author-paper', '--author-ink', '--author-error']) expect(css).toContain(`var(${token},`);
  });

  it.each(['note', 'rest'] as const)('recolors only the disposable %s clone without filling unpainted paths or mutating cached geometry', kind => {
    const f = fixture(shortMeasure); f.entry.kind = kind; f.entry.dots = 0;
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = '<text fill="#111" x="2" y="20">mock engraved glyph</text><path fill="none" stroke="#111" d="M 4 2 L 4 20"></path>';
    Object.defineProperty(svg, 'viewBox', { configurable: true, value: { baseVal: { x: 0, y: 0, width: 20, height: 40 } } });
    if (kind === 'note') vi.mocked(createPitchPreview).mockReturnValue({ svg, headX: 10, headY: 30 });
    else vi.mocked(createRestPreview).mockReturnValue({ svg, anchorX: 10, anchorY: 30 });
    pointer('pointermove', f.host, { clientX: 268, clientY: 145, buttons: 0 });
    const clone = f.host.shadowRoot!.querySelector('.pointer-preview-symbol')!;
    expect(clone.querySelector('text')?.getAttribute('fill')).toBe('currentColor');
    expect(clone.querySelector('path')?.getAttribute('stroke')).toBe('currentColor');
    expect(clone.querySelector('path')?.getAttribute('fill')).toBe('none');
    expect(clone.querySelector('path')?.getAttribute('d')).toBe('M 4 2 L 4 20');
    expect(svg.querySelector('text')?.getAttribute('fill')).toBe('#111');
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('#111'); expect(svg.parentNode).toBeNull();
  });
});

describe('typed pointer feedback for bounded score controls', () => {
  it.each((['note', 'rest'] as const).flatMap(kind => [0, 1, 2, 3].map(dots => ({ kind, dots })) ))(
    'puts the proposed $kind and $dots dots before the insertion action without dropping context', ({ kind, dots }) => {
      const f = fixture(shortMeasure); f.entry.kind = kind; f.entry.dots = dots;
      if (kind === 'rest') f.entry.pitch = 'unfinished pitch text';
      const before = f.session.project;
      pointer('pointermove', f.host, { clientX: 268, clientY: 160, buttons: 0 });
      const value = kind === 'rest' ? 'quarter rest' : 'B#4, quarter';
      const dotted = dots ? ` · ${dots} dot${dots === 1 ? '' : 's'}` : '';
      expect(f.status.textContent).toBe(`${value}${dotted} · Add after C4 · Solo, bar 1, voice 1 · 1/2 whole-note onset · voice.`);
      expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'gesture' });
      if (kind === 'rest') expect(createPitchPreview).not.toHaveBeenCalled();
      expect(f.session.project).toEqual(before); expect(f.commit).not.toHaveBeenCalled();
    });

  it('keeps the optional callback backward compatible', () => {
    const f = fixture(shortMeasure); delete f.options.feedback;
    tap(f, { clientX: 268 });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.session.revision).toBe(1);
    expect(f.status.textContent).toContain('Placed B#4');
  });

  it('reports a valid preview as gesture feedback while retaining its original live text', () => {
    const f = fixture(shortMeasure); const before = f.session.project;
    pointer('pointerdown', f.host, { clientX: 268 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'gesture' });
    expect(f.status.textContent).toContain('B#4');
    expect(f.session.project).toEqual(before);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('promotes an unhandled invalid released preview from gesture to notice even when its text is identical', () => {
    const f = fixture(); const before = f.session.project;
    pointer('pointerdown', f.host);
    const message = f.status.textContent!;
    expect(f.feedback).toHaveBeenLastCalledWith({ message, kind: 'gesture' });
    pointer('pointerup', window);
    expect(f.feedback).toHaveBeenLastCalledWith({ message, kind: 'notice' });
    expect(f.status.textContent).toBe(message);
    expect(f.session.project).toEqual(before);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  });

  it('leaves a handled recovery to its own native explanation without a residual gesture or Review notice', () => {
    const f = fixture();
    f.rejected.mockImplementation(() => { f.status.textContent = 'Review the captured note in the new measure.'; return true; });
    tap(f);
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('info');
    expect(f.feedback.mock.calls.some(([item]) => item.kind === 'notice')).toBe(false);
    expect(f.status.textContent).toBe('Review the captured note in the new measure.');
    expect(f.session.canUndo).toBe(false);
  });

  it('classifies an accepted insertion as selection feedback, not an error notice', () => {
    const f = fixture(shortMeasure);
    tap(f, { clientX: 268 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'selection' });
    expect(f.status.textContent).toContain('Placed B#4');
    expect(f.feedback.mock.calls.some(([item]) => item.kind === 'notice')).toBe(false);
    expect(f.session.revision).toBe(1);
  });

  it('classifies an unchanged pitch drop as selection feedback without adding musical history', () => {
    const f = fixture(); f.state.entryMode = false;
    pointer('pointerdown', f.pitchHandle, { clientX: 80, clientY: 50 });
    pointer('pointerup', window, { clientX: 180, clientY: 190 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'selection' });
    expect(f.status.textContent).toContain('C4 is unchanged');
    expect(f.feedback.mock.calls.some(([item]) => item.kind === 'notice')).toBe(false);
    expect(f.session.revision).toBe(0);
  });

  it('makes a real pitch gesture blocked by pending Source available as notice feedback', () => {
    const f = fixture(); f.state.entryMode = false;
    f.session.setPendingSource('<music-staff>unfinished'); const before = f.session.project;
    pointer('pointerdown', f.pitchHandle, { clientX: 80, clientY: 50 });
    pointer('pointermove', window, { clientX: 180, clientY: 175 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toMatch(/Apply or Revert the source draft/);
    pointer('pointerup', window, { clientX: 180, clientY: 175 });
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('notice');
    expect(f.session.project).toEqual(before);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('keeps the existing 3 roads guard visible as a notice without inventing pitch positions', () => {
    const f = fixture(); f.entry.kind = 'road';
    tap(f);
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('Higher, Same, or Lower');
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('classifies a wrong-voice grab as a notice', () => {
    const f = fixture(fullMeasure.replace('<music-note', '<music-voice id="one"><music-note')
      .replace('</music-measure>', '</music-voice><music-voice id="two"><music-rest id="other" measure></music-rest></music-voice></music-measure>'));
    f.state.entryMode = false; f.state.voiceIndex = 1;
    pointer('pointerdown', f.host, { clientX: 180, clientY: 190 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('Select this note’s voice');
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('promotes a released gesture without a musical target to notice feedback', () => {
    const f = fixture();
    pointer('pointerdown', f.entryHandle, { clientX: 50, clientY: 50 });
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('gesture');
    pointer('pointerup', window, { clientX: 50, clientY: 160 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('Point inside a staff');
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('classifies unavailable preview drawing as a notice', () => {
    const f = fixture();
    vi.mocked(createPitchPreview).mockImplementation(() => { throw new Error('Preview unavailable.'); });
    tap(f);
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('Preview unavailable');
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('classifies a stale gesture as a notice and never offers continuation', () => {
    const f = fixture(); pointer('pointerdown', f.host);
    f.session.setCursor({ staffId: 'staff', measureId: 'bar', voiceIndex: 0 });
    pointer('pointerup', window);
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.rejected).not.toHaveBeenCalled();
  });

  it('classifies a failed transaction as a notice', () => {
    const f = fixture(shortMeasure);
    f.commit.mockImplementation(() => { throw new Error('The musical edit was rejected.'); });
    tap(f, { clientX: 268 });
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('No music changed');
    expect(f.session.canUndo).toBe(false);
  });

  it('classifies a recovery callback error as a notice', () => {
    const f = fixture(); f.rejected.mockImplementation(() => { throw new Error('Recovery could not open.'); });
    tap(f);
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'notice' });
    expect(f.status.textContent).toContain('Recovery could not open');
    expect(f.session.canUndo).toBe(false);
  });

  it.each(['native-pan', 'escape', 'scroll'] as const)('keeps routine %s cancellation as info rather than Review', cause => {
    const f = fixture(); const pointerType = cause === 'native-pan' ? 'touch' : 'mouse';
    pointer('pointerdown', f.host, { pointerType });
    if (cause === 'native-pan') pointer('pointermove', window, { pointerType, clientY: 180 });
    if (cause === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (cause === 'scroll') f.scroller.dispatchEvent(new Event('scroll'));
    expect(f.feedback).toHaveBeenLastCalledWith({ message: f.status.textContent, kind: 'info' });
    expect(f.feedback.mock.calls.some(([item]) => item.kind === 'notice')).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('ends transient hover feedback when the pointer leaves without reporting a released error', () => {
    const f = fixture(); pointer('pointermove', f.host, { buttons: 0 });
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('gesture');
    pointer('pointerleave', f.host, { buttons: 0 });
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('info');
    expect(f.feedback.mock.calls.some(([item]) => item.kind === 'notice')).toBe(false);
  });

  it('deduplicates a repeated message only while its feedback kind also stays the same', () => {
    const f = fixture();
    pointer('pointermove', f.host, { buttons: 0 });
    const message = f.status.textContent;
    pointer('pointermove', f.host, { buttons: 0 });
    expect(f.feedback).toHaveBeenCalledTimes(1);
    pointer('pointerleave', f.host, { buttons: 0 });
    pointer('pointermove', f.host, { buttons: 0 });
    expect(f.feedback.mock.calls.map(([item]) => item)).toEqual([
      { message, kind: 'gesture' }, { message, kind: 'info' }, { message, kind: 'gesture' },
    ]);
  });

  it('does not turn a routine Select-mode tap into a Review notice', () => {
    const f = fixture(); f.state.entryMode = false;
    tap(f, { clientX: 180, clientY: 190 });
    expect(f.feedback).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  });

  it('does not let a consumer feedback failure cancel a valid musical command', () => {
    const f = fixture(shortMeasure);
    f.feedback.mockImplementation(() => { throw new Error('Feedback presentation failed.'); });
    tap(f, { clientX: 268 });
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.session.revision).toBe(1);
    expect(f.status.textContent).toContain('Placed B#4');
    expect(f.error).toHaveBeenCalled();
  });

  it('repeats a blocked Source notice on a new attempt after its previous Review was dismissed', () => {
    const f = fixture(); f.state.entryMode = false;
    f.session.setPendingSource('<music-staff>unfinished');
    const attempt = () => {
      pointer('pointerdown', f.pitchHandle, { clientX: 80, clientY: 50 });
      pointer('pointerup', window, { clientX: 180, clientY: 175 });
    };
    attempt();
    const message = f.status.textContent;
    expect(f.feedback.mock.calls.filter(([item]) => item.kind === 'notice')).toHaveLength(1);
    f.status.textContent = '';
    attempt();
    expect(f.feedback.mock.calls.filter(([item]) => item.kind === 'notice')).toHaveLength(2);
    expect(f.feedback).toHaveBeenLastCalledWith({ message, kind: 'notice' });
    expect(f.status.textContent).toBe(message);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('repeats a readiness notice on a new press even when no gesture could begin', () => {
    const f = fixture(); f.state.ready = false;
    pointer('pointerdown', f.host);
    expect(f.feedback).toHaveBeenCalledTimes(1);
    f.status.textContent = '';
    pointer('pointerdown', f.host);
    expect(f.feedback).toHaveBeenCalledTimes(2);
    expect(f.feedback).toHaveBeenLastCalledWith({ message: 'Wait for the score to finish engraving.', kind: 'notice' });
    expect(f.status.textContent).toBe('Wait for the score to finish engraving.');
  });

  it('uses a nonempty notice when an interaction callback throws an empty error', () => {
    const f = fixture(); f.rejected.mockImplementation(() => { throw new Error(''); });
    tap(f);
    expect(f.feedback.mock.lastCall?.[0].kind).toBe('notice');
    expect(f.feedback.mock.lastCall?.[0].message.trim().length).toBeGreaterThan(0);
    expect(f.status.textContent?.trim().length).toBeGreaterThan(0);
  });
});
