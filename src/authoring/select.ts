/**
 * Enhance native single-value dropdowns without replacing their semantics.
 * CSS opts into base-select only when the browser supports both halves of it.
 * Call again after populating a dynamic select; existing options are not rebuilt.
 */
export function enhanceSelects(root: ParentNode = document): void {
  const selects = [...root.querySelectorAll<HTMLSelectElement>('select')];
  if ('tagName' in root && root.tagName === 'SELECT') selects.unshift(root as HTMLSelectElement);

  for (const select of selects) {
    // Rich option labels must never change the value submitted by a form.
    for (const option of select.options) {
      if (!option.hasAttribute('value')) option.setAttribute('value', option.value);
    }

    // Native listboxes are not customizable dropdowns; preserve their behavior.
    if (select.multiple || Number(select.getAttribute('size') ?? 0) > 1) continue;
    const selectedIndex = select.selectedIndex;
    let button = [...select.children].find((child): child is HTMLButtonElement => child.tagName === 'BUTTON');
    if (!button) button = select.ownerDocument.createElement('button');
    button.type = 'button';
    button.dataset.selectButton = '';
    if (!button.querySelector('selectedcontent')) {
      button.append(select.ownerDocument.createElement('selectedcontent'));
    }
    if (select.firstElementChild !== button) select.prepend(button);
    select.classList.add('author-select');
    // Inserting a non-option must not select the first option in an empty choice.
    select.selectedIndex = selectedIndex;
  }
}
