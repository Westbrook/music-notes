import { composedAncestors } from '../ui/composed-dom.js';
import { asControlScope, type ControlRoot } from './control-scope.js';

interface SourceFailure { documentId: string; draft: string; message: string }

/** Local, session-only feedback for the exact Source draft that failed validation. */
export class SourceFeedback {
  private readonly input: HTMLTextAreaElement;
  private readonly error: HTMLElement;
  private failure: SourceFailure | null = null;

  constructor(root: ControlRoot = document) {
    const scope = asControlScope(root);
    const input = scope.getElementById('source-input');
    const error = scope.getElementById('source-error');
    if (input?.localName !== 'textarea' || input.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      throw new Error('SourceFeedback requires the #source-input textarea.');
    }
    if (!error || error.namespaceURI !== 'http://www.w3.org/1999/xhtml' || error.getAttribute('role')?.trim() !== 'alert') {
      throw new Error('SourceFeedback requires #source-error with role="alert".');
    }
    this.input = input as HTMLTextAreaElement;
    this.error = error;
    this.clear();
  }

  get message(): string { return this.failure?.message ?? ''; }

  fail(documentId: string, draft: string, message: string): void {
    this.failure = { documentId, draft, message };
    this.error.textContent = message;
    this.error.hidden = false;
    this.input.setAttribute('aria-invalid', 'true');
    this.reveal();
  }

  /** Navigation retains feedback; editing either its document or its exact draft invalidates it. */
  refresh(documentId: string, draft: string): void {
    if (this.failure && (this.failure.documentId !== documentId || this.failure.draft !== draft)) this.clear();
  }

  /** Also call on every project replacement, including reopening the same persisted project ID. */
  clear(): void {
    this.failure = null;
    this.error.textContent = '';
    this.error.hidden = true;
    this.input.removeAttribute('aria-invalid');
  }

  private reveal(): void {
    const body = [this.error, ...composedAncestors(this.error)]
      .find(element => element.matches('.popover-body')) as HTMLElement | undefined;
    if (!body) return;
    const bounds = body.getBoundingClientRect();
    const error = this.error.getBoundingClientRect();
    if (body.clientHeight <= 0 || bounds.height <= 0 || error.height <= 0) return;
    // Bounds are visual coordinates; scrolling uses the body's unscaled content units.
    const scale = body.offsetHeight > 0 ? bounds.height / body.offsetHeight : 1;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const top = bounds.top + body.clientTop * scale;
    const height = body.clientHeight * scale;
    const bottom = top + height;
    const delta = error.height > height || error.top < top ? error.top - top
      : error.bottom > bottom ? error.bottom - bottom : 0;
    if (!Number.isFinite(delta) || delta === 0) return;
    const limit = Math.max(0, body.scrollHeight - body.clientHeight);
    const next = Math.min(limit, Math.max(0, body.scrollTop + delta / scale));
    // Never use scrollIntoView: its ancestor scrolling could move the notation.
    if (Number.isFinite(next) && next !== body.scrollTop) body.scrollTop = next;
  }
}
