// @vitest-environment happy-dom
import { mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { SelectionControls } from '../src/authoring/selection-controls.js';
import type { SelectionControlsState } from '../src/authoring/selection-controls.js';
import type { AuthorCommand, ViewMode } from '../src/authoring/types.js';
import { add, meterTime, pitchText, rational, subtract } from '../src/model/index.js';
import type { MusicEvent } from '../src/model/types.js';

// This suite owns controller semantics, not layout. Keep NativeSurfaces and
// EditorSession real; positioning and unavailable-anchor measurements have
// separate tests. Happy DOM's zero rectangles must not dismiss every chooser.
const positionerMocks = vi.hoisted(() => {
  function controller() {
    return {
      open: vi.fn((_invoker: HTMLElement | null) => {}), refresh: vi.fn(() => {}),
      close: vi.fn(() => {}), dispose: vi.fn(() => {}),
    };
  }
  const records: { panel: HTMLElement; controls: ReturnType<typeof controller> }[] = [];
  const create = vi.fn((options: { panel: HTMLElement }) => {
    const controls = controller(); records.push({ panel: options.panel, controls }); return controls;
  });
  return { records, create };
});
vi.mock('../src/authoring/popover-position.js', () => ({ createPopoverPositioner: positionerMocks.create }));

// Real Author markup, without its app controller, stylesheet, or remote assets.
const cleanups: (() => void)[] = [];
const surfaceNames = ['value', 'pitch', 'shared'] as const;
const chooserAccidentalIds = ['selection-chooser-flat', 'selection-chooser-natural', 'selection-chooser-sharp'] as const;
type SurfaceName = typeof surfaceNames[number];
type FixtureControlRoot = Document | HTMLElement | ShadowRoot;
const note = (id: string, attributes = 'pitch="F4" duration="quarter"', children = '') =>
  `<music-note id="${id}" ${attributes}>${children}</music-note>`;
const scoreHtml = (events = note('n1', 'pitch="F4" duration="quarter" accidental-display="courtesy" stem="down" beam="none" data-user="keep"')
  + note('n2', 'pitch="G4" duration="quarter"') + note('n3', 'pitch="A4" duration="eighth"'),
measureAttributes = 'incomplete', staffAttributes = 'key="G"') =>
  `<music-staff id="staff" label="Flute" ${staffAttributes}><music-measure id="bar" number="12" ${measureAttributes}>${events}</music-measure></music-staff>`;

function control<T extends HTMLElement = HTMLElement>(id: string, root: FixtureControlRoot = document): T {
  const element = root.querySelector<HTMLElement>(`#${id}`) ?? [...root.querySelectorAll('music-toggle-button-group')].map(group => group.shadowRoot?.querySelector<HTMLElement>(`#${id}`)).find(Boolean);
  if (!element) throw new Error(`Missing real selection control ${id}`);
  return element as T;
}

function lifecycle(panel: HTMLElement, type: 'beforetoggle' | 'toggle', state: 'open' | 'closed', source?: HTMLElement): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && state === 'open' });
  Object.defineProperties(event, {
    newState: { value: state }, oldState: { value: state === 'open' ? 'closed' : 'open' }, source: { value: source ?? null },
  });
  panel.dispatchEvent(event);
  return event;
}

/** Lifecycle stub only: native top-layer rendering, dismissal, and OS input need browser qualification. */
function stubNative(panel: HTMLElement) {
  let open = false;
  const matches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : matches(selector));
  const show = vi.fn((source?: HTMLElement) => {
    if (open || lifecycle(panel, 'beforetoggle', 'open', source).defaultPrevented) return;
    open = true;
    lifecycle(panel, 'toggle', 'open', source);
  });
  const hide = vi.fn(() => {
    if (!open) return;
    lifecycle(panel, 'beforetoggle', 'closed');
    open = false;
    lifecycle(panel, 'toggle', 'closed');
  });
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide },
  });
  return { show, hide, isOpen: () => open };
}

function fixture(html = scoreHtml(), settings: {
  native?: boolean; ids?: string[]; observeSuccess?: boolean; mount?: HTMLElement; root?: FixtureControlRoot;
} = {}) {
  mountAuthorFixture(settings.mount);
  const root = settings.root ?? settings.mount ?? document;
  const localControl = <T extends HTMLElement = HTMLElement>(id: string) => control<T>(id, root);
  const nativeSurfaces = new Map<SurfaceName, ReturnType<typeof stubNative>>();
  for (const name of surfaceNames) {
    const panel = localControl(`selection-${name}-chooser`);
    if (settings.native) nativeSurfaces.set(name, stubNative(panel));
    else Object.defineProperties(panel, {
      showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
    });
  }
  const session = new EditorSession(createProject(html, 'Selection controls fixture'));
  const view = {
    ids: settings.ids ?? ['n1'], documentId: session.project.id, mode: 'write' as ViewMode,
    selectionVersion: 1, documentEpoch: 1, entryMode: false, autoRefresh: true, inspectionMatchesSelection: true,
    moreExpanded: undefined as boolean | undefined,
    activeMarkingId: undefined as string | undefined, selectMoreActive: false, pitchDragArmed: false,
    structural: undefined as SelectionControlsState['structural'],
  };
  session.select(view.ids[0]);
  const state = (): SelectionControlsState => {
    const score = session.score;
    const all = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
    const events = view.ids.flatMap(id => {
      const found = all.find(event => event.id === id);
      return found ? [found] : [];
    });
    const base: SelectionControlsState = {
      documentId: view.documentId, documentEpoch: view.documentEpoch, mode: view.mode, entryMode: view.entryMode,
      revision: session.revision, pendingSource: session.project.pendingSource !== null,
      score, event: events[0], events, eventIds: [...view.ids], selectionCount: view.ids.length,
      selectionVersion: view.selectionVersion, activeMarkingId: view.activeMarkingId,
      staffLabel: '', measureNumber: '', voiceNumber: 1, remaining: rational(0), tuplets: [],
      selectMoreActive: view.selectMoreActive, pitchDragArmed: view.pitchDragArmed, structural: view.structural,
      resumeLabel: 'Resume bar 20', inspectionMatchesSelection: view.inspectionMatchesSelection, moreExpanded: view.moreExpanded,
    };
    for (const staff of score.staves) for (const measure of staff.measures) for (const [index, voice] of measure.voices.entries()) {
      if (!voice.events.some(event => event.id === events[0]?.id)) continue;
      return {
        ...base, staffLabel: staff.label, measureNumber: measure.number, voiceNumber: index + 1,
        remaining: subtract(meterTime(measure.meter), voice.events.reduce((time, event) => add(time, event.time), rational(0))),
        tuplets: voice.tuplets,
      };
    }
    return base;
  };
  const execute = vi.fn((command: AuthorCommand) => { session.execute(command); });
  const openProperties = vi.fn(() => {});
  const openRelationships = vi.fn(() => {});
  const selectMore = vi.fn((enabled: boolean) => { view.selectMoreActive = enabled; });
  const preparePitchDrag = vi.fn(() => {});
  const cancelPitchDrag = vi.fn(() => {});
  const resume = vi.fn(() => {});
  const report = vi.fn((_message: string) => {});
  const showError = vi.fn((_message: string) => {});
  const success = vi.fn(() => {});
  const afterSurfaceClose = vi.fn(() => {});
  const controls = new SelectionControls({
    state, execute, openProperties, openRelationships, selectMore, preparePitchDrag,
    cancelPitchDrag, resume, report, error: showError, afterSurfaceClose, ...(settings.observeSuccess ? { success } : {}),
  }, root);
  const refresh = () => { if (view.autoRefresh) controls.refresh(); };
  session.addEventListener('change', refresh);
  cleanups.push(() => { session.removeEventListener('change', refresh); controls.dispose(); });
  const select = (ids: string[], markingId?: string) => {
    view.ids = [...ids]; view.activeMarkingId = markingId; view.selectionVersion += 1;
    session.select(ids[0]); controls.refresh();
  };
  const event = (id = view.ids[0]): MusicEvent => {
    const found = session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])))
      .find(item => item.id === id);
    if (!found) throw new Error(`Missing accepted event ${id}`);
    return found;
  };
  const open = (name: SurfaceName) => {
    const trigger = localControl<HTMLButtonElement>(`selection-${name}`);
    trigger.focus(); trigger.click();
    // Happy DOM does not execute the browser's declarative popover default.
    nativeSurfaces.get(name)?.show(trigger);
  };
  const isOpen = (name: SurfaceName): boolean => nativeSurfaces.get(name)?.isOpen() ?? !localControl(`selection-${name}-chooser`).hidden;
  return {
    controls, session, view, state, select, event, open, isOpen, nativeSurfaces,
    execute, openProperties, openRelationships, selectMore, preparePitchDrag, cancelPitchDrag, resume, report, showError, success, afterSurfaceClose,
    toolbar: localControl('selection-controls'), panel: (name: SurfaceName) => localControl(`selection-${name}-chooser`),
    button: (id: string) => localControl<HTMLButtonElement>(id), field: (id: string) => localControl<HTMLSelectElement>(id),
    error: (name: SurfaceName) => localControl(`selection-${name}-error`),
  };
}

function change(field: HTMLSelectElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function key(element: HTMLElement, value: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

/** Deliver the native button activation omitted by Happy DOM, unless the handler owns it. */
function activateKey(button: HTMLButtonElement, value: ' ' | 'Enter'): KeyboardEvent {
  const down = key(button, value);
  if (value === 'Enter' && !down.defaultPrevented) button.click();
  const up = new KeyboardEvent('keyup', { key: value, bubbles: true, composed: true, cancelable: true });
  button.dispatchEvent(up);
  if (value === ' ' && !down.defaultPrevented && !up.defaultPrevented) button.click();
  return down;
}

function pointer(element: HTMLElement, type: 'pointerdown' | 'pointerup' | 'pointercancel'): void {
  element.dispatchEvent(new PointerEvent(type, {
    pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
    bubbles: true, composed: true, cancelable: true,
  }));
}

function visible(element: HTMLElement): boolean { return element.closest('[hidden]') === null; }

function described(element: HTMLElement): string {
  const descriptions = (element.getAttribute('aria-describedby') ?? '').split(/\s+/)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
  return `${element.getAttribute('title') ?? ''} ${descriptions}`;
}

afterEach(async () => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  positionerMocks.records.splice(0); positionerMocks.create.mockClear();
  await releaseAuthorFixture();
});

describe('isolated SelectionControls roots', () => {
  it.each(['element', 'shadow'] as const)('applies only its %s-root selection, restores chooser focus, and disposes its handlers', kind => {
    const global = fixture();
    const globalProject = global.session.project;
    const globalDuration = global.field('selection-duration');
    const globalDurationValue = globalDuration.value;
    const globalValue = global.button('selection-value');
    const host = document.createElement('section');
    document.body.append(host);
    const root = kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host;
    const mount = document.createElement('section');
    root.append(mount);
    const scoped = fixture(scoreHtml(note('n1', 'pitch="B4" duration="eighth"')), { mount, root });
    const duration = scoped.field('selection-duration');
    const invoker = scoped.button('selection-value');
    const focused = () => root instanceof ShadowRoot ? root.activeElement : document.activeElement;

    expect(control('selection-value')).toBe(globalValue);
    expect(invoker).not.toBe(globalValue);
    expect(duration).not.toBe(globalDuration);
    scoped.open('value');
    duration.focus();
    expect(focused()).toBe(duration);
    if (kind === 'shadow') expect(document.activeElement).toBe(host);
    change(duration, 'half');
    expect(scoped.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1'],
      change: { property: 'duration', value: 'half' } });
    expect(scoped.event()).toMatchObject({ duration: 'half', pitches: [{ step: 'B', octave: 4, alter: 0 }] });
    expect(scoped.session.revision).toBe(1);
    expect(scoped.isOpen('value')).toBe(true);
    expect(focused()).toBe(duration);
    expect(global.session.project).toEqual(globalProject);
    expect(global.session.revision).toBe(0);
    expect(global.execute).not.toHaveBeenCalled();
    expect(globalDuration.value).toBe(globalDurationValue);
    expect(global.isOpen('value')).toBe(false);
    expect(globalValue.getAttribute('aria-expanded')).toBe('false');

    const restoreFocus = vi.spyOn(invoker, 'focus');
    expect(scoped.controls.cancel('geometry')).toBe(true);
    expect(scoped.isOpen('value')).toBe(false);
    expect(focused()).toBe(invoker);
    expect(restoreFocus).toHaveBeenLastCalledWith({ preventScroll: true });

    scoped.open('value');
    globalValue.focus();
    expect(scoped.controls.cancel('geometry')).toBe(false);
    expect(document.activeElement).toBe(globalValue);
    expect(scoped.isOpen('value')).toBe(false);

    scoped.open('value');
    const accepted = scoped.session.project;
    scoped.controls.dispose();
    scoped.execute.mockClear();
    scoped.openProperties.mockClear();
    change(duration, 'quarter');
    scoped.button('selection-sharp').click();
    scoped.button('edit-selected-event').click();
    invoker.click();
    expect(scoped.execute).not.toHaveBeenCalled();
    expect(scoped.openProperties).not.toHaveBeenCalled();
    expect(scoped.session.project).toEqual(accepted);
    expect(scoped.session.revision).toBe(1);
    expect(scoped.controls.interacting).toBe(false);
    expect(scoped.isOpen('value')).toBe(false);
    expect(global.session.project).toEqual(globalProject);
    expect(global.execute).not.toHaveBeenCalled();
  });

  it.each(['element', 'shadow'] as const)('preserves focus handed outside its %s root while a chooser closes', kind => {
    const global = fixture();
    const host = document.createElement('section');
    document.body.append(host);
    const root = kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host;
    const mount = document.createElement('section');
    root.append(mount);
    const scoped = fixture(scoreHtml(), { mount, root });
    scoped.open('value');
    scoped.field('selection-duration').focus();
    const outside = global.button('selection-value');
    scoped.afterSurfaceClose.mockImplementation(() => { outside.focus(); });

    expect(scoped.controls.cancel('geometry')).toBe(true);
    expect(scoped.isOpen('value')).toBe(false);
    expect(scoped.afterSurfaceClose).toHaveBeenCalledOnce();
    expect(document.activeElement === outside, 'The closing callback keeps its new focus owner.').toBe(true);
    expect(scoped.execute).not.toHaveBeenCalled();
    expect(global.execute).not.toHaveBeenCalled();
  });
});

