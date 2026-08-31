import { html, render, type TemplateResult } from 'lit';
import { renderNativeOptions } from '../src/ui/native-options.js';
import { nativeOptionTemplate, nativeSelectDefault, optionContent } from '../src/ui/option-content.js';
import { bravuraNoteDoubleWhole, bravuraNoteWhole, bravuraNoteHalfUp, bravuraNoteQuarterUp, bravuraNote8thUp } from '../src/ui/icons/bravura.js';

const results = document.querySelector('#results')!;
const enhanced = CSS.supports('appearance', 'base-select') && CSS.supports('selector(::picker(select))');
document.querySelector('#environment')!.textContent = `${navigator.userAgent}\nCustomizable select: ${enhanced}`;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function qualify(name: string, template: TemplateResult, populate?: (select: HTMLSelectElement) => void, expectMarkerFailure = false): void {
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = name;
  const mount = document.createElement('div');
  const output = document.createElement('pre');
  output.textContent = 'Running';
  article.append(heading, mount, output);
  results.append(article);
  try {
    render(template, mount);
    const select = mount.querySelector('select')!;
    populate?.(select);
    check(select, 'The select must mount.');
    check(select.options.length === 2, 'Both native options must remain available.');
    check(select.value === 'quarter', `Expected quarter; received ${select.value}.`);
    check(new FormData(select.form!).get('duration') === 'quarter', 'Native form value must be quarter.');
    check(select.options[0].label === 'Half note', `Half-note label was polluted: ${select.options[0].label}.`);
    check(select.options[1].label === 'Quarter note', `Quarter-note label was polluted: ${select.options[1].label}.`);
    check(select.options[0].getAttribute('aria-label') === 'Half note', 'Rich options must retain their explicit accessible name.');
    check(select.options[1].getAttribute('aria-label') === 'Quarter note', 'Rich options must retain their explicit accessible name.');
    check(select.options[0].querySelector('svg path'), 'The half-note SVG paths must be present synchronously.');
    check(select.options[1].querySelector('svg path'), 'The quarter-note SVG paths must be present synchronously.');
    check(!select.querySelector('music-icon, svg text'), 'Native option graphics must not need custom-element properties or fonts.');
    select.value = 'quarter';
    const icons = [...mount.querySelectorAll<SVGElement>('svg.music-icon-graphic')];
    const content = select.querySelector('selectedcontent');
    if (enhanced) {
      check(content?.textContent?.trim() === 'Quarter note', `Selectedcontent must show Quarter note; received ${content?.textContent}.`);
      const graphic = content.querySelector<SVGElement>('svg')!;
      check(graphic?.getAttribute('data-icon') === bravuraNoteQuarterUp.name, 'Selectedcontent must clone the selected icon synchronously.');
      check(JSON.stringify([...graphic.querySelectorAll('path')].map(path => path.getAttribute('d'))) === JSON.stringify(bravuraNoteQuarterUp.paths), 'Native cloning must preserve every Bravura SVG path.');
      check(getComputedStyle(graphic).opacity === '0.8', 'Only the graphic must render at 0.8 opacity.');
      check(getComputedStyle(content.querySelector('.option-label')!).opacity === '1', 'The option label must remain fully opaque.');
    }
    article.dataset.result = 'pass';
    output.textContent = `PASS\nvalue: ${select.value}\nlabels: ${[...select.options].map(option => option.label).join(' | ')}\nselectedcontent: ${content?.textContent?.trim()}\nsynchronous SVG icons: ${icons.filter(icon => icon.querySelector('path')).length}/${icons.length}\nicon opacity: 0.8; label opacity: 1`;
  } catch (error) {
    if (expectMarkerFailure && error instanceof Error && error.message.includes('ChildPart') && error.message.includes('parentNode')) {
      article.dataset.result = 'pass';
      output.textContent = `PASS (expected parser-cloning failure reproduced)\n${error.message}`;
      return;
    }
    article.dataset.result = 'fail';
    output.textContent = `FAIL\n${error instanceof Error ? error.stack : String(error)}`;
  }
}

qualify('Negative diagnostic: nested option content with literal selectedcontent', html`
  <form><label>Duration <select name="duration" .value=${'quarter'}>
    <button type="button"><selectedcontent></selectedcontent></button>
    <option value="half" aria-label="Half note">${optionContent(bravuraNoteHalfUp, 'Half note')}</option>
    <option value="quarter" aria-label="Quarter note" selected>${optionContent(bravuraNoteQuarterUp, 'Quarter note')}</option>
  </select></label></form>
`, undefined, true);

