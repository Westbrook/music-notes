import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, composedAncestors, composedContains, composedParent } from '../src/ui/composed-dom.js';
import { ControlScope } from '../src/authoring/control-scope.js';
import { NativeSurfaces, isNativeSurfaceOpen } from '../src/authoring/native-surfaces.js';
import { WorkspaceTools } from '../src/authoring/workspace-tools.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
  delete document.body.dataset.toolsOpen;
});

function shadow(parent: Node, markup: string) {
  const host = document.createElement('test-feature');
  parent.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = markup;
  return { host, root };
}

/** Happy DOM omits assignedSlot; supply only known platform assignment edges. */
function assigned(element: Element, slot: HTMLSlotElement): void {
  Object.defineProperty(element, 'assignedSlot', { configurable: true, get: () => slot });
}

function scopedSurface() {
  const workspace = document.createElement('section');
  document.body.append(workspace);
  const controls = shadow(workspace, '<button id="open-owned" popovertarget="owned">Open</button>');
  const view = shadow(workspace, `<section id="owned" popover="auto"><button id="close-owned" popovertarget="owned" popovertargetaction="hide">Close</button><input id="owned-field"></section>`);
  const scope = new ControlScope(workspace);
  cleanups.push(scope.register(controls.root), scope.register(view.root));
  const panel = view.root.getElementById('owned')!;
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const manager = new NativeSurfaces({ ids: ['owned'] }, scope);
  cleanups.push(() => manager.dispose());
  return { manager, scope, workspace, controls, view, panel,
    trigger: controls.root.getElementById('open-owned') as HTMLButtonElement,
    close: view.root.getElementById('close-owned') as HTMLButtonElement,
    field: view.root.getElementById('owned-field') as HTMLInputElement };
}

describe('composed DOM boundaries', () => {
  it('follows forwarded slots through their actual presentation ancestors', () => {
    const outer = shadow(document.body, '<div id="outer-clip"><test-forward><slot name="field" slot="forward"></slot></test-forward></div>');
    const forwardHost = outer.root.querySelector('test-forward')!;
    const inner = forwardHost.attachShadow({ mode: 'open' });
    inner.innerHTML = '<div id="inner-clip"><slot name="forward"></slot></div>';
    const field = document.createElement('input'); field.slot = 'field'; outer.host.append(field);
    const outerSlot = outer.root.querySelector('slot')!;
    const innerSlot = inner.querySelector('slot')!;
    assigned(field, outerSlot); assigned(outerSlot, innerSlot);
    expect(composedParent(field)).toBe(outerSlot);
    expect([...composedAncestors(field)].slice(0, 6)).toEqual([
      outerSlot, innerSlot, inner.getElementById('inner-clip'), forwardHost, outer.root.getElementById('outer-clip'), outer.host,
    ]);
    expect(forwardHost.contains(field)).toBe(false);
    expect(composedContains(forwardHost, field)).toBe(true);
    expect(composedContains(inner, field)).toBe(true);
    expect(composedContains(outer.root, field)).toBe(true);
    expect(composedContains(field, field)).toBe(true);
    expect(composedContains(document, field)).toBe(true);
    expect(composedContains(field, null)).toBe(false);
    field.focus();
    expect(activeElement(inner)).toBe(field);
  });

  it('reads deepest focused fields without crossing into unrelated roots', () => {
    const outer = shadow(document.body, '<test-nested></test-nested>');
    const inner = outer.root.querySelector('test-nested')!.attachShadow({ mode: 'open' });
    inner.innerHTML = '<input id="field">';
    const other = shadow(document.body, '<input>');
    const field = inner.getElementById('field')!; field.focus();
    expect(document.activeElement).toBe(outer.host);
    expect(activeElement(document)).toBe(field);
    expect(activeElement(outer.host)).toBe(field);
    expect(activeElement(inner)).toBe(field);
    expect(activeElement(other.root)).toBeNull();
  });

  it('supports explicit closed roots while document reads retain encapsulation', () => {
    const host = document.createElement('test-closed'); document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const field = document.createElement('input'); root.append(field); field.focus();
    expect(activeElement(document)).toBe(host);
    expect(activeElement(root)).toBe(field);
    expect(composedParent(field)).toBe(host);
    expect(composedContains(root, field)).toBe(true);
  });
});

