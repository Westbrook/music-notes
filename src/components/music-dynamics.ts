import { MusicDataElement, reflectAttributes, registerElement } from './data-element.js';

export class MusicDynamics extends MusicDataElement {
  declare level: string;
  declare at: string;
  declare placement: string;
  declare text: string;
}
reflectAttributes(MusicDynamics, { level: { default: 'mf' }, text: {}, at: {}, placement: { default: 'below' } });
registerElement('music-dynamics', MusicDynamics);
declare global { interface HTMLElementTagNameMap { 'music-dynamics': MusicDynamics } }