qualify('Complete native option templates with synchronous SVG', html`
  <form><label>Duration <select name="duration">
    <button type="button"><selectedcontent></selectedcontent></button>
    ${nativeOptionTemplate({ value: 'half', label: 'Half note', icon: bravuraNoteHalfUp })}
    ${nativeOptionTemplate({ value: 'quarter', label: 'Quarter note', icon: bravuraNoteQuarterUp, selected: true })}
    ${nativeSelectDefault('quarter')}
  </select></label></form>
`);

qualify('Keyed dynamic native options with synchronous SVG', html`
  <form><label>Duration <select name="duration">
    <button type="button"><selectedcontent></selectedcontent></button>
  </select></label></form>
`, select => {
  renderNativeOptions(select, [
    { value: 'half', label: 'Half note', icon: bravuraNoteHalfUp },
    { value: 'quarter', label: 'Previous label', icon: bravuraNoteHalfUp },
  ], 'quarter');
  const selectedOption = select.selectedOptions[0];
  renderNativeOptions(select, [
    { value: 'half', label: 'Half note', icon: bravuraNoteHalfUp },
    { value: 'quarter', label: 'Quarter note', icon: bravuraNoteQuarterUp },
  ], 'quarter');
  check(select.selectedOptions[0] === selectedOption, 'Changing a label/icon must retain the native option.');
});

const defaultResult = document.createElement('article');
const defaultHeading = document.createElement('h2');
defaultHeading.textContent = 'Later default, user edits, rerender, and native reset';
const defaultMount = document.createElement('div');
const defaultOutput = document.createElement('pre');
defaultResult.append(defaultHeading, defaultMount, defaultOutput);
results.append(defaultResult);
let defaultResetClone: { label: string; icon: string | null } | undefined;
try {
  const template = (quarterLabel: string) => html`
    <form><label>Duration <select name="duration">
      <button type="button"><selectedcontent></selectedcontent></button>
      ${nativeOptionTemplate({ value: 'breve', label: 'Breve', icon: bravuraNoteDoubleWhole })}
      ${nativeOptionTemplate({ value: 'whole', label: 'Whole', icon: bravuraNoteWhole })}
      ${nativeOptionTemplate({ value: 'half', label: 'Half', icon: bravuraNoteHalfUp })}
      ${nativeOptionTemplate({ value: 'quarter', label: quarterLabel, icon: bravuraNoteQuarterUp, selected: true })}
      ${nativeOptionTemplate({ value: 'eighth', label: 'Eighth', icon: bravuraNote8thUp })}
      ${nativeSelectDefault('quarter')}
    </select></label></form>
  `;
  render(template('Quarter'), defaultMount);
  const select = defaultMount.querySelector('select')!;
  check(select.value === 'quarter' && select.options[3].defaultSelected, 'The fourth option must be the immediate native/default value.');
  check(new FormData(select.form!).get('duration') === 'quarter', 'The initial form value must be quarter.');
  select.value = 'eighth';
  const eighth = select.selectedOptions[0];
  render(template('Quarter note'), defaultMount);
  check(select.value === 'eighth' && select.selectedOptions[0] === eighth, 'Rerendering must retain the user choice and native option.');
  check(new FormData(select.form!).get('duration') === 'eighth', 'Rerendering must retain the user form value.');
  select.form!.reset();
  check(select.selectedOptions[0] === select.options[3] && new FormData(select.form!).get('duration') === 'quarter', 'Native reset must restore the declarative default.');
  defaultResetClone = {
    label: select.querySelector('selectedcontent')?.textContent?.trim() ?? '',
    icon: select.querySelector('selectedcontent svg')?.getAttribute('data-icon') ?? null,
  };
  defaultResult.dataset.result = 'pass';
  defaultOutput.textContent = 'PASS: application value and option behavior\ninitial: quarter\nuser value after rerender: eighth\nnative form reset value: quarter\nSelectedcontent reset is compared with the native-only baseline below.';
} catch (error) {
  defaultResult.dataset.result = 'fail';
  defaultOutput.textContent = `FAIL\n${error instanceof Error ? error.stack : String(error)}`;
}

