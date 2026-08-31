import { activeElement, composedAncestors, composedContains, isRenderedInParent } from '../ui/composed-dom.js';

function available(element: HTMLElement): boolean {
  // Native :disabled follows fieldsets and their legend exception in the logical
  // tree. Presentation, including inertness and clipping, follows the flat tree.
  if (!element.isConnected || element.matches(':disabled')) return false;
  const view = element.ownerDocument.defaultView;
  for (const ancestor of [element, ...composedAncestors(element)]) {
    if (!isRenderedInParent(ancestor) || ancestor.matches('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = view?.getComputedStyle(ancestor);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden') return false;
    if (ancestor.matches('details:not([open])')) {
      const summary = ancestor.querySelector(':scope > summary');
      if (!summary || !composedContains(summary, element)) return false;
    }
  }
  return true;
}

function revealAxis(container: HTMLElement, element: HTMLElement, axis: 'vertical' | 'horizontal'): void {
  const vertical = axis === 'vertical';
  const size = vertical ? container.clientHeight : container.clientWidth;
  const content = vertical ? container.scrollHeight : container.scrollWidth;
  if (size <= 0 || content <= size) return;
  const startKey = vertical ? 'top' : 'left', endKey = vertical ? 'bottom' : 'right', sizeKey = vertical ? 'height' : 'width';
  const field = element.getBoundingClientRect();
  // Labels do not acquire a native association by crossing a shadow boundary.
  const label = element.closest('label');
  const labelBounds = label && label !== container && composedContains(container, label) ? label.getBoundingClientRect() : null;
  // Keep a helpful label visible when it fits; a tall label must not hide its input.
  const target = labelBounds && labelBounds[sizeKey] <= size && labelBounds[startKey] <= field[startKey] && labelBounds[endKey] >= field[endKey]
    ? labelBounds : field;
  const padding = Math.max(0, Math.min(8, (size - target[sizeKey]) / 2));
  const bounds = container.getBoundingClientRect();
  const start = bounds[startKey] + (vertical ? container.clientTop : container.clientLeft) + padding;
  const end = start + size - 2 * padding;
  const delta = target[startKey] < start ? target[startKey] - start
    : target[endKey] > end ? Math.min(target[startKey] - start, target[endKey] - end) : 0;
  if (!delta) return;
  const current = vertical ? container.scrollTop : container.scrollLeft;
  const next = Math.max(0, Math.min(content - size, current + delta));
  if (vertical) container.scrollTop = next; else container.scrollLeft = next;
}

/** Explicit field focus may reveal tools content, never the score or document. */
export function focusInTools(element: HTMLElement): void {
  if (!available(element)) return;
  const chain = [element, ...composedAncestors(element)];
  const boundary = chain.find(ancestor => ancestor.matches('.workspace-tools')) ?? chain.find(ancestor => ancestor.matches('.tool-panel'));
  element.focus({ preventScroll: true });
  const stillOwnsFocus = () => {
    return available(element) && activeElement(element.ownerDocument) === element
      && !!boundary?.isConnected && composedContains(boundary, element);
  };
  if (!stillOwnsFocus()) return;
  for (const container of composedAncestors(element)) {
    if (!composedContains(boundary!, container)) break;
    if (!(container instanceof HTMLElement)) continue;
    for (const axis of ['vertical', 'horizontal'] as const) {
      if (!stillOwnsFocus()) return;
      // Read geometry again after every inner scroll; outer coordinates have changed.
      revealAxis(container, element, axis);
    }
    if (container === boundary) break;
  }
}
