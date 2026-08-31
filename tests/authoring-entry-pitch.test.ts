// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { EntryPitch } from '../src/authoring/entry-pitch.js';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';

const alterations = ['-2', '-1.5', '-1', '-0.5', '0', '0.5', '1', '1.5', '2'];
const shellMarkup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const cleanups: (() => void)[] = [];
const simpleMarkup = `<label for="event-pitch">Pitch and octave</label>
  <input id="event-pitch" type="text" value="C4" aria-describedby="pitch-help event-alteration-status">
  <label for="event-alteration">Accidental</label><select id="event-alteration" aria-describedby="event-alteration-status">
  <button type="button"><selectedcontent></selectedcontent></button>
  ${alterations.map(value => `<option value="${value}">${value}</option>`).join('')}</select>
  <p id="event-alteration-status" role="status" hidden></p><p id="pitch-help">Spell the next note.</p>
  <input id="event-pitches" value="C4 E4 G4"><input id="event-duration" value="eighth">
  <input id="event-dots" value="2"><input id="insert-position" value="before"><input id="event-accidental-display" value="courtesy">
  <div id="score-editor" tabindex="0"></div>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing entry control ${id}`);
  return result as T;
}

function fixture(options: { pitch?: string; enabled?: boolean; markup?: string; onChanged?: () => void } = {}) {
  document.body.innerHTML = options.markup ?? simpleMarkup;
  const state = { enabled: options.enabled ?? true };
  const pitch = element<HTMLInputElement>('event-pitch');
  pitch.value = options.pitch ?? 'C4';
  const alteration = element<HTMLSelectElement>('event-alteration');
  const status = element('event-alteration-status');
  const changed = vi.fn(options.onChanged ?? (() => {}));
  const controller = new EntryPitch({ isEnabled: () => state.enabled, changed });
  cleanups.push(() => controller.dispose());
  const type = (raw: string) => { pitch.value = raw; pitch.dispatchEvent(new Event('input', { bubbles: true })); };
  const choose = (value: string) => {
    alteration.value = value;
    alteration.dispatchEvent(new Event('input', { bubbles: true }));
    alteration.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { controller, state, pitch, alteration, status, changed, type, choose };
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

describe('next-note accidental controls', () => {
  it('uses the real authoring input and all nine customizable native choices', () => {
    const f = fixture({ markup: shellMarkup, pitch: 'Fqs4' });
    expect(f.pitch.type).toBe('text');
    expect(f.alteration.localName).toBe('select');
    expect([...f.alteration.options].map(option => option.value)).toEqual(alterations);
    expect(f.alteration.firstElementChild?.localName).toBe('button');
    expect(f.alteration.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect(f.status.getAttribute('role')).toBe('status');
    expect(f.alteration.value).toBe('0.5');
    expect(f.changed).not.toHaveBeenCalled();
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });

  it.each([
    simpleMarkup.replace('id="event-pitch"', 'id="missing-pitch"'),
    simpleMarkup.replace('id="event-alteration"', 'id="missing-alteration"'),
    simpleMarkup.replace('id="event-alteration-status"', 'id="missing-status"'),
    simpleMarkup.replace('id="event-pitch" type="text"', 'id="event-pitch" type="number"'),
  ])('requires real entry controls rather than creating another pitch authority', markup => {
    document.body.innerHTML = markup;
    expect(() => new EntryPitch({ isEnabled: () => true, changed: () => {} })).toThrow(/event-pitch|event-alteration/);
  });

  it.each([
    ['-2', 'Fbb4'], ['-1.5', 'Ftqf4'], ['-1', 'Fb4'], ['-0.5', 'Fqf4'],
    ['0', 'F4'], ['0.5', 'Fqs4'], ['1', 'F#4'], ['1.5', 'Ftqs4'], ['2', 'F##4'],
  ])('sets absolute alteration %s while preserving the current letter and octave', (alteration, expected) => {
    const f = fixture({ pitch: 'Fqs4' });
    f.choose(alteration);
    expect(f.pitch.value).toBe(expected);
    expect(f.alteration.value).toBe(alteration);
    expect(f.changed).toHaveBeenCalledTimes(alteration === '0.5' ? 0 : 1);
  });

  it.each([
    ['C-1', '-1.5', 'Ctqf-1'], ['g9', '2', 'G##9'], [' a♭3 ', '0.5', 'Aqs3'], ['B𝄪7', '-0.5', 'Bqf7'],
  ])('changes spelling without guessing a different letter or octave for %s', (raw, alteration, expected) => {
    const f = fixture({ pitch: raw });
    f.choose(alteration);
    expect(f.pitch.value).toBe(expected);
    expect(f.changed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Cbb4', '-2'], ['Dtqf4', '-1.5'], ['Eb4', '-1'], ['Fqf4', '-0.5'], ['G4', '0'],
    ['Aqs4', '0.5'], ['B#4', '1'], ['Ctqs5', '1.5'], ['D##5', '2'],
    [' c♭♭4 ', '-2'], ['d♭4', '-1'], ['En4', '0'], ['F♮4', '0'], ['g♯4', '1'], ['Ax4', '2'], ['B𝄪4', '2'], ['C𝄫5', '-2'],
  ])('reflects a valid typed spelling or alias %s without rewriting it', (raw, expected) => {
    const f = fixture();
    f.type(raw);
    expect(f.alteration.value).toBe(expected);
    expect(f.pitch.value).toBe(raw);
    expect(f.pitch.hasAttribute('aria-invalid')).toBe(false);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('also follows programmatic entry changes when the parent refreshes', () => {
    const f = fixture({ pitch: 'C#4' });
    f.pitch.value = 'Btqf6';
    f.controller.refresh();
    expect(f.alteration.value).toBe('-1.5');
    expect(f.pitch.value).toBe('Btqf6');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('preserves raw aliases exactly when the chosen alteration is a semantic no-op', () => {
    const f = fixture({ pitch: ' f♯4 ' });
    f.choose('1');
    f.choose('1');
    expect(f.pitch.value).toBe(' f♯4 ');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('does not copy a prior accidental back over an A–G natural recipe update', () => {
    const f = fixture({ pitch: 'Ctqs4' });
    f.pitch.value = 'F4';
    f.controller.refresh();
    expect(f.pitch.value).toBe('F4');
    expect(f.alteration.value).toBe('0');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('notifies exactly once after one actual choice and supports a parent refresh from the callback', () => {
    let controller: EntryPitch | undefined;
    const observed: string[] = [];
    const f = fixture({ onChanged: () => { observed.push(element<HTMLInputElement>('event-pitch').value); controller?.refresh(); } });
    controller = f.controller;
    f.choose('-0.5');
    expect(observed).toEqual(['Cqf4']);
    expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.alteration.value).toBe('-0.5');
  });

  it('uses the live text at the moment of choosing, not the last refreshed note', () => {
    const f = fixture({ pitch: 'C#4' });
    f.pitch.value = 'Ab6';
    f.choose('0.5');
    expect(f.pitch.value).toBe('Aqs6');
    expect(f.changed).toHaveBeenCalledTimes(1);
  });
});

describe('incomplete or unavailable next-note pitch', () => {
  it.each(['', 'F', 'F#', 'C10', 'C-2', 'H4', 'Cquarter4', 'F#4 A4'])('retains invalid text %j and refuses to guess an accidental target', raw => {
    const f = fixture({ pitch: raw });
    expect(f.pitch.disabled).toBe(false);
    expect(f.alteration.disabled).toBe(false);
    expect(f.alteration.selectedIndex).toBe(-1);
    f.choose('1');
    expect(f.pitch.value).toBe(raw);
    expect(f.pitch.disabled).toBe(false);
    expect(f.alteration.selectedIndex).toBe(-1);
    expect(f.status.textContent).toMatch(/pitch|octave/i);
    expect(f.status.hidden).toBe(false);
    expect(f.pitch.getAttribute('aria-invalid')).toBe('true');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('keeps temporary typing editable and restores the exact choice when the pitch becomes complete', () => {
    const f = fixture({ pitch: 'F#4' });
    f.type('F');
    expect(f.alteration.selectedIndex).toBe(-1);
    f.type('Fqs');
    expect(f.alteration.selectedIndex).toBe(-1);
    f.type('Fqs4');
    expect(f.pitch.value).toBe('Fqs4');
    expect(f.alteration.value).toBe('0.5');
    expect(f.pitch.hasAttribute('aria-invalid')).toBe(false);
    expect(f.status.hidden).toBe(true);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('reports unsafe-looking text as text content rather than markup', () => {
    const f = fixture({ pitch: '<img src=x onerror="bad()">' });
    f.choose('1');
    expect(f.pitch.value).toBe('<img src=x onerror="bad()">');
    expect(f.status.children).toHaveLength(0);
    expect(f.status.textContent).toMatch(/pitch/i);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-number', '0.25', '3', 'Infinity'])('rejects unsupported selector value %j without silently choosing natural', raw => {
    const f = fixture({ pitch: 'Eb4' });
    if (raw) {
      const option = document.createElement('option'); option.value = raw; option.textContent = 'Unsupported'; f.alteration.append(option);
    }
    f.choose(raw);
    expect(f.pitch.value).toBe('Eb4');
    expect(f.alteration.value).toBe('-1');
    expect(f.status.hidden).toBe(false);
    expect(f.status.textContent).toMatch(/accidental|alteration/i);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('a valid subsequent no-op clears a rejected choice without rewriting the text', () => {
    const f = fixture({ pitch: 'e♭4' });
    f.choose('');
    expect(f.status.hidden).toBe(false);
    f.choose('-1');
    expect(f.pitch.value).toBe('e♭4');
    expect(f.status.hidden).toBe(true);
    expect(f.changed).not.toHaveBeenCalled();
  });

  it.each(['rhythm staff', '3 roads staff', 'chord', 'rest', 'slash', 'non-Write mode', 'pending Source'])('disables accidentals when the current context is %s', () => {
    const f = fixture({ pitch: 'Aqs3', enabled: false });
    expect(f.alteration.disabled).toBe(true);
    f.choose('1');
    expect(f.pitch.value).toBe('Aqs3');
    expect(f.alteration.value).toBe('0.5');
    expect(f.status.textContent).toMatch(/single|pitched|note/i);
    expect(f.status.textContent).toContain('next entry');
    expect(f.status.textContent).toContain('Apply or Revert');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('rejects a delayed change after context becomes disabled even without a refresh', () => {
    const f = fixture({ pitch: 'F4' });
    expect(f.alteration.disabled).toBe(false);
    f.state.enabled = false;
    f.choose('2');
    expect(f.pitch.value).toBe('F4');
    expect(f.alteration.disabled).toBe(true);
    expect(f.alteration.value).toBe('0');
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('restores the same recipe and current accidental when a pitched note becomes available again', () => {
    const f = fixture({ pitch: 'Btqf5', enabled: false });
    f.state.enabled = true;
    f.controller.refresh();
    expect(f.pitch.value).toBe('Btqf5');
    expect(f.alteration.value).toBe('-1.5');
    expect(f.alteration.disabled).toBe(false);
    expect(f.status.hidden).toBe(true);
    expect(f.changed).not.toHaveBeenCalled();
  });
});

describe('entry pitch isolation and lifecycle', () => {
  it('changes only the authoritative next single-note pitch, leaving the rest of the recipe untouched', () => {
    const f = fixture({ pitch: 'G4' });
    const ids = ['event-pitches', 'event-duration', 'event-dots', 'insert-position', 'event-accidental-display'];
    const before = ids.map(id => element<HTMLInputElement>(id).value);
    f.choose('-1');
    expect(f.pitch.value).toBe('Gb4');
    expect(ids.map(id => element<HTMLInputElement>(id).value)).toEqual(before);
  });

  it('does not emit synthetic pitch-input, change, or musical-command events', () => {
    const f = fixture();
    const input = vi.fn(); const change = vi.fn(); const command = vi.fn();
    f.pitch.addEventListener('input', input); f.pitch.addEventListener('change', change);
    document.addEventListener('music-command', command);
    cleanups.push(() => document.removeEventListener('music-command', command));
    f.choose('0.5');
    expect(input).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled();
    expect(f.changed).toHaveBeenCalledTimes(1);
  });

  it('preserves focus, native keys, text selection while typing, and score scroll', () => {
    const f = fixture({ pitch: 'F#4' });
    const score = element('score-editor'); score.scrollTop = 330;
    f.pitch.focus(); f.pitch.setSelectionRange(1, 2);
    f.controller.refresh();
    expect(document.activeElement).toBe(f.pitch); expect(f.pitch.selectionStart).toBe(1); expect(f.pitch.selectionEnd).toBe(2);
    f.alteration.focus();
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      f.alteration.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    const focus = vi.spyOn(HTMLElement.prototype, 'focus'); const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    f.choose('-1');
    expect(document.activeElement).toBe(f.alteration); expect(score.scrollTop).toBe(330);
    expect(focus).not.toHaveBeenCalled(); expect(scroll).not.toHaveBeenCalled();
  });

  it('does not affect an actual session, its selected note, recovery, or Undo and Redo', () => {
    const f = fixture();
    const session = new EditorSession(createProject('<music-staff id="staff"><music-measure id="bar"><music-note id="note" pitch="D4" duration="whole"></music-note></music-measure></music-staff>', 'Unchanged music'));
    session.select('note');
    session.execute({ type: 'set-note-pitch', eventId: 'note', pitch: 'G4', ties: 'reject' });
    session.undo();
    const project = session.project; const revision = session.revision; const selection = session.selectionId;
    const canUndo = session.canUndo; const canRedo = session.canRedo; const changed = vi.fn();
    session.addEventListener('change', changed);
    f.choose('1'); f.choose('-0.5'); f.type('Fqs4'); f.controller.refresh();
    expect(session.project).toEqual(project); expect(session.revision).toBe(revision); expect(session.selectionId).toBe(selection);
    expect(session.canUndo).toBe(canUndo); expect(session.canRedo).toBe(canRedo); expect(session.canRedo).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it('uses the supplied document and does not change controls in the outer document', () => {
    const f = fixture({ pitch: 'F#4' });
    const alternate = document.implementation.createHTMLDocument('Other authoring editor');
    alternate.body.innerHTML = simpleMarkup;
    const other = new EntryPitch({ isEnabled: () => true, changed: () => {} }, alternate);
    cleanups.push(() => other.dispose());
    const choice = alternate.getElementById('event-alteration') as HTMLSelectElement;
    choice.value = '-1'; choice.dispatchEvent(new Event('change', { bubbles: true }));
    expect((alternate.getElementById('event-pitch') as HTMLInputElement).value).toBe('Cb4');
    expect(f.pitch.value).toBe('F#4'); expect(f.alteration.value).toBe('1');
  });

  it('keeps an ordinary native select usable when enhancement must add its button', () => {
    const f = fixture({ markup: simpleMarkup.replace('<button type="button"><selectedcontent></selectedcontent></button>', '') });
    expect(f.alteration.firstElementChild?.localName).toBe('button');
    expect([...f.alteration.options].map(option => option.value)).toEqual(alterations);
    f.choose('1.5'); expect(f.pitch.value).toBe('Ctqs4');
  });

  it('stops listening and refreshing after disposal, including late native events', () => {
    const f = fixture({ pitch: 'C4' });
    f.controller.dispose();
    f.choose('1');
    expect(f.pitch.value).toBe('C4');
    f.type('Fqs4'); f.controller.refresh();
    expect(f.alteration.value).toBe('1');
    expect(f.changed).not.toHaveBeenCalled();
    expect(() => f.controller.dispose()).not.toThrow();
  });
});
