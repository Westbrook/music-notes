// @vitest-environment happy-dom
import { createAuthorFixtureDocument, findAuthorControl } from './author-fixture.js';
import { AuthorWorkspaceFrame } from '../src/authoring/ui/workspace-frame.js';
import { AuthorViewSwitch } from '../src/authoring/ui/view-switch.js';
import { MusicSourceEditor } from '../src/authoring/ui/source-editor.js';
import { composedAncestors } from '../src/ui/composed-dom.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const authorCss = readFileSync('src/authoring/author.css', 'utf8');
const designTokensCss = readFileSync('src/ui/design-tokens.css', 'utf8');
const workspaceCss = AuthorWorkspaceFrame.styles.cssText;
const viewSwitchCss = AuthorViewSwitch.styles.cssText;
const sourceEditorCss = MusicSourceEditor.styles.cssText;
// Test authored structure without loading fonts, application code, or score assets.
// Real layout, scrolling, native picker behavior, and focus transitions belong
// to the browser suites; happy-dom does not establish those guarantees.
let shell: Document;

beforeEach(() => { shell = createAuthorFixtureDocument(); });

function element(id: string): HTMLElement {
  const result = findAuthorControl(shell, id);
  expect(result, `Missing shell element #${id}`).not.toBeNull();
  return result!;
}

function button(id: string): HTMLButtonElement {
  const result = element(id);
  expect(result.tagName).toBe('BUTTON');
  expect(result.getAttribute('type')).toBe('button');
  return result as HTMLButtonElement;
}

function labelledBy(element: HTMLElement): HTMLElement[] {
  const ids = element.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  expect(ids.length, `#${element.id} needs an accessible label`).toBeGreaterThan(0);
  return ids.map(id => {
    const label = shell.getElementById(id);
    expect(label, `#${element.id} references missing label #${id}`).not.toBeNull();
    expect(label!.textContent?.trim()).not.toBe('');
    return label!;
  });
}

function paletteGridOwners(dock: HTMLElement): Element[] {
  const helperIds = new Set(['drag-pitch-help', 'pointer-help', 'edit-selected-help']);
  for (const child of dock.children) {
    if (!helperIds.has(child.id)) continue;
    expect(child.classList.contains('visually-hidden')).toBe(true);
    expect(child.matches('button, input, select, textarea, a[href], [tabindex]')).toBe(false);
    expect(child.querySelector('button, input, select, textarea, a[href], [tabindex]')).toBeNull();
  }
  // Accessible descriptions can be children, but must not become grid tracks.
  expect(declarationsFor('.visually-hidden')).toMatch(/position:\s*absolute(?:\s*!important)?;/);
  return [...dock.children].filter(child => !helperIds.has(child.id));
}

// Read declarations rather than asking the DOM emulator to infer layout.
// The selectors used below are simple leaf rules, including rules within media
// queries. The separate browser suite verifies the resulting cascade and fit.
function rulesFor(selector: string, stylesheet = authorCss): string[] {
  return leafRules(stylesheet)
    // Match a complete selector first so commas inside :is() stay intact.
    .filter(rule => rule.selector === selector || rule.selector.split(',').some(candidate => candidate.trim() === selector))
    .map(rule => rule.declarations);
}

function leafRules(stylesheet = authorCss): { selector: string; declarations: string }[] {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(match => ({ selector: match[1].trim(), declarations: match[2] }));
}

function declarationsFor(selector: string, stylesheet = authorCss): string {
  const rules = rulesFor(selector, stylesheet);
  expect(rules.length, `Missing CSS rule for ${selector}`).toBeGreaterThan(0);
  return rules.join('\n');
}

function blockFor(header: RegExp, stylesheet = authorCss): string {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const match = header.exec(css);
  expect(match, `Missing CSS block ${header}`).not.toBeNull();
  const start = css.indexOf('{', match!.index);
  let depth = 1;
  for (let index = start + 1; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(start + 1, index);
  }
  throw new Error(`Unclosed CSS block ${header}`);
}

const tools = [
  ['rhythm', 'passage-inspector'],
  ['markings', 'annotation-inspector'],
  ['measure', 'measure-inspector'],
] as const;

