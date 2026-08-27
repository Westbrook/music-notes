import { MUSIC_ATTRIBUTES } from '../dom/index.js';

type AttributeDefinition = { attribute?: string; type?: 'string' | 'number' | 'boolean' | 'numerator'; default?: string | number | boolean };

/** Attributes are the source of truth for both handwritten HTML and property edits. */
export class MusicDataElement extends HTMLElement {
  static observedAttributes = [...new Set(Object.values(MUSIC_ATTRIBUTES).flat())];
  static reflectedProperties: string[] = [];

  connectedCallback(): void {
    // Preserve properties assigned before customElements.define() upgraded the node.
    for (const name of (this.constructor as typeof MusicDataElement).reflectedProperties) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value: unknown = Reflect.get(this, name);
      Reflect.deleteProperty(this, name);
      Reflect.set(this, name, value);
    }
  }

  attributeChangedCallback(_name: string, previous: string | null, value: string | null): void {
    if (previous === value) return;
    this.dispatchEvent(new Event('notation-change', { bubbles: true, composed: true }));
  }
}

export function reflectAttributes(constructor: typeof MusicDataElement, definitions: Record<string, AttributeDefinition>): void {
  constructor.reflectedProperties = [...constructor.reflectedProperties, ...Object.keys(definitions)];
  for (const [property, definition] of Object.entries(definitions)) {
    const attribute = definition.attribute ?? property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    Object.defineProperty(constructor.prototype, property, {
      configurable: true,
      enumerable: true,
      get(this: HTMLElement) {
        if (definition.type === 'boolean') return this.hasAttribute(attribute);
        const value = this.getAttribute(attribute);
        if (value === null) return definition.default ?? (definition.type === 'number' ? 0 : '');
        if (definition.type === 'numerator') return /^\d+$/.test(value) ? Number(value) : value;
        return definition.type === 'number' ? Number(value) : value;
      },
      set(this: HTMLElement, value: unknown) {
        if (definition.type === 'boolean') this.toggleAttribute(attribute, Boolean(value));
        else if (value === null || value === undefined) this.removeAttribute(attribute);
        else if (this.getAttribute(attribute) !== String(value)) this.setAttribute(attribute, String(value));
      },
    });
  }
}

export function registerElement(name: string, constructor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, constructor);
}

export const rhythmAttributes: Record<string, AttributeDefinition> = {
  duration: { default: 'quarter' }, dots: { type: 'number', default: 0 }, dotted: { type: 'boolean' },
  beam: { default: 'auto' }, stem: { default: 'auto' }, tie: { default: 'none' },
};
