import { MusicSurface } from './music-surface.js';
import { registerElement } from './data-element.js';

export class MusicStaff extends MusicSurface {}
registerElement('music-staff', MusicStaff);
declare global { interface HTMLElementTagNameMap { 'music-staff': MusicStaff } }
