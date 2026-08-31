import { html, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

export interface NativeCheckboxOption {
  readonly value: string;
  readonly label: string;
}

const mounted = new WeakSet<HTMLElement>();

/**
 * Own a list's native checkbox labels, keyed by unique choice values. The
 * controller owns checked/disabled properties and delegated input handling;
 * neither is bound by this template. Implicit labels avoid generated IDs and
 * remain correctly associated even when different choices share a label.
 */
export function renderNativeCheckboxes(host: HTMLElement, options: readonly NativeCheckboxOption[]): readonly HTMLInputElement[] {
  const root = host.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement;
  const focused = active && host.contains(active) ? active as HTMLElement : undefined;
  if (!mounted.has(host)) {
    host.replaceChildren();
    mounted.add(host);
  }
  render(repeat(options, option => option.value, option => html`
    <label class="check-field"><input type="checkbox" value=${option.value}>${option.label}</label>
  `), host);

  // Reordering may blur a retained native control. Removal recovery belongs to
  // the controller, which knows the surrounding form's meaningful destination.
  if (focused && host.contains(focused) && root.activeElement !== focused) focused.focus({ preventScroll: true });
  return [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}
