// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { MusicWorkbookToolbar, workbookToolbarTemplate } from '../src/demo/workbook-toolbar.js';
import { WorkbookState } from '../src/demo/workbook-state.js';
import { createWorkbookState } from '../src/demo/workbook-controls.js';

const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture({ sourceHref = '' } = {}) {
  const completion = deferred();
  const score = { renderComplete: completion.promise, diagnostics: [] };
  const host = { readScores: () => [score], applyPreview: vi.fn(), requestPrint: vi.fn() };
  const state = new WorkbookState(host);
  const toolbar = document.createElement('music-workbook-toolbar');
  toolbar.model = state;
  toolbar.printWidth = 680;
  toolbar.scoreCount = 12;
  toolbar.sourceHref = sourceHref;
  document.body.append(toolbar);
  await toolbar.updateComplete;
  const root = toolbar.shadowRoot!;
  const preview = root.querySelector<HTMLInputElement>('input')!;
  const printButton = root.querySelector<HTMLButtonElement>('button')!;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  return { toolbar, root, state, host, completion, preview, printButton, status };
}

afterEach(() => document.body.replaceChildren());

describe('Lit workbook toolbar', () => {
  it('keeps native labels, help, status, and customization parts together in an open shadow root', async () => {
    const view = await fixture();
    expect(view.toolbar).toBeInstanceOf(MusicWorkbookToolbar);
    expect(view.root.mode).toBe('open');
    expect(view.toolbar.renderRoot).toBe(view.root);
    expect(view.toolbar.querySelector('input, button, [role="status"]')).toBeNull();
    expect(view.preview.closest('label')?.textContent).toContain('Use print layout on screen (680px)');
    expect(view.preview.labels?.[0].control).toBe(view.preview);
    expect(view.preview.type).toBe('checkbox');
    expect(view.printButton.type).toBe('button');
    for (const control of [view.preview, view.printButton]) {
      const help = view.root.getElementById(control.getAttribute('aria-describedby')!);
      expect(help?.textContent).toBeTruthy();
      expect(help?.getRootNode()).toBe(view.root);
      expect(help?.getAttribute('part')?.split(/\s+/)).toContain('help');
      expect(document.getElementById(control.id)).toBeNull();
    }
    expect(view.root.querySelector('[part~="controls"]')?.getAttribute('aria-label')).toBe('Score display controls');
    expect(view.root.querySelector('[part~="preview"]')).toBe(view.preview);
    expect(view.root.querySelector('[part~="print-button"]')).toBe(view.printButton);
    expect(view.root.querySelector('[part~="status"]')).toBe(view.status);
    expect(view.status.getAttribute('aria-live')).toBe('polite');
    expect(view.status.getAttribute('aria-atomic')).toBe('true');
    expect(view.status.textContent).toContain('Responsive score layout');
  });

  it('preserves focused native input nodes while signals update the display and print status', async () => {
    const view = await fixture();
    view.preview.focus();
    view.preview.click();
    await nextTask();
    expect(view.state.view.get().preview).toBe(true);
    expect(view.host.applyPreview).toHaveBeenLastCalledWith(true);
    expect(view.status.textContent).toContain('configured print width');
    expect(document.activeElement).toBe(view.toolbar);
    expect(view.root.activeElement).toBe(view.preview);
    expect(view.root.querySelector('input')).toBe(view.preview);
    view.printButton.click();
    await nextTask();
    expect(view.printButton.disabled).toBe(true);
    expect(view.status.textContent).toContain('Preparing scores');
    view.completion.resolve();
    await nextTask();
    expect(view.host.requestPrint).toHaveBeenCalledOnce();
    expect(view.printButton.disabled).toBe(false);
    expect(view.status.textContent).toContain('Print dialog requested.');
    expect(view.root.querySelector('button')).toBe(view.printButton);
  });

  it('isolates state and help references even when instances use the same local IDs', async () => {
    const first = await fixture();
    const second = await fixture();
    expect(first.preview.id).not.toBe(second.preview.id);
    first.toolbar.idPrefix = 'shared-';
    second.toolbar.idPrefix = 'shared-';
    await Promise.all([first.toolbar.updateComplete, second.toolbar.updateComplete]);
    expect(first.preview.id).toBe('shared-print-preview');
    expect(second.preview.id).toBe(first.preview.id);
    const unrelatedHelp = document.createElement('p');
    unrelatedHelp.id = 'shared-print-layout-help';
    unrelatedHelp.textContent = 'Unrelated document help';
    document.body.append(unrelatedHelp);

    first.preview.click();
    await nextTask();
    expect(first.state.view.get().preview).toBe(true);
    expect(second.state.view.get().preview).toBe(false);
    expect(second.preview.checked).toBe(false);
    expect(first.preview.labels?.[0].control).toBe(first.preview);
    expect(second.preview.labels?.[0].control).toBe(second.preview);
    for (const view of [first, second]) {
      const ids = [...view.root.querySelectorAll('[id]')].map(element => element.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(view.root.getElementById(view.preview.getAttribute('aria-describedby')!)).not.toBe(unrelatedHelp);
      expect(view.root.getElementById('shared-print-layout-help')?.textContent).toContain('fixes score wrapping');
      expect(view.root.querySelector('input')).toBe(view.preview);
    }
    first.preview.focus();
    expect(document.activeElement).toBe(first.toolbar);
    expect(first.root.activeElement).toBe(first.preview);
  });

  it('adds actions and links after the core controls and restores source-link fallback when custom links are removed', async () => {
    const view = await fixture({ sourceHref: '#source' });
    const group = view.root.querySelector('[role="group"]')!;
    const actions = view.root.querySelector<HTMLSlotElement>('slot[name="actions"]')!;
    const links = view.root.querySelector<HTMLSlotElement>('slot[name="links"]')!;
    expect([...group.children]).toEqual([view.preview.closest('label'), view.printButton, actions, links]);
    expect(actions.assignedElements()).toEqual([]);
    expect(links.assignedElements()).toEqual([]);
    expect(links.querySelector('a')?.getAttribute('href')).toBe('#source');
    expect(links.querySelector('a')?.getAttribute('part')?.split(/\s+/)).toContain('link');

    const link = document.createElement('a');
    link.slot = 'links';
    link.href = '#consumer-source';
    link.textContent = 'Consumer source';
    view.toolbar.append(link);
    expect(links.assignedElements()).toEqual([link]);
    expect(link.parentElement).toBe(view.toolbar);
    expect(view.root.querySelector('a[href="#consumer-source"]')).toBeNull();

    view.toolbar.sourceHref = '#updated-source';
    view.state.setPreview(true);
    await nextTask();
    expect(view.root.querySelector('slot[name="links"]')).toBe(links);
    expect(links.assignedElements()).toEqual([link]);
    expect(links.querySelector('a')?.getAttribute('href')).toBe('#updated-source');
    link.remove();
    expect(links.assignedElements()).toEqual([]);
    expect(links.querySelector('a')?.textContent).toBe('Read the markup');

    view.toolbar.sourceHref = '';
    await view.toolbar.updateComplete;
    expect(links.querySelector('a')).toBeNull();
    view.toolbar.append(link);
    expect(links.assignedElements()).toEqual([link]);
    expect(view.root.querySelector('input')).toBe(view.preview);
    expect(view.root.querySelector('button')).toBe(view.printButton);
    // Assignment and fallback DOM are covered here; rendered slot visibility
    // and keyboard order are qualified by the browser toolbar fixtures.
  });

  it('preserves slotted native controls, labels, form ownership, state, listeners, and focus through updates and reconnects', async () => {
    const view = await fixture();
    const form = document.createElement('form');
    document.body.append(form);
    form.append(view.toolbar);
    const label = document.createElement('label');
    label.slot = 'actions';
    label.htmlFor = 'consumer-preview';
    const consumer = document.createElement('input');
    consumer.id = label.htmlFor;
    consumer.type = 'checkbox';
    consumer.name = 'consumer-choice';
    consumer.value = 'preserved';
    consumer.checked = true;
    label.append(consumer, 'Consumer preview');
    const action = document.createElement('button');
    action.slot = 'actions';
    action.type = 'button';
    action.disabled = true;
    action.textContent = 'Consumer action';
    const click = vi.fn();
    action.addEventListener('click', click);
    const change = vi.fn();
    view.toolbar.addEventListener('change', change);
    view.toolbar.append(label, action);
    await nextTask();
    const actions = view.root.querySelector<HTMLSlotElement>('slot[name="actions"]')!;
    consumer.focus();

    view.state.setPreview(true);
    view.state.setDisabled(true);
    await nextTask();
    expect(actions.assignedElements()).toEqual([label, action]);
    expect(view.toolbar.querySelector('input')).toBe(consumer);
    expect(consumer.getRootNode()).toBe(document);
    expect(consumer.labels?.[0]).toBe(label);
    expect(label.control).toBe(consumer);
    expect(consumer.form).toBe(form);
    expect(new FormData(form).get('consumer-choice')).toBe('preserved');
    expect(consumer.checked).toBe(true);
    expect(consumer.disabled).toBe(false);
    expect(action.disabled).toBe(true);
    expect(document.activeElement).toBe(consumer);
    expect(view.root.querySelector('input')).toBe(view.preview);
    expect(view.root.querySelector('button')).toBe(view.printButton);

    view.toolbar.remove();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    view.state.setPreview(false);
    view.state.setDisabled(false);
    form.append(view.toolbar);
    await nextTask();
    expect(view.toolbar.shadowRoot).toBe(view.root);
    expect(actions.assignedElements()).toEqual([label, action]);
    expect(consumer.form).toBe(form);
    expect(consumer.checked).toBe(true);
    expect(action.disabled).toBe(true);
    expect(document.activeElement).toBe(outside);

    consumer.focus();
    view.state.setPreview(true);
    await nextTask();
    expect(document.activeElement).toBe(consumer);
    consumer.click();
    expect(consumer.checked).toBe(false);
    expect(change).toHaveBeenCalledOnce();
    expect(change.mock.calls[0][0].target).toBe(consumer);
    expect(view.state.view.get().preview).toBe(true);
    action.disabled = false;
    action.click();
    expect(click).toHaveBeenCalledOnce();
    expect(view.host.requestPrint).not.toHaveBeenCalled();
    expect(view.state.view.get().preparing).toBe(false);
  });

  it('renders an unbound toolbar and cancels preparation when its model is cleared', async () => {
    const toolbar = document.createElement('music-workbook-toolbar');
    document.body.append(toolbar);
    await toolbar.updateComplete;
    const root = toolbar.shadowRoot!;
    const preview = root.querySelector<HTMLInputElement>('input')!;
    const printButton = root.querySelector<HTMLButtonElement>('button')!;
    const status = root.querySelector('[role="status"]')!;
    expect(preview.checked).toBe(false);
    expect(printButton.disabled).toBe(true);
    expect(status.textContent).toBe('Loading score controls…');

    const completion = deferred();
    const score = { renderComplete: completion.promise, diagnostics: [] };
    const host = { readScores: () => [score], applyPreview: vi.fn(), requestPrint: vi.fn() };
    const state = new WorkbookState(host, { preview: true });
    toolbar.model = state;
    await nextTask();
    expect(preview.checked).toBe(true);
    expect(printButton.disabled).toBe(false);
    printButton.click();
    await nextTask();
    expect(state.view.get().preparing).toBe(true);
    toolbar.model = undefined;
    await nextTask();
    expect(state.view.get().preparing).toBe(false);
    expect(preview.checked).toBe(false);
    expect(printButton.disabled).toBe(true);
    expect(status.textContent).toBe('Loading score controls…');
    const update = vi.spyOn(toolbar, 'requestUpdate');
    completion.resolve();
    state.setPreview(false);
    await nextTask();
    expect(host.requestPrint).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(root.querySelector('input')).toBe(preview);
    expect(root.querySelector('button')).toBe(printButton);
    expect(root.querySelectorAll('slot')).toHaveLength(2);
  });

  it('cancels a pending print when disconnected and resumes observation when reconnected', async () => {
    const view = await fixture();
    view.printButton.click();
    view.toolbar.remove();
    view.completion.resolve();
    await nextTask();
    expect(view.host.requestPrint).not.toHaveBeenCalled();
    expect(view.state.view.get().preparing).toBe(false);
    view.state.setPreview(true);
    await nextTask();
    expect(view.preview.checked).toBe(false);
    document.body.append(view.toolbar);
    await nextTask();
    expect(view.preview.checked).toBe(true);
    expect(view.printButton.disabled).toBe(false);
    view.printButton.click();
    await nextTask();
    expect(view.host.requestPrint).toHaveBeenCalledOnce();
  });

  it('uses the latest replacement model after reconnecting without recreating its controls', async () => {
    const view = await fixture();
    view.toolbar.remove();
    const score = { renderComplete: Promise.resolve(), diagnostics: [] };
    const replacementHost = { readScores: () => [score], applyPreview: vi.fn(), requestPrint: vi.fn() };
    const replacement = new WorkbookState(replacementHost, { disabled: true });
    view.toolbar.model = replacement;
    await nextTask();
    replacement.setPreview(true);
    replacement.setDisabled(false);
    await nextTask();
    expect(view.preview.checked).toBe(false);

    document.body.append(view.toolbar);
    await nextTask();
    expect(view.toolbar.shadowRoot).toBe(view.root);
    expect(view.root.querySelector('input')).toBe(view.preview);
    expect(view.root.querySelector('button')).toBe(view.printButton);
    expect(view.preview.checked).toBe(true);
    expect(view.printButton.disabled).toBe(false);
    view.state.setPreview(false);
    await nextTask();
    expect(view.preview.checked).toBe(true);
    view.printButton.click();
    await nextTask();
    expect(replacementHost.requestPrint).toHaveBeenCalledOnce();
    expect(view.host.requestPrint).not.toHaveBeenCalled();
  });

  it('cancels old preparation and follows a replacement model without replacing controls', async () => {
    const view = await fixture();
    view.printButton.click();
    const replacementScore = { renderComplete: Promise.resolve(), diagnostics: [] };
    const replacementHost = { readScores: () => [replacementScore], applyPreview: vi.fn(), requestPrint: vi.fn() };
    const replacement = new WorkbookState(replacementHost, { preview: true });
    view.toolbar.model = replacement;
    await nextTask();
    view.completion.resolve();
    await nextTask();
    expect(view.host.requestPrint).not.toHaveBeenCalled();
    expect(view.preview.checked).toBe(true);
    expect(view.root.querySelector('input')).toBe(view.preview);
    const update = vi.spyOn(view.toolbar, 'requestUpdate');
    view.state.setPreview(false);
    await nextTask();
    expect(view.preview.checked).toBe(true);
    expect(update).not.toHaveBeenCalled();
    view.printButton.click();
    await nextTask();
    expect(replacementHost.requestPrint).toHaveBeenCalledOnce();
  });

  it('keeps the standalone template usable in light DOM without introducing slots', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const preview = vi.fn();
    const print = vi.fn();
    render(workbookToolbarTemplate(
      { preview: false, disabled: false, preparing: false, status: 'Ready' },
      { preview, print },
      { sourceHref: '#markup' },
    ), host);

    expect(host.querySelector('slot')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('#markup');
    const checkbox = host.querySelector('input')!;
    expect(checkbox.labels?.[0].control).toBe(checkbox);
    expect(document.getElementById(checkbox.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    checkbox.click();
    host.querySelector('button')!.click();
    expect(preview).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Ready');
  });

  it('routes the component through the score DOM adapter without changing authored source', async () => {
    const score = document.createElement('music-staff');
    score.setAttribute('data-score', '');
    score.innerHTML = '<music-measure><music-rest measure></music-rest></music-measure>';
    const source = score.firstElementChild!;
    Object.defineProperties(score, {
      renderComplete: { get: () => completion },
      diagnostics: { get: () => [] },
    });
    const completion = Promise.resolve();
    const requestPrint = vi.fn();
    const toolbar = document.createElement('music-workbook-toolbar');
    document.body.append(toolbar, score);
    toolbar.model = createWorkbookState({ root: document.body, requestPrint });
    await toolbar.updateComplete;
    toolbar.renderRoot.querySelector<HTMLInputElement>('input')!.click();
    await nextTask();
    expect(score.hasAttribute('print-preview')).toBe(true);
    toolbar.renderRoot.querySelector<HTMLButtonElement>('button')!.click();
    await nextTask();
    expect(requestPrint).toHaveBeenCalledOnce();
    expect(score.firstElementChild).toBe(source);
    expect(source.outerHTML).toBe('<music-measure><music-rest measure=""></music-rest></music-measure>');
  });
});
