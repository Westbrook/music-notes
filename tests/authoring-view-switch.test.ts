// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorViewSwitch } from '../src/authoring/ui/view-switch.js';
import type { ViewRequestEvent } from '../src/authoring/ui/view-switch.js';
import type { ViewMode } from '../src/authoring/types.js';

const modes: readonly ViewMode[] = ['write', 'read', 'pages'];

function mount(mode: ViewMode = 'write', parent: HTMLElement | ShadowRoot = document.body): AuthorViewSwitch {
  const view = document.createElement('music-view-switch');
  view.mode = mode;
  parent.append(view);
  view.mount();
  return view;
}

function button(view: AuthorViewSwitch, mode: ViewMode): HTMLButtonElement {
  return view.shadowRoot!.getElementById(`view-${mode}`) as HTMLButtonElement;
}

function pressed(view: AuthorViewSwitch): ViewMode[] {
  return modes.filter(mode => button(view, mode).getAttribute('aria-pressed') === 'true');
}

afterEach(() => document.body.replaceChildren());

describe('shadow Author view switch', () => {
  it('mounts its named navigation and native buttons synchronously in an open root', () => {
    const view = mount();
    expect(view).toBeInstanceOf(AuthorViewSwitch);
    expect(view.shadowRoot?.mode).toBe('open');
    const group = view.shadowRoot!.querySelector('nav')!;
    expect(group.getAttribute('aria-label')).toBe('Workspace view');
    expect(group.querySelectorAll('button')).toHaveLength(3);
    for (const [mode, label] of [['write', 'Write'], ['read', 'Read'], ['pages', 'Pages']] as const) {
      const control = button(view, mode);
      expect(control.textContent).toBe(label);
      expect(control.type).toBe('button');
      expect(control.disabled).toBe(false);
      expect(control.hasAttribute('role')).toBe(false);
      expect(control.hasAttribute('tabindex')).toBe(false);
    }
    expect(pressed(view)).toEqual(['write']);
    expect(view.querySelector('button')).toBeNull();
    expect(document.getElementById('view-write')).toBeNull();
  });

  it('renders owner-supplied accepted modes without emitting requests', async () => {
    const view = mount('read');
    const request = vi.fn();
    view.addEventListener('view-request', request);
    expect(pressed(view)).toEqual(['read']);
    view.mode = 'pages';
    await view.updateComplete;
    expect(pressed(view)).toEqual(['pages']);
    expect(request).not.toHaveBeenCalled();
  });

  it('emits typed requests that bubble out of a surrounding shadow root', () => {
    const outer = document.createElement('div');
    document.body.append(outer);
    const root = outer.attachShadow({ mode: 'open' });
    const view = mount('write', root);
    const received: { event: ViewRequestEvent; path: EventTarget[] }[] = [];
    const listener = (event: ViewRequestEvent): void => { received.push({ event, path: event.composedPath() }); };
    document.body.addEventListener('view-request', listener);
    try {
      for (const mode of modes) button(view, mode).click();
      expect(received.map(({ event }) => event.detail.mode)).toEqual(modes);
      for (const { event, path } of received) {
        expect(event).toBeInstanceOf(CustomEvent);
        expect(event.bubbles).toBe(true);
        expect(event.composed).toBe(true);
        expect(path).toContain(view);
        expect(path).toContain(root);
        expect(path).toContain(document.body);
      }
    } finally {
      document.body.removeEventListener('view-request', listener);
    }
  });

  it('keeps accepted state when the owner does not act on a request', async () => {
    const view = mount();
    const request = vi.fn();
    view.addEventListener('view-request', request);
    button(view, 'read').click();
    await view.updateComplete;
    expect(request).toHaveBeenCalledOnce();
    expect(view.mode).toBe('write');
    expect(pressed(view)).toEqual(['write']);
    button(view, 'pages').click();
    await view.updateComplete;
    expect(view.mode).toBe('write');
    expect(pressed(view)).toEqual(['write']);
  });

  it('accepts the owner response without replacing controls or focus', async () => {
    const view = mount();
    const controls = modes.map(mode => button(view, mode));
    const read = button(view, 'read');
    read.focus();
    view.addEventListener('view-request', event => { view.mode = event.detail.mode; });
    read.click();
    await view.updateComplete;
    expect(view.mode).toBe('read');
    expect(pressed(view)).toEqual(['read']);
    expect(view.shadowRoot!.activeElement).toBe(read);
    expect(document.activeElement).toBe(view);

    view.mode = 'pages';
    await view.updateComplete;
    view.mount();
    expect(modes.map(mode => button(view, mode))).toEqual(controls);
    expect(view.shadowRoot!.activeElement).toBe(read);
    expect(pressed(view)).toEqual(['pages']);
  });

  it('isolates repeated internal IDs and requests across instances and outside controls', async () => {
    const first = mount();
    const second = mount('pages');
    const secondRequest = vi.fn();
    first.addEventListener('view-request', event => { first.mode = event.detail.mode; });
    second.addEventListener('view-request', secondRequest);
    const outside = document.createElement('button');
    outside.id = 'view-read';
    document.body.append(outside);
    outside.click();
    expect(pressed(first)).toEqual(['write']);
    button(first, 'read').click();
    await first.updateComplete;
    expect(pressed(first)).toEqual(['read']);
    expect(pressed(second)).toEqual(['pages']);
    expect(second.mode).toBe('pages');
    expect(secondRequest).not.toHaveBeenCalled();
    expect(button(first, 'read')).not.toBe(button(second, 'read'));
    expect(document.getElementById('view-read')).toBe(outside);
  });

  it('leaves Tab, Space, and Enter behavior to native buttons', () => {
    const view = mount();
    const request = vi.fn();
    view.addEventListener('view-request', request);
    const control = button(view, 'read');
    for (const key of ['Tab', ' ', 'Enter']) {
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true });
        control.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    // Synthetic keys do not run browser defaults. This only checks that the
    // component adds no key interception or duplicate activation path.
    expect(request).not.toHaveBeenCalled();
  });

  it('supports synchronous composition in a detached document', () => {
    const detached = document.implementation.createHTMLDocument('Detached view');
    const view = mount('pages', detached.body);
    expect(view.ownerDocument).toBe(detached);
    expect(pressed(view)).toEqual(['pages']);
    const write = button(view, 'write');
    view.mode = 'write';
    view.mount();
    expect(pressed(view)).toEqual(['write']);
    expect(button(view, 'write')).toBe(write);
  });
});
