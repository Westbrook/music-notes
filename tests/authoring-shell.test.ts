// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorShell, mountAuthorShell } from '../src/authoring/ui/author-shell.js';
import { AuthorViewState } from '../src/authoring/state/view-state.js';
import { enhanceSelects } from '../src/authoring/select.js';
import { createAuthorFixtureDocument, findAuthorControl, mountAuthorFixture } from './author-fixture.js';
import type { ScoreViewport } from '../src/authoring/ui/score-viewport.js';

afterEach(() => document.body.replaceChildren());

async function settle(shell: AuthorShell): Promise<void> {
  await Promise.resolve();
  await shell.updateComplete;
}

function viewButton(shell: AuthorShell, mode: string): HTMLButtonElement | null {
  return shell.querySelector('music-view-switch')?.shadowRoot?.querySelector(`#view-${mode}`) ?? null;
}

describe('Lit Author shell composition and state ownership', () => {
  it('mounts synchronously and preserves controls when mounted again', () => {
    const shell = mountAuthorFixture();
    const source = findAuthorControl<HTMLTextAreaElement>(shell, 'source-input')!;
    const score = shell.querySelector<ScoreViewport>('#score-host')!.scoreMount;
    expect(shell).toBeInstanceOf(AuthorShell);
    expect(shell.shadowRoot).toBeNull();
    expect(findAuthorControl(document, 'source-input')).toBe(source);
    source.value = 'A recoverable draft';
    const notation = document.createElement('div');
    score.append(notation);

    expect(mountAuthorShell()).toBe(shell);
    expect(findAuthorControl(shell, 'source-input')).toBe(source);
    expect(source.value).toBe('A recoverable draft');
    expect(score.firstElementChild).toBe(notation);
    expect((source.getRootNode() as Document | ShadowRoot).querySelectorAll('#source-input')).toHaveLength(1);
  });

  it('mounts the same native labelled controls in a detached document', () => {
    const fixture = createAuthorFixtureDocument();
    const title = fixture.getElementById('project-title') as HTMLInputElement;
    const source = findAuthorControl<HTMLTextAreaElement>(fixture, 'source-input')!;
    expect(title.labels?.[0]?.getAttribute('for')).toBe('project-title');
    expect(source.value).toBe('');
    expect(fixture.querySelector('#document-menu-trigger')?.getAttribute('popovertarget')).toBe('document-menu');
    expect(fixture.getElementById('document-menu')?.getAttribute('popover')).toBe('auto');
  });

  it('preserves the authored select defaults when Lit clones the native form templates', () => {
    const shell = mountAuthorFixture();
    enhanceSelects(shell);
    expect(shell.querySelector<HTMLSelectElement>('#event-duration')?.value).toBe('quarter');
    expect(shell.querySelector<HTMLSelectElement>('#event-direction')?.value).toBe('same');
    expect(shell.querySelector<HTMLSelectElement>('#annotation-beat')?.value).toBe('quarter');
    expect(shell.querySelector<HTMLSelectElement>('#selection-note-octave')?.value).toBe('4');
  });

  it('renders injected view signals without replacing drafts, focus, or score projections', async () => {
    const shell = mountAuthorFixture();
    const state = new AuthorViewState();
    shell.viewState = state;
    await settle(shell);
    const title = shell.querySelector<HTMLInputElement>('#project-title')!;
    const duration = shell.querySelector<HTMLSelectElement>('#event-duration')!;
    const score = shell.querySelector<ScoreViewport>('#score-host')!.scoreMount;
    const projection = document.createElement('div');
    projection.textContent = 'Accepted music';
    score.append(projection);
    title.value = 'Unapplied form';
    duration.value = 'sixteenth';
    title.focus();
    const click = vi.fn();
    title.addEventListener('input', click);

    state.update({ mode: 'pages' });
    await settle(shell);
    expect(viewButton(shell, 'pages')?.getAttribute('aria-pressed')).toBe('true');
    expect(viewButton(shell, 'write')?.getAttribute('aria-pressed')).toBe('false');
    expect(shell.querySelector('#project-title')).toBe(title);
    expect(title.value).toBe('Unapplied form');
    expect(duration.value).toBe('sixteenth');
    expect(document.activeElement).toBe(title);
    expect(score.firstElementChild).toBe(projection);
    title.dispatchEvent(new Event('input'));
    expect(click).toHaveBeenCalledOnce();
  });

  it('rebinds injected stores and releases signal observers while disconnected', async () => {
    const shell = mountAuthorFixture();
    const previous = new AuthorViewState();
    const current = new AuthorViewState({ mode: 'read' });
    shell.viewState = previous;
    await settle(shell);
    shell.viewState = current;
    await settle(shell);
    expect(viewButton(shell, 'read')?.getAttribute('aria-pressed')).toBe('true');
    const request = vi.spyOn(shell, 'requestUpdate');
    previous.update({ mode: 'pages' });
    await settle(shell);
    expect(request).not.toHaveBeenCalled();

    shell.remove();
    current.update({ mode: 'pages' });
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    document.body.append(shell);
    await settle(shell);
    expect(viewButton(shell, 'pages')?.getAttribute('aria-pressed')).toBe('true');
  });
});
