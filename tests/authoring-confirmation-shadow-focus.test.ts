// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionConfirmation } from '../src/authoring/action-confirmation.js';
import { canRestoreConfirmationFocus, confirmationReturnTarget } from '../src/authoring/confirmation-focus.js';
import { ControlScope } from '../src/authoring/control-scope.js';
import { activeElement } from '../src/ui/composed-dom.js';

const cleanups: (() => void)[] = [];

function button(id = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.id = id;
  element.textContent = id || 'Action';
  return element;
}

function shadowHost(parent: Node = document.body): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  parent.appendChild(host);
  return { host, root };
}

/** happy-dom exposes assignedElements but omits the native assignedSlot getter. */
function assignSlots(root: ShadowRoot): void {
  for (const slot of root.querySelectorAll('slot')) {
    for (const element of slot.assignedElements()) Object.defineProperty(element, 'assignedSlot', { configurable: true, value: slot });
  }
}

function dialogMarkup(): string {
  return `<dialog id="author-confirmation">
    <h2 id="author-confirmation-title"></h2>
    <p id="author-confirmation-message"></p><p id="author-confirmation-status"></p>
    <button id="author-confirmation-cancel">Cancel</button>
    <button id="author-confirmation-confirm">Confirm</button>
  </dialog>`;
}

function confirmation(scope: ControlScope) {
  const dialog = scope.getElementById('author-confirmation') as HTMLDialogElement;
  // Lifecycle only; these tests do not simulate native modal focus or inertness.
  Object.defineProperties(dialog, {
    showModal: { configurable: true, value: undefined },
    close: { configurable: true, value: undefined },
  });
  const manager = new ActionConfirmation({}, scope);
  cleanups.push(() => manager.dispose());
  return {
    manager, dialog,
    cancel: scope.getElementById('author-confirmation-cancel') as HTMLButtonElement,
  };
}

function ask(manager: ActionConfirmation, returnFocus?: HTMLElement): Promise<boolean> {
  return manager.ask({
    title: 'Remove measure?', message: 'Undo restores this measure.', confirmLabel: 'Remove',
    destructive: true, isCurrent: () => true, returnFocus,
  });
}

