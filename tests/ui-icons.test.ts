import { afterEach, describe, expect, it, vi } from 'vitest';
import { html, render } from 'lit';
import { buttonContent } from '../src/ui/button-content.js';
import type { MusicButtonContent } from '../src/ui/button-content.js';
import '../src/ui/music-icon.js';
import { iconGraphic } from '../src/ui/icon-graphics.js';
import { phArrowUUpLeft, phCheck, phMinus, phPencilSimple, phPlus, phX } from '../src/ui/icons/phosphor.js';
import { bravuraAccidentalFlat, bravuraNoteQuarterUp } from '../src/ui/icons/bravura.js';
import { alterationIcon, durationIcon, eventIcon, markingIcon } from '../src/ui/notation-icons.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function graphic(content: MusicButtonContent): Promise<SVGElement> {
  await content.updateComplete;
  return content.shadowRoot!.querySelector('svg')!;
}

describe('native button icon content', () => {
  it('keeps native actions, focus, form behavior and controller-owned light-DOM labels', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const submit = vi.fn((event: Event) => event.preventDefault());
    const template = () => html`<form @submit=${submit}><button type="submit" name="command" value="undo">${buttonContent(phArrowUUpLeft, html`<span id="dynamic-label"></span>`)}</button></form>`;
    render(template(), root);
    const button = root.querySelector('button')!;
    const content = button.querySelector('music-button-content')!;
    const label = root.querySelector('#dynamic-label')!;
    label.textContent = 'Undo';
    const svg = await graphic(content);
    button.focus();
    button.click();
    expect(submit).toHaveBeenCalledOnce();
    expect(button.name).toBe('command');
    expect(button.value).toBe('undo');
    expect(button.textContent).toBe('Undo');
    expect(svg.getAttribute('data-icon')).toBe('ph:arrow-u-up-left');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(content.shadowRoot!.querySelector('button, [tabindex]')).toBeNull();

    label.textContent = 'Undo typing';
    render(template(), root);
    expect(root.querySelector('button')).toBe(button);
    expect(root.querySelector('#dynamic-label')).toBe(label);
    expect(button.textContent).toBe('Undo typing');
    expect(document.activeElement).toBe(button);
    button.disabled = true;
    button.click();
    expect(submit).toHaveBeenCalledOnce();
  });

  it('supports each layout without removing the accessible label or creating another control', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(html`<button>${buttonContent(phPencilSimple, '<b>Edit</b>')}</button>
      <button>${buttonContent(phCheck, 'Apply', { layout: 'inline' })}</button>
      <button>${buttonContent(phX, 'Close', { layout: 'icon-only' })}</button>`, root);
    const contents = [...root.querySelectorAll('music-button-content')];
    await Promise.all(contents.map(graphic));
    expect(contents.map(content => content.layout)).toEqual(['stacked', 'inline', 'icon-only']);
    expect(contents[0].querySelector('b')).toBeNull();
    expect(contents[0].textContent).toBe('<b>Edit</b>');
    expect(contents[2].textContent).toBe('Close');
    expect(contents[2].shadowRoot!.querySelector('[part="label"]')!.hasAttribute('aria-hidden')).toBe(false);
    expect(contents[2].shadowRoot!.querySelector('slot')!.assignedNodes().filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('')).toBe('Close');
    expect(root.querySelectorAll('button')).toHaveLength(3);
  });

  it('updates explicit artwork while preserving the slotted label and native focus', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    render(buttonContent(phPlus, 'Expand'), button);
    const content = button.querySelector('music-button-content')!;
    const before = (await graphic(content)).querySelector('path')!.getAttribute('d');
    const label = content.firstChild;
    button.focus();
    content.icon = phMinus;
    const svg = await graphic(content);
    expect(svg.querySelector('path')!.getAttribute('d')).not.toBe(before);
    expect(svg.getAttribute('data-icon')).toBe('ph:minus');
    expect(content.firstChild).toBe(label);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Expand');
  });
});

