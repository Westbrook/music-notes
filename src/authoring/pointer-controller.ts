export interface PointerGesture<T> {
  value: T;
  capture: Element;
  allowTap: boolean;
  /** Preserve native scrolling; movement cancels rather than becoming a drag. */
  nativePan: boolean;
}

export interface PointerControllerOptions<T> {
  root: HTMLElement;
  begin: (event: PointerEvent) => PointerGesture<T> | undefined;
  preview: (value: T, event: PointerEvent, dragging: boolean) => void;
  commit: (value: T, event: PointerEvent, dragging: boolean) => void;
  cancel: (value: T, reason: string) => void;
  isCurrent: (value: T) => boolean;
  threshold?: number;
  onError?: (error: unknown) => void;
}

interface ActiveGesture<T> extends PointerGesture<T> {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  dragging: boolean;
  captured: boolean;
}

interface ClickSuppression {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  until: number;
  awaitingUp: boolean;
}

const CLICK_SUPPRESSION_MS = 750;
const CLICK_RADIUS = 12;

/**
 * A source-independent gesture boundary. Previews never commit; a completed
 * gesture commits once at pointerup. Native-pan gestures are never captured or
 * prevented, and cannot become drags. Touch drag handles must opt out of native
 * panning in their own CSS before pointerdown; the score/body must not do so.
 *
 * Capture is delayed until dragging starts, preserving an ordinary selection
 * tap's original click target. Caller callbacks own musical targets, mode and
 * geometry validation; commit must reject a drop outside an allowed target.
 */
export class PointerController<T> {
  private readonly options: PointerControllerOptions<T>;
  private readonly view: Window;
  private readonly threshold: number;
  private readonly removals: (() => void)[] = [];
  private readonly ignoredDown = new WeakSet<Event>();
  private gesture?: ActiveGesture<T>;
  private suppression?: ClickSuppression;
  private suppressionTimer?: number;
  private disposed = false;