afterEach(() => {
  cleanups.splice(0).reverse().forEach(dispose => dispose());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('confirmation return targets in explicit control trees', () => {
  it.each(['element', 'shadow'] as const)('keeps duplicate invoker and dialog IDs isolated by %s scope', async kind => {
    const outside = document.createElement('section');
    outside.innerHTML = `<button id="document-menu-trigger">Other Document</button>${dialogMarkup()}`;
    document.body.append(outside);
    const host = document.createElement('section');
    document.body.append(host);
    const target = kind === 'shadow' ? host.attachShadow({ mode: 'open' }) : host;
    target.innerHTML = `<button id="document-menu-trigger">Own Document</button>${dialogMarkup()}`;
    const scope = new ControlScope(target);
    const own = scope.getElementById('document-menu-trigger')!;
    expect(confirmationReturnTarget(null, target)).toBe(own);
    expect(confirmationReturnTarget(outside.querySelector('button'), target)).toBe(own);
    const value = confirmation(scope);
    own.focus();
    const result = ask(value.manager);
    expect(activeElement(document)).toBe(value.cancel);
    expect(outside.querySelector('dialog')!.open).toBe(false);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(activeElement(document)).toBe(own);
  });

  it('maps a light control through its assigned slot to a shadow-owned transient', () => {
    const fallback = button('document-menu-trigger');
    const trigger = button('location-trigger');
    document.body.append(fallback, trigger);
    const { host, root } = shadowHost();
    root.innerHTML = '<section id="location-panel" popover="auto"><slot></slot></section>';
    const action = button('add-measure');
    host.append(action);
    assignSlots(root);
    expect(confirmationReturnTarget(action)).toBe(trigger);
    trigger.hidden = true;
    expect(confirmationReturnTarget(action)).toBe(fallback);
  });

  it.each(['hidden', 'inert', 'aria-hidden', 'display', 'visibility', 'content-visibility', 'opacity'])('rejects a slotted return target hidden by shadow %s', reason => {
    const fallback = button('document-menu-trigger');
    document.body.append(fallback);
    const { host, root } = shadowHost();
    root.innerHTML = '<section><slot></slot></section>';
    const wrapper = root.querySelector('section')!;
    const invoker = button();
    host.append(invoker);
    assignSlots(root);
    if (reason === 'hidden' || reason === 'inert') wrapper.setAttribute(reason, '');
    else if (reason === 'aria-hidden') wrapper.setAttribute(reason, 'true');
    else wrapper.style.setProperty(reason, reason === 'display' ? 'none' : reason === 'opacity' ? '0' : 'hidden');
    expect(confirmationReturnTarget(invoker)).toBe(fallback);
  });

  it('checks hidden ancestors outside a supplied shadow scope', () => {
    const { host, root } = shadowHost();
    const invoker = button('document-menu-trigger');
    root.append(invoker);
    expect(confirmationReturnTarget(invoker, root)).toBe(invoker);
    host.inert = true;
    expect(confirmationReturnTarget(invoker, root)).toBeUndefined();
  });

  it('rejects connected light controls that have no matching slot', () => {
    const fallback = button('document-menu-trigger');
    document.body.append(fallback);
    const { host, root } = shadowHost();
    root.innerHTML = '<slot name="visible"></slot>';
    const invoker = button();
    Object.defineProperty(invoker, 'assignedSlot', { value: null });
    host.append(invoker);
    expect(invoker.isConnected).toBe(true);
    expect(confirmationReturnTarget(invoker)).toBe(fallback);
  });

  it('rejects suppressed slot fallback while keeping the assigned control available', () => {
    const { host, root } = shadowHost();
    root.innerHTML = '<slot><button id="document-menu-trigger">Fallback action</button></slot>';
    const fallback = root.querySelector('button')!;
    expect(confirmationReturnTarget(fallback, root)).toBe(fallback);
    const assigned = button();
    host.append(assigned);
    assignSlots(root);
    expect(confirmationReturnTarget(fallback, root)).toBeUndefined();
    expect(confirmationReturnTarget(assigned)).toBe(assigned);
  });

  it('resolves a slotted icon to its composed button without inventing a label association', () => {
    const { host, root } = shadowHost();
    root.innerHTML = '<button><slot></slot></button>';
    const icon = document.createElement('span');
    host.append(icon);
    assignSlots(root);
    const scope = new ControlScope(host);
    scope.register(root);
    expect(confirmationReturnTarget(icon, scope)).toBe(root.querySelector('button'));
  });

  it('requires dialog labels to share its logical tree even when another control root is registered', () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const dialog = root.querySelector('dialog')!;
    const nested = shadowHost(dialog);
    nested.root.append(root.getElementById('author-confirmation-title')!);
    const scope = new ControlScope(root);
    scope.register(nested.root);
    expect(() => new ActionConfirmation({}, scope)).toThrow('Action confirmation control must belong to its dialog');
  });
});

describe('native form semantics across confirmation presentation boundaries', () => {
  it('does not disable a light control slotted through a shadow fieldset', () => {
    const { host, root } = shadowHost();
    root.innerHTML = '<fieldset disabled><slot></slot></fieldset>';
    const invoker = button();
    host.append(invoker);
    assignSlots(root);
    expect(confirmationReturnTarget(invoker)).toBe(invoker);
  });

  it('keeps logical disabled-fieldset rules and the first-legend exception after slotting', () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    fieldset.innerHTML = '<legend></legend><legend></legend>';
    document.body.append(fieldset);
    const first = shadowHost(fieldset.firstElementChild!);
    const second = shadowHost(fieldset.lastElementChild!);
    first.root.innerHTML = '<slot></slot>';
    second.root.innerHTML = '<slot></slot>';
    const permitted = button();
    const disabled = button();
    first.host.append(permitted);
    second.host.append(disabled);
    assignSlots(first.root);
    assignSlots(second.root);
    expect(confirmationReturnTarget(permitted)).toBe(permitted);
    expect(confirmationReturnTarget(disabled)).toBeUndefined();
  });

  it('does not extend an outer disabled fieldset into an internal shadow control', () => {
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    document.body.append(fieldset);
    const { root } = shadowHost(fieldset);
    const invoker = button();
    root.append(invoker);
    expect(confirmationReturnTarget(invoker, root)).toBe(invoker);
  });

  it('uses the first logical summary while checking composed visibility in closed details', () => {
    const { host, root } = shadowHost();
    root.innerHTML = '<details><summary><slot name="summary"></slot></summary><summary><slot name="other"></slot></summary><slot></slot></details>';
    const summaryAction = button();
    summaryAction.slot = 'summary';
    const otherSummaryAction = button();
    otherSummaryAction.slot = 'other';
    const bodyAction = button();
    host.append(summaryAction, otherSummaryAction, bodyAction);
    assignSlots(root);
    expect(confirmationReturnTarget(summaryAction)).toBe(summaryAction);
    expect(confirmationReturnTarget(otherSummaryAction)).toBeUndefined();
    expect(confirmationReturnTarget(bodyAction)).toBeUndefined();
  });
});

