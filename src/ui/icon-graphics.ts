import { nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import type { IconDefinition } from './icon-definition.js';

/**
 * Synchronous paths only: no lookup, font APIs, network, or deferred work.
 * Applying opacity here once keeps every host and label at full opacity.
 */
export function iconGraphic(definition?: IconDefinition): TemplateResult {
  return svg`${definition ? svg`<svg class="music-icon-graphic" part="icon svg" data-icon=${definition.name}
    viewBox=${definition.viewBox} width="20" height="20" fill="currentColor"
    style="opacity:var(--music-icon-opacity,0.8)" aria-hidden="true" focusable="false"
    >${definition.paths.map(path => svg`<path d=${path}></path>`)}</svg>` : nothing}`;
}
