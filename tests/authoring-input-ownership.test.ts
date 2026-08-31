import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthorTextSelection, classifyAuthorInput, hasInputModifier, isNativeAuthorInput,
  isNativeSecondaryClick, selectionModifier } from '../src/authoring/input-ownership.js';
import type { AuthorInputOwner } from '../src/authoring/input-ownership.js';
import type { LayoutGeometry, MusicSurface } from '../src/components/music-surface.js';

const boundaries: AuthorTextSelection[] = [];
const NS = 'http://www.w3.org/2000/svg';

function fixture() {
  const host = document.createElement('div'); document.body.append(host);
  const outer = host.attachShadow({ mode: 'open' });
  const surface = document.createElement('music-system') as MusicSurface; outer.append(surface);
  const shadow = surface.attachShadow({ mode: 'open' });
  const svg = document.createElementNS(NS, 'svg'); svg.classList.add('notation-svg'); shadow.append(svg);
  const sources = new Map<string, Element>();
  const draw = (id: string, tag: string) => {
    const source = document.createElement(tag); source.id = id; sources.set(id, source);
    const group = document.createElementNS(NS, 'g'); group.setAttribute('data-source-id', id);
    const glyph = document.createElementNS(NS, 'text'); glyph.textContent = 'glyph'; group.append(glyph); svg.append(group);
    return { source, group, glyph };
  };
  const note = draw('note', 'music-note');
  const mark = draw('mark', 'music-articulation');
  const instruction = draw('instruction', 'music-direction');
  const transcript = document.createElement('details'); transcript.className = 'transcript';
  transcript.innerHTML = '<summary>Read score</summary><pre>Readable <span>score text</span></pre>'; shadow.append(transcript);
  let hit: string | undefined = 'note';
  let layout: LayoutGeometry | undefined = { projection: 'screen', projectionId: 'projection', revision: 1, scoreId: 'score', systems: [] };
  Object.defineProperties(surface, {
    getSource: { value: (id: string) => sources.get(id) },
    getSourceAtPoint: { value: () => hit },
    getLayoutGeometry: { value: () => layout },
  });
  const context = { enabled: true, surface: surface as MusicSurface | undefined };
  const boundary = new AuthorTextSelection({ host, context: () => context }); boundaries.push(boundary);
  return { host, surface, shadow, svg, note, mark, instruction, transcript, sources, context, boundary,
    hit: (id: string | undefined) => { hit = id; }, layout: (value: LayoutGeometry | undefined) => { layout = value; } };
}

function classify(target: Element, event: Event, f: ReturnType<typeof fixture>) {
  let owner: AuthorInputOwner | undefined; let native = false;
  const record = (value: Event) => {
    owner = classifyAuthorInput(value, { host: f.host, surface: f.context.surface });
    native = isNativeAuthorInput(value);
  };
  target.addEventListener(event.type, record, { once: true }); target.dispatchEvent(event);
  return { owner: owner!, native };
}

function mouse(type: string, target: EventTarget, extra: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: 100, clientY: 100, ...extra });
  target.dispatchEvent(event); return event;
}
function start(target: EventTarget): Event {
  const event = new Event('selectstart', { bubbles: true, composed: true, cancelable: true }); target.dispatchEvent(event); return event;
}
function key(): KeyboardEvent { return new KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'Enter' }); }

afterEach(() => {
  boundaries.splice(0).forEach(boundary => boundary.dispose());
  document.body.replaceChildren(); vi.restoreAllMocks();
});

