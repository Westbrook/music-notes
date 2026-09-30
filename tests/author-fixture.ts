import { LitElement, nothing, render } from 'lit';
import { mountAuthorShell } from '../src/authoring/ui/author-shell.js';
import type { AuthorShell } from '../src/authoring/ui/author-shell.js';

type AuthorFixtureRoot = Document | HTMLElement;
type AuthorControlHost = 'view-switch' | 'event-navigator' | 'source-editor' | 'entry-kind' | 'entry-accidentals' | 'entry-duration' | 'entry-dots' | 'entry-attack' | 'selection-accidentals' | 'selection-quick-duration' | 'selection-quick-dots' | 'selection-quick-attack';
const controlHosts: readonly AuthorControlHost[] = ['view-switch', 'event-navigator', 'source-editor', 'entry-kind', 'entry-accidentals', 'entry-duration', 'entry-dots', 'entry-attack', 'selection-accidentals', 'selection-quick-duration', 'selection-quick-dots', 'selection-quick-attack'];

function lightControlById(root: AuthorFixtureRoot, id: string): HTMLElement | null {
  if (root.nodeType === Node.DOCUMENT_NODE) return (root as Document).getElementById(id);
  return (root as HTMLElement).id === id ? root as HTMLElement : root.querySelector<HTMLElement>(`#${id}`);
}

/** Only these Author features expose owned shadow content to the harness. */
export function authorControlRoot(root: AuthorFixtureRoot, id: AuthorControlHost): ShadowRoot | null {
  return lightControlById(root, id)?.shadowRoot ?? null;
}

/** Query controls without traversing score source, engraving, or unrelated roots. */
export function queryAuthorControl<T extends Element = HTMLElement>(root: AuthorFixtureRoot, selector: string): T | null {
  if (/^#[\w-]+$/.test(selector)) return findAuthorControl(root, selector.slice(1)) as T | null;
  const light = root.querySelector<T>(selector);
  if (light) return light;
  for (const id of controlHosts) {
    const owned = authorControlRoot(root, id);
    if (!owned) continue;
    const prefix = new RegExp(`^#${id}(?:\\s*>\\s*|\\s+)`);
    const scoped = selector.replace(prefix, '');
    const element = owned.querySelector<T>(scoped);
    if (element) return element;
  }
  return null;
}

export function findAuthorControl<T extends HTMLElement = HTMLElement>(root: AuthorFixtureRoot, id: string): T | null {
  const light = lightControlById(root, id);
  if (light) return light as T;
  for (const host of controlHosts) {
    const element = authorControlRoot(root, host)?.getElementById(id);
    if (element) return element as T;
  }
  return null;
}

/** Preserve the real focused control instead of its retargeted component host. */
export function authorActiveElement(root: Document): Element | null {
  const active = root.activeElement;
  if (!active || !controlHosts.includes(active.id as AuthorControlHost)) return active;
  return active.shadowRoot?.activeElement ?? active;
}

/** Visibility/disclosure checks cross only the same explicitly owned roots. */
export function authorControlParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE || !('host' in root)) return null;
  const host = (root as ShadowRoot).host;
  return controlHosts.includes(host.id as AuthorControlHost) ? host as HTMLElement : null;
}

/** Mount the same Lit composition used by Author, without application effects. */
export function mountAuthorFixture(root: HTMLElement = document.body): AuthorShell {
  root.replaceChildren();
  return mountAuthorShell(root);
}

/**
 * After controllers are disposed and assertions finish, release this fixture's
 * descendant graph. Vitest 4.1's strong mock registry retains spy receivers,
 * call contexts, and original callback closures after restoreAllMocks(). In
 * long Happy DOM suites one retained control would otherwise pin its complete
 * old Author tree, including every shadow root. This is harness cleanup only;
 * production teardown and lifecycle assertions run before it.
 */
export async function releaseAuthorFixture(root: HTMLElement = document.body): Promise<void> {
  const children = [...root.childNodes];
  const nodes: Node[] = [];
  const updates: Promise<unknown>[] = [];
  const visit = (node: Node, action: (node: Node) => void): void => {
    action(node);
    if (node instanceof Element && node.shadowRoot) visit(node.shadowRoot, action);
    for (const child of [...node.childNodes]) visit(child, action);
  };
  for (const child of children) visit(child, node => {
    nodes.push(node);
    if (node.isConnected && 'updateComplete' in node) updates.push((node as Node & { updateComplete: Promise<unknown> }).updateComplete);
  });
  // Complete already-scheduled Lit ownership work before dismantling mounts.
  await Promise.all(updates);
  // A retained host also retains Lit's cached template parts. Empty each owned
  // render range through Lit while its markers and renderBefore node remain in
  // place; raw DOM removal alone leaves those template instances reachable.
  for (const node of [...nodes].reverse()) {
    if (node instanceof LitElement && node.renderRoot) render(nothing, node.renderRoot, node.renderOptions);
  }
  root.replaceChildren();
  for (const node of nodes) {
    if ('replaceChildren' in node) (node as Element | DocumentFragment).replaceChildren();
  }
  // Yield a task after disconnection so queued observer/frame cleanup can run
  // and weakly held DOM objects can be collected between large fixtures.
  // Chaining only promises keeps them alive for an entire synchronous suite.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Detached structure for accessibility/markup contracts without fonts or SVG. */
export function createAuthorFixtureDocument(): Document {
  const fixture = document.implementation.createHTMLDocument('Author fixture');
  fixture.body.className = 'author-app';
  fixture.body.dataset.view = 'write';
  fixture.body.dataset.entryMode = 'false';
  fixture.body.dataset.entryKind = 'note';
  fixture.body.dataset.toolsOpen = 'false';
  fixture.body.dataset.toolsExpanded = 'false';
  fixture.body.dataset.toolsPresentation = 'closed';
  fixture.body.dataset.entryDragArmed = 'false';
  mountAuthorFixture(fixture.body);
  return fixture;
}
