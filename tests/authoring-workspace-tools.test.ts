// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { WorkspaceTools } from '../src/authoring/workspace-tools.js';
import type { WorkspaceTool, WorkspaceToolsOptions, WorkspaceToolsTransition } from '../src/authoring/workspace-tools.js';

const cleanup: (() => void)[] = [];
const generalTools = ['rhythm', 'markings', 'measure'] as const;
const toolNames: WorkspaceTool[] = ['edit', ...generalTools];
const panelIds: Record<WorkspaceTool, string> = {
  edit: 'selection-inspector', rhythm: 'passage-inspector', markings: 'annotation-inspector', measure: 'measure-inspector',
};
const tabLabels = { rhythm: 'Relationships', markings: 'Instructions', measure: 'Measure' };

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error('Missing fixture control ' + id);
  return result as T;
}

function markup(): string {
  return [
    '<button id="view-write">Write</button><button id="view-read">Read</button><button id="view-pages">Pages</button>',
    '<button id="tools-toggle"><span aria-hidden="true">+</span><span data-tools-toggle-label>Tools</span></button>',
    '<button id="add-chord-symbol">Add chord symbol</button><button id="outside-action">Outside</button>',
    '<section id="score-editor" tabindex="0"></section><input id="event-pitch" value="F#5">',
    '<textarea id="source-input">accepted musical HTML</textarea>',
    '<aside id="workspace-tools" hidden><h2 id="workspace-tools-heading">Writing tools</h2>',
    '<button id="other-tools">Other tools</button><button id="back-to-properties" hidden>Back to properties</button>',
    '<div id="tools-tablist" role="tablist" aria-label="Writing tools" hidden>',
    ...generalTools.map((tool, index) => '<button id="tool-tab-' + tool + '" aria-controls="' + panelIds[tool]
      + '" aria-selected="' + (index === 0) + '">' + tabLabels[tool] + '</button>'),
    '</div><button id="tools-hide">Hide</button>',
    '<button id="tools-expand"><span aria-hidden="true">↕</span><span data-tools-expand-label>Expand task</span></button>',
    '<section id="selection-inspector" aria-labelledby="properties-heading" tabindex="-1">',
    '<h2 id="properties-heading">Properties</h2><p id="event-form-context">A4 · Flute · bar 8</p>',
    '<input id="edit-field" value="A4"><button id="edit-action">Apply chord pitches</button></section>',
    '<section id="passage-inspector" hidden><input id="rhythm-field" value="3:2">',
    '<section id="tuplet-inspector"><input id="nested-field"></section></section>',
    '<section id="annotation-inspector" hidden><textarea id="annotation-text">Dm9</textarea>',
    '<select id="annotation-kind"><option value="harmony">Harmony</option><option value="tempo">Tempo</option></select></section>',
    '<section id="measure-inspector" hidden><input id="measure-meter" value="4/4"><button id="measure-action">Apply measure</button></section>',
    '</aside>',
  ].join('');
}

function fixture(options: WorkspaceToolsOptions = {}, hasPropertiesTarget = true) {
  document.body.innerHTML = markup();
  document.body.dataset.view = 'write';
  const beforeChange = vi.fn(options.beforeChange ?? (() => {}));
  const onOpen = vi.fn(options.onOpen ?? (() => {}));
  const afterChange = vi.fn(options.afterChange ?? (() => {}));
  const onReturnToScore = vi.fn(options.onReturnToScore ?? (() => {}));
  const controller = new WorkspaceTools({ ...options, beforeChange, onOpen, afterChange, onReturnToScore });
  controller.setEntryContext({ entryMode: false, hasPropertiesTarget });
  cleanup.push(() => controller.dispose());
  return {
    controller, beforeChange, onOpen, afterChange, onReturnToScore,
    pane: element('workspace-tools'), toggle: element<HTMLButtonElement>('tools-toggle'),
    hide: element<HTMLButtonElement>('tools-hide'), expand: element<HTMLButtonElement>('tools-expand'),
    other: element<HTMLButtonElement>('other-tools'), back: element<HTMLButtonElement>('back-to-properties'),
    tablist: element('tools-tablist'),
    tab: (tool: typeof generalTools[number]) => element<HTMLButtonElement>('tool-tab-' + tool),
    panel: (tool: WorkspaceTool) => element(panelIds[tool]),
  };
}

/** Short-screen layout: the whole pane scrolls and each form keeps its natural height. */
function shortPaneGeometry(value: ReturnType<typeof fixture>): void {
  value.pane.style.overflow = 'auto';
  Object.defineProperties(value.pane, {
    clientHeight: { value: 160 }, scrollHeight: { value: 960 },
    clientWidth: { value: 320 }, scrollWidth: { value: 440 },
  });
  vi.spyOn(value.pane, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 320, 160));
  for (const tool of toolNames) {
    const panel = value.panel(tool);
    Object.defineProperties(panel, {
      clientHeight: { value: 720 }, scrollHeight: { value: 720 },
      clientWidth: { value: 400 }, scrollWidth: { value: 400 },
    });
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(12 - value.pane.scrollLeft, 196 - value.pane.scrollTop, 400, 720));
  }
  generalTools.forEach((tool, index) => {
    vi.spyOn(value.tab(tool), 'getBoundingClientRect').mockImplementation(() => new DOMRect(12 + index * 103 - value.pane.scrollLeft, 146 - value.pane.scrollTop, 96, 36));
  });
  vi.spyOn(element('outside-action'), 'getBoundingClientRect').mockImplementation(() => new DOMRect(250, 310, 70, 44));
  vi.spyOn(value.toggle, 'getBoundingClientRect').mockImplementation(() => new DOMRect(150, 310, 70, 44));
}

/** Model the browser clamping scroll after a wider sheet shortens a form. */
function clampedScroll(value: ReturnType<typeof fixture>, target: HTMLElement, property: 'scrollTop' | 'scrollLeft', side: number, sheet: number): void {
  let position = 0;
  const limit = () => value.controller.state.presentation === 'closed' ? 0
    : value.controller.state.presentation === 'sheet' ? sheet : side;
  Object.defineProperty(target, property, {
    get: () => { position = Math.min(position, limit()); return position; },
    set: (next: number) => { position = Math.max(0, Math.min(next, limit())); },
  });
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function expectActive(value: ReturnType<typeof fixture>, tool: WorkspaceTool): void {
  expect(value.controller.state.tab).toBe(tool);
  expect(value.controller.state.view).toBe(tool === 'edit' ? 'properties' : 'tools');
  expect(value.pane.dataset.activeTool).toBe(tool);
  expect(value.pane.dataset.toolsView).toBe(tool === 'edit' ? 'properties' : 'tools');
  expect(value.tablist.hidden).toBe(tool === 'edit');
  expect(value.other.hidden).toBe(tool !== 'edit');
  for (const candidate of toolNames) expect(value.panel(candidate).hidden).toBe(candidate !== tool);
  for (const candidate of generalTools) {
    expect(value.tab(candidate).getAttribute('aria-selected')).toBe(String(candidate === value.controller.state.generalTab));
  }
}

afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
  for (const name of ['view', 'toolsOpen', 'toolsExpanded', 'toolsPresentation']) delete document.body.dataset[name];
  document.documentElement.scrollTop = 0;
});

