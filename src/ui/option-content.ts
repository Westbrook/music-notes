import { html, nothing, type ChildPart, type TemplateResult } from 'lit';
import { Directive, directive, PartType, type PartInfo } from 'lit/directive.js';
import type { IconDefinition } from './icon-definition.js';
import { iconGraphic } from './icon-graphics.js';
import type { NativeOption } from './native-options.js';

/**
 * Decorative content for a native option. Keep its label in light DOM so an
 * ordinary select can still display it. Synchronous SVG markup survives
 * selectedcontent cloning without custom-element properties or font loading.
 * The graphic contributes no text to the native label or form value.
 *
 * Use nativeOptionTemplate in selects, rather than interpolating this helper
 * inside a literal option. Chromium's parser can clone those interpolation
 * markers into selectedcontent before Lit binds the parts.
 */
export function optionContent(icon: IconDefinition, label: string): TemplateResult {
  return html`<span class="option-content">${iconGraphic(icon)}<span class="option-label">${label}</span></span>`;
}

/**
 * Parse and bind the whole option before inserting it into a native select.
 * This prevents selectedcontent from copying unfinished Lit binding markers.
 * Rich options own an explicit accessible name; label= would override their
 * visual content, so the textual label is retained through aria-label instead.
 */
export function nativeOptionTemplate(option: NativeOption & { readonly selected?: boolean }): TemplateResult {
  return html`<option value=${option.value} aria-label=${option.icon ? option.label : nothing} ?disabled=${option.disabled} ?selected=${option.selected}>${option.icon ? optionContent(option.icon, option.label) : option.label}</option>`;
}

class NativeSelectDefaultDirective extends Directive {
  private initializedSelect?: HTMLSelectElement;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.CHILD) throw new Error('nativeSelectDefault belongs after a select\'s options.');
  }

  override render(_value: string): typeof nothing { return nothing; }

  override update(part: ChildPart, [value]: [string]): typeof nothing {
    const parent = part.parentNode;
    if (parent.nodeName !== 'SELECT') throw new Error('nativeSelectDefault must be a direct child of a select.');
    const select = parent as HTMLSelectElement;
    if (this.initializedSelect !== select) {
      select.value = value;
      this.initializedSelect = select;
    }
    return nothing;
  }
}

/**
 * Set an initial native value after whole-option fragments have been inserted.
 * Place this last inside the select; a property binding on the select runs
 * before those fragments exist. Subsequent renders preserve user selection.
 * Keep selected:true on the default option so native form reset still works.
 */
export const nativeSelectDefault = directive(NativeSelectDefaultDirective);
