import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicToggleButtonGroup } from '../src/ui/toggle-button-group.js';
import type { NativeOption } from '../src/ui/native-options.js';
import { alterationIcon } from '../src/ui/notation-icons.js';

const options: readonly NativeOption[] = [-1, 0, 1, -2, 2].map(value => ({
  value: String(value), label: `Alteration ${value}`, icon: alterationIcon(value),
}));
let notifyResize: () => void;
let observer: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
let availableWidth: number;

async function settle(group: MusicToggleButtonGroup): Promise<void> {
  await group.updateComplete;
  await vi.advanceTimersByTimeAsync(20);
  await group.updateComplete;
}

async function mount(width: number, overflowAt?: number): Promise<MusicToggleButtonGroup> {
  availableWidth = width;
  const group = new MusicToggleButtonGroup();
  group.options = options;
  group.label = 'Accidentals';
  group.value = '0';
  group.overflowAt = overflowAt;
  const container = document.createElement('div');
  container.className = 'group-container';
  container.append(group);
  document.body.append(container);
  await settle(group);
  return group;
}

function buttons(group: MusicToggleButtonGroup): HTMLButtonElement[] {
  return [...group.shadowRoot!.querySelectorAll<HTMLButtonElement>('.controls > button')];
}

function picker(group: MusicToggleButtonGroup): HTMLSelectElement | null {
  return group.shadowRoot!.querySelector('select');
}

function menuValues(group: MusicToggleButtonGroup): string[] {
  return [...picker(group)!.options].filter(option => !option.hidden).map(option => option.value);
}