describe('scoped native surfaces', () => {
  it('treats a native close as authoritative while descriptive toggle data is stale', () => {
    const panel = document.createElement('section'); document.body.append(panel);
    panel.setAttribute('popover', 'auto'); panel.dataset.surfaceState = 'open';
    Object.defineProperties(panel, { showPopover: { value: () => {} }, hidePopover: { value: () => {} } });
    const matches = panel.matches.bind(panel);
    vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? false : matches(selector));
    expect(isNativeSurfaceOpen(panel)).toBe(false);
    expect(isNativeSurfaceOpen(panel, { nativeOnly: true })).toBe(false);
  });

  it('finds only registered control roots and restores focus across their shadow boundaries', () => {
    document.body.innerHTML = '<button id="open-owned">Other workspace</button><section id="owned"><input id="owned-field"></section>';
    const value = scopedSurface();
    value.trigger.focus(); value.trigger.click();
    expect(value.manager.isOpen('owned')).toBe(true);
    expect(activeElement(document)).toBe(value.close);
    value.manager.open('owned', 'owned-field');
    expect(activeElement(document)).toBe(value.field);
    value.close.click();
    expect(activeElement(document)).toBe(value.trigger);
    expect(document.getElementById('owned')!.dataset.surfaceState).toBeUndefined();
  });

  it('rejects focus hidden by a composed host and preserves a newer outside focus choice', () => {
    const value = scopedSurface();
    value.trigger.focus(); value.view.host.inert = true;
    value.manager.open('owned', value.field);
    expect(activeElement(document)).toBe(value.trigger);
    value.view.host.inert = false;
    value.manager.open('owned', value.field);
    const other = shadow(document.body, '<button>Another task</button>');
    const outside = other.root.querySelector('button')!; outside.focus();
    value.manager.close('owned');
    expect(activeElement(document)).toBe(outside);
  });

  it('queries open dialogs and select pickers only in explicitly owned roots', () => {
    const workspace = document.createElement('section'); document.body.append(workspace);
    const owned = shadow(workspace, '<dialog open></dialog><select><option>Choice</option></select>');
    shadow(document.body, '<dialog open></dialog>');
    const scope = new ControlScope(workspace);
    const manager = new NativeSurfaces({ ids: [] }, scope); cleanups.push(() => manager.dispose());
    expect(manager.hasOpenSurface()).toBe(false);
    const unregister = scope.register(owned.root);
    expect(manager.hasOpenSurface({ nativeOnly: true })).toBe(true);
    owned.root.querySelector('dialog')!.removeAttribute('open');
    expect(manager.hasOpenSurface()).toBe(false);
    const select = owned.root.querySelector('select')!;
    const matches = select.matches.bind(select);
    vi.spyOn(select, 'matches').mockImplementation(selector => selector === ':open' || matches(selector));
    expect(manager.hasOpenSurface({ nativeOnly: true })).toBe(true);
    unregister();
    expect(manager.hasOpenSurface()).toBe(false);
  });

  it.each([false, true])('binds an owned native panel when another scope repeats its ID (element reference=%s)', references => {
    document.body.innerHTML = '<section id="owned" popover="auto"></section>';
    const workspace = document.createElement('section');
    workspace.innerHTML = '<button id="trigger" popovertarget="owned">Open</button><section id="owned" popover="auto"></section>';
    document.body.append(workspace);
    const panel = workspace.querySelector<HTMLElement>('section')!;
    const trigger = workspace.querySelector('button')!;
    let open = false;
    const matches = panel.matches.bind(panel);
    vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? open : matches(selector));
    const show = vi.fn(() => { open = true; });
    Object.defineProperties(panel, { showPopover: { value: show }, hidePopover: { value: () => { open = false; } } });
    if (references) {
      let target: Element | null = null;
      Object.defineProperty(trigger, 'popoverTargetElement', {
        get: () => target, set: value => { target = value; trigger.setAttribute('popovertarget', ''); },
      });
    } else Object.defineProperty(trigger, 'popoverTargetElement', {
      get: () => null, set: () => { throw new Error('Element references unavailable'); },
    });
    const scope = new ControlScope(workspace);
    const manager = new NativeSurfaces({ ids: ['owned'] }, scope); cleanups.push(() => manager.dispose());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(event);
    if (references) {
      expect(event.defaultPrevented).toBe(false);
      expect(trigger.popoverTargetElement).toBe(panel);
      expect(show).not.toHaveBeenCalled();
      manager.dispose();
      const reinstalled = new NativeSurfaces({ ids: ['owned'] }, scope); cleanups.push(() => reinstalled.dispose());
      expect(trigger.popoverTargetElement).toBe(panel);
      expect(trigger.getAttribute('aria-controls')).toBe('owned');
    } else {
      expect(event.defaultPrevented).toBe(true);
      expect(show).toHaveBeenCalledOnce();
      expect(manager.isOpen('owned')).toBe(true);
    }
    expect(document.getElementById('owned')!.dataset.surfaceState).toBeUndefined();
  });

  it('tracks dynamic panel registration and removes its handlers and fallback blocker on release', () => {
    const workspace = document.createElement('section'); document.body.append(workspace);
    const scope = new ControlScope(workspace);
    const manager = new NativeSurfaces({ ids: [] }, scope); cleanups.push(() => manager.dispose());
    const feature = shadow(document.body, '<button id="trigger">Open</button><section id="dynamic"><input></section>');
    const panel = feature.root.getElementById('dynamic')!;
    const trigger = feature.root.getElementById('trigger')!;
    Object.defineProperties(panel, { showPopover: { value: undefined }, hidePopover: { value: undefined } });
    const release = manager.register(panel, [trigger]);
    trigger.click();
    expect(manager.hasOpenFallback()).toBe(true);
    expect(manager.hasOpenSurface()).toBe(true);
    expect(manager.hasOpenSurface({ nativeOnly: true })).toBe(false);
    expect(isNativeSurfaceOpen(panel)).toBe(true);
    release(); release();
    expect(panel.hidden).toBe(true);
    expect(manager.hasOpenSurface()).toBe(false);
    trigger.click();
    expect(panel.hidden).toBe(true);
    expect(() => manager.open('dynamic')).toThrow('Unmanaged');
  });

  it('reveals a slotted native field through nested surface scrollports only', () => {
    const value = scopedSurface();
    const wrapper = document.createElement('test-scroll'); value.panel.append(wrapper);
    const root = wrapper.attachShadow({ mode: 'open' }); root.innerHTML = '<div id="clip"><slot></slot></div>';
    wrapper.append(value.field);
    const clip = root.getElementById('clip')!;
    assigned(value.field, root.querySelector('slot')!);
    Object.defineProperties(clip, { clientHeight: { value: 80 }, scrollHeight: { value: 300 } });
    vi.spyOn(clip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 80));
    vi.spyOn(value.field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 260 - clip.scrollTop, 180, 30));
    document.documentElement.scrollTop = 300;
    value.manager.open('owned', value.field);
    expect(activeElement(document)).toBe(value.field);
    expect(clip.scrollTop).toBe(110);
    expect(document.documentElement.scrollTop).toBe(300);
    value.manager.close('owned');
    expect(activeElement(document)).toBe(value.trigger);
  });
});

