import { MusicDataElement, reflectAttributes, registerElement, rhythmAttributes } from './data-element.js';

export class MusicTuplet extends MusicDataElement {
  declare actual: number;
  declare normal: number;
  declare bracket: string;
  declare ratio: boolean;
}
reflectAttributes(MusicTuplet, { actual: { type: 'number' }, normal: { type: 'number' }, bracket: { default: 'auto' }, ratio: { type: 'boolean' } });
export class MusicVoice extends MusicDataElement {}
export class MusicChord extends MusicDataElement {
  declare pitches: string;
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare stem: string;
  declare beam: string;
  declare tie: string;
  declare triplet: string;
  declare accidentalDisplay: string;
}
reflectAttributes(MusicChord, { ...rhythmAttributes, pitches: {}, accidentalDisplay: { default: 'auto' }, triplet: {} });
export class MusicSlash extends MusicDataElement {
  declare duration: string;
  declare dots: number;
  declare dotted: boolean;
  declare rhythmic: boolean;
  declare stem: string;
  declare beam: string;
  declare triplet: string;
}
reflectAttributes(MusicSlash, { ...rhythmAttributes, rhythmic: { type: 'boolean' }, triplet: {} });
export class MusicDirection extends MusicDataElement { declare text: string; declare at: string; declare placement: string }
reflectAttributes(MusicDirection, { text: {}, at: {}, placement: { default: 'above' } });
export class MusicHarmony extends MusicDirection {}
export class MusicRehearsal extends MusicDirection {}
registerElement('music-tuplet', MusicTuplet);
registerElement('music-voice', MusicVoice);
registerElement('music-chord', MusicChord);
registerElement('music-slash', MusicSlash);
registerElement('music-direction', MusicDirection);
registerElement('music-harmony', MusicHarmony);
registerElement('music-rehearsal', MusicRehearsal);
declare global {
  interface HTMLElementTagNameMap {
    'music-tuplet': MusicTuplet;
    'music-voice': MusicVoice;
    'music-chord': MusicChord;
    'music-slash': MusicSlash;
    'music-direction': MusicDirection;
    'music-harmony': MusicHarmony;
    'music-rehearsal': MusicRehearsal;
  }
}
