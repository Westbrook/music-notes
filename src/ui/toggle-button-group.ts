import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { activeElement } from './composed-dom.js';
import { iconGraphic } from './icon-graphics.js';
import { phDotsThree } from './icons/phosphor/dots-three.js';
import type { NativeOption } from './native-options.js';
import { nativeOptionTemplate } from './option-content.js';
import './design-tokens.css';

// Computed style serializes fractional widths with fewer digits than layout.
const WIDTH_EPSILON = 0.001;

/**
 * A single choice shared by direct buttons and a native overflow select.
 * Options have unique values. By default a nonempty list keeps one selection.
 * Setting toggleOffValue lets the active choice toggle back to that neutral
 * value. Property updates are silent, while user changes emit one bubbling,
 * composed input/change pair.
 * Accepted-value editing can report mixed scalar values or supply choiceStates
 * for independent toggles. Controlled toggles emit the requested value in event
 * detail; their owner publishes the accepted states after validating the edit.
 *
 * The parent supplies the available width; the group only occupies the width
 * of its visible controls and group padding. Direct siblings in a flex row marked with
 * data-toggle-group-row share that width. overflow-at caps the visible prefix
 * even at wide sizes; resizing can move more choices into the picker without
 * changing their order or the current selection.
 */
export class MusicToggleButtonGroup extends LitElement {
  static override properties = {
    options: { attribute: false },
    value: { type: String, reflect: true },
    label: { type: String, reflect: true },
    overflowAt: { type: Number, attribute: 'overflow-at', reflect: true },
    toggleOffValue: { type: String, attribute: 'toggle-off-value', reflect: true },
    disabled: { type: Boolean, reflect: true },
    mixed: { type: Boolean, reflect: true },
    choiceStates: { attribute: false },
    buttonIds: { attribute: false },
    notifyUnchanged: { type: Boolean, attribute: 'notify-unchanged' },
    visibleCount: { state: true },
  };

