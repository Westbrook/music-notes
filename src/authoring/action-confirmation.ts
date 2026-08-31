import { activeElement, composedAncestors, composedContains } from '../ui/composed-dom.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';
import { canRestoreConfirmationFocus } from './confirmation-focus.js';

export interface ActionConfirmationOptions {
  readonly dialogId?: string;
}

export interface ActionConfirmationRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  /** The caller captures identities/revision before ask and checks again after await. */
  readonly isCurrent: () => boolean;
  readonly returnFocus?: HTMLElement;
}

interface PendingDecision {
  readonly isCurrent: () => boolean;
  readonly returnFocus: HTMLElement | null;
  readonly previousFocus: HTMLElement | null;
  readonly resolve: (accepted: boolean) => void;
  stale: boolean;
}

/** Collects one explicit decision. It never executes a musical or project mutation. */
export class ActionConfirmation {
  private readonly scope: ControlScope;
  private readonly document: Document;
  private readonly dialog: HTMLDialogElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly status: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly abort = new AbortController();
  private native: boolean;
  private pending?: PendingDecision;
  private disposed = false;

  constructor(options: ActionConfirmationOptions = {}, root: ControlRoot = document) {
    this.scope = asControlScope(root);
    this.document = this.scope.document;
    const id = options.dialogId ?? 'author-confirmation';
    const element = <T extends HTMLElement>(controlId: string): T => {
      const control = this.scope.getElementById(controlId);
      if (!control) throw new Error(`Missing action confirmation control: ${controlId}`);
      return control as T;
    };
    this.dialog = element(id);
    if (this.dialog.tagName !== 'DIALOG') throw new Error('Action confirmation requires a dialog element.');
    this.title = element(`${id}-title`);
    this.message = element(`${id}-message`);
    this.status = element(`${id}-status`);
    this.confirmButton = element(`${id}-confirm`);
    this.cancelButton = element(`${id}-cancel`);
    for (const control of [this.title, this.message, this.status, this.confirmButton, this.cancelButton]) {
      if (!this.dialog.contains(control)) throw new Error(`Action confirmation control must belong to its dialog: ${control.id}`);
    }
    this.native = typeof this.dialog.showModal === 'function' && typeof this.dialog.close === 'function';
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-labelledby', this.title.id);
    this.dialog.setAttribute('aria-describedby', this.message.id);
    this.status.setAttribute('role', 'alert');
    this.confirmButton.type = 'button';
    this.cancelButton.type = 'button';
    this.confirmButton.disabled = true;
    this.status.hidden = true;
    this.closeDialog(false);
    if (!this.native) this.useFallback();
    const signal = this.abort.signal;
    this.confirmButton.addEventListener('click', () => this.accept(), { signal });
    this.cancelButton.addEventListener('click', () => this.finish(false), { signal });
    this.dialog.addEventListener('cancel', event => {
      if (event.target !== this.dialog || !this.pending) return;
      // Use the browser's close request (including Escape), not a keyboard shim.
      event.preventDefault();
      this.finish(false);
    }, { signal });
    this.dialog.addEventListener('close', event => {
      if (event.target !== this.dialog || this.dialog.open) return;
      // A queued close from an earlier request cannot cancel a newly open one.
      // returnValue never authorizes an action; only the named button does.
      this.finish(false);
    }, { signal });
  }