function toolsFixture() {
  const workspace = document.createElement('section'); document.body.append(workspace);
  const feature = shadow(workspace, `<button id="tools-toggle">More</button><button id="view-read">Read</button>
    <aside id="workspace-tools" hidden><button id="other-tools">Other tools</button><button id="back-to-properties">Back</button>
      <div id="tabs" role="tablist"><button id="tool-tab-rhythm">Relationships</button><button id="tool-tab-markings">Instructions</button><button id="tool-tab-measure">Measure</button></div>
      <section id="selection-inspector"><h2 id="properties-heading">Properties</h2><test-form></test-form></section>
      <section id="passage-inspector"></section><section id="annotation-inspector"></section><section id="measure-inspector"></section>
    </aside>`);
  const scope = new ControlScope(workspace); cleanups.push(scope.register(feature.root));
  const formHost = feature.root.querySelector('test-form')!;
  const form = formHost.attachShadow({ mode: 'open' }); form.innerHTML = '<div id="clip"><input id="edit-field"></div>';
  cleanups.push(scope.register(form));
  const tools = new WorkspaceTools({ stateHost: workspace }, scope); cleanups.push(() => tools.dispose());
  return { workspace, feature, form, formHost, scope, tools,
    trigger: feature.root.getElementById('tools-toggle')!, field: form.getElementById('edit-field')!,
    pane: feature.root.getElementById('workspace-tools')! };
}

describe('scoped tools presentation', () => {
  it('focuses nested owned form controls, updates its state host, and restores its invoker', () => {
    const value = toolsFixture();
    value.trigger.focus();
    value.tools.open('edit', 'edit-field');
    expect(activeElement(document)).toBe(value.field);
    expect(value.workspace.dataset.toolsOpen).toBe('true');
    expect(document.body.dataset.toolsOpen).toBeUndefined();
    value.tools.hide();
    expect(activeElement(document)).toBe(value.trigger);
    value.tools.open('edit', value.field);
    value.tools.setMode('read');
    expect(activeElement(document)).toBe(value.feature.root.getElementById('view-read'));
  });

  it('does not focus a field under an inert composed ancestor or a disabled native field', () => {
    const value = toolsFixture();
    value.trigger.focus();
    value.formHost.setAttribute('inert', '');
    value.tools.open('edit', value.field);
    expect(activeElement(document)).not.toBe(value.field);
    value.formHost.removeAttribute('inert');
    (value.field as HTMLInputElement).disabled = true;
    value.tools.open('edit', value.field);
    expect(activeElement(document)).not.toBe(value.field);
  });

  it('reveals a field inside its shadow scrollport without moving the page and stops after disposal', () => {
    const value = toolsFixture();
    const clip = value.form.getElementById('clip')!;
    Object.defineProperties(clip, { clientHeight: { value: 80 }, scrollHeight: { value: 300 } });
    vi.spyOn(clip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 80));
    vi.spyOn(value.field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 260 - clip.scrollTop, 180, 30));
    document.documentElement.scrollTop = 420;
    value.tools.open('edit', value.field);
    expect(clip.scrollTop).toBe(110);
    expect(document.documentElement.scrollTop).toBe(420);
    value.tools.hide(); value.tools.dispose(); value.trigger.click();
    expect(value.pane.hidden).toBe(true);
  });
});