describe('SelectionControls accepted values and musical transactions', () => {
  it('refreshes a selected target without opening controls, moving focus, or changing source and history', () => {
    const h = fixture();
    const before = h.session.project;
    const score = control('score-editor'); score.focus();
    h.controls.refresh(); h.select(['n2']); h.controls.refresh();
    expect(document.activeElement).toBe(score);
    expect(surfaceNames.every(name => !h.isOpen(name))).toBe(true);
    expect(h.controls.interacting).toBe(false);
    expect(h.session.project).toEqual(before);
    expect(h.session.canUndo).toBe(false); expect(h.session.revision).toBe(0);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.openProperties).not.toHaveBeenCalled();
    expect(control('selection-controls-context').textContent).toContain('Flute');
    expect(control('selection-controls-context').textContent).toContain('12');
  });

  it('enhances every choice as a labelled native select and exposes the complete alteration vocabulary', () => {
    const h = fixture();
    const fields = surfaceNames.flatMap(name => [...h.panel(name).querySelectorAll('select')]);
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) {
      expect(field.firstElementChild?.tagName).toBe('BUTTON');
      expect(field.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
      expect(field.classList.contains('author-select')).toBe(true);
      expect([...field.options].every(option => option.hasAttribute('value'))).toBe(true);
      expect(document.querySelector(`label[for="${field.id}"]`) ?? field.getAttribute('aria-label') ?? field.getAttribute('aria-labelledby')).not.toBeNull();
    }
    for (const id of ['selection-alteration', 'selection-shared-alteration']) {
      const values = [...h.field(id).options].filter(option => option.value !== '').map(option => Number(option.value));
      expect(values.sort((a, b) => a - b)).toEqual([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
    }
  });

  it('does not report Natural for a quarter-tone outside the three shortcut radios', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Ftqs4" duration="quarter"')));
    for (const id of ['selection-flat', 'selection-natural', 'selection-sharp']) expect(h.button(id).getAttribute('aria-pressed')).toBe('false');
    h.open('pitch');
    expect(h.field('selection-alteration').value).toBe('1.5');
    expect(h.session.canUndo).toBe(false);
  });

  it('sets a single absolute accidental with one batch transaction while preserving letter, octave, and display policy', () => {
    const h = fixture(); const before = h.event();
    const node = h.session.source.querySelector('#n1');
    h.button('selection-sharp').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'alter', value: 1, ties: 'reject' } });
    expect(h.event()).toEqual({ ...before, pitches: before.pitches.map(pitch => ({ ...pitch, alter: 1 })) });
    expect(h.session.source.querySelector('#n1')).toBe(node);
    expect(node?.getAttribute('accidental-display')).toBe('courtesy');
    expect(node?.getAttribute('data-user')).toBe('keep');
    expect(h.session.revision).toBe(1); expect(h.button('selection-sharp').getAttribute('aria-pressed')).toBe('true');
    h.session.undo(); expect(h.event()).toEqual(before); expect(h.session.canUndo).toBe(false);
  });

  it('changes written value without reading the insertion recipe or unfinished pitch fields', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Fqs4" duration="eighth" dots="1" accidental-display="always"')));
    const entryDuration = control<HTMLSelectElement>('event-duration'); entryDuration.value = 'breve';
    const entryDots = control<HTMLSelectElement>('event-dots'); entryDots.value = '3';
    const entryPitch = control<HTMLInputElement>('event-pitch'); entryPitch.value = 'unfinished recipe';
    const selectedPitch = control<HTMLInputElement>('selected-pitch'); selectedPitch.value = 'unfinished draft';
    const getters = [entryDuration, entryDots, entryPitch, selectedPitch].map(element => vi.spyOn(element, 'value', 'get'));
    const before = h.event();
    h.open('value'); change(h.field('selection-duration'), 'quarter');
    expect(getters.every(getter => getter.mock.calls.length === 0)).toBe(true);
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'duration', value: 'quarter' } });
    expect(h.event()).toMatchObject({ duration: 'quarter', dots: 1, pitches: before.pitches, stem: before.stem, beam: before.beam });
    expect(entryDuration.value).toBe('breve'); expect(entryDots.value).toBe('3'); expect(entryPitch.value).toBe('unfinished recipe');
    expect(selectedPitch.value).toBe('unfinished draft');
  });

  it('keeps an open chooser and its focused field bound through its own synchronous source refresh', () => {
    const h = fixture(); h.open('value');
    const duration = h.field('selection-duration'); duration.focus();
    change(duration, 'eighth');
    expect(h.isOpen('value')).toBe(true); expect(h.controls.interacting).toBe(true);
    expect(document.activeElement).toBe(duration); expect(duration.value).toBe('eighth');
    change(h.field('selection-dots'), '1');
    expect(h.event()).toMatchObject({ duration: 'eighth', dots: 1 });
    expect(h.execute).toHaveBeenCalledTimes(2); expect(h.session.revision).toBe(2);
    expect(h.error('value').textContent?.trim()).toBe('');
  });

  it('shows the accepted written value and dots on Value before the chooser is opened', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="F4" duration="quarter" dots="1"')));
    const value = h.button('selection-value');
    expect(value.textContent).toBe('Quarter ·'); expect(value.getAttribute('aria-label')).toBe('Value: Quarter · 1 dot');
    h.open('value'); change(h.field('selection-duration'), 'eighth');
    expect(value.textContent).toBe('Eighth ·'); expect(value.getAttribute('aria-label')).toBe('Value: Eighth · 1 dot');
    change(h.field('selection-dots'), '2');
    expect(value.textContent).toBe('Eighth ··'); expect(value.getAttribute('aria-label')).toBe('Value: Eighth · 2 dots');
    change(h.field('selection-dots'), '0');
    expect(value.textContent).toBe('Eighth'); expect(value.getAttribute('aria-label')).toBe('Value: Eighth');
  });

  it.each([
    ['sixteenth', 0, '16th', 'Sixteenth'],
    ['sixteenth', 1, '16th ·', 'Sixteenth · 1 dot'],
    ['sixteenth', 2, '16th ··', 'Sixteenth · 2 dots'],
    ['sixteenth', 3, '16th ···', 'Sixteenth · 3 dots'],
    ['thirty-second', 2, '32nd ··', '32nd · 2 dots'],
    ['sixty-fourth', 3, '64th ···', '64th · 3 dots'],
    ['128th', 3, '128th ···', '128th · 3 dots'],
  ] as const)('keeps compact %s with %s dots complete in its accessible name and native chooser', (duration, dots, compact, complete) => {
    const h = fixture(scoreHtml(note('n1', `pitch="F4" duration="${duration}" dots="${dots}"`)));
    const before = h.session.project; const value = h.button('selection-value');
    expect(value.textContent).toBe(compact); expect(value.getAttribute('aria-label')).toBe(`Value: ${complete}`);
    h.open('value');
    expect(h.field('selection-duration').value).toBe(duration); expect(h.field('selection-dots').value).toBe(String(dots));
    expect(h.field('selection-duration').selectedOptions[0]?.textContent).toBe(complete.split(' · ')[0]);
    expect(h.field('selection-dots').selectedOptions[0]?.textContent).toBe(dots ? `${dots} dot${dots === 1 ? '' : 's'}` : 'None');
    expect(h.session.project).toEqual(before); expect(h.session.canUndo).toBe(false); expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps a compact mixed label truthful while naming the common duration and differing dots accessibly', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="sixteenth"') + note('n2', 'pitch="D4" duration="sixteenth" dots="2"')), { ids: ['n1', 'n2'] });
    const value = h.button('selection-value');
    expect(value.textContent).toBe('Mixed'); expect(value.getAttribute('aria-label')).toBe('Value for 2 selected events: Sixteenth · mixed dots');
    h.open('value'); expect(h.field('selection-duration').value).toBe('sixteenth'); expect(h.field('selection-dots').value).toBe('');
    expect(h.field('selection-dots').selectedOptions[0]?.textContent).toBe('Mixed'); expect(h.session.canUndo).toBe(false);
  });

  it('leaves source and Undo unchanged for a shared-value no-op', () => {
    const h = fixture(); const before = h.session.project;
    h.open('value'); change(h.field('selection-duration'), 'quarter');
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    expect(h.isOpen('value')).toBe(true);
  });

  it('reports explicit accepted property actions and no-ops, but never refresh or validation failure, as success', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''), { observeSuccess: true });
    h.controls.refresh(); h.select(['n1']); expect(h.success).not.toHaveBeenCalled();
    h.open('value'); expect(h.success).not.toHaveBeenCalled();
    change(h.field('selection-duration'), 'half');
    expect(h.success).toHaveBeenCalledOnce(); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    change(h.field('selection-duration'), 'whole');
    expect(h.success).toHaveBeenCalledOnce(); expect(h.showError).toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    change(h.field('selection-duration'), 'quarter');
    expect(h.success).toHaveBeenCalledTimes(2); expect(h.session.revision).toBe(1);
    h.controls.refresh(); h.session.undo();
    expect(h.success).toHaveBeenCalledTimes(2); expect(h.event().duration).toBe('half');
  });

  it('rejects an overflowing value atomically and restores the accepted field beside a local error', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''));
    const before = h.session.project; h.open('value');
    const field = h.field('selection-duration'); field.focus(); change(field, 'whole');
    expect(h.session.project).toEqual(before); expect(h.session.canUndo).toBe(false); expect(h.session.revision).toBe(0);
    expect(field.value).toBe('half'); expect(document.activeElement).toBe(field);
    expect(h.error('value').textContent).toMatch(/exceed|excess|overflow|space|capacity|long/i);
    expect(h.isOpen('value')).toBe(true);
  });

  it('announces a chooser failure once while retaining static footer recovery text', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''));
    h.open('value'); change(h.field('selection-duration'), 'whole');
    const local = h.error('value'); const footer = control('selection-controls-error');
    expect(local.textContent?.trim()).not.toBe(''); expect(local.getAttribute('role')).toBe('alert');
    expect(footer.textContent).toBe(local.textContent);
    expect(footer.getAttribute('role')).toBeNull(); expect(footer.getAttribute('aria-live')).toBeNull();
    const announced = [footer, ...surfaceNames.map(name => h.error(name))]
      .filter(message => visible(message) && message.textContent?.trim() && ['alert', 'status'].includes(message.getAttribute('role') ?? ''));
    expect(announced).toEqual([local]);
    h.button('close-selection-value').click();
    expect(h.isOpen('value')).toBe(false); expect(footer.textContent?.trim()).not.toBe('');
  });

  it('keeps full rejection details nonlive in Review and delegates compact feedback to the workspace', () => {
    const h = fixture(); h.execute.mockImplementationOnce(() => { throw new Error('The selected note could not be changed.'); });
    h.button('selection-sharp').click();
    const detail = control('selection-controls-error');
    expect(detail.closest('#workspace-review')).not.toBeNull();
    expect(detail.textContent).toBe('The selected note could not be changed.');
    expect(detail.getAttribute('role')).toBeNull(); expect(detail.getAttribute('aria-live')).toBeNull();
    expect(h.showError).toHaveBeenCalledExactlyOnceWith('The selected note could not be changed.');
    h.controls.refresh(); expect(detail.getAttribute('role')).toBeNull(); expect(detail.getAttribute('aria-live')).toBeNull();
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it.each([
    [false, 'Close button', 'value'],
    [false, 'Escape', 'pitch'],
    [false, 'programmatic close', 'shared'],
    [true, 'native dismissal', 'pitch'],
    [true, 'programmatic close', 'value'],
    [true, 'explicit cancellation', 'shared'],
  ] as const)('settles local feedback before notifying the workspace on native=%s %s of %s', (native, route, name) => {
    const h = fixture(scoreHtml(), { native, ids: name === 'shared' ? ['n1', 'n2'] : ['n1'], observeSuccess: true });
    const before = h.session.project; const source = h.session.source; const cursor = h.session.cursor; const selection = h.session.selectionId;
    const message = 'The requested musical edit was rejected.';
    h.execute.mockImplementationOnce(() => { throw new Error(message); });
    h.open(name);
    change(h.field(name === 'pitch' ? 'selection-alteration' : name === 'shared' ? 'selection-shared-duration' : 'selection-duration'), name === 'pitch' ? '1' : 'whole');
    expect(h.error(name).textContent).toBe(message); expect(h.error(name).hidden).toBe(false);
    expect(h.error(name).getAttribute('role')).toBe('alert'); expect(h.isOpen(name)).toBe(true);
    h.controls.refresh(); expect(h.afterSurfaceClose).not.toHaveBeenCalled();
    const states: unknown[] = [];
    h.afterSurfaceClose.mockImplementation(() => { states.push({
      interacting: h.controls.interacting, open: h.isOpen(name),
      local: h.error(name).textContent, localHidden: h.error(name).hidden,
      detail: control('selection-controls-error').textContent,
    }); });
    if (route === 'Close button') h.button('close-selection-value').click();
    else if (route === 'Escape') { const close = h.button('close-selection-pitch'); close.focus(); key(close, 'Escape'); }
    else if (route === 'native dismissal') h.nativeSurfaces.get(name)!.hide();
    else if (route === 'explicit cancellation') h.controls.cancel('Surface geometry changed.');
    else h.controls.close();
    expect(states).toEqual([{ interacting: false, open: false, local: '', localHidden: true, detail: message }]);
    expect(h.afterSurfaceClose).toHaveBeenCalledOnce();
    expect(control('selection-controls-error').hidden).toBe(false); expect(control('selection-controls-error').getAttribute('role')).toBeNull();
    h.controls.close(); h.controls.refresh(); expect(h.afterSurfaceClose).toHaveBeenCalledOnce();
    expect(h.session.project).toEqual(before); expect(h.session.source).toBe(source); expect(h.session.cursor).toEqual(cursor);
    expect(h.session.selectionId).toBe(selection); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.showError).toHaveBeenCalledExactlyOnceWith(message);
    expect(h.success).not.toHaveBeenCalled(); expect(h.report).not.toHaveBeenCalled();
    h.open(name); expect(h.isOpen(name)).toBe(true); expect(h.error(name).textContent).toBe(''); expect(h.error(name).hidden).toBe(true);
    expect(control('selection-controls-error').textContent).toBe(message); expect(h.afterSurfaceClose).toHaveBeenCalledOnce();
    h.controls.close(); expect(h.afterSurfaceClose).toHaveBeenCalledTimes(2);
    h.controls.dispose(); expect(h.afterSurfaceClose).toHaveBeenCalledTimes(2);
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('keeps a late native field failure in Review without reactivating the closed chooser alert', () => {
    const h = fixture(scoreHtml(), { native: true }); h.open('value'); const field = h.field('selection-duration');
    h.select(['n2']); expect(h.isOpen('value')).toBe(false); expect(h.afterSurfaceClose).toHaveBeenCalledOnce();
    const before = h.session.project; const cursor = h.session.cursor;
    change(field, 'whole');
    expect(control('selection-controls-error').textContent).toMatch(/changed|current/i);
    expect(h.showError).toHaveBeenCalledOnce(); expect(h.error('value').textContent).toBe(''); expect(h.error('value').hidden).toBe(true);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.cursor).toEqual(cursor);
    expect(h.session.selectionId).toBe('n2'); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    h.open('value'); expect(h.isOpen('value')).toBe(true); expect(h.error('value').textContent).toBe(''); expect(h.error('value').hidden).toBe(true);
  });

  it.each([false, true])('notifies once for an actual open chooser closed by disposal with native=%s', native => {
    const h = fixture(scoreHtml(), { native }); h.open('value'); const before = h.session.project;
    h.execute.mockImplementationOnce(() => { throw new Error('Keep this rejection in Review.'); });
    change(h.field('selection-duration'), 'whole');
    h.controls.dispose();
    expect(h.afterSurfaceClose).toHaveBeenCalledOnce(); expect(h.isOpen('value')).toBe(false); expect(h.controls.interacting).toBe(false);
    expect(h.error('value').textContent).toBe(''); expect(h.error('value').hidden).toBe(true);
    expect(control('selection-controls-error').textContent).toBe('Keep this rejection in Review.');
    h.controls.dispose(); h.controls.close(); h.controls.refresh(); expect(h.afterSurfaceClose).toHaveBeenCalledOnce();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('clears feedback without notifying callbacks, changing music, or closing an open native chooser', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''), { native: true, observeSuccess: true });
    h.open('value'); const duration = h.field('selection-duration'); duration.focus(); change(duration, 'whole');
    const failure = h.error('value').textContent; expect(failure?.trim()).not.toBe('');
    h.controls.refresh(); expect(h.error('value').textContent).toBe(failure);
    const before = h.session.project; const revision = h.session.revision; const selection = h.session.selectionId;
    const cursor = h.session.cursor; const source = h.session.source; const ids = [...h.view.ids];
    const calls = { execute: h.execute.mock.calls.length, success: h.success.mock.calls.length, error: h.showError.mock.calls.length, report: h.report.mock.calls.length };
    const changed = vi.fn(() => {}); h.session.addEventListener('change', changed);
    cleanups.push(() => h.session.removeEventListener('change', changed));

    h.controls.clearFeedback(); h.controls.clearFeedback();

    const footer = control('selection-controls-error'); expect(footer.textContent).toBe(''); expect(footer.hidden).toBe(true);
    for (const name of surfaceNames) { expect(h.error(name).textContent).toBe(''); expect(h.error(name).hidden).toBe(true); }
    expect(h.toolbar.dataset.hasError).not.toBe('true'); expect(h.isOpen('value')).toBe(true); expect(document.activeElement).toBe(duration);
    expect(h.session.project).toEqual(before); expect(h.session.source).toBe(source); expect(h.session.revision).toBe(revision);
    expect(h.session.selectionId).toBe(selection); expect(h.session.cursor).toEqual(cursor); expect(h.view.ids).toEqual(ids);
    expect(h.session.canUndo).toBe(false); expect(changed).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(calls.execute); expect(h.success).toHaveBeenCalledTimes(calls.success);
    expect(h.showError).toHaveBeenCalledTimes(calls.error); expect(h.report).toHaveBeenCalledTimes(calls.report);
    h.controls.refresh(); expect(footer.textContent).toBe(''); expect(h.error('value').textContent).toBe('');
  });

  it('shows Mixed for differing duration, dots, and alteration without checking a shortcut', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Fb4" duration="quarter"') + note('n2', 'pitch="Fqs4" duration="eighth" dots="1"')), { ids: ['n1', 'n2'] });
    h.open('shared');
    for (const id of ['selection-shared-duration', 'selection-shared-dots', 'selection-shared-alteration']) {
      expect(h.field(id).value).toBe(''); expect(h.field(id).selectedOptions[0]?.textContent).toMatch(/mixed/i);
    }
    for (const id of ['selection-flat', 'selection-natural', 'selection-sharp']) expect(h.button(id).getAttribute('aria-pressed')).toBe('false');
    expect(h.session.revision).toBe(0);
  });

  it('edits exact disjoint membership once without including the intervening event', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n3'] }); const middle = h.event('n2'); const before = h.session.project;
    const middleNode = h.session.source.querySelector('#n2')!; const middleSource = middleNode.outerHTML;
    h.open('shared'); change(h.field('selection-shared-duration'), 'eighth');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n3'], change: { property: 'duration', value: 'eighth' } });
    expect(h.event('n1').duration).toBe('eighth'); expect(h.event('n3').duration).toBe('eighth');
    // The preceding note is shorter, so the untouched event's derived onset moves.
    expect(h.event('n2')).toEqual({ ...middle, onset: rational(1, 8) });
    expect(h.session.source.querySelector('#n2')).toBe(middleNode); expect(middleNode.outerHTML).toBe(middleSource);
    expect(h.session.revision).toBe(1); h.session.undo(); expect(h.session.project.sourceHtml).toBe(before.sourceHtml); expect(h.session.canUndo).toBe(false);
  });

  it('applies shared dots without replacing each member’s different written value or tuplet ratio', () => {
    const events = `<music-tuplet id="triplet" actual="3" normal="2">${note('n1', 'pitch="C4" duration="eighth"')}${note('n2', 'pitch="E4" duration="quarter"')}</music-tuplet>`;
    const h = fixture(scoreHtml(events), { ids: ['n1', 'n2'] });
    const before = [h.event('n1'), h.event('n2')]; const tuplet = h.session.source.querySelector('#triplet');
    h.open('shared'); change(h.field('selection-shared-dots'), '1');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n2'], change: { property: 'dots', value: 1 } });
    expect([h.event('n1').duration, h.event('n2').duration]).toEqual(before.map(event => event.duration));
    expect([h.event('n1').dots, h.event('n2').dots]).toEqual([1, 1]);
    expect([h.event('n1').tupletIds, h.event('n2').tupletIds]).toEqual(before.map(event => event.tupletIds));
    expect(h.session.source.querySelector('#triplet')).toBe(tuplet); expect(tuplet?.getAttribute('actual')).toBe('3');
    expect(h.session.revision).toBe(1);
  });

  it('keeps shared stem and accidental display edits separate from pitch and rhythm', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n3'] }); const before = [h.event('n1'), h.event('n3')];
    h.open('shared'); change(h.field('selection-stem'), 'up'); change(h.field('selection-accidental-display'), 'always');
    expect(h.execute.mock.calls.map(([command]) => command)).toEqual([
      { type: 'set-events-property', eventIds: ['n1', 'n3'], change: { property: 'stem', value: 'up' } },
      { type: 'set-events-property', eventIds: ['n1', 'n3'], change: { property: 'accidentalDisplay', value: 'always' } },
    ]);
    for (const [index, id] of ['n1', 'n3'].entries()) {
      expect(h.event(id)).toMatchObject({ duration: before[index].duration, dots: before[index].dots, stem: 'up' });
      expect(h.event(id).pitches.map(({ step, octave, alter }) => ({ step, octave, alter })))
        .toEqual(before[index].pitches.map(({ step, octave, alter }) => ({ step, octave, alter })));
      expect(h.session.source.querySelector(`#${id}`)?.getAttribute('accidental-display')).toBe('always');
    }
    expect(h.session.revision).toBe(2);
  });

  it('adds only missing shared articulations, preserves existing IDs, and removes them explicitly', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="quarter"', '<music-articulation id="accent" type="accent"></music-articulation>') + note('n2')), { ids: ['n1', 'n2'] });
    const original = h.session.source.querySelector('#accent');
    h.open('shared'); change(h.field('selection-articulation'), 'accent');
    expect(h.button('selection-add-articulation').getAttribute('aria-label') ?? h.button('selection-add-articulation').textContent).toMatch(/add.*all|add.*2/i);
    h.button('selection-add-articulation').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n2'], change: { property: 'articulation', value: 'accent', present: true } });
    expect(h.session.source.querySelector('#accent')).toBe(original);
    expect([h.event('n1'), h.event('n2')].every(event => event.markings?.some(mark => mark.kind === 'articulation' && mark.type === 'accent'))).toBe(true);
    h.button('selection-remove-articulation').click();
    expect(h.execute).toHaveBeenLastCalledWith({ type: 'set-events-property', eventIds: ['n1', 'n2'], change: { property: 'articulation', value: 'accent', present: false } });
    expect([h.event('n1'), h.event('n2')].every(event => !event.markings?.some(mark => mark.kind === 'articulation' && mark.type === 'accent'))).toBe(true);
    expect(h.session.revision).toBe(2);
  });

  it('keeps focus usable inside Shared when successful articulation actions disable themselves', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n2'] });
    h.open('shared'); change(h.field('selection-articulation'), 'accent');
    for (const [actionId, pairedId] of [
      ['selection-add-articulation', 'selection-remove-articulation'],
      ['selection-remove-articulation', 'selection-add-articulation'],
    ] as const) {
      const action = h.button(actionId); expect(action.disabled).toBe(false);
      action.focus(); expect(document.activeElement).toBe(action); action.click();
      expect(action.disabled).toBe(true); expect(h.isOpen('shared')).toBe(true);
      const focused = document.activeElement as HTMLElement;
      expect([h.button(pairedId), h.field('selection-articulation')]).toContain(focused);
      expect(h.panel('shared').contains(focused)).toBe(true);
      expect(focused.matches(':disabled')).toBe(false); expect(visible(focused)).toBe(true);
      expect(focused.isConnected).toBe(true); expect(focused.tabIndex).toBeGreaterThanOrEqual(0);
    }
    expect(h.execute).toHaveBeenCalledTimes(2); expect(h.session.revision).toBe(2);
  });
});