describe('WorkspaceTools Properties and general-tool navigation', () => {
  it('starts with a closed untabbed Properties region and three mounted general panels', () => {
    const value = fixture();
    expect(value.controller.state).toEqual({ mode: 'write', open: false, expanded: false, tab: 'edit', view: 'properties', generalTab: 'rhythm', visible: false, panePlacement: 'side', presentation: 'closed' });
    expect(value.pane.hidden).toBe(true);
    expect(value.pane.hasAttribute('popover')).toBe(false);
    expect(value.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.dataset.toolsOpen).toBe('false');
    expectActive(value, 'edit');
    expect(document.getElementById('tool-tab-edit')).toBeNull();
    expect(value.panel('edit').getAttribute('role')).toBe('region');
    expect(value.panel('edit').getAttribute('aria-labelledby')).toBe('properties-heading');
    expect(value.beforeChange).not.toHaveBeenCalled();
    expect(value.afterChange).not.toHaveBeenCalled();
  });

  it('links only Relationships, Instructions and Measure as actual tabs', () => {
    const value = fixture();
    expect(value.tablist.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(value.tablist.getAttribute('aria-orientation')).toBe('horizontal');
    for (const tool of generalTools) {
      expect(value.tab(tool).textContent).toBe(tabLabels[tool]);
      expect(value.tab(tool).type).toBe('button');
      expect(value.tab(tool).getAttribute('role')).toBe('tab');
      expect(value.tab(tool).getAttribute('aria-controls')).toBe(value.panel(tool).id);
      expect(value.panel(tool).getAttribute('role')).toBe('tabpanel');
      expect(value.panel(tool).getAttribute('aria-labelledby')).toBe(value.tab(tool).id);
    }
  });

  it('preserves open(edit) compatibility as a direct Properties route, never a fourth tab', () => {
    const value = fixture();
    value.controller.open('edit', '#edit-field', element('outside-action'));
    expectActive(value, 'edit');
    expect(value.controller.state.visible).toBe(true);
    expect(document.activeElement).toBe(element('edit-field'));
    expect(value.tablist.hidden).toBe(true);
    expect(value.back.hidden).toBe(true);
  });

  it('uses Other tools and Back to properties in one pane, retaining the last general tab', () => {
    const value = fixture();
    value.controller.open('edit');
    value.other.click();
    expectActive(value, 'rhythm');
    expect(value.back.hidden).toBe(false);
    value.tab('markings').click();
    value.back.click();
    expectActive(value, 'edit');
    expect(document.activeElement).toBe(value.panel('edit'));
    value.other.click();
    expectActive(value, 'markings');
    expect(document.activeElement).toBe(value.tab('markings'));
    expect(document.querySelectorAll('#workspace-tools')).toHaveLength(1);
  });

  it('More opens the remembered general tab without inventing a Properties target', () => {
    const value = fixture({}, false);
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    value.toggle.click();
    expectActive(value, 'rhythm');
    expect(value.back.hidden).toBe(true);
    value.tab('measure').click();
    value.hide.click();
    value.toggle.click();
    expectActive(value, 'measure');
    expect(value.back.hidden).toBe(true);
  });

  it('show without a held target opens the remembered general tool, including its disabled-tab fallback', () => {
    const value = fixture({}, false);
    value.controller.show();
    expectActive(value, 'rhythm');
    value.controller.open('measure'); value.controller.hide();
    value.controller.show(); expectActive(value, 'measure');
    value.controller.hide(); value.tab('measure').disabled = true;
    value.controller.show(); expectActive(value, 'rhythm');
  });

  it('shows and hides without losing its retained view or external invoker', () => {
    const value = fixture();
    value.controller.open('edit', undefined, value.toggle);
    value.hide.click();
    expect(value.pane.hidden).toBe(true);
    expect(document.activeElement).toBe(value.toggle);
    value.controller.show();
    expectActive(value, 'edit');
    value.other.click(); value.tab('markings').click();
    value.controller.hide(); value.controller.show();
    expectActive(value, 'markings');
  });

  it('keeps icon markup and effective layout attributes while expanding and hiding', () => {
    const value = fixture();
    value.controller.open('edit');
    expect(value.toggle.querySelector('[aria-hidden]')?.textContent).toBe('+');
    expect(document.body.dataset.toolsOpen).toBe('true');
    value.expand.click();
    expect(value.expand.querySelector('[aria-hidden]')?.textContent).toBe('↕');
    expect(value.expand.querySelector('[data-tools-expand-label]')?.textContent).toBe('Return to score');
    expect(document.body.dataset.toolsExpanded).toBe('true');
    value.controller.hide();
    expect(document.body.dataset.toolsOpen).toBe('false');
    expect(document.body.dataset.toolsExpanded).toBe('false');
    expect(value.controller.state.expanded).toBe(true);
  });

  it('does not dismiss the persistent pane on an outside selection', () => {
    const value = fixture();
    value.controller.open('markings'); element('outside-action').click();
    expect(value.controller.state.visible).toBe(true);
    expectActive(value, 'markings');
  });

  it('preserves mounted fields, target captions, listeners and the separate insertion recipe', () => {
    const value = fixture();
    const field = element<HTMLInputElement>('edit-field'); field.value = 'A4 C5 E5';
    const meter = element<HTMLInputElement>('measure-meter'); meter.value = '2+2+3/8';
    const listener = vi.fn(); field.addEventListener('input', listener);
    value.panel('edit').dataset.draftTarget = 'note-A';
    value.controller.open('edit'); value.other.click(); value.tab('measure').click(); value.back.click();
    value.controller.hide(); value.controller.show(); value.controller.setMode('pages'); value.controller.setMode('write');
    expect(element('edit-field')).toBe(field);
    expect(field.value).toBe('A4 C5 E5');
    expect(value.panel('edit').dataset.draftTarget).toBe('note-A');
    expect(element('event-form-context').textContent).toBe('A4 · Flute · bar 8');
    expect(element('measure-meter')).toBe(meter); expect(meter.value).toBe('2+2+3/8');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
    expect(element<HTMLTextAreaElement>('source-input').value).toBe('accepted musical HTML');
    field.dispatchEvent(new Event('input')); expect(listener).toHaveBeenCalledOnce();
  });

  it('honors initial general-tool preferences without invoking opening hooks', () => {
    const value = fixture({ initial: { mode: 'read', open: true, expanded: true, tab: 'markings' } });
    expect(value.controller.state).toEqual({ mode: 'read', open: true, expanded: true, tab: 'markings', view: 'tools', generalTab: 'markings', visible: false, panePlacement: 'side', presentation: 'closed' });
    expectActive(value, 'markings'); expect(value.onOpen).not.toHaveBeenCalled();
    value.controller.setMode('write'); expect(value.controller.state.visible).toBe(true);
  });
});

describe('WorkspaceTools entry coexistence', () => {
  it('restores held Properties in one entry-mode activation without changing target or recipe', () => {
    const value = fixture();
    value.controller.open('edit');
    value.panel('edit').scrollTop = 140;
    value.panel('edit').dataset.draftTarget = 'note-A';
    element<HTMLInputElement>('edit-field').value = 'G4 B4';
    value.controller.hide();
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    value.toggle.click();
    expectActive(value, 'edit');
    expect(value.panel('edit').scrollTop).toBe(140);
    expect(value.panel('edit').dataset.draftTarget).toBe('note-A');
    expect(element<HTMLInputElement>('edit-field').value).toBe('G4 B4');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
    expect(value.toggle.getAttribute('aria-expanded')).toBe('true');
    value.toggle.click(); expect(value.controller.state.visible).toBe(false);
  });

  it('More restores held Properties from another open entry task, rather than only closing it', () => {
    const value = fixture();
    value.controller.open('markings');
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    value.toggle.click();
    expectActive(value, 'edit');
    expect(value.controller.state.visible).toBe(true);
    value.other.click(); expectActive(value, 'markings');
  });

  it('keeps More for entry without a held target and does not create one from the last inserted note', () => {
    const value = fixture({}, false);
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: false });
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    value.toggle.click(); expectActive(value, 'rhythm');
    expect(value.back.hidden).toBe(true);
  });

  it('entry-context changes only change navigation presentation, without opening, focusing or notifying layout', () => {
    const value = fixture();
    value.controller.open('edit');
    value.panel('edit').scrollTop = 93;
    element('event-pitch').focus();
    const before = value.beforeChange.mock.calls.length, opened = value.onOpen.mock.calls.length, after = value.afterChange.mock.calls.length;
    const state = value.controller.state;
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    expect(value.controller.state).toEqual(state);
    expect(value.beforeChange.mock.calls).toHaveLength(before);
    expect(value.afterChange.mock.calls).toHaveLength(after);
    expect(value.onOpen.mock.calls).toHaveLength(opened);
    expect(document.activeElement).toBe(element('event-pitch'));
    expect(value.panel('edit').scrollTop).toBe(93);
  });
});