// Compare the same reset entirely through native DOM APIs. No Lit templates,
// directives, comment markers, or custom elements participate in this baseline.
const baselineResult = document.createElement('article');
const baselineHeading = document.createElement('h2');
baselineHeading.textContent = 'Native DOM reset baseline (no Lit)';
const baselineOutput = document.createElement('pre');
const baselineForm = document.createElement('form');
const baselineLabel = document.createElement('label');
baselineLabel.textContent = 'Duration ';
const baselineSelect = document.createElement('select');
baselineSelect.name = 'duration';
const baselineButton = document.createElement('button');
baselineButton.type = 'button';
baselineButton.append(document.createElement('selectedcontent'));
baselineSelect.append(baselineButton);
for (const [value, label, icon] of [
  ['breve', 'Breve', bravuraNoteDoubleWhole],
  ['whole', 'Whole', bravuraNoteWhole],
  ['half', 'Half', bravuraNoteHalfUp],
  ['quarter', 'Quarter', bravuraNoteQuarterUp],
  ['eighth', 'Eighth', bravuraNote8thUp],
] as const) {
  const option = document.createElement('option');
  option.value = value;
  option.setAttribute('aria-label', label);
  if (value === 'quarter') option.setAttribute('selected', '');
  const content = document.createElement('span');
  content.className = 'option-content';
  const graphic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ class: 'music-icon-graphic', 'data-icon': icon.name, viewBox: icon.viewBox, width: '20', height: '20', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false', style: 'opacity:var(--music-icon-opacity,0.8)' })) graphic.setAttribute(name, value);
  for (const path of icon.paths) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    graphic.append(shape);
  }
  const text = document.createElement('span');
  text.className = 'option-label';
  text.textContent = label;
  content.append(graphic, text);
  option.append(content);
  baselineSelect.append(option);
}
baselineLabel.append(baselineSelect);
baselineForm.append(baselineLabel);
baselineResult.append(baselineHeading, baselineForm, baselineOutput);
results.append(baselineResult);
baselineSelect.value = 'quarter';
baselineSelect.value = 'eighth';
baselineSelect.options[3].setAttribute('aria-label', 'Quarter note');
baselineSelect.options[3].querySelector('.option-label')!.textContent = 'Quarter note';
baselineForm.reset();
const baselineClone = {
  label: baselineSelect.querySelector('selectedcontent')?.textContent?.trim() ?? '',
  icon: baselineSelect.querySelector('selectedcontent svg')?.getAttribute('data-icon') ?? null,
};
const baselineValueCorrect = baselineSelect.selectedOptions[0] === baselineSelect.options[3]
  && baselineSelect.options[3].defaultSelected
  && new FormData(baselineForm).get('duration') === 'quarter';
const baselineCloneCorrect = !enhanced || (baselineClone.label === 'Quarter note' && baselineClone.icon === bravuraNoteQuarterUp.name);
// This Chromium version leaves the old selectedcontent after form.reset even
// in the native-only baseline. Preserve the application's strict value/reset
// assertions and report that engine limitation separately; do not add a
// production reset handler or claim that the browser's reset cloning passed.
baselineResult.dataset.result = !baselineValueCorrect ? 'fail' : baselineCloneCorrect ? 'pass' : 'limitation';
baselineOutput.textContent = `${baselineResult.dataset.result === 'limitation' ? 'NATIVE BROWSER LIMITATION: reset leaves stale selectedcontent' : baselineResult.dataset.result.toUpperCase()}\nvalue: ${baselineSelect.value}\nselected option: ${baselineSelect.selectedOptions[0]?.textContent}\nselectedcontent: ${baselineClone.label}\nNo Lit participated in this form reset.`;
if (defaultResetClone && enhanced) {
  const appCloneCorrect = defaultResetClone.label === 'Quarter note' && defaultResetClone.icon === bravuraNoteQuarterUp.name;
  if (appCloneCorrect) {
    defaultOutput.textContent += '\nSelectedcontent reset: updated default label and SVG verified.';
  } else if (baselineValueCorrect && !baselineCloneCorrect && defaultResetClone.label === baselineClone.label && defaultResetClone.icon === baselineClone.icon) {
    defaultOutput.textContent += '\nSelectedcontent reset: same stale label/SVG as the native-only baseline. Browser reset cloning is not qualified as passing.';
  } else {
    defaultResult.dataset.result = 'fail';
    defaultOutput.textContent += '\nFAIL: selectedcontent reset differs from the native-only baseline.';
  }
}
