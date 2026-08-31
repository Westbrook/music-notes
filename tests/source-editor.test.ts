// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicSourceEditor } from '../src/authoring/ui/source-editor.js';

type SourceState = Parameters<MusicSourceEditor['renderState']>[0];
const source = '<music-staff><music-measure incomplete></music-measure></music-staff>';

function state(changes: Partial<SourceState> = {}): SourceState {
  return { documentId: 'opened-1', value: source, status: 'Source and engraving agree.', readOnly: false, ...changes };
}

function fixture(parent: HTMLElement | ShadowRoot = document.body) {
  const editor = document.createElement('music-source-editor') as MusicSourceEditor;
  parent.append(editor);
  editor.mount();
  const root = editor.shadowRoot!;
  const input = root.getElementById('source-input') as HTMLTextAreaElement;
  const error = root.getElementById('source-error')!;
  const status = root.getElementById('source-status')!;
  const apply = root.getElementById('source-apply') as HTMLButtonElement;
  const revert = root.getElementById('source-revert') as HTMLButtonElement;
  return { editor, root, input, error, status, apply, revert };
}

function expectClear(view: ReturnType<typeof fixture>): void {
  expect(view.editor.failureMessage).toBe('');
  expect(view.error.textContent).toBe('');
  expect(view.error.hidden).toBe(true);
  expect(view.input.hasAttribute('aria-invalid')).toBe(false);
}

afterEach(() => document.body.replaceChildren());

