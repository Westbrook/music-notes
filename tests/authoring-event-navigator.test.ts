// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMeter, parsePitch, rational } from '../src/model/index.js';
import type { Annotation, EventMarking, Measure, MusicEvent, Voice } from '../src/model/types.js';
import { MusicEventNavigator, renderEventNavigator } from '../src/authoring/ui/event-navigator.js';
import type { EventNavigatorState } from '../src/authoring/ui/event-navigator.js';

afterEach(() => document.body.replaceChildren());

function event(id: string, changes: Partial<MusicEvent> = {}): MusicEvent {
  return {
    id, kind: 'note', pitches: [parsePitch('C4')], duration: 'quarter', dots: 0,
    onset: rational(0), time: rational(1, 4), tupletIds: [], beam: 'auto', stem: 'auto',
    tie: 'none', measureRest: false, rhythmic: false, ...changes,
  };
}

function measure(voices: readonly Voice[], annotations: readonly Annotation[] = []): Measure {
  return {
    id: 'bar', number: '1', meter: parseMeter(4, 4), clef: 'treble', key: 'C',
    voices, annotations, breakBefore: 'auto', keepWithNext: false, endBar: 'single',
    repeatStart: false, pickup: false, incomplete: false,
  };
}

function state(events: readonly MusicEvent[] = [event('note')]): EventNavigatorState {
  return { measure: measure([{ id: 'voice', events, tuplets: [] }]), voiceIndex: 0, selectedIds: [] };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function fixture(parent: HTMLElement | ShadowRoot = document.body) {
  const navigator = document.createElement('music-event-navigator') as MusicEventNavigator;
  const fallback = document.createElement('button');
  fallback.textContent = 'Return to score';
  parent.append(navigator, fallback);
  const button = (id: string): HTMLButtonElement => [...navigator.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.dataset.sourceId === id)!;
  return { navigator, fallback, button };
}

describe('MusicEventNavigator component', () => {
  it('renders property updates as native navigation controls inside its own open shadow root', async () => {
    const { navigator, button } = fixture();
    navigator.state = state();
    await navigator.updateComplete;

    expect(customElements.get('music-event-navigator')).toBe(MusicEventNavigator);
    expect(navigator).toBeInstanceOf(MusicEventNavigator);
    expect(navigator.shadowRoot?.mode).toBe('open');
    expect(navigator.querySelector('button, [role="navigation"]')).toBeNull();
    const navigation = navigator.shadowRoot!.querySelector('[role="navigation"]')!;
    expect(navigation.getAttribute('aria-label')).toBe('Staff, measure, voice, and event navigation');
    const note = button('note');
    expect(navigation.contains(note)).toBe(true);
    expect(note).toBeInstanceOf(HTMLButtonElement);
    expect(note.type).toBe('button');
    expect(note.textContent).toBe('C4 · quarter · at 0');
    expect(note.getAttribute('aria-pressed')).toBe('false');

    navigator.state = { ...state([event('note', { dots: 1 })]), selectedIds: ['note'] };
    await navigator.updateComplete;
    expect(button('note')).toBe(note);
    expect(note.textContent).toBe('C4 · quarter, 1 dot · at 0');
    expect(note.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets the compatibility helper render a component synchronously through its public API', () => {
    const { navigator, fallback, button } = fixture();
    const renderState = vi.spyOn(navigator, 'renderState');
    const original = state();
    renderEventNavigator(navigator, original, fallback);

    expect(renderState).toHaveBeenCalledExactlyOnceWith(original, fallback);
    const note = button('note');
    expect(note.textContent).toBe('C4 · quarter · at 0');
    expect(navigator.state).toBe(original);
    renderEventNavigator(navigator, { ...original, selectedIds: ['note'] }, fallback);
    expect(button('note')).toBe(note);
    expect(note.getAttribute('aria-pressed')).toBe('true');
  });

  it('isolates repeated source IDs, selection, and focus between instances without mutating inputs', async () => {
    const first = fixture();
    const second = fixture();
    const original = freeze(state());
    const snapshot = JSON.stringify(original);
    first.navigator.state = original;
    second.navigator.state = original;
    await Promise.all([first.navigator.updateComplete, second.navigator.updateComplete]);
    const untouched = second.button('note');
    untouched.focus();

    first.navigator.state = freeze({ ...state([event('note', { pitches: [parsePitch('D4')] })]), selectedIds: ['note'] });
    await first.navigator.updateComplete;

    expect(first.button('note').textContent).toBe('D4 · quarter · at 0');
    expect(first.button('note').getAttribute('aria-pressed')).toBe('true');
    expect(second.button('note')).toBe(untouched);
    expect(untouched.textContent).toBe('C4 · quarter · at 0');
    expect(untouched.getAttribute('aria-pressed')).toBe('false');
    expect(second.navigator.shadowRoot!.activeElement).toBe(untouched);
    expect(document.activeElement).toBe(second.navigator);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('keeps authored text, source IDs, and a custom navigation label inert', async () => {
    const { navigator } = fixture();
    const text = '<img src=x onerror="unsafe()"> & <script>unsafe()</script>';
    const sourceId = '" onclick="unsafe()';
    const label = 'Clarinet <part> & voices';
    navigator.setAttribute('aria-label', label);
    navigator.state = {
      measure: measure([], [{ id: sourceId, kind: 'direction', text, placement: 'above', onset: rational(0) }]),
      voiceIndex: 0, selectedIds: [],
    };
    await navigator.updateComplete;

    const root = navigator.shadowRoot!;
    const annotation = root.querySelector('button')!;
    expect(root.querySelector('[role="navigation"]')?.getAttribute('aria-label')).toBe(label);
    expect(annotation.textContent).toBe(`direction: ${text} · at 0`);
    expect(annotation.dataset.sourceId).toBe(sourceId);
    expect(root.querySelector('img, script, [onclick], part')).toBeNull();
    expect(navigator.querySelector('button')).toBeNull();
  });

  it('retains focused buttons across ordinary updates and keyed voice, event, marking, and annotation reorders', () => {
    const { navigator, fallback, button } = fixture();
    const markings: readonly EventMarking[] = [
      { id: 'accent', kind: 'articulation', type: 'accent', placement: 'auto' },
      { id: 'turn', kind: 'ornament', type: 'turn', placement: 'above' },
    ];
    const first = event('a', { markings });
    const second = event('b');
    const voices: readonly Voice[] = [
      { id: 'upper', events: [first, second], tuplets: [] },
      { id: 'lower', events: [event('c')], tuplets: [] },
    ];
    const annotations: readonly Annotation[] = [
      { id: 'tempo', kind: 'tempo', text: '', bpm: 88, placement: 'above', onset: rational(0) },
      { id: 'direction', kind: 'direction', text: 'Gently', placement: 'above', onset: rational(1, 2) },
    ];
    const initial = { measure: measure(voices, annotations), voiceIndex: 0, selectedIds: [] };
    navigator.renderState(initial, fallback);
    const root = navigator.shadowRoot!;
    const groups = [...root.querySelectorAll('.event-voice-group')];
    const buttons = new Map([...root.querySelectorAll<HTMLButtonElement>('button')].map(node => [node.dataset.sourceId, node]));
    const accent = button('accent');
    accent.focus();
    const focus = vi.spyOn(accent, 'focus');
    const fallbackFocus = vi.spyOn(fallback, 'focus');

    navigator.renderState({ ...initial, selectedIds: ['a'], activeMarkingId: 'accent' }, fallback);
    expect(root.activeElement).toBe(accent);
    expect(focus).not.toHaveBeenCalled();
    expect(accent.getAttribute('aria-current')).toBe('true');

    navigator.renderState({
      measure: measure([voices[1], { ...voices[0], events: [second, { ...first, markings: [...markings].reverse() }] }], [...annotations].reverse()),
      voiceIndex: 1, selectedIds: ['b'],
    }, fallback);

    expect([...root.querySelectorAll('.event-voice-group')]).toEqual([groups[1], groups[0]]);
    expect([...root.querySelectorAll('button')].map(node => node.dataset.sourceId)).toEqual(['c', 'b', 'a', 'turn', 'accent', 'direction', 'tempo']);
    for (const [id, original] of buttons) expect(button(id!)).toBe(original);
    expect(root.activeElement).toBe(accent);
    expect(accent.hasAttribute('aria-current')).toBe(false);
    expect(button('b').getAttribute('aria-pressed')).toBe('true');
    expect(button('b').classList.contains('active-voice')).toBe(true);
    expect(button('c').classList.contains('active-voice')).toBe(false);
    expect(fallbackFocus).not.toHaveBeenCalled();
  });

  it('repairs removed focus within shadow ancestry and uses the supplied fallback only when no buttons remain', () => {
    const shell = document.createElement('section');
    document.body.append(shell);
    const outerRoot = shell.attachShadow({ mode: 'open' });
    const { navigator, fallback, button } = fixture(outerRoot);
    const fallbackFocus = vi.spyOn(fallback, 'focus');
    navigator.renderState(state([event('a'), event('b')]), fallback);
    button('b').focus();

    navigator.renderState(state([event('a')]), fallback);
    expect(navigator.shadowRoot!.activeElement).toBe(button('a'));
    expect(fallbackFocus).not.toHaveBeenCalled();
    navigator.renderState({ measure: measure([]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(outerRoot.activeElement).toBe(fallback);
    expect(fallbackFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });

    navigator.renderState(state(), fallback);
    expect(outerRoot.activeElement).toBe(fallback);
    expect(fallbackFocus).toHaveBeenCalledOnce();
  });

  it('does not move unrelated focus when an unfocused selected item disappears', () => {
    const { navigator, fallback } = fixture();
    const unrelated = document.createElement('input');
    document.body.append(unrelated);
    navigator.renderState({ ...state([event('a'), event('b')]), selectedIds: ['b'] }, fallback);
    unrelated.focus();
    const fallbackFocus = vi.spyOn(fallback, 'focus');

    navigator.renderState(state([event('a')]), fallback);
    navigator.renderState({ measure: measure([]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(document.activeElement).toBe(unrelated);
    expect(fallbackFocus).not.toHaveBeenCalled();
  });

  it('updates while disconnected and reconnects without disturbing sibling focus or emitting navigation', async () => {
    const { navigator, fallback, button } = fixture();
    const navigate = vi.fn();
    navigator.addEventListener('navigate-request', navigate);
    navigator.state = state();
    await navigator.updateComplete;
    button('note').focus();
    expect(navigator.shadowRoot!.activeElement).toBe(button('note'));

    navigator.remove();
    fallback.focus();
    const fallbackFocus = vi.spyOn(fallback, 'focus');
    navigator.state = { ...state([event('note', { pitches: [parsePitch('D4')] })]), selectedIds: ['note'] };
    await expect(navigator.updateComplete).resolves.toBe(true);
    expect(document.activeElement).toBe(fallback);
    expect(fallbackFocus).not.toHaveBeenCalled();

    document.body.append(navigator);
    await navigator.updateComplete;
    expect(button('note').textContent).toBe('D4 · quarter · at 0');
    expect(button('note').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fallback);
    expect(fallbackFocus).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('emits one composed navigation intent with all modifiers through nested shadow ancestry', () => {
    const ancestor = document.createElement('main');
    const shell = document.createElement('section');
    ancestor.append(shell);
    document.body.append(ancestor);
    const outerRoot = shell.attachShadow({ mode: 'open' });
    const { navigator, fallback, button } = fixture(outerRoot);
    const original = freeze(state());
    const snapshot = JSON.stringify(original);
    navigator.renderState(original, fallback);
    const received: CustomEvent[] = [];
    let path: EventTarget[] = [];
    const local = vi.fn();
    navigator.addEventListener('navigate-request', local);
    ancestor.addEventListener('navigate-request', event => {
      received.push(event as CustomEvent);
      path = event.composedPath();
    });
    const label = document.createElement('span');
    label.textContent = 'Nested event label';
    button('note').append(label);
    label.dispatchEvent(new MouseEvent('click', {
      bubbles: true, composed: true, shiftKey: true, metaKey: true, ctrlKey: true, altKey: true,
    }));

    expect(local).toHaveBeenCalledOnce();
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(CustomEvent);
    expect(received[0].detail).toEqual({ sourceId: 'note', shiftKey: true, metaKey: true, ctrlKey: true, altKey: true });
    expect(received[0].bubbles).toBe(true);
    expect(received[0].composed).toBe(true);
    expect(path).toContain(navigator);
    expect(path).toContain(shell);
    expect(navigator.state).toBe(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(button('note').getAttribute('aria-pressed')).toBe('false');
  });

  it('routes marking and annotation buttons without interpreting empty or unbound background clicks', async () => {
    const { navigator, fallback, button } = fixture();
    const intents: unknown[] = [];
    navigator.addEventListener('navigate-request', event => intents.push((event as CustomEvent).detail));
    navigator.click();
    await navigator.updateComplete;
    navigator.shadowRoot!.querySelector<HTMLElement>('[role="navigation"]')?.click();
    expect(intents).toEqual([]);

    const marking: EventMarking = { id: 'accent', kind: 'articulation', type: 'accent', placement: 'auto' };
    navigator.renderState({
      measure: measure([{ id: 'voice', events: [event('note', { markings: [marking] })], tuplets: [] }],
        [{ id: 'direction', kind: 'direction', text: 'Quietly', placement: 'above', onset: rational(0) }]),
      voiceIndex: 0, selectedIds: [],
    }, fallback);
    button('accent').click();
    button('direction').click();
    expect(intents).toEqual(['accent', 'direction'].map(sourceId => ({
      sourceId, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    })));

    navigator.shadowRoot!.querySelector<HTMLElement>('[role="navigation"]')!.click();
    navigator.renderState({ measure: measure([]), voiceIndex: 0, selectedIds: [] }, fallback);
    navigator.shadowRoot!.querySelector<HTMLElement>('[role="navigation"]')!.click();
    navigator.click();
    expect(intents).toHaveLength(2);
  });
});
