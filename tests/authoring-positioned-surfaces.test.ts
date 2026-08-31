// @vitest-environment happy-dom
/**
 * NativeSurfaces integration with a controlled positioning boundary. The native
 * popover lifecycle and positioner are explicit stubs: these tests prove actual
 * invoker/lifecycle/focus ownership, not placement geometry or native top layers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PopoverPositionOptions, PopoverPositioner } from '../src/authoring/popover-position.js';
import { NativeSurfaces } from '../src/authoring/native-surfaces.js';
import type { NativeSurfacesOptions } from '../src/authoring/native-surfaces.js';

interface PositionRecord {
  options: PopoverPositionOptions;
  api: { open: ReturnType<typeof vi.fn<PopoverPositioner['open']>>;
    refresh: ReturnType<typeof vi.fn<PopoverPositioner['refresh']>>;
    close: ReturnType<typeof vi.fn<PopoverPositioner['close']>>;
    dispose: ReturnType<typeof vi.fn<PopoverPositioner['dispose']>> };
}
const positioning = vi.hoisted(() => ({
  create: vi.fn<(options: PopoverPositionOptions) => PopoverPositioner>(),
  records: [] as PositionRecord[],
}));
vi.mock('../src/authoring/popover-position.js', () => ({ createPopoverPositioner: positioning.create }));

const valueId = 'selection-value-chooser';
const pitchId = 'selection-pitch-chooser';
const otherId = 'other-panel';
const ids = [valueId, pitchId, otherId];
const cleanups: (() => void)[] = [];

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id); if (!found) throw new Error(`Missing positioned-surface fixture #${id}.`);
  return found as T;
}
function lifecycle(panel: HTMLElement, type: 'beforetoggle' | 'toggle', state: 'open' | 'closed', source?: HTMLElement): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && state === 'open' });
  Object.defineProperties(event, { newState: { value: state }, oldState: { value: state === 'open' ? 'closed' : 'open' }, source: { value: source ?? null } });
  panel.dispatchEvent(event); return event;
}
function nativeLifecycle(panel: HTMLElement) {
  let open = false; const matches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : matches(selector));
  const show = vi.fn((source?: HTMLElement) => {
    if (open || lifecycle(panel, 'beforetoggle', 'open', source).defaultPrevented) return;
    open = true; lifecycle(panel, 'toggle', 'open', source);
  });
  const hide = vi.fn(() => {
    if (!open) return;
    lifecycle(panel, 'beforetoggle', 'closed'); open = false; lifecycle(panel, 'toggle', 'closed');
  });
  Object.defineProperties(panel, { showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide } });
  return { show, hide, isOpen: () => open };
}
type PlannedOptions = Omit<NativeSurfacesOptions, 'ids'> & {
  positionedIds?: readonly string[];
  fallbackFocus?: () => HTMLElement | null;
};
function fixture(native = true, options: PlannedOptions = {}) {
  document.body.innerHTML = `<div id="score-editor" tabindex="0">
    <button id="selection-value" popovertarget="${valueId}">Value</button>
    <button id="selection-pitch" popovertarget="${pitchId}">Pitch</button>
  </div><aside><button id="properties-pitch" popovertarget="${pitchId}">Spelling</button></aside>
  <input id="outside" value="Another draft"><button id="other-trigger" popovertarget="${otherId}">Other</button>
  ${ids.map(id => `<section id="${id}" popover="auto" aria-label="${id}">
    <button id="close-${id}" popovertarget="${id}" popovertargetaction="hide">Close</button>
    <div class="popover-body"><input id="field-${id}" value="Keep this draft"></div></section>`).join('')}`;
  const panels = new Map<string, ReturnType<typeof nativeLifecycle>>();
  for (const id of ids) {
    if (native) panels.set(id, nativeLifecycle(element(id)));
    else Object.defineProperties(element(id), { showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined } });
  }
  const beforeOpen = vi.fn(options.beforeOpen ?? (() => {}));
  const afterClose = vi.fn(options.afterClose ?? (() => {}));
  const manager = new NativeSurfaces({ ids, positionedIds: [valueId, pitchId], fallbackFocus: () => element('score-editor'),
    ...options, beforeOpen, afterClose });
  cleanups.push(() => manager.dispose());
  return { manager, panels, beforeOpen, afterClose,
    field: (id: string) => element<HTMLInputElement>(`field-${id}`),
    async openFrom(id: string, invokerId: string): Promise<void> {
      const invoker = element<HTMLButtonElement>(invokerId); invoker.focus();
      const click = new MouseEvent('click', { bubbles: true, cancelable: true }); invoker.dispatchEvent(click);
      if (native) { expect(click.defaultPrevented).toBe(false); panels.get(id)!.show(invoker); }
      await flush();
    },
  };
}
function position(id: string): PositionRecord {
  const record = positioning.records.find(item => item.options.panel.id === id);
  expect(record, `Native opt-in ${id} has a positioner`).toBeDefined(); return record!;
}
function positionsStarted(): number { return positioning.records.reduce((sum, record) => sum + record.api.open.mock.calls.length, 0); }
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => {
  positioning.records.length = 0; positioning.create.mockReset().mockImplementation(options => {
    const api = { open: vi.fn<PopoverPositioner['open']>(), refresh: vi.fn<PopoverPositioner['refresh']>(),
      close: vi.fn<PopoverPositioner['close']>(), dispose: vi.fn<PopoverPositioner['dispose']>() };
    positioning.records.push({ options, api }); return api;
  });
});
afterEach(async () => {
  cleanups.splice(0).forEach(cleanup => cleanup()); await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('native-only positioned surface lifecycle', () => {
  it('positions Value only after native opening, using the button that actually invoked it', async () => {
    const f = fixture(); const button = element<HTMLButtonElement>('selection-value'); button.focus();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true }); button.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false); expect(positionsStarted()).toBe(0); expect(f.manager.isOpen(valueId)).toBe(false);
    f.panels.get(valueId)!.show(button); await flush();
    expect(f.manager.isOpen(valueId)).toBe(true); expect(position(valueId).api.open).toHaveBeenLastCalledWith(button);
    expect(f.beforeOpen).toHaveBeenCalledExactlyOnceWith(valueId);
  });

  it('anchors the shared Pitch chooser to Properties Spelling, not its first matching toolbar invoker', async () => {
    const f = fixture(); await f.openFrom(pitchId, 'selection-pitch');
    expect(position(pitchId).api.open).toHaveBeenLastCalledWith(element('selection-pitch'));
    f.manager.close(pitchId); await flush();
    await f.openFrom(pitchId, 'properties-pitch');
    expect(position(pitchId).api.open).toHaveBeenLastCalledWith(element('properties-pitch'));
  });

  it('keeps the API opening invoker when the requested field receives focus', async () => {
    const f = fixture(); const invoker = element('properties-pitch'); invoker.focus();
    expect(f.manager.open(pitchId, f.field(pitchId))).toBe(true); await flush();
    expect(document.activeElement).toBe(f.field(pitchId));
    expect(position(pitchId).api.open).toHaveBeenLastCalledWith(invoker);
  });

  it('does not position a native surface that was not opted in', async () => {
    const f = fixture(); await f.openFrom(otherId, 'other-trigger');
    expect(f.manager.isOpen(otherId)).toBe(true); expect(positionsStarted()).toBe(0);
    expect(positioning.records.some(record => record.options.panel.id === otherId)).toBe(false);
  });

  it('refreshes only currently open native opt-ins, never closed, unrelated or disposed surfaces', async () => {
    const f = fixture(); await f.openFrom(valueId, 'selection-value'); await f.openFrom(otherId, 'other-trigger');
    const value = position(valueId); const before = value.api.refresh.mock.calls.length;
    f.manager.refreshPositions();
    expect(value.api.refresh.mock.calls.length).toBe(before + 1);
    for (const record of positioning.records.filter(record => record !== value)) expect(record.api.refresh).not.toHaveBeenCalled();
    f.manager.close(valueId); f.manager.refreshPositions(); expect(value.api.refresh.mock.calls.length).toBe(before + 1);
    f.manager.dispose(); f.manager.refreshPositions(); expect(value.api.refresh.mock.calls.length).toBe(before + 1);
  });

  it.each(['manager', 'native'] as const)('stops positioning on %s closure and disposes its owned positioners', async closure => {
    const f = fixture(); await f.openFrom(valueId, 'selection-value'); const value = position(valueId);
    const before = value.api.close.mock.calls.length;
    if (closure === 'manager') f.manager.close(valueId); else f.panels.get(valueId)!.hide();
    await flush(); expect(value.api.close.mock.calls.length).toBeGreaterThan(before); expect(f.manager.isOpen(valueId)).toBe(false);
    f.manager.dispose();
    for (const record of positioning.records) expect(record.api.dispose).toHaveBeenCalledOnce();
    f.manager.dispose();
    for (const record of positioning.records) expect(record.api.dispose).toHaveBeenCalledOnce();
  });

  it('never positions ordinary in-flow fallback sections', async () => {
    const f = fixture(false); await f.openFrom(valueId, 'selection-value'); await f.openFrom(pitchId, 'properties-pitch');
    expect(f.manager.isOpen(pitchId)).toBe(true); expect(element(pitchId).dataset.popoverFallback).toBe('true');
    f.manager.refreshPositions(); expect(positionsStarted()).toBe(0);
    for (const record of positioning.records) expect(record.api.refresh).not.toHaveBeenCalled();
  });

  it.each(['hook', 'beforetoggle'] as const)('does not position an opening canceled by %s', async cancellation => {
    const f = fixture(true, cancellation === 'hook' ? { beforeOpen: () => false } : {});
    if (cancellation === 'beforetoggle') element(valueId).addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState === 'open') event.preventDefault();
    });
    await f.openFrom(valueId, 'selection-value');
    expect(f.manager.isOpen(valueId)).toBe(false); expect(positionsStarted()).toBe(0);
    expect(element(valueId).getAttribute('popover')).toBe('auto'); expect(element(valueId).dataset.popoverFallback).toBeUndefined();
  });

  it('does not position when a failing native API falls back to an ordinary section', async () => {
    const f = fixture(); f.panels.get(valueId)!.show.mockImplementation(() => { throw new Error('Native popovers unavailable'); });
    element('selection-value').focus(); expect(f.manager.open(valueId)).toBe(true); await flush();
    expect(element(valueId).dataset.popoverFallback).toBe('true'); expect(positionsStarted()).toBe(0);
    // Reopening an already-visible fallback may focus its field, but must not
    // re-enter the positioner left over from the failed native API.
    expect(f.manager.open(valueId, f.field(valueId))).toBe(true);
    expect(document.activeElement).toBe(f.field(valueId));
    f.manager.refreshPositions(); for (const record of positioning.records) expect(record.api.refresh).not.toHaveBeenCalled();
  });
});

describe('unavailable invoker cleanup and focus ownership', () => {
  it('closes only the unavailable native surface and restores valid fallback focus without scrolling', async () => {
    const f = fixture(); await f.openFrom(valueId, 'selection-value'); await f.openFrom(otherId, 'other-trigger');
    const value = position(valueId); expect(value.options.onAnchorUnavailable).toBeTypeOf('function');
    element('selection-value').hidden = true; f.field(valueId).focus(); const fallback = element('score-editor'); const focus = vi.spyOn(fallback, 'focus');
    value.options.onAnchorUnavailable!(); await flush();
    expect(f.manager.isOpen(valueId)).toBe(false); expect(f.manager.isOpen(otherId)).toBe(true);
    expect(f.panels.get(otherId)!.hide).not.toHaveBeenCalled(); expect(f.afterClose).toHaveBeenCalledExactlyOnceWith(valueId);
    expect(document.activeElement).toBe(fallback); expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(element('selection-value').getAttribute('aria-expanded')).toBe('false'); expect(value.api.close).toHaveBeenCalled();
  });

  it('does not steal focus from an external field selected before anchor loss', async () => {
    const f = fixture(); await f.openFrom(valueId, 'selection-value');
    const value = position(valueId); element('selection-value').hidden = true;
    const outside = element<HTMLInputElement>('outside'); outside.focus(); const focus = vi.spyOn(element('score-editor'), 'focus');
    value.options.onAnchorUnavailable!(); await flush();
    expect(f.manager.isOpen(valueId)).toBe(false); expect(document.activeElement).toBe(outside); expect(focus).not.toHaveBeenCalled();
    expect(outside.value).toBe('Another draft');
  });

  it('does not override a newly focused external field during native closure', async () => {
    const f = fixture(true, { afterClose: () => element('outside').focus() }); await f.openFrom(valueId, 'selection-value');
    const value = position(valueId); element('selection-value').hidden = true; f.field(valueId).focus();
    const focus = vi.spyOn(element('score-editor'), 'focus');
    value.options.onAnchorUnavailable!(); await flush();
    expect(f.manager.isOpen(valueId)).toBe(false); expect(document.activeElement).toBe(element('outside')); expect(focus).not.toHaveBeenCalled();
  });

  it('does not focus an unavailable fallback or disturb another surface after disposal', async () => {
    const f = fixture(); await f.openFrom(valueId, 'selection-value');
    const value = position(valueId); element('selection-value').hidden = true; element('score-editor').hidden = true; f.field(valueId).focus();
    const focus = vi.spyOn(element('score-editor'), 'focus'); value.options.onAnchorUnavailable!(); await flush();
    expect(f.manager.isOpen(valueId)).toBe(false); expect(focus).not.toHaveBeenCalled();
    f.manager.dispose(); const outside = element('outside'); outside.focus();
    value.options.onAnchorUnavailable!(); await flush(); expect(document.activeElement).toBe(outside); expect(focus).not.toHaveBeenCalled();
  });
});
