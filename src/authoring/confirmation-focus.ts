import { composedAncestors, composedContains, isRenderedInParent } from '../ui/composed-dom.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot } from './control-scope.js';

const surfaceTriggers = new Map<string, readonly string[]>([
  ['document-menu', ['document-menu-trigger']],
  ['score-setup', ['document-menu-trigger']],
  ['location-panel', ['location-trigger', 'active-part-label']],
  ['source-panel', ['source-trigger']],
  ['entry-settings', ['entry-settings-trigger']],
  ['note-editor', ['edit-selected-event']],
  ['workspace-review', ['workspace-review-trigger']],
  ['continuation-review', ['location-trigger', 'active-part-label']],
  ['pointer-recovery', ['location-trigger', 'active-part-label']],
]);

const focusable = 'button, input, select, textarea, a[href], area[href], summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';

/** Recheck the actual node after closing; a reused ID never replaces an invoker. */
export function canRestoreConfirmationFocus(element: Element | null | undefined, root: Document): element is HTMLElement {
  const HTMLElementClass = root.defaultView?.HTMLElement ?? HTMLElement;
  if (!(element instanceof HTMLElementClass) || !element.isConnected || element.ownerDocument !== root
    || !element.matches(focusable) || element.matches('input[type="hidden"], :disabled')) return false;

  // Disabled fieldsets and their first-legend exception are native logical-DOM
  // rules: slots must neither introduce nor remove form-control disabledness.
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.getAttribute('aria-disabled') === 'true') return false;
    if (ancestor.tagName === 'FIELDSET' && ancestor.hasAttribute('disabled') && element.matches('button, input, select, textarea')) {
      const legend: Element | undefined = Array.from(ancestor.children).find(child => child.tagName === 'LEGEND');
      if (!legend?.contains(element)) return false;
    }
  }
  // Visibility follows the rendered tree, including slotted panels and the
  // enclosing hosts of shadow-owned controls, even outside the lookup scope.
  for (const ancestor of [element, ...composedAncestors(element)]) {
    // Connected light children without an assigned slot, and superseded slot
    // fallback, have no rendered focus target even when their styles are visible.
    if (!isRenderedInParent(ancestor)) return false;
    if (ancestor.matches('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (ancestor.tagName === 'DIALOG' && !ancestor.hasAttribute('open')) return false;
    if (ancestor.hasAttribute('popover') && 'hidePopover' in ancestor && typeof ancestor.hidePopover === 'function') {
      try { if (!ancestor.matches(':popover-open')) return false; } catch { /* Explicit hidden state covers older engines. */ }
    }
    if (ancestor.tagName === 'DETAILS' && !ancestor.hasAttribute('open') && ancestor !== element) {
      const summary: Element | undefined = Array.from(ancestor.children).find(child => child.tagName === 'SUMMARY');
      if (!summary || !composedContains(summary, element)) return false;
    }
    const style = root.defaultView?.getComputedStyle(ancestor);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden' || style?.opacity === '0') return false;
  }
  return true;
}

/** A return target must remain usable after every transient surface closes. */
function persistentTarget(element: Element | null, root: Document): element is HTMLElement {
  if (!canRestoreConfirmationFocus(element, root)) return false;
  for (const ancestor of [element, ...composedAncestors(element)]) {
    // A currently open popover is still unsuitable: closing it is the caller's
    // next step. Known IDs also cover owners whose fallback removes popover.
    if (surfaceTriggers.has(ancestor.id) || ancestor.hasAttribute('popover') || ancestor.getAttribute('data-popover-fallback') === 'true') return false;
  }
  return true;
}

/** Resolve before closing surfaces; this lookup never focuses or mutates UI. */
export function confirmationReturnTarget(active: Element | null, root: ControlRoot = document): HTMLElement | undefined {
  const scope = asControlScope(root);
  const ownerDocument = scope.document;
  const available = (ids: readonly string[]): HTMLElement | undefined => {
    for (const id of ids) {
      const element = scope.getElementById(id);
      if (persistentTarget(element, ownerDocument)) return element;
    }
    return undefined;
  };
  if (active?.isConnected && active.ownerDocument === ownerDocument && scope.contains(active)) {
    // File inputs are intentionally hidden, including after their containing
    // menu closes while the system file picker is in use.
    if (active.id === 'project-file') return available(['document-menu-trigger']);
    for (const ancestor of [active, ...composedAncestors(active)]) {
      const triggers = surfaceTriggers.get(ancestor.id);
      if (triggers) return available([...triggers, 'document-menu-trigger']);
    }
    if (persistentTarget(active, ownerDocument)) return active;
    // A button's visible label or icon may be supplied instead of the button.
    // Do not turn arbitrary non-focusable score content into a new invoker.
    for (const invoker of [active, ...composedAncestors(active)]) {
      if (invoker.matches('button, a[href], summary')) {
        if (scope.contains(invoker) && persistentTarget(invoker, ownerDocument)) return invoker;
        break;
      }
    }
  }
  return available(['document-menu-trigger']);
}
