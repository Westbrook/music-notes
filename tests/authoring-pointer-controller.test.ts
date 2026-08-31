import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerController } from '../src/authoring/pointer-controller.js';
import type { PointerControllerOptions, PointerGesture } from '../src/authoring/pointer-controller.js';

interface Value { id: string; revision: number }
const controllers: PointerController<Value>[] = [];

function fixture(settings: Partial<Pick<PointerGesture<Value>, 'allowTap' | 'nativePan'>> = {}, root = document.body) {
  const capture = root.ownerDocument.createElement('div');
  const target = root.ownerDocument.createElement('span');
  target.textContent = 'A written note';
  capture.append(target);
  root.append(capture);
  const value = { id: 'note', revision: 1 };
  const begin = vi.fn<(event: PointerEvent) => PointerGesture<Value> | undefined>(() => ({ value, capture, allowTap: false, nativePan: false, ...settings }));
  const preview = vi.fn<(value: Value, event: PointerEvent, dragging: boolean) => void>();
  const commit = vi.fn<(value: Value, event: PointerEvent, dragging: boolean) => void>();
  const cancel = vi.fn<(value: Value, reason: string) => void>();
  const isCurrent = vi.fn<(value: Value) => boolean>(() => true);
  const onError = vi.fn<(error: unknown) => void>();
  const options: PointerControllerOptions<Value> = { root, begin, preview, commit, cancel, isCurrent, onError };
  const controller = new PointerController(options);
  controllers.push(controller);
  const captured = vi.spyOn(capture, 'setPointerCapture');
  const released = vi.spyOn(capture, 'releasePointerCapture');
  return { controller, options, root, target, capture, value, begin, preview, commit, cancel, isCurrent, onError, captured, released };
}

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true,
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: 100, clientY: 100, ...init });
  target.dispatchEvent(event);
  return event;
}
function click(target: EventTarget, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1, clientX: 100, clientY: 100, ...init });
  target.dispatchEvent(event);
  return event;
}
function drag(f: ReturnType<typeof fixture>, init: PointerEventInit = {}): void {
  pointer('pointerdown', f.target, init);
  pointer('pointermove', f.root.ownerDocument.defaultView!, { clientY: 120, ...init });
}

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('pointer gesture lifecycle', () => {
  it('leaves a selection tap to its ordinary click without capture or a commit', () => {
    const f = fixture();
    const selected = vi.fn();
    f.target.addEventListener('click', selected);
    const down = pointer('pointerdown', f.target);
    expect(f.controller.active).toBe(true);
    expect(f.controller.current).toBe(f.value);
    expect(down.defaultPrevented).toBe(false);
    expect(f.preview).toHaveBeenLastCalledWith(f.value, down, false);
    const up = pointer('pointerup', window);
    expect(up.defaultPrevented).toBe(false);
    expect(f.controller.active).toBe(false);
    expect(f.controller.current).toBeUndefined();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'selection-tap');
    expect(f.captured).not.toHaveBeenCalled();
    expect(click(f.target).defaultPrevented).toBe(false);
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it('previews under-threshold movement without turning it into a drag', () => {
    const f = fixture();
    pointer('pointerdown', f.target);
    const move = pointer('pointermove', window, { clientX: 103, clientY: 104 });
    expect(move.defaultPrevented).toBe(false);
    expect(f.captured).not.toHaveBeenCalled();
    expect(f.preview).toHaveBeenLastCalledWith(f.value, move, false);
    pointer('pointerup', window, { clientX: 103, clientY: 104 });
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenLastCalledWith(f.value, 'selection-tap');
  });

  it('captures only after crossing the threshold and commits exactly once after releasing capture', () => {
    const f = fixture();
    pointer('pointerdown', f.target);
    const move = pointer('pointermove', window, { clientY: 106 });
    expect(f.captured).toHaveBeenCalledExactlyOnceWith(7);
    expect(f.capture.hasPointerCapture(7)).toBe(true);
    expect(move.defaultPrevented).toBe(true);
    expect(f.preview).toHaveBeenLastCalledWith(f.value, move, true);
    expect(f.commit).not.toHaveBeenCalled();
    f.commit.mockImplementation(() => {
      expect(f.controller.active).toBe(false);
      expect(f.capture.hasPointerCapture(7)).toBe(false);
    });
    const up = pointer('pointerup', window, { clientY: 120 });
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, true);
    expect(f.released).toHaveBeenCalledExactlyOnceWith(7);
    pointer('pointerup', window, { clientY: 120 });
    pointer('lostpointercapture', f.capture);
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it('commits an armed tap once and suppresses only its compatibility click', () => {
    const f = fixture({ allowTap: true });
    const selected = vi.fn();
    f.target.addEventListener('click', selected);
    pointer('pointerdown', f.target);
    const up = pointer('pointerup', window);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, false);
    expect(f.captured).not.toHaveBeenCalled();
    expect(click(f.target).defaultPrevented).toBe(true);
    expect(selected).not.toHaveBeenCalled();
    expect(click(f.target).defaultPrevented).toBe(false);
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it('recognizes a drag delivered only at pointerup without trying to capture an ended pointer', () => {
    const f = fixture();
    pointer('pointerdown', f.target);
    const up = pointer('pointerup', window, { clientY: 120 });
    expect(f.captured).not.toHaveBeenCalled();
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, true);
  });

  it('keeps a drag a drag after returning to its starting position', () => {
    const f = fixture();
    drag(f);
    pointer('pointermove', window);
    const up = pointer('pointerup', window);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, true);
    expect(click(f.target).defaultPrevented).toBe(true);
  });

  it('ignores events for another pointer until that pointer starts an additional gesture', () => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    pointer('pointermove', window, { pointerId: 8, clientY: 140 });
    pointer('pointerup', window, { pointerId: 8 });
    expect(f.controller.active).toBe(true);
    expect(f.preview).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('lets begin decline a gesture without modifying ordinary events', () => {
    const f = fixture();
    f.begin.mockReturnValue(undefined);
    const down = pointer('pointerdown', f.target);
    const up = pointer('pointerup', window);
    expect(f.controller.active).toBe(false);
    expect(down.defaultPrevented || up.defaultPrevented).toBe(false);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it('does not begin an already consumed pointerdown', () => {
    const f = fixture();
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7 });
    event.preventDefault();
    f.target.dispatchEvent(event);
    expect(f.begin).not.toHaveBeenCalled();
  });

  it.each([{ button: 1 }, { button: 2 }, { isPrimary: false }])('does not begin for a secondary button or nonprimary pointer: %j', init => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target, init);
    pointer('pointerup', window, init);
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.controller.active).toBe(false);
  });

  it('recovers from a missing terminal event on the next press by the same pointer', () => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    pointer('pointerdown', f.target);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'restarted');
    expect(f.begin).toHaveBeenCalledTimes(2);
    pointer('pointerup', window);
    expect(f.commit).toHaveBeenCalledTimes(1);
  });
});