function expectOneSelection(group: MusicToggleButtonGroup, value: string): void {
  expect(group.value).toBe(value);
  const selectedButtons = buttons(group).filter(button => button.getAttribute('aria-pressed') === 'true');
  const selectedOptions = [...(picker(group)?.selectedOptions ?? [])].filter(option => !option.hidden);
  expect([...selectedButtons, ...selectedOptions].map(control => control.value)).toEqual([value]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: () => void) { notifyResize = callback; observer = this; }
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
    // A fitted group can stay small even while its allocation grows.
    if (this.classList.contains('group-container')) return availableWidth;
    return this.classList.contains('controls') ? 44 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
    // Deliberately use unequal widths to catch count-only packing algorithms.
    if (this.hasAttribute('data-measure-option')) return this.textContent!.includes('-2') ? 70 : 44;
    return this.classList.contains('overflow-measurement') ? 44 : 0;
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('responsive single-selection button groups', () => {
  it('keeps one choice through direct, overflow and repeated selections, emitting one input/change pair', async () => {
    const group = await mount(500, 3);
    const events: string[] = [];
    group.addEventListener('input', event => { expect(event.target).toBe(group); events.push(event.type); });
    group.addEventListener('change', event => { expect(event.target).toBe(group); events.push(event.type); });
    expectOneSelection(group, '0');
    buttons(group)[2].click();
    await settle(group);
    expectOneSelection(group, '1');
    buttons(group)[2].click();
    await settle(group);
    expectOneSelection(group, '1');
    expect(events).toEqual(['input', 'change']);

    picker(group)!.value = '-2';
    picker(group)!.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    picker(group)!.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await settle(group);
    expectOneSelection(group, '-2');
    expect(events).toEqual(['input', 'change', 'input', 'change']);
    expect(picker(group)!.dataset.selected).toBe('true');
    expect(picker(group)!.getAttribute('aria-label')).toContain('Alteration -2');
  });

  it('caps the visible prefix before fitting additional items into overflow and restores it on expansion', async () => {
    const group = await mount(500, 3);
    expect(buttons(group).map(button => button.value)).toEqual(['-1', '0', '1']);
    expect(menuValues(group)).toEqual(['-2', '2']);
    availableWidth = 135;
    notifyResize(); await settle(group);
    expect(buttons(group).map(button => button.value)).toEqual(['-1', '0']);
    expect(menuValues(group)).toEqual(['1', '-2', '2']);
    expectOneSelection(group, '0');
    availableWidth = 500;
    notifyResize(); await settle(group);
    expect(buttons(group).map(button => button.value)).toEqual(['-1', '0', '1']);
    expect(menuValues(group)).toEqual(['-2', '2']);
    expectOneSelection(group, '0');
  });

  it('accounts for the overflow trigger and actual option widths without requiring a boundary', async () => {
    const group = await mount(500);
    expect(buttons(group)).toHaveLength(5);
    expect(picker(group)).toBeNull();
    availableWidth = 201;
    notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(3);
    expect(menuValues(group)).toEqual(['-2', '2']);
    availableWidth = 500;
    notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(5);
    expect(picker(group)).toBeNull();
  });

  it('does not lose fractional widths near a fit boundary', async () => {
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      const style = computedStyle(element);
      if (element.hasAttribute('data-measure-option')) Object.defineProperty(style, 'width', { value: '44.4px' });
      if (element.classList.contains('controls')) Object.defineProperties(style, {
        columnGap: { configurable: true, value: '2px' },
        paddingLeft: { configurable: true, value: '2px' },
        paddingRight: { configurable: true, value: '2px' },
      });
      if (element.classList.contains('group-container')) Object.defineProperty(style, 'width', { configurable: true, value: `${availableWidth}px` });
      return style;
    });
    const group = await mount(187, 3);
    // Three 44.4px buttons, the 44px picker, 6px gaps and 4px tray padding need 187.2px.
    expect(buttons(group)).toHaveLength(2);
    availableWidth = 188; notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(3);
    availableWidth = 187.5; notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(3);
    availableWidth = 187.1; notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(2);
  });

  it('uses the first icon only when every choice is collapsed and keeps its native picker usable', async () => {
    const group = await mount(70, 3);
    expect(buttons(group)).toHaveLength(0);
    expect(menuValues(group)).toEqual(options.map(option => option.value));
    expect(picker(group)!.firstElementChild?.tagName).toBe('BUTTON');
    expect(picker(group)!.querySelector('selectedcontent')).not.toBeNull();
    expect(picker(group)!.querySelector('button svg')!.getAttribute('data-icon')).toBe(alterationIcon(-1)!.name);
    expectOneSelection(group, '0');
    picker(group)!.value = '2';
    picker(group)!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(group);
    expectOneSelection(group, '2');
    expect(picker(group)!.querySelector('button svg')!.getAttribute('data-icon')).toBe(alterationIcon(-1)!.name);
    availableWidth = 500;
    notifyResize(); await settle(group);
    expect(picker(group)!.querySelector('button svg')!.getAttribute('data-icon')).toBe('ph:dots-three');
  });

  it('handles arbitrary counts, empty-string values, boundary zero, and option replacement without losing selection', async () => {
    const group = await mount(500, 0);
    const changes = vi.fn(); group.addEventListener('change', changes);
    group.options = Array.from({ length: 100 }, (_, index) => ({ value: index ? String(index) : '', label: String(index) }));
    group.value = '';
    await settle(group);
    expect(buttons(group)).toHaveLength(0);
    expect(menuValues(group)).toHaveLength(100);
    expectOneSelection(group, '');
    group.value = '99'; await settle(group);
    expectOneSelection(group, '99');
    expect(group.getAttribute('value')).toBe('99');
    expect(group.getAttribute('overflow-at')).toBe('0');
    group.options = [{ value: 'next', label: 'Next' }]; await settle(group);
    expectOneSelection(group, 'next');
    group.value = 'invalid'; await settle(group);
    expectOneSelection(group, 'next');
    expect(changes).not.toHaveBeenCalled();
    group.options = []; await settle(group);
    expect(group.value).toBe('');
    expect(buttons(group)).toHaveLength(0);
    expect(picker(group)).toBeNull();
  });

  it('preserves disabled current values, prevents disabled changes, and has a labeled keyboard-accessible group', async () => {
    const group = await mount(500, 3);
    group.options = options.map(option => ({ ...option, disabled: option.value === '0' || option.value === '-1' }));
    await settle(group);
    expectOneSelection(group, '0');
    buttons(group)[0].click(); await settle(group);
    expectOneSelection(group, '0');
    expect(group.shadowRoot!.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Accidentals');
    expect(buttons(group)[2].tabIndex).toBe(0);
    expect(picker(group)!.tabIndex).toBe(0);
    group.disabled = true; await settle(group);
    expect(buttons(group).every(button => button.disabled)).toBe(true);
    expect(picker(group)!.disabled).toBe(true);
    picker(group)!.value = '2';
    picker(group)!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(group);
    expect(group.value).toBe('0');
  });

  it('moves focus into overflow when the focused button collapses, and disconnects observers', async () => {
    const group = await mount(500, 3);
    const container = group.parentElement!;
    buttons(group)[1].focus();
    availableWidth = 44; notifyResize(); await settle(group);
    expect(group.shadowRoot!.activeElement).toBe(picker(group));
    expectOneSelection(group, '0');
    const previous = observer;
    group.remove();
    expect(previous.disconnect).toHaveBeenCalledOnce();
    container.append(group); availableWidth = 500;
    notifyResize(); await settle(group);
    expect(buttons(group)).toHaveLength(3);
    expect(observer.observe).toHaveBeenCalledWith(group);
    expect(observer.observe).toHaveBeenCalledWith(container);
  });

  it('keeps focus and button identity when option labels are refreshed', async () => {
    const group = await mount(500, 3);
    const focused = buttons(group)[2];
    focused.focus();
    group.options = options.map(option => ({ ...option, label: `Updated ${option.label}` }));
    await settle(group);
    expect(buttons(group)[2]).toBe(focused);
    expect(group.shadowRoot!.activeElement).toBe(focused);
    expectOneSelection(group, '0');
  });
});