  static override styles = css`
    :host { display: block; flex: none; position: relative; width: max-content; min-width: 0; max-width: 100%; font: inherit; }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .controls, .measurements { display: flex; align-items: center; gap: var(--music-toggle-gap, var(--music-ui-group-gap)); padding: var(--music-ui-group-padding); }
    .controls {
      width: max-content; min-width: 0; max-width: 100%; border-radius: var(--music-ui-group-radius);
      background: var(--music-toggle-background, var(--music-ui-color-paper));
      box-shadow: inset 0 0 0 var(--music-ui-border-width) var(--music-toggle-border, var(--music-ui-color-divider));
    }
    .controls:not(:has(> *)) { padding: 0; }
    .control {
      display: inline-flex; flex: none; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--music-ui-content-gap); min-width: var(--music-toggle-button-size, var(--music-ui-control-size));
      height: var(--music-toggle-button-size, var(--music-ui-control-size));
      padding: var(--music-ui-control-padding-block) var(--music-ui-control-padding-inline);
      border: var(--music-ui-border-width) solid transparent; border-radius: var(--music-ui-control-radius);
      background: transparent; color: var(--music-ui-color-ink);
      font: inherit; font-weight: var(--music-ui-control-weight); line-height: var(--music-ui-label-line-height); cursor: pointer;
    }
    .control-label { white-space: nowrap; font-size: var(--music-toggle-label-size, var(--music-ui-label-size)); line-height: var(--music-ui-label-line-height); }
    .control svg, .overflow-face svg { flex: none; width: var(--music-icon-size, var(--music-ui-icon-size)); height: var(--music-icon-size, var(--music-ui-icon-size)); }
    .control:hover:not(:disabled):not([aria-pressed='true']):not([data-selected='true']) {
      border-color: var(--music-ui-color-divider); background: var(--music-ui-color-active);
    }
    .control[aria-pressed='true'], .overflow[data-selected='true'] {
      border-color: var(--music-ui-color-border); background: var(--music-ui-color-active);
    }
    .control[aria-pressed='mixed'] { border-color: var(--music-ui-color-border); border-style: dashed; background: var(--music-ui-color-active); }
    .control:disabled { opacity: var(--music-ui-disabled-opacity); cursor: not-allowed; }
    .control:focus-visible { outline: var(--music-ui-focus-width) solid var(--music-ui-color-focus); outline-offset: calc(-1 * var(--music-ui-focus-width)); }
    .overflow-wrap { position: relative; flex: none; width: var(--music-toggle-button-size, var(--music-ui-control-size)); max-width: 100%; }
    .overflow { display: block; width: 100%; min-width: 0; appearance: none; color: transparent; }
    .overflow > button { display: none; }
    .overflow-face {
      display: flex; position: absolute; inset: 0; flex-direction: column;
      align-items: center; justify-content: center; gap: var(--music-ui-content-gap); pointer-events: none;
      color: var(--music-ui-color-ink); font-weight: var(--music-ui-control-weight); line-height: var(--music-ui-label-line-height);
    }
    .overflow:disabled + .overflow-face { opacity: var(--music-ui-disabled-opacity); }
    option { color: var(--music-ui-color-ink); background: var(--music-ui-color-surface); }
    .measurement-clip { position: absolute; inset: 0; overflow: hidden; visibility: hidden; pointer-events: none; contain: strict; }
    .measurements { width: max-content; }
    .overflow-measurement { width: var(--music-toggle-button-size, var(--music-ui-control-size)); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    @supports (appearance: base-select) and selector(::picker(select)) {
      .overflow, .overflow::picker(select) { appearance: base-select; }
      .overflow { color: var(--music-ui-color-ink); }
      .overflow > button {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: var(--music-ui-content-gap); width: 100%; min-width: 0; height: 100%; padding: 0; border: 0;
        background: transparent; color: inherit; font: inherit;
      }
      .overflow > button svg { width: var(--music-icon-size, var(--music-ui-icon-size)); height: var(--music-icon-size, var(--music-ui-icon-size)); }
      .overflow::picker-icon, .overflow-face { display: none; }
      .overflow::picker(select) {
        min-width: 160px; max-width: min(92vw, 28rem); max-height: min(60vh, 25rem);
        margin-block: 5px; padding: 5px; border: var(--music-ui-border-width) solid var(--music-ui-color-divider);
        border-radius: 9px; background: var(--music-ui-color-surface); color: var(--music-ui-color-ink);
        box-shadow: 0 10px 26px #28322621; overflow: auto;
        font: 0.875rem/1.4 ui-sans-serif, system-ui, sans-serif;
      }
      option { display: flex; align-items: center; gap: 12px; min-height: var(--music-ui-control-size); padding: 9px 10px; border-radius: 5px; }
      option:disabled { opacity: var(--music-ui-disabled-opacity); }
      option:hover:not(:disabled), option:checked { background: var(--music-ui-color-active); }
      option[hidden] { display: none; }
      .option-content { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
      .option-content svg { flex: none; width: var(--music-icon-size, var(--music-ui-icon-size)); height: var(--music-icon-size, var(--music-ui-icon-size)); }
      .option-label { white-space: normal; }
    }
    @media (forced-colors: active) {
      .controls { background: Canvas; box-shadow: none; outline: var(--music-ui-border-width) solid GrayText; outline-offset: calc(-1 * var(--music-ui-border-width)); }
      .control { color: ButtonText; }
      .overflow { color: transparent; }
      .overflow-face { color: ButtonText; }
      .control[aria-pressed='true'], .control[aria-pressed='mixed'], .overflow[data-selected='true'] { border-color: Highlight; outline: 2px solid Highlight; outline-offset: calc(-1 * var(--music-ui-focus-width)); }
      .control:focus-visible { outline: var(--music-ui-focus-width) dashed Highlight; outline-offset: calc(-1 * var(--music-ui-focus-width)); }
      @supports (appearance: base-select) and selector(::picker(select)) {
        .overflow { color: ButtonText; }
      }
    }
  `;

