/**
 * Presentation follows slots and shadow hosts. Native label, form, fieldset,
 * and ID-reference rules still use their logical DOM tree instead of these
 * helpers; crossing a rendering boundary must not invent a native association.
 */
export function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root.nodeType === 11 && 'host' in root ? (root as ShadowRoot).host : null;
}

/** Ancestors start at the parent; include the element separately when needed. */
export function* composedAncestors(element: Element): IterableIterator<Element> {
  for (let parent = composedParent(element); parent; parent = composedParent(parent)) yield parent;
}

/** Slot distribution only; callers still check CSS, inertness, and native control rules. */
export function isRenderedInParent(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent) return true;
  if (parent.localName === 'slot' && typeof (parent as HTMLSlotElement).assignedNodes === 'function'
    && (parent as HTMLSlotElement).assignedNodes().length > 0) return false;
  // A light child with no slot is absent from an open host's rendered tree.
  // Engines without slot-assignment support retain their ordinary DOM fallback.
  return !parent.shadowRoot || !('assignedSlot' in element) || element.assignedSlot !== null;
}

/** Contains includes the container itself and supports an explicit ShadowRoot. */
export function composedContains(container: Node, node: Node | null): boolean {
  for (let current = node; current;) {
    if (current === container) return true;
    if ('assignedSlot' in current && current.assignedSlot) current = current.assignedSlot as HTMLSlotElement;
    else if (current.parentNode) current = current.parentNode;
    else current = current.nodeType === 11 && 'host' in current ? (current as ShadowRoot).host : null;
  }
  return false;
}

/** Read the real focused field, without querying unrelated component trees. */
export function activeElement(root: Document | ShadowRoot | HTMLElement): Element | null {
  const document = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (root.nodeType === 11 && active) {
    const shadow = root as ShadowRoot;
    // An explicitly supplied closed root can reveal focus beyond the document's
    // host. Other roots need no inspection and cannot own the focused element.
    if (composedContains(shadow.host, active)
      || shadow.host.getRootNode() !== active.getRootNode() && composedContains(active, shadow.host)) {
      active = shadow.activeElement ?? active;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    }
  }
  return active && composedContains(root, active) ? active : null;
}
