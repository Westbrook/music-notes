import { MusicSurface } from './music-surface.js';
import { reflectAttributes, registerElement } from './data-element.js';

export class MusicStaff extends MusicSurface { declare notation: string }
reflectAttributes(MusicStaff, { notation: { default: 'pitched' } });
registerElement('music-staff', MusicStaff);
declare global { interface HTMLElementTagNameMap { 'music-staff': MusicStaff } }
