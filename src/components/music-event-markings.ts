import { MusicDataElement, reflectAttributes, registerElement } from './data-element.js';

export class MusicArticulation extends MusicDataElement {
  declare type: string;
  declare placement: string;
}
reflectAttributes(MusicArticulation, { type: {}, placement: { default: 'auto' } });

export class MusicOrnament extends MusicDataElement {
  declare type: string;
  declare placement: string;
}
reflectAttributes(MusicOrnament, { type: {}, placement: { default: 'above' } });

/** A harmony distance from a road event's chosen main pitch; neither field is implicit. */
export class MusicInterval extends MusicDataElement {
  declare value: string;
  declare placement: string;
}
reflectAttributes(MusicInterval, { value: {}, placement: {} });

registerElement('music-articulation', MusicArticulation);
registerElement('music-ornament', MusicOrnament);
registerElement('music-interval', MusicInterval);
declare global {
  interface HTMLElementTagNameMap {
    'music-articulation': MusicArticulation;
    'music-ornament': MusicOrnament;
    'music-interval': MusicInterval;
  }
}
