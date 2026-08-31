import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderNativeOptions } from '../src/ui/native-options.js';

afterEach(() => document.body.replaceChildren());

function fixture(customizable: boolean): HTMLSelectElement {
  document.body.innerHTML = '<form><label for="voice">Voice</label><select id="voice" name="voice"><option value="initial">Initial</option></select></form>';
  const select = document.querySelector('select')!;
  if (customizable) {
    const button = document.createElement('button');
    button.type = 'button';
    button.append(document.createElement('selectedcontent'));
    select.prepend(button);
  }
  return select;
}

describe('Lit native options', () => {
  it('preserves the native select button, labels, focus, and form value across updates', () => {
    const select = fixture(true);
    const button = select.firstElementChild!;
    const selectedcontent = button.firstElementChild;
    const options = [{ value: 'upper', label: 'Upper voice' }, { value: 'lower', label: 'Lower voice' }];
    const change = vi.fn();
    select.addEventListener('change', change);
    select.focus();

    expect(renderNativeOptions(select, options, 'lower')).toBe('lower');
    const upper = select.options[0];
    const lower = select.options[1];
    expect(renderNativeOptions(select, [{ value: 'lower', label: 'Bass voice' }, options[0]], 'lower')).toBe('lower');

    expect(select.firstElementChild).toBe(button);
    expect(button.firstElementChild).toBe(selectedcontent);
    expect(select.querySelectorAll('selectedcontent')).toHaveLength(1);
    expect([...select.options]).toEqual([lower, upper]);
    expect(lower.textContent).toBe('Bass voice');
    expect(document.activeElement).toBe(select);
    expect(select.labels?.[0].textContent).toBe('Voice');
    expect(new FormData(select.form!).get('voice')).toBe('lower');
    expect(change).not.toHaveBeenCalled();
  });

  it('reassigns an unchanged value so the browser refreshes selectedcontent after a label edit', () => {
    const select = fixture(true);
    renderNativeOptions(select, [{ value: 'voice', label: 'Voice 1' }], 'voice');
    const setValue = vi.spyOn(select, 'value', 'set');
    renderNativeOptions(select, [{ value: 'voice', label: 'Soprano' }], 'voice');
    expect(setValue).toHaveBeenCalledExactlyOnceWith('voice');
    // The DOM emulator does not implement selectedcontent cloning. The value
    // setter is the native refresh path; browser qualification covers cloning.
    expect(select.selectedOptions[0].textContent).toBe('Soprano');
  });

  it('keeps ordinary selects usable without inventing button or listbox semantics', () => {
    const select = fixture(false);
    select.required = true;
    const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }];
    renderNativeOptions(select, options, 'a');
    const disabled = select.options[1];
    expect(select.querySelector('button, selectedcontent')).toBeNull();
    expect(select.getAttribute('role')).toBeNull();
    expect(select.getAttribute('tabindex')).toBeNull();
    expect(select.required).toBe(true);
    expect(disabled.disabled).toBe(true);
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);

    renderNativeOptions(select, [{ ...options[1], disabled: false }], 'missing');
    expect(select.options[0]).toBe(disabled);
    expect(disabled.disabled).toBe(false);
    expect(select.value).toBe('b');
    expect(renderNativeOptions(select, [], 'b')).toBe('');
    expect(select.options).toHaveLength(0);
    expect(select.selectedIndex).toBe(-1);
  });

  it('treats labels and values as text and keeps each select independent', () => {
    const select = fixture(false);
    const other = document.createElement('select');
    document.body.append(other);
    const label = '<img src=x onerror="alert(1)"> & <script>unsafe()</script>';
    const value = '" data-injected="true';
    const options = Object.freeze([Object.freeze({ label, value })]);

    renderNativeOptions(select, options, value);
    renderNativeOptions(other, [{ value: 'other', label: 'Other' }], 'other');
    renderNativeOptions(select, options, value);

    expect(select.options[0].textContent).toBe(label);
    expect(select.options[0].value).toBe(value);
    expect(select.querySelector('img, script, [data-injected]')).toBeNull();
    expect(other.options[0].textContent).toBe('Other');
    expect(other.value).toBe('other');
  });
});