describe('MusicSourceEditor component', () => {
  it('mounts native labelled source controls synchronously and starts read-only until state is supplied', () => {
    const view = fixture();
    expect(customElements.get('music-source-editor')).toBe(MusicSourceEditor);
    expect(view.editor).toBeInstanceOf(MusicSourceEditor);
    expect(view.root.mode).toBe('open');
    expect(view.editor.renderRoot).toBe(view.root);
    expect(view.editor.querySelector('textarea, button, [role="alert"]')).toBeNull();
    expect(view.input).toBeInstanceOf(HTMLTextAreaElement);
    expect(view.input.labels).toHaveLength(1);
    expect(view.input.labels![0].control).toBe(view.input);
    expect(view.input.labels![0].textContent?.trim()).toBeTruthy();
    expect(view.input.getAttribute('aria-describedby')).toBe('source-status source-error');
    for (const id of view.input.getAttribute('aria-describedby')!.split(/\s+/)) {
      expect(view.root.getElementById(id)?.getRootNode()).toBe(view.root);
      expect(document.getElementById(id)).toBeNull();
    }
    expect(view.error.getAttribute('role')).toBe('alert');
    expect(view.status.getAttribute('role')).toBe('status');
    expect(view.input.readOnly).toBe(true);
    expect(view.input.disabled).toBe(false);
    expect(view.apply.disabled).toBe(true);
    expect(view.revert.disabled).toBe(true);
    expect(view.apply.type).toBe('button');
    expect(view.revert.type).toBe('button');
    expectClear(view);

    const supplied = Object.freeze(state());
    view.editor.renderState(supplied);
    expect(view.input.value).toBe(source);
    expect(view.editor.inputValue).toBe(source);
    expect(view.status.textContent).toBe(supplied.status);
    expect(view.input.readOnly).toBe(false);
    expect(view.apply.disabled).toBe(false);
    expect(view.revert.disabled).toBe(false);
    view.editor.mount();
    expect(view.root.getElementById('source-input')).toBe(view.input);
    expect(view.root.getElementById('source-error')).toBe(view.error);
    expect(supplied).toEqual(state());
  });

  it('isolates repeated internal IDs, state, and feedback from other editors and document decoys', () => {
    const decoyInput = document.createElement('textarea');
    decoyInput.id = 'source-input';
    decoyInput.value = 'Document-owned source';
    const decoyError = document.createElement('p');
    decoyError.id = 'source-error';
    decoyError.setAttribute('role', 'alert');
    decoyError.textContent = 'Document-owned error';
    const decoyStatus = document.createElement('p');
    decoyStatus.id = 'source-status';
    decoyStatus.textContent = 'Document-owned status';
    document.body.append(decoyInput, decoyError, decoyStatus);
    const first = fixture();
    const second = fixture();
    first.editor.renderState(state());
    second.editor.renderState(state({ documentId: 'opened-2', value: 'Second draft', status: 'Second status', readOnly: true }));
    first.editor.fail('opened-1', source, 'First failure');
    second.editor.fail('opened-2', 'Second draft', 'Second failure');
    first.editor.refreshFailure('opened-1', `${source}\n`);

    expect(first.input.id).toBe(second.input.id);
    expect(first.input).not.toBe(second.input);
    expect(first.input.value).toBe(source);
    expect(second.input.value).toBe('Second draft');
    expect(second.status.textContent).toBe('Second status');
    expect(second.input.readOnly).toBe(true);
    expectClear(first);
    expect(second.editor.failureMessage).toBe('Second failure');
    expect(second.input.getAttribute('aria-invalid')).toBe('true');
    expect(second.error.textContent).toBe('Second failure');
    expect(decoyInput.value).toBe('Document-owned source');
    expect(decoyInput.hasAttribute('aria-invalid')).toBe(false);
    expect(decoyError.textContent).toBe('Document-owned error');
    expect(decoyStatus.textContent).toBe('Document-owned status');
    expect(first.input.labels![0].control).toBe(first.input);
    expect(second.input.labels![0].control).toBe(second.input);
  });

  it('preserves focused drafts, selection, direction, and scrolling unless the owner forces replacement', async () => {
    const outer = document.createElement('section');
    document.body.append(outer);
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const view = fixture(outerRoot);
    view.editor.renderState(state());
    view.editor.focusInput();
    expect(document.activeElement).toBe(outer);
    expect(outerRoot.activeElement).toBe(view.editor);
    expect(view.root.activeElement).toBe(view.input);
    const draft = `${source}\n<!-- Draft still being edited -->`;
    view.input.value = draft;
    view.input.setSelectionRange(7, 27, 'backward');
    view.input.scrollTop = 144;
    view.input.scrollLeft = 32;
    view.editor.fail('opened-1', draft, 'This exact local draft failed.');
    const focus = vi.spyOn(view.input, 'focus');

    view.editor.renderState(state({ value: 'A newer owner value', status: 'Read-only review', readOnly: true }));
    await view.editor.updateComplete;
    expect(view.input.value).toBe(draft);
    expect(view.editor.inputValue).toBe(draft);
    expect(view.input.selectionStart).toBe(7);
    expect(view.input.selectionEnd).toBe(27);
    expect(view.input.selectionDirection).toBe('backward');
    expect(view.input.scrollTop).toBe(144);
    expect(view.input.scrollLeft).toBe(32);
    expect(view.input.readOnly).toBe(true);
    expect(view.input.disabled).toBe(false);
    expect(view.status.textContent).toBe('Read-only review');
    expect(view.editor.failureMessage).toBe('This exact local draft failed.');
    expect(view.input.getAttribute('aria-invalid')).toBe('true');
    expect(view.root.activeElement).toBe(view.input);
    expect(focus).not.toHaveBeenCalled();
    expect(view.root.getElementById('source-input')).toBe(view.input);

    view.editor.renderState(state({ documentId: 'opened-2', value: 'Explicit replacement' }), { forceValue: true });
    expect(view.input.value).toBe('Explicit replacement');
    expect(view.editor.inputValue).toBe('Explicit replacement');
    expectClear(view);
    expect(view.root.activeElement).toBe(view.input);
    expect(focus).not.toHaveBeenCalled();
  });

  it('accepts an unfocused owner value without taking focus or emitting edit requests', () => {
    const view = fixture();
    view.editor.renderState(state());
    view.editor.focusInput();
    view.input.value = 'Locally edited source';
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const changed = vi.fn();
    const input = vi.fn();
    view.editor.addEventListener('source-change', changed);
    view.input.addEventListener('input', input);
    const focus = vi.spyOn(view.input, 'focus');

    view.editor.renderState(state({ value: 'New accepted source', status: 'Reverted' }));
    expect(view.input.value).toBe('New accepted source');
    expect(view.editor.inputValue).toBe('New accepted source');
    expect(view.status.textContent).toBe('Reverted');
    expect(document.activeElement).toBe(outside);
    expect(focus).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });

  it('emits composed source intents with the current native draft across a containing shadow root', () => {
    const outer = document.createElement('section');
    document.body.append(outer);
    const view = fixture(outer.attachShadow({ mode: 'open' }));
    const supplied = Object.freeze(state());
    view.editor.renderState(supplied);
    const events: Event[] = [];
    const paths: EventTarget[][] = [];
    for (const name of ['source-change', 'source-apply', 'source-revert']) {
      outer.addEventListener(name, event => {
        events.push(event);
        paths.push(event.composedPath());
      });
    }

    view.input.value = `${source}\nFirst local edit`;
    view.input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 't' }));
    // The owner has not republished state. Applying still reads the live draft.
    view.input.value = `${source}\nLatest local edit`;
    view.apply.click();
    view.revert.click();

    expect(events.map(event => event.type)).toEqual(['source-change', 'source-apply', 'source-revert']);
    expect((events[0] as CustomEvent).detail).toEqual({ value: `${source}\nFirst local edit` });
    expect((events[1] as CustomEvent).detail).toEqual({ value: `${source}\nLatest local edit` });
    expect([null, undefined]).toContain((events[2] as CustomEvent).detail);
    for (const event of events) {
      expect(event.bubbles).toBe(true);
      expect(event.composed).toBe(true);
    }
    for (const path of paths) {
      expect(path).toContain(view.editor);
      expect(path).toContain(outer.shadowRoot);
      expect(path).toContain(outer);
    }
    expect(view.editor.inputValue).toBe(`${source}\nLatest local edit`);
    expect(view.status.textContent).toBe(supplied.status);
    expect(supplied).toEqual(state());
  });

  it('keeps read-only source selectable while suppressing edit, apply, and revert intents', () => {
    const view = fixture();
    view.editor.renderState(state({ readOnly: true }));
    const intent = vi.fn();
    for (const name of ['source-change', 'source-apply', 'source-revert']) view.editor.addEventListener(name, intent);
    view.editor.focusInput();
    view.input.setSelectionRange(2, 16);
    expect(view.root.activeElement).toBe(view.input);
    expect(view.input.selectionStart).toBe(2);
    expect(view.input.selectionEnd).toBe(16);
    expect(view.input.readOnly).toBe(true);
    expect(view.input.disabled).toBe(false);
    expect(view.apply.disabled).toBe(true);
    expect(view.revert.disabled).toBe(true);

    view.input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    view.apply.click();
    view.revert.click();
    // Direct dispatch checks the semantic guard as well as native disabled clicks.
    view.apply.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    view.revert.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(intent).not.toHaveBeenCalled();
    view.editor.renderState(state());
    view.apply.click();
    expect(intent).toHaveBeenCalledOnce();
    expect(intent.mock.calls[0][0].type).toBe('source-apply');
  });

  it('keeps source, status, and validation diagnostics as literal text', () => {
    const view = fixture();
    const unsafe = '<img src=x onerror="unsafe()"> & <script>unsafe()</script>';
    const supplied = Object.freeze(state({ documentId: '\" data-injected="true', value: unsafe, status: unsafe }));
    view.editor.renderState(supplied);
    view.editor.fail(supplied.documentId, unsafe, unsafe);
    expect(view.input.value).toBe(unsafe);
    expect(view.status.textContent).toBe(unsafe);
    expect(view.error.textContent).toBe(unsafe);
    expect(view.error.children).toHaveLength(0);
    expect(view.root.querySelector('img, script, [onerror], [data-injected]')).toBeNull();
    expect(view.editor.failureMessage).toBe(unsafe);
    expect(view.input.getAttribute('aria-invalid')).toBe('true');
  });

  it('retains a local failure and its native mounts through status/read-only rerenders', async () => {
    const view = fixture();
    view.editor.renderState(state());
    view.editor.fail('opened-1', source, 'The measure contains unsupported notation.');
    for (const readOnly of [true, false, true]) {
      view.editor.renderState(state({ readOnly, status: `Review ${readOnly}` }));
      await view.editor.updateComplete;
      view.editor.refreshFailure('opened-1', source);
      expect(view.root.getElementById('source-input')).toBe(view.input);
      expect(view.root.getElementById('source-error')).toBe(view.error);
      expect(view.root.getElementById('source-status')).toBe(view.status);
      expect(view.error.getAttribute('role')).toBe('alert');
      expect(view.error.hidden).toBe(false);
      expect(view.error.textContent).toBe('The measure contains unsupported notation.');
      expect(view.editor.failureMessage).toBe('The measure contains unsupported notation.');
      expect(view.input.getAttribute('aria-invalid')).toBe('true');
      expect(view.input.value).toBe(source);
      expect(view.status.textContent).toBe(`Review ${readOnly}`);
    }
  });

  it('clears failures for a changed draft, a different opened document, or explicit replacement', () => {
    const view = fixture();
    view.editor.renderState(state());
    view.editor.fail('opened-1', source, 'Draft error');
    view.editor.refreshFailure('opened-1', `${source}\n`);
    expectClear(view);
    view.editor.refreshFailure('opened-1', source);
    expectClear(view);

    view.editor.fail('opened-1', source, 'Earlier document error');
    view.editor.refreshFailure('opened-2', source);
    expectClear(view);
    view.editor.fail('opened-2', source, 'Reopened document error');
    view.editor.clearFailure();
    view.editor.refreshFailure('opened-2', source);
    view.editor.renderState(state({ documentId: 'opened-2', status: 'New review' }));
    expectClear(view);

    view.editor.fail('opened-2', source, 'Failure before document change');
    view.editor.renderState(state({ documentId: 'opened-3' }));
    expectClear(view);
    view.editor.fail('opened-3', source, 'Failure before source refresh');
    view.editor.renderState(state({ documentId: 'opened-3', value: `${source}\n` }));
    expectClear(view);
  });

  it('preserves draft, feedback, native listeners, and node identity through disconnect and reconnect', async () => {
    const view = fixture();
    view.editor.renderState(state());
    const draft = `${source}\n<!-- Local draft -->`;
    view.input.value = draft;
    const input = vi.fn();
    const changed = vi.fn();
    view.input.addEventListener('input', input);
    view.editor.addEventListener('source-change', changed);
    view.input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    view.editor.fail('opened-1', draft, 'Retained local failure');
    view.editor.remove();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    document.body.append(view.editor);
    view.editor.mount();
    await view.editor.updateComplete;

    expect(view.editor.shadowRoot).toBe(view.root);
    expect(view.root.getElementById('source-input')).toBe(view.input);
    expect(view.root.getElementById('source-error')).toBe(view.error);
    expect(view.root.getElementById('source-apply')).toBe(view.apply);
    expect(view.root.getElementById('source-revert')).toBe(view.revert);
    expect(view.editor.inputValue).toBe(draft);
    expect(view.editor.failureMessage).toBe('Retained local failure');
    expect(view.error.textContent).toBe('Retained local failure');
    expect(view.input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(outside);
    view.input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    expect(input).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[1][0].detail).toEqual({ value: draft });
    view.editor.focusInput();
    expect(document.activeElement).toBe(view.editor);
    expect(view.root.activeElement).toBe(view.input);
  });
});