describe('optional toggle-off selection', () => {
  function expectInactive(group: MusicToggleButtonGroup, value: string): void {
    expect(group.value).toBe(value);
    expect(buttons(group).every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(picker(group)?.dataset.selected ?? 'false').toBe('false');
  }

  function pick(group: MusicToggleButtonGroup, value: string): void {
    const select = picker(group)!;
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  it('toggles the active button to the configured neutral value and keeps other choices mutually exclusive', async () => {
    const group = await mount(500, 3);
    group.toggleOffValue = '0'; await settle(group);
    const changes = vi.fn(); group.addEventListener('change', changes);
    expect(group.getAttribute('toggle-off-value')).toBe('0');
    expectInactive(group, '0');

    buttons(group)[0].click(); await settle(group);
    expect(group.value).toBe('-1');
    expect(buttons(group)[0].getAttribute('aria-pressed')).toBe('true');
    buttons(group)[2].click(); await settle(group);
    expect(group.value).toBe('1');
    expect(buttons(group).filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.value)).toEqual(['1']);
    buttons(group)[2].click(); await settle(group);
    expectInactive(group, '0');
    buttons(group)[1].click(); await settle(group);
    expectInactive(group, '0');
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('allows repeated overflow choices to toggle off without toggling twice on native input/change pairs', async () => {
    const group = await mount(44, 3);
    group.toggleOffValue = '0'; await settle(group);
    const events: string[] = [];
    group.addEventListener('input', event => { expect(event.target).toBe(group); events.push(event.type); });
    group.addEventListener('change', event => { expect(event.target).toBe(group); events.push(event.type); });

    pick(group, '-2'); await settle(group);
    expect(group.value).toBe('-2');
    expect(picker(group)!.dataset.selected).toBe('true');
    expect(picker(group)!.getAttribute('aria-label')).toContain('Alteration -2');
    expect(picker(group)!.querySelector('option[value="-2"]')!.textContent).toContain('(selected)');
    // Returning to the placeholder makes this same choice a new native change.
    expect(picker(group)!.selectedOptions[0].hidden).toBe(true);
    expect(events).toEqual(['input', 'change']);

    pick(group, '-2'); await settle(group);
    expectInactive(group, '0');
    expect(picker(group)!.querySelector('option[value="-2"]')!.textContent).not.toContain('(selected)');
    expect(events).toEqual(['input', 'change', 'input', 'change']);
    pick(group, '0'); await settle(group);
    expectInactive(group, '0');
    expect(events).toHaveLength(4);
  });

  it('preserves an off value outside the options through resizing, updates, and returning to required selection', async () => {
    const group = await mount(500, 3);
    group.toggleOffValue = ''; group.value = '';
    await settle(group);
    expectInactive(group, '');
    availableWidth = 44; notifyResize(); await settle(group);
    expectInactive(group, '');
    expect(picker(group)!.getAttribute('aria-label')).toContain('None');
    group.options = [options[1], options[2]]; await settle(group);
    expectInactive(group, '');
    const changes = vi.fn(); group.addEventListener('change', changes);
    group.value = 'invalid'; await settle(group);
    expectInactive(group, '');
    group.removeAttribute('toggle-off-value'); await settle(group);
    expectOneSelection(group, '0');
    expect(changes).not.toHaveBeenCalled();
  });

  it('keeps disabled groups and disabled choices from toggling off', async () => {
    const group = await mount(500, 3);
    group.toggleOffValue = '0'; group.value = '1'; group.disabled = true;
    await settle(group);
    const changes = vi.fn(); group.addEventListener('change', changes);
    buttons(group)[2].click(); await settle(group);
    expect(group.value).toBe('1');
    group.disabled = false;
    group.options = options.map(option => ({ ...option, disabled: option.value === '1' }));
    await settle(group);
    buttons(group)[2].click(); await settle(group);
    expect(group.value).toBe('1');
    availableWidth = 44; notifyResize(); await settle(group);
    pick(group, '1'); await settle(group);
    expect(group.value).toBe('1');
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('accepted selection values', () => {
  it('keeps a mixed scalar unselected until a deliberate choice', async () => {
    const group = await mount(500,3);
    group.mixed=true; group.value=''; await settle(group);
    expect(group.value).toBe('');
    expect(buttons(group).every(button=>button.getAttribute('aria-pressed')==='false')).toBe(true);
    expect(picker(group)!.getAttribute('aria-label')).toContain('Mixed');
    buttons(group)[1].click(); await settle(group);
    expect(group.mixed).toBe(false); expect(group.value).toBe('0');
  });
  it('reports independent and mixed toggles without overwriting their accepted states', async () => {
    const group=await mount(500,3);
    group.choiceStates={'-1':'true','0':'mixed','-2':'true'};await settle(group);
    expect(buttons(group).map(button=>button.getAttribute('aria-pressed'))).toEqual(['true','mixed','false']);
    const changes:string[]=[];group.addEventListener('change',event=>changes.push((event as CustomEvent).detail.value));
    buttons(group)[0].click();buttons(group)[1].click();await settle(group);
    const select=picker(group)!;select.value='-2';select.dispatchEvent(new Event('change',{bubbles:true}));await settle(group);
    select.value='-2';select.dispatchEvent(new Event('change',{bubbles:true}));await settle(group);
    expect(changes).toEqual(['-1','0','-2','-2']);
    expect(group.choiceStates).toEqual({'-1':'true','0':'mixed','-2':'true'});
    expect(picker(group)!.getAttribute('aria-label')).toContain('(some)');
  });
});