describe('native touch panning', () => {
  it('never captures, prevents defaults, or commits a swipe beginning over music', () => {
    const f = fixture({ nativePan: true, allowTap: true });
    const before = document.body.getAttribute('style');
    const down = pointer('pointerdown', f.target, { pointerType: 'touch' });
    const small = pointer('pointermove', window, { pointerType: 'touch', clientY: 104 });
    const pan = pointer('pointermove', window, { pointerType: 'touch', clientY: 106 });
    const up = pointer('pointerup', window, { pointerType: 'touch', clientY: 160 });
    expect([down, small, pan, up].some(event => event.defaultPrevented)).toBe(false);
    expect(f.captured).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'native-pan');
    expect(f.preview.mock.calls.every(call => call[2] === false)).toBe(true);
    expect(f.controller.active).toBe(false);
    expect(document.body.getAttribute('style')).toBe(before);
    expect(click(f.target, { clientY: 160 }).defaultPrevented).toBe(true);
  });

  it('allows an armed touch tap without preventing native pointer defaults', () => {
    const f = fixture({ nativePan: true, allowTap: true });
    const down = pointer('pointerdown', f.target, { pointerType: 'touch' });
    const up = pointer('pointerup', window, { pointerType: 'touch', clientY: 103 });
    expect(down.defaultPrevented || up.defaultPrevented).toBe(false);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, false);
    expect(f.captured).not.toHaveBeenCalled();
    expect(click(f.target, { clientY: 103 }).defaultPrevented).toBe(true);
  });

  it('cancels touch movement first observed at pointerup rather than treating it as insertion', () => {
    const f = fixture({ nativePan: true, allowTap: true });
    pointer('pointerdown', f.target, { pointerType: 'touch' });
    const up = pointer('pointerup', window, { pointerType: 'touch', clientX: 150 });
    expect(up.defaultPrevented).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'native-pan');
  });

  it('allows an explicit non-panning touch handle to drag without changing body styles', () => {
    const f = fixture({ nativePan: false });
    f.capture.style.touchAction = 'none';
    const before = document.body.getAttribute('style');
    drag(f, { pointerType: 'touch' });
    const up = pointer('pointerup', window, { pointerType: 'touch', clientY: 120 });
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, true);
    expect(f.captured).toHaveBeenCalledTimes(1);
    expect(document.body.getAttribute('style')).toBe(before);
  });
});

