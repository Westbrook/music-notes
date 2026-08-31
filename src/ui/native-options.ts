import { html, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

export interface NativeOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const boundaries = new WeakMap<HTMLSelectElement, Comment>();

/**
 * Own only a select's options. Its native button, selectedcontent, labels,
 * listeners, and form association belong to the caller and remain in place.
 * Values must be unique, just as they are for a single-valued model field.
 * Ordinary selects remain ordinary selects in browsers without base-select.
 */
export function renderNativeOptions(
  select: HTMLSelectElement,
  options: readonly NativeOption[],
  selected: string,
): string {
  let boundary = boundaries.get(select);
  if (boundary?.parentNode !== select) {
    // Adopt the existing select once, retaining the customizable-select button.
    for (const child of [...select.children]) {
      if (child.tagName === 'OPTION' || child.tagName === 'OPTGROUP') child.remove();
    }
    boundary = select.ownerDocument.createComment('options');
    select.append(boundary);
    boundaries.set(select, boundary);
  }

  render(repeat(options, option => option.value, option => html`
    <option value=${option.value} ?disabled=${option.disabled}>${option.label}</option>
  `), select, { renderBefore: boundary });

  const value = options.some(option => option.value === selected) ? selected : options[0]?.value ?? '';
  // Native selection and selectedcontent cloning stay with the browser. Even
  // an unchanged value must be assigned to refresh a changed selected label.
  select.value = value;
  return select.value;
}
