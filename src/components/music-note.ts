import { MusicDataElement, reflectAttributes, registerElement, rhythmAttributes } from './data-element.js';

export class MusicNote extends MusicDataElement {
  declare pitch: string;
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare accidental: string;
  declare accidentalDisplay: string;
  declare beam: string;
  declare stem: string;
  declare tie: string;
  declare triplet: string;
}
reflectAttributes(MusicNote, { ...rhythmAttributes, pitch: {}, accidental: {}, accidentalDisplay: { default: 'auto' }, triplet: {} });
registerElement('music-note', MusicNote);
declare global { interface HTMLElementTagNameMap { 'music-note': MusicNote } }
