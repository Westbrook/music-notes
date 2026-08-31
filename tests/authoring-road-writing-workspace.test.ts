// @vitest-environment happy-dom
/**
 * ROAD-CONTEXTUAL through the real Author shell, session and controls. Engraving
 * dispatch alone is stubbed. Widths exercise application policy, not native
 * layout, popover geometry, trusted keyboard input, touch or publication.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { add, rational } from '../src/model/index.js';
import type { PitchDirection } from '../src/model/types.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const emptyRoadBar = `<music-staff id="roads" label="Roads" notation="three-roads" meter="4/4">
  <music-measure id="road-bar" incomplete><music-voice id="road-voice"></music-voice></music-measure>
</music-staff>`;
const phrase: readonly PitchDirection[] = ['same', 'higher', 'lower', 'same'];
const actions: string[] = [];
let app: AuthorWorkspace | undefined;
let sequence = 0;
let widthDescriptor: PropertyDescriptor | undefined;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element as T;
}

function available(element: HTMLElement): boolean {
  if (element.closest('[hidden],[inert],[aria-hidden="true"]') || element.matches(':disabled')) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open
      && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}

async function flush(): Promise<void> {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}

async function click(id: string): Promise<void> {
  const target = el<HTMLButtonElement>(id);
  expect(available(target), `#${id} is available`).toBe(true);
  actions.push(`click:${id}`); target.click(); await flush();
}

async function chooseValue(id: string, value: string): Promise<void> {
  const target = el<HTMLSelectElement>(id);
  expect(available(target), `#${id} is available`).toBe(true);
  expect([...target.options].some(option => option.value === value && !option.disabled)).toBe(true);
  actions.push(`field:${id}`); target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function press(key: string, options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  // Focus must come from the actual chooser action, never from this helper.
  expect(document.activeElement).toBe(el('score-editor'));
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...options });
  actions.push(`key:${key}`); document.activeElement!.dispatchEvent(event); await flush();
  return event;
}

function directionButton(direction: PitchDirection): HTMLButtonElement {
  const matches = [...el('entry-direction-chooser').querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => new RegExp(`^${direction}(?:\\s|$)`, 'i').test(button.textContent?.trim() ?? ''));
  expect(matches, `One explicitly labelled ${direction} button`).toHaveLength(1);
  return matches[0];
}

function recipe(): Record<string, string | boolean> {
  return {
    ...Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-alteration', 'event-direction', 'event-duration',
      'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position']
      .map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value])),
    measureRest: el<HTMLInputElement>('event-measure-rest').checked,
    rhythmic: el<HTMLInputElement>('event-rhythmic').checked,
  };
}

function accepted() {
  return { source: app!.session.project.sourceHtml, revision: app!.session.revision,
    undo: app!.session.canUndo, redo: app!.session.canRedo, cursor: app!.session.cursor,
    selection: app!.session.selection, pending: app!.session.project.pendingSource };
}

function events() { return app!.session.score.staves[0].measures[0].voices[0].events; }

function writing(): void {
  expect(document.body.dataset.entryMode).toBe('true');
  expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
  expect(el('select-mode').getAttribute('aria-pressed')).toBe('false');
}

function noGeneralTask(): void {
  for (const id of ['entry-settings', 'workspace-tools', 'source-panel', 'selection-pitch-chooser',
    'selection-value-chooser', 'selection-shared-chooser']) {
    expect(el(id).hidden, `The road phrase does not visit #${id}`).toBe(true);
  }
  expect(el<HTMLDialogElement>('author-confirmation').open).toBe(false);
}

function mount(): void {
  const stored = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `road-writing-workspace-${++sequence}`, writerId: 'road-writing-test',
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); },
      removeItem: key => { stored.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(emptyRoadBar, 'Direct road writing'), recovery });
}

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell; actions.length = 0;
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
});

afterEach(async () => {
  app?.dispose(); app = undefined; await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
  if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
});

describe('ROAD-CONTEXTUAL direct writing retains relative musical semantics', () => {
  it.each([1180, 390])('writes Same → Higher → Lower → Same without repeated general options at width policy %s', async width => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    mount(); const initial = accepted();
    expect(events()).toEqual([]); expect(app!.session.source.querySelector('music-rest')).toBeNull();
    await click('toggle-entry'); writing();
    expect(el<HTMLSelectElement>('event-kind').value).toBe('road');
    await click('entry-value-trigger'); await chooseValue('event-duration', 'quarter'); await chooseValue('event-dots', '0');
    await click('close-entry-value');
    expect(accepted()).toEqual(initial);
    const initialRecipe = recipe();
    const snapshots = [initial.source];
    const cursors: ReturnType<typeof accepted>['cursor'][] = [];
    const ids: string[] = [];
    actions.length = 0;

    for (const [index, direction] of phrase.entries()) {
      const beforeChoice = accepted(), previousRecipe = recipe();
      expect(el('entry-direction-trigger').closest('#entry-slot-options')).not.toBeNull();
      expect(el('entry-direction-trigger').getAttribute('popovertarget')
        ?? el('entry-direction-trigger').dataset.surfaceTarget).toBe('entry-direction-chooser');
      await click('entry-direction-trigger');
      expect(el('entry-direction-chooser').hidden).toBe(false); writing(); noGeneralTask();
      expect(accepted()).toEqual(beforeChoice);
      const choice = directionButton(direction);
      expect(choice.type).toBe('button'); expect(available(choice)).toBe(true);
      actions.push(`direction:${direction}`); choice.click(); await flush();
      expect(el('entry-direction-chooser').hidden).toBe(true);
      expect(document.activeElement).toBe(el('score-editor')); writing(); noGeneralTask();
      expect(accepted()).toEqual(beforeChoice);
      expect(recipe()).toEqual({ ...previousRecipe, 'event-direction': direction });
      expect(recipe()['event-duration']).toBe('quarter'); expect(recipe()['event-dots']).toBe('0');
      cursors.push(app!.session.cursor);

      expect((await press('Enter')).defaultPrevented).toBe(true); writing(); noGeneralTask();
      expect(app!.session.revision).toBe(beforeChoice.revision + 1);
      expect(app!.session.score.staves).toHaveLength(1); expect(app!.session.score.staves[0].measures).toHaveLength(1);
      expect(events()).toHaveLength(index + 1);
      const event = events()[index]; ids.push(event.id);
      expect(event).toMatchObject({ kind: 'road', pitchDirection: direction, duration: 'quarter', dots: 0,
        pitches: [], onset: rational(index, 4), time: rational(1, 4), tupletIds: [], tie: 'none', measureRest: false });
      expect(events().map(item => item.pitchDirection)).toEqual(phrase.slice(0, index + 1));
      expect(app!.session.cursor).toEqual({ staffId: 'roads', measureId: 'road-bar', voiceIndex: 0, eventId: event.id });
      expect(app!.session.source.querySelector('[pitch], [pitches], music-note, music-rest, music-slash')).toBeNull();
      expect(recipe()).toEqual({ ...initialRecipe, 'event-direction': direction });
      snapshots.push(app!.session.project.sourceHtml);
    }

    expect(new Set(ids).size).toBe(4);
    expect(events().map(event => event.id)).toEqual(ids);
    expect(add(events()[3].onset, events()[3].time)).toEqual(rational(1));
    expect(app!.session.revision).toBe(initial.revision + 4);
    expect(actions).toEqual(phrase.flatMap(direction => ['click:entry-direction-trigger', `direction:${direction}`, 'key:Enter']));
    const finalRecipe = recipe();
    for (let index = 3; index >= 0; index--) {
      expect((await press('z', { ctrlKey: true })).defaultPrevented).toBe(true);
      expect(app!.session.project.sourceHtml).toBe(snapshots[index]);
      expect(app!.session.cursor).toEqual(cursors[index]);
      expect(events().map(event => event.id)).toEqual(ids.slice(0, index));
      expect(recipe()).toEqual(finalRecipe); writing(); noGeneralTask();
      expect(app!.session.canUndo).toBe(index > 0); expect(app!.session.canRedo).toBe(true);
    }
    // Even a changed next direction must retain the four musical Redo steps.
    const afterUndo = accepted(); await click('entry-direction-trigger');
    directionButton('lower').click(); await flush();
    expect(accepted()).toEqual(afterUndo); expect(recipe()).toEqual({ ...finalRecipe, 'event-direction': 'lower' });
    expect(document.activeElement).toBe(el('score-editor'));
    expect(events()).toEqual([]); expect(app!.session.source.querySelector('music-rest')).toBeNull();
    const nextRecipe = recipe();
    for (let index = 0; index < phrase.length; index++) {
      expect((await press('z', { ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(true);
      expect(app!.session.project.sourceHtml).toBe(snapshots[index + 1]);
      expect(events().map(event => event.id)).toEqual(ids.slice(0, index + 1));
      expect(events().map(event => event.pitchDirection)).toEqual(phrase.slice(0, index + 1));
      expect(app!.session.cursor).toEqual({ staffId: 'roads', measureId: 'road-bar', voiceIndex: 0, eventId: ids[index] });
      expect(recipe()).toEqual(nextRecipe); writing(); noGeneralTask();
      expect(app!.session.canUndo).toBe(true); expect(app!.session.canRedo).toBe(index < phrase.length - 1);
    }
  });
});
