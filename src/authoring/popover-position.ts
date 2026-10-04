import { composedAncestors, composedContains, isRenderedInParent } from '../ui/composed-dom.js';

export interface PopoverPositionOptions {
  readonly panel: HTMLElement;
  readonly preferredSide?: 'above' | 'below';
  readonly margin?: number;
  readonly gap?: number;
  /** The surface owner dismisses its own menu; positioning never changes focus. */
  readonly onAnchorUnavailable?: () => void;
}

export interface PopoverPositioner {
  /** Call after actual native opening, with that opening's exact invoker. */
  open(invoker: HTMLElement | null): void;
  /** Also call after position-only application reflows. */
  refresh(): void;
  close(): void;
  dispose(): void;
}

interface Box { left: number; top: number; width: number; height: number; right: number; bottom: number }
interface SavedStyle { value: string; priority: string }
interface Tracking {
  readonly invoker: HTMLElement;
  readonly cleanups: (() => void)[];
  readonly saved: Map<HTMLElement, Map<string, SavedStyle>>;
  chain: readonly Element[];
  roots: readonly Node[];
  frame?: number;
  retried: boolean;
}

const panelProperties = ['position', 'inset', 'top', 'right', 'bottom', 'left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'position-anchor', 'position-area', 'position-try-fallbacks', 'position-try-order', 'justify-self', 'align-self',
  'box-sizing', 'min-width', 'max-width', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y',
  'overscroll-behavior', 'overscroll-behavior-x', 'overscroll-behavior-y'];