describe('cancellation and cleanup', () => {
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'escape', 'external'])('cancels %s without committing or retaining capture', reason => {
    const f = fixture();
    drag(f);
    if (reason === 'pointercancel') pointer('pointercancel', window);
    else if (reason === 'lostpointercapture') pointer('lostpointercapture', f.capture);
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    else f.controller.cancel('external');
    expect(f.controller.active).toBe(false);
    expect(f.capture.hasPointerCapture(7)).toBe(false);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, reason);
    pointer('pointerup', window, { clientY: 120 });
    expect(f.commit).not.toHaveBeenCalled();
    expect(click(f.target, { clientY: 120 }).defaultPrevented).toBe(true);
  });

  it('clears state and capture before calling cancellation code', () => {
    const f = fixture();
    drag(f);
    f.cancel.mockImplementation(() => {
      expect(f.controller.active).toBe(false);
      expect(f.capture.hasPointerCapture(7)).toBe(false);
    });
    f.controller.cancel('resize');
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'resize');
  });

  it('does not consume Escape when there is no active gesture or cancel on ordinary input blur', () => {
    const f = fixture();
    const inactiveEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    f.target.dispatchEvent(inactiveEscape);
    expect(inactiveEscape.defaultPrevented).toBe(false);
    pointer('pointerdown', f.target);
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new Event('blur'));
    expect(f.controller.active).toBe(true);
    const activeEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    input.dispatchEvent(activeEscape);
    expect(activeEscape.defaultPrevented).toBe(true);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'escape');
  });

  it('cancels on an additional pointer and does not start a second gesture from that press', () => {
    const f = fixture();
    drag(f, { pointerType: 'touch' });
    pointer('pointerdown', f.target, { pointerId: 8, pointerType: 'touch', isPrimary: false });
    expect(f.controller.active).toBe(false);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'additional-pointer');
    expect(f.begin).toHaveBeenCalledTimes(1);
    pointer('pointerup', window, { pointerId: 8, pointerType: 'touch' });
    pointer('pointerup', window, { pointerType: 'touch' });
    expect(f.commit).not.toHaveBeenCalled();
    pointer('pointerdown', f.target, { pointerId: 9 });
    expect(f.begin).toHaveBeenCalledTimes(2);
  });

  it('ignores capture loss from another pointer or another capture target', () => {
    const f = fixture();
    drag(f);
    pointer('lostpointercapture', f.capture, { pointerId: 8 });
    pointer('lostpointercapture', f.target);
    expect(f.controller.active).toBe(true);
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each(['down', 'move', 'up'])('rejects stale state at %s before invoking a source commit', stage => {
    const f = fixture({ allowTap: true });
    if (stage === 'down') f.isCurrent.mockReturnValue(false);
    pointer('pointerdown', f.target);
    if (stage === 'move') { f.isCurrent.mockReturnValue(false); pointer('pointermove', window, { clientY: 120 }); }
    if (stage === 'up') { dragAfterDown(f); f.isCurrent.mockReturnValue(false); }
    pointer('pointerup', window, { clientY: stage === 'up' ? 120 : 100 });
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'stale');
    expect(f.controller.active).toBe(false);
    expect(f.capture.hasPointerCapture(7)).toBe(false);
  });

  it('checks currency again after the final preview', () => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    f.preview.mockImplementation(() => { f.isCurrent.mockReturnValue(false); });
    pointer('pointerup', window);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'stale');
  });

  it('disposes active gestures, releases capture, removes listeners, and permits later ordinary clicks', () => {
    const f = fixture();
    drag(f);
    f.controller.dispose();
    f.controller.dispose();
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'dispose');
    expect(f.capture.hasPointerCapture(7)).toBe(false);
    pointer('pointerdown', f.target);
    pointer('pointermove', window, { clientY: 120 });
    pointer('pointerup', window, { clientY: 120 });
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.commit).not.toHaveBeenCalled();
    expect(click(f.target, { clientY: 120 }).defaultPrevented).toBe(false);
  });
});

function dragAfterDown(f: ReturnType<typeof fixture>): void { pointer('pointermove', f.root.ownerDocument.defaultView!, { clientY: 120 }); }

