import { phPencilSimple } from '../../ui/icons/phosphor.js';
import { bravuraDynamicForte, bravuraNoteQuarterUp } from '../../ui/icons/bravura.js';
import { css, html, LitElement, nothing, render } from 'lit';
import type { TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { buttonContent } from '../../ui/button-content.js';
import { eventIcon, markingIcon } from '../../ui/notation-icons.js';
import { formatRational } from '../../model/index.js';
import type { Measure } from '../../model/types.js';
import { eventLabel, markingLabel } from '../event-label.js';

export interface EventNavigatorState {
  readonly measure: Measure;
  readonly voiceIndex: number;
  readonly selectedIds: readonly string[];
  readonly activeMarkingId?: string;
}

/** An input intent; the owning workspace decides how selection should change. */
export interface NavigateRequestDetail {
  readonly sourceId: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

const DEFAULT_NAVIGATION_LABEL = 'Staff, measure, voice, and event navigation';

function eventNavigatorTemplate(state: EventNavigatorState): TemplateResult {
  const selectedIds = new Set(state.selectedIds);
  return html`
    ${repeat(state.measure.voices, voice => voice.id, (voice, index) => html`
      <div class="event-voice-group">
        <p class="field-help">Voice ${index + 1}</p>
        ${repeat(voice.events, event => event.id, event => html`
          <button type="button" data-source-id=${event.id}
            aria-pressed=${String(selectedIds.has(event.id))}
            class=${index === state.voiceIndex ? 'active-voice' : ''}>${buttonContent(eventIcon(event), `${eventLabel(event)} · at ${formatRational(event.onset)}`, { layout: 'inline' })}</button>
          ${repeat(event.markings ?? [], marking => marking.id, marking => html`
            <button type="button" class="event-marking-link" data-source-id=${marking.id}
              aria-current=${state.activeMarkingId === marking.id ? 'true' : nothing}>${buttonContent(markingIcon(marking), `${markingLabel(marking)} · attached to ${eventLabel(event)}`, { layout: 'inline' })}</button>
          `)}
        `)}
      </div>
    `)}
    ${repeat(state.measure.annotations, annotation => annotation.id, annotation => html`
      <button type="button" data-source-id=${annotation.id}>${buttonContent(annotation.kind === 'dynamics' ? bravuraDynamicForte : annotation.kind === 'tempo' ? bravuraNoteQuarterUp : phPencilSimple, `${annotation.kind}: ${annotation.text || annotation.bpm} · at ${formatRational(annotation.onset)}`, { layout: 'inline' })}</button>
    `)}
  `;
}

interface NavigatorFocus { element: HTMLElement; sourceId: string }
type NavigatorRoot = HTMLElement | ShadowRoot;

function activeElement(root: NavigatorRoot): Element | null {
  if (!root.isConnected) return null;
  const tree = root.getRootNode() as Document | ShadowRoot;
  // Focus crosses a shadow boundary through its host. Checking the containing
  // tree first also avoids treating a sibling component's focus as our own.
  if ('host' in tree && activeElement(tree.host as HTMLElement) !== tree.host) return null;
  return tree.activeElement ?? null;
}

function captureFocus(root: NavigatorRoot): NavigatorFocus | undefined {
  const focused = activeElement(root) as HTMLElement | null;
  return focused && root.contains(focused) && focused.dataset.sourceId
    ? { element: focused, sourceId: focused.dataset.sourceId } : undefined;
}

function restoreFocus(root: NavigatorRoot, focused: NavigatorFocus | undefined, fallbackFocus: HTMLElement | undefined): void {
  if (!focused || !root.isConnected) return;
  if (root.contains(focused.element)) {
    // Moving an existing node can blur it in some browsers. Do not refocus on
    // ordinary updates, which would interfere with native keyboard behavior.
    if (activeElement(root) !== focused.element) focused.element.focus({ preventScroll: true });
    return;
  }
  const replacement = [...root.querySelectorAll<HTMLButtonElement>('button[data-source-id]')]
    .find(button => button.dataset.sourceId === focused.sourceId);
  (replacement ?? root.querySelector<HTMLButtonElement>('button') ?? fallbackFocus)?.focus({ preventScroll: true });
}

/**
 * A self-contained measure navigator. The component owns its labelled native
 * controls and focus repair; its input state stays owned by the caller. Source
 * identities retain controls across changes to labels, ordering and selection.
 */
export class MusicEventNavigator extends LitElement {
  static override properties = {
    state: { attribute: false },
    navigationLabel: { attribute: 'aria-label' },
  };

  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      max-height: 360px;
      margin: 14px 0 0;
      overflow: auto;
      color: var(--author-control-ink, #303942);
      font: inherit;
    }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .field-help {
      margin: 0;
      color: var(--author-muted, #56616d);
      font-size: 0.75rem;
      font-weight: 400;
      line-height: 1.5;
    }
    button {
      min-width: 44px;
      min-height: 44px;
      max-width: calc(100% - 6px);
      margin: 3px;
      padding: 8px 13px;
      border: 1px solid var(--author-border, #798794);
      border-radius: 6px;
      background: var(--surface, var(--author-surface, #f7f8fa));
      color: var(--ink, var(--author-control-ink, #303942));
      font: inherit;
      font-size: 0.78rem;
      font-weight: 550;
      line-height: 1.35;
      text-align: start;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    button:hover, button[aria-pressed='true'] {
      border-color: var(--author-border, #798794);
      background: var(--accent-soft, #dce3ea);
    }
    button:focus-visible, nav:focus-visible {
      outline: 3px solid var(--author-focus, #7037a0);
      outline-offset: -3px;
    }
    .event-marking-link {
      display: block;
      max-width: calc(100% - 22px);
      margin: 3px 3px 3px 19px;
      padding: 6px 9px;
      border-left-width: 3px;
      color: #596c50;
      background: #f7f9f3;
      font-size: 0.73rem;
      line-height: 1.3;
    }
    button[aria-current='true'] {
      border-color: #84a47c;
      color: #285031;
      background: #eaf2e5;
    }
    @media (forced-colors: active) {
      button[aria-pressed='true'], button[aria-current='true'] { outline: 2px solid Highlight; }
      button:focus-visible, nav:focus-visible { outline: 3px solid Highlight; }
    }
  `;

  state?: EventNavigatorState;
  navigationLabel = DEFAULT_NAVIGATION_LABEL;
  private fallbackFocus?: HTMLElement;
  private focused?: NavigatorFocus;

  /** Preserve the coordinator's synchronous projection and focus contract. */
  renderState(state: EventNavigatorState, fallbackFocus: HTMLElement): void {
    this.fallbackFocus = fallbackFocus;
    this.state = state;
    this.requestUpdate();
    this.performUpdate();
  }

  protected override willUpdate(): void {
    this.focused = captureFocus(this.renderRoot as ShadowRoot);
  }

  protected override updated(): void {
    restoreFocus(this.renderRoot as ShadowRoot, this.focused,
      this.fallbackFocus ?? this.renderRoot.querySelector<HTMLElement>('nav') ?? undefined);
    this.focused = undefined;
  }

  private readonly navigate = (event: MouseEvent): void => {
    const button = event.composedPath().find((item): item is HTMLButtonElement =>
      item instanceof Element && item.localName === 'button' && this.renderRoot.contains(item));
    const sourceId = button?.dataset.sourceId;
    if (!sourceId) return;
    this.dispatchEvent(new CustomEvent<NavigateRequestDetail>('navigate-request', {
      bubbles: true,
      composed: true,
      detail: {
        sourceId,
        shiftKey: event.shiftKey === true,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        altKey: event.altKey === true,
      },
    }));
  };

  protected override render(): TemplateResult {
    return html`<nav role="navigation" aria-label=${this.navigationLabel || DEFAULT_NAVIGATION_LABEL}
      tabindex="-1" @click=${this.navigate}>${this.state ? eventNavigatorTemplate(this.state) : nothing}</nav>`;
  }
}

if (!customElements.get('music-event-navigator')) customElements.define('music-event-navigator', MusicEventNavigator);

const mounted = new WeakSet<HTMLElement>();

/**
 * Compatibility for hosts that supply their own native region. New workspaces
 * use music-event-navigator, which owns the same view inside its shadow root.
 */
export function renderEventNavigator(host: HTMLElement, state: EventNavigatorState, fallbackFocus: HTMLElement): void {
  if (host instanceof MusicEventNavigator) {
    host.renderState(state, fallbackFocus);
    return;
  }
  const focused = captureFocus(host);
  if (!mounted.has(host)) {
    host.replaceChildren();
    mounted.add(host);
  }
  render(eventNavigatorTemplate(state), host);
  restoreFocus(host, focused, fallbackFocus);
}

declare global {
  interface HTMLElementTagNameMap { 'music-event-navigator': MusicEventNavigator }
  interface HTMLElementEventMap { 'navigate-request': CustomEvent<NavigateRequestDetail> }
}
