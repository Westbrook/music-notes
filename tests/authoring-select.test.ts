// @vitest-environment happy-dom
import { createAuthorFixtureDocument } from './author-fixture.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { enhanceSelects } from '../src/authoring/select';

const authorCss = readFileSync('src/authoring/author.css', 'utf8');
// Parse static shell structure without asking the DOM emulator to load assets.

afterEach(() => document.body.replaceChildren());

function fixture(markup: string): HTMLSelectElement {
  document.body.innerHTML = markup;
  return document.querySelector('select')!;
}

function option(text: string, value: string): HTMLOptionElement {
  const result = document.createElement('option');
  result.textContent = text;
  result.value = value;
  return result;
}

function expectNativeButton(select: HTMLSelectElement): void {
  const button = select.firstElementChild;
  expect(button?.tagName).toBe('BUTTON');
  expect(button?.getAttribute('type')).toBe('button');
  expect(button?.querySelectorAll('selectedcontent')).toHaveLength(1);
  expect(select.querySelectorAll(':scope > button')).toHaveLength(1);
  expect(select.getAttribute('role')).toBeNull();
  expect(select.classList.contains('author-select')).toBe(true);
}

describe('customizable native authoring selects', () => {
  it('adds a native select button without replacing options, values, or labels', () => {
    const select = fixture('<label for="duration">Written duration</label><select id="duration" name="duration"><option value="quarter">Quarter</option><option value="eighth" selected>Eighth</option></select>');
    const options = [...select.options];
    enhanceSelects(document);
    expectNativeButton(select);
    expect([...select.options]).toEqual(options);
    expect(select.value).toBe('eighth');
    expect(select.selectedIndex).toBe(1);
    expect(select.labels?.[0]?.textContent).toBe('Written duration');
  });

  it('is idempotent and preserves an existing button and selectedcontent', () => {
    const select = fixture('<select><option value="note">Note</option><option value="rest">Rest</option></select>');
    const button = document.createElement('button');
    const content = document.createElement('selectedcontent');
    button.append(content);
    button.type = 'submit';
    select.prepend(button);
    select.value = 'rest';
    enhanceSelects(select);
    enhanceSelects(select);
    expectNativeButton(select);
    expect(select.firstElementChild).toBe(button);
    expect(button.firstElementChild).toBe(content);
    expect(select.value).toBe('rest');
  });

  it('makes implicit option values explicit without changing their native value', () => {
    const select = fixture('<select><option>Quarter note</option><option>  Eighth note  </option><option value="">Choose a duration</option></select>');
    const nativeValues = [...select.options].map(option => option.value);
    select.selectedIndex = 1;
    enhanceSelects(select);
    expect([...select.options].map(option => option.getAttribute('value'))).toEqual(nativeValues);
    expect(select.value).toBe(nativeValues[1]);
    expect(select.options[2].value).toBe('');
  });

  it('keeps an intentionally empty selection empty', () => {
    const select = fixture('<select><option value="a">A</option><option value="b">B</option></select>');
    select.selectedIndex = -1;
    enhanceSelects(select);
    expect(select.selectedIndex).toBe(-1);
    expect(select.value).toBe('');
    expect([...select.options].some(option => option.selected)).toBe(false);
  });

  it('enhances an empty dropdown again after dynamic options replace its contents', () => {
    const select = fixture('<select id="parts"></select>');
    enhanceSelects(select);
    expectNativeButton(select);
    const score = option('Full score', 'score');
    const piano = option('Piano', 'piano');
    select.replaceChildren(score, piano);
    select.value = 'piano';
    enhanceSelects(select);
    expectNativeButton(select);
    expect(select.value).toBe('piano');
    expect(select.options[1]).toBe(piano);
  });

  it('preserves native form submission and reset defaults', () => {
    const select = fixture('<form><label for="clef">Clef</label><select id="clef" name="clef" required><option value="treble" selected>Treble</option><option value="bass">Bass</option></select></form>');
    const form = document.querySelector('form')!;
    select.value = 'bass';
    enhanceSelects(form);
    expect(new FormData(form).get('clef')).toBe('bass');
    expect(select.required).toBe(true);
    expect(select.options[0].hasAttribute('selected')).toBe(true);
    form.reset();
    expect(select.value).toBe('treble');
  });

  it('retains disabled selects and disabled options without inventing input handlers', () => {
    const select = fixture('<form><select name="kind" disabled><option value="note">Note</option><option value="rest" disabled>Rest</option></select></form>');
    const form = document.querySelector('form')!;
    const submittedBefore = [...new FormData(form).entries()];
    enhanceSelects(select);
    expect(select.disabled).toBe(true);
    expect(select.options[1].disabled).toBe(true);
    // The emulator does not implement disabled-control exclusion; compare its
    // native behavior before/after rather than claiming browser qualification.
    expect([...new FormData(form).entries()]).toEqual(submittedBefore);
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    expect(select.getAttribute('tabindex')).toBeNull();
    expect(select.getAttribute('aria-expanded')).toBeNull();
  });

  it('leaves native multiple and size-based listboxes alone', () => {
    document.body.innerHTML = '<select multiple><option value="a" selected>A</option><option value="b" selected>B</option></select><select size="4"><option value="c">C</option></select>';
    enhanceSelects(document);
    for (const select of document.querySelectorAll('select')) {
      expect(select.querySelector('button')).toBeNull();
      expect(select.classList.contains('author-select')).toBe(false);
    }
    expect([...document.querySelector('select')!.selectedOptions].map(option => option.value)).toEqual(['a', 'b']);
  });

  it('works within a document fragment or a shadow root', () => {
    const fragment = document.createDocumentFragment();
    const select = document.createElement('select');
    select.append(option('Automatic', 'auto'));
    fragment.append(select);
    enhanceSelects(fragment);
    expectNativeButton(select);
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(fragment);
    enhanceSelects(shadow);
    expectNativeButton(select);
  });

  it('applies the same native structure to every dropdown in the authoring shell', () => {
    const shell = createAuthorFixtureDocument();
    enhanceSelects(shell);
    const selects = [...shell.querySelectorAll('select')];
    expect(selects.length).toBeGreaterThan(25);
    for (const select of selects) {
      expectNativeButton(select);
      expect(select.id).not.toBe('');
      expect(shell.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
      expect([...select.options].every(option => option.hasAttribute('value'))).toBe(true);
      expect(select.multiple).toBe(false);
      expect(Number(select.getAttribute('size') ?? 0)).toBeLessThanOrEqual(1);
    }
  });

  it('renders explicit option values and button types before enhancement', () => {
    const authorHtml = createAuthorFixtureDocument().body.innerHTML;
    const optionTags = authorHtml.match(/<option\b[^>]*>/g) ?? [];
    const buttonTags = authorHtml.match(/<button\b[^>]*>/g) ?? [];
    const selectTags = authorHtml.match(/<select\b[^>]*>/g) ?? [];
    expect(optionTags.length).toBeGreaterThan(50);
    expect(optionTags.every(tag => /\bvalue="[^"]*"/.test(tag))).toBe(true);
    expect(buttonTags.every(tag => /\btype="button"/.test(tag))).toBe(true);
    expect(authorHtml.match(/<selectedcontent><\/selectedcontent>/g)).toHaveLength(selectTags.length);
  });

  it('uses a guarded CSS opt-in while leaving the native fallback appearance intact', () => {
    expect(authorCss).toContain('@supports (appearance: base-select) and selector(::picker(select))');
    expect(authorCss).toMatch(/select\.author-select,\s*select\.author-select::picker\(select\)\s*\{\s*appearance: base-select;/);
    expect(authorCss).toContain('select.author-select:open::picker-icon');
    expect(authorCss).toContain('select.author-select option:checked');
    expect(authorCss).toContain('select.author-select option::checkmark');
    expect(authorCss).not.toMatch(/appearance:\s*none/);
  });

  it('uses a labeled native auto popover for the Document overlay', () => {
    const shell = createAuthorFixtureDocument();
    const trigger = shell.getElementById('document-menu-trigger')!;
    const panel = shell.getElementById('document-menu')!;
    const close = shell.getElementById('close-document-menu')!;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
    expect(panel.tagName).toBe('SECTION');
    expect(panel.getAttribute('popover')).toBe('auto');
    expect(panel.classList.contains('nonprinting')).toBe(true);
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.getAttribute('role')).toBeNull();
    expect(shell.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe('Document');
    expect(close.getAttribute('type')).toBe('button');
    expect(close.getAttribute('popovertarget')).toBe(panel.id);
    expect(close.getAttribute('popovertargetaction')).toBe('hide');
    expect(panel.querySelector('summary')).toBeNull();
    expect(panel.querySelectorAll('[role="menu"], [role="menuitem"]')).toHaveLength(0);
    expect(panel.querySelector('#new-template')).not.toBeNull();
    expect(panel.querySelector('#project-subtitle')).not.toBeNull();
  });

  it('styles only an open Document popover as an overlay and preserves the in-flow fallback', () => {
    expect(authorCss).toContain('@supports selector(:popover-open)');
    expect(authorCss).toMatch(/\.surface-popover:popover-open\s*\{\s*display: flex;\s*flex-direction: column;\s*position: fixed;/);
    const basePanelRules = [...authorCss.matchAll(/\.document-menu\s*\{([^}]*)\}/g)].map(match => match[1]);
    expect(basePanelRules.length).toBeGreaterThan(0);
    expect(basePanelRules.some(rule => /position:\s*static/.test(rule))).toBe(true);
    expect(basePanelRules.every(rule => !/\bdisplay\s*:/.test(rule))).toBe(true);
    expect(authorCss).toMatch(/\.document-menu-trigger,\s*\.document-menu-close\s*\{\s*display: none;/);
    expect(authorCss).toMatch(/\.document-menu-trigger\[data-surface-target\],\s*\.document-menu-close\[data-surface-target\]\s*\{\s*display: inline-flex;/);
    expect(authorCss).not.toContain('.document-menu > summary');
    expect(authorCss).toContain('max-height: calc(100dvh - 24px)');
    expect(authorCss).toContain('overscroll-behavior: contain');
  });

  it('gives Document one scrolling body and bounded shared surface styles without competing anchor rules', () => {
    const shell = createAuthorFixtureDocument();
    const panel = shell.getElementById('document-menu')!;
    const body = panel.querySelector('.document-menu-content');
    expect(panel.classList.contains('surface-popover')).toBe(true);
    expect(panel.querySelectorAll('.popover-body')).toHaveLength(1);
    expect(body?.classList.contains('popover-body')).toBe(true);
    expect(body?.contains(shell.getElementById('new-template'))).toBe(true);
    expect(body?.contains(shell.getElementById('close-document-menu'))).toBe(false);
    const open = authorCss.match(/\.surface-popover:popover-open\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(open).toContain('margin: 0;');
    expect(open).toContain('max-height: calc(100vh - 24px);');
    expect(open).toContain('max-height: calc(100dvh - 24px);');
    expect(open).toContain('min-height: 0;');
    const content = authorCss.match(/\.surface-popover \.document-menu-content\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(content).toContain('min-height: 0;');
    expect(content).toContain('overflow: auto;');
    expect(content).toContain('overscroll-behavior: contain;');
    const fallback = authorCss.match(/\.surface-popover\[data-popover-fallback="true"\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(fallback).toContain('position: static;');
    expect(fallback).toContain('max-height: none;');
    expect(fallback).toContain('overflow: visible;');
    expect(authorCss).not.toContain('--document-menu-anchor');
    expect(authorCss).not.toContain('--document-menu-viewport');
    // Real bounds and scrollability at 390×360 and 1180×360 belong to the
    // actual-browser suite; the DOM emulator does not lay out popovers.
  });

  it('keeps both editing modes explicit and prepares deliberate drag through native buttons', () => {
    const shell = createAuthorFixtureDocument();
    const selectMode = shell.getElementById('select-mode')!;
    const entryMode = shell.getElementById('toggle-entry')!;
    const entryLabel = shell.getElementById('entry-mode-label')!;
    const entryReason = shell.getElementById('entry-mode-reason')!;
    expect(selectMode.textContent).toBe('Select');
    expect(selectMode.getAttribute('aria-pressed')).toBe('true');
    expect(entryLabel.textContent).toBe('Write notes');
    expect(entryLabel.closest('button')).toBe(entryMode);
    expect(entryReason.hidden).toBe(true);
    expect(entryReason.closest('button')).toBeNull();
    expect(entryMode.getAttribute('aria-pressed')).toBe('false');
    const modes = shell.getElementById('workspace-mode-slot');
    expect(modes).not.toBeNull();
    expect(selectMode.parentElement).toBe(modes);
    expect(entryMode.parentElement).toBe(modes);
    expect(modes?.querySelectorAll('button')).toHaveLength(2);
    expect(selectMode.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect(entryMode.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect(shell.getElementById('resume-entry')?.closest('#location-panel')).not.toBeNull();
    expect(modes?.parentElement).toBe(shell.getElementById('workspace-dock'));
    expect(modes?.closest('#score-editor, #workspace-tools, #entry-toolbar')).toBeNull();
    expect(modes?.getAttribute('aria-label')?.trim() || modes?.getAttribute('aria-labelledby')?.trim()).toBeTruthy();
    for (const id of ['select-mode', 'toggle-entry', 'drag-entry', 'drag-pitch']) {
      const button = shell.getElementById(id)!;
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.hasAttribute('draggable')).toBe(false);
      expect(button.hasAttribute('aria-grabbed')).toBe(false);
      expect(button.closest('.nonprinting')).not.toBeNull();
    }
    expect(shell.getElementById('drag-entry')?.contains(shell.getElementById('drag-entry-value'))).toBe(true);
    expect(shell.getElementById('drag-entry')?.closest('#entry-toolbar')).not.toBeNull();
    expect(shell.getElementById('drag-entry')?.hidden).toBe(true);
    for (const id of ['prepare-entry-drag']) {
      const action = shell.getElementById(id);
      expect(action?.tagName).toBe('BUTTON');
      expect(action?.getAttribute('type')).toBe('button');
      expect(action?.closest('#entry-settings')).not.toBeNull();
    }
    expect(shell.getElementById('cancel-entry-drag')?.closest('#entry-slot-value')).not.toBeNull();
    expect(shell.getElementById('cancel-entry-drag')?.getAttribute('type')).toBe('button');
    expect(shell.getElementById('cancel-entry-drag')?.hidden).toBe(true);
    expect(shell.getElementById('drag-pitch')?.closest('#pointer-tools')).not.toBeNull();
    expect(shell.getElementById('drag-entry-value')?.textContent).toContain('C4');
    expect(shell.getElementById('drag-pitch')?.hasAttribute('disabled')).toBe(true);
    expect(shell.getElementById('drag-pitch')?.getAttribute('aria-describedby')).toContain('drag-pitch-help');
    expect(shell.getElementById('drag-pitch-help')?.textContent).toContain('untied single note');
    expect(shell.querySelectorAll('select').length).toBeGreaterThan(0);
    for (const id of ['event-kind', 'event-duration', 'event-dots', 'note-duration', 'note-dots',
      'selected-kind', 'selected-duration', 'selected-dots', 'staff-select', 'measure-select', 'event-voice', 'part-select',
      'selection-note-step', 'selection-note-octave', 'selection-alteration']) {
      expect(shell.getElementById(id)?.tagName).toBe('SELECT');
    }
    for (const id of ['document-menu', 'note-editor', 'entry-settings', 'entry-value-chooser', 'location-panel', 'source-panel']) {
      expect(shell.getElementById(id)?.getAttribute('popover')).toBe('auto');
    }
  });

  it('provides nonprinting gesture feedback and an alternative to dragging', () => {
    const shell = createAuthorFixtureDocument();
    const status = shell.getElementById('pointer-status')!;
    expect(status.hasAttribute('role')).toBe(false);
    expect(status.hasAttribute('aria-live')).toBe(false);
    expect(status.closest('#workspace-review')).not.toBeNull();
    expect(status.closest('.nonprinting')).not.toBeNull();
    const feedback = shell.getElementById('workspace-feedback-label')!;
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.closest('.app-header')).not.toBeNull();
    expect(feedback.closest('.nonprinting')).not.toBeNull();
    const help = shell.getElementById('pointer-help')!.textContent!;
    for (const phrase of ['Write notes', 'Select', 'Escape']) expect(help).toContain(phrase);
    expect(help).toMatch(/pitch drags keep (?:the )?rhythm/i);
    expect(shell.getElementById('edit-selected-help')?.textContent).toMatch(/Properties.*selected music/);
    const keyboardHelp = shell.getElementById('keyboard-help')?.textContent ?? '';
    expect(keyboardHelp).toMatch(/in Select,[^.]*Enter opens Properties/i);
    expect(keyboardHelp).toMatch(/in Write notes,[^.]*Enter inserts the current recipe/i);
    expect(keyboardHelp).toMatch(/A.G writes natural pitches/);
    expect(keyboardHelp).toMatch(/Native fields.*usual keys/);
    // The header owns the compact announcement; complete gesture details stay
    // in Review without replacing musical controls. Native layout is separate.
    expect(status.querySelector('[role="menu"]')).toBeNull();
  });

  it('uses named native choosers for common corrections and opens Properties directly through More', () => {
    const shell = createAuthorFixtureDocument();
    const more = shell.getElementById('edit-selected-event')!;
    expect(more.closest('#selection-controls')).toBeNull();
    expect(more.closest('#pointer-tools')).toBeNull();
    expect(more.closest('#palette-more-slot')).not.toBeNull();
    expect(more.tagName).toBe('BUTTON');
    expect(more.getAttribute('type')).toBe('button');
    expect(more.hasAttribute('popovertarget')).toBe(false);
    expect(more.getAttribute('aria-controls')).toBe('workspace-tools');
    for (const kind of ['value', 'pitch', 'shared']) {
      const trigger = shell.getElementById(`selection-${kind}`)!;
      const panel = shell.getElementById(`selection-${kind}-chooser`)!;
      const close = shell.getElementById(`close-selection-${kind}`)!;
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger.getAttribute('type')).toBe('button');
      expect(trigger.closest('#selection-controls')).not.toBeNull();
      expect(trigger.getAttribute('popovertarget')).toBe(panel.id);
      expect(panel.getAttribute('popover')).toBe('auto');
      expect(panel.getAttribute('aria-labelledby')).toBe(`selection-${kind}-heading`);
      expect(panel.closest('.nonprinting')).not.toBeNull();
      expect(panel.closest('details')).toBeNull();
      expect(panel.hasAttribute('hidden')).toBe(false);
      expect(panel.querySelector('[role="menu"], [role="combobox"]')).toBeNull();
      expect(close.getAttribute('type')).toBe('button');
      expect(close.getAttribute('popovertarget')).toBe(panel.id);
      expect(close.getAttribute('popovertargetaction')).toBe('hide');
      const choices = [...panel.querySelectorAll('select')];
      expect(choices.length).toBeGreaterThan(0);
      for (const select of choices) {
        expectNativeButton(select);
        expect([...select.options].every(option => option.hasAttribute('value'))).toBe(true);
        expect(panel.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
      }
      expect(panel.querySelector(`#selection-${kind}-error`)?.getAttribute('role')).toBe('alert');
    }
    for (const id of ['selection-accidentals', 'selection-quick-duration', 'selection-quick-dots', 'selection-quick-attack']) {
      const group = shell.getElementById(id)!;
      expect(group.localName).toBe('music-toggle-button-group');
      expect(group.getAttribute('label')).toBeTruthy();
      expect(group.closest('#selection-quick-tools')).not.toBeNull();
    }
    expect(shell.getElementById('workspace-feedback-label')?.getAttribute('role')).toBe('status');
    expect(shell.querySelector('button[popovertarget="note-editor"]:not([popovertargetaction="hide"])')).toBeNull();
  });

  it('keeps advanced event fields and guarded Apply separate from the next-entry recipe', () => {
    const shell = createAuthorFixtureDocument();
    expect(shell.getElementById('update-event')?.closest('#entry-toolbar, #write-tools')).toBeNull();
    expect(shell.getElementById('update-event')?.closest('#event-details')).not.toBeNull();
    expect(shell.getElementById('update-event')?.closest('#selection-inspector')).not.toBeNull();
    expect(shell.getElementById('load-event-values')?.closest('#selection-inspector')).not.toBeNull();
    expect(shell.getElementById('load-event-values')?.hasAttribute('hidden')).toBe(true);
    expect(shell.getElementById('event-form-context')).not.toBeNull();
    for (const name of ['kind', 'pitch', 'pitches', 'duration', 'dots', 'rhythmic', 'measure-rest', 'accidental-display', 'stem', 'beam']) {
      const selected = shell.getElementById('selected-' + name);
      const owner = name === 'beam' ? '#passage-inspector' : '#selection-inspector';
      expect(selected).not.toBeNull();
      expect(selected!.closest(owner)).not.toBeNull();
      expect(shell.querySelector('label[for="selected-' + name + '"]')).not.toBeNull();
      expect(shell.getElementById('event-' + name)?.closest('#workspace-tools')).toBeNull();
    }
    const properties = shell.getElementById('selection-inspector')!;
    for (const id of ['selected-direction', 'selected-rhythmic']) {
      const hiddenOwner = shell.getElementById(id)?.closest('[hidden]');
      expect(hiddenOwner).not.toBeNull();
      expect(properties.contains(hiddenOwner!)).toBe(true);
      expect(hiddenOwner).not.toBe(properties);
      expect(shell.getElementById('selected-common-compat')?.contains(shell.getElementById(id))).toBe(true);
    }
    const nominal = shell.getElementById('selected-nominal-span');
    expect(nominal?.tagName).toBe('FIELDSET');
    expect(nominal?.hidden).toBe(true);
    expect(nominal?.closest('#event-details')).not.toBeNull();
    for (const id of ['selected-duration', 'selected-dots']) {
      const select = shell.getElementById(id) as HTMLSelectElement;
      expectNativeButton(select);
      expect(select.closest('fieldset')).toBe(nominal);
      expect(select.closest('[hidden]')).toBe(nominal);
      expect(shell.getElementById('selected-common-compat')?.contains(select)).toBe(false);
      expect(select.getAttribute('aria-describedby')?.split(/\s+/)).toContain('selected-nominal-help');
    }
  });

  it('retains bounded native and in-flow fallback styling for the legacy note-editor fixture', () => {
    const rules = [...authorCss.matchAll(/\.note-editor\s*\{([^}]*)\}/g)].map(match => match[1]);
    expect(rules.some(rule => /position:\s*static/.test(rule))).toBe(true);
    expect(rules.every(rule => !/\bdisplay\s*:/.test(rule))).toBe(true);
    expect(authorCss).toContain('.note-editor:popover-open');
    expect(authorCss).toContain('position-try-fallbacks: flip-block, --note-editor-viewport;');
    expect(authorCss).toContain('@position-try --note-editor-viewport');
    expect(authorCss).toContain('.note-editor:popover-open .note-editor-body');
  });

  it('reserves score-local controls outside the independently scrolling notation', () => {
    const shell = createAuthorFixtureDocument();
    const tools = shell.getElementById('pointer-tools')!;
    const viewport = shell.getElementById('score-scroll')!;
    const dock = shell.getElementById('workspace-dock')!;
    expect(dock).not.toBeNull();
    expect(dock.parentElement).toBe(shell.getElementById('author-workbench'));
    expect(shell.getElementById('author-workbench')?.lastElementChild).toBe(dock);
    const musical = shell.getElementById('palette-musical-slots');
    expect(musical?.parentElement).toBe(dock);
    expect(tools.parentElement).toBe(musical);
    expect(shell.getElementById('entry-toolbar')?.parentElement).toBe(musical);
    expect(shell.getElementById('score-editor')?.contains(tools)).toBe(false);
    expect(shell.getElementById('workspace-tools')?.contains(dock)).toBe(false);
    expect(viewport.contains(tools)).toBe(false);
    expect(viewport.contains(shell.getElementById('score-host'))).toBe(true);
    expect(tools.closest('.nonprinting')).not.toBeNull();
    for (const id of ['drag-entry', 'drag-pitch', 'pointer-status', 'pointer-help']) {
      expect(shell.getElementById(id)?.closest('.nonprinting')).not.toBeNull();
    }
    expect(authorCss).toContain('#score-host[data-entry-mode="true"] { cursor: crosshair; }');
    expect(authorCss).toContain('--author-pointer-offset: 0px;');
    // CSS geometry and view changes are exercised by the actual-browser suites;
    // the shell must not put scrolling notation and its controls in one region.
  });

  it('uses one Properties pane with three general tool tabs and native location and entry popovers', () => {
    const shell = createAuthorFixtureDocument();
    const pane = shell.getElementById('workspace-tools')!;
    expect(pane.hasAttribute('popover')).toBe(false);
    expect(pane.hasAttribute('hidden')).toBe(true);
    expect(pane.closest('.nonprinting')).not.toBeNull();
    expect(shell.getElementById('score-scroll')?.contains(pane)).toBe(false);
    expect(pane.getAttribute('data-tools-view')).toBe('properties');
    const properties = shell.getElementById('selection-inspector')!;
    expect(properties.getAttribute('role')).toBe('region');
    expect(properties.getAttribute('aria-labelledby')).toBe('properties-heading');
    expect(properties.parentElement).toBe(pane);
    expect(properties.hidden).toBe(false);
    expect(shell.getElementById('tools-tablist')?.hidden).toBe(true);
    expect(shell.getElementById('other-tools')?.hidden).toBe(false);
    expect(shell.getElementById('back-to-properties')?.hidden).toBe(true);
    const tabs = [...pane.querySelectorAll('[role="tab"]')];
    expect(tabs.map(tab => tab.id)).toEqual(['tool-tab-rhythm', 'tool-tab-markings', 'tool-tab-measure']);
    expect(shell.getElementById('tool-tab-edit')).toBeNull();
    expect(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').map(tab => tab.id)).toEqual(['tool-tab-rhythm']);
    for (const tab of tabs) {
      const panel = shell.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(panel?.localName).not.toBe('details');
      expect(panel?.hidden).toBe(true);
      expect(tab.getAttribute('tabindex')).toBe(tab.id === 'tool-tab-rhythm' ? '0' : '-1');
    }
    const location = shell.getElementById('location-panel')!;
    for (const id of ['staff-select', 'measure-select', 'event-voice', 'part-select', 'add-measure']) {
      expect(location.contains(shell.getElementById(id))).toBe(true);
    }
    expect(shell.getElementById('location-trigger')?.getAttribute('popovertarget')).toBe(location.id);
    expect(shell.getElementById('entry-settings-trigger')?.getAttribute('popovertarget')).toBe('entry-settings');
    expect(shell.getElementById('source-trigger')?.getAttribute('popovertarget')).toBe('source-panel');
    expect(shell.getElementById('source-panel')?.localName).not.toBe('details');
  });

  it('keeps part navigation outside the Write-only controls for Read and Pages', () => {
    const shell = createAuthorFixtureDocument();
    const invoker = shell.getElementById('active-part-label')!;
    expect(invoker.localName).toBe('button');
    expect(invoker.getAttribute('type')).toBe('button');
    expect(invoker.getAttribute('popovertarget')).toBe('location-panel');
    expect(invoker.closest('.app-header')).not.toBeNull();
    expect(invoker.closest('#pointer-tools, #write-tools, #selection-toolbar')).toBeNull();
    expect(invoker.hasAttribute('hidden')).toBe(false);
    const part = shell.getElementById('part-select')!;
    expect(part.closest('#location-panel')).not.toBeNull();
    expect(part.closest('#selection-toolbar')).toBeNull();
    // Actual mode switching and part projection remain browser regressions;
    // this checks that neither control is structurally inside editing chrome.
  });

  it('names the pointer target without changing insertion command values', () => {
    const shell = createAuthorFixtureDocument();
    const select = shell.getElementById('insert-position') as HTMLSelectElement;
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['after', 'After target'], ['before', 'Before target'], ['replace', 'Replace target'],
    ]);
    expect(select.getAttribute('aria-describedby')).toBe('position-help');
    expect(shell.getElementById('position-help')?.textContent).toBe('On the staff, point to the target. Insert uses your writing destination, which can differ from the selected music.');
  });

  it('restricts touch gesture capture to the two deliberate handles', () => {
    const css = authorCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const touchRules = [...css.matchAll(/([^{}]+)\{([^{}]*touch-action:\s*none;[^{}]*)\}/g)];
    expect(touchRules).toHaveLength(1);
    expect(touchRules[0][1].split(',').map(selector => selector.trim()).sort()).toEqual(['#drag-entry', '#drag-pitch']);
    expect(touchRules[0][2]).toContain('min-width: 44px;');
    expect(touchRules[0][2]).toContain('min-height: 44px;');
    expect(authorCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('starts with score-first collapsed tools and separate score and page mounts', () => {
    const shell = createAuthorFixtureDocument();
    expect(shell.getElementById('workspace-tools')?.hasAttribute('hidden')).toBe(true);
    expect(shell.getElementById('navigator-panel')?.hasAttribute('open')).toBe(false);
    expect(shell.getElementById('source-panel')?.getAttribute('popover')).toBe('auto');
    expect(shell.getElementById('score-host')?.childElementCount).toBe(0);
    expect(shell.getElementById('page-host')?.childElementCount).toBe(0);
    expect(shell.getElementById('score-editor')?.getAttribute('tabindex')).toBe('0');
    expect(shell.getElementById('toggle-entry')?.getAttribute('aria-pressed')).toBe('false');
    const ids = [...shell.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(shell.querySelectorAll('music-staff, music-system')).toHaveLength(0);
  });
});