describe('SelectionControls complete accepted single-note pitch', () => {
  it('shows the accepted letter and octave using labelled customizable native selects', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Btqf-1" duration="quarter"')));
    const before = h.session.project; h.open('pitch');
    const step = h.field('selection-note-step'); const octave = h.field('selection-note-octave');
    expect(step.value).toBe('B'); expect(octave.value).toBe('-1'); expect(h.field('selection-alteration').value).toBe('-1.5');
    expect([...step.options].map(option => option.value)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect([...octave.options].map(option => option.value)).toEqual(Array.from({ length: 11 }, (_, index) => String(index - 1)));
    for (const field of [step, octave]) {
      expect(field.firstElementChild?.tagName).toBe('BUTTON');
      expect(field.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
      expect(field.classList.contains('author-select')).toBe(true);
      expect(document.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
    }
    expect(h.button('selection-pitch').getAttribute('aria-label')).toContain('B three-quarter-flat -1');
    expect(h.session.project).toEqual(before); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
  });

  it.each([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2])('changes the accepted letter while preserving alteration %s and every other note property', alter => {
    const spelling = pitchText({ step: 'F', octave: 4, alter, display: 'courtesy' });
    const h = fixture(scoreHtml(note('n1', `pitch="${spelling}" duration="quarter" dots="1" accidental-display="courtesy" stem="down" beam="none" data-user="keep"`, '<music-articulation id="mark" type="accent"></music-articulation>')));
    const before = h.event(); const node = h.session.source.querySelector('#n1'); const mark = h.session.source.querySelector('#mark');
    const entry = control<HTMLInputElement>('event-pitch'); entry.value = 'unfinished entry';
    const draft = control<HTMLInputElement>('selected-pitch'); draft.value = 'unfinished Properties';
    const entryRead = vi.spyOn(entry, 'value', 'get'); const draftRead = vi.spyOn(draft, 'value', 'get');
    h.open('pitch'); const step = h.field('selection-note-step'); step.focus(); change(step, 'G');
    const next = { ...before.pitches[0], step: 'G' as const };
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-pitch', eventId: 'n1', pitch: pitchText(next), ties: 'reject' });
    expect(h.event()).toEqual({ ...before, pitches: [next] });
    expect(h.session.source.querySelector('#n1')).toBe(node); expect(h.session.source.querySelector('#mark')).toBe(mark);
    expect(node?.getAttribute('data-user')).toBe('keep'); expect(node?.getAttribute('accidental-display')).toBe('courtesy');
    expect(entryRead).not.toHaveBeenCalled(); expect(draftRead).not.toHaveBeenCalled();
    expect(entry.value).toBe('unfinished entry'); expect(draft.value).toBe('unfinished Properties');
    expect(step.value).toBe('G'); expect(h.field('selection-note-octave').value).toBe('4'); expect(h.field('selection-alteration').value).toBe(String(alter));
    expect(h.isOpen('pitch')).toBe(true); expect(document.activeElement).toBe(step); expect(h.session.revision).toBe(1);
    h.session.undo(); expect(h.event()).toEqual(before); expect(h.session.canUndo).toBe(false);
  });

  it.each([-1, 0, 5, 9])('changes octave to %s from accepted pitch without borrowing uncommitted chooser values', octave => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Etqs4" duration="quarter" accidental-display="always"')));
    const before = h.event(); h.open('pitch');
    h.field('selection-note-step').value = 'B'; h.field('selection-alteration').value = '-2';
    change(h.field('selection-note-octave'), String(octave));
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-pitch', eventId: 'n1', pitch: `Etqs${octave}`, ties: 'reject' });
    expect(h.event()).toEqual({ ...before, pitches: [{ ...before.pitches[0], octave }] });
    expect(h.field('selection-note-step').value).toBe('E'); expect(h.field('selection-alteration').value).toBe('1.5');
    expect(h.session.revision).toBe(1); h.session.undo(); expect(h.event()).toEqual(before); expect(h.session.canUndo).toBe(false);
  });

  it('does not execute or consume Redo when accepted letter and octave are chosen again', () => {
    const h = fixture(scoreHtml(), { observeSuccess: true });
    h.button('selection-sharp').click(); h.session.undo(); h.execute.mockClear(); h.success.mockClear();
    const before = h.session.project; const revision = h.session.revision; h.open('pitch');
    change(h.field('selection-note-step'), 'F'); change(h.field('selection-note-octave'), '4');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.success).toHaveBeenCalledTimes(2);
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(revision); expect(h.session.canRedo).toBe(true); expect(h.session.canUndo).toBe(false);
  });

  it('restores the accepted pitch fields and focused control after a rejected pitch transaction', () => {
    const h = fixture(); h.open('pitch'); const before = h.session.project;
    h.execute.mockImplementationOnce(() => { throw new Error('The source transaction is no longer available.'); });
    const octave = h.field('selection-note-octave'); octave.focus(); change(octave, '5');
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    expect(octave.value).toBe('4'); expect(h.field('selection-note-step').value).toBe('F'); expect(document.activeElement).toBe(octave);
    expect(h.error('pitch').textContent).toContain('source transaction is no longer available'); expect(h.isOpen('pitch')).toBe(true);
    change(octave, '5'); expect(h.event().pitches[0].octave).toBe(5); expect(h.session.revision).toBe(1); expect(h.error('pitch').textContent).toBe('');
  });

  it.each([['selection-note-step', 'H'], ['selection-note-octave', '10'], ['selection-note-octave', '3.5']] as const)('rejects an invalid delivered %s value %s without a command', (id, value) => {
    const h = fixture(); h.open('pitch'); const before = h.session.project; const field = h.field(id);
    const option = document.createElement('option'); option.value = value; option.textContent = value; field.append(option);
    change(field, value);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.canUndo).toBe(false);
    expect(field.value).toBe(id === 'selection-note-step' ? 'F' : '4'); expect(h.error('pitch').textContent?.trim()).not.toBe('');
  });

  it.each(['revision', 'membership', 'document', 'source', 'mode', 'entry'] as const)('rejects a delayed pitch choice after %s changes', context => {
    const h = fixture(); h.open('pitch'); const step = h.field('selection-note-step'); h.view.autoRefresh = false;
    if (context === 'revision') h.session.update('Title', draft => { draft.metadata.title = 'Changed elsewhere'; });
    else if (context === 'membership') h.view.ids = ['n1', 'n2'];
    else if (context === 'document') h.view.documentEpoch += 1;
    else if (context === 'source') h.session.setPendingSource('unfinished source');
    else if (context === 'mode') h.view.mode = 'read';
    else h.view.entryMode = true;
    const before = h.session.project; const revision = h.session.revision;
    change(step, 'G');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(revision);
    expect(h.event('n1').pitches[0].step).toBe('F'); expect(h.isOpen('pitch')).toBe(false);
  });

  it('keeps a held Properties draft out of ordinary palette pitch edits and guards its own invoker', () => {
    const h = fixture(); h.view.inspectionMatchesSelection = false; h.controls.refresh();
    const draft = control<HTMLInputElement>('selected-pitch'); draft.value = 'retained owner text';
    h.open('pitch'); change(h.field('selection-note-step'), 'G');
    expect(h.event().pitches[0].step).toBe('G'); expect(draft.value).toBe('retained owner text'); expect(h.openProperties).not.toHaveBeenCalled();
    h.controls.close(); h.button('properties-pitch').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.isOpen('pitch')).toBe(false); expect(h.execute).toHaveBeenCalledOnce(); expect(draft.value).toBe('retained owner text');
  });

  it('leaves native selector keys and Escape alone, and removes listeners on disposal', () => {
    const h = fixture(scoreHtml(), { native: true }); h.open('pitch'); const step = h.field('selection-note-step');
    step.focus();
    for (const value of ['ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Enter', 'Escape']) expect(key(step, value).defaultPrevented).toBe(false);
    const before = h.session.project; h.controls.dispose(); change(step, 'G');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
  });

  it.each([
    ['tied note', scoreHtml(note('n1', 'pitch="C4" duration="quarter" tie="start"') + note('n2', 'pitch="C4" duration="quarter" tie="end"')), ['n1']],
    ['chord', scoreHtml('<music-chord id="n1" pitches="C4 E4 G4" duration="quarter"></music-chord>'), ['n1']],
    ['road', scoreHtml('<music-road id="n1" direction="same" duration="quarter"></music-road>', 'incomplete', 'notation="three-roads"'), ['n1']],
    ['group', scoreHtml(), ['n1', 'n2']],
  ])('does not infer a single untied pitch for a %s', (_kind, html, ids) => {
    const h = fixture(html as string, { ids: ids as string[] }); const before = h.session.project;
    h.open('pitch');
    for (const [id, value] of [['selection-note-step', 'G'], ['selection-note-octave', '5']]) {
      const field = h.field(id); expect(field.disabled || !visible(field)).toBe(true); change(field, value);
    }
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.canUndo).toBe(false);
  });
});

