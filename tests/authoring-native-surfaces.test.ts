// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeSurfaces } from '../src/authoring/native-surfaces.js';
import type { NativeSurfacesOptions } from '../src/authoring/native-surfaces.js';

const cleanups: (() => void)[] = [];
const ids = ['location-panel', 'entry-settings', 'source-panel', 'score-setup', 'continuation-review', 'pointer-recovery'];

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing surface fixture ${id}`);
  return result as T;
}

function markup(): string {
  return `<button id="outside">Outside</button><button id="view-read">Read</button>
    <button id="document-trigger" popovertarget="document-menu">Document</button><section id="document-menu" popover="auto">Document's owner</section>
    <button id="note-trigger" popovertarget="note-editor">Edit note</button><section id="note-editor" popover="auto">Note editor's owner</section>
    ${ids.map(id => `<button id="open-${id}" popovertarget="${id}">${id}</button>
      <button id="show-${id}" popovertarget="${id}" popovertargetaction="show">Show</button>
      <section id="${id}" popover="auto" aria-labelledby="heading-${id}">
        <h2 id="heading-${id}">${id}</h2>
        <button id="close-${id}" popovertarget="${id}" popovertargetaction="hide">Close</button>
        <input id="field-${id}" value="draft ${id}">
        <select id="choice-${id}"><option value="a">A</option><option value="b">B</option></select>
      </section>`).join('')}`;
}

function lifecycle(panel: Element, type: 'beforetoggle' | 'toggle', state: 'open' | 'closed', source?: HTMLElement): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && state === 'open' });
  Object.defineProperties(event, {
    newState: { value: state }, oldState: { value: state === 'open' ? 'closed' : 'open' }, source: { value: source ?? null },
  });
  panel.dispatchEvent(event);
  return event;
}

/** Lifecycle only; this does not simulate top-layer rendering, native focus, or Escape. */
function stubNative(panel: HTMLElement) {
  let open = false;
  const originalMatches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : originalMatches(selector));
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

function fixture(native = false, options: Omit<NativeSurfacesOptions, 'ids'> = {}) {
  document.body.innerHTML = markup();
  const nativePanels = new Map<string, ReturnType<typeof stubNative>>();
  for (const id of ids) {
    const panel = element(id);
    if (native) nativePanels.set(id, stubNative(panel));
    else Object.defineProperties(panel, {
      showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
    });
  }
  const beforeOpen = vi.fn(options.beforeOpen ?? (() => {}));
  const afterClose = vi.fn(options.afterClose ?? (() => {}));
  const manager = new NativeSurfaces({ ids, beforeOpen, afterClose });
  cleanups.push(() => manager.dispose());
  return {
    manager, beforeOpen, afterClose, nativePanels,
    panel: (id: string) => element(id),
    trigger: (id: string) => element<HTMLButtonElement>(`open-${id}`),
    close: (id: string) => element<HTMLButtonElement>(`close-${id}`),
    field: (id: string) => element<HTMLInputElement>(`field-${id}`),
  };
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
});

describe('NativeSurfaces native ownership', () => {
  it('keeps native auto popovers, declarative invokers, and labels', () => {
    const value = fixture(true);
    for (const id of ids) {
      expect(value.panel(id).getAttribute('popover')).toBe('auto');
      expect(value.panel(id).hidden).toBe(false);
      expect(value.panel(id).dataset.popoverFallback).toBeUndefined();
      expect(value.panel(id).getAttribute('aria-labelledby')).toBe(`heading-${id}`);
      expect(value.trigger(id).getAttribute('popovertarget')).toBe(id);
      expect(value.close(id).getAttribute('popovertargetaction')).toBe('hide');
      expect(value.trigger(id).getAttribute('aria-controls')).toBe(id);
      expect(value.manager.isOpen(id)).toBe(false);
    }
  });

  it('leaves Document and NoteEditor to their existing owners', () => {
    const value = fixture(true);
    const documentHide = vi.fn();
    const noteHide = vi.fn();
    Object.defineProperty(element('document-menu'), 'hidePopover', { value: documentHide });
    Object.defineProperty(element('note-editor'), 'hidePopover', { value: noteHide });
    value.manager.open('source-panel');
    value.manager.closeAll();
    for (const id of ['document-menu', 'note-editor']) {
      expect(element(id).getAttribute('popover')).toBe('auto');
      expect(element(id).dataset.surfaceState).toBeUndefined();
      expect(element(id).dataset.popoverFallback).toBeUndefined();
    }
    expect(documentHide).not.toHaveBeenCalled();
    expect(noteHide).not.toHaveBeenCalled();
    expect(() => value.manager.open('document-menu')).toThrow('Unmanaged native surface');
  });

  it('opens via the native API and evaluates its opening hook once', () => {
    const value = fixture(true);
    const field = value.field('source-panel');
    const focus = vi.spyOn(field, 'focus');
    expect(value.manager.open('source-panel', '#field-source-panel')).toBe(true);
    expect(value.nativePanels.get('source-panel')?.show).toHaveBeenCalledOnce();
    expect(value.beforeOpen).toHaveBeenCalledExactlyOnceWith('source-panel');
    expect(value.manager.isOpen('source-panel')).toBe(true);
    expect(value.trigger('source-panel').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('reveals its requested native field only within the surface scroll containers', () => {
    const value = fixture(true);
    value.manager.open('source-panel');
    const panel = value.panel('source-panel');
    const field = value.field('source-panel');
    Object.defineProperties(panel, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 200, 100));
    vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 150 - panel.scrollTop, 160, 30));
    panel.scrollTop = 220;
    document.documentElement.scrollTop = 456;
    value.manager.open('source-panel', field);
    expect(panel.scrollTop).toBe(50);
    expect(document.documentElement.scrollTop).toBe(456);
    document.documentElement.scrollTop = 0;
  });

  it('does not replace or cancel native declarative click activation', () => {
    const value = fixture(true);
    const trigger = value.trigger('location-panel');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(value.nativePanels.get('location-panel')?.show).not.toHaveBeenCalled();
    // The native browser's default action is represented only by this lifecycle stub.
    value.nativePanels.get('location-panel')?.show(trigger);
    expect(value.beforeOpen).toHaveBeenCalledExactlyOnceWith('location-panel');
    expect(value.manager.isOpen('location-panel')).toBe(true);
  });

  it('allows a beforeOpen hook to cancel both API and declarative opening', () => {
    const value = fixture(true, { beforeOpen: () => false });
    expect(value.manager.open('source-panel', 'field-source-panel')).toBe(false);
    expect(value.nativePanels.get('source-panel')?.show).not.toHaveBeenCalled();
    value.nativePanels.get('source-panel')?.show(value.trigger('source-panel'));
    expect(value.manager.isOpen('source-panel')).toBe(false);
    expect(value.panel('source-panel').hasAttribute('popover')).toBe(true);
    expect(value.panel('source-panel').dataset.popoverFallback).toBeUndefined();
    expect(value.afterClose).not.toHaveBeenCalled();
  });

  it('does not evade another native listener cancelling beforetoggle', () => {
    const value = fixture(true);
    const panel = value.panel('source-panel');
    panel.addEventListener('beforetoggle', event => { if ((event as ToggleEvent).newState === 'open') event.preventDefault(); });
    expect(value.manager.open('source-panel')).toBe(false);
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(panel.dataset.popoverFallback).toBeUndefined();
    expect(value.afterClose).not.toHaveBeenCalled();
  });

  it('ignores beforetoggle and toggle from a nested select or other descendant', () => {
    const value = fixture(true);
    value.manager.open('entry-settings', 'field-entry-settings');
    const count = value.beforeOpen.mock.calls.length;
    const select = element('choice-entry-settings');
    expect(lifecycle(select, 'beforetoggle', 'open').defaultPrevented).toBe(false);
    lifecycle(select, 'toggle', 'open');
    lifecycle(select, 'beforetoggle', 'closed');
    lifecycle(select, 'toggle', 'closed');
    expect(value.beforeOpen.mock.calls.length).toBe(count);
    expect(value.afterClose).not.toHaveBeenCalled();
    expect(value.manager.isOpen('entry-settings')).toBe(true);
  });

  it('reports a native close once, including an explicit API close followed by toggle', async () => {
    const value = fixture(true);
    value.manager.open('source-panel', 'field-source-panel');
    value.manager.close('source-panel');
    lifecycle(value.panel('source-panel'), 'toggle', 'closed');
    await Promise.resolve();
    expect(value.manager.isOpen('source-panel')).toBe(false);
    expect(value.afterClose).toHaveBeenCalledExactlyOnceWith('source-panel');
    expect(value.trigger('source-panel').getAttribute('aria-expanded')).toBe('false');
  });

  it('uses actual native state when a stale toggle event arrives', () => {
    const value = fixture(true);
    value.manager.open('entry-settings');
    lifecycle(value.panel('entry-settings'), 'toggle', 'closed');
    expect(value.manager.isOpen('entry-settings')).toBe(true);
    expect(value.panel('entry-settings').dataset.surfaceState).toBe('open');
    expect(value.afterClose).not.toHaveBeenCalled();
  });

  it('focuses an already-open surface without rerunning its opening guard', () => {
    const value = fixture(true);
    value.manager.open('source-panel');
    value.manager.open('source-panel', value.field('source-panel'));
    expect(value.beforeOpen).toHaveBeenCalledOnce();
    expect(value.nativePanels.get('source-panel')?.show).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(value.field('source-panel'));
  });

  it('falls back after a failing native show API without running the guard twice', () => {
    const value = fixture(true);
    Object.defineProperty(value.panel('location-panel'), 'showPopover', { value: () => { throw new Error('Native API unavailable'); } });
    expect(value.manager.open('location-panel', 'field-location-panel')).toBe(true);
    expect(value.beforeOpen).toHaveBeenCalledExactlyOnceWith('location-panel');
    expect(value.panel('location-panel').dataset.popoverFallback).toBe('true');
    expect(value.panel('location-panel').hasAttribute('popover')).toBe(false);
    expect(value.manager.isOpen('location-panel')).toBe(true);
    value.close('location-panel').click();
    expect(value.manager.isOpen('location-panel')).toBe(false);
  });
});

describe('NativeSurfaces in-flow fallback', () => {
  it('uses ordinary hidden sections and visible controls, without overlay or menu emulation', () => {
    const value = fixture();
    for (const id of ids) {
      expect(value.panel(id).hidden).toBe(true);
      expect(value.panel(id).dataset.popoverFallback).toBe('true');
      expect(value.panel(id).hasAttribute('popover')).toBe(false);
      expect(value.panel(id).style.position).not.toBe('fixed');
      expect(value.panel(id).style.position).not.toBe('absolute');
      expect(value.panel(id).getAttribute('role')).not.toBe('menu');
      expect(value.trigger(id).hidden).toBe(false);
      expect(value.close(id).hidden).toBe(false);
      expect(value.trigger(id).hasAttribute('popovertarget')).toBe(false);
      expect(value.close(id).hasAttribute('popovertargetaction')).toBe(false);
    }
  });

  it('opens and closes through explicit fallback controls and returns focus without scrolling', () => {
    const value = fixture();
    const trigger = value.trigger('source-panel');
    const focus = vi.spyOn(trigger, 'focus');
    trigger.focus();
    trigger.click();
    expect(value.manager.isOpen('source-panel')).toBe(true);
    expect(value.panel('source-panel').hidden).toBe(false);
    expect(document.activeElement).toBe(value.close('source-panel'));
    value.field('source-panel').focus();
    value.close('source-panel').click();
    expect(value.panel('source-panel').hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(value.afterClose).toHaveBeenCalledExactlyOnceWith('source-panel');
  });

  it('distinguishes Show from Toggle and ignores repeated Close', () => {
    const value = fixture();
    const show = element('show-entry-settings');
    show.click(); show.click();
    expect(value.manager.isOpen('entry-settings')).toBe(true);
    expect(value.beforeOpen).toHaveBeenCalledOnce();
    value.trigger('entry-settings').click();
    expect(value.manager.isOpen('entry-settings')).toBe(false);
    value.manager.close('entry-settings');
    expect(value.afterClose).toHaveBeenCalledOnce();
  });

  it('prevents fallback opening without changing focus when its guard rejects', () => {
    const value = fixture(false, { beforeOpen: () => false });
    element('outside').focus();
    expect(value.manager.open('score-setup', 'field-score-setup')).toBe(false);
    expect(value.panel('score-setup').hidden).toBe(true);
    expect(document.activeElement).toBe(element('outside'));
    expect(value.afterClose).not.toHaveBeenCalled();
  });

  it('retains the actual clicked invoker even when click did not move the old keyboard focus', () => {
    const value = fixture();
    element('outside').focus();
    value.trigger('source-panel').click();
    value.close('source-panel').click();
    expect(document.activeElement).toBe(value.trigger('source-panel'));
  });

  it('does not open when an API guard throws', () => {
    const value = fixture(false, { beforeOpen: () => { throw new Error('Opening is unavailable'); } });
    expect(() => value.manager.open('source-panel')).toThrow('Opening is unavailable');
    expect(value.manager.isOpen('source-panel')).toBe(false);
    expect(value.panel('source-panel').hidden).toBe(true);
    expect(value.afterClose).not.toHaveBeenCalled();
  });

  it('preserves draft fields and native select values across open and close', () => {
    const value = fixture();
    const field = value.field('source-panel');
    field.value = 'unapplied musical HTML';
    const select = element<HTMLSelectElement>('choice-source-panel');
    select.value = 'b';
    value.manager.open('source-panel', field);
    value.manager.close('source-panel');
    value.manager.open('source-panel', field);
    expect(value.field('source-panel')).toBe(field);
    expect(field.value).toBe('unapplied musical HTML');
    expect(select.value).toBe('b');
  });

  it('closes other unrelated owned fallbacks without leaving several form surfaces open', () => {
    const value = fixture();
    value.manager.open('location-panel', 'field-location-panel');
    value.manager.open('entry-settings', 'field-entry-settings');
    expect(value.manager.isOpen('location-panel')).toBe(false);
    expect(value.manager.isOpen('entry-settings')).toBe(true);
    expect(value.afterClose).toHaveBeenCalledExactlyOnceWith('location-panel');
    expect(document.activeElement).toBe(value.field('entry-settings'));
  });

  it('does not light-dismiss an ordinary fallback section on outside clicks', () => {
    const value = fixture();
    value.manager.open('entry-settings');
    element('outside').click();
    expect(value.manager.isOpen('entry-settings')).toBe(true);
  });

  it('preserves an ordinary parent section when its own invoker opens a child surface', () => {
    document.body.innerHTML = markup();
    element('entry-settings').prepend(element('open-location-panel'));
    for (const id of ids) Object.defineProperties(element(id), {
      showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
    });
    const manager = new NativeSurfaces({ ids });
    cleanups.push(() => manager.dispose());
    manager.open('entry-settings');
    element('open-location-panel').click();
    expect(manager.isOpen('entry-settings')).toBe(true);
    expect(manager.isOpen('location-panel')).toBe(true);
    manager.closeAll();
    expect(manager.isOpen('entry-settings')).toBe(false);
    expect(manager.isOpen('location-panel')).toBe(false);
  });

  it('closeAll hides fallbacks without stealing focus from the next view', () => {
    const value = fixture();
    value.manager.open('source-panel', 'field-source-panel');
    const view = element('view-read');
    view.focus();
    value.manager.closeAll();
    expect(value.panel('source-panel').hidden).toBe(true);
    expect(document.activeElement).toBe(view);
    expect(value.afterClose).toHaveBeenCalledExactlyOnceWith('source-panel');
  });

  it('closeAll does not leave keyboard focus inside a hidden fallback', () => {
    const value = fixture();
    value.manager.open('source-panel', 'field-source-panel');
    value.manager.closeAll();
    expect(value.panel('source-panel').contains(document.activeElement)).toBe(false);
  });

  it('does not steal an outside focus target on programmatic Close', () => {
    const value = fixture();
    value.manager.open('source-panel', 'field-source-panel');
    element('outside').focus();
    value.manager.close('source-panel');
    expect(document.activeElement).toBe(element('outside'));
  });

  it('falls back to a connected visible trigger if the original invoker disappears', () => {
    const value = fixture();
    const trigger = value.trigger('source-panel');
    trigger.focus();
    value.manager.open('source-panel', 'field-source-panel');
    trigger.remove();
    value.manager.close('source-panel');
    expect(document.activeElement).toBe(element('show-source-panel'));
  });

  it('does not focus a requested field outside the opened surface or a disabled field', () => {
    const value = fixture();
    value.manager.open('source-panel', 'field-entry-settings');
    expect(document.activeElement).toBe(value.close('source-panel'));
    value.field('source-panel').disabled = true;
    value.manager.open('source-panel', 'field-source-panel');
    expect(document.activeElement).toBe(value.close('source-panel'));
  });
});

describe('NativeSurfaces scope and lifecycle', () => {
  it.each([false, true])('does not intercept native field or Escape keys (native=%s)', native => {
    const value = fixture(native);
    value.manager.open('entry-settings', 'field-entry-settings');
    for (const field of [value.field('entry-settings'), element('choice-entry-settings')]) {
      for (const key of ['Escape', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        field.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    // The lifecycle stub does not certify actual native Escape or picker behavior.
    expect(value.manager.isOpen('entry-settings')).toBe(true);
  });

  it.each([false, true])('disposes only its own surfaces and stops handlers/API actions (native=%s)', async native => {
    const value = fixture(native);
    value.manager.open('source-panel', 'field-source-panel');
    const calls = value.beforeOpen.mock.calls.length;
    value.manager.dispose();
    value.manager.dispose();
    value.trigger('entry-settings').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    lifecycle(value.panel('source-panel'), 'toggle', 'open');
    await Promise.resolve();
    expect(value.manager.open('entry-settings')).toBe(false);
    expect(value.manager.isOpen('source-panel')).toBe(false);
    expect(value.beforeOpen.mock.calls.length).toBe(calls);
    expect(value.afterClose).not.toHaveBeenCalled();
    expect(element('document-menu').hasAttribute('popover')).toBe(true);
    expect(element('note-editor').hasAttribute('popover')).toBe(true);
  });

  it('can reinstall over retained fallback data without losing its invokers', () => {
    const value = fixture();
    value.manager.dispose();
    const manager = new NativeSurfaces({ ids });
    cleanups.push(() => manager.dispose());
    value.trigger('entry-settings').click();
    expect(manager.isOpen('entry-settings')).toBe(true);
    value.close('entry-settings').click();
    expect(manager.isOpen('entry-settings')).toBe(false);
  });

  it('rejects unknown IDs, duplicates, and missing markup without claiming other surfaces', () => {
    const value = fixture();
    expect(() => value.manager.open('not-owned')).toThrow('Unmanaged native surface');
    expect(() => value.manager.close('not-owned')).toThrow('Unmanaged native surface');
    expect(() => value.manager.isOpen('not-owned')).toThrow('Unmanaged native surface');
    expect(() => new NativeSurfaces({ ids: ['source-panel', 'source-panel'] })).toThrow('must be unique');
    expect(() => new NativeSurfaces({ ids: ['source-panel', 'missing-panel'] })).toThrow('Missing native surface: missing-panel');
  });
});