describe('Author input ownership through composed paths', () => {
  it.each(['button', 'input', 'textarea', 'select', 'summary', 'label', 'pre', 'code', 'blockquote'])('leaves native %s ownership intact through both shadow roots', tag => {
    const f = fixture(); const control = document.createElement(tag); const child = document.createElement('span');
    control.append(child); f.shadow.append(control);
    expect(classify(child, key(), f)).toEqual({ native: true, owner: { owner: 'native' } });
  });

  it.each(['', 'true', 'TRUE', 'plaintext-only'])('recognizes contenteditable=%j instead of only the true spelling', editable => {
    const f = fixture(); const region = document.createElement('div'); region.setAttribute('contenteditable', editable);
    const child = document.createElement('span'); region.append(child); f.shadow.append(region);
    expect(classify(child, key(), f).native).toBe(true);
  });

  it('keeps an inherited editable region and its read-only prose native', () => {
    const f = fixture(); const region = document.createElement('div'); region.contentEditable = 'true';
    const child = document.createElement('span'); child.contentEditable = 'false'; region.append(child); f.shadow.append(region);
    expect(classify(child, key(), f).native).toBe(true);
  });

  it.each(['false', 'invalid'])('does not invent editing ownership for standalone contenteditable=%s', editable => {
    const f = fixture(); const region = document.createElement('div'); region.setAttribute('contenteditable', editable); f.shadow.append(region);
    expect(classify(region, key(), f)).toEqual({ native: false, owner: { owner: 'score' } });
  });

  it.each(['radio', 'checkbox', 'slider', 'spinbutton', 'tab', 'textbox', 'menuitem'])('preserves custom %s keyboard ownership', role => {
    const f = fixture(); const control = document.createElement('div'); control.setAttribute('role', role); f.shadow.append(control);
    expect(classify(control, key(), f).native).toBe(true);
  });

  it('never turns transcript text or disclosure Enter into score entry', () => {
    const f = fixture();
    expect(classify(f.transcript.querySelector('span')!, key(), f).native).toBe(true);
    expect(classify(f.transcript.querySelector('summary')!, key(), f).native).toBe(true);
  });

  it('respects IME composition even when the score owns ordinary keys', () => {
    const f = fixture();
    expect(classify(f.host, new KeyboardEvent('keydown', { key: 'a', isComposing: true }), f).native).toBe(true);
  });

  it('does not rely on same-realm instanceof for native controls', () => {
    const f = fixture(); const frame = document.createElement('iframe'); document.body.append(frame);
    const other = frame.contentDocument!.createElement('button'); frame.contentDocument!.body.append(other);
    expect(classify(other, key(), f).native).toBe(true);
  });

  it('distinguishes event ink, exact child ink and an ordinary empty score area', () => {
    const f = fixture();
    expect(classify(f.note.glyph, key(), f).owner).toEqual({ owner: 'notation', sourceId: 'note', sourceElement: f.note.source });
    expect(classify(f.mark.glyph, key(), f).owner).toEqual({ owner: 'notation', sourceId: 'mark', sourceElement: f.mark.source });
    expect(classify(f.host, key(), f).owner).toEqual({ owner: 'score' });
  });

  it('uses current measured source identity for the pointer-inert music-system host', () => {
    const f = fixture(); f.hit('mark');
    const event = new MouseEvent('mousedown', { bubbles: true, composed: true, clientX: 100, clientY: 100 });
    expect(classify(f.surface, event, f).owner).toEqual({ owner: 'notation', sourceId: 'mark', sourceElement: f.mark.source });
  });

  it.each(['drawn', 'host'] as const)('leaves printed instruction prose native on the %s route', route => {
    const f = fixture(); f.hit('instruction');
    const event = new MouseEvent('mousedown', { bubbles: true, composed: true, clientX: 100, clientY: 100 });
    expect(classify(route === 'drawn' ? f.instruction.glyph : f.surface, event, f).owner)
      .toEqual({ owner: 'native', sourceId: 'instruction', sourceElement: f.instruction.source });
  });

  it('does not give stale or unknown source IDs musical ownership', () => {
    const f = fixture(); f.sources.delete('note');
    expect(classify(f.note.glyph, key(), f).owner).toEqual({ owner: 'score' });
  });

  it('leaves workbook drawings outside the Author host untouched', () => {
    const f = fixture(); const outside = document.createElementNS(NS, 'svg'); document.body.append(outside);
    expect(classify(outside, key(), f).owner).toEqual({ owner: 'outside' });
  });
});

