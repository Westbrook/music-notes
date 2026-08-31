import { html, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { Diagnostic } from '../../model/types.js';

const mounted = new WeakSet<HTMLElement>();

/** Render the caller's filtered notices without owning review state or focus. */
export function renderNotationNotices(list: HTMLElement, diagnostics: readonly Diagnostic[]): void {
  if (!mounted.has(list)) {
    list.replaceChildren();
    mounted.add(list);
  }
  render(repeat(diagnostics, item => JSON.stringify([item.code, item.sourceId, item.measureId, item.message]), item => html`
    <li data-source-id=${item.sourceId} data-diagnostic-code=${item.code}>${item.message} [${item.sourceId}]</li>
  `), list);
}
