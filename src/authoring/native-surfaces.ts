import { createPopoverPositioner } from './popover-position.js';
import type { PopoverPositioner } from './popover-position.js';

export interface NativeSurfacesOptions {
  readonly ids: readonly string[];
  /** Small native menus that should follow the actual invoker for each opening. */
  readonly positionedIds?: readonly string[];
  /** Used only when closing a surface still owns focus and its invoker is unavailable. */
  readonly fallbackFocus?: () => HTMLElement | null;
  /** Return false to retain the closed surface. Inspection need not mutate music. */
  readonly beforeOpen?: (id: string) => boolean | void;
  readonly afterClose?: (id: string) => void;
}

type SurfaceAction = 'show' | 'hide' | 'toggle';
interface Invoker { element: HTMLElement; action: SurfaceAction }
interface Surface {
  id: string;
  panel: HTMLElement;
  native: boolean;
  open: boolean;
  apiOpening: boolean;
  invoker: HTMLElement | null;
  controls: Invoker[];
  positioner?: PopoverPositioner;
  positioning: boolean;
}

function action(value: string | null): SurfaceAction {
  return value === 'show' || value === 'hide' ? value : 'toggle';
}

function canFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')
    || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    if (!ancestor.hasAttribute('popover') || typeof ancestor.hidePopover !== 'function') continue;
    try { if (!ancestor.matches(':popover-open')) return false; } catch { /* Old engines use the explicit hidden fallback. */ }
  }
  return true;
}

/** Native transient surfaces, with ordinary in-flow sections when popovers are unavailable. */
export class NativeSurfaces {
  private readonly options: NativeSurfacesOptions;
  private readonly document: Document;
  private readonly abort = new AbortController();
  private readonly surfaces = new Map<string, Surface>();
  private disposed = false;

  constructor(options: NativeSurfacesOptions, root: Document = document) {
    this.options = options;
    this.document = root;
    if (new Set(options.ids).size !== options.ids.length) throw new Error('Native surface IDs must be unique.');
    // Validate first so incomplete markup does not leave a partly installed manager.
    for (const id of options.ids) {
      if (!root.getElementById(id)) throw new Error(`Missing native surface: ${id}`);
    }
    const positioned = new Set(options.positionedIds);
    for (const id of positioned) {
      if (!options.ids.includes(id)) throw new Error(`Unmanaged positioned surface: ${id}`);
    }
    for (const id of options.ids) {
      const panel = root.getElementById(id)!;
      const native = typeof panel.showPopover === 'function' && typeof panel.hidePopover === 'function';
      const controls = Array.from(root.querySelectorAll<HTMLElement>('[popovertarget], [data-surface-target]'))
        .filter(element => (element.getAttribute('popovertarget') ?? element.dataset.surfaceTarget) === id)
        .map(element => ({ element, action: action(element.getAttribute('popovertargetaction') ?? element.dataset.surfaceAction ?? null) }));
      const surface: Surface = { id, panel, native, open: false, apiOpening: false, invoker: null, controls, positioning: false };
      this.surfaces.set(id, surface);
      if (native) {
        if (positioned.has(id)) surface.positioner = createPopoverPositioner({
          panel,
          onAnchorUnavailable: () => {
            if (!this.disposed && surface.native && this.isOpen(id)) this.closeSurface(surface, true);
          },
        });
        panel.setAttribute('popover', 'auto');
        panel.hidden = false;
        delete panel.dataset.popoverFallback;
        for (const control of controls) {
          control.element.setAttribute('popovertarget', id);
          control.element.setAttribute('popovertargetaction', control.action);
        }
        surface.open = this.nativeOpen(surface);
      } else this.useFallback(surface);
      this.updateControls(surface);
      this.listen(surface);
      if (surface.open && surface.positioner) {
        this.rememberInvoker(surface);
        this.startPositioning(surface);
      }
    }
  }

  open(id: string, focusTarget?: string | HTMLElement): boolean {
    if (this.disposed) return false;
    return this.openSurface(this.surface(id), focusTarget);
  }

  private openSurface(surface: Surface, focusTarget?: string | HTMLElement, invoker?: HTMLElement): boolean {
    if (this.isOpen(surface.id)) {
      if (surface.native && surface.positioning) surface.positioner?.refresh();
      if (!this.isOpen(surface.id)) return false;
      this.focusSurface(surface, focusTarget);
      return true;
    }
    this.rememberInvoker(surface, invoker);
    if (this.options.beforeOpen?.(surface.id) === false) return false;
    if (surface.native) {
      surface.apiOpening = true;
      try { surface.panel.showPopover(); }
      catch { this.useFallback(surface); }
      finally { surface.apiOpening = false; }
      if (surface.native) {
        // A native beforetoggle listener may cancel opening. That is not a reason
        // to evade the cancellation by showing an in-flow fallback.
        this.syncNative(surface);
        if (!this.isOpen(surface.id)) return false;
        this.closeOtherFallbacks(surface);
        this.focusSurface(surface, focusTarget);
        return true;
      }
    }
    this.closeOtherFallbacks(surface);
    surface.panel.hidden = false;
    surface.open = true;
    this.updateControls(surface);
    surface.panel.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    this.focusSurface(surface, focusTarget);
    return true;
  }

