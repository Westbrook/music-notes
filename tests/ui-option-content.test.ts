import { html, render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bravuraNoteQuarterUp, bravuraAccidentalFlat } from '../src/ui/icons/bravura.js';
import { phArrowUUpLeft } from '../src/ui/icons/phosphor.js';
import { nativeOptionTemplate, nativeSelectDefault } from '../src/ui/option-content.js';

afterEach(() => document.body.replaceChildren());

describe('Lit native option content', () => {
  it('renders SVG paths immediately and leaves a safe, exact label in light DOM', () => {
    const label = '<img src=x onerror="alert(1)"> & Quarter note';
    const mount = document.createElement('div');
    document.body.append(mount);
    render(html`<select name="duration">${nativeOptionTemplate({ value: 'quarter', label, icon: bravuraNoteQuarterUp })}</select>`, mount);
    const option = document.querySelector('option')!;

    expect(option.textContent).toBe(label);
    expect(option.text).toBe(label);
    expect(option.getAttribute('label')).toBeNull();
    expect(option.querySelector('.option-label')?.textContent).toBe(label);
    expect(option.getAttribute('aria-label')).toBe(label);
    expect(option.querySelector('svg')?.textContent).toBe('');
    expect(option.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect([...option.querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual(bravuraNoteQuarterUp.paths);
    expect(option.querySelector('img, script, music-icon, svg text, [tabindex], [role]')).toBeNull();
    expect(document.querySelector('select')?.value).toBe('quarter');
  });

  it.each([
    { icon: bravuraAccidentalFlat, label: 'Flat' },
    { icon: phArrowUUpLeft, label: 'Undo' },
  ])('keeps $label SVG paths intact when native option children are cloned', ({ icon, label }) => {
    const mount = document.createElement('div');
    document.body.append(mount);
    render(html`<select>${nativeOptionTemplate({ value: 'choice', label, icon })}</select>`, mount);
    const option = document.querySelector('option')!;
    const selectedcontent = document.createElement('selectedcontent');
    // The DOM emulator has no native selectedcontent implementation. Exercise
    // its deep-clone contract without taking over browser selection behavior.
    for (const child of option.childNodes) selectedcontent.append(child.cloneNode(true));
    document.body.append(selectedcontent);
    const graphic = selectedcontent.querySelector('svg')!;

    expect(selectedcontent.textContent).toBe(label);
    expect(graphic.getAttribute('data-icon')).toBe(icon.name);
    expect(graphic.getAttribute('aria-hidden')).toBe('true');
    expect(graphic.getAttribute('viewBox')).toBe(icon.viewBox);
    expect(graphic.textContent).toBe('');
    expect([...graphic.querySelectorAll('path')].map(path => path.getAttribute('d'))).toEqual(icon.paths);
    expect(selectedcontent.querySelector('button, input, a, music-icon, svg text, [tabindex], [role]')).toBeNull();
  });

  it('preserves native disabled and default-selected semantics in a complete option template', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    render(html`<form><select name="duration">${nativeOptionTemplate({ value: 'half', label: 'Half note', disabled: true })}${nativeOptionTemplate({ value: 'quarter', label: 'Quarter note', icon: bravuraNoteQuarterUp, selected: true })}</select></form>`, mount);
    const select = mount.querySelector('select')!;

    expect(select.options[0].disabled).toBe(true);
    expect(select.options[1].hasAttribute('selected')).toBe(true);
    expect(select.options[1].selected).toBe(true);
    expect(select.value).toBe('quarter');
    expect(new FormData(select.form!).get('duration')).toBe('quarter');
    select.value = 'half';
    select.form!.reset();
    expect(select.value).toBe('quarter');
  });

  it('sets a later default after option insertion and preserves user edits on subsequent renders', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const template = (label: string) => html`<form><select name="duration"><button type="button"><selectedcontent></selectedcontent></button>${nativeOptionTemplate({ value: 'breve', label: 'Breve' })}${nativeOptionTemplate({ value: 'whole', label: 'Whole' })}${nativeOptionTemplate({ value: 'half', label: 'Half' })}${nativeOptionTemplate({ value: 'quarter', label, icon: bravuraNoteQuarterUp, selected: true })}${nativeOptionTemplate({ value: 'eighth', label: 'Eighth' })}${nativeSelectDefault('quarter')}</select></form>`;
    render(template('Quarter'), mount);
    const select = mount.querySelector('select')!;
    const quarter = select.options[3];
    const button = select.firstElementChild;
    expect(select.value).toBe('quarter');
    expect(quarter.hasAttribute('selected')).toBe(true);
    expect(new FormData(select.form!).get('duration')).toBe('quarter');

    select.value = 'eighth';
    const setValue = vi.spyOn(select, 'value', 'set');
    render(template('Quarter note'), mount);
    expect(select.value).toBe('eighth');
    expect(select.options[3]).toBe(quarter);
    expect(quarter.text).toBe('Quarter note');
    expect(select.firstElementChild).toBe(button);
    expect(setValue).not.toHaveBeenCalled();
    expect(new FormData(select.form!).get('duration')).toBe('eighth');

    select.form!.reset();
    expect(select.value).toBe('quarter');
    render(template('Quarter'), mount);
    expect(select.value).toBe('quarter');
    expect(setValue).not.toHaveBeenCalled();
  });
});
