function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert]') || (element as HTMLButtonElement).disabled) return false;
  const closed = element.closest('details:not([open])');
  return !closed || !!closed.querySelector(':scope > summary')?.contains(element);
}

function revealAxis(container: HTMLElement, element: HTMLElement, axis: 'vertical' | 'horizontal'): void {
  const vertical = axis === 'vertical';
  const size = vertical ? container.clientHeight : container.clientWidth;
  const content = vertical ? container.scrollHeight : container.scrollWidth;
  if (size <= 0 || content <= size) return;
  const startKey = vertical ? 'top' : 'left', endKey = vertical ? 'bottom' : 'right', sizeKey = vertical ? 'height' : 'width';
  const field = element.getBoundingClientRect();
  const label = element.closest('label');
  const labelBounds = label && label !== container && container.contains(label) ? label.getBoundingClientRect() : null;
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
  const boundary = element.closest<HTMLElement>('.workspace-tools') ?? element.closest<HTMLElement>('.tool-panel');
  element.focus({ preventScroll: true });
  const stillOwnsFocus = () => {
    const active = element.ownerDocument.activeElement;
    return available(element) && (element === active || element.isSameNode(active))
      && !!boundary?.isConnected && boundary.contains(element);
  };
  if (!stillOwnsFocus()) return;
  for (let container = element.parentElement; container && boundary!.contains(container); container = container.parentElement) {
    for (const axis of ['vertical', 'horizontal'] as const) {
      if (!stillOwnsFocus()) return;
      // Read geometry again after every inner scroll; outer coordinates have changed.
      revealAxis(container, element, axis);
    }
    if (container === boundary) break;
  }
}
