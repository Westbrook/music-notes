import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMeter, parsePitch, rational } from '../src/model/index.js';
import type { Annotation, Diagnostic, EventMarking, Measure, MusicEvent, Voice } from '../src/model/types.js';
import { directionLabel, eventLabel, markingLabel } from '../src/authoring/event-label.js';
import { renderEventNavigator } from '../src/authoring/ui/event-navigator.js';
import { renderNotationNotices } from '../src/authoring/ui/notation-notices.js';

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

function fixture() {
  document.body.innerHTML = '<details open><summary>Events in this bar</summary><div id="events"></div></details><button id="score">Score</button>';
  const host = document.getElementById('events')!;
  const fallback = document.getElementById('score')!;
  const button = (id: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.dataset.sourceId === id)!;
  return { host, fallback, button, disclosure: document.querySelector('details')! };
}

describe('event labels', () => {
  it('keeps the existing musical names independent of DOM rendering', () => {
    expect(eventLabel(event('note', { pitches: [parsePitch('Fqs4')], dots: 1 }))).toBe('F quarter-sharp 4 · quarter, 1 dot');
    expect(eventLabel(event('chord', { kind: 'chord', pitches: [parsePitch('C4'), parsePitch('E4')], dots: 2 }))).toBe('C4 + E4 · quarter, 2 dots');
    expect(eventLabel(event('rest', { kind: 'rest' }))).toBe('Rest · quarter');
    expect(eventLabel(event('rest', { kind: 'rest', measureRest: true }))).toBe('Measure rest · quarter');
    expect(eventLabel(event('slash', { kind: 'slash' }))).toBe('Open slash · quarter');
    expect(eventLabel(event('slash', { kind: 'slash', rhythmic: true }))).toBe('Written slash rhythm · quarter');
    expect(eventLabel(event('rhythm', { kind: 'rhythm' }))).toBe('Rhythm note · quarter');
    expect(eventLabel(event('road', { kind: 'road', pitchDirection: 'higher' }))).toBe('3 roads note · Higher (top) · quarter');
    expect(['higher', 'same', 'lower', undefined].map(directionLabel)).toEqual(['Higher (top)', 'Same (middle)', 'Lower (bottom)', 'Choose direction']);
    expect(markingLabel({ id: 'm', kind: 'ornament', type: 'inverted-turn', placement: 'above' })).toBe('inverted turn');
    expect(markingLabel({ id: 'm', kind: 'interval', interval: { number: 3, alter: -1 }, placement: 'below' })).toBe('Harmony b3 below');
  });
});

