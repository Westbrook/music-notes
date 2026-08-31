// @vitest-environment happy-dom
/** Real workspace updates must preserve icon delivery beside native controls. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { MusicButtonContent } from '../src/ui/button-content.js';
import { authorControlParent, findAuthorControl, mountAuthorFixture } from './author-fixture.js';

const source = `<music-staff id="lead" label="Lead"><music-measure id="bar" number="12" incomplete>
  <music-note id="note" pitch="F4" duration="quarter"></music-note>
  <music-rest id="rest" duration="half"></music-rest>
</music-measure></music-staff>`;
const emptySource = '<music-staff id="lead"><music-measure id="bar" number="12" incomplete></music-measure></music-staff>';
let app: AuthorWorkspace | undefined;
let sequence = 0;

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl<T>(document, id);
  if (!element) throw new Error(`Missing Author control #${id}`);
  return element;
}

async function flush(): Promise<void> {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
}

function mount(markup = source): AuthorWorkspace {
  const records = new Map<string, string>();
  const recovery = new RecoveryStore({
    key: `author-icons-${++sequence}`, writerId: 'icon-controls-test',
    storage: {
      getItem: key => records.get(key) ?? null,
      setItem: (key, value) => { records.set(key, value); },
      removeItem: key => { records.delete(key); },
    },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: createProject(markup, 'Icon controls'), recovery });
  return app;
}

async function prepare(element: HTMLElement): Promise<void> {
  const ancestors: HTMLElement[] = [];
  for (let parent = authorControlParent(element); parent; parent = authorControlParent(parent)) ancestors.unshift(parent);
  for (const parent of ancestors) {
    expect(parent.matches('[hidden],[inert],[aria-hidden="true"]'), `${element.id} has a visible control surface`).toBe(false);
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      parent.querySelector<HTMLElement>(':scope > summary')!.click();
      await flush();
    }
  }
  expect(element.hidden, `#${element.id} is visible`).toBe(false);
  expect(element.matches(':disabled'), `#${element.id} is enabled`).toBe(false);
}

async function click(id: string): Promise<void> {
  const button = control<HTMLButtonElement>(id);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  await prepare(button);
  button.click();
  await flush();
}

async function field(id: string, value: string): Promise<void> {
  const input = control<HTMLInputElement | HTMLSelectElement>(id);
  await prepare(input);
  if (input instanceof HTMLSelectElement) expect([...input.options].some(option => option.value === value && !option.disabled)).toBe(true);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

async function select(id: string): Promise<void> {
  const sourceElement = app!.session.source.querySelector(`[id="${id}"]`);
  expect(sourceElement).not.toBeNull();
  control('score-host').dispatchEvent(new CustomEvent('notation-select', {
    bubbles: true, composed: true,
    detail: { sourceId: id, sourceElement, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse' },
  }));
  await flush();
}

async function expectIcon(id: string, expected: string, label: string | RegExp): Promise<MusicButtonContent> {
  const button = control<HTMLButtonElement>(id);
  expect(button.type).toBe('button');
  const content = button.querySelector<MusicButtonContent>('music-button-content');
  expect(content, `#${id} retains its icon and label component`).not.toBeNull();
  await content!.updateComplete;
  // A normal Lit update delivers the graphic itself, with no catalog or font
  // readiness step between rendering the label and rendering its icon.
  const icon = content!.shadowRoot!.querySelector<SVGSVGElement>('svg[data-icon]');
  expect(icon, `#${id} delivers SVG with its label in the same update`).not.toBeNull();
  expect(icon!.getAttribute('data-icon')).toBe(expected);
  expect(icon!.querySelector('path')?.getAttribute('d')).toMatch(/\S/);
  expect(icon!.getAttribute('aria-hidden')).toBe('true');
  expect(icon!.getAttribute('focusable')).toBe('false');
  if (typeof label === 'string') expect(button.textContent?.trim()).toBe(label);
  else expect(button.textContent?.trim()).toMatch(label);
  return content!;
}

beforeEach(() => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  mountAuthorFixture();
  // This gate covers real session/controller updates. Engraving geometry and
  // native popover placement are covered by browser verification.
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined },
    hidePopover: { configurable: true, value: undefined },
  });
});

afterEach(async () => {
  app?.dispose(); app = undefined;
  await flush();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('icons stay synchronized with native Author controls', () => {
  it('changes the entry symbol from an eighth note to an eighth rest and preserves the recipe through insertion and undo', async () => {
    const workspace = mount(emptySource);
    const accepted = workspace.session.project.sourceHtml;
    expect(control<HTMLSelectElement>('event-duration').value).toBe('quarter');
    await click('toggle-entry');
    const content = await expectIcon('entry-value-trigger', 'music:noteQuarterUp', /Quarter/);

    await click('entry-value-trigger');
    await field('event-duration', 'eighth');
    await click('close-entry-value');
    expect(await expectIcon('entry-value-trigger', 'music:note8thUp', /Eighth/)).toBe(content);
    await click('entry-settings-trigger');
    await click('entry-choose-rest');
    expect(control('entry-choose-rest').getAttribute('aria-pressed')).toBe('true');
    expect(control('entry-choose-note').getAttribute('aria-pressed')).toBe('false');
    expect(control<HTMLSelectElement>('event-kind').value).toBe('rest');
    await click('close-entry-settings');
    expect(await expectIcon('entry-value-trigger', 'music:rest8th', /Eighth/)).toBe(content);
    expect(control('entry-value-trigger').getAttribute('aria-label')).toMatch(/new rests: Eighth/);
    expect(workspace.session.project.sourceHtml).toBe(accepted);
    expect(workspace.session.canUndo).toBe(false);

    await click('insert-event');
    expect(workspace.session.score.staves[0].measures[0].voices[0].events).toMatchObject([{ kind: 'rest', duration: 'eighth' }]);
    expect(control<HTMLButtonElement>('undo').disabled).toBe(false);
    await expectIcon('undo', 'ph:arrow-u-up-left', 'Undo');
    await click('undo');
    expect(workspace.session.project.sourceHtml).toBe(accepted);
    expect(control<HTMLButtonElement>('undo').disabled).toBe(true);
    expect(control<HTMLButtonElement>('redo').disabled).toBe(false);
    expect(control<HTMLSelectElement>('event-duration').value).toBe('eighth');
    expect(control<HTMLSelectElement>('event-kind').value).toBe('rest');
    expect(await expectIcon('entry-value-trigger', 'music:rest8th', /Eighth/)).toBe(content);
  });

  it('keeps selected value and accidental controls accurate through edits, undo, redo and selection of a rest', async () => {
    const workspace = mount();
    await select('note');
    const value = await expectIcon('selection-value', 'music:noteQuarterUp', 'Quarter');
    const sharp = await expectIcon('selection-sharp', 'music:accidentalSharp', 'Sharp');
    await click('selection-value');
    await field('selection-duration', 'eighth');
    await click('close-selection-value');
    expect(await expectIcon('selection-value', 'music:note8thUp', 'Eighth')).toBe(value);
    expect(control<HTMLSelectElement>('selection-duration').value).toBe('eighth');
    expect(workspace.session.score.staves[0].measures[0].voices[0].events[0].duration).toBe('eighth');

    await click('selection-sharp');
    expect(control('selection-sharp').getAttribute('aria-checked')).toBe('true');
    expect(workspace.session.score.staves[0].measures[0].voices[0].events[0].pitches[0].alter).toBe(1);
    expect(await expectIcon('selection-sharp', 'music:accidentalSharp', 'Sharp')).toBe(sharp);
    await click('undo');
    expect(control('selection-sharp').getAttribute('aria-checked')).toBe('false');
    expect(control('selection-natural').getAttribute('aria-checked')).toBe('true');
    expect(await expectIcon('selection-value', 'music:note8thUp', 'Eighth')).toBe(value);
    await click('undo');
    expect(control<HTMLSelectElement>('selection-duration').value).toBe('quarter');
    expect(await expectIcon('selection-value', 'music:noteQuarterUp', 'Quarter')).toBe(value);
    await click('redo');
    expect(await expectIcon('selection-value', 'music:note8thUp', 'Eighth')).toBe(value);

    await select('rest');
    expect(await expectIcon('selection-value', 'music:restHalfLegerLine', 'Half')).toBe(value);
    expect(control<HTMLSelectElement>('selection-duration').value).toBe('half');
    expect(control<HTMLButtonElement>('selection-value').disabled).toBe(false);
    expect(control('selection-accidentals').hidden).toBe(true);
    expect(workspace.session.selectionId).toBe('rest');
  });

  it('retains icons when Review counts and a stale confirmation replace their action labels', async () => {
    const workspace = mount();
    await select('note');
    await click('edit-selected-event');
    await field('selected-pitch', 'G4');
    await click('tools-hide');
    await click('workspace-review-trigger');
    await expectIcon('workspace-review-trigger', 'ph:warning', 'Review');
    await expectIcon('review-drafts', 'ph:list-checks', 'Review 1 unsaved form');
    expect(control('review-drafts').hidden).toBe(false);
    await click('close-workspace-review');

    await click('edit-selected-event');
    await click('other-tools');
    await click('tool-tab-measure');
    await click('fill-rests');
    const dialog = control<HTMLDialogElement>('author-confirmation');
    expect(dialog.open).toBe(true);
    const confirm = await expectIcon('author-confirmation-confirm', 'ph:check', 'Fill with rests');
    const cancel = await expectIcon('author-confirmation-cancel', 'ph:x', 'Cancel');
    const accepted = workspace.session.project.sourceHtml;

    // A separate workspace actor changes selection while the modal is open.
    // The next confirm must become stale without removing either icon.
    workspace.session.select('rest');
    await click('author-confirmation-confirm');
    expect(dialog.open).toBe(true);
    expect(control<HTMLButtonElement>('author-confirmation-confirm').disabled).toBe(true);
    expect(await expectIcon('author-confirmation-confirm', 'ph:check', 'Fill with rests')).toBe(confirm);
    expect(await expectIcon('author-confirmation-cancel', 'ph:x', 'Close and review')).toBe(cancel);
    expect(control('author-confirmation-status').hidden).toBe(false);
    expect(workspace.session.project.sourceHtml).toBe(accepted);
    await click('author-confirmation-cancel');
    expect(dialog.open).toBe(false);
    expect(workspace.session.project.sourceHtml).toBe(accepted);
  });
});