  ask(request: ActionConfirmationRequest): Promise<boolean> {
    if (this.disposed || this.pending || this.dialog.open || !this.dialog.isConnected) return Promise.resolve(false);
    const active = this.scope.activeElement;
    const HTMLElementClass = this.document.defaultView?.HTMLElement ?? HTMLElement;
    const previousFocus = active instanceof HTMLElementClass && active !== this.document.body && !composedContains(this.dialog, active) ? active : null;
    let resolve!: (accepted: boolean) => void;
    const result = new Promise<boolean>(complete => { resolve = complete; });
    // Copy the function and focus references; a later mutation of the request
    // object must not replace the decision that is already on screen.
    this.pending = { isCurrent: request.isCurrent, returnFocus: request.returnFocus ?? previousFocus, previousFocus, resolve, stale: false };
    this.title.textContent = request.title;
    this.message.textContent = request.message;
    this.confirmButton.textContent = request.confirmLabel;
    this.confirmButton.disabled = false;
    this.cancelButton.textContent = 'Cancel';
    this.cancelButton.disabled = false;
    this.confirmButton.autofocus = !request.destructive;
    this.cancelButton.autofocus = !!request.destructive;
    this.status.textContent = '';
    this.status.hidden = true;
    this.dialog.returnValue = '';
    this.dialog.setAttribute('aria-describedby', this.message.id);
    this.dialog.setAttribute('aria-modal', String(this.native));
    this.dialog.dataset.destructive = String(!!request.destructive);
    this.dialog.dataset.confirmationState = 'open';
    this.dialog.hidden = false;
    if (this.native) {
      try { this.dialog.showModal(); }
      catch { this.useFallback(); }
      if (this.native && !this.dialog.open) {
        this.finish(false);
        return result;
      }
    }
    if (!this.native) {
      this.dialog.setAttribute('open', '');
      this.dialog.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    (request.destructive ? this.cancelButton : this.confirmButton).focus({ preventScroll: true });
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    if (this.pending) this.finish(false, false);
    else this.closeDialog(false);
  }

  private accept(): void {
    const decision = this.pending;
    if (this.disposed || !decision || decision.stale || this.confirmButton.disabled || !this.dialog.open || this.dialog.hidden) return;
    let current = false;
    try { current = decision.isCurrent() === true; } catch { /* A missing or unreadable target cannot be authorized. */ }
    if (this.disposed || this.pending !== decision) return;
    if (!current) {
      decision.stale = true;
      this.confirmButton.disabled = true;
      this.status.textContent = 'The music, selection, or settings have changed. Close and review this action before trying again.';
      this.status.hidden = false;
      this.dialog.setAttribute('aria-describedby', `${this.message.id} ${this.status.id}`);
      this.dialog.dataset.confirmationState = 'stale';
      this.cancelButton.textContent = 'Close and review';
      this.revealStatus();
      this.cancelButton.focus({ preventScroll: true });
      return;
    }
    this.finish(true);
  }

  private revealStatus(): void {
    // Long messages can scroll, but showing the local explanation must not move
    // the notation or the document behind this decision.
    for (const container of composedAncestors(this.status)) {
      if (!composedContains(this.dialog, container)) break;
      if (container.clientHeight > 0 && container.scrollHeight > container.clientHeight) {
        const top = container.getBoundingClientRect().top + container.clientTop;
        const target = this.status.getBoundingClientRect();
        if (target.top < top) container.scrollTop += target.top - top;
        else if (target.bottom > top + container.clientHeight) container.scrollTop += Math.min(target.top - top, target.bottom - top - container.clientHeight);
      }
      if (container === this.dialog) break;
    }
  }

  private finish(accepted: boolean, restoreFocus = true): void {
    const decision = this.pending;
    if (!decision) return;
    this.pending = undefined;
    this.confirmButton.disabled = true;
    const closed = this.closeDialog(accepted);
    if (restoreFocus) {
      const target = canRestoreConfirmationFocus(decision.returnFocus, this.document) ? decision.returnFocus
        : canRestoreConfirmationFocus(decision.previousFocus, this.document) ? decision.previousFocus : undefined;
      target?.focus({ preventScroll: true });
    }
    const active = activeElement(this.document);
    const HTMLElementClass = this.document.defaultView?.HTMLElement ?? HTMLElement;
    if (active instanceof HTMLElementClass && composedContains(this.dialog, active)) active.blur();
    decision.resolve(accepted && closed);
  }

  private closeDialog(accepted: boolean): boolean {
    let closed = true;
    if (this.native && this.dialog.open) {
      try { this.dialog.close(accepted ? 'accepted' : 'cancelled'); }
      catch { closed = false; }
    }
    this.dialog.removeAttribute('open');
    this.dialog.hidden = true;
    this.dialog.dataset.confirmationState = 'closed';
    return closed;
  }

  private useFallback(): void {
    this.native = false;
    this.dialog.dataset.dialogFallback = 'true';
    this.dialog.style.position = 'static';
    this.dialog.style.inset = 'auto';
    this.dialog.setAttribute('aria-modal', 'false');
  }
}