  close(id: string): void {
    if (this.disposed) return;
    this.closeSurface(this.surface(id), true);
  }

  /** View changes should not steal focus from the newly chosen workspace view. */
  closeAll(): void {
    if (this.disposed) return;
    for (const surface of this.surfaces.values()) this.closeSurface(surface, false);
  }

  isOpen(id: string): boolean {
    if (this.disposed) return false;
    const surface = this.surface(id);
    return surface.native ? this.nativeOpen(surface) : surface.open && !surface.panel.hidden;
  }

  /** A dock or inspector can move an invoker without resizing that button. */
  refreshPositions(): void {
    if (this.disposed) return;
    for (const surface of this.surfaces.values()) {
      if (surface.native && surface.positioning && this.nativeOpen(surface)) surface.positioner?.refresh();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const surface of this.surfaces.values()) {
      surface.positioning = false;
      surface.positioner?.dispose();
      if (surface.native) {
        try { surface.panel.hidePopover(); } catch { /* Already closed or disconnected. */ }
      } else surface.panel.hidden = true;
      surface.open = false;
      this.updateControls(surface);
    }
  }

  private surface(id: string): Surface {
    const surface = this.surfaces.get(id);
    if (!surface) throw new Error(`Unmanaged native surface: ${id}`);
    return surface;
  }

