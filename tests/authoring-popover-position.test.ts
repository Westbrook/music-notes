// @vitest-environment happy-dom
/** Measured-rectangle and native-state doubles only: not native top-layer or browser qualification. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPopoverPositioner } from '../src/authoring/popover-position.js';
import type { PopoverPositionOptions, PopoverPositioner } from '../src/authoring/popover-position.js';

const controllers: PopoverPositioner[] = [];
const descriptors: [object, string, PropertyDescriptor | undefined][] = [];
let width = 1180; let height = 660; let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let visual: VisualViewportDouble;
let sizes: ResizeDouble[];
let mutations: MutationDouble[];

class VisualViewportDouble extends EventTarget { offsetLeft = 0; offsetTop = 0; width = 1180; height = 660; scale = 1; }
class ResizeDouble {
  readonly observe = vi.fn(); readonly disconnect = vi.fn();
  readonly fire: () => void;
  constructor(callback: ResizeObserverCallback) { this.fire = () => callback([], this as unknown as ResizeObserver); sizes.push(this); }
}
class MutationDouble {
  readonly observe = vi.fn(); readonly disconnect = vi.fn();
  readonly fire: () => void;
  constructor(callback: MutationCallback) { this.fire = () => callback([], this as unknown as MutationObserver); mutations.push(this); }
}
function setViewport(w: number, h: number): void { width = w; height = h; visual.width = w; visual.height = h; }
function flushFrame(): void { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); }
function number(value: string, fallback: number): number { const result = Number.parseFloat(value); return Number.isFinite(result) ? result : fallback; }

beforeEach(() => {
  width = 1180; height = 660; frameId = 0; frames = new Map(); sizes = []; mutations = [];
  visual = new VisualViewportDouble(); vi.stubGlobal('visualViewport', visual);
  vi.stubGlobal('ResizeObserver', ResizeDouble); vi.stubGlobal('MutationObserver', MutationDouble);
  for (const [object, key, getter] of [
    [window, 'innerWidth', () => width], [window, 'innerHeight', () => height],
    [document.documentElement, 'clientWidth', () => width], [document.documentElement, 'clientHeight', () => height],
  ] as const) {
    descriptors.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
    Object.defineProperty(object, key, { configurable: true, get: getter });
  }
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { const id = ++frameId; frames.set(id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.dispose());
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [object, key, descriptor] of descriptors.splice(0)) {
    if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
  }
});

function fixture(config: { preferredSide?: 'above' | 'below'; margin?: number; gap?: number; shadow?: boolean; noBody?: boolean } = {}) {
  document.body.innerHTML = '<main><div id="controls"><button id="selection-pitch" type="button" popovertarget="chooser">Pitch</button></div>'
    + '<button id="properties-pitch" type="button" popovertarget="chooser">Spelling</button>'
    + '<section id="chooser" popover="auto"><header class="popover-heading">Written value</header>'
    + '<div class="popover-body" style="padding:10px"><input id="field" value="quarter" style="min-height:44px"><button style="min-height:44px">Close</button></div></section>'
    + '<music-system id="source"><music-measure><music-note pitch="F4"></music-note></music-measure></music-system></main>';
  const panel = document.getElementById('chooser')!;
  const trigger = document.getElementById('selection-pitch')!;
  const properties = document.getElementById('properties-pitch')!;
  const container = document.getElementById('controls')!;
  const body = panel.querySelector<HTMLElement>('.popover-body')!;
  if (config.noBody) body.classList.remove('popover-body');
  let root: ShadowRoot | undefined;
  if (config.shadow) { root = container.attachShadow({ mode: 'open' }); root.append(trigger); }
  let anchor = new DOMRect(460, 600, 66, 44);
  let second = new DOMRect(870, 120, 100, 44);
  let nativeOpen = true; let zero = false; let naturalWidth = 380; let naturalHeight = (_w: number) => 220;
  let measurementEffect: (() => void) | undefined;
  const matches = panel.matches.bind(panel);
  vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? nativeOpen : matches(selector));
  const show = vi.fn(); const hide = vi.fn();
  Object.defineProperties(panel, { showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide } });
  const measuredWidth = () => Math.min(naturalWidth, number(panel.style.maxWidth, Infinity));
  const measuredHeight = () => Math.min(naturalHeight(measuredWidth()), number(panel.style.maxHeight, Infinity));
  const measure = vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
    measurementEffect?.();
    return zero ? new DOMRect() : new DOMRect(number(panel.style.left, width - measuredWidth() - 12), number(panel.style.top, 12), measuredWidth(), measuredHeight());
  });
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, measuredWidth() - 2,
    Math.max(0, (body.style.flexShrink === '0' ? naturalHeight(measuredWidth()) : measuredHeight()) - 62)));
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => anchor);
  vi.spyOn(properties, 'getBoundingClientRect').mockImplementation(() => second);
  Object.defineProperties(panel, { clientHeight: { get: () => measuredHeight() }, scrollHeight: { get: () => naturalHeight(measuredWidth()) } });
  const unavailable = vi.fn();
  const options: PopoverPositionOptions = { panel, preferredSide: config.preferredSide, margin: config.margin, gap: config.gap, onAnchorUnavailable: unavailable };
  const controller = createPopoverPositioner(options); controllers.push(controller);
  return { controller, panel, body, trigger, properties, container, root, measure, show, hide, unavailable,
    open: () => controller.open(trigger), setOpen: (open: boolean) => { nativeOpen = open; },
    setAnchor: (box: DOMRect) => { anchor = box; }, setSecond: (box: DOMRect) => { second = box; },
    setSize: (w: number, h: number | ((w: number) => number)) => { naturalWidth = w; naturalHeight = typeof h === 'number' ? () => h : h; },
    onMeasure: (effect: () => void) => { measurementEffect = effect; },
    zero: (value: boolean) => { zero = value; },
  };
}

describe('native chooser trigger placement', () => {
  it('places above the actual bottom-dock invoker and overrides the generic top-right inset', () => {
    const f = fixture(); f.panel.style.inset = '12px 12px auto auto'; f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 460, y: 372, width: 380, height: 220 });
    expect(f.panel.style.position).toBe('fixed'); expect(f.panel.style.right).toBe('auto'); expect(f.panel.style.bottom).toBe('auto');
    expect(f.panel.style.margin).toBe('0px'); expect(f.panel.getAttribute('popover')).toBe('auto');
  });

  it('flips below when the preferred upper side cannot fit', () => {
    const f = fixture(); f.setAnchor(new DOMRect(120, 24, 66, 44)); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 120, y: 76, height: 220 });
  });

  it('honors an explicit below preference and caller gutter/gap', () => {
    const f = fixture({ preferredSide: 'below', margin: 12, gap: 6 }); f.setAnchor(new DOMRect(2, 180, 66, 44)); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 12, y: 230 });
  });

  it.each([[-20, 10], [1120, 790]])('clamps a trigger at x=%i to the visible horizontal gutter', (x, expected) => {
    const f = fixture(); f.setAnchor(new DOMRect(x, 600, 66, 44)); f.open();
    expect(f.panel.getBoundingClientRect().left).toBe(expected);
  });

  it('fits a 390 × 360 viewport while retaining control target sizes', () => {
    setViewport(390, 360); const f = fixture(); f.setAnchor(new DOMRect(280, 306, 90, 44)); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 10, y: 78, width: 370, height: 220 });
    for (const control of f.body.querySelectorAll<HTMLElement>('input,button')) expect(control.style.minHeight).toBe('44px');
  });

  it('uses shifted visual-viewport coordinates without multiplying by pinch scale', () => {
    const f = fixture(); Object.assign(visual, { offsetLeft: 80, offsetTop: 200, width: 360, height: 300, scale: 2 });
    f.setAnchor(new DOMRect(400, 440, 66, 44)); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 90, y: 212, width: 340, height: 220 });
  });

  it('measures wrapped height only after constraining width, then re-expands after viewport growth', () => {
    setViewport(320, 660); const f = fixture(); f.setSize(380, w => w < 350 ? 400 : 200); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 10, y: 192, width: 300, height: 400 });
    setViewport(1180, 660); window.dispatchEvent(new Event('resize')); flushFrame();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 460, y: 392, width: 380, height: 200 });
    expect(f.panel.style.maxWidth).toBe('1160px');
  });

  it('scrolls a long menu body within available space without reducing its targets', () => {
    const f = fixture(); f.setSize(380, 900); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ y: 10, height: 582 });
    expect(f.body.style.maxHeight).toBe('520px'); expect(f.body.style.overflow).toBe('auto'); expect(f.panel.style.overflow).toBe('hidden');
    setViewport(1180, 1000); f.setAnchor(new DOMRect(460, 930, 66, 44)); visual.dispatchEvent(new Event('resize')); flushFrame();
    expect(f.panel.getBoundingClientRect().height).toBe(900);
  });

  it('uses the clamped viewport when neither adjacent side can retain heading and one full target', () => {
    setViewport(390, 300); const f = fixture(); f.setAnchor(new DOMRect(130, 130, 66, 44)); f.setSize(380, 400); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ y: 10, height: 280 });
    expect(number(f.body.style.maxHeight, 0)).toBeGreaterThanOrEqual(64); expect(f.body.style.overflow).toBe('auto');
  });

  it('allows whole-menu scrolling when an extremely short viewport cannot retain the fixed heading', () => {
    setViewport(390, 100); const f = fixture(); f.setAnchor(new DOMRect(130, 45, 66, 44)); f.setSize(380, 400); f.open();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ y: 10, height: 80 });
    expect(f.panel.style.overflow).toBe('auto'); expect(f.panel.scrollHeight).toBeGreaterThan(f.panel.clientHeight);
    expect(f.body.style.overflow).toBe('visible'); expect(f.body.style.flexShrink).toBe('0');
    expect(f.body.querySelector<HTMLInputElement>('input')!.style.minHeight).toBe('44px');
  });

  it('uses each actual invoker, including Properties Spelling, without resolving a preferred button by ID', () => {
    const f = fixture(); f.open(); expect(f.panel.getBoundingClientRect().left).toBe(460);
    f.controller.close(); f.controller.open(f.properties);
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 790, y: 172 });
    expect(sizes[0].disconnect).toHaveBeenCalledOnce(); expect(sizes[1].observe).toHaveBeenCalledWith(f.properties);
  });
});

describe('native-only positioning and cleanup', () => {
  it.each(['closed', 'fallback', 'missing-api', 'unsupported-selector'] as const)('does not alter or position a %s surface', state => {
    const f = fixture(); f.panel.style.cssText = 'position:static;margin:12px auto;color:green'; const before = f.panel.style.cssText;
    if (state === 'closed') f.setOpen(false);
    if (state === 'fallback') { f.panel.removeAttribute('popover'); f.panel.dataset.popoverFallback = 'true'; }
    if (state === 'missing-api') Object.defineProperty(f.panel, 'showPopover', { value: undefined });
    if (state === 'unsupported-selector') vi.spyOn(f.panel, 'matches').mockImplementation(() => { throw new Error('Unsupported selector'); });
    f.open(); f.controller.refresh(); f.controller.close();
    expect(f.panel.style.cssText).toBe(before); expect(f.measure).not.toHaveBeenCalled();
    expect(sizes).toHaveLength(0); expect(mutations).toHaveLength(0); expect(frames.size).toBe(0); expect(f.unavailable).not.toHaveBeenCalled();
  });

  it('restores owned inline values/priorities, retaining unrelated changes', () => {
    const f = fixture(); f.panel.style.cssText = 'position:relative;inset:12px 9px auto 4px;margin:6px 8px;max-height:500px;color:green';
    f.panel.style.setProperty('right', '9px', 'important'); f.panel.style.setProperty('position-anchor', '--another-button');
    f.panel.style.setProperty('position-try-fallbacks', 'flip-block'); f.body.style.overflow = 'scroll';
    const properties = ['position', 'top', 'right', 'bottom', 'left', 'margin-top', 'margin-left', 'max-height', 'position-anchor', 'position-try-fallbacks'];
    const original = properties.map(property => [property, f.panel.style.getPropertyValue(property), f.panel.style.getPropertyPriority(property)]);
    f.open(); f.panel.style.color = 'red'; f.controller.close();
    for (const [property, value, priority] of original) {
      expect(f.panel.style.getPropertyValue(property), property).toBe(value); expect(f.panel.style.getPropertyPriority(property), property).toBe(priority);
    }
    expect(f.body.style.overflow).toBe('scroll'); expect(f.panel.style.color).toBe('red');
  });

  it('restores overflow axes even when their original inline priorities differ', () => {
    const f = fixture(); const original: [HTMLElement, string, string, string][] = [
      [f.panel, 'overflow-x', 'hidden', 'important'], [f.panel, 'overflow-y', 'scroll', ''],
      [f.panel, 'overscroll-behavior-x', 'contain', 'important'], [f.panel, 'overscroll-behavior-y', 'auto', ''],
      [f.body, 'overflow-x', 'scroll', 'important'], [f.body, 'overflow-y', 'auto', ''],
    ];
    for (const [element, property, value, priority] of original) element.style.setProperty(property, value, priority);
    f.open(); f.controller.close();
    for (const [element, property, value, priority] of original) {
      expect(element.style.getPropertyValue(property), property).toBe(value); expect(element.style.getPropertyPriority(property), property).toBe(priority);
    }
  });

  it('retries zero first measurement only once and can recover on a later measured reflow', () => {
    const f = fixture(); f.zero(true); f.open(); expect(f.panel.style.position).toBe(''); expect(frames.size).toBe(1);
    flushFrame(); expect(frames.size).toBe(0); expect(f.panel.style.position).toBe('');
    f.zero(false); sizes[0].fire(); flushFrame(); expect(f.panel.style.position).toBe('fixed');
    expect(f.show).not.toHaveBeenCalled(); expect(f.hide).not.toHaveBeenCalled();
  });

  it('cleans up actual native closing and ignores late callbacks from the old opening', () => {
    const f = fixture(); f.open(); window.dispatchEvent(new Event('resize'));
    const oldFrame = [...frames.values()][0]; const oldObserver = sizes[0];
    f.setOpen(false); f.panel.dispatchEvent(new Event('toggle'));
    expect(f.panel.style.position).toBe(''); expect(frames.size).toBe(0);
    expect(oldObserver.disconnect).toHaveBeenCalledOnce(); expect(mutations[0].disconnect).toHaveBeenCalledOnce();
    f.setOpen(true); f.controller.open(f.properties); const before = f.panel.style.cssText;
    oldFrame(0); oldObserver.fire(); mutations[0].fire();
    expect(frames.size).toBe(0); expect(f.panel.style.cssText).toBe(before);
  });

  it('disposes pending retry/listeners permanently without closing or focusing the native surface', () => {
    const f = fixture(); f.zero(true); f.open(); const queued = [...frames.values()][0]; f.controller.dispose();
    window.dispatchEvent(new Event('scroll')); visual.dispatchEvent(new Event('resize')); sizes[0].fire(); mutations[0].fire(); queued(0);
    f.zero(false); f.open(); f.controller.refresh();
    expect(frames.size).toBe(0); expect(f.panel.style.position).toBe(''); expect(f.show).not.toHaveBeenCalled(); expect(f.hide).not.toHaveBeenCalled();
  });

  it.each(['removed', 'hidden', 'css-hidden', 'disabled', 'same-id-replacement', 'nonfinite'] as const)('reports the exact %s anchor unavailable without substituting another control', kind => {
    const f = fixture(); f.open();
    if (kind === 'removed') f.trigger.remove();
    if (kind === 'hidden') f.container.hidden = true;
    if (kind === 'css-hidden') f.container.style.display = 'none';
    if (kind === 'disabled') (f.trigger as HTMLButtonElement).disabled = true;
    if (kind === 'same-id-replacement') { const clone = f.trigger.cloneNode(true); f.trigger.replaceWith(clone); }
    if (kind === 'nonfinite') f.setAnchor(new DOMRect(NaN, 600, 66, 44));
    f.controller.refresh(); f.controller.refresh();
    expect(f.unavailable).toHaveBeenCalledOnce(); expect(f.panel.style.position).toBe(''); expect(frames.size).toBe(0);
    expect(f.hide).not.toHaveBeenCalled(); expect(f.show).not.toHaveBeenCalled();
  });
});

describe('bounded open-menu updates', () => {
  it('batches ancestor scrolling, window resize, and visual-viewport updates into one current frame', () => {
    const f = fixture(); f.open(); f.setAnchor(new DOMRect(300, 500, 66, 44));
    f.container.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'));
    expect(frames.size).toBe(1); flushFrame(); expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 300, y: 272 });
    expect(frames.size).toBe(0);
  });

  it('observes bounded invoker ancestors and supports explicit position-only refresh', () => {
    const f = fixture(); f.open();
    expect(sizes[0].observe).toHaveBeenCalledWith(f.container); expect(mutations[0].observe).toHaveBeenCalledWith(f.container, { attributes: true, childList: true });
    f.setAnchor(new DOMRect(300, 500, 66, 44)); sizes[0].fire(); mutations[0].fire(); flushFrame();
    expect(f.panel.getBoundingClientRect().top).toBe(272);
    f.setAnchor(new DOMRect(200, 450, 66, 44)); f.controller.refresh(); expect(f.panel.getBoundingClientRect().top).toBe(222);
    f.open(); expect(sizes).toHaveLength(1); expect(mutations).toHaveLength(1);
  });

  it('tracks noncomposed scroll inside the invoker shadow root', () => {
    const f = fixture({ shadow: true }); f.open(); const scroll = vi.fn(); document.addEventListener('scroll', scroll, { capture: true, once: true });
    f.setAnchor(new DOMRect(300, 500, 66, 44)); f.trigger.dispatchEvent(new Event('scroll', { composed: false }));
    expect(scroll).not.toHaveBeenCalled(); expect(frames.size).toBe(1); flushFrame();
    expect(f.panel.getBoundingClientRect()).toMatchObject({ x: 300, y: 272 }); document.removeEventListener('scroll', scroll, true);
  });

  it('leaves body scrolling, native keyboard defaults, focus, and musical DOM unchanged', () => {
    const f = fixture(); const field = document.getElementById('field')!; field.focus(); const focus = vi.spyOn(field, 'focus');
    const source = document.getElementById('source')!.outerHTML; f.body.scrollTop = 90; f.open();
    f.body.dispatchEvent(new Event('scroll')); expect(frames.size).toBe(0); expect(f.body.scrollTop).toBe(90);
    for (const key of ['Enter', 'Escape', 'ArrowDown', 'Tab']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); field.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(field); expect(focus).not.toHaveBeenCalled(); expect(document.getElementById('source')!.outerHTML).toBe(source);
    expect(f.show).not.toHaveBeenCalled(); expect(f.hide).not.toHaveBeenCalled();
  });

  it('preserves the menu reading offset when temporary natural-height measurement would clamp its scroll range', () => {
    const f = fixture(); f.setSize(380, 900); f.open();
    let scrollTop = 0;
    const clampScroll = (value: number) => Math.max(0, Math.min(value, 838 - f.body.getBoundingClientRect().height));
    Object.defineProperty(f.body, 'scrollTop', { configurable: true, get: () => { scrollTop = clampScroll(scrollTop); return scrollTop; },
      set: (value: number) => { scrollTop = clampScroll(value); } });
    f.body.scrollTop = 318;
    // Unlike Happy DOM's unconstrained scrollTop field, a browser clamps scroll
    // when layout temporarily enlarges the body viewport during measurement.
    f.onMeasure(() => { void f.body.scrollTop; });
    f.controller.refresh();
    expect(f.body.getBoundingClientRect().height).toBe(520); expect(f.body.scrollTop).toBe(318);
  });
});