describe('bounded compatibility click suppression', () => {
  it('does not suppress keyboard activation, unrelated coordinates, or another pointer', () => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    pointer('pointerup', window);
    expect(click(f.target, { detail: 0 }).defaultPrevented).toBe(false);
    expect(click(f.target, { clientX: 300 }).defaultPrevented).toBe(false);
    const other = new PointerEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1,
      pointerId: 20, pointerType: 'mouse', clientX: 100, clientY: 100 });
    f.target.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(click(f.target).defaultPrevented).toBe(true);
  });

  it('resets before the next real pointerdown even when begin declines that button', () => {
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    pointer('pointerup', window);
    f.begin.mockReturnValue(undefined);
    const button = document.createElement('button');
    document.body.append(button);
    pointer('pointerdown', button);
    pointer('pointerup', window);
    expect(click(button).defaultPrevented).toBe(false);
  });

  it('tracks a cancelled drag through its final pointerup coordinates', () => {
    const f = fixture();
    drag(f);
    f.controller.cancel('escape');
    pointer('pointermove', window, { clientX: 160, clientY: 160 });
    pointer('pointerup', window, { clientX: 175, clientY: 175 });
    expect(click(f.target, { clientX: 175, clientY: 175 }).defaultPrevented).toBe(true);
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('expires instead of suppressing a later unrelated activation indefinitely', () => {
    vi.useFakeTimers();
    const f = fixture({ allowTap: true });
    pointer('pointerdown', f.target);
    pointer('pointerup', window);
    vi.advanceTimersByTime(1000);
    expect(click(f.target).defaultPrevented).toBe(false);
  });
});

describe('callback failures and window ownership', () => {
  it.each(['begin', 'isCurrent', 'preview', 'commit', 'cancel'])('cleans up and reports a throwing %s callback', callback => {
    const f = fixture({ allowTap: true });
    const error = new Error(`${callback} failed`);
    if (callback === 'begin') f.begin.mockImplementation(() => { throw error; });
    if (callback === 'isCurrent') f.isCurrent.mockImplementation(() => { throw error; });
    if (callback === 'preview') f.preview.mockImplementation(() => { throw error; });
    if (callback === 'commit') f.commit.mockImplementation(() => { throw error; });
    if (callback === 'cancel') f.cancel.mockImplementation(() => { throw error; });
    pointer('pointerdown', f.target);
    if (callback === 'cancel') { dragAfterDown(f); f.controller.cancel('external'); }
    else pointer('pointerup', window);
    expect(f.controller.active).toBe(false);
    expect(f.capture.hasPointerCapture(7)).toBe(false);
    expect(f.onError).toHaveBeenCalledWith(error);
    if (callback === 'preview' || callback === 'isCurrent' || callback === 'commit') expect(f.cancel).toHaveBeenCalledWith(f.value, 'callback-error');
  });

  it('cleans capture if a preview starts throwing after the drag has begun', () => {
    const f = fixture();
    drag(f);
    f.preview.mockImplementation(() => { throw new Error('No preview'); });
    pointer('pointermove', window, { clientY: 125 });
    expect(f.controller.active).toBe(false);
    expect(f.capture.hasPointerCapture(7)).toBe(false);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'callback-error');
    pointer('pointerup', window, { clientY: 125 });
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('cancels a failed capture rather than carrying on with an unprotected drag', () => {
    const f = fixture();
    f.captured.mockImplementation(() => { throw new DOMException('Detached target', 'InvalidStateError'); });
    drag(f);
    expect(f.controller.active).toBe(false);
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.value, 'capture-failed');
    expect(f.onError).toHaveBeenCalledTimes(1);
    pointer('pointerup', window, { clientY: 120 });
    expect(f.commit).not.toHaveBeenCalled();
  });

  it('does not retain state if error reporting itself throws', () => {
    const f = fixture();
    drag(f);
    f.cancel.mockImplementation(() => { throw new Error('Cancel failed'); });
    f.onError.mockImplementation(() => { throw new Error('Reporter failed'); });
    f.controller.cancel();
    expect(f.controller.active).toBe(false);
    expect(f.capture.hasPointerCapture(7)).toBe(false);
  });

  it('uses the root’s own window, including a workspace mounted in an iframe', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const root = iframe.contentDocument!.body;
    const owner = iframe.contentWindow!;
    const f = fixture({ allowTap: true }, root);
    pointer('pointerdown', f.target);
    pointer('pointerup', window);
    expect(f.controller.active).toBe(true);
    expect(f.commit).not.toHaveBeenCalled();
    const up = pointer('pointerup', owner);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.value, up, false);
  });

  it('rejects invalid drag thresholds before installing listeners', () => {
    const f = fixture();
    for (const threshold of [0, -1, Infinity, NaN]) expect(() => new PointerController({ ...f.options, threshold })).toThrow(/positive finite/);
  });
});
