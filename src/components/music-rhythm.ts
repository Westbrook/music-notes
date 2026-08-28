import { MusicDataElement, reflectAttributes, registerElement, rhythmAttributes } from './data-element.js';

/** A written duration with no pitch, for a single-line rhythm staff. */
export class MusicRhythm extends MusicDataElement {
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare stem: string;
  declare beam: string;
  declare tie: string;
  declare triplet: string;
}
reflectAttributes(MusicRhythm, { ...rhythmAttributes, triplet: {} });
registerElement('music-rhythm', MusicRhythm);
declare global { interface HTMLElementTagNameMap { 'music-rhythm': MusicRhythm } }
