import { MusicDataElement, reflectAttributes, registerElement, rhythmAttributes } from './data-element.js';

export class MusicRest extends MusicDataElement {
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare measure: boolean;
  declare beam: string;
  declare triplet: string;
}
reflectAttributes(MusicRest, { ...rhythmAttributes, measure: { type: 'boolean' }, triplet: {} });
registerElement('music-rest', MusicRest);
declare global { interface HTMLElementTagNameMap { 'music-rest': MusicRest } }
