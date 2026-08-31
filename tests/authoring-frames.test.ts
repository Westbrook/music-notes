// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { AuthorWorkspaceFrame } from '../src/authoring/ui/workspace-frame.js';
import { AuthorPanelFrame } from '../src/authoring/ui/panel-frame.js';
import { mountAuthorFixture } from './author-fixture.js';

afterEach(() => document.body.replaceChildren());

describe('slotted Author frame boundaries', () => {
  it('mounts the score, complete tools pane, and palette into named slots without changing their logical tree', () => {
    mountAuthorFixture();
    const frame = document.getElementById('author-workbench') as AuthorWorkspaceFrame;
    expect(frame).toBeInstanceOf(AuthorWorkspaceFrame);
    expect(frame.shadowRoot).not.toBeNull();
    for (const [slotName, id] of [['score', 'score-editor'], ['tools', 'workspace-tools'], ['palette', 'workspace-dock']]) {
      const region = document.getElementById(id)!;
      const slot = frame.shadowRoot!.querySelector<HTMLSlotElement>(`slot[name="${slotName}"]`)!;
      expect(region.parentElement).toBe(frame);
      expect(region.getRootNode()).toBe(document);
      expect(slot.assignedElements()).toEqual([region]);
      expect(frame.contains(region)).toBe(true);
      expect(frame.shadowRoot!.contains(region)).toBe(false);
    }
    expect(frame.shadowRoot!.querySelector('input, button, [tabindex]')).toBeNull();
    expect(frame.shadowRoot!.querySelector('div, section, aside')).toBeNull();
    expect(document.getElementById('score-scroll')?.parentElement).toBe(document.getElementById('score-editor'));
    expect(document.getElementById('selection-inspector')?.parentElement).toBe(document.getElementById('workspace-tools'));
  });

  it('keeps slotted input state, listeners, focus, and projection nodes through presentation changes', async () => {
    mountAuthorFixture();
    const frame = document.getElementById('author-workbench') as AuthorWorkspaceFrame;
    const input = document.getElementById('selected-pitch') as HTMLInputElement;
    const scroll = document.getElementById('score-scroll')!;
    document.getElementById('workspace-tools')!.hidden = false;
    frame.setAttribute('tools-presentation', 'side');
    input.value = 'Unapplied spelling';
    input.focus();
    scroll.scrollTop = 147;
    const before = [...frame.children];
    frame.toolsPresentation = 'sheet';
    await frame.updateComplete;
    expect(frame.getAttribute('mode')).toBe('write');
    expect(frame.getAttribute('tools-presentation')).toBe('sheet');
    frame.toolsPresentation = 'side';
    await frame.updateComplete;
    expect([...frame.children]).toEqual(before);
    expect(input.value).toBe('Unapplied spelling');
    expect(document.activeElement).toBe(input);
    expect(scroll.scrollTop).toBe(147);
  });

  it('accepts complete native panel regions and retains a single caller-owned scroll body', async () => {
    const frame = document.createElement('music-panel-frame');
    frame.innerHTML = '<div slot="header"><h2 id="panel-title">Draft</h2></div>'
      + '<div slot="body" class="popover-body"><label for="draft">Draft value</label><textarea id="draft" aria-describedby="draft-help"></textarea><p id="draft-help">Apply when ready.</p></div>'
      + '<div slot="footer"><button id="apply" type="button">Apply</button></div>';
    document.body.append(frame);
    frame.mount();
    expect(frame).toBeInstanceOf(AuthorPanelFrame);
    const input = document.getElementById('draft') as HTMLTextAreaElement;
    const body = input.closest('.popover-body')!;
    expect(input.labels?.[0]?.textContent).toBe('Draft value');
    expect(body.parentElement).toBe(frame);
    expect(frame.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="body"]')!.assignedElements()).toEqual([body]);
    input.value = 'Recoverable draft';
    body.scrollTop = 88;
    const footer = document.getElementById('apply')!.parentElement!;
    footer.remove();
    await frame.updateComplete;
    expect(input.value).toBe('Recoverable draft');
    expect(body.scrollTop).toBe(88);
    frame.append(footer);
    expect(frame.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="footer"]')!.assignedElements()).toEqual([footer]);
    expect(frame.shadowRoot!.querySelector('input, textarea, button, [tabindex]')).toBeNull();
  });

  it('leaves Source native opening and accessible heading in their original document tree', () => {
    mountAuthorFixture();
    const surface = document.getElementById('source-panel')!;
    const frame = surface.querySelector('music-panel-frame')!;
    const heading = document.getElementById('source-heading')!;
    expect(frame.shadowRoot).not.toBeNull();
    expect(surface.getAttribute('popover')).toBe('auto');
    expect(surface.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(surface.contains(heading)).toBe(true);
    expect(heading.getRootNode()).toBe(surface.getRootNode());
    expect(document.getElementById('source-trigger')?.getAttribute('popovertarget')).toBe(surface.id);
    expect(document.getElementById('close-source')?.getAttribute('popovertarget')).toBe(surface.id);
  });
});
