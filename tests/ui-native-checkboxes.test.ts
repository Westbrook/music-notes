import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderNativeCheckboxes } from '../src/ui/native-checkboxes.js';

afterEach(() => document.body.replaceChildren());

function fixture(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

describe('Lit native checkbox choices', () => {
  it('associates each visible label with its checkbox even when labels match', () => {
    const host = fixture();
    const inputs = renderNativeCheckboxes(host, [
      { value: 'upper', label: 'Voice' },
      { value: 'lower', label: 'Voice' },
    ]);

    expect(inputs).toEqual([...host.querySelectorAll('input')]);
    expect(inputs.map(input => input.value)).toEqual(['upper', 'lower']);
    for (const input of inputs) {
      const label = input.closest('label');
      expect(input.type).toBe('checkbox');
      expect(label?.classList.contains('check-field')).toBe(true);
      expect(input.labels).toHaveLength(1);
      expect(input.labels![0]).toBe(label);
      expect(label?.control).toBe(input);
      expect(label?.textContent?.trim()).toBe('Voice');
    }

    inputs[1].labels![0].click();
    expect(inputs[0].checked).toBe(false);
    expect(inputs[1].checked).toBe(true);
    const ids = [...host.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves controller-owned checked and disabled properties across label updates and reordering', () => {
    const host = fixture();
    const [upper, lower] = renderNativeCheckboxes(host, [
      { value: 'upper', label: 'Upper voice' },
      { value: 'lower', label: 'Lower voice' },
    ]);
    upper.checked = true;
    upper.disabled = true;
    lower.checked = false;
    lower.disabled = false;
    const upperLabel = upper.labels![0];
    const lowerLabel = lower.labels![0];

    const reordered = renderNativeCheckboxes(host, [
      { value: 'lower', label: 'Bass' },
      { value: 'upper', label: 'Soprano' },
    ]);
    expect(reordered).toEqual([lower, upper]);
    expect(upper.labels![0]).toBe(upperLabel);
    expect(lower.labels![0]).toBe(lowerLabel);
    expect(upperLabel.textContent?.trim()).toBe('Soprano');
    expect(lowerLabel.textContent?.trim()).toBe('Bass');
    expect(upper.checked).toBe(true);
    expect(upper.disabled).toBe(true);
    expect(lower.checked).toBe(false);
    expect(lower.disabled).toBe(false);

    upper.checked = false;
    upper.disabled = false;
    lower.checked = true;
    lower.disabled = true;
    renderNativeCheckboxes(host, [
      { value: 'lower', label: 'Lower voice' },
      { value: 'upper', label: 'Upper voice' },
    ]);
    expect(upper.checked).toBe(false);
    expect(upper.disabled).toBe(false);
    expect(lower.checked).toBe(true);
    expect(lower.disabled).toBe(true);
  });

  it('lets native changes bubble to a controller on the host without emitting changes during rendering', () => {
    const host = fixture();
    const change = vi.fn();
    host.addEventListener('change', change);
    const [input] = renderNativeCheckboxes(host, [{ value: 'voice', label: 'Voice' }]);
    renderNativeCheckboxes(host, [{ value: 'voice', label: 'Renamed voice' }]);
    expect(change).not.toHaveBeenCalled();

    input.click();
    expect(input.checked).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0][0].target).toBe(input);
    expect(change.mock.calls[0][0].bubbles).toBe(true);

    renderNativeCheckboxes(host, [{ value: 'voice', label: 'Voice' }]);
    expect(input.checked).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on a retained choice after reordering without refocusing ordinary updates', () => {
    const host = fixture();
    const options = [{ value: 'upper', label: 'Upper' }, { value: 'lower', label: 'Lower' }];
    const [upper, lower] = renderNativeCheckboxes(host, options);
    upper.focus();
    const focus = vi.spyOn(upper, 'focus');

    renderNativeCheckboxes(host, [{ ...options[0], label: 'Soprano' }, options[1]]);
    expect(document.activeElement).toBe(upper);
    expect(focus).not.toHaveBeenCalled();

    expect(renderNativeCheckboxes(host, [options[1], options[0]])).toEqual([lower, upper]);
    expect(document.activeElement).toBe(upper);

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    focus.mockClear();
    renderNativeCheckboxes(host, options);
    expect(document.activeElement).toBe(outside);
    expect(focus).not.toHaveBeenCalled();
  });

  it('leaves replacement focus to the controller when the focused choice is removed', () => {
    const host = fixture();
    const [upper, lower] = renderNativeCheckboxes(host, [
      { value: 'upper', label: 'Upper' },
      { value: 'lower', label: 'Lower' },
    ]);
    upper.focus();
    const removedFocus = vi.spyOn(upper, 'focus');
    const remainingFocus = vi.spyOn(lower, 'focus');

    expect(renderNativeCheckboxes(host, [{ value: 'lower', label: 'Lower' }])).toEqual([lower]);
    expect(upper.isConnected).toBe(false);
    expect(removedFocus).not.toHaveBeenCalled();
    expect(remainingFocus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(lower);
    expect(renderNativeCheckboxes(host, [])).toEqual([]);
    expect(host.querySelector('input, label')).toBeNull();
  });

  it('treats labels and values as text and keeps independent hosts isolated', () => {
    const host = fixture();
    const other = fixture();
    const label = '<img src=x onerror="alert(1)"> & <script>unsafe()</script>';
    const value = '\" data-injected="true';
    const options = Object.freeze([Object.freeze({ value, label })]);
    const [input] = renderNativeCheckboxes(host, options);
    const [otherInput] = renderNativeCheckboxes(other, options);
    input.checked = true;
    otherInput.disabled = true;

    expect(renderNativeCheckboxes(host, options)).toEqual([input]);
    expect(input.labels![0].textContent?.trim()).toBe(label);
    expect(otherInput.labels![0].textContent?.trim()).toBe(label);
    expect(input.value).toBe(value);
    expect(otherInput.value).toBe(value);
    expect(host.querySelector('img, script, [data-injected]')).toBeNull();
    expect(input.labels![0].control).toBe(input);
    expect(otherInput.labels![0].control).toBe(otherInput);
    expect(otherInput).not.toBe(input);
    expect(otherInput.checked).toBe(false);
    expect(otherInput.disabled).toBe(true);
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);

    renderNativeCheckboxes(host, []);
    expect(other.querySelector('input')).toBe(otherInput);
    expect(otherInput.labels![0].control).toBe(otherInput);
    expect(otherInput.disabled).toBe(true);
  });
});