describe('synchronous shared SVG delivery', () => {
  it('renders either family immediately, with no font APIs, and keeps native clones complete', () => {
    const root = document.createElement('div');
    const fontDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, get: () => { throw new Error('SVG icons must not access fonts'); } });
    try {
      render(html`${iconGraphic(phCheck)}${iconGraphic(bravuraNoteQuarterUp)}`, root);
      const svgs = [...root.querySelectorAll('svg')];
      expect(svgs.map(svg => svg.getAttribute('data-icon'))).toEqual(['ph:check', 'music:noteQuarterUp']);
      expect(svgs.map(svg => svg.querySelector('path')!.getAttribute('d'))).toEqual([phCheck.paths[0], bravuraNoteQuarterUp.paths[0]]);
      expect(root.querySelector('text, image, use, music-icon')).toBeNull();
      const cloned = root.cloneNode(true) as HTMLElement;
      expect(cloned.querySelectorAll('path')).toHaveLength(2);
      expect(cloned.querySelectorAll('svg')[1].getAttribute('viewBox')).toBe(bravuraNoteQuarterUp.viewBox);
    } finally {
      if (fontDescriptor) Object.defineProperty(document, 'fonts', fontDescriptor);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('renders a standalone icon in its Lit update and changes families without readiness work', async () => {
    const icon = document.createElement('music-icon');
    icon.icon = phCheck;
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector('path')!.getAttribute('d')).toBe(phCheck.paths[0]);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.hasAttribute('name')).toBe(false);
    expect('ready' in icon).toBe(false);
    icon.remove();
    icon.icon = bravuraAccidentalFlat;
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector('svg')!.getAttribute('data-icon')).toBe('music:accidentalFlat');
    expect(icon.shadowRoot!.querySelector('path')!.getAttribute('d')).toBe(bravuraAccidentalFlat.paths[0]);
    expect(icon.textContent).toBe('');
  });

  it('applies the configurable 0.8 opacity exactly once to artwork, leaving the label untouched', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    render(buttonContent(bravuraAccidentalFlat, 'Flat'), button);
    const content = button.querySelector('music-button-content')!;
    const svg = await graphic(content);
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('style')).toBe('opacity:var(--music-icon-opacity,0.8)');
    expect(content.shadowRoot!.querySelectorAll('[style*="opacity"]')).toHaveLength(1);
    expect(content.style.opacity).toBe('');
    expect(content.shadowRoot!.querySelector<HTMLElement>('[part="label"]')!.style.opacity).toBe('');
  });

  it('maps notation semantics to explicit matching artwork', () => {
    const alterations = Array.from({ length: 9 }, (_, index) => alterationIcon(index / 2 - 2));
    expect(new Set(alterations.map(icon => icon?.name)).size).toBe(9);
    expect(alterations.every(icon => !!icon?.paths.length)).toBe(true);
    expect(alterationIcon(-0.5)?.name).toBe('music:accidentalQuarterToneFlatStein');
    expect(alterationIcon(1.5)?.name).toBe('music:accidentalThreeQuarterTonesSharpStein');
    expect(alterationIcon(3)).toBeUndefined();
    expect(durationIcon('whole', true).name).toBe('music:restWholeLegerLine');
    expect(durationIcon('half', true).name).toBe('music:restHalfLegerLine');
    expect(eventIcon({ kind: 'rest', duration: 'half', rhythmic: false, measureRest: true }).name).toBe('music:restWholeLegerLine');
    expect(eventIcon({ kind: 'road', duration: 'quarter', rhythmic: false, pitchDirection: 'lower' }).name).toBe('ph:arrow-down');
    expect(markingIcon({ id: 'turn', kind: 'ornament', type: 'inverted-turn', placement: 'above' }).name).toBe('music:ornamentTurnInverted');
  });
});
