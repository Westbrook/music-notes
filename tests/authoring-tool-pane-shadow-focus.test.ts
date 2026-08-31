// @vitest-environment happy-dom
/** Composed routing and measured rectangles only; not native layout qualification. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusInTools } from '../src/authoring/tool-pane-focus.js';

// Happy DOM has no assignedSlot; supply only the fixture's known routing edges.
function assign(element: Element, slot: HTMLSlotElement | null): void {
  Object.defineProperty(element, 'assignedSlot', { configurable: true, value: slot });
}

function metrics(element: HTMLElement, height: number, content: number): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height }, scrollHeight: { configurable: true, value: content },
    clientWidth: { configurable: true, value: 220 }, scrollWidth: { configurable: true, value: 220 },
  });
}

function fixture(shadowField = false) {
  const score = document.createElement('button'); score.textContent = 'Score';
  const host = document.createElement('tools-fixture');
  document.body.append(score, host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<aside class="workspace-tools"><tools-fields><slot name="fields" slot="fields"></slot></tools-fields></aside>';
  const outer = root.querySelector<HTMLElement>('aside')!;
  const fields = root.querySelector<HTMLElement>('tools-fields')!;
  const forward = root.querySelector<HTMLSlotElement>('slot')!;
  const fieldsRoot = fields.attachShadow({ mode: 'open' });
  fieldsRoot.innerHTML = '<section class="tool-panel"><slot name="fields"></slot></section>';
  const inner = fieldsRoot.querySelector<HTMLElement>('section')!;
  const slot = fieldsRoot.querySelector<HTMLSlotElement>('slot')!;
  const label = document.createElement('label'); label.slot = 'fields'; label.append('Pitch'); host.append(label);
  assign(label, forward); assign(forward, slot);
  const fieldHost = document.createElement('pitch-field'); label.append(fieldHost);
  const fieldRoot = shadowField ? fieldHost.attachShadow({ mode: 'open' }) : null;
  const field = document.createElement('input');
  const sibling = document.createElement('input');
  (fieldRoot ?? fieldHost).append(field, sibling);
  metrics(outer, 180, 1400); metrics(inner, 120, 1000);
  outer.scrollTop = 40; inner.scrollTop = 25;
  score.scrollTop = 237; document.documentElement.scrollTop = 370;
  vi.spyOn(outer, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40, 100, 220, outer.clientHeight));
  vi.spyOn(inner, 'getBoundingClientRect').mockImplementation(() => new DOMRect(40, 420 - outer.scrollTop, 220, inner.clientHeight));
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(56, inner.getBoundingClientRect().top + 600 - inner.scrollTop, 120, 44));
  vi.spyOn(label, 'getBoundingClientRect').mockImplementation(() => new DOMRect(56, field.getBoundingClientRect().top - 20, 140, 64));
  const windowScroll = vi.spyOn(window, 'scrollTo');
  const intoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  score.focus();
  const preserved = () => {
    expect(score.scrollTop).toBe(237); expect(document.documentElement.scrollTop).toBe(370);
    expect(windowScroll).not.toHaveBeenCalled(); expect(intoView).not.toHaveBeenCalled();
  };
  const unscrolled = () => { expect(outer.scrollTop).toBe(40); expect(inner.scrollTop).toBe(25); preserved(); };
  const visible = (target: HTMLElement, container: HTMLElement) => {
    const box = target.getBoundingClientRect(), bounds = container.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(bounds.top);
    expect(box.bottom).toBeLessThanOrEqual(bounds.top + container.clientHeight);
  };
  return { score, host, root, outer, fields, fieldsRoot, inner, forward, slot, label, fieldHost, fieldRoot, field, sibling, preserved, unscrolled, visible };
}

afterEach(() => { document.body.replaceChildren(); document.documentElement.scrollTop = 0; vi.restoreAllMocks(); });

describe('field focus through composed tool scrollports', () => {
  it.each([false, true])('reveals a field through nested forwarded slots with shadow field=%s', shadowField => {
    const f = fixture(shadowField);
    expect(f.label.assignedSlot).toBe(f.forward); expect(f.forward.assignedSlot).toBe(f.slot);
    const focus = vi.spyOn(f.field, 'focus'); focusInTools(f.field);
    expect(document.activeElement).toBe(shadowField ? f.fieldHost : f.field);
    if (shadowField) expect(f.fieldRoot!.activeElement).toBe(f.field);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(f.inner.scrollTop).toBeGreaterThan(25); expect(f.outer.scrollTop).toBeGreaterThan(40);
    f.visible(f.field, f.inner); f.visible(f.field, f.outer);
    if (!shadowField) { f.visible(f.label, f.inner); f.visible(f.label, f.outer); }
    f.preserved();
  });

  it.each(['host-inert', 'slot-inert', 'wrapper-hidden', 'slot-hidden', 'host-content-hidden'] as const)('does not focus or scroll %s content', kind => {
    const f = fixture(true), focus = vi.spyOn(f.field, 'focus');
    if (kind === 'host-inert') f.host.setAttribute('inert', '');
    if (kind === 'slot-inert') f.slot.setAttribute('inert', '');
    if (kind === 'wrapper-hidden') f.inner.hidden = true;
    if (kind === 'slot-hidden') f.forward.style.display = 'none';
    if (kind === 'host-content-hidden') f.fields.style.contentVisibility = 'hidden';
    focusInTools(f.field);
    expect(focus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(f.score); f.unscrolled();
  });

  it('stops revealing when a listener redirects focus within the same shadow host', () => {
    const f = fixture(true); f.field.addEventListener('focus', () => f.sibling.focus(), { once: true });
    focusInTools(f.field);
    expect(document.activeElement).toBe(f.fieldHost); expect(f.fieldRoot!.activeElement).toBe(f.sibling); f.unscrolled();
  });

  it('keeps its original tools boundary when a focus listener reassigns the field slot', () => {
    const f = fixture();
    const foreign = document.createElement('aside'); foreign.className = 'workspace-tools';
    foreign.innerHTML = '<slot name="foreign"></slot>'; f.root.append(foreign); metrics(foreign, 140, 1000);
    f.field.addEventListener('focus', () => { f.label.slot = 'foreign'; assign(f.label, foreign.firstElementChild as HTMLSlotElement); }, { once: true });
    focusInTools(f.field);
    expect(f.label.assignedSlot).toBe(foreign.firstElementChild);
    expect(document.activeElement).toBe(f.field); expect(foreign.scrollTop).toBe(0); f.unscrolled();
  });

  it('stops revealing when a focus listener makes a composed ancestor inert', () => {
    const f = fixture(true); f.field.addEventListener('focus', () => f.forward.setAttribute('inert', ''), { once: true });
    focusInTools(f.field); f.unscrolled();
  });

  it('does not focus content left unassigned by an open shadow host', () => {
    const f = fixture(true), focus = vi.spyOn(f.field, 'focus');
    f.label.slot = 'missing'; assign(f.label, null);
    focusInTools(f.field);
    expect(focus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(f.score); f.unscrolled();
  });

  it('does not focus slot fallback content suppressed by an assignment', () => {
    const f = fixture(true), focus = vi.spyOn(f.field, 'focus');
    f.forward.append(f.fieldHost);
    vi.spyOn(f.forward, 'assignedNodes').mockReturnValue([f.label]);
    focusInTools(f.field);
    expect(focus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(f.score); f.unscrolled();
  });

  it('keeps label associations logical when a shadow label wraps the assigned content', () => {
    const f = fixture(); f.label.replaceWith(f.fieldHost); f.fieldHost.slot = 'fields'; assign(f.fieldHost, f.forward);
    const shadowLabel = document.createElement('label'); f.slot.replaceWith(shadowLabel); shadowLabel.append(f.slot);
    metrics(f.outer, 1000, 1000); f.outer.scrollTop = 0; f.inner.scrollTop = 200;
    vi.spyOn(f.field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(56, f.inner.getBoundingClientRect().top + 20, 120, 44));
    const labelBounds = vi.spyOn(shadowLabel, 'getBoundingClientRect').mockImplementation(() => new DOMRect(56, f.field.getBoundingClientRect().top - 50, 140, 94));
    focusInTools(f.field);
    expect(document.activeElement).toBe(f.field); expect(f.inner.scrollTop).toBe(200); expect(labelBounds).not.toHaveBeenCalled(); f.preserved();
  });

  it('does not inherit native disability from a shadow fieldset around a slot', () => {
    const f = fixture(), fieldset = document.createElement('fieldset'); fieldset.disabled = true;
    f.slot.replaceWith(fieldset); fieldset.append(f.slot);
    focusInTools(f.field);
    expect(document.activeElement).toBe(f.field); expect(f.inner.scrollTop).toBeGreaterThan(25); f.preserved();
  });

  it.each([false, true])('uses the native direct summary of closed details, summary=%s', inSummary => {
    const f = fixture(), details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = 'Properties'; f.slot.replaceWith(details); details.append(summary);
    (inSummary ? summary : details).append(f.slot);
    focusInTools(f.field);
    if (inSummary) { expect(document.activeElement).toBe(f.field); expect(f.inner.scrollTop).toBeGreaterThan(25); }
    else { expect(document.activeElement).toBe(f.score); f.unscrolled(); }
    f.preserved();
  });

  it('checks outer closed details even when the field is inside an inner summary', () => {
    const f = fixture(), outer = document.createElement('details'), inner = document.createElement('details'), summary = document.createElement('summary');
    f.slot.replaceWith(outer); outer.append(inner); inner.append(summary); summary.append(f.slot);
    focusInTools(f.field); expect(document.activeElement).toBe(f.score); f.unscrolled();
  });
});