describe('SelectionControls fixed musical slots', () => {
  it('keeps concise slot labels paired with complete accessible task names', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n3'] });
    expect(h.button('selection-shared').textContent).toBe('Shared');
    expect(h.button('selection-shared').getAttribute('aria-label')).toBe('Shared properties for 2 selected events');
    expect(h.button('selection-relationships').textContent).toBe('Relate');
    expect(h.button('selection-relationships').getAttribute('aria-label')).toBe('Relationships for 2 selected events');
    h.view.selectMoreActive = true; h.controls.refresh();
    expect(h.button('selection-shared').textContent).toBe('Actions');
    expect(h.button('selection-shared').getAttribute('aria-label')).toBe('Selection actions for 2 selected events');
    h.view.selectMoreActive = false; h.select([]); h.view.structural = { id: 'bar', kind: 'measure', label: 'Bar 12' }; h.controls.refresh();
    expect(h.button('selection-mark-edit').textContent).toBe('Edit');
    expect(h.button('selection-mark-edit').getAttribute('aria-label')).toBe('Edit measure: Bar 12');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
  });

  it('uses the three persistent musical owners and a separate fixed More invoker', () => {
    const h = fixture();
    for (const [slot, ids] of [
      ['selection-slot-1', ['selection-pitch', 'selection-shared', 'selection-mark-edit']],
      ['selection-slot-2', ['selection-value']],
      ['selection-slot-3', ['selection-attached-marks', 'selection-relationships']],
    ] as const) {
      const owner = control(slot);
      expect(owner.classList.contains('palette-slot')).toBe(true);
      for (const id of ids) expect(h.button(id).closest('.palette-slot')).toBe(owner);
    }
    expect(h.toolbar.contains(h.button('edit-selected-event'))).toBe(false);
    expect(h.button('edit-selected-event').closest('#palette-more-slot')).not.toBeNull();
  });

  it('retains inactive Pitch options, Value, and attached-mark controls with no selection', () => {
    const h = fixture(scoreHtml(), { ids: [] });
    for (const id of ['selection-pitch', 'selection-value', 'selection-attached-marks']) {
      expect(visible(h.button(id))).toBe(true); expect(h.button(id).disabled).toBe(true); expect(described(h.button(id)).trim()).not.toBe('');
    }
    expect(control('edit-selected-label').textContent).toBe('More'); expect(visible(h.button('edit-selected-event'))).toBe(true);
  });

  it('retains available correction actions during a rejection without moving their DOM owners', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''));
    const controls = ['selection-pitch', 'selection-value', 'selection-attached-marks', 'edit-selected-event'].map(id => h.button(id));
    const owners = controls.map(button => button.parentElement);
    h.open('value'); change(h.field('selection-duration'), 'whole');
    controls.forEach((button, index) => { expect(visible(button)).toBe(true); expect(button.disabled).toBe(false); expect(button.parentElement).toBe(owners[index]); });
    h.button('close-selection-value').click(); h.button('selection-sharp').click();
    expect(h.event().pitches[0].alter).toBe(1); expect(h.session.revision).toBe(1); expect(h.toolbar.dataset.hasError).toBe('false');
  });

  it('shows exact-set Mixed Value and applies a common value without retargeting the primary event', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n3'] }); const middle = h.session.source.querySelector('#n2')!.outerHTML;
    expect(visible(h.button('selection-value'))).toBe(true); expect(h.button('selection-value').disabled).toBe(false);
    expect(h.button('selection-value').textContent).toMatch(/mixed/i);
    h.open('value'); expect(h.isOpen('value')).toBe(true); expect(h.field('selection-duration').value).toBe('');
    change(h.field('selection-duration'), 'eighth');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n3'], change: { property: 'duration', value: 'eighth' } });
    expect(h.session.source.querySelector('#n2')!.outerHTML).toBe(middle); expect(h.session.revision).toBe(1);
  });

  it('keeps full-rest and structural Value slots inactive while exact open-slash span remains deliberate', () => {
    const h = fixture(scoreHtml('<music-rest id="n1" measure></music-rest>'));
    expect(visible(h.button('selection-value'))).toBe(true); expect(h.button('selection-value').disabled).toBe(true);
    h.select([]); h.view.structural = { id: 'bar', kind: 'measure', label: 'Bar 12' }; h.controls.refresh();
    expect(visible(h.button('selection-value'))).toBe(true); expect(h.button('selection-value').disabled).toBe(true);
    expect(visible(h.button('selection-mark-edit'))).toBe(true); expect(h.button('selection-mark-edit').disabled).toBe(false);
    h.button('selection-mark-edit').click(); expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ sourceId: 'bar', section: 'tools' });
  });

  it('opens current-event attached marks without toggling More, applying drafts, or altering selection', () => {
    const h = fixture(); const before = h.session.project; h.view.inspectionMatchesSelection = false; h.controls.refresh();
    const held = control<HTMLInputElement>('selected-pitch'); held.value = 'held draft A';
    h.button('selection-attached-marks').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'markings' });
    expect(held.value).toBe('held draft A'); expect(h.view.ids).toEqual(['n1']); expect(h.session.project).toEqual(before); expect(h.execute).not.toHaveBeenCalled();
  });

  it('does not retarget a captured attached-mark task when selection changes', () => {
    const h = fixture(); const button = h.button('selection-attached-marks');
    pointer(button, 'pointerdown'); h.select(['n2']); pointer(button, 'pointerup'); button.click();
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps More available in select-more and routes pitchless Options to exact event details', () => {
    const h = fixture(scoreHtml('<music-rhythm id="n1" duration="quarter"></music-rhythm>', 'incomplete', 'notation="rhythm"'));
    expect(h.button('selection-pitch').textContent).toBe('Options'); expect(visible(h.button('selection-pitch'))).toBe(true);
    h.button('selection-pitch').click(); expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'properties' });
    expect(h.isOpen('pitch')).toBe(false); expect(h.execute).not.toHaveBeenCalled();
    h.view.selectMoreActive = true; h.controls.refresh();
    expect(visible(h.button('edit-selected-event'))).toBe(true); expect(control('edit-selected-label').textContent).toBe('More');
  });

  it.each(['collecting', 'pitch-drag'] as const)('exits %s without clearing the selection; Done is only for pitch drag', mode => {
    const h = fixture(scoreHtml(), { ids: mode === 'collecting' ? ['n1', 'n3'] : ['n1'] });
    const value = h.button('selection-value'); const done = h.button('selection-done');
    const owner = control('selection-slot-2'); const ids = [...h.view.ids]; const before = h.session.project;
    expect(value.closest('.palette-slot')).toBe(owner); expect(done.closest('.selection-collection')).not.toBeNull();
    if (mode === 'collecting') h.view.selectMoreActive = true;
    else {
      h.view.pitchDragArmed = true;
      h.cancelPitchDrag.mockImplementation(() => { h.view.pitchDragArmed = false; });
    }
    h.controls.refresh();
    expect(visible(value)).toBe(false); expect(value.disabled).toBe(true);
    expect(visible(done)).toBe(mode === 'pitch-drag'); expect(done.disabled).toBe(mode !== 'pitch-drag');
    expect(h.toolbar.hidden).toBe(false); expect(visible(h.button('edit-selected-event'))).toBe(true);
    const third = h.button(mode === 'collecting' ? 'selection-relationships' : 'selection-attached-marks');
    expect(visible(third)).toBe(mode === 'collecting');
    if (mode === 'pitch-drag') {
      for (const id of ['selection-attached-marks', 'selection-relationships', 'selection-delete']) expect(visible(h.button(id))).toBe(false);
    }
    const finish = mode === 'collecting' ? h.button('selection-select-more') : done;
    finish.focus(); finish.click();
    expect(visible(done)).toBe(false); expect(visible(value)).toBe(true); expect(value.disabled).toBe(false);
    expect(value.closest('.palette-slot')).toBe(owner); expect(h.view.ids).toEqual(ids);
    expect(visible(third)).toBe(true);
    expect(h.session.project).toEqual(before); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
    expect(document.activeElement?.closest('[hidden]')).toBeNull(); expect(document.activeElement?.matches(':disabled')).toBe(false);
  });
});