  constructor(options: PointerControllerOptions<T>) {
    const view = options.root.ownerDocument.defaultView;
    if (!view) throw new Error('PointerController needs a root belonging to a browser window.');
    const threshold = options.threshold ?? 6;
    if (!Number.isFinite(threshold) || threshold <= 0) throw new RangeError('The pointer drag threshold must be a positive finite number.');
    this.options = options;
    this.view = view;
    this.threshold = threshold;
    this.listen(view, 'pointerdown', event => this.anyPointerDown(event as PointerEvent), true);
    this.listen(options.root, 'pointerdown', event => this.pointerDown(event as PointerEvent), true);
    this.listen(view, 'pointermove', event => this.pointerMove(event as PointerEvent), true);
    this.listen(view, 'pointerup', event => this.pointerUp(event as PointerEvent), true);
    this.listen(view, 'pointercancel', event => this.pointerCancelled(event as PointerEvent), true);
    this.listen(view, 'lostpointercapture', event => this.captureLost(event as PointerEvent), true);
    // Native element blur does not bubble. Do not capture it: only a window
    // blur should cancel a gesture when focus moves between ordinary inputs.
    this.listen(view, 'blur', () => this.cancel('blur'));
    this.listen(view, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (!this.gesture || key.key !== 'Escape') return;
      key.preventDefault();
      key.stopPropagation();
      this.cancel('escape');
    }, true);
    this.listen(options.root, 'click', event => this.compatibilityClick(event as MouseEvent), true);
  }

  get active(): boolean { return this.gesture !== undefined; }
  get current(): T | undefined { return this.gesture?.value; }

  private listen(target: EventTarget, type: string, listener: EventListener, capture = false): void {
    target.addEventListener(type, listener, { capture, passive: false });
    this.removals.push(() => target.removeEventListener(type, listener, capture));
  }

  private report(error: unknown): void {
    // Application error reporting must not strand capture or a live gesture.
    try { this.options.onError?.(error); } catch { /* The gesture is already cleaned up. */ }
  }

  private anyPointerDown(event: PointerEvent): void {
    if (this.disposed) return;
    this.clearSuppression();
    if (!this.gesture) return;
    if (event.pointerId !== this.gesture.pointerId) {
      this.ignoredDown.add(event);
      this.cancel('additional-pointer');
    } else {
      // Recover from a missed terminal event without swallowing the next
      // genuine press by the same mouse/pen pointer.
      this.cancel('restarted');
      this.clearSuppression();
    }
  }

  private pointerDown(event: PointerEvent): void {
    if (this.disposed || this.gesture || this.ignoredDown.has(event) || event.defaultPrevented) return;
    if (event.button !== 0 || !event.isPrimary) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    let start: PointerGesture<T> | undefined;
    try { start = this.options.begin(event); }
    catch (error) { this.report(error); return; }
    if (!start || this.disposed) return;
    const gesture: ActiveGesture<T> = { ...start, pointerId: event.pointerId, pointerType: event.pointerType,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      moved: false, dragging: false, captured: false };
    this.gesture = gesture;
    if (this.currentGesture(gesture)) this.preview(gesture, event);
  }

  private currentGesture(gesture: ActiveGesture<T>): boolean {
    if (this.gesture !== gesture || this.disposed) return false;
    try {
      if (this.options.isCurrent(gesture.value)) return this.gesture === gesture;
      this.cancel('stale');
    } catch (error) { this.cancel('callback-error'); this.report(error); }
    return false;
  }

  private updatePosition(gesture: ActiveGesture<T>, event: PointerEvent): boolean {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) { this.cancel('invalid-pointer'); return false; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.moved ||= Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) >= this.threshold;
    return true;
  }

  private acquireCapture(gesture: ActiveGesture<T>): boolean {
    if (gesture.captured) return true;
    try {
      if (typeof gesture.capture.setPointerCapture !== 'function') throw new Error('Pointer capture is unavailable for this drag target.');
      gesture.captured = true;
      gesture.capture.setPointerCapture(gesture.pointerId);
      return this.gesture === gesture;
    } catch (error) { this.cancel('capture-failed'); this.report(error); return false; }
  }

  private preview(gesture: ActiveGesture<T>, event: PointerEvent): boolean {
    try { this.options.preview(gesture.value, event, gesture.dragging); }
    catch (error) { this.cancel('callback-error'); this.report(error); }
    return this.gesture === gesture;
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) { this.trackCancelledPointer(event, false); return; }
    if (!this.updatePosition(gesture, event) || !this.currentGesture(gesture)) return;
    if (gesture.nativePan && gesture.moved) { this.cancel('native-pan'); return; }
    if (gesture.moved && !gesture.dragging) {
      gesture.dragging = true;
      if (!this.acquireCapture(gesture)) return;
    }
    if (gesture.dragging) event.preventDefault();
    this.preview(gesture, event);
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) { this.trackCancelledPointer(event, true); return; }
    if (!this.updatePosition(gesture, event) || !this.currentGesture(gesture)) return;
    if (gesture.nativePan && gesture.moved) { this.cancel('native-pan'); this.trackCancelledPointer(event, true); return; }
    // Coalesced movement can first arrive with pointerup. No capture is needed
    // or requested after the pointer has already been released.
    gesture.dragging ||= gesture.moved;
    if (!gesture.dragging && !gesture.allowTap) { this.cancel('selection-tap'); return; }
    if (!this.preview(gesture, event) || !this.currentGesture(gesture)) return;
    if (!gesture.nativePan) event.preventDefault();
    this.suppressClick(gesture, false);
    this.finish(gesture);
    try { this.options.commit(gesture.value, event, gesture.dragging); }
    catch (error) { this.notifyCancel(gesture.value, 'callback-error'); this.report(error); }
  }

  private pointerCancelled(event: PointerEvent): void {
    if (this.gesture?.pointerId === event.pointerId) this.cancel('pointercancel');
  }

  private captureLost(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || !gesture.captured || event.pointerId !== gesture.pointerId) return;
    if ((event.composedPath()[0] ?? event.target) === gesture.capture) this.cancel('lostpointercapture');
  }

  private finish(gesture: ActiveGesture<T>): void {
    if (this.gesture === gesture) this.gesture = undefined;
    if (!gesture.captured) return;
    gesture.captured = false;
    try {
      if (typeof gesture.capture.hasPointerCapture !== 'function' || gesture.capture.hasPointerCapture(gesture.pointerId)) {
        gesture.capture.releasePointerCapture(gesture.pointerId);
      }
    } catch (error) { this.report(error); }
  }

  private notifyCancel(value: T, reason: string): void {
    try { this.options.cancel(value, reason); }
    catch (error) { this.report(error); }
  }

  cancel(reason = 'cancelled'): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.moved) this.suppressClick(gesture, true);
    this.finish(gesture);
    this.notifyCancel(gesture.value, reason);
  }

  private clearSuppression(): void {
    if (this.suppressionTimer !== undefined) this.view.clearTimeout(this.suppressionTimer);
    this.suppressionTimer = undefined;
    this.suppression = undefined;
  }

  private suppressClick(gesture: ActiveGesture<T>, awaitingUp: boolean): void {
    this.clearSuppression();
    this.suppression = { pointerId: gesture.pointerId, pointerType: gesture.pointerType,
      x: gesture.x, y: gesture.y, until: Date.now() + CLICK_SUPPRESSION_MS, awaitingUp };
    this.suppressionTimer = this.view.setTimeout(() => this.clearSuppression(), CLICK_SUPPRESSION_MS);
  }

  private trackCancelledPointer(event: PointerEvent, up: boolean): void {
    const suppression = this.suppression;
    if (!suppression || !suppression.awaitingUp || event.pointerId !== suppression.pointerId || Date.now() > suppression.until) return;
    suppression.x = event.clientX;
    suppression.y = event.clientY;
    if (up) {
      suppression.awaitingUp = false;
      suppression.until = Date.now() + CLICK_SUPPRESSION_MS;
      if (this.suppressionTimer !== undefined) this.view.clearTimeout(this.suppressionTimer);
      this.suppressionTimer = this.view.setTimeout(() => this.clearSuppression(), CLICK_SUPPRESSION_MS);
    }
  }

  private compatibilityClick(event: MouseEvent): void {
    const suppression = this.suppression;
    if (!suppression) return;
    if (Date.now() > suppression.until) { this.clearSuppression(); return; }
    if (event.detail === 0) return; // Keyboard activation and HTMLElement.click().
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const pointer = event as Partial<PointerEvent>;
    if (pointer.pointerType && pointer.pointerType !== suppression.pointerType) return;
    if (pointer.pointerType && typeof pointer.pointerId === 'number' && pointer.pointerId !== suppression.pointerId) return;
    if (Math.hypot(event.clientX - suppression.x, event.clientY - suppression.y) > CLICK_RADIUS) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.clearSuppression();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel('dispose');
    for (const remove of this.removals.splice(0)) remove();
    this.clearSuppression();
  }
}
