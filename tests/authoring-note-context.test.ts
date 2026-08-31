// @vitest-environment happy-dom
import { mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { NoteEditor } from '../src/authoring/note-editor.js';
import type { NoteEditorState } from '../src/authoring/note-editor.js';
import { createProject } from '../src/authoring/project.js';
import type { AuthorCommand, ViewMode } from '../src/authoring/types.js';
import { add, meterTime, rational, subtract } from '../src/model/index.js';
import type { MusicEvent, Score, StaffNotation } from '../src/model/types.js';

// Real author controls and real accepted-source transactions; no main, SVG, or remote assets.
const cleanups: (() => void)[] = [];
const targets = {
  note: { notation: 'pitched', tag: 'music-note', attributes: 'pitch="Fqs4"' },
  chord: { notation: 'pitched', tag: 'music-chord', attributes: 'pitches="C4 E4 G4"' },
  rhythm: { notation: 'rhythm', tag: 'music-rhythm', attributes: '' },
  road: { notation: 'three-roads', tag: 'music-road', attributes: 'direction="higher"' },
  rhythmicSlash: { notation: 'pitched', tag: 'music-slash', attributes: 'rhythmic' },
  openSlash: { notation: 'pitched', tag: 'music-slash', attributes: '' },
  rest: { notation: 'pitched', tag: 'music-rest', attributes: '' },
  measureRest: { notation: 'pitched', tag: 'music-rest', attributes: 'measure' },
} as const;
type TargetKind = keyof typeof targets;

const accent = '<music-articulation id="accent" type="accent" placement="above" data-author="keep"></music-articulation>';
const ornament = '<music-ornament id="ornament" type="upper-mordent" placement="below"></music-ornament>';
const interval = '<music-interval id="interval" value="b3" placement="below"></music-interval>';

function staff(events: string, notation: StaffNotation = 'pitched', attributes = 'incomplete=""'): string {
  return `<music-staff id="staff" notation="${notation}" label="Soloist"><music-measure id="bar" number="12" ${attributes}>${events}</music-measure></music-staff>`;
}

function sourceFor(kind: TargetKind = 'note', children = ''): string {
  const target = targets[kind];
  const neighbor = kind === 'measureRest' ? '' : '<music-rest id="n2" duration="quarter"></music-rest>';
  const duration = kind === 'measureRest' ? 'whole' : 'quarter';
  return staff(`<${target.tag} id="n1" ${target.attributes} duration="${duration}" data-author="event">${children}</${target.tag}>${neighbor}`, target.notation);
}

function twoMarkedNotes(): string {
  return staff(`<music-note id="n1" pitch="F4" duration="quarter">${accent}${ornament}</music-note><music-note id="n2" pitch="G4" duration="quarter"><music-articulation id="second-mark" type="tenuto"></music-articulation></music-note>`);
}

function roadTuplet(): string {
  return staff(`<music-tuplet id="triplet" actual="3" normal="2"><music-road id="n1" direction="higher" duration="8" dots="1" beam="none" stem="auto" data-author="keep"><!-- before mark -->${accent}${ornament}${interval}<!-- after mark --></music-road><music-road id="n2" direction="same" duration="eighth"></music-road><music-road id="n3" direction="lower" duration="sixteenth"></music-road></music-tuplet>`, 'three-roads');
}

function tiedRoads(): string {
  return staff('<music-road id="n1" direction="higher" duration="quarter" tie="start"></music-road><music-road id="n2" direction="same" duration="half" tie="continue"></music-road><music-road id="n3" direction="same" duration="quarter" tie="end"></music-road>', 'three-roads', '');
}

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing real author control ${id}`);
  return result as T;
}

function musicEvent(score: Score, id = 'n1'): MusicEvent {
  const event = score.staves.flatMap(item => item.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))
    .find(candidate => candidate.id === id);
  if (!event) throw new Error(`Missing accepted event ${id}`);
  return event;
}

function toggle(panel: HTMLElement, type: 'beforetoggle' | 'toggle', newState: 'open' | 'closed'): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && newState === 'open' });
  Object.defineProperties(event, {
    newState: { value: newState }, oldState: { value: newState === 'open' ? 'closed' : 'open' },
  });
  panel.dispatchEvent(event);
  return event;
}

/** Lifecycle stub only. This is not evidence of browser top-layer, picker, or focus behavior. */
function stubNativePopover(panel: HTMLElement) {
  let open = false;
  const show = vi.fn(() => {
    if (open || toggle(panel, 'beforetoggle', 'open').defaultPrevented) return;
    open = true;
    toggle(panel, 'toggle', 'open');
  });
  const hide = vi.fn(() => {
    if (!open) return;
    toggle(panel, 'beforetoggle', 'closed');
    open = false;
    toggle(panel, 'toggle', 'closed');
  });
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide },
  });
  return { show, hide, isOpen: () => open };
}

function recipe(): Record<string, { value: string; checked?: boolean }> {
  return Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'input[id^="event-"], select[id^="event-"], #insert-position',
  )].map(field => [field.id, { value: field.value, ...(field instanceof HTMLInputElement ? { checked: field.checked } : {}) }]));
}

function seedRecipe(): void {
  for (const [id, value] of Object.entries({
    'event-kind': 'chord', 'event-pitch': 'A#6', 'event-pitches': 'A#6 C7 E7',
    'event-duration': 'sixteenth', 'event-dots': '2', 'insert-position': 'before',
    'event-stem': 'down', 'event-beam': 'none', 'event-accidental-display': 'courtesy', 'event-direction': 'lower',
  })) control<HTMLInputElement | HTMLSelectElement>(id).value = value;
  for (const id of ['event-rhythmic', 'event-measure-rest']) control<HTMLInputElement>(id).checked = true;
}

interface FixtureOptions {
  native?: boolean;
  callbacks?: boolean;
  selectedId?: string;
  activeMarkingId?: string;
}

function fixture(html = sourceFor(), options: FixtureOptions = {}) {
  mountAuthorFixture();
  seedRecipe();
  const panel = control('note-editor');
  const popover = options.native ? stubNativePopover(panel) : undefined;
  if (!options.native) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  let session = new EditorSession(createProject(html, 'Context controls fixture'));
  session.select(options.selectedId ?? 'n1');
  const view = {
    mode: 'write' as ViewMode, selectionCount: 1, autoRefresh: true,
    activeMarkingId: options.activeMarkingId as string | undefined,
  };
  const state = (): NoteEditorState => {
    const base = {
      documentId: session.project.id, mode: view.mode, revision: session.revision,
      pendingSource: session.project.pendingSource !== null, activeMarkingId: view.activeMarkingId,
      selectionCount: view.selectionCount, staffLabel: '', measureNumber: '', voiceNumber: 1,
      remaining: rational(0), tuplets: [],
    };
    for (const item of session.score.staves) {
      for (const measure of item.measures) {
        for (const [index, voice] of measure.voices.entries()) {
          const event = voice.events.find(candidate => candidate.id === session.selectionId
            || candidate.markings?.some(marking => marking.id === session.selectionId));
          if (!event) continue;
          return {
            ...base, event, staffLabel: item.label, measureNumber: measure.number, voiceNumber: index + 1,
            remaining: subtract(meterTime(measure.meter), voice.events.reduce((time, candidate) => add(time, candidate.time), rational(0))),
            tuplets: voice.tuplets,
          };
        }
      }
    }
    return base;
  };
  const beforeOpen = vi.fn(() => {});
  const execute = vi.fn((command: AuthorCommand) => { session.execute(command); });
  const undo = vi.fn(() => { session.undo(); });
  const openAttachedMarks = vi.fn((_markingId?: string) => {});
  const openAdvanced = vi.fn((_target: 'pitches' | 'properties') => {});
  const editor = new NoteEditor({
    state, beforeOpen, execute, undo, canUndo: () => session.canUndo,
    ...(options.callbacks !== false ? { openAttachedMarks, openAdvanced } : {}),
  });
  const refresh = () => { if (view.autoRefresh) editor.refresh(); };
  session.addEventListener('change', refresh);
  cleanups.push(() => { session.removeEventListener('change', refresh); editor.dispose(); });
  return {
    editor, state, view, beforeOpen, execute, undo, openAttachedMarks, openAdvanced, panel, popover,
    get session() { return session; },
    replaceSession(replacementHtml = html) {
      session.removeEventListener('change', refresh);
      session = new EditorSession(createProject(replacementHtml, 'Another document with reused source IDs'));
      session.select(options.selectedId ?? 'n1');
      session.addEventListener('change', refresh);
      if (view.autoRefresh) editor.refresh();
    },
    trigger: control<HTMLButtonElement>('edit-selected-event'),
    direction: control<HTMLSelectElement>('note-direction'),
    duration: control<HTMLSelectElement>('note-duration'),
    marks: control<HTMLButtonElement>('note-attached-marks'),
    advanced: control<HTMLButtonElement>('note-advanced-edit'),
    undoButton: control<HTMLButtonElement>('note-editor-undo'),
    error: control('note-editor-error'), feedback: control('note-editor-feedback'),
  };
}

type Fixture = ReturnType<typeof fixture>;

function snapshot(h: Fixture) {
  return {
    project: h.session.project, score: h.session.score, revision: h.session.revision,
    selection: h.session.selectionId, cursor: h.session.cursor, canUndo: h.session.canUndo,
    canRedo: h.session.canRedo, recipe: recipe(),
  };
}

function change(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function dispatchClick(button: HTMLButtonElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  return event;
}

/** Model only an invoker's cancelable default, not native browser activation. */
function nativeTrigger(h: Fixture): void {
  if (h.trigger.disabled) return;
  const event = dispatchClick(h.trigger);
  if (!event.defaultPrevented && h.trigger.getAttribute('popovertarget') === h.panel.id) h.popover!.show();
}

function closed(h: Fixture): void {
  expect(h.panel.dataset.noteEditorState).toBe('closed');
  expect(h.panel.dataset.eventId).toBeUndefined();
  // An attached-mark route is not a popup disclosure and may omit this state.
  expect([null, 'false']).toContain(h.trigger.getAttribute('aria-expanded'));
  expect(h.popover?.isOpen() ?? !h.panel.hidden).toBe(false);
}

function noRoute(h: Fixture): void {
  expect(h.openAttachedMarks).not.toHaveBeenCalled();
  expect(h.openAdvanced).not.toHaveBeenCalled();
}

function hiddenOrDisabled(button: HTMLButtonElement): void {
  expect(button.disabled || !!button.closest('[hidden]')).toBe(true);
}

const contextChanges = ['selection', 'source', 'revision', 'document', 'mark', 'read', 'pages', 'pending', 'multiple', 'none'] as const;
type ContextChange = typeof contextChanges[number];

function alterContext(h: Fixture, kind: ContextChange): void {
  if (kind === 'selection') h.session.select('n2');
  else if (kind === 'source') h.session.applySource(h.session.project.sourceHtml.replace('pitch="F4"', 'pitch="A4"'));
  else if (kind === 'revision') h.session.update('An external metadata revision', draft => { draft.metadata.title = 'Changed elsewhere'; });
  else if (kind === 'document') {
    const oldId = h.session.project.id;
    const oldRevision = h.session.revision;
    h.replaceSession(twoMarkedNotes());
    expect(h.session.project.id).not.toBe(oldId);
    expect(h.session.revision).toBe(oldRevision);
    expect(h.state().event?.id).toBe('n1');
  } else if (kind === 'mark') h.view.activeMarkingId = h.view.activeMarkingId === 'accent' ? 'ornament' : 'accent';
  else if (kind === 'read' || kind === 'pages') h.view.mode = kind;
  else if (kind === 'pending') h.session.setPendingSource('<music-staff>unfinished source');
  else if (kind === 'multiple') h.view.selectionCount = 2;
  else h.session.select();
}

interface ShortBodyOptions {
  sticky?: boolean;
  bodyHeight?: number;
  contextHeight?: number;
  targetTop?: Partial<Record<string, number>>;
}

/**
 * Explicit geometry and scroll-method stubs only. Happy DOM has no layout or
 * native top layer: these assertions qualify the local reveal calculation,
 * not CSS stickiness, native picker behavior, or device viewport rendering.
 */
function shortBody(h: Fixture, options: ShortBodyOptions = {}) {
  const body = h.panel.querySelector<HTMLElement>('.note-editor-body')!;
  const context = control('note-editor-context');
  const score = control('score-scroll');
  const bodyTop = 72;
  const height = options.bodyHeight ?? 176;
  const contentHeight = 980;
  const contextOffset = 8;
  const metrics = { contextHeight: options.contextHeight ?? 32 };
  const offsets: Record<string, number> = {
    'note-natural': 96, 'note-sharp': 96, 'note-flat': 96, 'note-double-flat': 96, 'note-double-sharp': 96,
    'note-direction': 64, 'note-duration': 84, 'note-dots': 84, 'note-microtone': 312,
    'note-editor-error': 620, 'note-attached-marks': 744, 'note-advanced-edit': 744,
  };
  for (const [id, top] of Object.entries(options.targetTop ?? {})) if (top !== undefined) offsets[id] = top;
  let scrollTop = 0;
  const writes: number[] = [];
  const rectangle = (top: number, boxHeight: number) => new DOMRect(24, top, 300, boxHeight);
  const pinned = () => options.sticky !== false && context.dataset.contextPinned !== 'false';
  Object.defineProperties(body, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: () => contentHeight },
    clientTop: { configurable: true, value: 0 },
    clientWidth: { configurable: true, value: 300 },
    scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => {
      scrollTop = Math.max(0, Math.min(contentHeight - height, value));
      writes.push(scrollTop);
    } },
    getBoundingClientRect: { configurable: true, value: () => rectangle(bodyTop, height) },
  });
  Object.defineProperties(context, {
    clientHeight: { configurable: true, get: () => metrics.contextHeight },
    scrollHeight: { configurable: true, get: () => metrics.contextHeight },
    getBoundingClientRect: { configurable: true, value: () => rectangle(bodyTop
      + (pinned() ? Math.max(0, contextOffset - scrollTop) : contextOffset - scrollTop), metrics.contextHeight) },
  });
  Object.defineProperty(h.panel, 'getBoundingClientRect', {
    configurable: true, value: () => rectangle(20, height + 104),
  });
  for (const [id, top] of Object.entries(offsets)) {
    const element = control(id);
    const boxHeight = id === 'note-editor-error' ? 64 : 44;
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true, value: () => rectangle(bodyTop + offsets[id] - scrollTop, boxHeight),
    });
    Object.defineProperty(element, 'offsetTop', { configurable: true, get: () => offsets[id] });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: boxHeight });
    // Native select labels occupy their own line above the full control.
    const label = element.closest('label');
    if (label && body.contains(label)) Object.defineProperty(label, 'getBoundingClientRect', {
      configurable: true, value: () => rectangle(bodyTop + top - 18 - scrollTop, boxHeight + 18),
    });
  }
  const bodyScrollTo = vi.fn((leftOrOptions: number | ScrollToOptions, top?: number) => {
    body.scrollTop = typeof leftOrOptions === 'number' ? top ?? 0 : leftOrOptions.top ?? body.scrollTop;
  });
  const bodyScrollBy = vi.fn((leftOrOptions: number | ScrollToOptions, top?: number) => {
    body.scrollTop += typeof leftOrOptions === 'number' ? top ?? 0 : leftOrOptions.top ?? 0;
  });
  Object.defineProperties(body, {
    scrollTo: { configurable: true, value: bodyScrollTo }, scrollBy: { configurable: true, value: bodyScrollBy },
  });
  const oldIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const globalIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: globalIntoView });
  const outsideDescriptors: { element: HTMLElement; name: string; descriptor: PropertyDescriptor | undefined }[] = [];
  const outsideSpies = [score, document.documentElement, document.body].flatMap(element => ['scrollTo', 'scrollBy'].map(name => {
    const spy = vi.fn();
    outsideDescriptors.push({ element, name, descriptor: Object.getOwnPropertyDescriptor(element, name) });
    Object.defineProperty(element, name, { configurable: true, value: spy });
    return spy;
  }));
  const windowScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const windowScrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const computedStyle = window.getComputedStyle.bind(window);
  const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    if (element === context) Object.defineProperty(style, 'position', { configurable: true, value: pinned() ? 'sticky' : 'static' });
    return style;
  });
  const sentinel = { scoreTop: 347, scoreLeft: 29, rootTop: 683, documentBodyTop: 191 };
  const originalScroll = { scoreTop: score.scrollTop, scoreLeft: score.scrollLeft,
    rootTop: document.documentElement.scrollTop, documentBodyTop: document.body.scrollTop };
  score.scrollTop = sentinel.scoreTop;
  score.scrollLeft = sentinel.scoreLeft;
  document.documentElement.scrollTop = sentinel.rootTop;
  document.body.scrollTop = sentinel.documentBodyTop;
  const focusSpies = Object.fromEntries(Object.keys(offsets).map(id => [id, vi.spyOn(control(id), 'focus')]));
  const clear = () => {
    writes.length = 0;
    bodyScrollTo.mockClear(); bodyScrollBy.mockClear(); globalIntoView.mockClear();
    outsideSpies.forEach(spy => spy.mockClear());
    windowScrollTo.mockClear(); windowScrollBy.mockClear();
    Object.values(focusSpies).forEach(spy => spy.mockClear());
  };
  cleanups.push(() => {
    if (oldIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', oldIntoView);
    else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    windowScrollTo.mockRestore(); windowScrollBy.mockRestore(); styleSpy.mockRestore();
    Object.values(focusSpies).forEach(spy => spy.mockRestore());
    for (const { element, name, descriptor } of outsideDescriptors) {
      if (descriptor) Object.defineProperty(element, name, descriptor);
      else Reflect.deleteProperty(element, name);
    }
    score.scrollTop = originalScroll.scoreTop; score.scrollLeft = originalScroll.scoreLeft;
    document.documentElement.scrollTop = originalScroll.rootTop;
    document.body.scrollTop = originalScroll.documentBodyTop;
  });
  const noOutsideScroll = () => {
    expect(globalIntoView).not.toHaveBeenCalled();
    outsideSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(windowScrollTo).not.toHaveBeenCalled();
    expect(windowScrollBy).not.toHaveBeenCalled();
    expect(score.scrollTop).toBe(sentinel.scoreTop);
    expect(score.scrollLeft).toBe(sentinel.scoreLeft);
    expect(document.documentElement.scrollTop).toBe(sentinel.rootTop);
    expect(document.body.scrollTop).toBe(sentinel.documentBodyTop);
  };
  const fullyVisible = (element: HTMLElement) => {
    const viewport = body.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
    if (pinned() && element !== context) expect(bounds.top).toBeGreaterThan(context.getBoundingClientRect().bottom);
  };
  return { body, context, metrics, offsets, writes, focusSpies, clear, noOutsideScroll, fullyVisible };
}

afterEach(async () => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  await releaseAuthorFixture();
});

describe('contextual quick direction on accepted three-roads music', () => {
  it('patches only direction, preserving complete timing, markings, source identities, and entry recipe through one Undo', () => {
    const h = fixture(roadTuplet());
    const before = snapshot(h);
    const nodes = [h.session.source, ...h.session.source.querySelectorAll('*')];
    const expectedMusic = structuredClone(before.score);
    Object.assign(musicEvent(expectedMusic), { pitchDirection: 'lower' });
    h.editor.open();
    expect(control('note-direction-field').hidden).toBe(false);
    expect(control('note-pitch-controls').hidden).toBe(true);
    expect(h.direction.value).toBe('higher');
    expect(h.direction.disabled).toBe(false);
    expect(document.activeElement).toBe(h.direction);
    h.direction.focus();
    change(h.direction, 'lower');
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0][0]).toMatchObject({ type: 'update-event', eventId: 'n1', fields: ['pitchDirection'], value: { pitchDirection: 'lower' } });
    expect(h.session.score).toEqual(expectedMusic);
    expect(h.session.project.sourceHtml).toBe(before.project.sourceHtml.replace('direction="higher"', 'direction="lower"'));
    expect(h.session.revision).toBe(before.revision + 1);
    expect(h.session.selectionId).toBe('n1');
    expect(recipe()).toEqual(before.recipe);
    expect(document.activeElement).toBe(h.direction);
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(h.panel.dataset.revision).toBe(String(h.session.revision));
    const afterNodes = [h.session.source, ...h.session.source.querySelectorAll('*')];
    expect(afterNodes).toHaveLength(nodes.length);
    nodes.forEach((node, index) => expect(afterNodes[index]).toBe(node));
    const changed = snapshot(h);
    change(h.direction, 'lower');
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(snapshot(h)).toEqual(changed);
    expect(h.feedback.textContent).toMatch(/no undo step/i);
    h.undoButton.click();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.session.project.sourceHtml).toBe(before.project.sourceHtml);
    expect(h.session.score).toEqual(before.score);
    expect(recipe()).toEqual(before.recipe);
    expect(h.session.canUndo).toBe(false);
    expect(h.session.canRedo).toBe(true);
    expect(h.direction.value).toBe('higher');
    expect(h.session.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    nodes.forEach((node, index) => expect([h.session.source, ...h.session.source.querySelectorAll('*')][index]).toBe(node));
  });

  it('preserves an existing redo branch for an unchanged direction', () => {
    const h = fixture(roadTuplet());
    h.session.update('Earlier title', draft => { draft.metadata.title = 'An undone title'; });
    h.session.undo();
    h.editor.open();
    const before = snapshot(h);
    expect(before.canRedo).toBe(true);
    change(h.direction, 'higher');
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    expect(h.undoButton.disabled).toBe(true);
  });

  it.each(['n2', 'n3'])('keeps tied continuation %s on Same and rejects a fabricated new attack', selectedId => {
    const h = fixture(tiedRoads(), { selectedId });
    h.editor.open();
    const before = snapshot(h);
    expect(h.direction.value).toBe('same');
    expect(control('note-direction-help').textContent).toMatch(/same|sustain|tie/i);
    change(h.direction, 'same');
    expect(h.execute).not.toHaveBeenCalled();
    for (const direction of ['higher', 'lower']) {
      change(h.direction, direction);
      expect(snapshot(h)).toEqual(before);
      expect(h.direction.value).toBe('same');
      expect(h.error.hidden).toBe(false);
      expect(h.error.textContent).toMatch(/same|sustain|tie/i);
    }
    expect(h.session.canUndo).toBe(false);
  });

  it('allows the attack direction at a tie start without changing its continuations', () => {
    const h = fixture(tiedRoads());
    const before = snapshot(h);
    const expected = structuredClone(before.score);
    Object.assign(musicEvent(expected), { pitchDirection: 'lower' });
    h.editor.open();
    expect(h.direction.disabled).toBe(false);
    change(h.direction, 'lower');
    expect(h.session.score).toEqual(expected);
    expect(h.session.revision).toBe(1);
    h.undoButton.click();
    expect(h.session.project.sourceHtml).toBe(before.project.sourceHtml);
    expect(h.session.canUndo).toBe(false);
  });

  it('rejects an invalid direction and restores accepted controls without calling a transaction', () => {
    const h = fixture(roadTuplet());
    h.editor.open();
    const before = snapshot(h);
    h.direction.selectedIndex = -1;
    h.direction.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    expect(h.direction.value).toBe('higher');
    expect(h.error.hidden).toBe(false);
  });

  it.each((Object.keys(targets) as TargetKind[]).filter(kind => kind !== 'road'))('never turns a %s into a road via a hidden direction control', kind => {
    const h = fixture(sourceFor(kind));
    h.editor.open();
    const before = snapshot(h);
    expect(control('note-direction-field').hidden).toBe(true);
    change(h.direction, 'lower');
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
  });
});

describe('only relevant note-context controls and explicit Tools routes', () => {
  it.each(['rhythm', 'road', 'rhythmicSlash', 'openSlash', 'rest', 'measureRest'] as const)('hides accidental controls for %s instead of presenting irrelevant choices', kind => {
    const h = fixture(sourceFor(kind));
    h.editor.open();
    expect(control('note-pitch-controls').hidden).toBe(true);
    expect(control('note-pitch-controls').contains(control('note-microtone'))).toBe(true);
    for (const id of ['note-double-flat', 'note-flat', 'note-natural', 'note-sharp', 'note-double-sharp']) {
      expect(control('note-pitch-controls').contains(control(id))).toBe(true);
      expect(control<HTMLButtonElement>(id).disabled).toBe(true);
    }
    expect(control<HTMLSelectElement>('note-microtone').disabled).toBe(true);
    expect(recipe()['event-pitch'].value).toBe('A#6');
  });

  it('keeps accidental controls available for a single pitched note', () => {
    const h = fixture();
    h.editor.open();
    expect(control('note-pitch-controls').hidden).toBe(false);
    expect(control<HTMLSelectElement>('note-microtone').disabled).toBe(false);
    expect(control<HTMLSelectElement>('note-microtone').value).toBe('0.5');
  });

  it.each([0, 2])('names the attached marking count %s and deliberately routes without editing music', count => {
    const h = fixture(sourceFor('note', count ? `${accent}${ornament}` : ''));
    const before = snapshot(h);
    h.editor.open();
    expect(h.marks.hidden).toBe(false);
    expect(h.marks.disabled).toBe(false);
    expect(h.marks.textContent).toMatch(/mark/i);
    expect(h.marks.textContent).toMatch(new RegExp(`\\b${count}\\b`));
    h.marks.click();
    expect(h.openAttachedMarks).toHaveBeenCalledTimes(1);
    expect(h.openAttachedMarks.mock.calls[0][0]).toBeUndefined();
    expect(h.openAdvanced).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it.each(Object.keys(targets) as TargetKind[])('keeps the attached-mark route available for %s, including events without quick pitch or rhythm edits', kind => {
    const h = fixture(sourceFor(kind, '<music-articulation id="hold" type="fermata"></music-articulation>'));
    const before = snapshot(h);
    h.editor.open();
    expect(h.marks.hidden).toBe(false);
    expect(h.marks.disabled).toBe(false);
    expect(h.marks.textContent).toMatch(/\b1\b/);
    h.marks.click();
    expect(h.openAttachedMarks).toHaveBeenCalledTimes(1);
    expect(h.openAttachedMarks.mock.calls[0][0]).toBeUndefined();
    expect(h.openAdvanced).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it.each(Object.keys(targets) as TargetKind[])('routes %s advanced editing to its precise target without changing source', kind => {
    const h = fixture(sourceFor(kind));
    const before = snapshot(h);
    h.editor.open();
    expect(h.advanced.hidden).toBe(false);
    expect(h.advanced.disabled).toBe(false);
    if (kind === 'chord') expect(h.advanced.textContent).toMatch(/pitch/i);
    h.advanced.click();
    expect(h.openAdvanced).toHaveBeenCalledExactlyOnceWith(kind === 'chord' ? 'pitches' : 'properties');
    expect(h.openAttachedMarks).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it('does not leave dead route buttons when callbacks are omitted', () => {
    const h = fixture(sourceFor('chord'), { callbacks: false });
    h.editor.open();
    const before = snapshot(h);
    hiddenOrDisabled(h.marks);
    hiddenOrDisabled(h.advanced);
    dispatchClick(h.marks);
    dispatchClick(h.advanced);
    noRoute(h);
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
  });
});

describe('an active attached marking is a deliberate route, never an automatic popup', () => {
  it.each([
    ['accent', /accent/i], ['ornament', /mordent/i], ['interval', /[b♭]3|flat.?3/i],
  ] as const)('names the actual %s marking instead of its owner event', (activeMarkingId, label) => {
    const h = fixture(roadTuplet(), { activeMarkingId, native: true });
    const before = snapshot(h);
    expect(h.trigger.disabled).toBe(false);
    expect(control('edit-selected-label').textContent).toMatch(label);
    h.editor.refresh();
    h.editor.refresh();
    noRoute(h);
    expect(h.beforeOpen).not.toHaveBeenCalled();
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it.each(['open', 'native click'] as const)('routes one exact marking ID through explicit %s without opening the note popup', method => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'ornament', native: true });
    const before = snapshot(h);
    if (method === 'open') h.editor.open();
    else nativeTrigger(h);
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    expect(h.openAttachedMarks).toHaveBeenCalledExactlyOnceWith('ornament');
    expect(h.openAdvanced).not.toHaveBeenCalled();
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it('cancels a raw native beforetoggle on a mark without treating it as a Tools request', () => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'accent', native: true });
    const before = snapshot(h);
    h.popover!.show();
    noRoute(h);
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it('changes only the displayed context during passive selection and refresh', () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const before = snapshot(h);
    h.view.activeMarkingId = 'accent';
    h.editor.refresh();
    expect(control('edit-selected-label').textContent).toMatch(/accent/i);
    h.view.activeMarkingId = 'second-mark';
    h.session.select('n2');
    expect(control('edit-selected-label').textContent).toMatch(/tenuto/i);
    noRoute(h);
    expect(h.beforeOpen).not.toHaveBeenCalled();
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before.project);
    expect(h.session.score).toEqual(before.score);
    expect(h.session.revision).toBe(before.revision);
    expect(recipe()).toEqual(before.recipe);
    closed(h);
  });

  it('rejects a marking ID that does not belong to the selected event without editing its owner instead', () => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'second-mark', native: true });
    const before = snapshot(h);
    expect(control('edit-selected-label').textContent).not.toMatch(/tenuto/i);
    h.editor.open();
    noRoute(h);
    expect(h.trigger.disabled).toBe(true);
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it('does not offer an active-mark route without its callback', () => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'accent', callbacks: false, native: true });
    const before = snapshot(h);
    hiddenOrDisabled(h.trigger);
    h.editor.open();
    dispatchClick(h.trigger);
    noRoute(h);
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });
});

describe('context routes bind the displayed document, event, revision, and active marking', () => {
  for (const route of ['marks', 'advanced'] as const) {
    it.each(contextChanges)(`rejects the ${route} popup action after unseen %s changes`, kind => {
      const h = fixture(twoMarkedNotes(), { native: true });
      h.editor.open();
      expect(h.popover?.isOpen()).toBe(true);
      h.view.autoRefresh = false;
      alterContext(h, kind);
      const before = snapshot(h);
      dispatchClick(h[route]);
      noRoute(h);
      expect(h.execute).not.toHaveBeenCalled();
      expect(snapshot(h)).toEqual(before);
      closed(h);
    });
  }

  for (const method of ['open', 'native click'] as const) {
    it.each(contextChanges)(`rejects the displayed active-mark ${method} once after unseen %s changes`, kind => {
      const h = fixture(twoMarkedNotes(), { activeMarkingId: 'accent', native: true });
      h.view.autoRefresh = false;
      alterContext(h, kind);
      const before = snapshot(h);
      if (method === 'open') h.editor.open();
      else nativeTrigger(h);
      noRoute(h);
      expect(h.execute).not.toHaveBeenCalled();
      expect(h.popover?.show).not.toHaveBeenCalled();
      expect(snapshot(h)).toEqual(before);
      closed(h);
      if (kind === 'mark' || kind === 'source' || kind === 'revision' || kind === 'document') {
        const expectedMark = kind === 'mark' ? 'ornament' : 'accent';
        expect(control('edit-selected-label').textContent).toMatch(kind === 'mark' ? /mordent/i : /accent/i);
        if (method === 'open') h.editor.open();
        else nativeTrigger(h);
        expect(h.openAttachedMarks).toHaveBeenCalledExactlyOnceWith(expectedMark);
        expect(h.popover?.show).not.toHaveBeenCalled();
        expect(snapshot(h)).toEqual(before);
      }
    });
  }

  it.each(contextChanges)('rechecks an active-mark route when beforeOpen changes %s', kind => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'accent', native: true });
    let afterPreparation: ReturnType<typeof snapshot> | undefined;
    h.beforeOpen.mockImplementation(() => {
      alterContext(h, kind);
      afterPreparation = snapshot(h);
    });
    h.editor.open();
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    noRoute(h);
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(afterPreparation);
    closed(h);
  });

  it('permits a harmless beforeOpen refresh without recursive routing', () => {
    const h = fixture(twoMarkedNotes(), { activeMarkingId: 'accent', native: true });
    h.beforeOpen.mockImplementation(() => h.editor.refresh());
    const before = snapshot(h);
    h.editor.open();
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    expect(h.openAttachedMarks).toHaveBeenCalledExactlyOnceWith('accent');
    expect(h.popover?.show).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });

  it('closes an already open event popup on passive document replacement despite reused IDs and revision', () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    h.editor.open();
    expect(h.popover?.isOpen()).toBe(true);
    alterContext(h, 'document');
    const before = snapshot(h);
    closed(h);
    dispatchClick(h.marks);
    dispatchClick(h.advanced);
    noRoute(h);
    expect(snapshot(h)).toEqual(before);
  });

  it('closes an event popup on passive marking selection without navigating Tools', () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    h.editor.open();
    const before = snapshot(h);
    h.view.activeMarkingId = 'accent';
    h.editor.refresh();
    closed(h);
    noRoute(h);
    expect(control('edit-selected-label').textContent).toMatch(/accent/i);
    expect(snapshot(h)).toEqual(before);
  });

  it.each(['execute', 'undo'] as const)('drops its local binding when its own %s callback replaces the document with reused source IDs', action => {
    const h = fixture(roadTuplet(), { native: true });
    h.editor.open();
    const originalId = h.session.project.id;
    let replacement: ReturnType<typeof snapshot> | undefined;
    if (action === 'undo') change(h.direction, 'lower');
    // Suppress ordinary session refresh so this exercises the post-callback
    // guard itself, not a prior close from a change-event listener.
    h.view.autoRefresh = false;
    if (action === 'execute') {
      h.execute.mockImplementation(command => {
        h.session.execute(command);
        h.replaceSession(roadTuplet());
        replacement = snapshot(h);
      });
      change(h.direction, 'lower');
    } else {
      h.undo.mockImplementation(() => {
        h.session.undo();
        h.replaceSession(roadTuplet());
        replacement = snapshot(h);
      });
      h.undoButton.click();
    }
    expect(h.session.project.id).not.toBe(originalId);
    expect(h.session.revision).toBe(0);
    expect(h.state().event?.id).toBe('n1');
    expect(h.session.canUndo).toBe(false);
    expect(h.undoButton.disabled).toBe(true);
    closed(h);
    change(h.direction, 'same');
    dispatchClick(h.undoButton);
    dispatchClick(h.marks);
    dispatchClick(h.advanced);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.undo).toHaveBeenCalledTimes(action === 'undo' ? 1 : 0);
    noRoute(h);
    expect(snapshot(h)).toEqual(replacement);
    closed(h);
  });

  it.each(['popup', 'active mark'] as const)('ignores route and quick-property actions after disposing %s controls', context => {
    const h = fixture(context === 'popup' ? roadTuplet() : twoMarkedNotes(), {
      native: true, ...(context === 'active mark' ? { activeMarkingId: 'accent' } : {}),
    });
    if (context === 'popup') h.editor.open();
    h.editor.dispose();
    const before = snapshot(h);
    dispatchClick(h.marks);
    dispatchClick(h.advanced);
    dispatchClick(h.trigger);
    change(h.direction, 'lower');
    h.editor.open();
    h.editor.refresh();
    noRoute(h);
    expect(h.execute).not.toHaveBeenCalled();
    expect(snapshot(h)).toEqual(before);
    closed(h);
  });
});

describe('bounded note-editor body reveal with explicit unit geometry', () => {
  it.each([
    ['ordinary accidental', () => twoMarkedNotes(), 'note-natural'],
    ['road direction', () => sourceFor('road'), 'note-direction'],
    ['chord duration', () => sourceFor('chord'), 'note-duration'],
    ['quarter-tone accidental', () => sourceFor('note'), 'note-microtone'],
  ] as const)('reopens a scrolled short body with its full %s control below the pinned context', async (_label, html, targetId) => {
    const h = fixture(html(), { native: true });
    const geometry = shortBody(h);
    const target = control(targetId);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    h.popover!.hide();
    h.trigger.focus();
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    h.editor.open();
    await Promise.resolve();
    expect(h.popover!.isOpen()).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(geometry.focusSpies[targetId]).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    geometry.noOutsideScroll();
    geometry.fullyVisible(target);
    geometry.fullyVisible(geometry.context);
    expect(geometry.body.scrollTop).toBeLessThan(680);
    expect(geometry.context.textContent).toMatch(/Soloist.*measure 12.*voice 1/i);
    expect(snapshot(h)).toEqual(before);
    noRoute(h);
  });

  it('co-reveals a nonsticky context with the accepted control when their full extent fits', async () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h, { sticky: false });
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    geometry.noOutsideScroll();
    geometry.fullyVisible(geometry.context);
    geometry.fullyVisible(control('note-natural'));
    expect(document.activeElement).toBe(control('note-natural'));
    expect(snapshot(h)).toEqual(before);
  });

  it('keeps the control reachable when a nonsticky context cannot fit alongside it', async () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h, { sticky: false, contextHeight: 240, targetTop: { 'note-natural': 342 } });
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    geometry.noOutsideScroll();
    geometry.fullyVisible(control('note-natural'));
    expect(geometry.context.scrollTop).toBe(0);
    expect(geometry.context.clientHeight).toBe(240);
    expect(document.activeElement).toBe(control('note-natural'));
    expect(snapshot(h)).toEqual(before);
  });

  it('unpins an overlarge context to reveal the whole control, then restores pinning for a shorter context on reopen', async () => {
    const longLabel = 'Very long performer and instrument label '.repeat(20).trim();
    const h = fixture(twoMarkedNotes().replace('label="Soloist"', `label="${longLabel}"`), { native: true });
    const geometry = shortBody(h, { contextHeight: 240, targetTop: { 'note-natural': 342 } });
    geometry.body.scrollTop = 680;
    geometry.clear();
    const originalStyle = geometry.context.getAttribute('style');
    const before = snapshot(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    expect(geometry.context.dataset.contextPinned).toBe('false');
    geometry.noOutsideScroll();
    geometry.fullyVisible(control('note-natural'));
    expect(geometry.context.clientHeight).toBe(240);
    expect(geometry.context.scrollTop).toBe(0);
    expect(geometry.context.getAttribute('style')).toBe(originalStyle);
    expect(snapshot(h)).toEqual(before);
    h.popover!.hide();
    h.session.applySource(h.session.project.sourceHtml.replace(longLabel, 'Soloist'));
    geometry.metrics.contextHeight = 32;
    geometry.offsets['note-natural'] = 96;
    h.trigger.focus();
    geometry.body.scrollTop = 680;
    geometry.clear();
    const shortened = snapshot(h);
    h.editor.open();
    await Promise.resolve();
    expect(geometry.context.dataset.contextPinned).toBeUndefined();
    geometry.noOutsideScroll();
    geometry.fullyVisible(geometry.context);
    geometry.fullyVisible(control('note-natural'));
    expect(snapshot(h)).toEqual(shortened);
  });

  it.each(['invalid control value', 'transaction validation'] as const)('reveals a local %s diagnostic without moving the focused input or any ancestor', async failure => {
    const html = staff('<music-note id="n1" pitch="F4" duration="half"></music-note><music-note id="n2" pitch="G4" duration="half"></music-note>', 'pitched', '');
    const h = fixture(html, { native: true });
    const geometry = shortBody(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    h.duration.focus({ preventScroll: true });
    geometry.body.scrollTop = 0;
    geometry.clear();
    const before = snapshot(h);
    if (failure === 'invalid control value') {
      h.duration.selectedIndex = -1;
      h.duration.dispatchEvent(new Event('change', { bubbles: true }));
    } else change(h.duration, 'whole');
    expect(h.error.hidden).toBe(false);
    expect(h.error.textContent?.trim()).not.toBe('');
    expect(document.activeElement).toBe(h.duration);
    geometry.noOutsideScroll();
    geometry.fullyVisible(h.error);
    geometry.fullyVisible(geometry.context);
    expect(snapshot(h)).toEqual(before);
  });

  it('does not replace focus or scroll when a control is already focused before the queued open callback', async () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    geometry.body.scrollTop = 680;
    h.trigger.focus();
    h.editor.open();
    const dots = control('note-dots');
    dots.focus({ preventScroll: true });
    geometry.clear();
    const before = snapshot(h);
    await Promise.resolve();
    expect(document.activeElement).toBe(dots);
    expect(geometry.focusSpies['note-natural']).not.toHaveBeenCalled();
    expect(geometry.focusSpies['note-dots']).not.toHaveBeenCalled();
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    geometry.noOutsideScroll();
    expect(snapshot(h)).toEqual(before);
  });

  it('leaves user scrolling and focus alone during passive refresh', async () => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    h.editor.refresh();
    h.editor.refresh();
    await Promise.resolve();
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    expect(document.activeElement).toBe(control('note-natural'));
    Object.values(geometry.focusSpies).forEach(spy => expect(spy).not.toHaveBeenCalled());
    geometry.noOutsideScroll();
    expect(snapshot(h)).toEqual(before);
  });

  it.each(['beforetoggle', 'toggle'] as const)('ignores child picker %s events without focus or body scroll interference', async type => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    h.duration.focus({ preventScroll: true });
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    toggle(h.duration, type, 'closed');
    toggle(h.duration, type, 'open');
    await Promise.resolve();
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(document.activeElement).toBe(h.duration);
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    Object.values(geometry.focusSpies).forEach(spy => expect(spy).not.toHaveBeenCalled());
    geometry.noOutsideScroll();
    expect(snapshot(h)).toEqual(before);
  });

  it.each(['closed', 'selection', 'source', 'document', 'pending', 'read', 'disposed'] as const)('does not reveal or refocus a queued opening after it becomes %s', async kind => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    geometry.body.scrollTop = 680;
    h.trigger.focus();
    h.editor.open();
    if (kind === 'closed') h.popover!.hide();
    else if (kind === 'disposed') h.editor.dispose();
    else {
      alterContext(h, kind);
      if (kind === 'read') h.editor.refresh();
    }
    geometry.clear();
    const before = snapshot(h);
    await Promise.resolve();
    closed(h);
    expect(document.activeElement).toBe(h.trigger);
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    Object.values(geometry.focusSpies).forEach(spy => expect(spy).not.toHaveBeenCalled());
    geometry.noOutsideScroll();
    expect(snapshot(h)).toEqual(before);
  });

  it.each(contextChanges)('revalidates an unrefreshed queued opening after an unseen %s change before focus or reveal', async kind => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    geometry.body.scrollTop = 680;
    h.trigger.focus();
    h.editor.open();
    h.view.autoRefresh = false;
    alterContext(h, kind);
    // Nothing has explicitly refreshed or closed the displayed popup yet.
    expect(h.panel.dataset.noteEditorState).toBe('open');
    geometry.clear();
    const before = snapshot(h);
    await Promise.resolve();
    closed(h);
    expect(document.activeElement).toBe(h.trigger);
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    Object.values(geometry.focusSpies).forEach(spy => expect(spy).not.toHaveBeenCalled());
    geometry.noOutsideScroll();
    noRoute(h);
    expect(snapshot(h)).toEqual(before);
  });

  it.each(['closed', 'selection', 'document', 'pending', 'disposed'] as const)('rechecks the binding after a focus handler makes the editor %s, before touching scroll', async kind => {
    const h = fixture(twoMarkedNotes(), { native: true });
    const geometry = shortBody(h);
    geometry.body.scrollTop = 680;
    geometry.context.dataset.contextPinned = 'false';
    let invalidated: ReturnType<typeof snapshot> | undefined;
    const target = control('note-natural');
    target.addEventListener('focus', () => {
      h.view.autoRefresh = false;
      if (kind === 'closed') h.popover!.hide();
      else if (kind === 'disposed') h.editor.dispose();
      else alterContext(h, kind);
      invalidated = snapshot(h);
    }, { once: true });
    h.trigger.focus();
    geometry.clear();
    h.editor.open();
    await Promise.resolve();
    expect(invalidated).toBeDefined();
    expect(geometry.focusSpies['note-natural']).toHaveBeenCalledTimes(1);
    closed(h);
    expect(geometry.context.dataset.contextPinned).toBe('false');
    expect(geometry.body.scrollTop).toBe(680);
    expect(geometry.writes).toEqual([]);
    geometry.noOutsideScroll();
    noRoute(h);
    expect(snapshot(h)).toEqual(invalidated);
  });

  it('reveals the focused accepted control after a successful edit using only body scroll', async () => {
    const h = fixture(roadTuplet(), { native: true });
    const geometry = shortBody(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    h.direction.focus({ preventScroll: true });
    geometry.body.scrollTop = 680;
    geometry.clear();
    const before = snapshot(h);
    const expectedMusic = structuredClone(before.score);
    Object.assign(musicEvent(expectedMusic), { pitchDirection: 'lower' });
    change(h.direction, 'lower');
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.revision).toBe(before.revision + 1);
    expect(h.session.project.sourceHtml).toBe(before.project.sourceHtml.replace('direction="higher"', 'direction="lower"'));
    expect(h.session.score).toEqual(expectedMusic);
    expect(recipe()).toEqual(before.recipe);
    expect(document.activeElement).toBe(h.direction);
    expect(geometry.focusSpies['note-direction']).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    geometry.noOutsideScroll();
    geometry.fullyVisible(h.direction);
    geometry.fullyVisible(geometry.context);
    expect(geometry.body.scrollTop).toBeLessThan(680);
    expect(h.undoButton.disabled).toBe(false);
    noRoute(h);
  });

  it('moves focus from the newly disabled last-Undo button to a fully revealed control without scrolling ancestors', async () => {
    const h = fixture(roadTuplet(), { native: true });
    const geometry = shortBody(h);
    const original = snapshot(h);
    h.trigger.focus();
    h.editor.open();
    await Promise.resolve();
    change(h.direction, 'lower');
    expect(h.undoButton.disabled).toBe(false);
    h.undoButton.focus({ preventScroll: true });
    geometry.body.scrollTop = 680;
    geometry.clear();
    h.undoButton.click();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.session.project.sourceHtml).toBe(original.project.sourceHtml);
    expect(h.session.score).toEqual(original.score);
    expect(recipe()).toEqual(original.recipe);
    expect(h.session.canUndo).toBe(false);
    expect(h.session.canRedo).toBe(true);
    expect(h.undoButton.disabled).toBe(true);
    expect(document.activeElement).toBe(h.direction);
    expect(geometry.focusSpies['note-direction']).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    geometry.noOutsideScroll();
    geometry.fullyVisible(h.direction);
    geometry.fullyVisible(geometry.context);
    expect(geometry.body.scrollTop).toBeLessThan(680);
    noRoute(h);
  });
});
