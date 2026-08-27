import { MusicDataElement, reflectAttributes, registerElement } from './data-element.js';

export class MusicMeter extends MusicDataElement {
  /** String form also permits an additive numerator, e.g. 2+2+3. */
  declare top: string | number;
  declare bottom: number;
  declare groups: string;
}
reflectAttributes(MusicMeter, { top: { type: 'numerator', default: 4 }, bottom: { type: 'number', default: 4 }, groups: {} });
registerElement('music-meter', MusicMeter);
declare global { interface HTMLElementTagNameMap { 'music-meter': MusicMeter } }
