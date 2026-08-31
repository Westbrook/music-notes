import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderNativeOptions, type NativeOption } from '../src/ui/native-options.js';
import { bravuraNoteQuarterUp, bravuraNote8thUp, bravuraRestQuarter } from '../src/ui/icons/bravura.js';

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

  it.each([false, true])('keeps icon options native and their labels textual (customizable: %s)', customizable => {
    const select = fixture(customizable);
    const options = [
      { value: 'quarter', label: 'Quarter note', icon: bravuraNoteQuarterUp },
      { value: 'rest', label: 'Quarter rest', icon: bravuraRestQuarter, disabled: true },
    ] satisfies readonly NativeOption[];

    expect(renderNativeOptions(select, options, 'quarter')).toBe('quarter');

    expect([...select.options].map(option => option.textContent)).toEqual(['Quarter note', 'Quarter rest']);
    // happy-dom does not implement option.label. With no overriding label
    // attribute, the browser uses this native text as the option label.
    expect([...select.options].map(option => option.text)).toEqual(['Quarter note', 'Quarter rest']);
    expect([...select.options].every(option => !option.hasAttribute('label'))).toBe(true);
    expect([...select.options].map(option => option.getAttribute('aria-label'))).toEqual(['Quarter note', 'Quarter rest']);
    expect([...select.options].map(option => option.value)).toEqual(['quarter', 'rest']);
    expect(select.selectedOptions[0]).toBe(select.options[0]);
    expect(select.options[1].disabled).toBe(true);
    expect(new FormData(select.form!).get('voice')).toBe('quarter');
    expect(select.options[0].querySelector('svg')?.getAttribute('data-icon')).toBe(bravuraNoteQuarterUp.name);
    expect(select.options[0].querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect([...select.options[0].querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual(bravuraNoteQuarterUp.paths);
    expect(select.options[0].querySelector('music-icon, svg text')).toBeNull();
    expect(select.options[0].querySelector('button, input, a, [tabindex], [role]')).toBeNull();
    expect(select.querySelectorAll('selectedcontent')).toHaveLength(customizable ? 1 : 0);
    expect(select.getAttribute('role')).toBeNull();
  });

  it('retains keyed options and refreshes native selection when a selected icon or label changes', () => {
    const select = fixture(true);
    const initial = [
      { value: 'note', label: 'Quarter note', icon: bravuraNoteQuarterUp },
      { value: 'rest', label: 'Rest' },
    ] satisfies readonly NativeOption[];
    renderNativeOptions(select, initial, 'note');
    const note = select.options[0];
    const rest = select.options[1];
    const icon = note.querySelector('svg');
    const label = note.querySelector('.option-label');
    const button = select.firstElementChild;
    const selectedcontent = button?.querySelector('selectedcontent');
    const setValue = vi.spyOn(select, 'value', 'set');

    renderNativeOptions(select, [
      initial[1],
      { value: 'note', label: 'Eighth note', icon: bravuraNote8thUp },
    ], 'note');

    expect([...select.options]).toEqual([rest, note]);
    expect(note.querySelector('svg')).toBe(icon);
    expect(note.querySelector('.option-label')).toBe(label);
    expect(icon?.getAttribute('data-icon')).toBe(bravuraNote8thUp.name);
    expect([...note.querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual(bravuraNote8thUp.paths);
    expect(note.textContent).toBe('Eighth note');
    expect(note.text).toBe('Eighth note');
    expect(note.getAttribute('aria-label')).toBe('Eighth note');
    expect(select.selectedOptions[0]).toBe(note);
    expect(setValue).toHaveBeenCalledExactlyOnceWith('note');
    expect(select.firstElementChild).toBe(button);
    expect(button?.querySelector('selectedcontent')).toBe(selectedcontent);
    expect(new FormData(select.form!).get('voice')).toBe('note');

    renderNativeOptions(select, [{ value: 'note', label: 'Plain note' }], 'note');
    expect(select.options[0]).toBe(note);
    expect(note.querySelector('svg')).toBeNull();
    expect(note.text).toBe('Plain note');
    expect(note.getAttribute('aria-label')).toBeNull();
  });
});
