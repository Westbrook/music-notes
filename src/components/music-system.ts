import { MusicSurface } from './music-surface.js';
import { reflectAttributes, registerElement } from './data-element.js';

export type BracketType = 'brace' | 'bracket' | 'none';
export class MusicSystem extends MusicSurface { declare bracket: BracketType }
reflectAttributes(MusicSystem, { bracket: { default: 'none' } });
registerElement('music-system', MusicSystem);
declare global { interface HTMLElementTagNameMap { 'music-system': MusicSystem } }