describe('confirmation focus restoration across shadow boundaries', () => {
  it('captures and restores the exact focused control in a registered nested root', async () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const nested = shadowHost(root);
    const invoker = button();
    nested.root.append(invoker);
    const scope = new ControlScope(root);
    scope.register(nested.root);
    const value = confirmation(scope);
    invoker.focus();
    const focus = vi.spyOn(invoker, 'focus');
    const result = ask(value.manager);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(activeElement(document)).toBe(invoker);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('rechecks slotted return visibility and falls back to the captured persistent control', async () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const previous = button();
    root.append(previous);
    const scope = new ControlScope(root);
    const value = confirmation(scope);
    const external = shadowHost();
    external.root.innerHTML = '<section><slot></slot></section>';
    const preferred = button();
    external.host.append(preferred);
    assignSlots(external.root);
    previous.focus();
    const focus = vi.spyOn(preferred, 'focus');
    const result = ask(value.manager, preferred);
    external.root.querySelector('section')!.hidden = true;
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(activeElement(document)).toBe(previous);
  });

  it('allows an explicitly supplied persistent invoker outside the dialog control scope', async () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const value = confirmation(new ControlScope(root));
    const external = button();
    document.body.append(external);
    const result = ask(value.manager, external);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(activeElement(document)).toBe(external);
  });

  it('blurs the actual shadow-owned dialog control when its invoker no longer survives', async () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const value = confirmation(new ControlScope(root));
    const result = ask(value.manager);
    expect(activeElement(document)).toBe(value.cancel);
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(activeElement(document)).not.toBe(value.cancel);
  });

  it('clears focus inside an unregistered child component of the closing dialog', async () => {
    const { root } = shadowHost();
    root.innerHTML = dialogMarkup();
    const value = confirmation(new ControlScope(root));
    const nested = shadowHost(value.dialog);
    const field = document.createElement('input');
    nested.root.append(field);
    const result = ask(value.manager);
    field.focus();
    const blur = vi.spyOn(field, 'blur');
    value.cancel.click();
    await expect(result).resolves.toBe(false);
    expect(blur).toHaveBeenCalledOnce();
    expect(activeElement(document)).not.toBe(field);
  });

  it('rejects closed native popover ancestors when rechecking a slotted target', () => {
    const { host, root } = shadowHost();
    root.innerHTML = '<section popover="auto"><slot></slot></section>';
    const panel = root.querySelector('section')!;
    const invoker = button();
    host.append(invoker);
    assignSlots(root);
    Object.defineProperty(panel, 'hidePopover', { value: () => {} });
    const nativeMatches = panel.matches.bind(panel);
    vi.spyOn(panel, 'matches').mockImplementation(selector => selector === ':popover-open' ? false : nativeMatches(selector));
    expect(canRestoreConfirmationFocus(invoker, document)).toBe(false);
  });
});