describe('SelectionControls kind and child-target gates', () => {
  it('routes chord pitches to their exact event instead of choosing an arbitrary tone', () => {
    const h = fixture(scoreHtml('<music-chord id="n1" pitches="C4 Eqs4 G4" duration="quarter"></music-chord>'));
    expect(h.button('selection-pitch').textContent).toMatch(/pitches/i);
    h.button('selection-pitch').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'pitches' });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.isOpen('pitch')).toBe(false);
    expect(h.button('selection-sharp').disabled || !visible(h.button('selection-sharp'))).toBe(true);
  });

  it('routes an open slash’s value to nominal span and preserves the exact group route when it is selected with notes', () => {
    const h = fixture(scoreHtml('<music-slash id="n1" duration="quarter"></music-slash>' + note('n2') + note('n3')), { native: true });
    const before = h.session.project;
    h.button('selection-value').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'nominal-span' });
    expect(h.nativeSurfaces.get('value')!.show).not.toHaveBeenCalled(); expect(h.isOpen('value')).toBe(false);
    h.select(['n1', 'n3']); h.button('edit-selected-event').click();
    expect(h.openProperties).toHaveBeenLastCalledWith({ eventIds: ['n1', 'n3'], section: 'selection', toggle: true, invokerId: 'edit-selected-event' });
    expect(h.openProperties).toHaveBeenCalledTimes(2); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('disables tied-note alteration with a reason and does not execute a delivered disabled action', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="quarter" tie="start"') + note('n2', 'pitch="C4" duration="quarter" tie="end"')));
    const sharp = h.button('selection-sharp');
    expect(sharp.disabled).toBe(true);
    expect(described(sharp)).toMatch(/tie/i);
    sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    h.open('pitch'); change(h.field('selection-alteration'), '1');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    expect(h.event().tie).toBe('start');
  });

  it.each([
    ['full-measure rest', '<music-rest id="n1" measure></music-rest>', /meter|measure.rest|full.measure/i],
    ['open slash', '<music-slash id="n1" duration="quarter"></music-slash>', /open|improvis|attack|performer/i],
  ] as const)('does not give a %s a misleading editable written-rhythm control', (_name, eventMarkup, reason) => {
    const h = fixture(scoreHtml(eventMarkup));
    expect(h.field('selection-duration').disabled || h.button('selection-value').disabled).toBe(true);
    expect(`${described(h.button('selection-value'))} ${described(h.field('selection-duration'))} ${h.panel('value').textContent}`).toMatch(reason);
    change(h.field('selection-duration'), 'eighth');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
  });

  it('keeps a pitch-free rhythm event’s Options separate from actual pitch controls', () => {
    const h = fixture(scoreHtml('<music-rhythm id="n1" duration="quarter"></music-rhythm>', 'incomplete', 'notation="rhythm"'));
    expect(h.button('selection-pitch').textContent).toBe('Options'); expect(h.button('selection-pitch').disabled).toBe(false);
    expect(h.button('selection-natural').disabled || !visible(h.button('selection-natural'))).toBe(true);
    h.open('value'); change(h.field('selection-duration'), 'eighth');
    expect(h.event()).toMatchObject({ kind: 'rhythm', duration: 'eighth', pitches: [] });
    expect(h.session.source.querySelector('#n1')?.hasAttribute('pitch')).toBe(false);
  });

  it('disables a batch property when any selected member is incompatible', () => {
    const h = fixture(scoreHtml(note('n1') + '<music-rest id="n2" duration="quarter"></music-rest>'), { ids: ['n1', 'n2'] });
    h.open('shared'); const field = h.field('selection-shared-alteration');
    expect(field.disabled).toBe(true); change(field, '1');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.event('n1').pitches[0].alter).toBe(0); expect(h.session.revision).toBe(0);
  });

  it('applies quick accidental choices to an eligible exact selection', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n2'] }); const before = h.session.project;
    const sharp = h.button('selection-sharp');
    expect(sharp.disabled).toBe(false);
    sharp.click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n2'], change: { property: 'alter', value: 1, ties: 'reject' } });
    expect(h.event('n1').pitches[0].alter).toBe(1); expect(h.event('n2').pitches[0].alter).toBe(1);
    h.session.undo(); expect(h.session.project.sourceHtml).toBe(before.sourceHtml);
  });

  it('changes only accepted road direction and preserves its rhythm and child marks', () => {
    const html = scoreHtml('<music-road id="n1" direction="same" duration="quarter" dots="1" stem="down"><music-interval id="third" value="b3" placement="below"></music-interval></music-road>', 'incomplete', 'notation="three-roads"');
    const h = fixture(html, { observeSuccess: true }); const before = h.event();
    h.button('selection-higher').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'update-event', eventId: 'n1', fields: ['pitchDirection'], value: expect.objectContaining({ kind: 'road', pitchDirection: 'higher' }) }));
    expect(h.event()).toEqual({ ...before, pitchDirection: 'higher' });
    expect(h.session.source.querySelector('#third')?.getAttribute('placement')).toBe('below');
    expect(h.session.revision).toBe(1);
    expect(h.success).toHaveBeenCalledOnce(); h.controls.refresh(); expect(h.success).toHaveBeenCalledOnce();
    h.button('selection-higher').click();
    expect(h.success).toHaveBeenCalledTimes(2); expect(h.execute).toHaveBeenCalledOnce(); expect(h.session.revision).toBe(1);
  });

  it('keeps a tied road continuation on Same and explains disabled direction changes', () => {
    const html = scoreHtml('<music-road id="n1" direction="higher" duration="quarter" tie="start"></music-road><music-road id="n2" direction="same" duration="quarter" tie="end"></music-road>', 'incomplete', 'notation="three-roads"');
    const h = fixture(html, { ids: ['n2'] });
    expect(h.button('selection-same').getAttribute('aria-checked')).toBe('true');
    for (const id of ['selection-higher', 'selection-lower']) {
      expect(h.button(id).disabled).toBe(true); expect(described(h.button(id))).toMatch(/tie|continuation/i);
      h.button(id).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    h.open('pitch'); change(h.field('selection-direction'), 'lower');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.event().pitchDirection).toBe('same'); expect(h.event().tie).toBe('end');
  });

  it('edits and removes the exact selected child without borrowing a sibling or changing its owner', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="quarter"', '<music-articulation id="accent" type="accent"></music-articulation><music-ornament id="trill" type="trill"></music-ornament>')));
    h.select(['n1'], 'trill');
    h.button('selection-mark-edit').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', markingId: 'trill', section: 'markings' });
    h.button('selection-delete').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'remove-event-marking', eventId: 'n1', markingId: 'trill' });
    expect(h.session.source.querySelector('#trill')).toBeNull(); expect(h.session.source.querySelector('#accent')).not.toBeNull();
    expect(h.event().duration).toBe('quarter'); expect(h.session.revision).toBe(1);
    h.session.undo(); expect(h.session.source.querySelector('#trill')).not.toBeNull();
  });

  it('does not redirect a pressed child-removal action to a different marking of the same event', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="quarter"', '<music-articulation id="accent" type="accent"></music-articulation><music-ornament id="trill" type="trill"></music-ornament>')));
    h.select(['n1'], 'trill'); const remove = h.button('selection-delete');
    pointer(remove, 'pointerdown');
    // The exact child is part of the binding independently of the event/version.
    h.view.activeMarkingId = 'accent'; h.controls.refresh();
    pointer(remove, 'pointerup'); remove.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    expect(h.session.source.querySelector('#trill')).not.toBeNull(); expect(h.session.source.querySelector('#accent')).not.toBeNull();
  });
});

