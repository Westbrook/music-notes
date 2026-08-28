import { MusicDataElement, reflectAttributes, registerElement, rhythmAttributes } from './data-element.js';

/** Written rhythm and relative pitch direction for a 3 roads music staff. */
export class MusicRoad extends MusicDataElement {
  declare direction: string;
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare stem: string;
  declare beam: string;
  declare tie: string;
  declare triplet: string;
}
reflectAttributes(MusicRoad, { direction: {}, ...rhythmAttributes, triplet: {} });
registerElement('music-road', MusicRoad);
declare global { interface HTMLElementTagNameMap { 'music-road': MusicRoad } }