describe('WorkspaceTools explicit More destination toggles', () => {
  it.each(toolNames)('toggles only the matching visible %s destination and retains More focus on close', tool => {
    const value = fixture(); const more = element<HTMLButtonElement>('outside-action'); more.textContent = 'More';
    const scoreFocus = vi.spyOn(element('score-editor'), 'focus');
    const moreFocus = vi.spyOn(more, 'focus');
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('opened');
    expectActive(value, tool); expect(value.controller.state.visible).toBe(true);
    const opened = value.onOpen.mock.calls.length;
    expect(value.controller.isDestinationVisible(tool, true)).toBe(true);
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('closed');
    expect(value.controller.state.visible).toBe(false);
    expect(value.controller.isDestinationVisible(tool, true)).toBe(false);
    expect(document.activeElement).toBe(more);
    expect(moreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(more.textContent).toBe('More');
    expect(value.onOpen.mock.calls).toHaveLength(opened);
    expect(value.onReturnToScore).not.toHaveBeenCalled();
    expect(scoreFocus).not.toHaveBeenCalled();
  });

  it('opens the requested route when another general tool or Properties is visible', () => {
    const value = fixture(); const more = element('outside-action');
    value.controller.open('markings');
    expect(value.controller.isDestinationVisible('edit', true)).toBe(false);
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('opened');
    expectActive(value, 'edit');
    expect(value.controller.toggleDestination('rhythm', { invoker: more, sameContext: true })).toBe('opened');
    expectActive(value, 'rhythm'); expect(value.controller.state.visible).toBe(true);
  });

  it('does not close Properties for A merely because More for B uses the same route', () => {
    const value = fixture(); const more = element('outside-action');
    value.panel('edit').dataset.draftTarget = 'note-A'; element<HTMLInputElement>('edit-field').value = 'unapplied A';
    value.controller.open('edit'); const layoutCalls = value.afterChange.mock.calls.length;
    expect(value.controller.isDestinationVisible('edit', false)).toBe(false);
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: false, focusTarget: '#edit-field' })).toBe('opened');
    expect(value.controller.state.visible).toBe(true); expectActive(value, 'edit');
    expect(value.panel('edit').dataset.draftTarget).toBe('note-A');
    expect(element<HTMLInputElement>('edit-field').value).toBe('unapplied A');
    expect(document.activeElement).toBe(element('edit-field'));
    expect(value.afterChange.mock.calls).toHaveLength(layoutCalls);
  });

  it('keeps ordinary open-only actions open even after the same More route was used', () => {
    const value = fixture(); const more = element('outside-action');
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    value.controller.open('edit', '#edit-field');
    value.controller.open('edit', '#edit-field');
    expect(value.controller.state.visible).toBe(true);
    expect(document.activeElement).toBe(element('edit-field'));
    expect(value.onReturnToScore).not.toHaveBeenCalled();
  });

  it('closes to the current More invoker rather than the older opening control', () => {
    const value = fixture(); const earlier = element('add-chord-symbol'), more = element('outside-action');
    value.controller.open('markings', '#annotation-text', earlier);
    const earlierFocus = vi.spyOn(earlier, 'focus');
    value.controller.toggleDestination('markings', { invoker: more, sameContext: true });
    expect(document.activeElement).toBe(more); expect(earlierFocus).not.toHaveBeenCalled();
    value.controller.open('markings'); value.controller.hide();
    expect(document.activeElement).toBe(more);
  });

  it('retains expansion, scroll, fields and the entry recipe across More close and reopen', () => {
    const value = fixture(); const more = element('outside-action');
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    value.controller.setExpanded(true);
    value.panel('edit').scrollTop = 112; value.panel('edit').scrollLeft = 7;
    value.pane.scrollTop = 28; value.pane.scrollLeft = 3;
    value.panel('edit').dataset.draftTarget = 'note-A'; element<HTMLInputElement>('edit-field').value = 'A4 C5';
    document.documentElement.scrollTop = 370;
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    expect(value.controller.state.expanded).toBe(true);
    expect(value.panel('edit').scrollTop).toBe(112); expect(value.panel('edit').scrollLeft).toBe(7);
    expect(value.pane.scrollTop).toBe(28); expect(value.pane.scrollLeft).toBe(3);
    expect(value.panel('edit').dataset.draftTarget).toBe('note-A');
    expect(element<HTMLInputElement>('edit-field').value).toBe('A4 C5');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
    expect(element<HTMLTextAreaElement>('source-input').value).toBe('accepted musical HTML');
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    expect(document.documentElement.scrollTop).toBe(370);
  });

  it('exposes current destination visibility without changing state, focus, hooks or labels', () => {
    const value = fixture(); const more = element('outside-action'); more.textContent = 'More';
    value.controller.open('measure'); more.focus();
    const state = value.controller.state, calls = value.afterChange.mock.calls.length, opened = value.onOpen.mock.calls.length;
    for (const tool of toolNames) expect(value.controller.isDestinationVisible(tool, true)).toBe(tool === 'measure');
    expect(value.controller.isDestinationVisible('measure', false)).toBe(false);
    expect(value.controller.state).toEqual(state); expect(document.activeElement).toBe(more);
    expect(value.afterChange.mock.calls).toHaveLength(calls); expect(value.onOpen.mock.calls).toHaveLength(opened);
    expect(more.textContent).toBe('More');
  });

  it.each(['hidden', 'disabled', 'inert', 'css-hidden', 'removed', 'inside-pane'] as const)('ignores a stale %s toggle invoker', condition => {
    const value = fixture(); const more = element<HTMLButtonElement>('outside-action');
    value.controller.open('edit');
    if (condition === 'hidden') more.hidden = true;
    if (condition === 'disabled') more.disabled = true;
    if (condition === 'inert') more.setAttribute('inert', '');
    if (condition === 'css-hidden') more.style.display = 'none';
    if (condition === 'removed') more.remove();
    if (condition === 'inside-pane') value.panel('edit').append(more);
    const state = value.controller.state, calls = value.afterChange.mock.calls.length;
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('unavailable');
    expect(value.controller.state).toEqual(state); expect(value.afterChange.mock.calls).toHaveLength(calls);
  });

  it('rejects an invoker from another document without closing this pane or transferring focus', () => {
    const value = fixture(); value.controller.open('edit', '#edit-field');
    const foreign = document.implementation.createHTMLDocument('Other workspace');
    const more = foreign.createElement('button'); more.textContent = 'More'; foreign.body.append(more);
    const focus = vi.spyOn(more, 'focus'), state = value.controller.state;
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('unavailable');
    expect(value.controller.state).toEqual(state); expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element('edit-field'));
  });

  it('rejects a non-focusable element but accepts an explicit programmatic focus target', () => {
    const value = fixture(); value.controller.open('edit');
    const more = document.createElement('div'); more.textContent = 'More'; document.body.append(more);
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('unavailable');
    more.tabIndex = -1; more.setAttribute('role', 'button');
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('closed');
    expect(document.activeElement).toBe(more);
  });

  it('does not focus an invoker adopted into another document by a close-layout hook', () => {
    const foreign = document.implementation.createHTMLDocument('Other workspace');
    const value = fixture({ afterChange: (_state, transition) => {
      if (transition.reason === 'hide') foreign.body.append(element('outside-action'));
    } });
    const more = element('outside-action'); value.controller.open('edit', '#edit-field');
    const moreFocus = vi.spyOn(more, 'focus'), scoreFocus = vi.spyOn(element('score-editor'), 'focus');
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('closed');
    expect(value.controller.state.visible).toBe(false); expect(more.ownerDocument).toBe(foreign);
    expect(moreFocus).not.toHaveBeenCalled(); expect(scoreFocus).not.toHaveBeenCalled();
  });

  it('does not focus an action made non-focusable during closing or substitute another element', () => {
    const more = document.createElement('div'); more.tabIndex = 0;
    const value = fixture({ afterChange: (_state, transition) => {
      if (transition.reason === 'hide') more.removeAttribute('tabindex');
    } });
    document.body.append(more); value.controller.open('edit');
    const moreFocus = vi.spyOn(more, 'focus'), scoreFocus = vi.spyOn(element('score-editor'), 'focus');
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('closed');
    expect(moreFocus).not.toHaveBeenCalled(); expect(scoreFocus).not.toHaveBeenCalled();
  });

  it('does not toggle outside Write, against a disabled destination, or after disposal', () => {
    const value = fixture(); const more = element('outside-action');
    value.tab('measure').disabled = true;
    expect(value.controller.toggleDestination('measure', { invoker: more, sameContext: true })).toBe('unavailable');
    value.controller.open('edit'); value.controller.setMode('read');
    expect(value.controller.isDestinationVisible('edit', true)).toBe(false);
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('unavailable');
    value.controller.setMode('write'); value.controller.dispose();
    const state = value.controller.state;
    expect(value.controller.toggleDestination('edit', { invoker: more, sameContext: true })).toBe('unavailable');
    expect(value.controller.state).toEqual(state);
  });
});