describe('Lit event navigator', () => {
  it('updates selection, labels, and active marking without replacing or refocusing buttons', () => {
    const { host, fallback, button, disclosure } = fixture();
    const marking: EventMarking = { id: 'mark', kind: 'articulation', type: 'staccato', placement: 'auto' };
    const original = event('note', { markings: [marking] });
    const voices = [{ id: 'voice', events: [original], tuplets: [] }];
    renderEventNavigator(host, { measure: measure(voices), voiceIndex: 0, selectedIds: [] }, fallback);
    const note = button('note');
    const child = button('mark');
    child.focus();
    const focus = vi.spyOn(child, 'focus');
    const fallbackFocus = vi.spyOn(fallback, 'focus');

    renderEventNavigator(host, {
      measure: measure([{ ...voices[0], events: [{ ...original, dots: 1 }] }]),
      voiceIndex: 0, selectedIds: ['note'], activeMarkingId: 'mark',
    }, fallback);

    expect(button('note')).toBe(note);
    expect(button('mark')).toBe(child);
    expect(note.textContent).toBe('C4 · quarter, 1 dot · at 0');
    expect(note.getAttribute('aria-pressed')).toBe('true');
    expect(note.classList.contains('active-voice')).toBe(true);
    expect(child.textContent).toBe('staccato · attached to C4 · quarter, 1 dot');
    expect(child.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(child);
    expect(disclosure.open).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(fallbackFocus).not.toHaveBeenCalled();
  });

  it('retains keyed voices, events, markings, and annotations through reordering', () => {
    const { host, fallback, button } = fixture();
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
    renderEventNavigator(host, { measure: measure(voices, annotations), voiceIndex: 0, selectedIds: [] }, fallback);
    const groups = [...host.querySelectorAll('.event-voice-group')];
    const buttons = new Map([...host.querySelectorAll<HTMLButtonElement>('button')].map(node => [node.dataset.sourceId, node]));
    button('accent').focus();

    renderEventNavigator(host, {
      measure: measure([voices[1], { ...voices[0], events: [second, { ...first, markings: [...markings].reverse() }] }], [...annotations].reverse()),
      voiceIndex: 1, selectedIds: ['b'],
    }, fallback);

    expect([...host.querySelectorAll('.event-voice-group')]).toEqual([groups[1], groups[0]]);
    expect([...host.querySelectorAll('button')].map(node => node.dataset.sourceId)).toEqual(['c', 'b', 'a', 'turn', 'accent', 'direction', 'tempo']);
    for (const [id, original] of buttons) expect(button(id!)).toBe(original);
    expect(document.activeElement).toBe(button('accent'));
    expect(button('tempo').textContent).toBe('tempo: 88 · at 0');
    expect(button('direction').textContent).toBe('direction: Gently · at 1/2');
    expect(button('c').classList.contains('active-voice')).toBe(false);
    expect(button('b').getAttribute('aria-pressed')).toBe('true');
  });

  it('returns focus only when its focused item disappears and leaves unrelated focus alone', () => {
    const { host, fallback, button } = fixture();
    const voices = [{ id: 'voice', events: [event('a'), event('b')], tuplets: [] }];
    const fallbackFocus = vi.spyOn(fallback, 'focus');
    renderEventNavigator(host, { measure: measure(voices), voiceIndex: 0, selectedIds: [] }, fallback);
    button('b').focus();
    renderEventNavigator(host, { measure: measure([{ ...voices[0], events: [voices[0].events[0]] }]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(document.activeElement).toBe(button('a'));
    expect(fallbackFocus).not.toHaveBeenCalled();

    renderEventNavigator(host, { measure: measure([]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(document.activeElement).toBe(fallback);
    expect(fallbackFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    renderEventNavigator(host, { measure: measure(voices), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(document.activeElement).toBe(fallback);
    expect(fallbackFocus).toHaveBeenCalledOnce();
  });

  it('keeps user-authored text inert and renders within an independently owned shadow root', () => {
    const shell = document.createElement('section');
    document.body.append(shell);
    const shadow = shell.attachShadow({ mode: 'open' });
    const host = document.createElement('div');
    const fallback = document.createElement('button');
    shadow.append(host, fallback);
    const text = '<img src=x onerror="alert(1)"> & <script>unsafe()</script>';
    const id = '" onclick="unsafe()';
    const annotation: Annotation = { id, kind: 'direction', text, placement: 'above', onset: rational(0) };
    renderEventNavigator(host, { measure: measure([], [annotation]), voiceIndex: 0, selectedIds: [] }, fallback);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe(`direction: ${text} · at 0`);
    expect(button.dataset.sourceId).toBe(id);
    expect(host.querySelector('img, script, [onclick]')).toBeNull();
    button.focus();

    renderEventNavigator(host, { measure: measure([], [{ ...annotation, text: 'Quietly' }]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(host.querySelector('button')).toBe(button);
    expect(shadow.activeElement).toBe(button);
    renderEventNavigator(host, { measure: measure([]), voiceIndex: 0, selectedIds: [] }, fallback);
    expect(shadow.activeElement).toBe(fallback);
  });
});

describe('Lit notation notices', () => {
  it('keeps repeated diagnostic identities and safe text without owning disclosure state', () => {
    document.body.innerHTML = '<details open><summary>Notation notices</summary><ul></ul></details>';
    const disclosure = document.querySelector('details')!;
    const list = document.querySelector('ul')!;
    const diagnostics: readonly Diagnostic[] = [
      { severity: 'warning', code: 'measure', sourceId: 'bar', message: 'Finish this bar.' },
      { severity: 'warning', code: 'label" data-injected="yes', sourceId: '<source>', message: '<script>unsafe()</script>' },
    ];
    renderNotationNotices(list, diagnostics);
    const rows = [...list.children];
    renderNotationNotices(list, [...diagnostics].reverse().map(item => ({ ...item })));
    expect([...list.children]).toEqual([...rows].reverse());
    expect(list.firstElementChild?.textContent).toBe('<script>unsafe()</script> [<source>]');
    expect(list.firstElementChild?.getAttribute('data-diagnostic-code')).toBe(diagnostics[1].code);
    expect(list.querySelector('script, [data-injected]')).toBeNull();
    expect(disclosure.open).toBe(true);

    renderNotationNotices(list, []);
    expect(list.children).toHaveLength(0);
    expect(disclosure.open).toBe(true);
  });
});