describe('SelectionControls direct Pitch chooser actions', () => {
  it.each(['native', 'fallback'] as const)('focuses the current Natural action when the common %s Pitch chooser opens without editing music', async mode => {
    const h = fixture(scoreHtml(), { native: mode === 'native' }); const before = h.session.project;
    h.open('pitch'); await Promise.resolve();
    expect(document.activeElement).toBe(h.button('selection-chooser-natural'));
    expect(h.isOpen('pitch')).toBe(true); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it.each(['native', 'fallback'] as const)('keeps quarter-tone focus on the full alteration select in the %s chooser', async mode => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Fqs4" duration="quarter"')), { native: mode === 'native' });
    const before = h.session.project; h.open('pitch'); await Promise.resolve();
    expect(document.activeElement).toBe(h.field('selection-alteration')); expect(h.field('selection-alteration').value).toBe('0.5');
    expect([...h.field('selection-alteration').options].filter(option => option.value !== '')).toHaveLength(9);
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
    expect(h.isOpen('pitch')).toBe(true); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it.each(['native', 'fallback'] as const)('keeps Properties Spelling focus on the full alteration select in the %s chooser', async mode => {
    const h = fixture(scoreHtml(), { native: mode === 'native' }); control('workspace-tools').hidden = false;
    const before = h.session.project; const spelling = h.button('properties-pitch');
    spelling.focus(); spelling.click(); h.nativeSurfaces.get('pitch')?.show(spelling); await Promise.resolve();
    expect(document.activeElement).toBe(h.field('selection-alteration')); expect(h.field('selection-alteration').value).toBe('0');
    expect([...h.field('selection-alteration').options].filter(option => option.value !== '')).toHaveLength(9);
    expect(h.isOpen('pitch')).toBe(true); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it.each(['native', 'fallback'] as const)('keeps road direction focus on its direction select in the %s chooser', async mode => {
    const h = fixture(scoreHtml('<music-road id="n1" direction="lower" duration="quarter"></music-road>', 'incomplete', 'notation="three-roads"'), { native: mode === 'native' });
    const before = h.session.project; h.open('pitch'); await Promise.resolve();
    expect(document.activeElement).toBe(h.field('selection-direction')); expect(h.field('selection-direction').value).toBe('lower');
    expect(h.isOpen('pitch')).toBe(true); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('changes pitch with direct native buttons, preserves their keys, and retains the full alteration selector', async () => {
    const h = fixture(scoreHtml(), { native: true }); const before = h.event();
    h.open('pitch'); expect(h.isOpen('pitch')).toBe(true);
    const selector = h.field('selection-alteration'); const picker = vi.fn(() => {});
    Object.defineProperty(selector, 'showPicker', { configurable: true, value: picker });
    expect([...selector.options].filter(option => option.value !== '')).toHaveLength(9);
    const group = control('selection-chooser-accidentals');
    for (const id of chooserAccidentalIds) {
      const button = h.button(id); expect(group.contains(button)).toBe(true); expect(button.type).toBe('button');
      expect(button.closest('select')).toBeNull(); expect(button.getAttribute('role')).not.toBe('radio');
    }
    const sharp = h.button('selection-chooser-sharp'); sharp.focus(); sharp.click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'alter', value: 1, ties: 'reject' } });
    expect(h.event()).toEqual({ ...before, pitches: before.pitches.map(pitch => ({ ...pitch, alter: 1 })) });
    expect(selector.value).toBe('1'); expect(picker).not.toHaveBeenCalled(); expect(h.isOpen('pitch')).toBe(true);
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    sharp.click(); expect(h.execute).toHaveBeenCalledOnce(); expect(h.session.revision).toBe(1);

    const natural = h.button('selection-chooser-natural');
    expect(key(natural, ' ').defaultPrevented).toBe(false);
    h.controls.cancel('The chooser moved before the pending key activation.');
    natural.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); natural.click();
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.event().pitches[0].alter).toBe(1); expect(h.isOpen('pitch')).toBe(false);

    h.open('pitch');
    expect(activateKey(h.button('selection-chooser-flat'), ' ').defaultPrevented).toBe(false);
    expect(h.execute).toHaveBeenLastCalledWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'alter', value: -1, ties: 'reject' } });
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(activateKey(natural, 'Enter').defaultPrevented).toBe(false);
    expect(h.execute).toHaveBeenLastCalledWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'alter', value: 0, ties: 'reject' } });
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(selector.value).toBe('0'); expect(picker).not.toHaveBeenCalled(); expect(h.execute).toHaveBeenCalledTimes(3);
    expect(h.session.revision).toBe(3);
    h.session.undo(); expect(h.event().pitches[0].alter).toBe(-1);
    h.session.undo(); expect(h.event().pitches[0].alter).toBe(1);
    h.session.undo(); expect(h.event()).toEqual(before); expect(h.session.canUndo).toBe(false);
  });

  it('leaves all three pressed states false for a quarter-tone while showing its exact native-select value', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="Ftqf4" duration="quarter"'))); h.open('pitch');
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
    expect(h.field('selection-alteration').value).toBe('-1.5'); expect(h.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['tied note', scoreHtml(note('n1', 'pitch="C4" duration="quarter" tie="start"') + note('n2', 'pitch="C4" duration="quarter" tie="end"'))],
    ['road note', scoreHtml('<music-road id="n1" direction="same" duration="quarter"></music-road>', 'incomplete', 'notation="three-roads"')],
    ['chord', scoreHtml('<music-chord id="n1" pitches="C4 E4 G4" duration="quarter"></music-chord>')],
  ] as const)('keeps direct accidental shortcuts unavailable for a %s', (_kind, html) => {
    const h = fixture(html); const before = h.session.project; h.open('pitch');
    for (const id of chooserAccidentalIds) {
      const button = h.button(id); expect(button.disabled || !visible(button)).toBe(true);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    }
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0);
  });

  it('restores accepted pressed states after a rejected shortcut and displays the failure inside Pitch', () => {
    const h = fixture(scoreHtml(), { observeSuccess: true }); h.open('pitch'); const before = h.session.project;
    h.execute.mockImplementationOnce(() => { throw new Error('The source transaction is no longer available.'); });
    const sharp = h.button('selection-chooser-sharp'); sharp.focus(); sharp.click();
    expect(h.error('pitch').textContent).toContain('source transaction is no longer available');
    expect(chooserAccidentalIds.map(id => h.button(id).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(h.field('selection-alteration').value).toBe('0'); expect(h.isOpen('pitch')).toBe(true);
    expect(h.session.project).toEqual(before); expect(h.session.canUndo).toBe(false); expect(h.success).not.toHaveBeenCalled();
    sharp.click(); expect(h.event().pitches[0].alter).toBe(1); expect(h.session.revision).toBe(1);
    expect(h.error('pitch').textContent).toBe(''); expect(h.success).toHaveBeenCalledOnce();
  });

  it.each(['source revision', 'selection', 'pending Source', 'disposal'] as const)('rejects a captured Pitch shortcut after %s changes', reason => {
    const h = fixture(); h.open('pitch'); const sharp = h.button('selection-chooser-sharp');
    pointer(sharp, 'pointerdown');
    if (reason === 'source revision') h.session.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 0 });
    else if (reason === 'selection') h.select(['n2']);
    else if (reason === 'pending Source') h.session.setPendingSource('<unapplied Source>');
    else h.controls.dispose();
    const before = h.session.project; const revision = h.session.revision;
    pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(revision);
    expect(h.event('n1').pitches[0].alter).toBe(0); expect(h.event('n2').pitches[0].alter).toBe(0);
  });

  it('does not rebind a previously pressed shortcut to an accepted edit from the full alteration selector', () => {
    const h = fixture(); h.open('pitch'); const sharp = h.button('selection-chooser-sharp');
    pointer(sharp, 'pointerdown'); change(h.field('selection-alteration'), '0.5');
    expect(h.event().pitches[0].alter).toBe(0.5); expect(h.session.revision).toBe(1);
    const accepted = h.session.project;
    pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1'], change: { property: 'alter', value: 0.5, ties: 'reject' } });
    expect(h.session.project).toEqual(accepted); expect(h.event().pitches[0].alter).toBe(0.5); expect(h.session.revision).toBe(1);
    h.session.undo(); expect(h.event().pitches[0].alter).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('guards a Properties-owned Pitch chooser after its owner changes without blocking direct correction elsewhere', () => {
    const h = fixture(scoreHtml(), { native: true }); control('workspace-tools').hidden = false;
    const properties = h.button('properties-pitch'); properties.focus(); properties.click();
    h.nativeSurfaces.get('pitch')!.show(properties); expect(h.isOpen('pitch')).toBe(true);
    const sharp = h.button('selection-chooser-sharp'); pointer(sharp, 'pointerdown');
    h.view.inspectionMatchesSelection = false;
    pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.isOpen('pitch')).toBe(false);
    h.select(['n2']); h.open('pitch'); sharp.click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n2'], change: { property: 'alter', value: 1, ties: 'reject' } });
    expect(h.event('n1').pitches[0].alter).toBe(0); expect(h.event('n2').pitches[0].alter).toBe(1); expect(h.session.revision).toBe(1);
  });
});

