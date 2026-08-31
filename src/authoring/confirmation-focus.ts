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

/** A return target must remain usable after every transient surface closes. */
function persistentTarget(element: Element | null, root: Document): element is HTMLElement {
  const HTMLElementClass = root.defaultView?.HTMLElement ?? HTMLElement;
  if (!(element instanceof HTMLElementClass) || !element.isConnected || element.ownerDocument !== root
    || !element.matches(focusable) || element.matches('input[type="hidden"], :disabled')
    || element.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    // A currently open popover is still unsuitable: closing it is the caller's
    // next step. Known IDs also cover owners whose fallback removes popover.
    if (surfaceTriggers.has(ancestor.id) || ancestor.hasAttribute('popover') || ancestor.dataset.popoverFallback === 'true') return false;
    if (ancestor.tagName === 'DIALOG' && !ancestor.hasAttribute('open')) return false;
    if (ancestor.tagName === 'FIELDSET' && ancestor.hasAttribute('disabled') && element.matches('button, input, select, textarea')) {
      const legend: Element | undefined = Array.from(ancestor.children).find(child => child.tagName === 'LEGEND');
      if (!legend?.contains(element)) return false;
    }
    if (ancestor.tagName === 'DETAILS' && !ancestor.hasAttribute('open') && ancestor !== element) {
      const summary: Element | undefined = Array.from(ancestor.children).find(child => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
    const style = root.defaultView?.getComputedStyle(ancestor);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden' || style?.opacity === '0') return false;
  }
  return true;
}

/** Resolve before closing surfaces; this lookup never focuses or mutates UI. */
export function confirmationReturnTarget(active: Element | null, root: Document = document): HTMLElement | undefined {
  const available = (ids: readonly string[]): HTMLElement | undefined => {
    for (const id of ids) {
      const element = root.getElementById(id);
      if (persistentTarget(element, root)) return element;
    }
    return undefined;
  };
  if (active?.isConnected && active.ownerDocument === root) {
    // File inputs are intentionally hidden, including after their containing
    // menu closes while the system file picker is in use.
    if (active.id === 'project-file') return available(['document-menu-trigger']);
    for (let ancestor: Element | null = active; ancestor; ancestor = ancestor.parentElement) {
      const triggers = surfaceTriggers.get(ancestor.id);
      if (triggers) return available([...triggers, 'document-menu-trigger']);
    }
    if (persistentTarget(active, root)) return active;
    // A button's visible label or icon may be supplied instead of the button.
    // Do not turn arbitrary non-focusable score content into a new invoker.
    const invoker = active.closest('button, a[href], summary');
    if (persistentTarget(invoker, root)) return invoker;
  }
  return available(['document-menu-trigger']);
}
