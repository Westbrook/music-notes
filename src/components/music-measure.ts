import { MusicSurface } from './music-surface.js';
import { reflectAttributes, registerElement } from './data-element.js';

/** A measure is authored once in light DOM; its containing surface engraves it. */
export class MusicMeasure extends MusicSurface {
  declare endBar: string;
  declare number: string;
  declare breakBefore: string;
  declare keepWithNext: boolean;
  declare repeatStart: boolean;
  declare pickup: boolean;
  declare incomplete: boolean;
}
reflectAttributes(MusicMeasure, {
  endBar: { default: 'single' }, number: {}, breakBefore: { default: 'auto' },
  keepWithNext: { type: 'boolean' }, repeatStart: { type: 'boolean' }, pickup: { type: 'boolean' }, incomplete: { type: 'boolean' },
});
registerElement('music-measure', MusicMeasure);
declare global { interface HTMLElementTagNameMap { 'music-measure': MusicMeasure } }