  options: readonly NativeOption[] = [];
  value = '';
  label = 'Options';
  overflowAt?: number;
  /** Omit to require a selection; set to the value used when toggled off. */
  toggleOffValue?: string;
  disabled = false;
  /** No scalar choice represents every selected item. Never invent a value. */
  mixed = false;
  /** Controlled independent toggles; change.detail.value names the chosen mark. */
  choiceStates?: Readonly<Record<string, 'true' | 'false' | 'mixed'>>;
  buttonIds?: Readonly<Record<string, string>>;
  /** Accepted-value editors may use a deliberate no-op to clear old feedback. */
  notifyUnchanged = false;
  private visibleCount = 0;
  private observer?: ResizeObserver;
  private observedContainer?: Element;
  private layoutFrame?: number;
  private restoreFocus = false;

  override connectedCallback(): void {
    super.connectedCallback();
    const view = this.ownerDocument.defaultView;
    this.observedContainer = this.container;
    if (view?.ResizeObserver) {
      this.observer = new view.ResizeObserver(this.scheduleLayout);
      this.observer.observe(this);
      if (this.observedContainer) this.observer.observe(this.observedContainer);
      const measurements = this.renderRoot?.querySelector('.measurements');
      if (measurements) this.observer.observe(measurements, { box: 'border-box' });
    }
    view?.addEventListener('resize', this.scheduleLayout);
    this.scheduleLayout();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = undefined;
    const view = this.ownerDocument.defaultView;
    view?.removeEventListener('resize', this.scheduleLayout);
    if (this.layoutFrame !== undefined) view?.cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame = undefined;
    if (this.observedContainer?.hasAttribute('data-toggle-group-row')) {
      for (const group of this.observedContainer.children) {
        if (group instanceof MusicToggleButtonGroup) group.scheduleLayout();
      }
    }
    this.observedContainer = undefined;
  }

  private get limit(): number {
    return this.overflowAt === undefined || !Number.isFinite(this.overflowAt) ? this.options.length
      : Math.min(this.options.length, Math.max(0, Math.floor(this.overflowAt)));
  }