  private listen(surface: Surface): void {
    const signal = this.abort.signal;
    surface.panel.addEventListener('beforetoggle', event => {
      if (event.target !== surface.panel || !surface.native) return;
      const toggle = event as ToggleEvent;
      if (toggle.newState === 'open') {
        const source = (event as ToggleEvent & { source?: HTMLElement | null }).source;
        if (source && !surface.panel.contains(source)) this.rememberInvoker(surface, source);
        if (!surface.apiOpening) {
          try {
            if (this.options.beforeOpen?.(surface.id) === false) { event.preventDefault(); return; }
          } catch (error) {
            event.preventDefault();
            throw error;
          }
        }
      } else if (toggle.newState === 'closed' && this.nativeOpen(surface)) surface.open = true;
      // Native toggle events may be coalesced. Read actual state after the browser
      // applies beforetoggle instead of replaying a stale event's requested state.
      queueMicrotask(() => { if (!this.disposed) this.syncNative(surface); });
    }, { signal });
    surface.panel.addEventListener('toggle', event => {
      if (event.target === surface.panel && surface.native) this.syncNative(surface);
    }, { signal });
    for (const control of surface.controls) {
      const element = control.element;
      if (element.tagName === 'BUTTON') (element as HTMLButtonElement).type = 'button';
      element.setAttribute('aria-controls', surface.id);
      element.addEventListener('click', event => {
        if (this.disposed || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return;
        if (control.action !== 'hide') this.rememberInvoker(surface, element);
        if (surface.native) return; // The browser owns declarative activation and all native keys.
        event.preventDefault();
        if (control.action === 'hide' || (control.action === 'toggle' && this.isOpen(surface.id))) this.close(surface.id);
        else this.openSurface(surface, undefined, element);
      }, { signal });
    }
  }

  private useFallback(surface: Surface): void {
    surface.positioning = false;
    surface.positioner?.close();
    surface.native = false;
    surface.open = false;
    surface.panel.removeAttribute('popover');
    surface.panel.dataset.popoverFallback = 'true';
    surface.panel.hidden = true;
    for (const control of surface.controls) {
      control.element.dataset.surfaceTarget = surface.id;
      control.element.dataset.surfaceAction = control.action;
      control.element.removeAttribute('popovertarget');
      control.element.removeAttribute('popovertargetaction');
    }
    this.updateControls(surface);
  }

  private nativeOpen(surface: Surface): boolean {
    try { return surface.panel.matches(':popover-open'); }
    catch { return surface.open; }
  }

  private syncNative(surface: Surface): void {
    if (this.disposed || !surface.native) return;
    if (this.nativeOpen(surface)) {
      surface.open = true;
      this.updateControls(surface);
      this.startPositioning(surface);
    } else this.finishClose(surface);
  }

  private startPositioning(surface: Surface): void {
    if (!surface.positioner || surface.positioning || !surface.native) return;
    surface.positioning = true;
    // Capture and position before an explicit field receives focus. Neither a
    // later focus change nor another invoker may retarget this opening.
    surface.positioner.open(surface.invoker);
  }

  private closeSurface(surface: Surface, restoreFocus: boolean): void {
    const wasOpen = surface.native ? this.nativeOpen(surface) : surface.open;
    if (!wasOpen) return;
    const focusedInPanel = surface.panel.contains(this.document.activeElement);
    if (surface.native) {
      try { surface.panel.hidePopover(); } catch { return; }
      if (this.nativeOpen(surface)) return;
    } else surface.panel.hidden = true;
    this.finishClose(surface, restoreFocus && focusedInPanel);
    if (!restoreFocus && focusedInPanel && surface.panel.contains(this.document.activeElement)) {
      (this.document.activeElement as HTMLElement | null)?.blur();
    }
  }

  private finishClose(surface: Surface, restoreFocus = false): void {
    const wasOpen = surface.open;
    surface.open = false;
    surface.positioning = false;
    surface.positioner?.close();
    this.updateControls(surface);
    if (wasOpen) this.options.afterClose?.(surface.id);
    const focused = this.document.activeElement;
    // Native closure or an afterClose hook may have already focused another
    // field. Restoring this surface must not override that newer choice.
    const stillOwnsFocus = !focused || focused === this.document.body || focused === this.document.documentElement
      || surface.panel.contains(focused) || focused === surface.invoker;
    if (restoreFocus && stillOwnsFocus) {
      const invoker = canFocus(surface.invoker) ? surface.invoker
        : surface.controls.find(control => control.action !== 'hide' && canFocus(control.element))?.element;
      const destination = invoker ?? this.options.fallbackFocus?.();
      if (destination?.ownerDocument === this.document && canFocus(destination)) destination.focus({ preventScroll: true });
    }
  }

  private closeOtherFallbacks(opening: Surface): void {
    for (const other of this.surfaces.values()) {
      const nestedInvoker = opening.controls.some(control => control.action !== 'hide' && control.element === opening.invoker)
        && !!opening.invoker && other.panel.contains(opening.invoker);
      if (other === opening || other.native || other.panel.contains(opening.panel) || nestedInvoker) continue;
      this.closeSurface(other, false);
    }
  }

  private updateControls(surface: Surface): void {
    surface.panel.dataset.surfaceState = surface.open ? 'open' : 'closed';
    for (const control of surface.controls) {
      if (control.action !== 'hide') control.element.setAttribute('aria-expanded', String(surface.open));
    }
  }

  private rememberInvoker(surface: Surface, explicit?: HTMLElement): void {
    const candidate = explicit ?? this.document.activeElement as HTMLElement | null;
    if (candidate && candidate.ownerDocument === this.document && candidate !== this.document.body && !surface.panel.contains(candidate) && canFocus(candidate)) {
      surface.invoker = candidate;
    } else if (!surface.invoker) surface.invoker = surface.controls.find(control => control.action !== 'hide')?.element ?? null;
  }

  private focusSurface(surface: Surface, target?: string | HTMLElement): void {
    const requested = typeof target === 'string' ? this.document.getElementById(target.replace(/^#/, '')) : target;
    const explicit = requested && surface.panel.contains(requested) && canFocus(requested) ? requested : undefined;
    const autofocus = surface.panel.querySelector<HTMLElement>('[autofocus]');
    const fallback = !surface.native ? Array.from(surface.panel.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .find(element => canFocus(element) && element.tabIndex >= 0) : undefined;
    const field = explicit ?? (canFocus(autofocus) ? autofocus : undefined) ?? fallback;
    if (!field) return;
    field.focus({ preventScroll: true });
    // Native scrolling belongs to the surface, not to the score behind it.
    for (let container = field.parentElement; container && surface.panel.contains(container); container = container.parentElement) {
      const bounds = container.getBoundingClientRect();
      const target = field.getBoundingClientRect();
      const top = bounds.top + container.clientTop;
      const left = bounds.left + container.clientLeft;
      if (container.clientHeight > 0 && container.scrollHeight > container.clientHeight) {
        if (target.top < top) container.scrollTop += target.top - top;
        else if (target.bottom > top + container.clientHeight) container.scrollTop += Math.min(target.top - top, target.bottom - top - container.clientHeight);
      }
      if (container.clientWidth > 0 && container.scrollWidth > container.clientWidth) {
        if (target.left < left) container.scrollLeft += target.left - left;
        else if (target.right > left + container.clientWidth) container.scrollLeft += Math.min(target.left - left, target.right - left - container.clientWidth);
      }
      if (container === surface.panel) break;
    }
  }
}
