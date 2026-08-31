import type { IconDefinition } from './icon-definition.js';

/**
 * Controllers own only this explicit label mount, never a Lit button-content
 * range. Templates give changing labels a literal data-control-label span;
 * plain native controls remain supported by independently reusable controllers.
 */
export function setControlLabel(control: HTMLElement, value: string): void {
  const label = control.querySelector<HTMLElement>('[data-control-label]')
    ?? (control.querySelector('music-button-content') ? undefined : control);
  if (!label) throw new Error(`Changing control ${control.id} needs a data-control-label mount.`);
  if (label.textContent !== value) label.textContent = value;
}

/** Publish presentation through the icon component without replacing its label. */
export function setControlIcon(control: HTMLElement, icon: IconDefinition): void {
  const content = control.querySelector<HTMLElement & { icon: IconDefinition }>('music-button-content');
  if (content) content.icon = icon;
}