describe('selection modifiers', () => {
  const plain = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  it.each(['Win32', 'Linux x86_64', 'MacIntel'])('uses Shift for ranges on %s', platform => {
    expect(selectionModifier({ ...plain, shiftKey: true }, platform)).toBe('range');
  });
  it('uses Command on macOS and Control elsewhere for additive selection', () => {
    expect(selectionModifier({ ...plain, metaKey: true }, 'MacIntel')).toBe('toggle');
    expect(selectionModifier({ ...plain, ctrlKey: true }, 'Win32')).toBe('toggle');
    expect(selectionModifier({ ...plain, ctrlKey: true }, 'Linux')).toBe('toggle');
    expect(selectionModifier({ ...plain, metaKey: true }, 'Win32')).toBeUndefined();
  });
  it('keeps macOS Control-click native even with Shift or Command', () => {
    expect(selectionModifier({ ...plain, ctrlKey: true }, 'MacIntel')).toBeUndefined();
    expect(selectionModifier({ ...plain, ctrlKey: true, shiftKey: true, metaKey: true }, 'MacIntel')).toBeUndefined();
    expect(isNativeSecondaryClick({ button: 0, ctrlKey: true }, 'MacIntel')).toBe(true);
  });
  it('does not repurpose Alt as range selection', () => {
    expect(selectionModifier({ ...plain, altKey: true, shiftKey: true }, 'Win32')).toBeUndefined();
  });
  it.each(['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const)('recognizes %s as a mutation guard even if not a selection shortcut', modifier => {
    expect(hasInputModifier({ ...plain, [modifier]: true })).toBe(true);
  });
});

describe('Author-only native text-selection boundary', () => {
  it.each(['note', 'mark'] as const)('cancels mouse text-selection on owned %s ink without stopping semantic click', target => {
    const f = fixture();
    expect(mouse('mousedown', f[target].glyph).defaultPrevented).toBe(true);
    expect(start(f[target].glyph).defaultPrevented).toBe(true);
    expect(mouse('click', f[target].glyph, { detail: 2 }).defaultPrevented).toBe(false);
  });
  it('cancels selectstart on an inert host only during a currently owned glyph press', () => {
    const f = fixture();
    expect(start(f.surface).defaultPrevented).toBe(false);
    expect(mouse('mousedown', f.surface).defaultPrevented).toBe(true);
    expect(start(f.surface).defaultPrevented).toBe(true);
    mouse('mouseup', f.surface);
    expect(start(f.surface).defaultPrevented).toBe(false);
  });
  it.each(['instruction', 'transcript', 'outside', 'field'] as const)('never cancels browser selection for %s', kind => {
    const f = fixture(); let target: Element;
    if (kind === 'instruction') target = f.instruction.glyph;
    else if (kind === 'transcript') target = f.transcript.querySelector('span')!;
    else { target = document.createElement(kind === 'field' ? 'textarea' : 'div'); document.body.append(target); }
    expect(mouse('mousedown', target).defaultPrevented).toBe(false);
    expect(start(target).defaultPrevented).toBe(false);
  });
  it('retains native text selection for instruction prose through the inert host', () => {
    const f = fixture(); f.hit('instruction');
    expect(mouse('mousedown', f.surface).defaultPrevented).toBe(false);
    expect(start(f.surface).defaultPrevented).toBe(false);
  });
  it('does not suppress macOS Control-click or secondary buttons', () => {
    const f = fixture(); vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    expect(mouse('mousedown', f.note.glyph, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(start(f.note.glyph).defaultPrevented).toBe(false);
    expect(mouse('mousedown', f.note.glyph, { button: 2 }).defaultPrevented).toBe(false);
    expect(start(f.note.glyph).defaultPrevented).toBe(false);
  });
  it('observes touch pointerdown without preventing native pan or zoom', () => {
    const f = fixture();
    const event = new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true,
      bubbles: true, composed: true, cancelable: true, clientX: 100, clientY: 100 });
    f.surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(start(f.surface).defaultPrevented).toBe(true);
  });
  it.each(['disabled', 'surface', 'layout', 'removed', 'scroll', 'dispose'] as const)('does not reuse an owned press after %s changes', change => {
    const f = fixture(); mouse('mousedown', f.surface);
    if (change === 'disabled') f.context.enabled = false;
    if (change === 'surface') f.context.surface = undefined;
    if (change === 'layout') f.layout({ projection: 'screen', projectionId: 'replacement', revision: 2, scoreId: 'score', systems: [] });
    if (change === 'removed') f.sources.delete('note');
    if (change === 'scroll') f.surface.dispatchEvent(new Event('scroll', { bubbles: true, composed: true }));
    if (change === 'dispose') f.boundary.dispose();
    expect(start(f.surface).defaultPrevented).toBe(false);
  });
  it('does not clear an existing unrelated browser text selection', () => {
    const f = fixture(); const clear = vi.spyOn(document.getSelection()!, 'removeAllRanges');
    mouse('mousedown', f.note.glyph); start(f.note.glyph);
    expect(clear).not.toHaveBeenCalled();
  });
});
