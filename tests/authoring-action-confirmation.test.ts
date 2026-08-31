// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionConfirmation } from '../src/authoring/action-confirmation.js';
import type { ActionConfirmationRequest } from '../src/authoring/action-confirmation.js';

const cleanups: (() => void)[] = [];

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing confirmation fixture ${id}`);
  return result as T;
}

function markup(dialogId = 'author-confirmation'): string {
  return `<button id="remove-action">Remove measure</button><button id="new-action">New composition</button>
    <input id="accepted-source" value="accepted score"><input id="entry-recipe" value="F#5 eighth">
    <dialog id="${dialogId}">
      <h2 id="${dialogId}-title"></h2><p id="${dialogId}-message"></p>
      <p id="${dialogId}-status" hidden></p>
      <button id="${dialogId}-cancel">Cancel</button><button id="${dialogId}-confirm">Confirm</button>
      <select id="native-choice"><option>A</option><option>B</option></select>
    </dialog>`;
}

/** Lifecycle only; no modal inertness, native Escape routing, or top-layer rendering is simulated. */
function nativeDialog(dialog: HTMLDialogElement, queuedClose = false) {
  const closeEvents: (() => void)[] = [];
  const showModal = vi.fn(() => { dialog.setAttribute('open', ''); });
  const close = vi.fn((value?: string) => {
    if (!dialog.open) return;
    if (value !== undefined) dialog.returnValue = value;
    dialog.removeAttribute('open');
    const dispatch = () => dialog.dispatchEvent(new Event('close'));
    if (queuedClose) closeEvents.push(dispatch);
    else dispatch();
  });
  Object.defineProperties(dialog, {
    showModal: { configurable: true, value: showModal }, close: { configurable: true, value: close },
  });
  return { showModal, close, flushClose: () => { closeEvents.splice(0).forEach(dispatch => dispatch()); } };
}

function fixture(native = true, queuedClose = false) {
  document.body.innerHTML = markup();
  const dialog = control<HTMLDialogElement>('author-confirmation');
  const lifecycle = native ? nativeDialog(dialog, queuedClose) : undefined;
  if (!native) Object.defineProperties(dialog, {
    showModal: { configurable: true, value: undefined }, close: { configurable: true, value: undefined },
  });
  const confirmation = new ActionConfirmation();
  cleanups.push(() => confirmation.dispose());
  return {
    confirmation, dialog, lifecycle,
    title: control('author-confirmation-title'), message: control('author-confirmation-message'), status: control('author-confirmation-status'),
    confirm: control<HTMLButtonElement>('author-confirmation-confirm'), cancel: control<HTMLButtonElement>('author-confirmation-cancel'),
  };
}

function request(overrides: Partial<ActionConfirmationRequest> = {}): ActionConfirmationRequest {
  return { title: 'Remove measure 12?', message: 'This removes the measure from every staff. Undo restores it.', confirmLabel: 'Remove measure', destructive: true, isCurrent: () => true, ...overrides };
}

afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
});

describe('ActionConfirmation named decisions', () => {
  it('CONFIRM-NATIVE renders a named native modal and focuses Cancel for a destructive action', () => {
    const value = fixture();
    const focus = vi.spyOn(value.cancel, 'focus');
    void value.confirmation.ask(request());
    expect(value.lifecycle?.showModal).toHaveBeenCalledOnce();
    expect(value.dialog.open).toBe(true);
    expect(value.dialog.hidden).toBe(false);
    expect(value.dialog.getAttribute('aria-labelledby')).toBe(value.title.id);
    expect(value.dialog.getAttribute('aria-describedby')).toBe(value.message.id);
    expect(value.dialog.getAttribute('aria-modal')).toBe('true');
    expect(value.title.textContent).toBe('Remove measure 12?');
    expect(value.confirm.textContent).toBe('Remove measure');
    expect(value.cancel.textContent).toBe('Cancel');
    expect(value.confirm.type).toBe('button');
    expect(value.cancel.type).toBe('button');
    expect(value.dialog.dataset.destructive).toBe('true');
    expect(document.activeElement).toBe(value.cancel);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('focuses the named confirmation for a non-destructive action', () => {
    const value = fixture();
    void value.confirmation.ask(request({ title: 'Fill the remaining time?', confirmLabel: 'Add rests', destructive: false }));
    expect(value.dialog.dataset.destructive).toBe('false');
    expect(document.activeElement).toBe(value.confirm);
  });

  it('CONFIRM-ACCEPT authorizes only the named Confirm action while its captured context is current', async () => {
    const value = fixture();
    const isCurrent = vi.fn(() => true);
    const result = value.confirmation.ask(request({ isCurrent }));
    expect(isCurrent).not.toHaveBeenCalled();
    value.confirm.click();
    await expect(result).resolves.toBe(true);
    expect(isCurrent).toHaveBeenCalledOnce();
    expect(value.dialog.open).toBe(false);
    expect(value.dialog.hidden).toBe(true);
  });

  it.each([false, true])('CONFIRM-CANCEL leaves source and entry unchanged (native=%s)', async native => {
    const value = fixture(native);
    const mutate = vi.fn(() => { control<HTMLInputElement>('accepted-source').value = 'changed'; });
    const isCurrent = vi.fn(() => true);
    const result = value.confirmation.ask(request({ isCurrent })).then(accepted => { if (accepted) mutate(); return accepted; });
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(isCurrent).not.toHaveBeenCalled();
    expect(control<HTMLInputElement>('accepted-source').value).toBe('accepted score');
    expect(control<HTMLInputElement>('entry-recipe').value).toBe('F#5 eighth');
  });

  it('CONFIRM-ESCAPE handles the native cancel event as a rejected decision', async () => {
    const value = fixture();
    const isCurrent = vi.fn(() => true);
    const result = value.confirmation.ask(request({ isCurrent }));
    value.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(result).resolves.toBe(false);
    expect(isCurrent).not.toHaveBeenCalled();
    expect(value.dialog.open).toBe(false);
  });

  it('CONFIRM-CLOSE treats an external native close as cancel even with an affirmative returnValue', async () => {
    const value = fixture();
    const isCurrent = vi.fn(() => true);
    const result = value.confirmation.ask(request({ isCurrent }));
    value.dialog.close('confirmed');
    await expect(result).resolves.toBe(false);
    expect(isCurrent).not.toHaveBeenCalled();
  });

  it('ignores close/cancel events from nested controls', async () => {
    const value = fixture();
    let settled = false;
    const result = value.confirmation.ask(request()).then(answer => { settled = true; return answer; });
    control('native-choice').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
    control('native-choice').dispatchEvent(new Event('close', { bubbles: true }));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(value.dialog.open).toBe(true);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
  });

  it('CONFIRM-PLAINTEXT treats source-derived titles, messages, and labels as plain text', () => {
    const value = fixture();
    void value.confirmation.ask(request({
      title: '<img src=x onerror="steal()">', message: '<script>mutate()</script> & <music-note pitch="F4">', confirmLabel: '<b>Remove</b>',
    }));
    expect(value.title.textContent).toBe('<img src=x onerror="steal()">');
    expect(value.message.textContent).toBe('<script>mutate()</script> & <music-note pitch="F4">');
    expect(value.confirm.textContent).toBe('<b>Remove</b>');
    expect(value.dialog.querySelector('img, script, music-note, b')).toBeNull();
  });
});

describe('ActionConfirmation captured intent', () => {
  it.each([false, true])('CONFIRM-STALE keeps a visible review explanation and never authorizes a changed context (native=%s)', async native => {
    const value = fixture(native);
    let current = true;
    let settled = false;
    const mutate = vi.fn();
    const result = value.confirmation.ask(request({ isCurrent: () => current })).then(accepted => { settled = true; if (accepted) mutate(); return accepted; });
    current = false;
    value.confirm.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(value.dialog.open).toBe(true);
    expect(value.status.hidden).toBe(false);
    expect(value.status.textContent).toMatch(/changed|no longer/i);
    expect(value.status.getAttribute('role')).toBe('alert');
    expect(value.confirm.disabled).toBe(true);
    expect(value.cancel.textContent).toBe('Close and review');
    expect(document.activeElement).toBe(value.cancel);
    current = true;
    value.confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(settled).toBe(false);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('CONFIRM-STALE-VISIBLE reveals a stale explanation inside the dialog without moving the score', async () => {
    const value = fixture();
    const body = document.createElement('div');
    value.dialog.insertBefore(body, value.status);
    body.append(value.status);
    Object.defineProperties(body, { clientHeight: { value: 100 }, scrollHeight: { value: 600 } });
    vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 200, 100));
    vi.spyOn(value.status, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 420 - body.scrollTop, 180, 60));
    document.documentElement.scrollTop = 456;
    const result = value.confirmation.ask(request({ isCurrent: () => false }));
    value.confirm.click();
    expect(body.scrollTop).toBe(280);
    expect(document.documentElement.scrollTop).toBe(456);
    expect(document.activeElement).toBe(value.cancel);
    value.cancel.click();
    await result;
    document.documentElement.scrollTop = 0;
  });

  it.each([
    ['throwing', () => { throw new Error('Target removed'); }],
    ['non-boolean', () => 'yes' as unknown as boolean],
  ] as const)('treats a %s context check as stale', async (_label, isCurrent) => {
    const value = fixture();
    const result = value.confirmation.ask(request({ isCurrent }));
    expect(() => value.confirm.click()).not.toThrow();
    expect(value.confirm.disabled).toBe(true);
    expect(value.status.hidden).toBe(false);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
  });

  it('CONFIRM-CONCURRENT rejects a second ask without replacing the original action or focus owner', async () => {
    const value = fixture(false);
    const firstInvoker = control('remove-action');
    const secondInvoker = control('new-action');
    firstInvoker.focus();
    const firstGuard = vi.fn(() => true);
    const first = value.confirmation.ask(request({ isCurrent: firstGuard }));
    secondInvoker.focus();
    const secondGuard = vi.fn(() => true);
    await expect(value.confirmation.ask(request({ title: 'New composition?', confirmLabel: 'Replace workspace', isCurrent: secondGuard }))).resolves.toBe(false);
    expect(value.title.textContent).toBe('Remove measure 12?');
    expect(value.confirm.textContent).toBe('Remove measure');
    expect(secondGuard).not.toHaveBeenCalled();
    value.cancel.click();
    await expect(first).resolves.toBe(false);
    expect(document.activeElement).toBe(firstInvoker);
  });

  it('CONFIRM-SNAPSHOT copies request labels and the guard instead of retaining a mutable request object', async () => {
    const value = fixture();
    const originalGuard = vi.fn(() => false);
    const pending = request({ isCurrent: originalGuard });
    const result = value.confirmation.ask(pending);
    Object.assign(pending, { title: 'Another action', confirmLabel: 'Replace', isCurrent: () => true });
    value.confirm.click();
    expect(originalGuard).toHaveBeenCalledOnce();
    expect(value.title.textContent).toBe('Remove measure 12?');
    expect(value.confirm.disabled).toBe(true);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
  });

  it('clears stale state only for a new request after the prior decision is cancelled', async () => {
    const value = fixture();
    const first = value.confirmation.ask(request({ isCurrent: () => false }));
    value.confirm.click(); value.cancel.click();
    await expect(first).resolves.toBe(false);
    const next = value.confirmation.ask(request({ title: 'Fill with rests?', confirmLabel: 'Add rests', destructive: false }));
    expect(value.status.hidden).toBe(true);
    expect(value.status.textContent).toBe('');
    expect(value.cancel.textContent).toBe('Cancel');
    expect(value.confirm.disabled).toBe(false);
    value.confirm.click();
    await expect(next).resolves.toBe(true);
  });

  it('CONFIRM-CLOSE-RACE ignores an old queued close event after the next request has opened', async () => {
    const value = fixture(true, true);
    const first = value.confirmation.ask(request());
    value.confirm.click();
    await expect(first).resolves.toBe(true);
    let settled = false;
    const next = value.confirmation.ask(request({ title: 'Second action?' })).then(answer => { settled = true; return answer; });
    value.lifecycle?.flushClose();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(value.dialog.open).toBe(true);
    expect(value.title.textContent).toBe('Second action?');
    value.cancel.click();
    await expect(next).resolves.toBe(false);
  });

  it('does not authorize if the guard disposes the controller while being checked', async () => {
    const value = fixture();
    const result = value.confirmation.ask(request({ isCurrent: () => { value.confirmation.dispose(); return true; } }));
    value.confirm.click();
    await expect(result).resolves.toBe(false);
  });
});

describe('ActionConfirmation focus, fallback, and cleanup', () => {
  it('CONFIRM-RETURN-FOCUS returns to the captured invoker without scrolling', async () => {
    const value = fixture();
    const invoker = control('remove-action');
    invoker.focus();
    const focus = vi.spyOn(invoker, 'focus');
    const result = value.confirmation.ask(request());
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(invoker);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('honors an explicit return target and captures a new default target on each request', async () => {
    const value = fixture(false);
    const firstInvoker = control('remove-action');
    const secondInvoker = control('new-action');
    firstInvoker.focus();
    const first = value.confirmation.ask(request({ returnFocus: secondInvoker }));
    value.cancel.click();
    await first;
    expect(document.activeElement).toBe(secondInvoker);
    firstInvoker.focus();
    const next = value.confirmation.ask(request());
    value.cancel.click();
    await next;
    expect(document.activeElement).toBe(firstInvoker);
  });

  it('does not redirect focus to a replacement element that reuses a removed invoker ID', async () => {
    const value = fixture(false);
    const invoker = control('remove-action');
    invoker.focus();
    const result = value.confirmation.ask(request());
    invoker.remove();
    const replacement = document.createElement('button'); replacement.id = 'remove-action';
    document.body.append(replacement);
    const focus = vi.spyOn(replacement, 'focus');
    value.cancel.click();
    await result;
    expect(focus).not.toHaveBeenCalled();
    expect(value.dialog.contains(document.activeElement)).toBe(false);
  });

  it('CONFIRM-FALLBACK uses an ordinary in-flow dialog with explicit buttons and no modal claim', async () => {
    const value = fixture(false);
    const result = value.confirmation.ask(request());
    expect(value.dialog.dataset.dialogFallback).toBe('true');
    expect(value.dialog.style.position).toBe('static');
    expect(value.dialog.open).toBe(true);
    expect(value.dialog.hidden).toBe(false);
    expect(value.dialog.getAttribute('aria-modal')).toBe('false');
    expect(value.confirm.hidden).toBe(false);
    expect(value.cancel.hidden).toBe(false);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(value.dialog.open).toBe(false);
  });

  it('uses the explicit fallback if the native showModal call fails', async () => {
    const value = fixture();
    Object.defineProperty(value.dialog, 'showModal', { value: () => { throw new Error('Not available'); } });
    const result = value.confirmation.ask(request());
    expect(value.dialog.dataset.dialogFallback).toBe('true');
    expect(value.dialog.style.position).toBe('static');
    value.confirm.click();
    await expect(result).resolves.toBe(true);
  });

  it('does not substitute the fallback if native opening was cancelled without an exception', async () => {
    const value = fixture();
    Object.defineProperty(value.dialog, 'showModal', { value: () => {} });
    await expect(value.confirmation.ask(request())).resolves.toBe(false);
    expect(value.dialog.dataset.dialogFallback).toBeUndefined();
    expect(value.dialog.hidden).toBe(true);
  });

  it.each([false, true])('does not call blocking browser prompts or intercept native field keys (native=%s)', async native => {
    const value = fixture(native);
    const alert = vi.fn(); const prompt = vi.fn(() => null); const confirm = vi.fn(() => false);
    for (const [name, replacement] of [['alert', alert], ['prompt', prompt], ['confirm', confirm]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      Object.defineProperty(window, name, { configurable: true, value: replacement });
      cleanups.push(() => { if (descriptor) Object.defineProperty(window, name, descriptor); else Reflect.deleteProperty(window, name); });
    }
    const result = value.confirmation.ask(request());
    for (const key of ['Escape', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'Tab']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      control('native-choice').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    value.cancel.click();
    await result;
    expect(alert).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });

  it.each([false, true])('CONFIRM-DISPOSE rejects pending and future decisions and removes listeners (native=%s)', async native => {
    const value = fixture(native);
    const isCurrent = vi.fn(() => true);
    const result = value.confirmation.ask(request({ isCurrent }));
    value.confirmation.dispose();
    value.confirmation.dispose();
    value.confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(result).resolves.toBe(false);
    await expect(value.confirmation.ask(request())).resolves.toBe(false);
    expect(value.dialog.open).toBe(false);
    expect(isCurrent).not.toHaveBeenCalled();
  });

  it('rejects an ask when the owned dialog was removed instead of leaving an unreachable decision', async () => {
    const value = fixture(false);
    value.dialog.remove();
    await expect(value.confirmation.ask(request())).resolves.toBe(false);
  });

  it('supports a custom dialog ID and validates required markup', async () => {
    document.body.innerHTML = markup('review-action');
    const dialog = control<HTMLDialogElement>('review-action');
    nativeDialog(dialog);
    const confirmation = new ActionConfirmation({ dialogId: 'review-action' });
    cleanups.push(() => confirmation.dispose());
    const result = confirmation.ask(request());
    control('review-action-cancel').click();
    await expect(result).resolves.toBe(false);
    expect(() => new ActionConfirmation({ dialogId: 'missing' })).toThrow('Missing action confirmation control');
  });
});