describe('WorkspaceTools three-tab keyboard behavior and focus', () => {
  it('arrows move focus without activating another general tool', () => {
    const value = fixture(); value.controller.open('rhythm');
    const changes = value.afterChange.mock.calls.length;
    expect(key(value.tab('rhythm'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(value.tab('markings'));
    expectActive(value, 'rhythm');
    expect(value.tab('markings').tabIndex).toBe(0);
    expect(value.afterChange.mock.calls).toHaveLength(changes);
  });

  it.each(['Enter', ' '])('%s activates the focused general tab', keyValue => {
    const value = fixture(); value.controller.open('rhythm');
    key(value.tab('rhythm'), 'ArrowRight');
    expect(key(value.tab('markings'), keyValue).defaultPrevented).toBe(true);
    expectActive(value, 'markings');
  });

  it('wraps the three-tab list and supports Home/End without including Properties', () => {
    const value = fixture(); value.controller.open('rhythm');
    key(value.tab('rhythm'), 'ArrowLeft'); expect(document.activeElement).toBe(value.tab('measure'));
    key(value.tab('measure'), 'ArrowRight'); expect(document.activeElement).toBe(value.tab('rhythm'));
    key(value.tab('rhythm'), 'End'); expect(document.activeElement).toBe(value.tab('measure'));
    key(value.tab('measure'), 'Home'); expect(document.activeElement).toBe(value.tab('rhythm'));
    expectActive(value, 'rhythm');
  });

  it('restores the active tab stop after focus leaves the widget', () => {
    const value = fixture(); value.controller.open('rhythm');
    key(value.tab('rhythm'), 'ArrowRight');
    expect(key(value.tab('markings'), 'Tab').defaultPrevented).toBe(false);
    element('rhythm-field').focus();
    expect(value.tab('rhythm').tabIndex).toBe(0); expect(value.tab('markings').tabIndex).toBe(-1);
  });

  it('handles only tab-widget keys and keeps them away from score navigation', () => {
    const value = fixture(); const heard = vi.fn();
    document.addEventListener('keydown', heard); cleanup.push(() => document.removeEventListener('keydown', heard));
    value.controller.open('rhythm'); key(value.tab('rhythm'), 'ArrowRight'); key(value.tab('markings'), 'Enter');
    expect(heard).not.toHaveBeenCalled(); key(value.tab('markings'), 'ArrowDown'); expect(heard).toHaveBeenCalledOnce();
  });

  it.each(['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'a'])('leaves %s to native or owner behavior', keyValue => {
    const value = fixture(); value.controller.open('rhythm');
    expect(key(value.tab('rhythm'), keyValue).defaultPrevented).toBe(false);
    expectActive(value, 'rhythm'); expect(value.controller.state.visible).toBe(true);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }])('does not intercept modified/composing keys: %j', modifier => {
    const value = fixture(); value.controller.open('rhythm');
    expect(key(value.tab('rhythm'), 'ArrowRight', modifier).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(value.tab('rhythm'));
  });

  it('does not handle fields or Properties as part of the general tab widget', () => {
    const value = fixture(); value.controller.open('markings', 'annotation-kind');
    for (const field of ['annotation-kind', 'annotation-text', 'edit-field']) {
      for (const keyValue of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ', 'Escape']) {
        expect(key(element(field), keyValue).defaultPrevented).toBe(false);
      }
    }
    value.controller.open('edit');
    expect(key(value.panel('edit'), 'ArrowRight').defaultPrevented).toBe(false);
    expectActive(value, 'edit');
  });

  it('skips disabled tabs and rejects synthetic activation while the tablist is hidden', () => {
    const value = fixture(); value.tab('markings').disabled = true;
    value.controller.open('rhythm'); key(value.tab('rhythm'), 'ArrowRight');
    expect(document.activeElement).toBe(value.tab('measure'));
    value.back.click();
    value.tab('measure').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(key(value.tab('measure'), 'Enter').defaultPrevented).toBe(false);
    expectActive(value, 'edit');
    value.controller.hide(); value.other.dispatchEvent(new MouseEvent('click'));
    expectActive(value, 'edit'); expect(value.controller.state.visible).toBe(false);
  });

  it('a direct task focuses its field and Hide returns to the original invoker without scrolling', () => {
    const value = fixture(); const invoker = element('add-chord-symbol'); invoker.focus();
    const invokerFocus = vi.spyOn(invoker, 'focus'), field = element('annotation-text'), fieldFocus = vi.spyOn(field, 'focus');
    value.controller.open('markings', '#annotation-text');
    expect(document.activeElement).toBe(field); expect(fieldFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    value.back.click(); value.controller.hide();
    expect(document.activeElement).toBe(invoker); expect(invokerFocus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('accepts explicit invoker/field elements and falls back to the active region for Properties', () => {
    const value = fixture(); const invoker = element('outside-action');
    value.controller.open('edit', element('edit-field'), invoker);
    expect(document.activeElement).toBe(element('edit-field'));
    element<HTMLInputElement>('edit-field').disabled = true;
    value.controller.open('edit', 'edit-field'); expect(document.activeElement).toBe(value.panel('edit'));
    value.controller.hide(); expect(document.activeElement).toBe(invoker);
  });

  it.each(['event-pitch', 'edit-field', 'missing-field'])('ignores a missing or wrong-panel field %s', target => {
    const value = fixture(); value.controller.open('markings', target);
    expect(document.activeElement).toBe(value.tab('markings'));
  });

  it('reveals a direct field inside its remembered panel without scrolling score ancestors', () => {
    const value = fixture(); value.controller.open('markings'); const panel = value.panel('markings'), field = element('annotation-text');
    Object.defineProperties(panel, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 200, 100));
    vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 150 - panel.scrollTop, 160, 30));
    panel.scrollTop = 220; document.documentElement.scrollTop = 456;
    value.controller.open('markings', field);
    expect(panel.scrollTop).toBe(50); expect(document.documentElement.scrollTop).toBe(456);
    expect(document.activeElement).toBe(field);
  });

  it('uses a visible fallback when the original invoker disappears', () => {
    const value = fixture(); const invoker = element('outside-action');
    value.controller.open('edit', undefined, invoker); invoker.remove(); value.controller.hide();
    expect(document.activeElement).toBe(value.toggle);
  });

  it('returns to the score when both the original invoker and entry-only toggle are CSS-hidden', () => {
    const value = fixture(); const invoker = element('outside-action');
    value.controller.open('edit', undefined, invoker);
    invoker.style.display = 'none'; value.toggle.style.display = 'none';
    const score = element('score-editor'), focus = vi.spyOn(score, 'focus');
    value.controller.hide();
    expect(document.activeElement).toBe(score);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not focus a direct field hidden by CSS or an inert ancestor', () => {
    const value = fixture(); const field = element('edit-field');
    field.style.visibility = 'hidden';
    value.controller.open('edit', field); expect(document.activeElement).toBe(value.panel('edit'));
    field.style.visibility = ''; field.setAttribute('inert', '');
    value.controller.open('edit', field); expect(document.activeElement).toBe(value.panel('edit'));
  });

  it('can hide without focus changes when its owner already chose a destination', () => {
    const value = fixture(); value.controller.open('edit'); element('outside-action').focus();
    value.controller.hide(false); expect(document.activeElement).toBe(element('outside-action'));
  });
});

describe('WorkspaceTools short-screen restored focus', () => {
  it.each(generalTools)('reopens scrolled %s from More without focusing its clipped tab or moving restored scroll', tool => {
    const value = fixture(); shortPaneGeometry(value);
    const more = element('outside-action'), field = value.panel(tool).querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
    const scoreFocus = vi.spyOn(element('score-editor'), 'focus'), moreFocus = vi.spyOn(more, 'focus');
    value.controller.toggleDestination(tool, { invoker: more, sameContext: true });
    value.controller.setExpanded(true);
    field.value = 'retained unsaved form';
    value.pane.scrollTop = 214; value.pane.scrollLeft = 29;
    document.documentElement.scrollTop = 456;
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('closed');
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('opened');
    expect(value.controller.state).toMatchObject({ visible: true, tab: tool, expanded: true });
    expect(value.pane.scrollTop).toBe(214); expect(value.pane.scrollLeft).toBe(29);
    expect(value.panel(tool).scrollTop).toBe(0); expect(value.panel(tool).scrollLeft).toBe(0);
    expect(value.panel(tool).querySelector('input, textarea')).toBe(field);
    expect(field.value).toBe('retained unsaved form');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
    expect(element<HTMLTextAreaElement>('source-input').value).toBe('accepted musical HTML');
    expect(document.documentElement.scrollTop).toBe(456);
    expect(document.activeElement).toBe(more);
    expect(moreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(scoreFocus).not.toHaveBeenCalled();
  });

  it('keeps an ordinary default open open-only and uses its visible invoker when the tab is clipped', () => {
    const value = fixture(); shortPaneGeometry(value); const invoker = element('outside-action');
    value.controller.open('rhythm', undefined, invoker);
    value.pane.scrollTop = 230; value.pane.scrollLeft = 18;
    const changes = value.afterChange.mock.calls.length;
    value.controller.open('rhythm', 'event-pitch', invoker);
    expect(value.controller.state.visible).toBe(true);
    expect(value.afterChange.mock.calls).toHaveLength(changes);
    expect(value.pane.scrollTop).toBe(230); expect(value.pane.scrollLeft).toBe(18);
    expect(document.activeElement).toBe(invoker);
  });

  it.each([
    ['vertical', 'rhythm'], ['horizontal', 'rhythm'],
    ['vertical', 'edit'], ['horizontal', 'edit'],
  ] as const)('restoring a 30px %s clip distinguishes an oversized %s destination from a covering Properties region', (axis, tool) => {
    const value = fixture(), more = element('outside-action');
    const height = axis === 'vertical' ? 30 : 160, width = axis === 'horizontal' ? 30 : 320;
    const region = tool === 'edit', destination = region ? value.panel('edit') : value.tab('rhythm');
    value.pane.style.overflow = 'auto';
    Object.defineProperties(value.pane, {
      clientHeight: { value: height }, scrollHeight: { value: 960 },
      clientWidth: { value: width }, scrollWidth: { value: 640 },
    });
    vi.spyOn(value.pane, 'getBoundingClientRect').mockImplementation(() => new DOMRect(100, 100, width, height));
    vi.spyOn(destination, 'getBoundingClientRect').mockImplementation(() => new DOMRect(
      (region || axis === 'horizontal' ? 121 : 141) - value.pane.scrollLeft,
      (region || axis === 'vertical' ? 306 : 326) - value.pane.scrollTop,
      region ? 480 : 44, region ? 720 : 44,
    ));
    const moreFocus = vi.spyOn(more, 'focus'), scoreFocus = vi.spyOn(element('score-editor'), 'focus');
    value.controller.toggleDestination(tool, { invoker: more, sameContext: true });
    value.pane.scrollTop = 214; value.pane.scrollLeft = 29;
    const field = value.panel(tool).querySelector<HTMLInputElement>('input')!;
    field.value = 'retained draft'; document.documentElement.scrollTop = 456;
    value.controller.toggleDestination(tool, { invoker: more, sameContext: true });
    value.controller.toggleDestination(tool, { invoker: more, sameContext: true });
    expect(value.pane.scrollTop).toBe(214); expect(value.pane.scrollLeft).toBe(29);
    expect(field.value).toBe('retained draft');
    expect(value.controller.state).toMatchObject({ visible: true, tab: tool });
    expect(document.activeElement).toBe(region ? destination : more);
    if (!region) expect(moreFocus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(scoreFocus).not.toHaveBeenCalled(); expect(document.documentElement.scrollTop).toBe(456);
  });

  it('reveals an explicit field only inside the outer pane after restoring a natural-height form', () => {
    const value = fixture(); shortPaneGeometry(value);
    const more = element('outside-action'), field = element('annotation-text'), panel = value.panel('markings');
    vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(340 - value.pane.scrollLeft, 600 - value.pane.scrollTop, 100, 30));
    value.controller.open('markings', undefined, more);
    value.pane.scrollTop = 214; value.pane.scrollLeft = 29;
    value.controller.hide(); document.documentElement.scrollTop = 456;
    const fieldFocus = vi.spyOn(field, 'focus');
    value.controller.open('markings', field, more);
    expect(value.pane.scrollTop).toBe(370); expect(value.pane.scrollLeft).toBe(120);
    expect(panel.scrollTop).toBe(0); expect(panel.scrollLeft).toBe(0);
    expect(document.documentElement.scrollTop).toBe(456);
    expect(document.activeElement).toBe(field);
    expect(fieldFocus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it.each([
    ['ArrowRight', 'rhythm', 'markings'], ['ArrowLeft', 'rhythm', 'measure'],
    ['Home', 'measure', 'rhythm'], ['End', 'rhythm', 'measure'],
  ] as const)('%s deliberately reveals the focused tab without activating it or scrolling score ancestors', (keyValue, active, destination) => {
    const value = fixture(); shortPaneGeometry(value);
    value.controller.open(active);
    value.pane.scrollTop = 214; value.pane.scrollLeft = 100;
    document.documentElement.scrollTop = 456;
    const changes = value.afterChange.mock.calls.length;
    expect(key(value.tab(active), keyValue).defaultPrevented).toBe(true);
    const target = value.tab(destination).getBoundingClientRect();
    expect(target.top).toBeGreaterThanOrEqual(100); expect(target.bottom).toBeLessThanOrEqual(260);
    expect(target.left).toBeGreaterThanOrEqual(0); expect(target.right).toBeLessThanOrEqual(320);
    expect(document.activeElement).toBe(value.tab(destination));
    expectActive(value, active); expect(value.afterChange.mock.calls).toHaveLength(changes);
    expect(document.documentElement.scrollTop).toBe(456);
  });

  it.each(['click', 'Enter', ' '] as const)('%s activation reveals its tab after restoring that destination’s outer scroll', action => {
    const value = fixture(); shortPaneGeometry(value);
    value.controller.open('markings'); value.pane.scrollTop = 310; value.pane.scrollLeft = 41;
    element<HTMLTextAreaElement>('annotation-text').value = 'held Dm11';
    value.controller.open('rhythm'); document.documentElement.scrollTop = 456;
    if (action === 'click') value.tab('markings').click();
    else {
      key(value.tab('rhythm'), 'ArrowRight');
      expect(key(value.tab('markings'), action).defaultPrevented).toBe(true);
    }
    const target = value.tab('markings').getBoundingClientRect();
    expect(target.top).toBeGreaterThanOrEqual(100); expect(target.bottom).toBeLessThanOrEqual(260);
    expect(value.pane.scrollTop).toBe(46); expect(value.pane.scrollLeft).toBe(41);
    expect(document.activeElement).toBe(value.tab('markings'));
    expectActive(value, 'markings');
    expect(element<HTMLTextAreaElement>('annotation-text').value).toBe('held Dm11');
    expect(document.documentElement.scrollTop).toBe(456);
  });
});

describe('WorkspaceTools stable frame pane presentation', () => {
  it('records available placement without opening tools or claiming a visible sheet', () => {
    const value = fixture();
    value.controller.setPanePlacement('sheet');
    expect(value.controller.state).toMatchObject({ panePlacement: 'sheet', presentation: 'closed', visible: false, expanded: false });
    expect(document.body.dataset.toolsPresentation).toBe('closed'); expect(value.pane.dataset.toolsPresentation).toBe('closed');
    expect(value.onOpen).not.toHaveBeenCalled();
    expect(value.beforeChange.mock.calls[0][0].reason).toBe('layout');
  });

  it('presents a constrained task as a sheet without inventing expansion or replacing paper', () => {
    const value = fixture(); const score = element('score-editor'), source = element<HTMLTextAreaElement>('source-input');
    score.style.width = '390px'; score.scrollTop = 284; score.scrollLeft = 19;
    value.controller.setPanePlacement('sheet'); value.controller.open('edit');
    expect(value.controller.state).toMatchObject({ panePlacement: 'sheet', presentation: 'sheet', expanded: false, visible: true });
    expect(document.body.dataset.toolsPresentation).toBe('sheet'); expect(value.pane.dataset.toolsPresentation).toBe('sheet');
    expect(value.expand.querySelector('[data-tools-expand-label]')?.textContent).toBe('Return to score');
    expect(value.expand.hasAttribute('aria-pressed')).toBe(false);
    expect(element('score-editor')).toBe(score); expect(score.style.width).toBe('390px');
    expect(score.hidden).toBe(false); expect(score.scrollTop).toBe(284); expect(score.scrollLeft).toBe(19);
    expect(element('source-input')).toBe(source); expect(source.value).toBe('accepted musical HTML');
  });

  it('returns from an automatic sheet on the first activation, retaining fields and all saved scroll', () => {
    const value = fixture(); const more = element('outside-action'), field = element<HTMLInputElement>('edit-field');
    value.controller.setPanePlacement('sheet'); value.controller.open('edit', field, more);
    field.value = 'retained chord'; value.panel('edit').scrollTop = 130; value.panel('edit').scrollLeft = 8;
    value.pane.scrollTop = 29; value.pane.scrollLeft = 3; document.documentElement.scrollTop = 471;
    value.expand.focus(); value.expand.click();
    expect(value.controller.state).toMatchObject({ visible: false, expanded: false, presentation: 'closed', tab: 'edit' });
    expect(value.onReturnToScore).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(more);
    value.controller.open('edit', undefined, more);
    expect(value.controller.state.presentation).toBe('sheet'); expect(element('edit-field')).toBe(field);
    expect(field.value).toBe('retained chord'); expect(value.panel('edit').scrollTop).toBe(130); expect(value.panel('edit').scrollLeft).toBe(8);
    expect(value.pane.scrollTop).toBe(29); expect(value.pane.scrollLeft).toBe(3); expect(document.documentElement.scrollTop).toBe(471);
  });

  it('returns from a manually expanded wide task to its usable side pane', () => {
    const value = fixture(); value.controller.open('markings', 'annotation-text');
    value.controller.setExpanded(true);
    expect(value.controller.state).toMatchObject({ panePlacement: 'side', presentation: 'sheet', expanded: true });
    value.controller.returnToScore();
    expect(value.controller.state).toMatchObject({ presentation: 'side', expanded: false, visible: true, tab: 'markings' });
    expect(value.onReturnToScore).toHaveBeenCalledOnce();
  });

  it('clears deliberate expansion when a constrained sheet returns, without changing More-close retention', () => {
    const value = fixture(); const more = element('outside-action');
    value.controller.open('edit', undefined, more); value.controller.setExpanded(true);
    value.controller.setPanePlacement('sheet');
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    expect(value.controller.state.expanded).toBe(true);
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    value.controller.returnToScore();
    expect(value.controller.state).toMatchObject({ visible: false, expanded: false });
    value.controller.setPanePlacement('side'); value.controller.open('edit');
    expect(value.controller.state.presentation).toBe('side');
  });

  it.each(toolNames)('keeps More a true %s toggle in a sheet without invoking Return or changing source', tool => {
    const value = fixture(); const more = element('outside-action');
    value.controller.setPanePlacement('sheet');
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('opened');
    expect(value.controller.state.presentation).toBe('sheet');
    expect(value.controller.toggleDestination(tool, { invoker: more, sameContext: true })).toBe('closed');
    expect(value.controller.state.presentation).toBe('closed'); expect(document.activeElement).toBe(more);
    expect(value.onReturnToScore).not.toHaveBeenCalled();
    expect(element<HTMLTextAreaElement>('source-input').value).toBe('accepted musical HTML');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
  });

  it('brackets placement changes and preserves a focused pane field without taking ownership of score inertness', () => {
    const stages: string[] = [];
    const value = fixture({
      beforeChange: transition => { if (transition.reason === 'layout') stages.push('before:' + document.body.dataset.toolsPresentation); },
      afterChange: (state, transition) => {
        if (transition.reason === 'layout') stages.push('after:' + document.body.dataset.toolsPresentation);
        element('score-editor').toggleAttribute('inert', state.presentation === 'sheet');
      },
    });
    value.controller.open('markings', 'annotation-text');
    const field = element('annotation-text'); value.panel('markings').scrollTop = 83; value.pane.scrollTop = 17;
    const openings = value.onOpen.mock.calls.length;
    value.controller.setPanePlacement('sheet');
    expect(stages).toEqual(['before:side', 'after:sheet']);
    expect(document.activeElement).toBe(field); expect(value.panel('markings').scrollTop).toBe(83); expect(value.pane.scrollTop).toBe(17);
    expect(value.onOpen.mock.calls).toHaveLength(openings); expect(element('score-editor').hasAttribute('inert')).toBe(true);
    value.controller.setPanePlacement('side');
    expect(document.activeElement).toBe(field); expect(element('score-editor').hasAttribute('inert')).toBe(false);
  });

  it.each(['placement', 'expansion'] as const)('preserves side reading positions when %s clamps a wider sheet without any user scroll', route => {
    const value = fixture(), panel = value.panel('edit');
    clampedScroll(value, panel, 'scrollTop', 500, 20); clampedScroll(value, panel, 'scrollLeft', 100, 8);
    clampedScroll(value, value.pane, 'scrollTop', 200, 8); clampedScroll(value, value.pane, 'scrollLeft', 100, 4);
    value.controller.open('edit', '#edit-field'); element<HTMLInputElement>('edit-field').value = 'held draft';
    panel.scrollTop = 214; panel.scrollLeft = 55; value.pane.scrollTop = 108; value.pane.scrollLeft = 33;
    if (route === 'placement') value.controller.setPanePlacement('sheet'); else value.controller.setExpanded(true);
    expect(panel.scrollTop).toBe(20); expect(panel.scrollLeft).toBe(8);
    expect(value.pane.scrollTop).toBe(8); expect(value.pane.scrollLeft).toBe(4);
    if (route === 'placement') value.controller.setPanePlacement('side'); else value.controller.returnToScore();
    expect(panel.scrollTop).toBe(214); expect(panel.scrollLeft).toBe(55);
    expect(value.pane.scrollTop).toBe(108); expect(value.pane.scrollLeft).toBe(33);
    expect(element<HTMLInputElement>('edit-field').value).toBe('held draft');
    expect(element<HTMLInputElement>('event-pitch').value).toBe('F#5');
    expect(element<HTMLTextAreaElement>('source-input').value).toBe('accepted musical HTML');
  });

  it('retains each presentation’s deliberate reading position through later More close and reopen', () => {
    const value = fixture(), panel = value.panel('edit'), more = element('outside-action');
    clampedScroll(value, panel, 'scrollTop', 500, 20);
    value.controller.open('edit', undefined, more); panel.scrollTop = 214;
    value.controller.setPanePlacement('sheet'); expect(panel.scrollTop).toBe(20);
    panel.scrollTop = 9;
    value.controller.setPanePlacement('side'); expect(panel.scrollTop).toBe(214);
    panel.scrollTop = 321;
    value.controller.setPanePlacement('sheet'); expect(panel.scrollTop).toBe(9);
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    expect(panel.scrollTop).toBe(0);
    value.controller.toggleDestination('edit', { invoker: more, sameContext: true });
    expect(panel.scrollTop).toBe(9);
    value.controller.setPanePlacement('side'); expect(panel.scrollTop).toBe(321);
  });

  it('does not replace saved side reading positions with hidden or clamped sheet values across Read and Pages', () => {
    const value = fixture(), panel = value.panel('measure');
    clampedScroll(value, panel, 'scrollTop', 500, 20);
    value.controller.open('measure'); panel.scrollTop = 214;
    value.controller.setPanePlacement('sheet'); expect(panel.scrollTop).toBe(20);
    value.controller.setMode('read'); expect(panel.scrollTop).toBe(0);
    value.controller.setPanePlacement('side'); value.controller.setMode('pages'); value.controller.setMode('write');
    expect(panel.scrollTop).toBe(214);
    value.controller.setPanePlacement('sheet'); expect(panel.scrollTop).toBe(20);
  });

  it('reports closed across Read and Pages and does not overwrite scroll while placement changes hidden', () => {
    const value = fixture({ initial: { panePlacement: 'sheet' } });
    value.controller.open('measure', 'measure-meter'); value.panel('measure').scrollTop = 142; value.pane.scrollTop = 31;
    value.controller.setMode('read');
    expect(value.controller.state).toMatchObject({ open: true, panePlacement: 'sheet', presentation: 'closed' });
    expect(document.body.dataset.toolsPresentation).toBe('closed');
    value.panel('measure').scrollTop = 0; value.pane.scrollTop = 0;
    value.controller.setPanePlacement('side'); value.controller.setMode('pages');
    expect(value.controller.state.presentation).toBe('closed');
    value.controller.setMode('write');
    expect(value.controller.state).toMatchObject({ presentation: 'side', visible: true, tab: 'measure' });
    expect(value.panel('measure').scrollTop).toBe(142); expect(value.pane.scrollTop).toBe(31);
  });

  it('retains a manually expanded preference through hidden views without reporting an active sheet there', () => {
    const value = fixture({ initial: { panePlacement: 'sheet', open: true, expanded: true } });
    expect(value.controller.state.presentation).toBe('sheet');
    value.controller.setMode('read'); value.controller.setPanePlacement('side'); value.controller.setMode('pages');
    expect(value.controller.state).toMatchObject({ presentation: 'closed', expanded: true });
    value.controller.setMode('write');
    expect(value.controller.state).toMatchObject({ presentation: 'sheet', panePlacement: 'side', expanded: true });
  });

  it('keeps the visible More label and pane relationship stable while exposing destination separately', () => {
    const value = fixture({}, false);
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    expect(value.toggle.getAttribute('aria-controls')).toBe('workspace-tools');
    expect(value.toggle.dataset.toolsDestination).toBe('rhythm');
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
    expect(value.toggle.getAttribute('aria-controls')).toBe('workspace-tools');
    expect(value.toggle.dataset.toolsDestination).toBe('edit'); expect(value.toggle.title).toContain('Properties');
    value.controller.setMode('read'); value.controller.setMode('pages');
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
  });

  it('lets Return preserve the owner-chosen visible anchor focus rather than focusing the selected score', () => {
    const value = fixture({ onReturnToScore: () => element('add-chord-symbol').focus({ preventScroll: true }) });
    value.controller.setPanePlacement('sheet'); value.controller.open('edit', '#edit-field', element('outside-action'));
    const scoreFocus = vi.spyOn(element('score-editor'), 'focus');
    value.controller.returnToScore();
    expect(document.activeElement).toBe(element('add-chord-symbol')); expect(scoreFocus).not.toHaveBeenCalled();
  });

  it('ignores redundant, invalid, hidden-Return, and disposed layout actions', () => {
    const value = fixture();
    value.controller.setPanePlacement('side'); value.controller.setPanePlacement('overlay' as 'side'); value.controller.returnToScore();
    expect(value.beforeChange).not.toHaveBeenCalled();
    value.controller.open('edit'); value.controller.returnToScore();
    expect(value.controller.state.visible).toBe(true); expect(value.onReturnToScore).not.toHaveBeenCalled();
    const state = value.controller.state, calls = value.afterChange.mock.calls.length;
    value.controller.dispose(); value.controller.setPanePlacement('sheet'); value.controller.returnToScore();
    expect(value.controller.state).toEqual(state); expect(value.afterChange.mock.calls).toHaveLength(calls);
  });
});

describe('WorkspaceTools retained scroll, mode and lifecycle', () => {
  it('restores Properties and each general panel scroll through both navigation paths and Hide', () => {
    const value = fixture(); value.controller.open('edit');
    value.panel('edit').scrollTop = 121; value.panel('edit').scrollLeft = 9; value.pane.scrollTop = 33; value.pane.scrollLeft = 4;
    value.other.click(); value.panel('rhythm').scrollTop = 72; value.panel('rhythm').scrollLeft = 3;
    value.pane.scrollTop = 19; value.pane.scrollLeft = 2;
    value.back.click();
    expect(value.panel('edit').scrollTop).toBe(121); expect(value.panel('edit').scrollLeft).toBe(9);
    expect(value.pane.scrollTop).toBe(33); expect(value.pane.scrollLeft).toBe(4);
    value.controller.hide(); value.controller.show(); expect(value.panel('edit').scrollTop).toBe(121);
    value.other.click();
    expect(value.panel('rhythm').scrollTop).toBe(72); expect(value.panel('rhythm').scrollLeft).toBe(3);
    expect(value.pane.scrollTop).toBe(19); expect(value.pane.scrollLeft).toBe(2);
  });

  it('preserves open/expansion/view/scroll through Read and Pages without reopening popovers', () => {
    const closeTransientPopovers = vi.fn(); const value = fixture({ closeTransientPopovers });
    value.controller.open('markings', 'annotation-text'); value.controller.setExpanded(true);
    value.panel('markings').scrollTop = 88; value.controller.setMode('read');
    expect(value.controller.state).toMatchObject({ mode: 'read', open: true, expanded: true, tab: 'markings', view: 'tools', visible: false });
    expect(value.toggle.disabled).toBe(true); expect(document.activeElement).toBe(element('view-read'));
    value.controller.setMode('pages'); value.controller.setMode('write');
    expect(value.controller.state).toMatchObject({ mode: 'write', open: true, expanded: true, tab: 'markings', view: 'tools', visible: true });
    expect(value.panel('markings').scrollTop).toBe(88); expect(closeTransientPopovers).toHaveBeenCalledTimes(3);
  });

  it('does not open closed tools on mode/resize and blocks direct actions outside Write', () => {
    const value = fixture(); value.controller.setMode('read');
    value.controller.open('markings'); value.controller.toggle(); value.controller.setExpanded(true);
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    expect(value.controller.state.open).toBe(false); expect(value.onOpen).not.toHaveBeenCalled();
    value.controller.setMode('write'); window.dispatchEvent(new Event('resize'));
    expect(value.pane.hidden).toBe(true);
  });

  it('brackets layout changes with hooks while view/tab changes retain pane dimensions', () => {
    const stages: string[] = [];
    const value = fixture({
      beforeChange: transition => { stages.push('before:' + transition.reason + ':' + element('workspace-tools').hidden); },
      onOpen: () => { stages.push('open:' + element('workspace-tools').hidden); },
      afterChange: (state, transition) => { stages.push('after:' + transition.reason + ':' + state.visible + ':' + element('workspace-tools').hidden); },
    });
    value.controller.open('rhythm'); value.tab('markings').click(); value.controller.setExpanded(true); value.controller.hide();
    expect(stages).toEqual([
      'before:show:true', 'open:true', 'after:show:true:false',
      'before:tab:false', 'after:tab:true:false',
      'before:expand:false', 'after:expand:true:false',
      'before:hide:false', 'after:hide:false:true',
    ]);
    const transition = value.beforeChange.mock.calls[1][0] as WorkspaceToolsTransition;
    expect(transition.previous.tab).toBe('rhythm'); expect(transition.next.tab).toBe('markings');
    expect(transition.previous.visible).toBe(transition.next.visible);
  });

  it('captures layout before closing native/fallback transient surfaces on mode changes', () => {
    const stages: string[] = [];
    const value = fixture({ beforeChange: () => { stages.push('capture'); }, closeTransientPopovers: () => { stages.push('close'); }, afterChange: () => { stages.push('changed'); } });
    value.controller.setMode('read'); expect(stages).toEqual(['capture', 'close', 'changed']);
  });

  it('direct reopening can focus a field without a duplicate layout transition', () => {
    const value = fixture(); value.controller.open('edit'); const changes = value.afterChange.mock.calls.length;
    value.controller.open('edit', 'edit-field');
    expect(value.afterChange.mock.calls).toHaveLength(changes); expect(document.activeElement).toBe(element('edit-field'));
  });

  it('keeps Return to score explicit and distinct from Hide', () => {
    const value = fixture(); value.controller.open('edit'); value.expand.click();
    expect(value.onReturnToScore).not.toHaveBeenCalled(); value.expand.click();
    expect(value.onReturnToScore).toHaveBeenCalledOnce(); expect(value.controller.state.visible).toBe(true);
    value.controller.hide(); expect(value.onReturnToScore).toHaveBeenCalledOnce();
  });

  it('does not notify layout for unchanged state and returns defensive state copies', () => {
    const value = fixture(); value.controller.hide(); value.controller.setMode('write'); value.controller.setExpanded(false);
    expect(value.beforeChange).not.toHaveBeenCalled();
    const state = value.controller.state as { open: boolean; tab: WorkspaceTool }; state.open = true; state.tab = 'measure';
    expect(value.controller.state.open).toBe(false); expect(value.controller.state.tab).toBe('edit');
  });

  it('closes native popovers when no owner callback exists, tolerating unavailable surfaces', () => {
    const value = fixture(); const first = document.createElement('section'), second = document.createElement('section');
    first.setAttribute('popover', 'auto'); second.setAttribute('popover', 'auto'); const hide = vi.fn();
    Object.defineProperty(first, 'hidePopover', { value: hide });
    Object.defineProperty(second, 'hidePopover', { value: () => { throw new DOMException('Already closed', 'InvalidStateError'); } });
    document.body.append(first, second); expect(() => value.controller.setMode('read')).not.toThrow(); expect(hide).toHaveBeenCalledOnce();
  });

  it('makes listeners and public actions inert after disposal, including entry context', () => {
    const value = fixture(); value.controller.open('edit'); const state = value.controller.state, calls = value.afterChange.mock.calls.length;
    value.controller.dispose(); value.controller.dispose();
    value.toggle.click(); value.hide.click(); value.expand.click(); value.other.click(); value.back.click();
    value.tab('measure').click(); key(value.tab('rhythm'), 'ArrowRight');
    value.controller.hide(); value.controller.open('markings'); value.controller.toggle(); value.controller.setMode('pages'); value.controller.setExpanded(true);
    value.controller.setEntryContext({ entryMode: true, hasPropertiesTarget: true });
    expect(value.controller.state).toEqual(state); expect(value.afterChange.mock.calls).toHaveLength(calls);
    expect(value.toggle.querySelector('[data-tools-toggle-label]')?.textContent).toBe('More');
  });

  it('supports markup without optional Hide and Expand actions', () => {
    document.body.innerHTML = markup(); element('tools-hide').remove(); element('tools-expand').remove();
    const controller = new WorkspaceTools(); cleanup.push(() => controller.dispose());
    expect(() => { controller.open('edit'); controller.hide(); }).not.toThrow();
  });

  it.each(['other-tools', 'back-to-properties', 'tool-tab-rhythm'])('rejects missing required navigation control %s', id => {
    document.body.innerHTML = markup(); element(id).remove();
    expect(() => new WorkspaceTools()).toThrow('Missing workspace tools control: ' + id);
  });

  it('connects the actual Author shell without requiring a fictional Edit tab', () => {
    document.body.innerHTML = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const controller = new WorkspaceTools(); cleanup.push(() => controller.dispose());
    controller.setEntryContext({ entryMode: false, hasPropertiesTarget: true });
    controller.open('edit');
    expect(document.getElementById('tool-tab-edit')).toBeNull();
    expect(element('selection-inspector').getAttribute('role')).toBe('region');
    element<HTMLButtonElement>('other-tools').click();
    expect(element('tools-tablist').querySelectorAll('[role="tab"]')).toHaveLength(3);
    element<HTMLButtonElement>('back-to-properties').click();
    expect(controller.state.tab).toBe('edit');
  });
});