describe('compact writing presentation markup', () => {
  it('keeps keyboard help in a closed native disclosure without losing the score description', () => {
    const disclosure = element('keyboard-shortcuts');
    const summary = element('keyboard-shortcuts-summary');
    const help = element('keyboard-help');
    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure.hasAttribute('open')).toBe(false);
    expect(disclosure.hidden).toBe(false);
    expect(disclosure.hasAttribute('popover')).toBe(false);
    expect(disclosure.closest('.nonprinting')).not.toBeNull();
    expect(disclosure.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
    expect(disclosure.getAttribute('role')).not.toBe('menu');
    expect(disclosure.firstElementChild).toBe(summary);
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.textContent?.trim()).toBe('Keyboard shortcuts');
    expect(summary.hidden).toBe(false);
    expect(summary.closest('[aria-hidden="true"]')).toBeNull();
    expect(disclosure.contains(help)).toBe(true);
    expect(help.hidden).toBe(false);
    expect(help.textContent?.trim()).not.toBe('');
    expect(element('score-scroll').contains(disclosure)).toBe(true);
    expect(element('workspace-dock').contains(disclosure)).toBe(false);
    expect(element('score-editor').getAttribute('aria-describedby')?.split(/\s+/)).toContain(help.id);
    expect(shell.querySelectorAll('#keyboard-help')).toHaveLength(1);
    expect(declarationsFor('.keyboard-shortcuts > summary')).toMatch(/min-height:\s*44px;/);
    expect(declarationsFor('body[data-view="read"] .keyboard-shortcuts')).toMatch(/display:\s*none;/);
  });

  it('keeps notation review as a conditional non-live list inside the existing Review body', () => {
    const review = element('workspace-review');
    const section = element('notation-review');
    const heading = element('notation-review-heading');
    const list = element('notation-review-list');
    expect(section.tagName).toBe('SECTION');
    expect(section.hidden).toBe(true);
    expect(section.hasAttribute('popover')).toBe(false);
    expect(section.closest('.popover-body')).toBe(review.querySelector('.popover-body'));
    expect(section.closest('[popover]')).toBe(review);
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent?.trim()).not.toBe('');
    expect(list.tagName).toBe('UL');
    expect(section.contains(heading)).toBe(true);
    expect(section.contains(list)).toBe(true);
    expect(section.hasAttribute('aria-live')).toBe(false);
    expect(['status', 'alert', 'log']).not.toContain(section.getAttribute('role'));
    expect(section.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
    expect(element('workspace-dock').contains(section)).toBe(false);
    const reviewStyle = declarationsFor('#notation-review');
    expect(reviewStyle).toMatch(/min-width:\s*0;/);
    expect(reviewStyle).toMatch(/overflow-wrap:\s*anywhere;/);
    for (const style of [reviewStyle, declarationsFor('#notation-review-list')]) {
      expect(style).not.toMatch(/max-height\s*:|overflow:\s*hidden|text-overflow:\s*ellipsis|line-clamp\s*:/);
    }
  });

  it('adds an initially hidden writing destination inside the existing Insert action without another control', () => {
    const insert = button('insert-event');
    const label = element('insert-event-label');
    const destination = element('insert-event-destination');
    expect(insert.parentElement).toBe(element('entry-slot-action'));
    const content = insert.querySelector('music-button-content');
    expect(content?.parentElement).toBe(insert);
    expect([...(content?.children ?? [])]).toEqual([label, destination]);
    expect(label.tagName).toBe('SPAN');
    expect(label.textContent?.trim()).not.toBe('');
    expect(label.hidden).toBe(false);
    expect(destination.tagName).toBe('SPAN');
    expect(destination.hidden).toBe(true);
    expect(insert.getAttribute('aria-describedby')?.split(/\s+/)).toContain('entry-destination');
    expect(insert.querySelector('button, input, select, textarea, a[href], [tabindex]')).toBeNull();
    for (const id of ['insert-event', 'insert-event-label', 'insert-event-destination']) {
      expect(shell.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    const actionStyle = declarationsFor('#entry-slot-action #insert-event');
    expect(actionStyle).toMatch(/display:\s*grid;/);
    expect(actionStyle).toMatch(/align-content:\s*center;/);
    expect(actionStyle).toMatch(/gap:\s*0;/);
    expect(declarationsFor('.palette-slot > button')).toMatch(/min-height:\s*var\(--palette-control-size\);/);
    expect(declarationsFor('.palette-slot')).toMatch(/grid-template-rows:\s*var\(--palette-group-size\);/);
    const captionStyle = declarationsFor('#insert-event-destination');
    expect(captionStyle).toMatch(/min-width:\s*0;/);
    expect(captionStyle).toMatch(/max-width:\s*100%;/);
    expect(captionStyle).toMatch(/white-space:\s*nowrap;/);
    expect(captionStyle).toMatch(/overflow:\s*hidden;/);
    expect(captionStyle).toMatch(/text-overflow:\s*ellipsis;/);
    expect(captionStyle).not.toMatch(/(?:^|;)\s*(?:font(?:-[\w]+)?|line-height|(?:min-|max-)?(?:height|block-size)|line-clamp|-webkit-line-clamp)\s*:/);
    // Only the destination's horizontal text can truncate. Native QA must
    // inspect both text rectangles inside the unchanged button, not just its box.
  });
});

describe('stable writing palette structural contract', () => {
  it('keeps both named editing modes visible in one permanent two-button slot', () => {
    const slot = element('workspace-mode-slot');
    const writing = button('toggle-entry');
    const selecting = button('select-mode');
    expect([...slot.querySelectorAll('button')]).toEqual([writing, selecting]);
    expect(element('entry-mode-label').textContent?.trim()).toBe('Write notes');
    expect(selecting.textContent?.trim()).toBe('Select');
    for (const mode of [writing, selecting]) {
      expect(mode.parentElement).toBe(slot);
      expect(mode.closest('[hidden], [aria-hidden="true"]')).toBeNull();
      expect(['true', 'false']).toContain(mode.getAttribute('aria-pressed'));
      expect(mode.hasAttribute('popovertarget')).toBe(false);
      expect(mode.disabled).toBe(false);
    }
    expect(element('location-panel').contains(button('resume-entry'))).toBe(true);
    expect(slot.contains(element('entry-mode-reason'))).toBe(false);
    expect(element('entry-mode-reason').tagName).not.toBe('BUTTON');
  });

  it('does not attach invalid-bookmark copy to the initially valid Write notes action', () => {
    const writing = button('toggle-entry');
    expect(element('entry-mode-reason').hidden).toBe(true);
    expect(writing.getAttribute('aria-describedby')?.split(/\s+/)).not.toContain('entry-mode-reason');
    expect(writing.getAttribute('aria-describedby')?.split(/\s+/)).toContain('entry-destination');
    expect(writing.getAttribute('aria-label') ?? writing.textContent?.trim()).toBe('Write notes');
  });

  it('gives modes, musical choices, More, and Location their own fixed dock owners', () => {
    const dock = element('workspace-dock');
    const musical = element('palette-musical-slots');
    const more = element('palette-more-slot');
    expect(paletteGridOwners(dock).map(child => child.id)).toEqual([
      'palette-musical-slots', 'workspace-mode-slot', 'palette-more-slot', 'location-trigger',
    ]);
    expect(musical.contains(element('entry-toolbar'))).toBe(true);
    expect(musical.contains(element('selection-controls'))).toBe(true);
    for (const id of ['edit-selected-event', 'tools-toggle']) {
      const action = button(id);
      expect(more.contains(action)).toBe(true);
      expect(action.textContent?.trim()).toBe('More');
      expect(action.getAttribute('aria-controls')).toBe('workspace-tools');
      expect(action.hasAttribute('popovertarget')).toBe(false);
      expect(musical.contains(action)).toBe(false);
    }
    expect(button('location-trigger').getAttribute('popovertarget')).toBe('location-panel');
    expect(button('location-trigger').contains(element('palette-owner-label'))).toBe(true);
    expect(element('score-editor').contains(dock)).toBe(false);
    expect(element('workspace-tools').contains(dock)).toBe(false);
  });

  it('rehomes the complete entry recipe into native options and a separate native Value chooser', () => {
    const entry = element('entry-toolbar');
    const options = element('entry-settings');
    const chooser = element('entry-value-chooser');
    expect(element('entry-slot-options').contains(button('entry-settings-trigger'))).toBe(true);
    expect(element('entry-slot-value').contains(button('entry-value-trigger'))).toBe(true);
    expect(element('entry-slot-action').contains(button('insert-event'))).toBe(true);
    for (const id of ['entry-slot-options', 'entry-slot-value', 'entry-slot-action']) {
      expect(entry.contains(element(id))).toBe(true);
    }
    for (const id of ['event-kind', 'event-direction', 'event-pitch', 'event-pitches', 'event-alteration', 'event-rhythmic', 'event-measure-rest', 'insert-position', 'event-accidental-display', 'event-stem', 'event-beam']) {
      expect(options.contains(element(id)), `${id} belongs to the complete entry recipe`).toBe(true);
      expect(entry.contains(element(id))).toBe(false);
    }
    for (const id of ['event-duration', 'event-dots']) {
      expect(chooser.querySelector('.popover-body')?.contains(element(id))).toBe(true);
      expect(options.contains(element(id))).toBe(false);
      expect(entry.contains(element(id))).toBe(false);
      expect(shell.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    expect([...((element('event-duration')) as HTMLSelectElement).options].map(option => option.value)).toEqual([
      'breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th',
    ]);
    expect([...((element('event-dots')) as HTMLSelectElement).options].map(option => option.value)).toEqual(['0', '1', '2', '3']);
    expect(chooser.getAttribute('popover')).toBe('auto');
    expect(chooser.getAttribute('aria-describedby')?.split(/\s+/)).toContain('entry-destination');
    expect(chooser.classList.contains('surface-popover')).toBe(true);
    expect(labelledBy(chooser).some(label => chooser.contains(label) && /^H[1-6]$/.test(label.tagName))).toBe(true);
    expect(button('entry-value-trigger').getAttribute('popovertarget')).toBe(chooser.id);
    for (const id of ['entry-value-label', 'entry-value-dots']) expect(button('entry-value-trigger').contains(element(id))).toBe(true);
    const close = button('close-entry-value');
    expect(chooser.contains(close)).toBe(true);
    expect(chooser.querySelector('.popover-body')?.contains(close)).toBe(false);
    expect(close.getAttribute('popovertarget')).toBe(chooser.id);
    expect(close.getAttribute('popovertargetaction')).toBe('hide');
    // Unsupported native surfaces must not fall into the compact palette.
    expect(element('workspace-dock').contains(options)).toBe(false);
    expect(element('workspace-dock').contains(chooser)).toBe(false);
  });

  it('offers explicit note and rest choices while keeping entry drag a deliberate prepared action', () => {
    const options = element('entry-settings');
    for (const id of ['entry-choose-note', 'entry-choose-rest']) {
      const choice = button(id);
      expect(options.contains(choice)).toBe(false);
      expect(choice.getRootNode()).toBe(element('entry-kind').shadowRoot);
      expect(['true', 'false']).toContain(choice.getAttribute('aria-pressed'));
      expect(choice.getAttribute('role')).toBeNull();
    }
    expect(options.contains(button('prepare-entry-drag'))).toBe(true);
    const cancel = button('cancel-entry-drag');
    expect(element('entry-slot-value').contains(cancel)).toBe(true);
    expect(cancel.hidden).toBe(true);
    expect(cancel.textContent?.trim()).toBe('Done');
    expect(cancel.getAttribute('aria-label')).toMatch(/cancel.*drag/i);
    const handle = button('drag-entry');
    expect(element('entry-slot-action').contains(handle)).toBe(true);
    expect(handle.hidden).toBe(true);
    expect(button('insert-event').classList.contains('primary-button')).toBe(false);
    expect(shell.body.getAttribute('data-entry-drag-armed')).toBe('false');
  });

  it('reserves three selection slots and keeps range navigation out of musical action slots', () => {
    const core = element('selection-controls');
    for (const [slotId, actionIds] of [
      ['selection-slot-1', ['selection-pitch', 'selection-shared', 'selection-mark-edit']],
      ['selection-slot-2', ['selection-value', 'selection-done']],
      ['selection-slot-3', ['selection-attached-marks', 'selection-relationships', 'selection-mark-remove', 'drag-pitch']],
    ] as const) {
      const slot = element(slotId);
      expect(core.contains(slot)).toBe(true);
      for (const id of actionIds) expect(slot.contains(button(id)), `${id} has a stable musical slot`).toBe(true);
    }
    expect(element('location-panel').contains(button('selection-range'))).toBe(true);
    expect(button('selection-value').hidden).toBe(false);
    for (const id of ['edit-selected-event', 'tools-toggle', 'location-trigger', 'toggle-entry', 'select-mode', 'selection-range']) {
      expect(core.contains(element(id))).toBe(false);
    }
  });

  it('makes complete note pitch choices native and explicit in the Pitch chooser', () => {
    const chooser = element('selection-pitch-chooser');
    for (const [id, values] of [
      ['selection-note-step', ['C', 'D', 'E', 'F', 'G', 'A', 'B']],
      ['selection-note-octave', Array.from({ length: 11 }, (_, index) => String(index - 1))],
    ] as const) {
      const select = element(id) as HTMLSelectElement;
      const field = element(`${id}-field`);
      expect(select.tagName).toBe('SELECT');
      expect(field.contains(select)).toBe(true);
      expect(chooser.querySelector('.popover-body')?.contains(field)).toBe(true);
      expect(shell.querySelector(`label[for="${id}"]`)).not.toBeNull();
      expect(select.getAttribute('aria-describedby')?.split(/\s+/)).toContain('selection-pitch-help');
      expect([...select.options].map(option => option.getAttribute('value'))).toEqual(values);
      expect(select.classList.contains('author-select')).toBe(true);
      expect(select.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    }
    expect(chooser.contains(element('selection-alteration'))).toBe(true);
    expect(chooser.contains(element('selection-pitch-help'))).toBe(true);
  });

  it('keeps one header feedback owner and complete global details in native Review without covering the palette', () => {
    const feedback = element('workspace-feedback-label');
    const review = element('workspace-review');
    expect(feedback.closest('header.app-header')).not.toBeNull();
    expect(feedback.parentElement).toBe(element('save-status').parentElement);
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(element('save-status').hasAttribute('role')).toBe(false);
    expect(element('save-status').hasAttribute('aria-live')).toBe(false);
    for (const id of ['workspace-notices', 'source-draft-notice', 'inspector-draft-status', 'workspace-review-summary', 'author-status', 'pointer-status', 'selection-controls-error', 'selection-controls-feedback', 'author-errors']) {
      const detail = element(id);
      expect(review.contains(detail), `${id} belongs to complete Review details`).toBe(true);
      expect(detail.hasAttribute('aria-live')).toBe(false);
      expect(['status', 'alert', 'log']).not.toContain(detail.getAttribute('role'));
      expect(element('workspace-dock').contains(detail)).toBe(false);
    }
    const reviewSlot = element('workspace-review-slot');
    expect(button('workspace-review-trigger').parentElement).toBe(reviewSlot);
    expect(reviewSlot.hidden).toBe(false);
    expect(reviewSlot.parentElement).toBe(button('undo').parentElement);
    expect(reviewSlot.parentElement).toBe(button('redo').parentElement);
    expect(button('workspace-review-trigger').getAttribute('popovertarget')).toBe(review.id);
    expect(element('source-error').getAttribute('role')).toBe('alert');
    expect(element('selection-value-error').getAttribute('role')).toBe('alert');
    expect([...shell.querySelectorAll('header.app-header [role="status"], header.app-header [aria-live]')]).toEqual([feedback]);
  });

  it('authors explicit closed task-presentation hooks while retaining the score and print mounts', () => {
    expect(shell.body.getAttribute('data-tools-presentation')).toBe('closed');
    expect(element('workspace-tools').getAttribute('data-tools-presentation')).toBe('closed');
    expect(element('score-scroll').contains(element('score-host'))).toBe(true);
    expect(element('score-editor').hidden).toBe(false);
    expect(element('workspace-tools').contains(element('score-host'))).toBe(false);
    expect(element('author-workbench').contains(element('page-host'))).toBe(false);
    expect(button('tools-hide').closest('#workspace-tools')).toBe(element('workspace-tools'));
  });

  it('gives road direction a native chooser in the existing options slot without moving the canonical recipe', () => {
    const slot = element('entry-slot-options');
    const trigger = button('entry-direction-trigger');
    const chooser = element('entry-direction-chooser');
    expect(slot.contains(trigger)).toBe(true);
    expect(slot.contains(button('entry-settings-trigger'))).toBe(true);
    expect(trigger.getAttribute('popovertarget')).toBe(chooser.id);
    expect(chooser.getAttribute('popover')).toBe('auto');
    expect(chooser.classList.contains('surface-popover')).toBe(true);
    expect(chooser.closest('.nonprinting')).not.toBeNull();
    expect(element('workspace-dock').contains(chooser)).toBe(false);
    expect(labelledBy(chooser).some(label => chooser.contains(label) && /^H[1-6]$/.test(label.tagName))).toBe(true);
    const body = chooser.querySelector('.popover-body');
    expect(body).not.toBeNull();
    for (const direction of ['higher', 'same', 'lower']) {
      const choice = button(`entry-direction-${direction}`);
      expect(body!.contains(choice)).toBe(true);
      expect(['true', 'false']).toContain(choice.getAttribute('aria-pressed'));
      expect(choice.hasAttribute('popovertarget')).toBe(false);
    }
    const close = button('close-entry-direction');
    expect(chooser.contains(close)).toBe(true);
    expect(body!.contains(close)).toBe(false);
    expect(close.getAttribute('popovertarget')).toBe(chooser.id);
    expect(close.getAttribute('popovertargetaction')).toBe('hide');
    const options = button('entry-direction-options');
    expect(body!.contains(options)).toBe(true);
    expect(options.getAttribute('popovertarget')).toBe('entry-settings');
    expect(element('entry-settings').contains(element('event-direction'))).toBe(true);
    expect(chooser.querySelector('select')).toBeNull();
    expect(shell.querySelectorAll('#event-direction')).toHaveLength(1);
    for (const selector of ['body[data-entry-kind="road"] #entry-settings-trigger', 'body:not([data-entry-kind="road"]) #entry-direction-trigger']) {
      expect(declarationsFor(selector)).toMatch(/display:\s*none;/);
    }
    expect(declarationsFor('.palette-slot > button')).toMatch(/grid-area:\s*1\s*\/\s*1;/);
    expect(declarationsFor('.entry-direction-choices')).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(var\(--music-ui-control-size\),\s*1fr\)\);/);
    expect(declarationsFor('.entry-direction-choices button')).toMatch(/min-width:\s*var\(--music-ui-control-size\);/);
    expect(declarationsFor('.entry-direction-choices button')).toMatch(/min-height:\s*var\(--music-ui-control-size\);/);
  });

  it('keeps recovery download and complete non-live guidance in Review outside the normal palette', () => {
    const review = element('workspace-review');
    const detail = element('workspace-recovery-detail');
    const download = button('review-download-project');
    const body = review.querySelector('.popover-body');
    expect(detail.tagName).toBe('P');
    expect(detail.hasAttribute('role')).toBe(false);
    expect(detail.hasAttribute('aria-live')).toBe(false);
    expect(body!.contains(detail)).toBe(true);
    expect(body!.contains(download)).toBe(true);
    expect(download.hidden).toBe(true);
    expect(download.hasAttribute('popovertarget')).toBe(false);
    expect(element('workspace-dock').contains(detail)).toBe(false);
    expect(element('workspace-dock').contains(download)).toBe(false);
  });
});

describe('score-first authoring shell markup', () => {
  it('places both editing modes in one bottom dock outside the score and Properties split', () => {
    const workbench = element('author-workbench');
    const editor = element('score-editor');
    const pane = element('workspace-tools');
    const strip = element('pointer-tools');
    const entry = element('entry-toolbar');
    const scroll = element('score-scroll');
    const host = element('score-host');
    const workspaceDock = element('workspace-dock');
    expect(editor.parentElement).toBe(workbench);
    expect(pane.parentElement).toBe(workbench);
    expect(workspaceDock.parentElement).toBe(workbench);
    expect(workbench.lastElementChild).toBe(workspaceDock);
    expect([...editor.children]).toEqual([scroll]);
    expect(scroll.parentElement).toBe(editor);
    expect(entry.parentElement).toBe(element('palette-musical-slots'));
    expect(strip.parentElement).toBe(element('palette-musical-slots'));
    expect(paletteGridOwners(workspaceDock).map(child => child.id)).toEqual([
      'palette-musical-slots', 'workspace-mode-slot', 'palette-more-slot', 'location-trigger',
    ]);
    expect(workspaceDock.closest('.nonprinting')).not.toBeNull();
    expect(workspaceDock.hasAttribute('popover')).toBe(false);
    for (const splitRegion of [editor, pane]) {
      expect(splitRegion.contains(workspaceDock)).toBe(false);
      expect(splitRegion.contains(entry)).toBe(false);
      expect(splitRegion.contains(strip)).toBe(false);
    }
    expect(scroll.contains(host)).toBe(true);
    expect(scroll.contains(strip)).toBe(false);
    expect(scroll.contains(entry)).toBe(false);
    expect(pane.contains(host)).toBe(false);
    expect(editor.getAttribute('tabindex')).toBe('0');
    // Wide measures need a keyboard-reachable scroll region of their own.
    expect(scroll.getAttribute('tabindex')).toBe('0');
    expect(host.childElementCount).toBe(0);
    expect(element('page-host').childElementCount).toBe(0);
    expect(workbench.contains(element('page-host'))).toBe(false);
    expect(shell.querySelectorAll('music-system, music-staff')).toHaveLength(0);
  });

  it('keeps the actual Write notes and Select buttons outside either editing surface and Resume in Location', () => {
    const dock = element('workspace-dock');
    const slot = element('workspace-mode-slot');
    expect(slot.parentElement).toBe(dock);
    expect(slot.getAttribute('role')).toBe('group');
    expect(slot.getAttribute('aria-label')?.trim() || slot.getAttribute('aria-labelledby')?.trim()).toBeTruthy();
    if (slot.hasAttribute('aria-labelledby')) labelledBy(slot);
    for (const id of ['select-mode', 'toggle-entry']) {
      const mode = button(id);
      expect(mode.parentElement).toBe(slot);
      expect(mode.closest('.nonprinting')).not.toBeNull();
      expect(element('entry-toolbar').contains(mode)).toBe(false);
      expect(element('selection-controls').contains(mode)).toBe(false);
      expect(element('score-editor').contains(mode)).toBe(false);
      expect(element('workspace-tools').contains(mode)).toBe(false);
      expect(shell.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    expect([...slot.querySelectorAll('button')].map(action => action.id).sort()).toEqual(['select-mode', 'toggle-entry']);
    expect(element('location-panel').contains(button('resume-entry'))).toBe(true);
    // The geometry suite must establish that this shared owner also preserves
    // the physical button location through mode and Properties transitions.
  });

  it('keeps part navigation outside Write-only controls (UX-PART-ALL-VIEWS)', () => {
    const trigger = button('active-part-label');
    const panel = element('location-panel');
    const select = element('part-select');
    expect(trigger.closest('header.app-header')).not.toBeNull();
    expect(trigger.closest('#pointer-tools, #write-tools, #author-workbench')).toBeNull();
    expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
    expect(trigger.hidden).toBe(false);
    expect(trigger.disabled).toBe(false);
    expect(select.tagName).toBe('SELECT');
    expect(select.closest('#location-panel')).toBe(panel);
    expect(select.closest('#selection-toolbar')).toBeNull();
    expect(select.closest('[hidden]')).toBeNull();
    expect(panel.contains(element('selection-toolbar'))).toBe(true);
  });

  it('keeps the external Location caption and a complete Return action inside Location', () => {
    const location = button('location-trigger');
    const compact = location.querySelector('.location-compact');
    expect(compact).not.toBeNull();
    expect(compact!.getAttribute('aria-hidden')).toBe('true');
    for (const id of ['selection-compact-staff', 'selection-compact-context']) {
      const label = element(id);
      expect(label.tagName).toBe('SPAN');
      expect(compact!.contains(label)).toBe(true);
    }
    const fullLocation = element('selection-controls-context');
    expect(location.contains(fullLocation)).toBe(true);
    expect(compact!.contains(fullLocation)).toBe(false);
    expect(fullLocation.closest('[aria-hidden="true"]')).toBeNull();

    const returning = button('return-to-selection');
    expect(returning.textContent?.trim()).not.toBe('');
    expect(returning.getAttribute('aria-label')).toBe(returning.textContent!.trim());
    expect(returning.closest('[aria-hidden="true"]')).toBeNull();
    expect(element('location-panel').contains(returning)).toBe(true);
    expect(element('pointer-tools').contains(returning)).toBe(false);
    expect(element('selection-context')).not.toBe(fullLocation);
  });

  it('keeps lost-entry guidance descriptive without renaming the Write notes mode button', () => {
    const entry = button('toggle-entry');
    const reason = element('entry-mode-reason');
    const label = element('entry-mode-label');
    expect(entry.getAttribute('aria-pressed')).toBe('false');
    expect(entry.disabled).toBe(false);
    expect(entry.hasAttribute('tabindex')).toBe(false);
    expect(entry.closest('[role="group"]')).not.toBeNull();
    expect(entry.parentElement).toBe(element('workspace-mode-slot'));
    expect(entry.contains(label)).toBe(true);
    expect(entry.contains(reason)).toBe(false);
    expect(reason.matches('p, span')).toBe(true);
    expect(element('location-panel').contains(reason)).toBe(true);
    expect(entry.getAttribute('aria-describedby')?.split(/\s+/)).not.toContain(reason.id);
    expect(label.tagName).toBe('SPAN');
    expect(reason.hidden).toBe(true);
    expect(label.hidden).toBe(false);
    expect(reason.textContent).toMatch(/previous writing location.*removed or changed/);
    expect(reason.textContent).toMatch(/Start writing here/);
    expect(label.textContent?.trim()).toBe('Write notes');
    expect(reason.closest('.context-feedback')).toBeNull();
    expect(label.closest('.context-feedback')).toBeNull();
    expect(entry.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
    expect(element('entry-destination').hidden).toBe(true);
  });

  it('opens Properties directly in the same pane outside the three general tool tabs', () => {
    const pane = element('workspace-tools');
    const properties = element('selection-inspector');
    expect(pane.getAttribute('data-tools-view')).toBe('properties');
    expect(properties.getAttribute('role')).toBe('region');
    expect(properties.getAttribute('aria-labelledby')).toBe('properties-heading');
    expect(labelledBy(properties)).toContain(element('properties-heading'));
    expect(properties.parentElement).toBe(pane);
    expect(properties.hidden).toBe(false);
    expect(shell.getElementById('tool-tab-edit')).toBeNull();
    const tablist = pane.querySelector<HTMLElement>('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist!.hidden).toBe(true);
    expect(tablist!.contains(properties)).toBe(false);
    expect(tablist!.getAttribute('aria-label') || tablist!.getAttribute('aria-labelledby')).toBeTruthy();
    expect(tablist!.getAttribute('aria-orientation') ?? 'horizontal').toBe('horizontal');
    expect(tablist!.querySelectorAll('[role="tab"]')).toHaveLength(tools.length);
    expect(pane.querySelectorAll('[role="tabpanel"]')).toHaveLength(tools.length);

    for (const [name, panelId] of tools) {
      const tab = button(`tool-tab-${name}`);
      const panel = element(panelId);
      expect(tablist!.contains(tab)).toBe(true);
      expect(tab.getAttribute('role')).toBe('tab');
      expect(tab.getAttribute('aria-controls')).toBe(panelId);
      expect(['true', 'false']).toContain(tab.getAttribute('aria-selected'));
      expect(panel.tagName).toBe('SECTION');
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(labelledBy(panel)).toContain(tab);
      expect(pane.contains(panel)).toBe(true);
      const active = tab.getAttribute('aria-selected') === 'true';
      expect(tab.getAttribute('tabindex')).toBe(active ? '0' : '-1');
      expect(panel.hidden).toBe(true);
      expect(panel.parentElement).toBe(pane);
    }
    expect(tablist!.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    expect(pane.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(0);
    for (const [id, hidden] of [['other-tools', false], ['back-to-properties', true]] as const) {
      const route = button(id);
      expect(pane.contains(route)).toBe(true);
      expect(route.hidden).toBe(hidden);
      expect(route.hasAttribute('popovertarget')).toBe(false);
      expect(route.closest('[role="tablist"]')).toBeNull();
    }
    expect(element('passage-inspector').contains(element('tuplet-inspector'))).toBe(true);
    expect(pane.contains(element('staff-inspector'))).toBe(false);
  });

  it('reserves one selection-owned toolbar while Location, shared modes, and More remain independent', () => {
    const footer = element('pointer-tools');
    const entry = element('entry-toolbar');
    const dock = element('selection-controls-dock');
    const core = element('selection-controls');
    expect(footer.contains(dock)).toBe(true);
    expect(core.parentElement).toBe(dock);
    expect(core.getAttribute('role')).toBe('toolbar');
    expect(shell.querySelectorAll('#selection-controls')).toHaveLength(1);
    const context = element('selection-controls-context');
    expect(button('location-trigger').contains(context)).toBe(true);
    expect(core.contains(context)).toBe(false);
    const contextReferences = `${core.getAttribute('aria-labelledby') ?? ''} ${core.getAttribute('aria-describedby') ?? ''}`.trim().split(/\s+/);
    expect(contextReferences).toContain(context.id);
    expect(core.getAttribute('aria-label')?.trim() || core.getAttribute('aria-labelledby')?.trim()).toBeTruthy();
    if (core.hasAttribute('aria-labelledby')) labelledBy(core);
    for (const id of ['location-trigger', 'edit-selected-event', 'tools-toggle']) {
      const action = button(id);
      expect(element('workspace-dock').contains(action)).toBe(true);
      expect(footer.contains(action)).toBe(false);
      expect(core.contains(action)).toBe(false);
    }
    expect(entry.contains(element('write-tools'))).toBe(true);
    for (const id of ['drag-pitch', 'selection-done']) {
      expect(core.contains(button(id))).toBe(true);
    }
    for (const id of ['select-mode', 'toggle-entry']) {
      expect(element('workspace-mode-slot').contains(button(id))).toBe(true);
      expect(core.contains(button(id))).toBe(false);
    }
    expect(button('toggle-entry').hidden).toBe(false);
    expect(button('resume-entry').hidden).toBe(true);
    expect(element('location-panel').contains(button('resume-entry'))).toBe(true);
    expect(shell.getElementById('selection-resume')).toBeNull();
    const more = button('edit-selected-event');
    expect(element('palette-more-slot').contains(more)).toBe(true);
    expect(more.hasAttribute('popovertarget')).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    const prepare = button('selection-prepare-drag');
    expect(element('selection-inspector').contains(prepare)).toBe(true);
    expect(prepare.hasAttribute('popovertarget')).toBe(false);
  });

  it('uses native Value, Pitch, and Shared choosers with local error and close actions', () => {
    for (const kind of ['value', 'pitch', 'shared']) {
      const popup = element(`selection-${kind}-chooser`);
      const trigger = button(`selection-${kind}`);
      const close = button(`close-selection-${kind}`);
      const error = element(`selection-${kind}-error`);
      expect(element('selection-controls').contains(trigger)).toBe(true);
      expect(trigger.getAttribute('popovertarget')).toBe(popup.id);
      expect(popup.getAttribute('popover')).toBe('auto');
      expect(popup.getAttribute('role')).toBe('dialog');
      expect(popup.getAttribute('aria-modal')).not.toBe('true');
      expect(popup.classList.contains('surface-popover')).toBe(true);
      expect(popup.closest('.nonprinting')).not.toBeNull();
      expect(element('workspace-dock').contains(popup)).toBe(false);
      expect(labelledBy(popup).some(label => popup.contains(label) && /^H[1-6]$/.test(label.tagName))).toBe(true);
      expect(popup.contains(close)).toBe(true);
      expect(close.getAttribute('popovertarget')).toBe(popup.id);
      expect(close.getAttribute('popovertargetaction')).toBe('hide');
      expect(error.closest('[popover]')).toBe(popup);
      const body = popup.querySelector('.popover-body');
      expect(body).not.toBeNull();
      expect(body!.contains(error)).toBe(true);
      expect(body!.contains(close)).toBe(false);
      for (const field of popup.querySelectorAll('input, select, textarea')) {
        expect(body!.contains(field), `#${field.id} belongs in the chooser's scroll body`).toBe(true);
      }
      expect(popup.querySelector('input[id^="event-"], select[id^="event-"], #insert-event')).toBeNull();
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.getAttribute('tabindex')).toBe('-1');
      expect(error.hidden).toBe(true);
      expect(element('workspace-notices').contains(error)).toBe(false);
    }
  });

  it('authors named exclusive shortcut groups without inventing a selected accidental or road direction', () => {
    const core = element('selection-controls');
    expect(core.getAttribute('data-selection-state')).toBe('none');
    for (const [id, choices] of [
      ['selection-road-directions', ['selection-higher', 'selection-same', 'selection-lower']],
    ] as const) {
      const group = element(id);
      expect(core.contains(group)).toBe(true);
      expect(group.getAttribute('role')).toBe('radiogroup');
      expect(group.getAttribute('aria-label')?.trim() || group.getAttribute('aria-labelledby')?.trim()).toBeTruthy();
      expect(group.hidden).toBe(true);
      for (const choice of choices) {
        const radio = button(choice);
        expect(group.contains(radio)).toBe(true);
        expect(radio.getAttribute('role')).toBe('radio');
        expect(radio.getAttribute('aria-checked')).toBe('false');
        expect(radio.getAttribute('tabindex')).toBe('-1');
      }
    }
    const accidentals = element('selection-accidentals');
    expect(accidentals.localName).toBe('music-toggle-button-group');
    expect(accidentals.getAttribute('label')).toBe('Accidentals');
    expect(accidentals.getAttribute('overflow-at')).toBe('3');
    // The controller, not markup alone, must supply toolbar arrow/Space
    // behavior and its roving tab stop after a real selection.
  });

  it('offers direct native accidental buttons inside Pitch before the complete alteration choice', () => {
    const panel = element('selection-pitch-chooser');
    const group = element('selection-chooser-accidentals');
    const alteration = element('selection-alteration');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toMatch(/absolute.*accidental/i);
    expect(group.hidden).toBe(true);
    expect(group.closest('.popover-body')).toBe(panel.querySelector('.popover-body'));
    expect(group.closest('[popover]')).toBe(panel);
    expect(Boolean(group.compareDocumentPosition(alteration) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(element('pointer-tools').contains(group)).toBe(false);
    expect(element('entry-toolbar').contains(group)).toBe(false);
    const buttons = ['selection-chooser-flat', 'selection-chooser-natural', 'selection-chooser-sharp'].map(button);
    expect([...group.querySelectorAll('button')]).toEqual(buttons);
    for (const action of buttons) {
      expect(action.getAttribute('aria-pressed')).toBe('false');
      expect(action.getAttribute('role')).toBeNull();
      expect(action.hasAttribute('popovertarget')).toBe(false);
      expect(action.textContent?.trim()).toBeTruthy();
    }
    expect([...((alteration as HTMLSelectElement).options)].map(option => option.getAttribute('value'))).toEqual([
      '', '-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2',
    ]);
  });

  it('reserves the retained nominal duration and dots for an initially hidden open-slash fieldset', () => {
    const span = element('selected-nominal-span');
    const details = element('event-details');
    const compatibility = element('selected-common-compat');
    expect(span.tagName).toBe('FIELDSET');
    expect(span.hidden).toBe(true);
    expect(span.closest('details')).toBe(details);
    expect(details.hasAttribute('open')).toBe(false);
    expect(compatibility.contains(span)).toBe(false);
    expect(span.querySelector(':scope > legend')?.textContent?.trim()).toBe('Nominal span (open slash)');
    const help = element('selected-nominal-help');
    expect(span.contains(help)).toBe(true);
    expect(help.textContent?.trim()).toBeTruthy();
    for (const [id, name] of [['selected-duration', 'Nominal value'], ['selected-dots', 'Nominal dots']]) {
      const select = element(id);
      expect(select.tagName).toBe('SELECT');
      expect(select.closest('fieldset')).toBe(span);
      expect(select.closest('[hidden]')).toBe(span);
      expect(compatibility.contains(select)).toBe(false);
      expect(select.getAttribute('aria-describedby')?.split(/\s+/)).toContain(help.id);
      const label = span.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      expect(label).not.toBeNull();
      const caption = label!.cloneNode(true) as HTMLElement;
      caption.querySelectorAll('select').forEach(control => control.remove());
      expect(caption.textContent?.trim()).toBe(name);
    }
    expect([...span.querySelectorAll('select')].map(select => select.id)).toEqual(['selected-duration', 'selected-dots']);
    expect(span.contains(button('update-event'))).toBe(false);
    expect(details.contains(button('update-event'))).toBe(true);
    // Showing this fieldset only for a held/draft open slash is a forms-state
    // contract. Static markup must not expose it as ordinary note correction.
  });

  it('keeps Select more in Location and compound pitch editing with the held Properties target', () => {
    const selecting = button('selection-select-more');
    const properties = element('selection-inspector');
    expect(element('location-panel').contains(selecting)).toBe(true);
    expect(selecting.getAttribute('aria-describedby')?.split(/\s+/)).toContain('selection-context');
    expect(properties.contains(selecting)).toBe(false);
    expect(element('selection-shared-chooser').contains(selecting)).toBe(false);
    expect(properties.contains(element('properties-pitch'))).toBe(true);
    expect(properties.contains(button('selection-prepare-drag'))).toBe(true);
    // Direction/slash compatibility remains hidden; nominal duration and dots
    // have a separate, explicitly named open-slash task tested above.
    for (const id of ['selected-direction', 'selected-rhythmic']) {
      const hiddenOwner = element(id).closest('[hidden]');
      expect(hiddenOwner, `#${id} is a compatibility field`).not.toBeNull();
      expect(properties.contains(hiddenOwner), `#${id} must stay hidden when Properties opens`).toBe(true);
      expect(hiddenOwner).not.toBe(properties);
      expect(element('selected-common-compat').contains(element(id))).toBe(true);
    }
    // A popover's actual open state is native runtime behavior, not the
    // dialog-only `open` attribute. The unused fixture is explicitly hidden
    // so ignoring the popover attribute cannot expose it in the fallback.
    expect(element('note-editor').hidden).toBe(true);
    expect(shell.querySelector('button[popovertarget="note-editor"]:not([popovertargetaction="hide"])')).toBeNull();
  });

  it('keeps complete selection vocabularies and explicit Mixed values separate from the insertion recipe', () => {
    const durations = ['breve', 'whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second', 'sixty-fourth', '128th'];
    const alterations = ['-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2'];
    const choices: [string, string, string[]][] = [
      ['selection-duration', 'value', durations], ['selection-dots', 'value', ['0', '1', '2', '3']],
      ['selection-alteration', 'pitch', alterations], ['selection-direction', 'pitch', ['higher', 'same', 'lower']],
      ['selection-shared-duration', 'shared', durations], ['selection-shared-dots', 'shared', ['0', '1', '2', '3']],
      ['selection-shared-alteration', 'shared', alterations], ['selection-stem', 'shared', ['auto', 'up', 'down']],
      ['selection-accidental-display', 'shared', ['auto', 'always', 'courtesy']],
    ];
    for (const [id, kind, values] of choices) {
      const select = element(id) as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect(select.closest('[popover]')).toBe(element(`selection-${kind}-chooser`));
      expect(element('write-tools').contains(select)).toBe(false);
      expect([...select.options].map(option => option.getAttribute('value')).sort()).toEqual(['', ...values].sort());
      expect([...select.options].find(option => option.getAttribute('value') === '')?.textContent?.trim()).toBe('Mixed');
    }
    for (const property of ['alteration', 'direction']) {
      expect(element(`selection-${property}-field`).contains(element(`selection-${property}`))).toBe(true);
    }
    const shared = element('selection-shared-chooser');
    expect(shared.contains(element('selection-articulation'))).toBe(true);
    for (const id of ['selection-add-articulation', 'selection-remove-articulation']) {
      const action = button(id);
      expect(shared.contains(action)).toBe(true);
      expect(action.hasAttribute('popovertarget')).toBe(false);
    }
  });

  it('keeps attached marks prominent while typed event details remain one explicitly staged task', () => {
    const properties = element('selection-inspector');
    const marks = element('event-markings-editor');
    const details = element('event-details');
    const engraving = element('event-engraving');
    expect(properties.contains(marks)).toBe(true);
    expect(marks.closest('details')).toBeNull();
    expect(details.tagName).toBe('DETAILS');
    expect(details.hasAttribute('open')).toBe(false);
    expect(engraving.tagName).toBe('DETAILS');
    expect(Boolean(marks.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(marks.compareDocumentPosition(engraving) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    for (const id of ['selected-kind', 'selected-pitch', 'selected-pitches', 'update-event']) {
      expect(details.contains(element(id))).toBe(true);
    }
    for (const id of ['add-event-articulation', 'add-event-ornament', 'add-event-interval', 'apply-event-markings']) {
      expect(marks.contains(button(id))).toBe(true);
    }
    for (const id of ['properties-pitch', 'selection-prepare-drag']) {
      expect(button(id).closest('details')).toBeNull();
    }
  });

  it('keeps tool visibility independent from native transient popovers', () => {
    const pane = element('workspace-tools');
    const toggle = button('tools-toggle');
    expect(pane.hidden).toBe(true);
    expect(pane.hasAttribute('popover')).toBe(false);
    expect(pane.closest('.nonprinting')).not.toBeNull();
    expect(toggle.getAttribute('aria-controls')).toBe(pane.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('popovertarget')).toBe(false);
    for (const id of ['tools-hide', 'tools-expand']) {
      const action = button(id);
      expect(pane.contains(action)).toBe(true);
      expect(action.hasAttribute('popovertarget')).toBe(false);
    }
  });

  it('keeps occasional source, location, entry, and setup forms in named native popovers', () => {
    const expected = ['document-menu', 'note-editor', 'source-panel', 'location-panel', 'entry-settings', 'entry-value-chooser', 'score-setup', 'workspace-review'];
    const popups = [...shell.querySelectorAll<HTMLElement>('[popover]')];
    for (const id of expected) expect(popups).toContain(element(id));
    for (const popup of popups) {
      const id = popup.id;
      expect(id).not.toBe('');
      expect(element('workspace-dock').contains(popup)).toBe(false);
      expect(popup.getAttribute('popover')).toBe('auto');
      expect(popup.hasAttribute('hidden')).toBe(id === 'note-editor');
      expect(popup.tagName).not.toBe('DETAILS');
      expect(popup.closest('.nonprinting')).not.toBeNull();
      expect(labelledBy(popup).some(label => /^H[1-6]$/.test(label.tagName) && popup.contains(label))).toBe(true);
      const close = popup.querySelector<HTMLButtonElement>(`button[popovertarget="${id}"][popovertargetaction="hide"]`);
      expect(close, `#${id} needs a native close action`).not.toBeNull();
      expect(close!.getAttribute('type')).toBe('button');
      const openers = [...shell.querySelectorAll<HTMLButtonElement>(`button[popovertarget="${id}"]`)]
        .filter(candidate => candidate.getAttribute('popovertargetaction') !== 'hide');
      // Guarded confirmations have no fabricated invoker. The closed legacy
      // note editor remains a compatibility fixture; More opens Properties.
      // Ordinary task choosers retain real native invokers.
      if (!['continuation-review', 'pointer-recovery', 'note-editor'].includes(id)) {
        expect(openers.length, `#${id} needs a native invoker`).toBeGreaterThan(0);
      }
      expect(openers.every(candidate => candidate.getAttribute('type') === 'button')).toBe(true);
      expect(popup.querySelectorAll('[role="menu"], [role="menuitem"], [role="combobox"], [role="listbox"]')).toHaveLength(0);
    }
    expect(element('score-setup').contains(element('staff-inspector'))).toBe(true);
  });

  it('keeps Source validation beside the draft inside its own scrolling popover body', () => {
    const panel = element('source-panel');
    const input = element('source-input');
    const error = element('source-error');
    const status = element('source-status');
    const body = [...composedAncestors(input)].find(element => element.matches('.popover-body'));
    expect(input.tagName).toBe('TEXTAREA');
    expect(body).toBeDefined();
    expect(panel.contains(body!)).toBe(true);
    expect([...composedAncestors(error)].find(element => element.matches('.popover-body'))).toBe(body);
    expect([...composedAncestors(error)].find(element => element.hasAttribute('popover'))).toBe(panel);
    expect(input.getRootNode()).toBe(element('source-editor').shadowRoot);
    expect(error.getRootNode()).toBe(input.getRootNode());
    expect(input.nextElementSibling).toBe(error);
    expect(error.nextElementSibling).toBe(status);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('tabindex')).toBe('-1');
    expect(error.hidden).toBe(true);
    expect(status.getAttribute('role')).toBe('status');
    expect(input.getAttribute('aria-describedby')?.trim().split(/\s+/)).toEqual(['source-status', 'source-error']);
    expect(element('workspace-notices').contains(error)).toBe(false);
    expect(element('workspace-review').contains(error)).toBe(false);
    expect(error.closest('dialog')).toBeNull();
  });

  it('separates insertion presets from selected-property and relationship controls', () => {
    const panel = element('selection-inspector');
    for (const suffix of ['kind', 'pitch', 'pitches', 'duration', 'dots', 'rhythmic', 'measure-rest', 'accidental-display', 'stem', 'beam']) {
      const selected = element(`selected-${suffix}`);
      const insertion = element(`event-${suffix}`);
      const owner = suffix === 'beam' ? element('passage-inspector') : panel;
      expect(selected).not.toBe(insertion);
      expect(owner.contains(selected), `#selected-${suffix} belongs to #${owner.id}`).toBe(true);
      expect(owner.contains(insertion), `#event-${suffix} remains an insertion preset`).toBe(false);
      expect(selected.matches('input, select')).toBe(true);
      expect(insertion.matches('input, select')).toBe(true);
    }
    expect(panel.contains(button('update-event'))).toBe(true);
    expect(panel.contains(button('insert-event'))).toBe(false);
  });

  it('offers the same supported event kinds for insertion and explicit conversion', () => {
    for (const id of ['event-kind', 'selected-kind']) {
      const select = element(id) as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect([...select.options].map(option => option.value).sort()).toEqual(['chord', 'note', 'rest', 'rhythm', 'rhythmic-slash', 'road', 'slash']);
    }
  });

  it('keeps draft feedback in its working surface and recovery actions conditional', () => {
    const contexts = [
      ['selected', 'selection-inspector'], ['measure', 'measure-inspector'],
      ['annotation', 'annotation-inspector'], ['tuplet', 'tuplet-inspector'],
      ['staff', 'staff-inspector'], ['part', 'staff-inspector'],
      ['page', 'paper-inspector'], ['boundary', 'break-inspector'],
    ];
    for (const [kind, contextId] of contexts) {
      const status = element(`${kind}-draft-status`);
      const notice = status.closest('.draft-notice');
      expect(element(contextId).contains(status)).toBe(true);
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.hidden).toBe(false);
      expect(status.classList.contains('visually-hidden')).toBe(false);
      expect(notice).not.toBeNull();
      const discardId = kind === 'selected' ? 'load-event-values' : `discard-${kind}-draft`;
      for (const id of [discardId, `return-${kind}-draft`, `review-${kind}-draft`]) {
        const action = button(id);
        expect(notice!.contains(action), `#${id} should stay beside its draft status`).toBe(true);
        expect(action.hidden, `#${id} is for a dirty or conflicted draft`).toBe(true);
      }
    }
    expect(element('annotation-inspector').contains(element('annotation-draft-target'))).toBe(true);
    expect(element('annotation-draft-target').hidden).toBe(false);
  });

  it('makes selected-draft and range status messages explicit programmatic focus destinations', () => {
    const destinations = [
      ['selected-draft-status', 'selection-inspector'],
      ['range-status', 'passage-inspector'],
    ] as const;
    expect(destinations.map(([id]) => ({ id, tabindex: element(id).getAttribute('tabindex') }))).toEqual([
      { id: 'selected-draft-status', tabindex: '-1' },
      { id: 'range-status', tabindex: '-1' },
    ]);
    for (const [id, owner] of destinations) {
      const status = element(id);
      expect(status.tabIndex).toBe(-1);
      expect(status.getAttribute('role')).toBe('status');
      // role=status supplies polite announcements when aria-live is implicit.
      expect(status.getAttribute('aria-live') ?? 'polite').toBe('polite');
      expect(status.getAttribute('aria-hidden')).not.toBe('true');
      expect(status.hidden).toBe(false);
      expect(status.hasAttribute('autofocus')).toBe(false);
      expect(status.classList.contains('visually-hidden')).toBe(false);
      expect(status.closest('.nonprinting')).not.toBeNull();
      expect(element(owner).contains(status)).toBe(true);
    }
    // Actual focus and announcement after an intentional command are browser
    // responsibilities; tabindex=-1 alone does not establish that behavior.
  });

  it('keeps sustained marking actions together and tempo-only fields separate', () => {
    const panel = element('annotation-inspector');
    for (const id of ['add-annotation', 'add-annotation-next', 'update-annotation', 'update-annotation-next', 'new-annotation', 'remove-annotation', 'annotation-at-start', 'annotation-at-selection']) {
      expect(panel.contains(button(id))).toBe(true);
    }
    const tempo = element('annotation-tempo-fields');
    expect(panel.contains(tempo)).toBe(true);
    expect(tempo.hidden).toBe(true);
    for (const id of ['annotation-bpm', 'annotation-beat', 'annotation-dots']) {
      expect(tempo.contains(element(id))).toBe(true);
    }
    expect(tempo.contains(element('annotation-text'))).toBe(false);
    expect(element('location-panel').contains(button('add-chord-symbol'))).toBe(true);
  });

  it('authors every choice as a labelled customizable native select', () => {
    const selects = [...shell.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      const nativeButton = select.firstElementChild;
      expect(select.id).not.toBe('');
      expect(select.classList.contains('author-select')).toBe(true);
      expect(select.getAttribute('role')).toBeNull();
      expect(nativeButton?.tagName).toBe('BUTTON');
      expect(nativeButton?.getAttribute('type')).toBe('button');
      expect(nativeButton?.querySelectorAll('selectedcontent')).toHaveLength(1);
      expect(select.querySelectorAll(':scope > button')).toHaveLength(1);
      expect([...select.options].every(option => option.hasAttribute('value'))).toBe(true);
      expect(shell.querySelector(`label[for="${select.id}"]`), `#${select.id} needs its native label`).not.toBeNull();
      expect(select.multiple).toBe(false);
      expect(Number(select.getAttribute('size') ?? 0)).toBeLessThanOrEqual(1);
      expect(select.hasAttribute('aria-expanded')).toBe(false);
    }
  });

  it('keeps stable unique IDs and explicit non-submitting button semantics', () => {
    const ids = [...shell.querySelectorAll('[id]')].map(node => node.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const buttons = [...shell.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every(candidate => candidate.getAttribute('type') === 'button')).toBe(true);
    expect(shell.querySelectorAll('[role="combobox"], [role="menu"], [role="menuitem"]')).toHaveLength(0);
    for (const trigger of shell.querySelectorAll('[popovertarget]')) {
      expect(shell.getElementById(trigger.getAttribute('popovertarget')!)?.hasAttribute('popover')).toBe(true);
    }
    expect(element('skip-to-score').getAttribute('href')).toBe('#score-editor');
  });

  it('preserves label and description references when fields move between surfaces', () => {
    for (const label of shell.querySelectorAll('label[for]')) {
      const id = label.getAttribute('for')!;
      expect(shell.getElementById(id), `Label references missing field #${id}`).not.toBeNull();
    }
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const control of shell.querySelectorAll(`[${attribute}]`)) {
        const ids = control.getAttribute(attribute)!.trim().split(/\s+/);
        for (const id of ids) {
          expect(shell.getElementById(id), `#${control.id} has a broken ${attribute} reference to #${id}`).not.toBeNull();
        }
      }
    }
  });

  it('keeps complete warning details independent of Properties without duplicating live announcements', () => {
    const pane = element('workspace-tools');
    const review = element('workspace-review');
    for (const id of ['source-draft-notice', 'inspector-draft-status', 'workspace-review-summary', 'author-status']) {
      const notice = element(id);
      expect(notice.hasAttribute('role')).toBe(false);
      expect(notice.hasAttribute('aria-live')).toBe(false);
      expect(notice.closest('.nonprinting')).not.toBeNull();
      expect(notice.closest('[popover]')).toBe(review);
      expect(pane.contains(notice)).toBe(false);
    }
    expect(element('workspace-feedback-label').closest('[popover]')).toBeNull();
    expect(pane.contains(element('workspace-feedback-label'))).toBe(false);
  });

  it('keeps variable global status details out of the workbench flow and the compact dock', () => {
    const status = element('author-status');
    const workbench = element('author-workbench');
    expect(status.hasAttribute('role')).toBe(false);
    expect(status.closest('.nonprinting')).not.toBeNull();
    expect(workbench.contains(status)).toBe(false);
    expect(status.closest('[popover]')).toBe(element('workspace-review'));
    expect(element('workspace-feedback-label').closest('.document-subline')).toBe(element('save-status').closest('.document-subline'));
    // Actual bottom-edge stability remains a geometry gate. Detailed messages
    // live in Review rather than reserving a variable workspace track.
  });

  it('pairs a permanent header Review slot with full warning details, errors, and recovery actions', () => {
    const notices = element('workspace-notices');
    const summaries = notices.querySelectorAll('.workspace-notice-summary');
    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    for (const id of ['source-draft-notice', 'inspector-draft-status', 'workspace-review-summary']) {
      expect(summary.contains(element(id))).toBe(true);
    }
    const trigger = button('workspace-review-trigger');
    expect(summary.parentElement).toBe(notices);
    expect(trigger.parentElement).toBe(element('workspace-review-slot'));
    expect(trigger.closest('.history-actions')).toBe(button('undo').closest('.history-actions'));
    const review = element('workspace-review');
    expect(notices.closest('[popover]')).toBe(review);
    expect(trigger.getAttribute('popovertarget')).toBe(review.id);
    expect(review.getAttribute('popover')).toBe('auto');
    const close = button('close-workspace-review');
    expect(review.contains(close)).toBe(true);
    expect(close.getAttribute('popovertarget')).toBe(review.id);
    expect(close.getAttribute('popovertargetaction')).toBe('hide');
    const errors = element('author-errors');
    expect(errors.closest('[popover]')).toBe(review);
    expect(errors.hasAttribute('role')).toBe(false);
    expect(errors.hasAttribute('aria-live')).toBe(false);
    expect(errors.getAttribute('tabindex')).toBe('0');
    expect(errors.getAttribute('aria-label')).toBeTruthy();
    expect(notices.contains(errors)).toBe(false);
    expect(review.contains(button('review-source'))).toBe(true);
    expect(button('review-source').getAttribute('popovertarget')).toBe('source-panel');
    expect(review.contains(button('review-drafts'))).toBe(true);
  });

  it('uses a named native confirmation dialog with explicit cancel and confirm actions', () => {
    const dialog = element('author-confirmation');
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.hasAttribute('popover')).toBe(false);
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.hasAttribute('hidden')).toBe(false);
    expect(dialog.closest('.nonprinting')).not.toBeNull();
    expect(labelledBy(dialog)).toContain(element('author-confirmation-title'));
    expect(dialog.contains(element('author-confirmation-title'))).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBe('author-confirmation-message');
    const body = dialog.querySelector('.confirmation-body');
    const actions = dialog.querySelector('.confirmation-actions');
    expect(body).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(body!.contains(element('author-confirmation-message'))).toBe(true);
    const status = element('author-confirmation-status');
    expect(body!.contains(status)).toBe(true);
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.hidden).toBe(true);
    for (const id of ['author-confirmation-cancel', 'author-confirmation-confirm']) {
      const action = button(id);
      expect(actions!.contains(action)).toBe(true);
      expect(body!.contains(action)).toBe(false);
      expect(action.hasAttribute('popovertarget')).toBe(false);
    }
    expect(dialog.querySelector('form')).toBeNull();
  });
});

describe('notation coverage shell contracts', () => {
  it('offers all nine absolute alterations through a labelled native entry choice', () => {
    const panel = element('entry-settings');
    const field = element('event-alteration-field');
    const select = element('event-alteration') as HTMLSelectElement;
    expect(field.tagName).toBe('LABEL');
    expect(field.getAttribute('for')).toBe(select.id);
    expect(panel.contains(field)).toBe(true);
    expect(field.contains(select)).toBe(true);
    expect(select.tagName).toBe('SELECT');
    expect(select.classList.contains('author-select')).toBe(true);
    expect(select.firstElementChild?.tagName).toBe('BUTTON');
    expect(select.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect([...select.options].map(option => option.getAttribute('value'))).toEqual([
      '-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2',
    ]);
    // The authored reset/default is the static contract; interactive selection
    // through a customizable select is covered separately in the browser.
    expect([...select.options].filter(option => option.hasAttribute('selected')).map(option => option.getAttribute('value'))).toEqual(['0']);
    const status = element('event-alteration-status');
    expect(panel.contains(status)).toBe(true);
    expect(status.getAttribute('role')).toBe('status');
    expect(select.getAttribute('aria-describedby')?.split(/\s+/)).toContain(status.id);
    expect(element('event-pitch').getAttribute('aria-describedby')?.split(/\s+/)).toContain(status.id);
  });

  it('keeps exact-recipe and natural-letter keyboard guidance available for every entry kind', () => {
    const help = element('entry-keyboard-help');
    expect(element('entry-settings').contains(help)).toBe(true);
    expect(help.hidden).toBe(false);
    expect(help.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect(help.closest('#pitch-field, #pitches-field, #event-alteration-field, #direction-field')).toBeNull();
    const guidance = help.textContent ?? '';
    expect(guidance).toMatch(/\bEnter\b/);
    expect(guidance).toMatch(/recipe/i);
    expect(guidance).toMatch(/exact|configured|current/i);
    expect(guidance).toMatch(/A\s*[–-]\s*G/);
    expect(guidance).toMatch(/natural/i);
  });

  it('keeps the existing road direction choice in complete entry options without duplicating it', () => {
    const field = element('direction-field');
    const select = element('event-direction') as HTMLSelectElement;
    expect(field.closest('#write-tools')).toBeNull();
    expect(field.closest('#entry-settings')).toBe(element('entry-settings'));
    expect(field.closest('#entry-toolbar')).toBeNull();
    expect(field.closest('#pointer-tools')).toBeNull();
    expect(field.getAttribute('for')).toBe(select.id);
    expect(field.contains(select)).toBe(true);
    expect([...select.options].map(option => option.getAttribute('value'))).toEqual(['higher', 'same', 'lower']);
    expect(shell.querySelectorAll('#direction-field')).toHaveLength(1);
    expect(shell.querySelectorAll('#event-direction')).toHaveLength(1);
    expect(shell.body.getAttribute('data-entry-kind')).toBe('note');
  });

  it('retains separate road, pitch, and written-value controls in the legacy note-editor fixture', () => {
    const editor = element('note-editor');
    const pitches = element('note-pitch-controls');
    const directionField = element('note-direction-field');
    const direction = element('note-direction') as HTMLSelectElement;
    const help = element('note-direction-help');
    expect(editor.contains(pitches)).toBe(true);
    for (const id of ['note-double-flat', 'note-flat', 'note-natural', 'note-sharp', 'note-double-sharp', 'note-microtone', 'note-accidental-help']) {
      expect(pitches.contains(element(id))).toBe(true);
    }
    expect(editor.contains(directionField)).toBe(true);
    expect(directionField.contains(direction)).toBe(true);
    expect(directionField.getAttribute('for')).toBe(direction.id);
    expect(direction.tagName).toBe('SELECT');
    expect([...direction.options].map(option => option.getAttribute('value'))).toEqual(['higher', 'same', 'lower']);
    expect(direction.getAttribute('aria-describedby')?.split(/\s+/)).toContain(help.id);
    expect(editor.contains(help)).toBe(true);
    expect(pitches.contains(directionField)).toBe(false);
    expect(pitches.contains(help)).toBe(false);
    for (const id of ['note-duration', 'note-dots']) {
      const value = element(id);
      expect(pitches.contains(value)).toBe(false);
      expect(Boolean(directionField.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(Boolean(value.compareDocumentPosition(pitches) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('retains ordinary legacy note-editor routes without adding general tool tabs', () => {
    const editor = element('note-editor');
    for (const id of ['note-attached-marks', 'note-advanced-edit']) {
      const route = button(id);
      expect(editor.contains(route)).toBe(true);
      expect(route.closest('.note-editor-routes')).not.toBeNull();
      expect(route.getAttribute('role')).toBeNull();
      expect(route.hasAttribute('popovertarget')).toBe(false);
      expect(route.closest('[role="tablist"]')).toBeNull();
      expect(route.textContent?.trim()).toBeTruthy();
    }
    expect(element('workspace-tools').querySelectorAll('[role="tab"]')).toHaveLength(tools.length);
  });

  it('makes complete-chain interval scope explicit without widening articulations or ornaments', () => {
    const editor = element('event-markings-editor');
    const options = element('event-markings-tie-options');
    const scope = element('event-markings-tie-scope') as HTMLInputElement;
    const help = element('event-markings-tie-help');
    expect(editor.contains(options)).toBe(true);
    expect(options.hidden).toBe(true);
    expect(options.contains(scope)).toBe(true);
    expect(options.contains(help)).toBe(true);
    expect(scope.tagName).toBe('INPUT');
    expect(scope.type).toBe('checkbox');
    expect(scope.checked).toBe(false);
    expect(scope.hasAttribute('checked')).toBe(false);
    expect(options.querySelector(`label[for="${scope.id}"]`)).not.toBeNull();
    expect(scope.getAttribute('aria-describedby')?.split(/\s+/)).toContain(help.id);
    const guidance = help.textContent ?? '';
    expect(guidance).toMatch(/interval/i);
    expect(guidance).toMatch(/whole|complete|entire/i);
    expect(guidance).toMatch(/chain|connected|tied sound/i);
    expect(guidance).toMatch(/articulation/i);
    expect(guidance).toMatch(/ornament/i);
    expect(guidance).toMatch(/segment|local/i);
  });

  it('keeps an explicit incompatible-mark recovery route in Workspace Review', () => {
    const route = button('review-incompatible-mark');
    expect(element('workspace-review').contains(route)).toBe(true);
    expect(route.hidden).toBe(true);
    expect(route.hasAttribute('popovertarget')).toBe(false);
    expect(route.textContent?.trim()).toBeTruthy();
  });

  it('documents quarter-tone spelling beside advanced pitch fields', () => {
    const help = element('selected-pitch-help');
    const guidance = help.textContent ?? '';
    for (const suffix of ['qf', 'qs']) expect(guidance).toMatch(new RegExp(`[A-G]${suffix}-?\\d+`));
    for (const suffix of ['tqf', 'tqs']) expect(guidance).toContain(suffix);
    for (const id of ['selected-pitch', 'selected-pitches']) {
      expect(element(id).getAttribute('aria-describedby')?.split(/\s+/)).toContain(help.id);
    }
  });

  it('explains a prescribed-rhythm conversion path and deliberate incompatible-mark removal', () => {
    const staffHelp = element('staff-notation-help');
    const conversionHelp = element('conversion-help');
    expect(element('score-setup').contains(staffHelp)).toBe(true);
    expect(element('passage-inspector').contains(conversionHelp)).toBe(true);
    for (const help of [staffHelp, conversionHelp]) {
      const guidance = help.textContent ?? '';
      expect(guidance).toMatch(/rhythmic slash/i);
      expect(guidance).toMatch(/mark/i);
      expect(guidance).toMatch(/remov/i);
      expect(guidance).not.toMatch(/(?:change|replace|convert)[^.]*\bto rests\b/i);
    }
    expect(conversionHelp.textContent).toMatch(/open/i);
    expect(conversionHelp.textContent).toMatch(/prescribed|written|exact|fixed/i);
    expect(staffHelp.textContent).toMatch(/direction/i);
  });
});

describe('stable writing palette CSS contract', () => {
  it('declares inherited semantic author tokens rather than only a generic accent color', () => {
    const root = rulesFor(':root')[0] ?? '';
    for (const name of ['paper', 'ink', 'chrome', 'surface', 'control-ink', 'muted', 'border', 'selection', 'selection-fill', 'insertion', 'insertion-fill', 'focus', 'error', 'error-surface', 'warning', 'warning-surface']) {
      expect(root, `Missing inherited --author-${name}`).toMatch(new RegExp(`--author-${name}:\\s*[^;]+;`));
    }
    const forcedColors = [...authorCss.matchAll(/@media\s*\(forced-colors:\s*active\)/g)]
      .map(match => blockFor(/@media\s*\(forced-colors:\s*active\)/, authorCss.slice(match.index)))
      .join('\n');
    const forcedRoot = declarationsFor(':root', forcedColors);
    for (const [name, color] of [
      ['paper', 'Canvas'], ['ink', 'CanvasText'], ['chrome', 'Canvas'], ['surface', 'Canvas'],
      ['control-ink', 'ButtonText'], ['muted', 'CanvasText'], ['border', 'ButtonText'],
      ['selection', 'Highlight'], ['selection-fill', 'transparent'], ['insertion', 'CanvasText'],
      ['insertion-fill', 'transparent'], ['focus', 'Highlight'], ['error', 'CanvasText'],
      ['error-surface', 'Canvas'], ['warning', 'CanvasText'], ['warning-surface', 'Canvas'],
    ]) expect(forcedRoot).toMatch(new RegExp(`--author-${name}:\\s*${color};`));
    for (const selector of ['#workspace-mode-slot > button[aria-pressed="true"]', '#palette-more-slot > button[aria-expanded="true"]', 'button[aria-pressed="true"]']) {
      expect(declarationsFor(selector, forcedColors)).toMatch(/outline:\s*2px\s+solid\s+Highlight;/);
    }
    // This is the outer stylesheet contract. Separate renderer tests and native
    // checks must establish inherited Shadow Root paint and measured contrast.
  });

  it('connects paper, chrome, controls, feedback, and score-frame focus to their semantic tokens', () => {
    const root = rulesFor(':root')[0] ?? '';
    expect(root).toMatch(/color:\s*var\(--author-ink\);/);
    expect(root).toMatch(/background:\s*var\(--author-chrome\);/);
    expect(root).toMatch(/--focus:\s*var\(--author-focus\);/);
    const frame = declarationsFor('::slotted([slot="score"])', workspaceCss);
    expect(frame).toMatch(/background:\s*var\(--author-paper,\s*#fff\);/);
    expect(frame).toMatch(/color:\s*var\(--author-ink,\s*#20252b\);/);
    expect(declarationsFor('#workspace-dock')).toMatch(/background:\s*var\(--paper\);/);
    expect(declarationsFor('.palette-slot > button')).toMatch(/color:\s*var\(--author-control-ink\);/);
    for (const kind of ['warning', 'error']) {
      expect(declarationsFor(`#workspace-feedback-label[data-feedback-kind="${kind}"]`)).toMatch(new RegExp(`color:\\s*var\\(--author-${kind}\\);`));
    }
    expect(declarationsFor('.score-editor:focus-visible')).toMatch(/outline-color:\s*var\(--(?:author-)?focus\);/);
  });

  it('does not hide either fixed mode choice when its mode becomes active or a pitch drag is prepared', () => {
    const modeRules = leafRules().filter(({ selector }) => (
      /data-entry-mode|data-selection-state|data-pointer-gesture/.test(selector)
      && /#workspace-mode-slot|#select-mode|#toggle-entry/.test(selector)
    ));
    for (const rule of modeRules) {
      expect(rule.declarations, rule.selector).not.toMatch(/(?:display:\s*none|visibility:\s*hidden)/);
    }
    const slot = declarationsFor('#workspace-mode-slot');
    expect(slot).toMatch(/display:\s*grid;/);
    expect(slot).toMatch(/grid-template-columns:\s*repeat\(2,\s*max-content\);/);
  });

  it('does not let selection rejection or gesture feedback cover or suppress the musical controls', () => {
    const target = /#selection-controls(?:\b|-dock)|#workspace-mode-slot|#palette-more-slot|#location-trigger|#workspace-dock/;
    for (const rule of leafRules()) {
      if (!/data-selection-feedback|data-pointer-feedback|data-pointer-gesture/.test(rule.selector) || !target.test(rule.selector)) continue;
      expect(rule.declarations, rule.selector).not.toMatch(/(?:display:\s*none|visibility:\s*hidden|opacity:\s*0(?:[;\s])|position:\s*absolute)/);
    }
    expect(rulesFor('#pointer-tools .selection-feedback')).toHaveLength(0);
    expect(rulesFor('body[data-selection-feedback="rejected"] #pointer-tools .selection-feedback')).toHaveLength(0);
  });

  it('binds the chosen writing-frame width independently from side or sheet presentation', () => {
    const frame = declarationsFor('::slotted([slot="score"])', workspaceCss);
    expect(frame).toMatch(/(?:width|inline-size):\s*var\(--writing-frame-width(?:,[^;]+)?\);/);
    expect(workspaceCss).toMatch(/--tools-pane-width:\s*320px;/);
    expect(workspaceCss).toMatch(/--writing-frame-gap:\s*16px;/);
    for (const presentation of ['closed', 'side', 'sheet']) {
      expect(workspaceCss).toContain(`[tools-presentation="${presentation}"]`);
    }
    for (const rule of leafRules()) {
      if (!/data-tools-(?:open|expanded|presentation)/.test(rule.selector)) continue;
      expect(rule.declarations, rule.selector).not.toMatch(/--writing-frame-width\s*:/);
      if (!/#score-editor|\.score-editor|#score-scroll|\.score-scroll/.test(rule.selector)) continue;
      expect(rule.declarations, rule.selector).not.toMatch(/(?:display:\s*none|(?:^|;)\s*(?:width|inline-size):\s*0(?:px)?;)/);
    }
  });
});

describe('score-first authoring CSS contract', () => {
  it('keeps score-region padding owned by the frame at every width and view', () => {
    expect(declarationsFor('::slotted([slot="score"])', workspaceCss)).toMatch(/padding:\s*0;/);
    // Normal document rules win over ::slotted declarations, regardless of
    // specificity. An old phone/read padding rule stole 26px from the score.
    for (const rule of leafRules()) {
      if (!/(?:#|\.)score-editor\b/.test(rule.selector)) continue;
      expect(rule.declarations, rule.selector).not.toMatch(/(?:^|;)\s*padding(?:-[\w-]+)?\s*:/);
    }
  });

  it('shares header spacing and full-size controls while allowing the palette to grow with text', () => {
    const dock = declarationsFor('#workspace-dock');
    expect(declarationsFor('::slotted([slot="palette"])', workspaceCss)).toMatch(/grid-area:\s*dock;/);
    expect(dock).toMatch(/display:\s*grid;/);
    expect(declarationsFor(':where(:root)', designTokensCss)).toMatch(/--music-ui-control-size:\s*max\(44px,\s*2\.75rem\);/);
    expect(declarationsFor(':where(:root)', designTokensCss)).toMatch(/--music-ui-group-padding:\s*2px;/);
    expect(declarationsFor('body:has(#author-workbench)')).toMatch(/--author-control-size:\s*var\(--music-ui-control-size\);/);
    expect(dock).toMatch(/--palette-control-size:\s*var\(--music-ui-control-size\);/);
    expect(dock).toMatch(/--palette-group-size:\s*calc\(var\(--palette-control-size\)\s*\+\s*2\s*\*\s*var\(--music-ui-group-padding\)\);/);
    expect(dock).toMatch(/grid-template-rows:\s*auto;/);
    expect(dock).toMatch(/grid-template-columns:\s*max-content\s+minmax\(max\(264px,\s*16\.5rem\),\s*1fr\)\s+max-content\s+max\(140px,\s*8\.75rem\);/);
    for (const selector of ['body:has(#author-workbench) .app-header', '#workspace-dock']) {
      const bar = declarationsFor(selector);
      expect(bar, selector).toMatch(/min-height:\s*60px;/);
      expect(bar, selector).toMatch(/padding:\s*6px\s+12px;/);
      expect(bar, selector).toMatch(/gap:\s*14px;/);
    }
    for (const rule of [declarationsFor('button', viewSwitchCss), declarationsFor('#workspace-mode-slot > button')]) {
      expect(rule).toMatch(/padding:\s*var\(--music-ui-control-padding-block(?:,\s*3px)?\)\s+var\(--music-ui-control-padding-inline(?:,\s*6px)?\);/);
    }
    for (const selector of ['body:has(#author-workbench) .header-actions button', '.palette-slot > button', '#palette-more-slot > button']) {
      expect(declarationsFor(selector), selector).toMatch(/padding:\s*7px\s+9px;/);
    }
    expect(dock).not.toMatch(/overflow:\s*hidden|text-overflow:\s*ellipsis/);
    // Native checks establish the shared desktop bars and the taller
    // phone/text layouts; stylesheet declarations alone do not establish fit.
  });

  it('places a side task after the independently chosen frame without adding a wrapping breakpoint', () => {
    const workbench = declarationsFor(':host', workspaceCss);
    expect(workbench).toMatch(/--tools-pane-width:\s*320px;/);
    expect(workbench).toMatch(/--writing-frame-gap:\s*16px;/);
    const side = declarationsFor(':host([tools-presentation="side"]) ::slotted([slot="tools"])', workspaceCss);
    expect(side).toMatch(/width:\s*var\(--tools-pane-width\);/);
    expect(side).toMatch(/margin-inline-start:\s*calc\(var\(--writing-frame-width\)\s*\+\s*var\(--writing-frame-gap\)\);/);
    expect(declarationsFor('::slotted([slot="tools"])', workspaceCss)).toMatch(/grid-area:\s*score;/);
    expect(declarationsFor('::slotted([slot="score"])', workspaceCss)).toMatch(/justify-self:\s*start;/);
    for (const { selector, declarations } of leafRules()) {
      if (!/data-tools-(?:open|expanded|presentation)/.test(selector)) continue;
      expect(declarations, selector).not.toMatch(/--writing-frame-width\s*:/);
      if (!/(?:\.author-workbench|#author-workbench|#workspace-dock)(?:\s*,|$)/.test(selector)) continue;
      expect(declarations, selector).not.toMatch(/grid-template-(?:columns|rows|areas)\s*:/);
    }
  });

  it('keeps the complete short-screen task scrollable without carving another track out of the score', () => {
    const shortHeader = /@media\s*\(max-height:\s*480px\)/g;
    const short = [...authorCss.matchAll(shortHeader)]
      .map(match => blockFor(/@media\s*\(max-height:\s*480px\)/, authorCss.slice(match.index)))
      .join('\n');
    expect(declarationsFor('.workspace-tools', short)).toMatch(/overflow:\s*auto;/);
    const body = declarationsFor('.tool-panel', short);
    expect(body).toMatch(/flex:\s*0\s+0\s+auto;/);
    expect(body).toMatch(/overflow:\s*visible;/);
    for (const rule of leafRules(short)) {
      if (!/(?:\.author-workbench|#author-workbench|#workspace-dock)(?:\s*,|$)/.test(rule.selector)) continue;
      expect(rule.declarations, rule.selector).not.toMatch(/grid-template-(?:rows|columns|areas)\s*:/);
    }
    // Releasing the task body keeps its own heading/actions reachable in a
    // short sheet. Actual scrolling and focus retention are native gates.
  });

  it('keeps the same score track mounted beneath a deliberate sheet and preserves each normal dock slot', () => {
    for (const selector of ['.score-scroll', 'body[data-view="read"] #score-scroll']) {
      expect(declarationsFor(selector)).toMatch(/grid-row:\s*1;/);
    }
    for (const selector of ['#entry-toolbar', '#author-workbench .pointer-tools']) {
      expect(declarationsFor(selector)).toMatch(/grid-area:\s*1\s*\/\s*1;/);
    }
    for (const [selector, column] of [
      ['#workspace-mode-slot', 1], ['#palette-musical-slots', 2],
      ['#palette-more-slot', 3], ['#workspace-dock > .location-trigger', 4],
    ] as const) {
      const normal = declarationsFor(selector);
      expect(normal, selector).toMatch(new RegExp(`grid-column:\\s*${column};`));
      expect(normal, selector).toMatch(/grid-row:\s*1;/);
    }
    expect(declarationsFor('::slotted([slot="score"])', workspaceCss)).toMatch(/grid-area:\s*score;/);
    expect(declarationsFor('::slotted([slot="palette"])', workspaceCss)).toMatch(/grid-area:\s*dock;/);
    const sheet = declarationsFor(':host([tools-presentation="sheet"]) ::slotted([slot="score"])', workspaceCss);
    expect(sheet).toMatch(/visibility:\s*hidden;/);
    expect(sheet).toMatch(/pointer-events:\s*none;/);
    expect(sheet).not.toMatch(/display:\s*none|(?:width|inline-size)\s*:/);
    const task = declarationsFor(':host([tools-presentation="sheet"]) ::slotted([slot="tools"])', workspaceCss);
    expect(task).toMatch(/width:\s*100%;/);
    expect(task).toMatch(/margin-inline-start:\s*0;/);
    expect(declarationsFor(':host([tools-presentation="closed"]) ::slotted([slot="tools"])', workspaceCss)).toMatch(/display:\s*none\s*!important;/);
    for (const id of ['entry-toolbar', 'workspace-dock', 'workspace-mode-slot', 'pointer-tools', 'palette-more-slot']) {
      for (const rule of rulesFor(`body[data-tools-presentation="sheet"] #${id}`)) {
        expect(rule).not.toMatch(/(?:display:\s*none|visibility:\s*hidden)/);
      }
    }
  });

  it('reserves a viewport workspace without putting tool forms above the notation', () => {
    const body = rulesFor('body:has(#author-workbench)')[0] ?? '';
    expect(body).toMatch(/height:\s*100vh;/);
    expect(body).toMatch(/height:\s*100dvh;/);
    expect(body).toMatch(/overflow:\s*hidden;/);
    for (const [selector, stylesheet] of [
      ['body:has(#author-workbench) .author-workspace', authorCss],
      [':host', workspaceCss], ['::slotted([slot="score"])', workspaceCss],
    ]) {
      const rule = rulesFor(selector, stylesheet)[0] ?? '';
      expect(rule, selector).toMatch(/min-height:\s*0;/);
      expect(rule, selector).toMatch(/overflow:\s*hidden;/);
    }
    expect(declarationsFor('::slotted([slot="score"])', workspaceCss)).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\);/);
    expect(declarationsFor(':host', workspaceCss)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(declarationsFor(':host', workspaceCss)).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;/);
    expect(declarationsFor(':host', workspaceCss)).toMatch(/grid-template-areas:\s*"score"\s+"dock";/);
    expect(declarationsFor(':host', workspaceCss)).toMatch(/gap:\s*0;/);
    expect(declarationsFor(':host', workspaceCss)).toMatch(/container:\s*author-workbench\s*\/\s*inline-size;/);
    expect(declarationsFor('*')).toMatch(/box-sizing:\s*border-box;/);
    expect(rulesFor('body:has(#author-workbench) .author-workspace')[0]).toMatch(/padding:\s*8px\s+0\s+0;/);
  });

  it('gives the score, Properties, and mounted tool panels separate default scroll regions', () => {
    const pane = element('workspace-tools');
    const header = pane.querySelector('.tools-header');
    expect(header).not.toBeNull();
    expect(pane.querySelector('.tools-footer')).not.toBeNull();
    expect(element('score-scroll').classList.contains('score-scroll')).toBe(true);
    for (const panelId of ['selection-inspector', ...tools.map(([, id]) => id)]) {
      const panel = element(panelId);
      expect(panel.classList.contains('tool-panel')).toBe(true);
      expect(panel.contains(header)).toBe(false);
      expect(panel.contains(element('tools-tablist'))).toBe(false);
      expect(panel.contains(button('tools-hide'))).toBe(false);
      expect(panel.contains(button('tools-expand'))).toBe(false);
    }
    for (const selector of ['.score-scroll', '.tool-panel']) {
      const rule = declarationsFor(selector);
      expect(rule, selector).toMatch(/min-height:\s*0;/);
      expect(rule, selector).toMatch(/overflow:\s*auto;/);
      expect(rule, selector).toMatch(/overscroll-behavior:\s*contain;/);
    }
    expect(declarationsFor('.workspace-tools')).toMatch(/overflow:\s*hidden;/);
    expect(declarationsFor('.tools-header')).toMatch(/flex:\s*none;/);
    expect(declarationsFor('.tools-tablist')).toMatch(/flex:\s*none;/);
    expect(declarationsFor('.tools-tablist')).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    expect(declarationsFor('.tools-footer')).toMatch(/flex:\s*none;/);
  });

  it('switches only the musical payload and More owner while suspending the whole palette outside Write', () => {
    const strip = element('pointer-tools');
    expect(element('entry-toolbar').querySelector('.entry-tools')).not.toBeNull();
    expect(strip.querySelector('.entry-tools')).toBeNull();
    expect(strip.contains(element('selection-controls'))).toBe(true);
    for (const selector of [
      'body:not([data-entry-mode="true"]) #entry-toolbar',
      'body[data-entry-mode="true"] #pointer-tools',
      'body:not([data-entry-mode="true"]) #palette-more-slot #tools-toggle',
      'body[data-entry-mode="true"] #palette-more-slot #edit-selected-event',
    ]) expect(declarationsFor(selector)).toMatch(/display:\s*none;/);
    for (const selector of [
      ':host(:not([mode="write"])) ::slotted([slot="palette"])',
      ':host(:not([mode="write"])) ::slotted([slot="tools"])',
      ':host([mode="pages"])',
    ]) expect(declarationsFor(selector, workspaceCss)).toMatch(/display:\s*none(?:\s*!important)?;/);
    for (const id of ['selection-context', 'selection-controls-context']) {
      expect(button('location-trigger').contains(element(id))).toBe(true);
      expect(element(id).classList.contains('visually-hidden')).toBe(true);
      expect(element(id).closest('[aria-hidden="true"]')).toBeNull();
    }
    expect(button('location-trigger').contains(element('palette-owner-label'))).toBe(true);
    expect(declarationsFor('::slotted([slot="score"])', workspaceCss)).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\);/);
    expect(declarationsFor(':host([mode="read"])', workspaceCss)).toMatch(/grid-template-areas:\s*"score";/);
  });

  it('stacks musical controls before the mode row when width or larger text prevents a single row', () => {
    const normal = declarationsFor('#workspace-dock');
    expect(normal).toMatch(/--palette-musical-columns:\s*repeat\(3,\s*minmax\(0,\s*max-content\)\);/);
    for (const selector of ['#entry-toolbar .entry-tools', '#selection-controls']) {
      const rule = declarationsFor(selector);
      expect(rule).toMatch(/display:\s*grid;/);
      expect(rule).toMatch(/gap:\s*8px;/);
    }
    expect(declarationsFor('#selection-controls')).toMatch(/grid-template-columns:\s*var\(--palette-musical-columns\);/);
    expect(declarationsFor('#entry-toolbar .entry-tools')).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*max-content\)\) minmax\(0,\s*1fr\);/);
    expect(element('write-tools').querySelector('[data-toggle-group-row]')?.children).toHaveLength(5);
    expect(declarationsFor('.entry-quick-tools')).toMatch(/display:\s*flex;/);
    expect(declarationsFor('.palette-slot')).toMatch(/grid-template-rows:\s*var\(--palette-group-size\);/);
    expect(declarationsFor('.popover-body :is(input:not([type="checkbox"]), select), .popover-body > button')).toMatch(/min-height:\s*44px;/);
    const narrow = blockFor(/@container\s+author-workbench\s*\(width\s*<\s*1100px\)\s*or\s*\(width\s*<\s*68\.75rem\)/);
    const fallback = declarationsFor('#workspace-dock', narrow);
    expect(fallback).toMatch(/display:\s*flex;/);
    expect(fallback).toMatch(/flex-wrap:\s*wrap;/);
    expect(fallback).not.toMatch(/--palette-control-size\s*:/);
    expect(declarationsFor('#workspace-dock #selection-compact-context', narrow)).toMatch(/white-space:\s*normal;/);
    for (const [selector, order, flex] of [
      ['#palette-musical-slots', -1, /flex:\s*1\s+0\s+100%;/],
      ['#workspace-mode-slot', 0, /flex:\s*0\s+0\s+auto;/],
      ['#workspace-dock > .location-trigger', 1, /flex:\s*1\s+1\s+max\(80px,\s*5rem\);/],
      ['#palette-more-slot', 2, /flex:\s*0\s+0\s+auto;/],
    ] as const) {
      const rule = declarationsFor(selector);
      expect(rule, selector).toMatch(new RegExp(`order:\\s*${order};`));
      expect(rule, selector).toMatch(flex);
    }
    expect(narrow).not.toMatch(/data-entry-mode|data-selection-state/);
    expect(narrow).not.toMatch(/text-overflow:\s*ellipsis|overflow:\s*hidden/);
    const unsupported = blockFor(/@supports\s+not\s*\(container-type:\s*inline-size\)/);
    const viewportFallback = blockFor(/@media\s*\(max-width:\s*1100px\)\s*,\s*\(max-width:\s*68\.75rem\)/, unsupported);
    expect(declarationsFor('#workspace-dock', viewportFallback)).toMatch(/display:\s*flex;/);
    expect(declarationsFor('#workspace-dock', viewportFallback)).toMatch(/flex-wrap:\s*wrap;/);
    expect(declarationsFor('#workspace-dock #selection-compact-context', viewportFallback)).toMatch(/white-space:\s*normal;/);
    expect(unsupported).not.toMatch(/selection-direct-choices|selection-slot-1/);
    expect(element('workspace-dock').querySelector('select, input, textarea')).toBeNull();
    // The width/rem conditions and wrap contract are static declarations.
    // Their fit under actual zoom and text settings remains a native check.
  });

  it('gives Select and Write the same responsive quick-control allocation beside their own actions', () => {
    const desktop = blockFor(/@container\s+author-workbench\s*\(width\s*>=\s*1100px\)\s*and\s*\(width\s*>=\s*68\.75rem\)/);
    expect(declarationsFor('#selection-controls', desktop)).toBe(declarationsFor('#entry-toolbar .entry-tools', desktop));
    expect(declarationsFor('.selection-quick-tools', desktop)).toMatch(/grid-column:\s*auto;/);
    expect(element('selection-slot-1').contains(button('selection-pitch'))).toBe(true);
    expect(button('selection-pitch').getAttribute('popovertarget')).toBe('selection-pitch-chooser');
    for (const id of ['selection-accidentals','selection-quick-duration','selection-quick-dots','selection-quick-attack']) {
      expect(element('selection-quick-tools').contains(element(id))).toBe(true);
      expect(element(id).localName).toBe('music-toggle-button-group');
    }
  });

  it('retains full touch height for legacy note-editor direction and route controls', () => {
    expect(declarationsFor('#note-direction')).toMatch(/min-height:\s*44px;/);
    const routes = declarationsFor('.note-editor-routes button');
    expect(routes).toMatch(/min-width:\s*44px;/);
    expect(routes).toMatch(/min-height:\s*44px;/);
  });

  it('retains native-only sticky identity inside the legacy note-editor body without another header row', () => {
    const editor = element('note-editor');
    const body = editor.querySelector('.note-editor-body');
    const context = element('note-editor-context');
    expect(body).not.toBeNull();
    expect(context.closest('.note-editor-body')).toBe(body);
    expect(body!.firstElementChild).toBe(context);
    expect(context.closest('.note-editor-heading, .note-editor-footer')).toBeNull();
    // Only the native open popover has a bounded body. Its ordinary in-flow
    // fallback must not pin this identity to the document viewport.
    const nativeContext = '.note-editor:popover-open .note-editor-context';
    const rule = declarationsFor(nativeContext);
    expect(rule).toMatch(/position:\s*sticky;/);
    expect(rule).toMatch(/top:\s*0(?:px)?;/);
    expect(rule).toMatch(/background(?:-color)?:\s*var\(--paper\);/);
    const layer = rule.match(/z-index:\s*([1-9]\d*)\s*;/);
    expect(layer, 'The identity needs a positive layer above scrolling controls').not.toBeNull();
    const unpinned = declarationsFor(`${nativeContext}[data-context-pinned="false"]`);
    expect(unpinned).toMatch(/position:\s*static;/);
    const fallback = declarationsFor('.note-editor-context');
    expect(fallback).not.toMatch(/position:\s*sticky;/);
    for (const contextStyle of [rule, unpinned, fallback]) {
      expect(contextStyle).not.toMatch(/text-overflow:\s*ellipsis/);
      expect(contextStyle).not.toMatch(/max-(?:height|block-size)\s*:/);
      expect(contextStyle).not.toMatch(/overflow(?:-[xy]|-block|-inline)?:\s*(?:auto|scroll)/);
    }
  });

  it('reserves each musical slot and keeps all palette actions on the shared 44px minimum', () => {
    const strip = declarationsFor('#author-workbench .pointer-tools');
    expect(strip).toMatch(/display:\s*block;/);
    expect(strip).toMatch(/position:\s*static;/);
    expect(strip).toMatch(/height:\s*auto;/);
    const dock = declarationsFor('#selection-controls-dock');
    expect(dock).toMatch(/position:\s*relative;/);
    expect(dock).toMatch(/width:\s*100%;/);
    expect(dock).toMatch(/min-width:\s*0;/);
    for (const rule of [dock, declarationsFor('#selection-controls')]) {
      expect(rule).toMatch(/height:\s*auto;/);
      expect(rule).toMatch(/min-height:\s*var\(--palette-group-size\);/);
    }
    expect(declarationsFor('#selection-controls')).toMatch(/display:\s*grid;/);
    for (const selector of ['.palette-slot > button', '#workspace-dock > .location-trigger', '#workspace-mode-slot > button', '#palette-more-slot > button', '.selection-shortcuts > button', '#entry-slot-action #drag-entry', '#selection-slot-3 #drag-pitch']) {
      const rule = declarationsFor(selector);
      expect(rule, selector).toMatch(/height:\s*var\(--palette-control-size\);/);
      expect(rule, selector).toMatch(/min-height:\s*var\(--palette-control-size\);/);
      const widths = [...rule.matchAll(/min-width:\s*([^;]+);/g)];
      expect(widths.length, selector).toBeGreaterThan(0);
      for (const [, width] of widths) {
        // The shared token and its palette aliases retain the checked 44px
        // floor while growing with root text size.
        if (/^var\(--(?:music-ui|author|palette)-control-size\)$/.test(width.trim())) continue;
        expect(width, selector).toMatch(/^\d+px$/);
        expect(Number.parseFloat(width), selector).toBeGreaterThanOrEqual(44);
      }
      expect(rule, selector).not.toMatch(/text-overflow:\s*ellipsis|line-clamp\s*:/);
    }
    for (const { declarations } of leafRules()) {
      for (const [, value] of declarations.matchAll(/--palette-control-size:\s*([^;]+)/g)) {
        expect(value.trim()).toBe('var(--music-ui-control-size)');
      }
    }
  });

  it('keeps the mode labels readable and missing-bookmark guidance outside their fixed footprint', () => {
    const entry = declarationsFor('#workspace-mode-slot > button');
    expect(entry).toMatch(/white-space:\s*nowrap;/);
    expect(entry).toMatch(/min-width:\s*var\(--music-ui-control-size\);/);
    for (const selector of ['#workspace-mode-slot > button', '#entry-mode-reason', '#entry-mode-label']) {
      for (const rule of rulesFor(selector)) {
        expect(rule).not.toMatch(/(?:text-overflow:\s*ellipsis|overflow:\s*hidden|line-clamp\s*:)/);
      }
    }
    expect(entry).toMatch(/min-height:\s*var\(--palette-control-size\);/);
    expect(element('workspace-mode-slot').contains(element('entry-mode-reason'))).toBe(false);
    expect(element('location-panel').contains(element('entry-mode-reason'))).toBe(true);
    // An unavailable bookmark must not rename or widen the persistent mode.
    const css = authorCss.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, rule] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector.includes('#entry-mode-reason') || !selector.includes(':has(')) continue;
      expect(rule).not.toMatch(/(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|grid-template-columns)\s*:/);
    }
  });

  it('keeps complete gesture feedback out of the palette and never relocates a captured handle through feedback CSS', () => {
    const dock = element('workspace-dock');
    const review = element('workspace-review');
    const status = element('pointer-status');
    expect(status.hasAttribute('role')).toBe(false);
    expect(status.hasAttribute('aria-live')).toBe(false);
    for (const id of ['pointer-status', 'selection-controls-error', 'selection-controls-feedback']) {
      expect(review.contains(element(id))).toBe(true);
      expect(dock.contains(element(id))).toBe(false);
      expect(element('score-scroll').contains(element(id))).toBe(false);
    }
    const announcement = element('workspace-feedback-label');
    expect(announcement.getAttribute('role')).toBe('status');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
    expect(announcement.classList.contains('visually-hidden')).toBe(false);
    expect(announcement.getAttribute('aria-hidden')).not.toBe('true');
    expect(announcement.closest('.app-header')).not.toBeNull();
    expect(element('location-panel').contains(element('entry-destination'))).toBe(true);
    for (const selector of ['body[data-pointer-gesture] #selection-controls', 'body[data-selection-feedback="rejected"] #selection-controls']) {
      for (const rule of rulesFor(selector)) expect(rule).not.toMatch(/(?:display:\s*none|visibility:\s*hidden)/);
    }
    expect(button('selection-review').getAttribute('popovertarget')).toBe('workspace-review');
    expect(element('location-panel').contains(button('selection-review'))).toBe(true);
    expect(element('selection-slot-2').contains(button('selection-done'))).toBe(true);
    expect(element('selection-slot-3').contains(button('drag-pitch'))).toBe(true);
    // Capture geometry belongs to browser tests. Authored gesture-state rules
    // must not directly hide, resize, or relocate the captured handle.
    const css = authorCss.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, rule] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector.includes('[data-pointer-gesture]') || !/#drag-(?:pitch|entry)/.test(selector)) continue;
      expect(rule).not.toMatch(/(?:display:\s*none|visibility:\s*hidden|(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|position|inset|top|right|bottom|left|transform|order)\s*:)/);
    }
  });

  it('styles the open Properties state without changing the More control dimensions', () => {
    const rule = declarationsFor('#palette-more-slot > button[aria-expanded="true"]');
    expect(rule).toMatch(/border-color\s*:/);
    expect(rule).toMatch(/background\s*:/);
    expect(rule).not.toMatch(/(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|flex|margin(?:-[\w]+)?|padding(?:-[\w]+)?|gap|position|inset|transform|font(?:-[\w]+)?)\s*:/);
    expect(element('edit-selected-value').hidden).toBe(true);
    // Stable measured sibling rectangles across pane transitions remain an
    // actual-layout gate; a color-only rule is necessary but not sufficient.
  });

  it('collapses an entire pristine draft notice without concealing text or an available recovery action', () => {
    const pristine = '.draft-notice:has(> .draft-status:empty):not(:has(.draft-actions > button:not([hidden])))';
    expect(declarationsFor(pristine)).toMatch(/display:\s*none;/);
    const notices = [...shell.querySelectorAll<HTMLElement>('.draft-notice')];
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      const status = notice.querySelector<HTMLElement>(':scope > .draft-status')!;
      const action = notice.querySelector<HTMLButtonElement>('.draft-actions > button')!;
      expect(status).not.toBeNull();
      expect(action).not.toBeNull();
      // happy-dom misreports nested :has() here and caches :empty() across
      // text changes. Keep the exact production CSS gate above and inspect
      // its direct child's content and recovery-button hidden flags instead.
      // Native selector/cascade and rendering qualification stay separate.
      const actions = [...notice.querySelectorAll<HTMLButtonElement>('.draft-actions > button')];
      const visibleActions = () => actions.filter(candidate => !candidate.hidden);
      expect(status.parentElement).toBe(notice);
      expect(status.childNodes).toHaveLength(0);
      expect(visibleActions()).toHaveLength(0);
      status.textContent = 'Unapplied changes';
      expect(status.childNodes).toHaveLength(1);
      status.replaceChildren();
      action.hidden = false;
      expect(status.childNodes).toHaveLength(0);
      expect(visibleActions()).toEqual([action]);
      action.hidden = true;
      expect(visibleActions()).toHaveLength(0);
    }
  });

  it('keeps complete chooser errors in the scrolling body and its actions at full touch height', () => {
    const errors = declarationsFor('.selection-chooser-error');
    expect(errors).toMatch(/white-space:\s*pre-wrap;/);
    expect(errors).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(errors).not.toMatch(/(?:max-height\s*:|text-overflow:\s*ellipsis|overflow:\s*hidden|line-clamp\s*:)/);
    expect(declarationsFor('.selection-chooser .button-row button')).toMatch(/min-width:\s*44px;/);
    expect(declarationsFor('.selection-chooser .button-row button')).toMatch(/min-height:\s*44px;/);
    expect(declarationsFor('.popover-heading button')).toMatch(/min-height:\s*44px;/);
    expect(declarationsFor('.popover-heading')).toMatch(/flex:\s*none;/);
    for (const kind of ['value', 'pitch', 'shared']) {
      expect(element(`selection-${kind}-error`).classList.contains('selection-chooser-error')).toBe(true);
    }
  });

  it('keeps direct chooser accidentals at 44px and constrains the nominal fieldset to its pane', () => {
    const group = declarationsFor('#selection-chooser-accidentals');
    expect(group).toMatch(/display:\s*grid;/);
    expect(group).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
    const actions = declarationsFor('#selection-chooser-accidentals button');
    expect(actions).toMatch(/min-width:\s*var\(--music-ui-control-size\);/);
    expect(actions).toMatch(/min-height:\s*var\(--music-ui-control-size\);/);
    const pressed = '#selection-chooser-accidentals button[aria-pressed="true"]';
    expect(declarationsFor(pressed)).toMatch(/(?:background|border-color|outline)\s*:/);
    const forcedColors = [...authorCss.matchAll(/@media\s*\(forced-colors:\s*active\)/g)]
      .flatMap(header => rulesFor(pressed, blockFor(/@media\s*\(forced-colors:\s*active\)/, authorCss.slice(header.index))));
    expect(forcedColors.some(rule => /outline:\s*[^;]+;/.test(rule))).toBe(true);
    expect(declarationsFor('#selected-nominal-span')).toMatch(/min-width:\s*0;/);
  });

  it('keeps native overlays bounded while the unenhanced panels remain in flow', () => {
    const base = rulesFor('.surface-popover')[0] ?? '';
    expect(base).toMatch(/position:\s*static;/);
    expect(base).not.toMatch(/\bdisplay\s*:/);
    const open = declarationsFor('.surface-popover:popover-open');
    expect(open).toMatch(/position:\s*fixed;/);
    expect(open).toMatch(/max-height:\s*calc\(100dvh\s*-\s*\d+(?:\.\d+)?px\);/);
    expect(open).toMatch(/min-height:\s*0;/);
    expect(open).toMatch(/overflow:\s*hidden;/);
    expect(declarationsFor('.popover-body')).toMatch(/min-height:\s*0;/);
    expect(declarationsFor('.popover-body')).toMatch(/overflow:\s*auto;/);
    expect(authorCss).toContain('@supports selector(:popover-open)');
    expect(authorCss).toContain('@position-try --surface-viewport');
    expect(declarationsFor('.surface-popover[data-popover-fallback="true"]')).toMatch(/position:\s*static;/);
  });

  it('declares full touch-height targets for the persistent workspace actions', () => {
    for (const selector of ['.tools-tablist button', '#tools-hide', '#tools-expand', '#other-tools', '#back-to-properties', '.properties-actions button', '#workspace-review-slot #workspace-review-trigger']) {
      expect(declarationsFor(selector), selector).toMatch(/min-height:\s*(?:44px|var\(--music-ui-control-size\));/);
    }
  });

  it('gives dynamic attached-mark removal and navigation buttons scoped 44px targets', () => {
    for (const selector of ['#event-markings-editor [data-remove-marking]', '.event-navigator .event-marking-link']) {
      const rule = declarationsFor(selector);
      expect(rule).toMatch(/min-width:\s*44px;/);
      expect(rule).toMatch(/min-height:\s*44px;/);
    }
  });

  it('reuses one fixed header status line and Review slot while full details wrap inside Review', () => {
    const line = declarationsFor('.document-subline');
    expect(line).toMatch(/display:\s*grid;/);
    expect(line).toMatch(/block-size:\s*1rem;/);
    expect(line).toMatch(/min-block-size:\s*1rem;/);
    const messages = declarationsFor('.document-subline > :is(#save-status, #workspace-feedback-label)');
    expect(messages).toMatch(/grid-area:\s*1\s*\/\s*1;/);
    expect(messages).toMatch(/block-size:\s*1rem;/);
    expect(declarationsFor('.document-subline:has(#workspace-feedback-label:not(:empty)) #save-status')).toMatch(/visibility:\s*hidden;/);
    const reviewSlot = declarationsFor('#workspace-review-slot');
    expect(reviewSlot).toMatch(/flex:\s*0\s+0\s+44px;/);
    expect(reviewSlot).toMatch(/width:\s*44px;/);
    expect(reviewSlot).toMatch(/height:\s*44px;/);
    expect(declarationsFor('#workspace-review-slot #workspace-review-trigger')).toMatch(/min-height:\s*44px;/);
    const details = declarationsFor('#workspace-review :is(#author-status, #pointer-status, #selection-controls-feedback, #selection-controls-error)');
    expect(details).toMatch(/position:\s*static;/);
    expect(details).toMatch(/height:\s*auto;/);
    expect(details).toMatch(/max-height:\s*none;/);
    expect(details).toMatch(/overflow:\s*visible;/);
    expect(details).toMatch(/white-space:\s*pre-wrap;/);
    expect(details).toMatch(/overflow-wrap:\s*anywhere;/);
    const fullErrors = declarationsFor('#workspace-review #author-errors');
    expect(fullErrors).toMatch(/max-height:\s*none;/);
    expect(fullErrors).toMatch(/overflow:\s*visible;/);
    expect(fullErrors).toMatch(/white-space:\s*pre-wrap;/);
    expect(fullErrors).toMatch(/overflow-wrap:\s*anywhere;/);
    const recovery = declarationsFor('#workspace-recovery-detail');
    expect(recovery).toMatch(/white-space:\s*pre-wrap;/);
    expect(recovery).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(recovery).not.toMatch(/max-height\s*:|text-overflow:\s*ellipsis|overflow:\s*hidden|line-clamp\s*:/);
    expect(declarationsFor('#review-download-project')).toMatch(/min-height:\s*44px;/);
  });

  it('lets complete Source error messages wrap within the existing Source scroll region', () => {
    const error = declarationsFor('#source-error', sourceEditorCss);
    expect(error).toMatch(/flex:\s*none;/);
    expect(error).toMatch(/max-height:\s*none;/);
    expect(error).toMatch(/overflow:\s*visible;/);
    expect(error).toMatch(/white-space:\s*pre-wrap;/);
    expect(error).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(error).not.toMatch(/(?:text-overflow:\s*ellipsis|line-clamp\s*:)/);
    const body = [...composedAncestors(element('source-error'))].find(element => element.matches('.popover-body'));
    expect(body).toBeDefined();
    expect(declarationsFor('.popover-body')).toMatch(/min-height:\s*0;/);
    expect(declarationsFor('.popover-body')).toMatch(/overflow:\s*auto;/);
  });

  it('bounds only an open confirmation dialog and keeps its actions outside the scrolling body', () => {
    const base = rulesFor('.author-confirmation')[0] ?? '';
    expect(base).toMatch(/position:\s*static;/);
    expect(base).not.toMatch(/\bdisplay\s*:/);
    const open = declarationsFor('.author-confirmation[open]');
    expect(open).toMatch(/display:\s*flex;/);
    expect(open).toMatch(/position:\s*fixed;/);
    expect(open).toMatch(/min-height:\s*0;/);
    expect(open).toMatch(/max-height:\s*calc\(100dvh\s*-\s*\d+(?:\.\d+)?px\);/);
    expect(open).toMatch(/overflow:\s*hidden;/);
    expect(declarationsFor('.confirmation-body')).toMatch(/min-height:\s*0;/);
    expect(declarationsFor('.confirmation-body')).toMatch(/overflow:\s*auto;/);
    expect(declarationsFor('.confirmation-actions')).toMatch(/flex:\s*none;/);
    expect(declarationsFor('.confirmation-actions button')).toMatch(/min-height:\s*44px;/);
    const fallback = declarationsFor('.author-confirmation[data-dialog-fallback="true"][open]');
    expect(fallback).toMatch(/position:\s*static;/);
    expect(fallback).toMatch(/max-height:\s*none;/);
    expect(fallback).toMatch(/overflow:\s*visible;/);
    expect(declarationsFor('body:has(#author-confirmation[data-dialog-fallback="true"][open])')).toMatch(/overflow:\s*auto;/);
  });

  it('removes viewport sizing and all reserved workbench space when printing pages', () => {
    const printStart = authorCss.lastIndexOf('@media print');
    expect(printStart).toBeGreaterThan(0);
    const printCss = authorCss.slice(printStart);
    for (const selector of ['body:has(#author-workbench)', 'body:has(#author-workbench) .author-workspace']) {
      const rule = declarationsFor(selector, printCss);
      expect(rule, selector).toMatch(/display:\s*block;/);
      expect(rule, selector).toMatch(/height:\s*auto;/);
      expect(rule, selector).toMatch(/min-height:\s*0;/);
      expect(rule, selector).toMatch(/overflow:\s*visible;/);
    }
    for (const selector of ['#author-workbench', '#workspace-tools', '.surface-popover', '.workspace-notices', '#author-confirmation']) {
      expect(declarationsFor(selector, printCss)).toMatch(/display:\s*none\s*!important;/);
    }
    for (const selector of ['body:has(#author-workbench) #page-host', 'body:has(#author-workbench) #page-host[hidden]']) {
      const rule = declarationsFor(selector, printCss);
      expect(rule).toMatch(/display:\s*block\s*!important;/);
      expect(rule).toMatch(/height:\s*auto;/);
      expect(rule).toMatch(/overflow:\s*visible;/);
    }
  });

  it('retains a guarded native select enhancement and the platform fallback', () => {
    expect(authorCss).toContain('@supports (appearance: base-select) and selector(::picker(select))');
    expect(authorCss).toMatch(/select\.author-select,\s*select\.author-select::picker\(select\)\s*\{\s*appearance:\s*base-select;/);
    expect(authorCss).not.toMatch(/appearance:\s*none/);
  });

  it('limits disabled touch scrolling to deliberate gesture handles', () => {
    const css = authorCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*touch-action:\s*none;[^{}]*)\}/g)];
    expect(rules).toHaveLength(1);
    expect(rules[0][1].split(',').map(selector => selector.trim()).sort()).toEqual(['#drag-entry', '#drag-pitch']);
    expect(rules[0][2]).toMatch(/min-(?:height|block-size):\s*44px;/);
    expect(rules[0][2]).toMatch(/min-(?:width|inline-size):\s*44px;/);
    expect(authorCss).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
