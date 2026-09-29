import { html, LitElement } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { SignalController } from '../../ui/signal-controller.js';
import type { AuthorViewState } from '../state/view-state.js';
import type { ViewMode } from '../types.js';
import './workspace-frame.js';
import './panel-frame.js';
import './view-switch.js';
import { workspaceHeader } from './workspace-header.js';
import { listeningTools } from './listening-tools.js';
import { readingTools } from './reading-tools.js';
import { pageTools } from './page-tools.js';
import { scoreFrame } from './score-frame.js';
import { writingTools } from './writing-tools.js';
import { musicPalette } from './music-palette.js';
import { documentMenu, scoreSetup, sourcePanel } from './document-surfaces.js';
import { locationPanel } from './location-panel.js';
import { entrySettings, entryValueChooser, entryDirectionChooser } from './entry-surfaces.js';
import { selectionValueChooser, selectionPitchChooser, selectionSharedChooser } from './selection-surfaces.js';
import { noteEditor } from './note-editor.js';
import { actionConfirmation, workspaceReview, continuationReview, pointerRecovery } from './review-surfaces.js';

const ownedFeatures = 'music-workspace-frame, music-panel-frame, music-view-switch, music-score-viewport, music-source-editor, music-toggle-button-group';

/**
 * The application composition contains no project state or score processing.
 * Each feature owns a small native template; controllers bind the resulting
 * controls while dynamic projections render inside their dedicated hosts.
 * Authored select defaults retain selected attributes for native reset and
 * initialize the native value after options exist; later user edits stay local.
 */
export function authorShellTemplate(mode: ViewMode = 'write'): TemplateResult {
  return html`
    ${workspaceHeader(mode)}
    <main class="author-workspace">
      ${readingTools()}
      ${listeningTools()}
      ${pageTools()}
      <music-workspace-frame id="author-workbench" class="author-workbench" .mode=${mode} tools-presentation="closed">
        ${scoreFrame()}
        ${writingTools()}
        ${musicPalette()}
      </music-workspace-frame>
      <div id="page-host" class="page-host" aria-label="Physical page preview" hidden></div>
    </main>
    ${actionConfirmation()}
    ${workspaceReview()}
    ${documentMenu()}
    ${locationPanel()}
    ${entrySettings()}
    ${entryValueChooser()}
    ${entryDirectionChooser()}
    ${scoreSetup()}
    ${sourcePanel()}
    ${selectionValueChooser()}
    ${selectionPitchChooser()}
    ${selectionSharedChooser()}
    ${noteEditor()}
    ${continuationReview()}
    ${pointerRecovery()}
  `;
}

/**
 * Light composition keeps cross-feature native targets in one tree. Slotted
 * regions retain their native relationships; feature components own local
 * controls in their own roots and communicate through explicit public APIs.
 */
export class AuthorShell extends LitElement {
  static override properties = { viewState: { attribute: false } };

  /** Inject state; the shell does not create or mutate an application store. */
  viewState?: AuthorViewState;
  private readonly mode = new SignalController(this, () => this.viewState?.signals.mode.get() ?? 'write');

  protected override createRenderRoot(): HTMLElement { return this; }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('viewState')) this.mode.refresh();
  }

  protected override render(): TemplateResult { return authorShellTemplate(this.mode.value); }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    await Promise.all([...this.querySelectorAll(ownedFeatures)]
      .map(child => (child as LitElement).updateComplete));
    return complete;
  }

  /** Synchronous first mount for controller binding and isolated fixtures. */
  mount(): void {
    this.performUpdate();
    for (const child of this.querySelectorAll(ownedFeatures)) {
      (child as HTMLElement & { mount(): void }).mount();
    }
  }
}

/**
 * Mount once and retain every control across subsequent calls. Creating the
 * registered element in this window also supports detached fixture documents,
 * whose own custom-element registry may be unavailable.
 */
export function mountAuthorShell(root: HTMLElement = document.body): AuthorShell {
  if (!customElements.get('music-author-shell')) customElements.define('music-author-shell', AuthorShell);
  const existing = root.querySelector<HTMLElement>('music-author-shell');
  let shell: AuthorShell;
  if (existing instanceof AuthorShell) shell = existing;
  else {
    shell = document.createElement('music-author-shell') as AuthorShell;
    if (existing) existing.replaceWith(shell);
    else root.prepend(shell);
  }
  shell.mount();
  return shell;
}

declare global {
  interface HTMLElementTagNameMap { 'music-author-shell': AuthorShell }
}