describe('SelectionControls binding, focus, and surface lifecycle', () => {
  it('wires each native chooser to its exact invoker and refreshes its position after a controller refresh', () => {
    const h = fixture(scoreHtml(), { native: true }); const before = h.session.project;
    expect(positionerMocks.records.map(record => record.panel.id).sort()).toEqual(surfaceNames.map(name => `selection-${name}-chooser`).sort());
    expect(positionerMocks.create).toHaveBeenCalledTimes(3);
    const positioner = (name: SurfaceName) => {
      const record = positionerMocks.records.find(candidate => candidate.panel === h.panel(name));
      expect(record).toBeDefined(); return record!.controls;
    };
    for (const name of surfaceNames) {
      h.select(name === 'shared' ? ['n1', 'n3'] : ['n1']); h.open(name);
      const positioned = positioner(name);
      expect(positioned.open).toHaveBeenLastCalledWith(h.button(`selection-${name}`));
      const refreshes = positioned.refresh.mock.calls.length; h.controls.refresh();
      expect(positioned.refresh.mock.calls.length).toBeGreaterThan(refreshes);
      expect(h.isOpen(name)).toBe(true); h.controls.close();
    }
    h.select(['n1']); control('workspace-tools').hidden = false;
    const spelling = h.button('properties-pitch'); spelling.focus(); spelling.click();
    h.nativeSurfaces.get('pitch')!.show(spelling);
    expect(positioner('pitch').open).toHaveBeenLastCalledWith(spelling);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('invalidates an open chooser for changed membership even when its primary event stays the same', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n2'] }); h.open('shared');
    const field = h.field('selection-shared-duration');
    h.select(['n1', 'n3']); expect(h.isOpen('shared')).toBe(false);
    change(field, 'eighth'); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    h.open('shared'); change(field, 'eighth');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n1', 'n3'], change: { property: 'duration', value: 'eighth' } });
  });

  it('rejects a chooser change after an external source revision, even without a refresh callback', () => {
    const h = fixture(); h.open('value'); h.view.autoRefresh = false;
    h.session.execute({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 0 });
    change(h.field('selection-duration'), 'half');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.event().duration).toBe('eighth'); expect(h.session.revision).toBe(1);
    expect(h.isOpen('value')).toBe(false);
  });

  it('checks the exact membership even if a caller forgets to advance its selection version', () => {
    const h = fixture(scoreHtml(), { ids: ['n1', 'n2'] }); h.open('shared');
    h.view.ids = ['n1', 'n3'];
    change(h.field('selection-shared-duration'), 'eighth');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0); expect(h.isOpen('shared')).toBe(false);
  });

  it.each(['documentId', 'documentEpoch', 'selectionVersion'] as const)('rejects delayed chooser actions after %s changes with identical source IDs', property => {
    const h = fixture(); h.open('pitch'); h.view.autoRefresh = false;
    if (property === 'documentId') h.view.documentId = 'replacement-document';
    else h.view[property] += 1;
    change(h.field('selection-alteration'), '1.5');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.event().pitches[0].alter).toBe(0); expect(h.session.revision).toBe(0);
    expect(h.isOpen('pitch')).toBe(false);
  });

  it('closes and guards editing in pending Source, Read, Pages, and entry states', () => {
    const h = fixture(); const source = h.session.project.sourceHtml;
    for (const state of ['source', 'read', 'pages', 'entry'] as const) {
      h.view.mode = 'write'; h.view.entryMode = false; h.session.setPendingSource(null); h.controls.refresh(); h.open('value');
      if (state === 'source') h.session.setPendingSource('<unfinished source>');
      else if (state === 'entry') h.view.entryMode = true;
      else h.view.mode = state;
      const revision = h.session.revision;
      h.controls.refresh();
      expect(h.isOpen('value')).toBe(false); change(h.field('selection-duration'), 'half');
      expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(revision);
      expect(h.session.project.sourceHtml).toBe(source); expect(h.session.canUndo).toBe(false);
    }
  });

  it('cancels a pressed shortcut before geometry relocation and rejects its delivered click', () => {
    const h = fixture(); const sharp = h.button('selection-sharp');
    pointer(sharp, 'pointerdown'); expect(h.controls.interacting).toBe(true);
    h.controls.cancel('The notation moved. Select a control at its current position.');
    pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0); expect(h.controls.interacting).toBe(false);
    pointer(sharp, 'pointerdown'); pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.event().pitches[0].alter).toBe(1);
  });

  it('keeps a released pointer action interacting until its click is consumed or cancelled', () => {
    const h = fixture(); const sharp = h.button('selection-sharp');
    pointer(sharp, 'pointerdown'); pointer(sharp, 'pointerup');
    expect(h.controls.interacting).toBe(true);
    h.controls.cancel('The control cannot stay here safely.'); expect(h.controls.interacting).toBe(false);
    sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    pointer(sharp, 'pointerdown'); pointer(sharp, 'pointerup'); expect(h.controls.interacting).toBe(true);
    sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.controls.interacting).toBe(false);
  });

  it.each(['edit-selected-event', 'selection-value'] as const)('keeps the pending native Space activation of %s interacting through release', id => {
    const h = fixture(); const button = h.button(id); button.focus();
    expect(key(button, ' ').defaultPrevented).toBe(false); expect(h.controls.interacting).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    expect(h.controls.interacting).toBe(true);
    h.controls.cancel('The selected control moved before activation.'); expect(h.controls.interacting).toBe(false);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.isOpen('value')).toBe(false); expect(h.execute).not.toHaveBeenCalled();
    activateKey(button, ' ');
    if (id === 'edit-selected-event') {
      expect(h.openProperties).toHaveBeenCalledOnce(); expect(h.controls.interacting).toBe(false);
    } else {
      expect(h.isOpen('value')).toBe(true); expect(h.controls.interacting).toBe(true);
    }
    expect(h.session.revision).toBe(0);
  });

  it('retains cancelled and pending Space bindings across a microtask checkpoint before click', async () => {
    const h = fixture(); const more = h.button('edit-selected-event'); more.focus();
    key(more, ' '); expect(h.controls.interacting).toBe(true);
    h.controls.cancel('Geometry changed before the native activation arrived.');
    more.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    // A real browser can run a microtask checkpoint between listeners and the
    // native click/default action. This is a unit lifecycle simulation only.
    await Promise.resolve();
    expect(h.controls.interacting).toBe(false); more.click();
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
    expect(surfaceNames.every(name => !h.isOpen(name))).toBe(true);

    key(more, ' ');
    more.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve();
    expect(h.controls.interacting).toBe(true); more.click();
    expect(h.openProperties).toHaveBeenCalledOnce(); expect(h.controls.interacting).toBe(false);
    expect(h.session.revision).toBe(0);
  });

  it('closes a chooser on geometry cancellation and requires deliberate reopening before another edit', () => {
    const h = fixture(); h.open('value'); const duration = h.field('selection-duration');
    h.controls.cancel('The toolbar no longer fits beside this notation.');
    expect(h.isOpen('value')).toBe(false); change(duration, 'eighth');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
    h.open('value'); change(duration, 'eighth');
    expect(h.execute).toHaveBeenCalledOnce(); expect(h.event().duration).toBe('eighth');
  });

  it('recovers owned fallback chooser focus without scrolling on geometry cancellation and does not steal unrelated focus', () => {
    const h = fixture(); const before = h.session.project; h.open('value');
    const duration = h.field('selection-duration'); duration.focus();
    const related = [...h.toolbar.querySelectorAll<HTMLButtonElement>('button')].filter(button => visible(button) && !button.disabled);
    const focusCalls = new Map(related.map(button => [button, vi.spyOn(button, 'focus')]));
    expect(h.controls.cancel('geometry')).toBe(true);
    const focused = document.activeElement as HTMLButtonElement;
    expect(related).toContain(focused); expect(focused.isConnected).toBe(true); expect(visible(focused)).toBe(true);
    expect(focused.disabled).toBe(false); expect(focusCalls.get(focused)).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(h.isOpen('value')).toBe(false); expect(h.controls.interacting).toBe(false);
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);

    h.open('value');
    const unrelated = document.createElement('input'); unrelated.value = 'Unrelated draft'; document.body.append(unrelated); unrelated.focus();
    expect(document.activeElement).toBe(unrelated); expect(h.controls.cancel('geometry')).toBe(false);
    expect(document.activeElement).toBe(unrelated); expect(unrelated.value).toBe('Unrelated draft');
    expect(h.isOpen('value')).toBe(false); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
    expect(h.controls.cancel('geometry')).toBe(false); expect(document.activeElement).toBe(unrelated);
  });

  it('rejects a pressed shortcut when selection changes before its click is delivered', () => {
    const h = fixture(); const sharp = h.button('selection-sharp');
    pointer(sharp, 'pointerdown'); h.select(['n2']); pointer(sharp, 'pointerup'); sharp.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.event('n1').pitches[0].alter).toBe(0); expect(h.event('n2').pitches[0].alter).toBe(0);
  });

  it('roves shortcut focus with arrows without editing, then commits only on Space or Enter', () => {
    const h = fixture(); const natural = h.button('selection-natural'); natural.focus();
    const arrow = key(natural, 'ArrowRight');
    expect(arrow.defaultPrevented).toBe(true); expect(document.activeElement).not.toBe(natural);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
    const sharp = h.button('selection-sharp'); sharp.focus(); activateKey(sharp, ' ');
    expect(h.event().pitches[0].alter).toBe(1); expect(h.execute).toHaveBeenCalledOnce();
    const flat = h.button('selection-flat'); flat.focus(); activateKey(flat, 'Enter');
    expect(h.event().pitches[0].alter).toBe(-1); expect(h.execute).toHaveBeenCalledTimes(2);
    const tabStops = [...h.toolbar.querySelectorAll<HTMLElement>('button'), ...[...h.toolbar.querySelectorAll('music-toggle-button-group')].flatMap(group => [...group.shadowRoot!.querySelectorAll<HTMLElement>('.controls > button')])].filter(button => visible(button) && !button.matches(':disabled') && button.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
  });

  it('does not route native chooser arrow keys into toolbar actions or score entry', () => {
    const h = fixture(); h.open('value'); const field = h.field('selection-duration'); field.focus();
    const event = key(field, 'ArrowDown');
    expect(event.defaultPrevented).toBe(false); expect(document.activeElement).toBe(field);
    expect(key(field, 'Escape').defaultPrevented).toBe(false); expect(h.isOpen('value')).toBe(true);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
  });

  it('opens ordinary in-flow fallback sections and closes them with Escape without changing music', () => {
    const h = fixture(); h.open('value');
    expect(h.panel('value').hasAttribute('popover')).toBe(false); expect(h.panel('value').dataset.popoverFallback).toBe('true');
    expect(h.isOpen('value')).toBe(true); expect(h.panel('value').contains(document.activeElement)).toBe(true);
    const close = h.button('close-selection-value'); close.focus(); key(close, 'Escape');
    expect(h.isOpen('value')).toBe(false); expect(document.activeElement).toBe(h.button('selection-value'));
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('quietly cancels a pending More activation on Escape but leaves an idle Escape untouched', async () => {
    const h = fixture(); const more = h.button('edit-selected-event'); const before = h.session.project;
    const boundary = more.parentElement!; const bubbled = vi.fn(() => {});
    boundary.addEventListener('keydown', bubbled); cleanups.push(() => boundary.removeEventListener('keydown', bubbled));
    more.focus(); key(more, ' '); expect(h.controls.interacting).toBe(true); bubbled.mockClear();
    const escaped = key(more, 'Escape');
    expect(escaped.defaultPrevented).toBe(true); expect(bubbled).not.toHaveBeenCalled();
    expect(h.controls.interacting).toBe(false);
    more.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); more.click();
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
    expect(h.showError).not.toHaveBeenCalled(); expect(h.report).not.toHaveBeenCalled();
    expect(control('selection-controls-error').textContent).toBe(''); expect(h.session.selectionId).toBe('n1');
    bubbled.mockClear(); expect(key(more, 'Escape').defaultPrevented).toBe(false); expect(bubbled).toHaveBeenCalledOnce();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);

    // Quiet Escape does not suppress a later, unrelated stale-target failure.
    key(more, ' '); h.select(['n2']);
    more.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); more.click();
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.showError).toHaveBeenCalledOnce();
    expect(control('selection-controls-error').textContent).toMatch(/changed|current/i);
  });

  it('invalidates a pending fallback chooser action before Escape closes it and restores invoker focus', async () => {
    const h = fixture(); h.open('pitch'); const before = h.session.project;
    const sharp = h.button('selection-chooser-sharp'); sharp.focus(); key(sharp, ' ');
    const boundary = h.panel('pitch').parentElement!; const bubbled = vi.fn(() => {});
    boundary.addEventListener('keydown', bubbled); cleanups.push(() => boundary.removeEventListener('keydown', bubbled));
    const escaped = key(sharp, 'Escape');
    expect(escaped.defaultPrevented).toBe(true); expect(bubbled).not.toHaveBeenCalled();
    expect(h.isOpen('pitch')).toBe(false); expect(h.controls.interacting).toBe(false);
    expect(document.activeElement).toBe(h.button('selection-pitch'));
    sharp.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); sharp.click();
    expect(h.execute).not.toHaveBeenCalled(); expect(h.showError).not.toHaveBeenCalled(); expect(h.report).not.toHaveBeenCalled();
    expect(control('selection-controls-error').textContent).toBe(''); expect(h.error('pitch').textContent).toBe('');
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('leaves native popover and editable-field Escape defaults intact while invalidating pending button actions quietly', async () => {
    const h = fixture(scoreHtml(), { native: true }); h.open('pitch'); const before = h.session.project;
    const native = h.nativeSurfaces.get('pitch')!;
    const input = document.createElement('input'); input.value = 'Unfinished text';
    const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.tabIndex = 0; editable.textContent = 'Editable prose';
    h.panel('pitch').append(input, editable);
    for (const field of [h.field('selection-alteration'), input, editable]) {
      field.focus(); const escaped = key(field, 'Escape');
      expect(escaped.defaultPrevented).toBe(false); expect(document.activeElement).toBe(field);
      expect(h.isOpen('pitch')).toBe(true); expect(native.hide).not.toHaveBeenCalled();
    }
    expect(input.value).toBe('Unfinished text'); expect(editable.textContent).toBe('Editable prose');
    const sharp = h.button('selection-chooser-sharp'); sharp.focus(); key(sharp, ' ');
    expect(key(sharp, 'Escape').defaultPrevented).toBe(false);
    expect(native.hide).not.toHaveBeenCalled(); expect(h.isOpen('pitch')).toBe(true);
    // Only the lifecycle stub supplies the browser's default dismissal here.
    native.hide(); expect(h.controls.interacting).toBe(false);
    sharp.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); sharp.click();
    expect(h.execute).not.toHaveBeenCalled(); expect(h.showError).not.toHaveBeenCalled();

    const other = stubNative(control('document-menu')); other.show();
    const more = h.button('edit-selected-event'); more.focus(); key(more, ' ');
    expect(key(more, 'Escape').defaultPrevented).toBe(false);
    expect(other.hide).not.toHaveBeenCalled(); expect(other.isOpen()).toBe(true);
    other.hide(); expect(h.controls.interacting).toBe(false);
    more.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true, cancelable: true }));
    await Promise.resolve(); more.click();
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
    expect(h.showError).not.toHaveBeenCalled(); expect(h.report).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('preserves native auto-popover invokers and cancels native opening for stale state', () => {
    const h = fixture(scoreHtml(), { native: true });
    for (const name of surfaceNames) {
      expect(h.panel(name).getAttribute('popover')).toBe('auto');
      expect(h.button(`selection-${name}`).getAttribute('popovertarget')).toBe(`selection-${name}-chooser`);
      expect(h.panel(name).getAttribute('role')).not.toBe('menu');
      expect(h.button(`close-selection-${name}`).getAttribute('popovertargetaction')).toBe('hide');
    }
    h.open('value'); expect(h.isOpen('value')).toBe(true);
    expect(h.panel('value').contains(document.activeElement)).toBe(true);
    h.controls.close(); expect(h.isOpen('value')).toBe(false);
    h.view.entryMode = true;
    h.nativeSurfaces.get('value')!.show(h.button('selection-value'));
    expect(h.isOpen('value')).toBe(false); expect(h.panel('value').hasAttribute('popover')).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it.each(['selection change', 'explicit cancellation'] as const)('rejects delayed native opening after %s invalidates its invoker', reason => {
    const h = fixture(scoreHtml(), { native: true }); const trigger = h.button('selection-value');
    trigger.click(); // The native default has not delivered beforetoggle yet.
    if (reason === 'selection change') h.select(['n2']);
    else h.controls.cancel('The control moved before its chooser opened.');
    h.nativeSurfaces.get('value')!.show(trigger);
    expect(h.isOpen('value')).toBe(false); expect(h.controls.interacting).toBe(false);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
  });

  it('routes More, Relationships, and modifier-free selection actions without editing or resuming entry', () => {
    const h = fixture(); expect(h.button('edit-selected-event').hasAttribute('popovertarget')).toBe(false);
    h.button('edit-selected-event').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'properties', toggle: true, invokerId: 'edit-selected-event' });
    h.select(['n1', 'n2']); h.button('selection-relationships').click(); expect(h.openRelationships).toHaveBeenCalledOnce();
    h.open('shared'); h.button('selection-select-more').click(); expect(h.selectMore).toHaveBeenCalledWith(true);
    h.controls.refresh(); expect(h.button('selection-select-more').getAttribute('aria-pressed')).toBe('true');
    h.button('selection-select-more').click(); expect(h.selectMore).toHaveBeenLastCalledWith(false);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.resume).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
  });

  it('allows read-only More with pending Source while leaving its accepted music and draft untouched', () => {
    const h = fixture(); h.session.setPendingSource('<unfinished musical Source>');
    const before = h.session.project; const revision = h.session.revision;
    const more = h.button('edit-selected-event'); expect(more.disabled).toBe(false); more.click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventId: 'n1', section: 'properties', toggle: true, invokerId: 'edit-selected-event' });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
    expect(h.session.revision).toBe(revision); expect(h.session.canUndo).toBe(false);
  });

  it('keeps throwing Properties and relationship callbacks in local feedback without an unhandled error', () => {
    const h = fixture(); const uncaught: unknown[] = [];
    const onError = (event: ErrorEvent) => { uncaught.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onError); cleanups.push(() => window.removeEventListener('error', onError));
    h.openProperties.mockImplementation(() => { throw new Error('The held Properties target needs review.'); });
    expect(() => h.button('edit-selected-event').click()).not.toThrow();
    expect(h.showError).toHaveBeenLastCalledWith('The held Properties target needs review.');
    expect(control('selection-controls-error').textContent).toContain('held Properties target');
    h.select(['n1', 'n3']);
    h.openRelationships.mockImplementation(() => { throw new Error('The selected relationship is no longer available.'); });
    expect(() => h.button('selection-relationships').click()).not.toThrow();
    expect(h.showError).toHaveBeenLastCalledWith('The selected relationship is no longer available.');
    expect(control('selection-controls-error').textContent).toContain('relationship is no longer available');
    expect(uncaught).toEqual([]); expect(h.execute).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
  });

  it('routes group More with exact membership and names selected custom bars in score order', () => {
    const html = `<music-staff id="staff" label="Flute">
      <music-measure id="bar-a" number="Coda" incomplete>${note('n1')}${note('n2')}</music-measure>
      <music-measure id="bar-b" number="A.2" incomplete>${note('n3')}</music-measure>
    </music-staff>`;
    const h = fixture(html, { ids: ['n1', 'n3'] }); const before = h.session.project;
    const caption = control('selection-controls-context').textContent ?? '';
    expect(caption).toContain('Coda'); expect(caption).toContain('A.2');
    expect(caption.indexOf('Coda')).toBeLessThan(caption.indexOf('A.2'));
    h.button('edit-selected-event').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ eventIds: ['n1', 'n3'], section: 'selection', toggle: true, invokerId: 'edit-selected-event' });
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('guards held Properties actions without blocking another note’s quick correction or Location selection tools', () => {
    const h = fixture(); h.view.inspectionMatchesSelection = false; h.select(['n2']);
    const pitch = h.button('properties-pitch'); const prepare = h.button('selection-prepare-drag');
    expect(pitch.disabled).toBe(true); expect(prepare.disabled).toBe(true);
    pitch.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    prepare.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.openProperties).not.toHaveBeenCalled(); expect(h.preparePitchDrag).not.toHaveBeenCalled();
    expect(h.button('selection-sharp').disabled).toBe(false); h.button('selection-sharp').click();
    expect(h.event('n2').pitches[0].alter).toBe(1); expect(h.event('n1').pitches[0].alter).toBe(0);
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-events-property', eventIds: ['n2'], change: { property: 'alter', value: 1, ties: 'reject' } });
    h.button('selection-select-more').click(); expect(h.selectMore).toHaveBeenCalledWith(true);
    expect(h.session.revision).toBe(1);
  });

  it('preserves Tools and exact marking destinations when More requests a workspace-owned toggle', () => {
    const h = fixture(scoreHtml(note('n1', 'pitch="C4" duration="quarter"', '<music-ornament id="trill" type="trill"></music-ornament>')));
    const before = h.session.project;
    h.select([]); h.button('edit-selected-event').click();
    expect(h.openProperties).toHaveBeenCalledExactlyOnceWith({ section: 'tools', toggle: true, invokerId: 'edit-selected-event' });
    h.select(['n1'], 'trill'); h.button('edit-selected-event').click();
    expect(h.openProperties).toHaveBeenLastCalledWith({ eventId: 'n1', markingId: 'trill', section: 'markings', toggle: true, invokerId: 'edit-selected-event' });
    expect(h.openProperties).toHaveBeenCalledTimes(2); expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(before); expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('derives More expanded state only from the workspace report and does not optimistically toggle it', () => {
    const h = fixture(); const more = h.button('edit-selected-event'); const before = h.session.project;
    expect(more.getAttribute('aria-controls')).toBe('workspace-tools'); expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click(); expect(h.openProperties).toHaveBeenCalledOnce();
    // The callback spy does not implement WorkspaceTools. Only its subsequent
    // actual visibility report is authoritative for this controller's ARIA.
    expect(more.getAttribute('aria-expanded')).toBe('false');
    h.view.moreExpanded = true; h.controls.refresh(); expect(more.getAttribute('aria-expanded')).toBe('true');
    h.select(['n2']); expect(more.getAttribute('aria-expanded')).toBe('true');
    h.select([]); expect(more.getAttribute('aria-expanded')).toBe('true');
    h.view.moreExpanded = false; h.controls.refresh(); expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.project).toEqual(before);
    expect(h.session.revision).toBe(0); expect(h.session.canUndo).toBe(false);
  });

  it('detaches listeners and closes open surfaces on disposal', () => {
    const h = fixture(); h.open('value'); h.controls.dispose();
    expect(h.isOpen('value')).toBe(false); expect(h.controls.interacting).toBe(false);
    change(h.field('selection-duration'), 'half'); h.button('selection-sharp').click(); h.button('edit-selected-event').click();
    h.controls.refresh(); h.controls.close(); h.controls.cancel('Already disposed');
    expect(h.execute).not.toHaveBeenCalled(); expect(h.openProperties).not.toHaveBeenCalled(); expect(h.session.revision).toBe(0);
  });
});


describe('SelectionControls direct deletion binding', () => {
  it('rejects a Delete press when its selected events change before release', () => {
    const h = fixture(); const remove = h.button('selection-delete'); pointer(remove, 'pointerdown');
    h.select(['n2']); pointer(remove, 'pointerup'); remove.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(h.execute).not.toHaveBeenCalled(); expect(h.session.canUndo).toBe(false);
    expect(h.session.source.querySelector('#n1')).not.toBeNull(); expect(h.session.source.querySelector('#n2')).not.toBeNull();
  });
  it('hides Delete for structural targets without selected events', () => {
    const h = fixture(scoreHtml(), { ids: [] });
    h.view.structural = { id: 'bar', kind: 'measure', label: 'Bar 12' }; h.controls.refresh();
    expect(h.button('selection-delete').hidden).toBe(true); expect(h.button('selection-delete').disabled).toBe(true);
  });
});
