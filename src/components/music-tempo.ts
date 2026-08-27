import { MusicDataElement, reflectAttributes, registerElement } from './data-element.js';

export class MusicTempo extends MusicDataElement {
  declare marking: string;
  declare bpm: number;
  declare beat: string;
  declare dots: number;
  declare dotted: boolean;
  declare at: string;
  declare text: string;
  declare placement: string;
}
reflectAttributes(MusicTempo, { marking: {}, bpm: { type: 'number' }, beat: { default: 'quarter' }, dots: { type: 'number' }, dotted: { type: 'boolean' }, at: {}, text: {}, placement: { default: 'above' } });
registerElement('music-tempo', MusicTempo);
declare global { interface HTMLElementTagNameMap { 'music-tempo': MusicTempo } }
