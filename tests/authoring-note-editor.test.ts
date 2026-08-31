// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { EditorSession } from '../src/authoring/editor.js';
import { NoteEditor } from '../src/authoring/note-editor.js';
import type { NoteEditorState } from '../src/authoring/note-editor.js';
import { createProject } from '../src/authoring/project.js';
import type { AuthorCommand, ViewMode } from '../src/authoring/types.js';
import { add, meterTime, rational, subtract } from '../src/model/index.js';

// Exercise the real controls without loading main, stylesheets, or remote assets.
const shellMarkup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const cleanups: (() => void)[] = [];
const accidentalIds = ['note-double-flat', 'note-flat', 'note-natural', 'note-sharp', 'note-double-sharp'];
const note = (id: string, attributes = 'pitch="F4" duration="quarter"') => `<music-note id="${id}" ${attributes}></music-note>`;
const source = (events = note('n1') + note('n2', 'pitch="G4" duration="quarter"'), attributes = 'incomplete') =>
  `<music-staff id="staff" label="Flute" key="G"><music-measure id="bar" number="12" ${attributes}>${events}</music-measure></music-staff>`;

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing real author control ${id}`);
  return result as T;
}

function toggle(target: Element, type: 'beforetoggle' | 'toggle', newState: 'open' | 'closed'): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === 'beforetoggle' && newState === 'open' });
  Object.defineProperties(event, {
    newState: { value: newState }, oldState: { value: newState === 'open' ? 'closed' : 'open' },
  });
  target.dispatchEvent(event);
  return event;
}

/** A lifecycle unit stub only: this does not simulate the browser top layer or native dismissal. */
function stubNativePopover(panel: HTMLElement) {
  let open = false;
  const show = vi.fn(() => {
    if (open || toggle(panel, 'beforetoggle', 'open').defaultPrevented) return;
    open = true;
    toggle(panel, 'toggle', 'open');
  });
  const hide = vi.fn(() => {
    if (!open) return;
    toggle(panel, 'beforetoggle', 'closed');
    open = false;
    toggle(panel, 'toggle', 'closed');
  });
  Object.defineProperties(panel, {
    showPopover: { configurable: true, value: show }, hidePopover: { configurable: true, value: hide },
  });
  return { show, hide, isOpen: () => open };
}

function fixture(html = source(), native = false) {
  document.body.innerHTML = shellMarkup;
  const panel = control('note-editor');
  const popover = native ? stubNativePopover(panel) : undefined;
  if (!native) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  const session = new EditorSession(createProject(html, 'Selected note fixture'));
  session.select('n1');
  const view = { mode: 'write' as ViewMode, selectionCount: 1, autoRefresh: true };
  const state = (): NoteEditorState => {
    const base = {
      documentId: session.project.id, mode: view.mode, revision: session.revision, pendingSource: session.project.pendingSource !== null,
      selectionCount: view.selectionCount, staffLabel: '', measureNumber: '', voiceNumber: 1,
      remaining: rational(0), tuplets: [],
    };
    for (const staff of session.score.staves) {
      for (const measure of staff.measures) {
        for (const [index, voice] of measure.voices.entries()) {
          const event = voice.events.find(candidate => candidate.id === session.selectionId);
          if (!event) continue;
          return {
            ...base, event, staffLabel: staff.label, measureNumber: measure.number, voiceNumber: index + 1,
            remaining: subtract(meterTime(measure.meter), voice.events.reduce((time, item) => add(time, item.time), rational(0))),
            tuplets: voice.tuplets,
          };
        }
      }
    }
    return base;
  };
  const beforeOpen = vi.fn(() => {});
  const execute = vi.fn((command: AuthorCommand) => { session.execute(command); });
  const undo = vi.fn(() => { session.undo(); });
  const editor = new NoteEditor({ state, beforeOpen, execute, undo, canUndo: () => session.canUndo });
  const refresh = () => { if (view.autoRefresh) editor.refresh(); };
  session.addEventListener('change', refresh);
  cleanups.push(() => { session.removeEventListener('change', refresh); editor.dispose(); });
  return {
    editor, session, state, view, beforeOpen, execute, undo, panel, popover,
    trigger: control<HTMLButtonElement>('edit-selected-event'),
    duration: control<HTMLSelectElement>('note-duration'), dots: control<HTMLSelectElement>('note-dots'),
    undoButton: control<HTMLButtonElement>('note-editor-undo'), close: control<HTMLButtonElement>('close-note-editor'),
    feedback: control('note-editor-feedback'), error: control('note-editor-error'),
    button: (id: string) => control<HTMLButtonElement>(id),
  };
}

function change(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function expectClosed(value: ReturnType<typeof fixture>): void {
  expect(value.panel.dataset.noteEditorState).toBe('closed');
  expect(value.panel.dataset.eventId).toBeUndefined();
  expect(value.panel.dataset.revision).toBeUndefined();
  expect(value.trigger.getAttribute('aria-expanded')).toBe('false');
  expect(value.undoButton.disabled).toBe(true);
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
});

describe('selected note controls against the actual author shell', () => {
  it('opens on accepted music, names its location, and focuses the actual accidental', () => {
    const h = fixture(source(note('n1', 'pitch="Fbb4" duration="eighth" dots="2"')));
    h.beforeOpen.mockImplementation(() => h.editor.refresh());
    control<HTMLInputElement>('event-pitch').value = 'A#6';
    h.editor.open();
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.trigger.getAttribute('aria-controls')).toBe('note-editor');
    expect(h.trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(h.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(h.panel.dataset.eventId).toBe('n1');
    expect(h.panel.dataset.revision).toBe('0');
    expect(control('note-editor-heading').textContent).toBe('Edit Fbb4');
    expect(control('note-editor-context').textContent).toContain('Flute · measure 12 · voice 1');
    expect(control('note-rhythm-help').textContent).toContain('Onset 0 whole notes');
    expect(h.duration.value).toBe('eighth');
    expect(h.dots.value).toBe('2');
    expect(document.activeElement).toBe(h.button('note-double-flat'));
    expect(accidentalIds.filter(id => h.button(id).getAttribute('aria-pressed') === 'true')).toEqual(['note-double-flat']);
    expect(h.session.revision).toBe(0);
  });

  it('applies one absolute accidental to the selected source ID, retains focus, and adds exactly one undo step', () => {
    const h = fixture(source(note('n1', 'pitch="F4" duration="quarter" accidental-display="courtesy" data-author="keep"') + note('n2')));
    const accepted = h.session.project.sourceHtml;
    const target = h.session.source.querySelector('#n1');
    const neighbor = h.session.source.querySelector('#n2');
    h.editor.open();
    h.button('note-sharp').focus();
    h.button('note-sharp').click();
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-note-accidental', eventId: 'n1', alter: 1, ties: 'reject' });
    expect(h.session.revision).toBe(1);
    expect(h.session.source.querySelector('#n1')).toBe(target);
    expect(target?.getAttribute('pitch')).toBe('F#4');
    expect(target?.getAttribute('accidental-display')).toBe('courtesy');
    expect(target?.getAttribute('data-author')).toBe('keep');
    expect(h.session.source.querySelector('#n2')).toBe(neighbor);
    expect(neighbor?.getAttribute('pitch')).toBe('F4');
    expect(h.session.selectionId).toBe('n1');
    expect(h.panel.dataset.revision).toBe('1');
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(document.activeElement).toBe(h.button('note-sharp'));
    expect(h.feedback.textContent).toContain('Applied. F#4');
    h.button('note-sharp').click();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.revision).toBe(1);
    expect(h.feedback.textContent).toContain('No undo step');
    h.undoButton.click();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.session.project.sourceHtml).toBe(accepted);
    expect(h.session.canUndo).toBe(false);
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(h.undoButton.disabled).toBe(true);
  });

  it.each(['accidental', 'duration', 'dots'])('adds no history for an unchanged %s', property => {
    const h = fixture();
    h.editor.open();
    if (property === 'accidental') h.button('note-natural').click();
    else if (property === 'duration') change(h.duration, 'quarter');
    else change(h.dots, '0');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.revision).toBe(0);
    expect(h.session.canUndo).toBe(false);
    expect(h.feedback.textContent).toContain('No undo step');
    expect(h.undoButton.disabled).toBe(true);
  });

  it.each(['ctrlKey', 'metaKey'] as const)('keeps %s+Z local to changes made during this opening', modifier => {
    const h = fixture();
    h.session.update('Earlier title', draft => { draft.metadata.title = 'Keep this earlier edit'; });
    h.editor.open();
    expect(h.undoButton.disabled).toBe(true);
    expect(key(h.button('note-natural'), 'z', { [modifier]: true }).defaultPrevented).toBe(true);
    expect(h.undo).not.toHaveBeenCalled();
    h.button('note-flat').click();
    h.undoButton.focus();
    key(h.undoButton, 'z', { [modifier]: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('F4');
    expect(h.session.project.metadata.title).toBe('Keep this earlier edit');
    expect(h.session.canUndo).toBe(true);
    expect(h.undoButton.disabled).toBe(true);
    expect(document.activeElement).toBe(h.button('note-natural'));
    key(h.button('note-natural'), 'z', { [modifier]: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.feedback.textContent).toContain('no changes to undo');
  });

  it('starts a fresh local undo boundary after closing and reopening', () => {
    const h = fixture();
    h.editor.open();
    h.button('note-sharp').click();
    h.close.click();
    h.editor.open();
    expect(h.undoButton.disabled).toBe(true);
    key(h.button('note-sharp'), 'z', { metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('F#4');
  });

  it('changes duration using accepted dots, not stale controls or insertion values', () => {
    const h = fixture(source(note('n1', 'pitch="F#4" duration="quarter" dots="1"') + note('n2', 'pitch="G4" duration="eighth"')));
    h.editor.open();
    h.dots.value = '3';
    h.duration.focus();
    change(h.duration, 'eighth');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-event-rhythm', eventId: 'n1', duration: 'eighth', dots: 1 });
    expect(h.state().event).toMatchObject({ duration: 'eighth', dots: 1, pitches: [{ step: 'F', octave: 4, alter: 1 }] });
    expect(h.dots.value).toBe('1');
    expect(document.activeElement).toBe(h.duration);
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(h.session.revision).toBe(1);
  });

  it('changes dots using accepted duration rather than another uncommitted control value', () => {
    const h = fixture();
    h.editor.open();
    h.duration.value = 'whole';
    h.dots.focus();
    change(h.dots, '1');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ type: 'set-event-rhythm', eventId: 'n1', duration: 'quarter', dots: 1 });
    expect(h.duration.value).toBe('quarter');
    expect(h.state().event?.time).toEqual(rational(3, 8));
    expect(document.activeElement).toBe(h.dots);
  });

  it('shows exact written and elapsed tuplet values while preserving its source group', () => {
    const h = fixture(source(`<music-tuplet id="triplet" actual="3" normal="2">${note('n1', 'pitch="F4" duration="eighth"')}${note('n2', 'pitch="G4" duration="eighth"')}${note('n3', 'pitch="A4" duration="eighth"')}</music-tuplet>`));
    const group = h.session.source.querySelector('#triplet');
    h.editor.open();
    expect(control('note-rhythm-help').textContent).toContain('Tuplet 3:2: 1/8 written whole notes occupy 1/12 whole notes here');
    change(h.duration, 'sixteenth');
    expect(h.state().event?.time).toEqual(rational(1, 24));
    expect(h.session.source.querySelector('#triplet')).toBe(group);
    expect(h.state().event?.tupletIds).toEqual(['triplet']);
  });

  it('rejects overflow atomically, resets the select, keeps its focus, and permits a correction', () => {
    const h = fixture(source(note('n1', 'pitch="F4" duration="half"') + note('n2', 'pitch="G4" duration="half"'), ''));
    const accepted = h.session.project;
    h.editor.open();
    h.duration.focus();
    change(h.duration, 'whole');
    expect(h.session.project).toEqual(accepted);
    expect(h.session.revision).toBe(0);
    expect(h.session.canUndo).toBe(false);
    expect(h.duration.value).toBe('half');
    expect(document.activeElement).toBe(h.duration);
    expect(h.error.hidden).toBe(false);
    expect(h.error.textContent).toContain('No change was applied.');
    expect(h.panel.dataset.noteEditorState).toBe('open');
    change(h.duration, 'quarter');
    expect(h.error.hidden).toBe(true);
    expect(h.session.revision).toBe(1);
    expect(h.session.source.querySelector('#bar')?.hasAttribute('incomplete')).toBe(true);
    expect(h.session.source.querySelectorAll('music-rest')).toHaveLength(0);
  });

  it.each([
    ['half', 'Remove the dots first'],
    ['whole', 'Even without dots, this duration exceeds the available space'],
  ])('gives a truthful dotted-overflow correction for %s', (duration, message) => {
    const h = fixture(source(note('n1', 'pitch="F4" duration="quarter" dots="1"') + note('n2', 'pitch="G4" duration="half"')));
    h.editor.open();
    change(h.duration, duration);
    expect(h.error.hidden).toBe(false);
    expect(h.error.textContent).toContain(message);
    expect(h.session.revision).toBe(0);
    expect(h.duration.value).toBe('quarter');
    expect(h.dots.value).toBe('1');
  });

  it('rejects malformed select values without invoking the transaction callback', () => {
    const h = fixture();
    h.editor.open();
    h.duration.selectedIndex = -1;
    h.duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.error.textContent).toContain('Choose a supported note value');
    expect(h.duration.value).toBe('quarter');
    expect(h.session.revision).toBe(0);
  });
});

describe('selected source identity and revision boundaries', () => {
  it.each([true, false])('rejects a changed selection with automatic refresh %s', autoRefresh => {
    const h = fixture();
    h.editor.open();
    const accepted = h.session.project;
    h.view.autoRefresh = autoRefresh;
    h.session.select('n2');
    h.button('note-sharp').click();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(accepted);
    expect(h.session.revision).toBe(0);
    expectClosed(h);
    h.editor.open();
    expect(h.panel.dataset.eventId).toBe('n2');
    expect(control('note-editor-heading').textContent).toBe('Edit G4');
  });

  it.each([true, false])('rejects an external revision even when source ID stays the same, automatic refresh %s', autoRefresh => {
    const h = fixture();
    h.editor.open();
    h.view.autoRefresh = autoRefresh;
    h.session.execute({ type: 'set-note-accidental', eventId: 'n1', alter: -1, ties: 'reject' });
    const accepted = h.session.project;
    change(h.duration, 'eighth');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(accepted);
    expect(h.session.revision).toBe(1);
    expectClosed(h);
    h.editor.open();
    expect(h.panel.dataset.revision).toBe('1');
    expect(document.activeElement).toBe(h.button('note-flat'));
  });

  it.each(['read', 'pages', 'pending', 'multiple', 'none'] as const)('blocks actions and reopening for %s state', kind => {
    const h = fixture();
    h.editor.open();
    h.view.autoRefresh = false;
    if (kind === 'read' || kind === 'pages') h.view.mode = kind;
    else if (kind === 'pending') h.session.setPendingSource('<music-staff>unfinished');
    else if (kind === 'multiple') h.view.selectionCount = 2;
    else h.session.select();
    const accepted = h.session.project;
    const revision = h.session.revision;
    h.button('note-sharp').click();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(accepted);
    expect(h.session.revision).toBe(revision);
    expectClosed(h);
    expect(h.trigger.disabled).toBe(true);
    h.editor.open();
    expectClosed(h);
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
  });

  it('closes on an external undo and cannot undo any further from the stale panel', () => {
    const h = fixture();
    h.editor.open();
    h.button('note-sharp').click();
    h.session.undo();
    expectClosed(h);
    key(h.button('note-sharp'), 'z', { ctrlKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('F4');
  });

  it('checks state again after beforeOpen changes the mode', () => {
    const h = fixture();
    h.beforeOpen.mockImplementation(() => { h.view.mode = 'read'; h.editor.refresh(); });
    h.editor.open();
    expectClosed(h);
    expect(h.panel.hidden).toBe(true);
    expect(h.trigger.disabled).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('does not retain an old binding when a transaction changes the selected event', () => {
    const h = fixture();
    h.editor.open();
    h.execute.mockImplementation(command => { h.session.execute(command); h.session.select('n2'); });
    h.button('note-flat').click();
    expectClosed(h);
    expect(h.session.source.querySelector('#n1')?.getAttribute('pitch')).toBe('Fb4');
    expect(h.session.source.querySelector('#n2')?.getAttribute('pitch')).toBe('G4');
    h.button('note-sharp').click();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
});

describe('event-specific selected controls', () => {
  it.each([
    ['tied note', note('n1', 'pitch="F4" duration="half" tie="start"') + note('n2', 'pitch="F4" duration="half" tie="end"'), 'tie chain'],
    ['chord', '<music-chord id="n1" pitches="C4 E4 G4" duration="whole"></music-chord>', 'separate pitch spellings'],
    ['rest', '<music-rest id="n1" duration="whole"></music-rest>', 'no pitch or accidental'],
    ['rhythmic slash', '<music-slash id="n1" duration="whole" rhythmic></music-slash>', 'no pitch or accidental'],
  ])('disables accidental shortcuts for a %s without disabling valid rhythm edits', (_label, events, reason) => {
    const h = fixture(source(events, ''));
    h.editor.open();
    expect(accidentalIds.every(id => h.button(id).disabled)).toBe(true);
    expect(control('note-accidental-help').textContent).toContain(reason);
    expect(h.duration.disabled).toBe(false);
    expect(h.dots.disabled).toBe(false);
    expect(document.activeElement).toBe(h.duration);
    // Direct dispatch bypasses native disabled-button behavior, testing the semantic guard too.
    h.button('note-sharp').dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.error.textContent).toContain(reason);
    expect(h.session.revision).toBe(0);
    change(h.duration, 'quarter');
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.revision).toBe(1);
  });

  it.each([
    ['full-measure rest', '<music-rest id="n1" measure></music-rest>', 'follows the meter'],
    ['open slash', '<music-slash id="n1" duration="whole"></music-slash>', 'leaves attacks to the performer'],
  ])('explains unavailable quick actions for a %s and does not guess a conversion', (_label, events, reason) => {
    const h = fixture(source(events, ''));
    const accepted = h.session.project;
    h.editor.open();
    expect(accidentalIds.every(id => h.button(id).disabled)).toBe(true);
    expect(h.duration.disabled).toBe(true);
    expect(h.dots.disabled).toBe(true);
    expect(control('note-rhythm-help').textContent).toContain(reason);
    expect(document.activeElement).toBe(h.close);
    change(h.duration, 'eighth');
    expect(h.error.textContent).toContain(reason);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.project).toEqual(accepted);
    expect(h.session.revision).toBe(0);
  });
});

describe('native-popover lifecycle unit stub and ordinary-flow fallback', () => {
  it('keeps native popover attributes and focuses an accepted control after the open toggle', async () => {
    const h = fixture(source(), true);
    h.trigger.focus();
    h.editor.open();
    expect(h.popover?.show).toHaveBeenCalledTimes(1);
    expect(h.popover?.isOpen()).toBe(true);
    expect(h.panel.getAttribute('popover')).toBe('auto');
    expect(h.panel.dataset.popoverFallback).toBeUndefined();
    expect(h.trigger.getAttribute('popovertarget')).toBe('note-editor');
    expect(h.close.getAttribute('popovertargetaction')).toBe('hide');
    await Promise.resolve();
    expect(document.activeElement).toBe(h.button('note-natural'));
    h.popover?.hide();
    expectClosed(h);
    h.button('note-sharp').click();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it.each(['beforetoggle', 'toggle'] as const)('ignores a descendant %s so a native child picker cannot close or reopen its parent', async type => {
    const h = fixture(source(), true);
    h.editor.open();
    await Promise.resolve();
    h.dots.focus();
    toggle(h.dots, type, 'closed');
    toggle(h.dots, type, 'open');
    await Promise.resolve();
    expect(h.panel.dataset.noteEditorState).toBe('open');
    expect(h.panel.dataset.eventId).toBe('n1');
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(h.dots);
    h.button('note-sharp').click();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.session.revision).toBe(1);
  });

  it('does not steal focus from a control already focused before the queued open callback', async () => {
    const h = fixture(source(), true);
    h.editor.open();
    h.dots.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(h.dots);
  });

  it('does not refocus a panel that closed before its queued open callback', async () => {
    const h = fixture(source(), true);
    h.editor.open();
    h.session.select('n2');
    h.trigger.focus();
    await Promise.resolve();
    expectClosed(h);
    expect(document.activeElement).toBe(h.trigger);
    expect(h.popover?.isOpen()).toBe(false);
  });

  it('leaves native Escape handling to the browser instead of installing a competing dismissal', () => {
    const h = fixture(source(), true);
    h.editor.open();
    expect(key(h.button('note-natural'), 'Escape').defaultPrevented).toBe(false);
    expect(h.popover?.hide).not.toHaveBeenCalled();
  });

  it('uses hidden ordinary document flow, native selects, and explicit close when popovers are unavailable', () => {
    const h = fixture();
    const parent = h.panel.parentElement;
    const scroll = vi.fn();
    Object.defineProperty(h.panel, 'scrollIntoView', { configurable: true, value: scroll });
    expect(h.panel.hidden).toBe(true);
    expect(h.panel.dataset.popoverFallback).toBe('true');
    expect(h.panel.hasAttribute('popover')).toBe(false);
    expect(h.trigger.hasAttribute('popovertarget')).toBe(false);
    expect(h.close.hasAttribute('popovertarget')).toBe(false);
    h.trigger.click();
    expect(h.panel.hidden).toBe(false);
    expect(h.panel.parentElement).toBe(parent);
    expect(h.panel.style.position).toBe('');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
    expect(h.duration.tagName).toBe('SELECT');
    expect(h.duration.labels?.[0]?.textContent).toContain('Note value');
    expect(h.duration.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
    expect(h.duration.getAttribute('role')).toBeNull();
    h.close.click();
    expectClosed(h);
    expect(h.panel.hidden).toBe(true);
    expect(document.activeElement).toBe(h.trigger);
  });

  it('lets Escape dismiss the fallback but reserves Escape on a select for its native picker', () => {
    const h = fixture();
    h.editor.open();
    h.duration.focus();
    expect(key(h.duration, 'Escape').defaultPrevented).toBe(false);
    expect(h.panel.dataset.noteEditorState).toBe('open');
    h.button('note-natural').focus();
    expect(key(h.button('note-natural'), 'Escape').defaultPrevented).toBe(true);
    expectClosed(h);
    expect(document.activeElement).toBe(h.trigger);
  });

  it('falls back to ordinary flow if the native open method throws', () => {
    const h = fixture(source(), true);
    h.popover!.show.mockImplementation(() => { throw new Error('Unavailable native popover'); });
    h.editor.open();
    expect(h.panel.hidden).toBe(false);
    expect(h.panel.dataset.popoverFallback).toBe('true');
    expect(h.panel.hasAttribute('popover')).toBe(false);
    expect(h.panel.dataset.noteEditorState).toBe('open');
    h.button('note-flat').click();
    expect(h.session.revision).toBe(1);
    h.close.click();
    expectClosed(h);
  });

  it.each([true, false])('disposes open controls, aborts listeners and queued focus, and stays disposed (native stub %s)', async native => {
    const h = fixture(source(), native);
    h.editor.open();
    h.editor.dispose();
    h.trigger.focus();
    h.editor.dispose();
    h.editor.open();
    h.editor.refresh();
    h.trigger.dispatchEvent(new Event('click', { bubbles: true }));
    h.button('note-sharp').dispatchEvent(new Event('click', { bubbles: true }));
    change(h.duration, 'eighth');
    toggle(h.panel, 'toggle', 'open');
    await Promise.resolve();
    expectClosed(h);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.session.revision).toBe(0);
    expect(document.activeElement).toBe(h.trigger);
    expect(h.beforeOpen).toHaveBeenCalledTimes(1);
    if (native) expect(h.popover?.isOpen()).toBe(false);
    else expect(h.panel.hidden).toBe(true);
  });
});
