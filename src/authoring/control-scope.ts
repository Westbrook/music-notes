import { activeElement, composedContains } from '../ui/composed-dom.js';

type OwnedControlRoot = Document | ShadowRoot | HTMLElement;
export type ControlRoot = OwnedControlRoot | ControlScope;

const htmlNamespace = 'http://www.w3.org/1999/xhtml';

function ownerDocument(root: OwnedControlRoot): Document {
  return root.nodeType === 9 ? root as Document : root.ownerDocument!;
}

function isElement(root: OwnedControlRoot): root is HTMLElement { return root.nodeType === 1; }

/** Escape a quoted CSS attribute value; authored IDs are always treated as literal data. */
function idSelector(id: string): string {
  return `[id="${id.replace(/[\0-\x1f\x7f"\\]/g, value => `\\${value.charCodeAt(0).toString(16)} `)}"]`;
}

function elementById(root: HTMLElement, id: string): Element | null {
  if (root.id === id) return root;
  const tree = root.getRootNode();
  if (tree.nodeType === 9 || tree.nodeType === 11) {
    // Native tree indexes avoid repeated selector walks during form refreshes.
    // A missing ID cannot occur below this root in the same ordinary DOM tree.
    const indexed = (tree as Document | DocumentFragment).getElementById(id);
    if (!indexed || root.contains(indexed)) return indexed;
    // An earlier duplicate belongs to another component. Search only our root.
  }
  return id.includes('\0')
    ? [...root.querySelectorAll('[id]')].find(candidate => candidate.id === id) ?? null
    : root.querySelector(idSelector(id));
}

/**
 * Controllers own explicit control trees. Queries never discover or enter other
 * shadow roots, so a score component's authored source cannot become UI controls.
 * Element roots participate in queries along with their ordinary descendants.
 */
export class ControlScope {
  readonly document: Document;
  private readonly ownedRoots = new Map<OwnedControlRoot, number>();

  constructor(root: OwnedControlRoot) {
    this.document = ownerDocument(root);
    this.ownedRoots.set(root, 1);
  }

  get roots(): readonly OwnedControlRoot[] { return [...this.ownedRoots.keys()]; }

  /** Preserve focus handed elsewhere; ownership is tested separately with contains(). */
  get activeElement(): Element | null {
    let focused = activeElement(this.document);
    for (const root of this.ownedRoots.keys()) {
      // An explicitly supplied closed root can reveal focus beyond the host
      // returned by the document. This never discovers unregistered roots.
      if (root.nodeType !== 11 || !root.isConnected) continue;
      const local = activeElement(root);
      if (local && (!focused || composedContains(focused, local))) focused = local;
    }
    return focused;
  }

  contains(node: Node | null): boolean {
    if (!node) return false;
    for (const root of this.ownedRoots.keys()) if (root === node || root.contains(node)) return true;
    return false;
  }

  getElementById(id: string): HTMLElement | null {
    if (!id) return null;
    for (const root of this.ownedRoots.keys()) {
      const element = isElement(root) ? elementById(root, id) : root.getElementById(id);
      if (element?.namespaceURI === htmlNamespace) return element as HTMLElement;
    }
    return null;
  }

  querySelector<Key extends keyof HTMLElementTagNameMap>(selector: Key): HTMLElementTagNameMap[Key] | null;
  querySelector<ElementType extends Element = Element>(selector: string): ElementType | null;
  querySelector<ElementType extends Element = Element>(selector: string): ElementType | null {
    for (const root of this.ownedRoots.keys()) {
      if (isElement(root) && root.matches(selector)) return root as unknown as ElementType;
      const match = root.querySelector<ElementType>(selector);
      if (match) return match;
    }
    return null;
  }

  querySelectorAll<Key extends keyof HTMLElementTagNameMap>(selector: Key): HTMLElementTagNameMap[Key][];
  querySelectorAll<ElementType extends Element = Element>(selector: string): ElementType[];
  querySelectorAll<ElementType extends Element = Element>(selector: string): ElementType[] {
    const matches = new Set<ElementType>();
    for (const root of this.ownedRoots.keys()) {
      if (isElement(root) && root.matches(selector)) matches.add(root as unknown as ElementType);
      for (const match of root.querySelectorAll<ElementType>(selector)) matches.add(match);
    }
    return [...matches];
  }

  /** Registrations are reference counted; each owner releases only its own lease. */
  register(root: HTMLElement | ShadowRoot): () => void {
    if (ownerDocument(root) !== this.document) throw new Error('Controls in one scope must belong to the same document.');
    this.ownedRoots.set(root, (this.ownedRoots.get(root) ?? 0) + 1);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const count = this.ownedRoots.get(root)!;
      if (count === 1) this.ownedRoots.delete(root);
      else this.ownedRoots.set(root, count - 1);
    };
  }
}

export function asControlScope(root: ControlRoot): ControlScope {
  return root instanceof ControlScope ? root : new ControlScope(root);
}
