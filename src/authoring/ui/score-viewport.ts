import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import type { MusicSurface, NotationViewportChangeDetail } from '../../components/music-surface.js';

/**
 * Isolates the rendered source IDs and owns the score's visual frame. Musical
 * source, selection and gesture controllers own their separate stable mounts.
 * Actions and help are caller-owned siblings, never part of musical source.
 */
export class ScoreViewport extends LitElement {
  static override styles = css`
    :host { display: block; position: relative; min-width: 0; }
    *, *::before, *::after { box-sizing: border-box; }
    .score-mount { min-width: 0; overflow: auto; }
    .author-overlays, .gesture-overlays { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .gesture-overlays { overflow: visible; }
    .author-selection { position: absolute; border: 2px solid var(--author-selection, #175c96); border-radius: 3px;
      background: var(--author-selection-fill, rgba(23,92,150,.12)); }
    .author-caret { position: absolute; width: 2px; background: var(--author-insertion, #087368);
      box-shadow: 0 0 0 2px var(--author-paper, #fff); }
    .author-measure-selection { border-style: dashed; background: transparent; }
    .author-event-focus { border: 2px dashed var(--author-focus, #7037a0); background: transparent;
      box-shadow: 0 0 0 1px var(--author-paper, #fff); }
    slot { display: block; }
    @media (forced-colors: active) {
      .author-selection { border-color: Highlight; background: transparent; }
      .author-caret { background: Highlight; box-shadow: 0 0 0 2px Canvas; }
      .author-event-focus { border-color: CanvasText; box-shadow: none; }
    }
    @media print { :host { display: none !important; } }
  `;

  private readonly onScroll = (event: Event) => {
    const scroller = event.composedPath()[0];
    if (!this.isConnected || !(scroller instanceof HTMLElement)) return;
    this.dispatchEvent(new CustomEvent<NotationViewportChangeDetail>('notation-viewport-change', {
      bubbles: true, composed: true, detail: { scroller, layout: this.surface?.getLayoutGeometry() },
    }));
  };

  /** Synchronous first mount for the existing controller binding lifecycle. */
  mount(): void { this.performUpdate(); }

  /** Accepted projection lives here, isolated from application control IDs. */
  get scoreMount(): HTMLDivElement { this.mount(); return this.renderRoot.querySelector<HTMLDivElement>('.score-mount')!; }
  /** Selection decoration only; clearing it never removes gesture previews. */
  get overlayMount(): HTMLDivElement { this.mount(); return this.renderRoot.querySelector<HTMLDivElement>('.author-overlays')!; }
  /** A separate controller-owned subtree for temporary engraved gestures. */
  get previewMount(): HTMLDivElement { this.mount(); return this.renderRoot.querySelector<HTMLDivElement>('.gesture-overlays')!; }
  get surface(): MusicSurface | undefined { return this.scoreMount.querySelector<MusicSurface>('music-system,music-staff,music-measure') ?? undefined; }

  /** Keep temporary previews clear of caller-owned action and help regions. */
  getNativeControlBounds(): readonly DOMRectReadOnly[] {
    if (!this.isConnected) return [];
    this.mount();
    return [...this.renderRoot.querySelectorAll<HTMLSlotElement>('slot')]
      .flatMap(slot => slot.assignedElements({ flatten: true }))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0)
      .map(element => element.getBoundingClientRect()).filter(bounds => bounds.width > 0 && bounds.height > 0);
  }

  protected override render(): TemplateResult {
    return html`
      <slot name="actions" part="actions" data-author-input="native"></slot>
      <div class="score-mount" part="score" @scroll=${this.onScroll}></div>
      <div class="author-overlays" part="selection" aria-hidden="true"></div>
      <div class="gesture-overlays" part="preview" aria-hidden="true"></div>
      <slot name="help" part="help" data-author-input="native"></slot>
    `;
  }
}

if (!customElements.get('music-score-viewport')) customElements.define('music-score-viewport', ScoreViewport);

declare global { interface HTMLElementTagNameMap { 'music-score-viewport': ScoreViewport } }