const bodyProperties = ['box-sizing', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y', 'flex-shrink'];

function finiteBox(rect: DOMRect): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function px(value: number): string { return `${Math.round(value * 1000) / 1000}px`; }

/**
 * Position existing native top-layer menus, without replacing native activation,
 * dismissal, focus or their ordinary in-flow fallback. All coordinates are CSS
 * pixels; neither the controls nor the music are scaled to manufacture a fit.
 */
export function createPopoverPositioner(options: PopoverPositionOptions): PopoverPositioner {
  const panel = options.panel;
  const document = panel.ownerDocument;
  const window = document.defaultView;
  const margin = Number.isFinite(options.margin) ? Math.max(0, options.margin!) : 10;
  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap!) : 8;
  const preferred = options.preferredSide ?? 'above';
  let active: Tracking | undefined;
  let disposed = false;

  const isNativeOpen = (): boolean => {
    if (!panel.isConnected || !panel.hasAttribute('popover') || panel.dataset.popoverFallback === 'true'
      || typeof panel.showPopover !== 'function' || typeof panel.hidePopover !== 'function') return false;
    try { return panel.matches(':popover-open'); } catch { return false; }
  };
  const remember = (state: Tracking, element: HTMLElement, properties: readonly string[]): void => {
    if (!state.saved.has(element)) state.saved.set(element, new Map(properties.map(property => [property,
      { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) }])));
  };
  const restore = (state: Tracking): void => {
    for (const [element, properties] of state.saved) {
      for (const property of properties.keys()) element.style.removeProperty(property);
      for (const [property, saved] of properties) if (saved.value) element.style.setProperty(property, saved.value, saved.priority);
    }
  };
  const write = (element: HTMLElement, properties: Record<string, string>): void => {
    for (const [property, value] of Object.entries(properties)) if (element.style.getPropertyValue(property) !== value) {
      element.style.setProperty(property, value);
    }
  };
  const close = (): void => {
    const state = active; active = undefined;
    if (!state) return;
    if (state.frame !== undefined) window?.cancelAnimationFrame(state.frame);
    for (const cleanup of state.cleanups) cleanup();
    restore(state);
  };
  const unavailable = (): void => { close(); options.onAnchorUnavailable?.(); };
  const viewport = (): Box | undefined => {
    if (!window) return undefined;
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = document.documentElement.clientHeight || window.innerHeight;
    const visual = window.visualViewport;
    const style = window.getComputedStyle(document.documentElement);
    const safe = (side: string): number => Math.max(0, Number.parseFloat(style.getPropertyValue(`--music-ui-safe-${side}`)) || 0);
    // Intersect system-safe layout bounds with the visual viewport. A keyboard
    // or pinch zoom may already inset it; do not add the system inset twice.
    const left = Math.max(safe('left'), visual?.offsetLeft ?? 0) + margin;
    const top = Math.max(safe('top'), visual?.offsetTop ?? 0) + margin;
    const right = Math.min(width - safe('right'), (visual?.offsetLeft ?? 0) + (visual?.width ?? width)) - margin;
    const bottom = Math.min(height - safe('bottom'), (visual?.offsetTop ?? 0) + (visual?.height ?? height)) - margin;
    return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
      ? { left, top, right, bottom, width: right - left, height: bottom - top } : undefined;
  };
  const schedule = (state: Tracking): void => {
    if (!window || active !== state || state.frame !== undefined) return;
    state.frame = window.requestAnimationFrame(() => { state.frame = undefined; if (active === state) refresh(); });
  };
  const track = (state: Tracking, chain: readonly Element[]): void => {
    if (!window) return;
    const roots = [...new Set<Node>([document, ...chain.map(element => element.getRootNode())])];
    if (chain.length === state.chain.length && chain.every((element, index) => element === state.chain[index])
      && roots.length === state.roots.length && roots.every((root, index) => root === state.roots[index])) return;
    for (const cleanup of state.cleanups.splice(0)) cleanup();
    state.chain = chain; state.roots = roots;
    // Reassignment can replace the slot wrappers without changing the invoker.
    // Old observers must not schedule work after this binding has been replaced.
    let listening = true;
    state.cleanups.push(() => { listening = false; });
    const listen = (target: EventTarget, name: string, callback: EventListener, capture = false): void => {
      target.addEventListener(name, callback, { passive: true, capture });
      state.cleanups.push(() => target.removeEventListener(name, callback, capture));
    };
    const changed = (): void => { if (listening) schedule(state); };
    const scrolled: EventListener = event => {
      const target = event.composedPath()[0] ?? event.target;
      if (!(target instanceof Node && composedContains(panel, target))) changed();
    };
    for (const root of roots) listen(root, 'scroll', scrolled, true);
    for (const element of chain) if (element.localName === 'slot') listen(element, 'slotchange', changed);
    listen(window, 'scroll', scrolled); listen(window, 'resize', changed);
    if (window.visualViewport) { listen(window.visualViewport, 'scroll', changed); listen(window.visualViewport, 'resize', changed); }
    listen(panel, 'toggle', event => { if (listening && event.target === panel && !isNativeOpen()) close(); });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(changed);
      for (const element of new Set([panel, ...chain, ...panel.querySelectorAll<HTMLElement>('.popover-body')])) observer.observe(element);
      state.cleanups.push(() => observer.disconnect());
    }
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(changed);
      // Follow only this composed chain and its direct shadow-root children.
      // No score subtree or document-wide mutation stream is needed.
      for (const element of chain) observer.observe(element, { attributes: true, childList: true });
      for (const root of roots) if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) observer.observe(root, { childList: true });
      state.cleanups.push(() => observer.disconnect());
    }
  };
  const refresh = (): void => {
    const state = active;
    if (!state || !window || disposed) return;
    if (state.frame !== undefined) { window.cancelAnimationFrame(state.frame); state.frame = undefined; }
    if (!isNativeOpen()) { close(); return; }
    const invoker = state.invoker;
    const chain = [invoker, ...composedAncestors(invoker)];
    if (!invoker.isConnected || invoker.ownerDocument !== document || composedContains(panel, invoker)
      || invoker.matches(':disabled') || invoker.getAttribute('aria-disabled') === 'true'
      || chain.some(element => {
        if (!isRenderedInParent(element) || element.matches('[hidden], [inert], [aria-hidden="true"]')) return true;
        const style = window.getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden';
      })) { unavailable(); return; }
    track(state, chain);
    const anchor = invoker.getBoundingClientRect();
    const visible = viewport();
    if (!finiteBox(anchor) || !visible) { unavailable(); return; }
    const body = panel.querySelector<HTMLElement>('.popover-body');
    const scrolling = [panel, ...(body ? [body] : [])].map(element => ({ element, left: element.scrollLeft, top: element.scrollTop }));
    const restoreScroll = (): void => {
      // Expanding a live scrollport for measurement can clamp its old offset.
      // Restore the reading position; the final native range supplies any clamp.
      for (const { element, left, top } of scrolling) {
        if (element.scrollLeft !== left) element.scrollLeft = left;
        if (element.scrollTop !== top) element.scrollTop = top;
      }
    };
    remember(state, panel, panelProperties);
    if (body) remember(state, body, bodyProperties);
    // Reset both author/UA corner placement and optional CSS-anchor fallbacks.
    // Width is capped before height is measured, so wrapped prose counts.
    write(panel, { position: 'fixed', inset: 'auto', margin: '0px', 'position-anchor': 'auto', 'position-area': 'none',
      'position-try-fallbacks': 'none', 'position-try-order': 'normal', 'justify-self': 'auto', 'align-self': 'auto',
      'box-sizing': 'border-box', 'min-width': '0px', 'max-width': px(visible.width), 'min-height': '0px',
      'max-height': px(visible.height), overflow: 'hidden', 'overscroll-behavior': 'contain' });
    if (body) write(body, { 'box-sizing': 'border-box', 'min-height': '0px', 'max-height': 'none', overflow: 'auto', 'flex-shrink': '1' });
    const measured = panel.getBoundingClientRect();
    if (!finiteBox(measured)) {
      restore(state); restoreScroll();
      // A just-opened menu may not yet have measurable layout. Retry once, then
      // wait for an observed layout change instead of running an animation loop.
      if (!state.retried) { state.retried = true; schedule(state); }
      return;
    }
    const above = clamp(anchor.top - gap - visible.top, 0, visible.height);
    const below = clamp(visible.bottom - anchor.bottom - gap, 0, visible.height);
    const space = { above, below };
    const alternate = preferred === 'above' ? 'below' : 'above';
    const side = space[preferred] >= measured.height ? preferred : space[alternate] >= measured.height ? alternate
      : space[preferred] >= space[alternate] ? preferred : alternate;
    const chrome = body ? Math.max(0, measured.height - body.getBoundingClientRect().height) : 0;
    const bodyStyle = body && window.getComputedStyle(body);
    const bodyPadding = bodyStyle ? (Number.parseFloat(bodyStyle.paddingTop) || 0) + (Number.parseFloat(bodyStyle.paddingBottom) || 0) : 0;
    const minimum = chrome + bodyPadding + 44;
    const maxHeight = space[side] >= Math.min(minimum, measured.height) ? space[side] : visible.height;
    const scrollWholePanel = !body || maxHeight < minimum;
    write(panel, { 'max-height': px(maxHeight), overflow: scrollWholePanel ? 'auto' : 'hidden' });
    if (body) write(body, { 'max-height': scrollWholePanel ? 'none' : px(Math.max(0, maxHeight - chrome)),
      overflow: scrollWholePanel ? 'visible' : 'auto', 'flex-shrink': scrollWholePanel ? '0' : '1' });
    const final = panel.getBoundingClientRect();
    if (!finiteBox(final)) { restore(state); restoreScroll(); return; }
    const left = clamp(anchor.left, visible.left, visible.right - final.width);
    const top = clamp(side === 'above' ? anchor.top - gap - final.height : anchor.bottom + gap, visible.top, visible.bottom - final.height);
    write(panel, { left: px(left), top: px(top), right: 'auto', bottom: 'auto' });
    restoreScroll();
  };

  const open = (invoker: HTMLElement | null): void => {
    if (disposed || !window) return;
    if (active?.invoker === invoker && isNativeOpen()) { refresh(); return; }
    close();
    if (!isNativeOpen()) return;
    if (!invoker) { options.onAnchorUnavailable?.(); return; }
    const state: Tracking = { invoker, cleanups: [], saved: new Map(), chain: [], roots: [], retried: false };
    active = state;
    refresh();
  };
  return { open, refresh, close, dispose: () => { close(); disposed = true; } };
}