  private get container(): Element | undefined {
    return this.parentElement ?? (this.getRootNode() as ShadowRoot).host;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('options') || changed.has('value') || changed.has('toggleOffValue')) {
      if (!this.mixed && !this.choiceStates && this.value !== this.toggleOffValue && !this.options.some(option => option.value === this.value)) {
        this.value = this.toggleOffValue ?? (this.options.find(option => !option.disabled) ?? this.options[0])?.value ?? '';
      }
    }
    if (changed.has('options') || changed.has('overflowAt')) {
      const focused = activeElement(this);
      // Publishing new labels/icons must not briefly expand a collapsed row.
      // Measurement below can grow it again once those changes actually fit.
      const previous = changed.get('options') as readonly NativeOption[] | undefined;
      this.visibleCount = !this.hasUpdated || changed.has('options') && !previous?.length
        ? this.limit : Math.min(this.visibleCount, this.limit);
      if (focused?.matches('.controls > button')) {
        this.restoreFocus = !this.options.slice(0, this.visibleCount)
          .some(option => option.value === (focused as HTMLButtonElement).value && !option.disabled);
      } else if (focused?.matches('select')) this.restoreFocus = this.visibleCount === this.options.length;
    }
  }

  protected override firstUpdated(): void {
    this.observer?.observe(this.renderRoot.querySelector('.measurements')!, { box: 'border-box' });
  }

  protected override updated(changed: PropertyValues<this>): void {
    const overflow = this.renderRoot.querySelector<HTMLSelectElement>('select');
    if (overflow) this.syncOverflow(overflow);
    if (this.restoreFocus) {
      this.restoreFocus = false;
      const selected = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.controls > button')]
        .find(button => button.value === this.value && !button.disabled);
      (selected ?? overflow)?.focus({ preventScroll: true });
    }
    if (changed.has('options') || changed.has('overflowAt')) this.scheduleLayout();
  }

  private readonly scheduleLayout = (): void => {
    if (!this.isConnected || this.layoutFrame !== undefined) return;
    this.layoutFrame = this.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.layoutFrame = undefined;
      this.measure();
    });
  };

  /** Width at every allowed visible count, independent of the current count. */
  private measuredWidths(): number[] | undefined {
    const controls = this.renderRoot.querySelector<HTMLElement>('.controls');
    const measurements = this.renderRoot.querySelector<HTMLElement>('.measurements');
    if (!controls || !measurements || controls.clientWidth <= 0 && !controls.getClientRects().length) return;
    const view = this.ownerDocument.defaultView!;
    // Computed border-box widths retain fractional pixels without including
    // ancestor transforms. Rounding each offsetWidth can undercount long rows.
    const widthOf = (element: HTMLElement): number => parseFloat(view.getComputedStyle(element).width) || element.offsetWidth;
    const widths = [...measurements.querySelectorAll<HTMLElement>('[data-measure-option]')].map(widthOf);
    const overflowWidth = widthOf(measurements.querySelector<HTMLElement>('.overflow-measurement')!);
    const style = view.getComputedStyle(controls);
    const gap = parseFloat(style.columnGap) || 0;
    const inset = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    const prefix = [0];
    for (const width of widths) prefix.push(prefix[prefix.length - 1] + width);
    return Array.from({ length: this.limit + 1 }, (_, count) => {
      const hasOverflow = count < this.options.length;
      return inset + prefix[count] + (hasOverflow ? overflowWidth : 0) + gap * Math.max(0, count - (hasOverflow ? 0 : 1));
    });
  }

  private measure(): void {
    const container = this.container;
    if (!container) return;
    // Measure the parent's allocation, not our fitted width, so collapsed
    // groups can grow again. Keep fractional pixels and exclude its padding.
    const style = this.ownerDocument.defaultView!.getComputedStyle(container);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const border = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    const available = style.width.endsWith('px') ? parseFloat(style.width)
      - (style.boxSizing === 'border-box' ? padding + border : 0) : container.clientWidth - padding;
    if (container.hasAttribute('data-toggle-group-row')) {
      const groups = [...container.children].flatMap(group => {
        if (!(group instanceof MusicToggleButtonGroup)) return [];
        const widths = group.measuredWidths();
        return widths ? [{ group, widths, count: 0 }] : [];
      });
      let remaining = available - (parseFloat(style.columnGap) || 0) * Math.max(0, groups.length - 1)
        - groups.reduce((sum, group) => sum + group.widths[0], 0);
      // Allocate complete buttons, not fractional slots. A stable sequence of
      // the smallest next steps reclaims spare space and only adds buttons as
      // the row grows; fitted host sizes never feed back into this decision.
      while (true) {
        let next: typeof groups[number] | undefined;
        let needed = Infinity;
        for (const group of groups) {
          if (group.count + 1 >= group.widths.length) continue;
          const increment = group.widths[group.count + 1] - group.widths[group.count];
          if (increment < needed) { next = group; needed = increment; }
        }
        if (!next || needed > remaining + WIDTH_EPSILON) break;
        next.count++;
        remaining -= needed;
      }
      for (const { group, count } of groups) group.setVisibleCount(count);
    } else {
      const widths = this.measuredWidths();
      if (!widths) return;
      let count = this.limit;
      while (count > 0 && widths[count] > available + WIDTH_EPSILON) count--;
      this.setVisibleCount(count);
    }
  }

  private setVisibleCount(count: number): void {
    if (count === this.visibleCount) return;
    const active = activeElement(this);
    if (active?.matches('.controls > button')) {
      const index = this.options.findIndex(option => option.value === (active as HTMLButtonElement).value);
      this.restoreFocus = index >= count;
    } else if (active?.matches('select')) this.restoreFocus = count === this.options.length;
    this.visibleCount = count;
  }

  private get placeholderValue(): string {
    let value = '__overflow__';
    while (this.options.some(option => option.value === value)) value += '_';
    return value;
  }

  private choose(value: string): void {
    if (this.disabled || !this.options.some(option => option.value === value && !option.disabled)) return;
    if (this.choiceStates) {
      this.dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true, detail: { value } }));
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value } }));
      return;
    }
    const next = value === this.value ? this.toggleOffValue ?? value : value;
    if (next === this.value && !this.mixed && !this.notifyUnchanged) return;
    this.value = next; this.mixed = false;
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  private syncOverflow(select: HTMLSelectElement): void {
    const selectedInOverflow = this.options.slice(this.visibleCount).some(option => option.value === this.value);
    // A native select emits no change for reselecting its current option. In
    // toggle mode it acts as a choice picker: reset the native value so every
    // choice can be committed again. The group owns the active value and label.
    select.value = !this.choiceStates && !this.mixed && this.toggleOffValue == null && selectedInOverflow ? this.value : this.placeholderValue;
  }

  private readonly overflowInput = (event: Event): void => { event.stopPropagation(); };

  private readonly overflowChange = (event: Event): void => {
    event.stopPropagation();
    const select = event.currentTarget as HTMLSelectElement;
    this.choose(select.value);
    this.syncOverflow(select);
  };

  private contents(option: NativeOption): TemplateResult {
    return html`${iconGraphic(option.icon)}<span class="control-label">${option.label}</span>`;
  }

  private pressed(value: string): 'true' | 'false' | 'mixed' {
    if (this.choiceStates) return this.choiceStates[value] ?? 'false';
    return !this.mixed && this.value !== this.toggleOffValue && this.value === value ? 'true' : 'false';
  }

  protected override render(): TemplateResult {
    const visible = this.options.slice(0, this.visibleCount);
    const overflow = this.options.slice(this.visibleCount);
    const selected = this.options.find(option => option.value === this.value);
    const active = !this.mixed && this.value !== this.toggleOffValue;
    const selectedInOverflow = overflow.some(option => this.pressed(option.value) !== 'false');
    const overflowIcon = this.visibleCount === 0 ? this.options[0]?.icon ?? phDotsThree : phDotsThree;
    const stateLabel = this.choiceStates ? this.options.filter(option => this.pressed(option.value) !== 'false')
      .map(option => `${option.label}${this.pressed(option.value) === 'mixed' ? ' (some)' : ''}`).join(', ') || 'None'
      : this.mixed ? 'Mixed' : selected?.label ?? (active ? '' : 'None');
    const overflowLabel = `${this.label}: ${stateLabel}. More options`;
    const face = html`${iconGraphic(overflowIcon)}<span class="control-label">More</span>`;
    return html`
      <div class="controls" part="group" role="group" aria-label=${this.label}>
        ${repeat(visible, option => option.value, option => html`
          <button id=${ifDefined(this.buttonIds?.[option.value])} class="control" part="button" type="button" value=${option.value} title=${option.title ?? option.label}
            aria-label=${option.label} aria-pressed=${this.pressed(option.value)} ?disabled=${this.disabled || option.disabled}
            @click=${() => this.choose(option.value)}>${this.contents(option)}</button>`)}
        ${overflow.length ? html`
          <span class="overflow-wrap" part="overflow">
            <select class="control overflow" part="select" aria-label=${overflowLabel} title=${overflowLabel}
              data-selected=${selectedInOverflow} ?disabled=${this.disabled || overflow.every(option => option.disabled)}
              @input=${this.overflowInput} @change=${this.overflowChange}>
              <button type="button"><selectedcontent class="sr-only"></selectedcontent>${face}</button>
              <option value=${this.placeholderValue} disabled hidden>More ${this.label}</option>
              ${repeat(overflow, option => option.value, option => nativeOptionTemplate(
                (this.choiceStates || this.toggleOffValue != null) && this.pressed(option.value) !== 'false'
                  ? { ...option, label: `${option.label} (${this.pressed(option.value) === 'mixed' ? 'some' : 'selected'})` } : option,
              ))}
            </select>
            <span class="overflow-face" aria-hidden="true">${face}</span>
          </span>` : ''}
      </div>
      <div class="measurement-clip" aria-hidden="true" inert>
        <div class="measurements">
          ${repeat(this.options, option => option.value, option => html`<span class="control" data-measure-option>${this.contents(option)}</span>`)}
          <span class="control overflow-measurement">${face}</span>
        </div>
      </div>`;
  }

  /** Synchronous first render for owners that register the native control root. */
  mount(): void { this.performUpdate(); }
}

if (!customElements.get('music-toggle-button-group')) customElements.define('music-toggle-button-group', MusicToggleButtonGroup);

declare global {
  interface HTMLElementTagNameMap { 'music-toggle-button-group': MusicToggleButtonGroup }
}
