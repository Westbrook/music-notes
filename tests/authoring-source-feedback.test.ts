// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import authorHtml from '../author.html?raw';
import { SourceFeedback } from '../src/authoring/source-feedback.js';

const source = '<music-staff><music-measure incomplete></music-measure></music-staff>';
const shellMarkup = authorHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const simpleMarkup = `<div id="score-editor" tabindex="0"></div>
  <section id="source-panel" popover="auto"><div class="popover-body">
    <label for="source-input">Musical HTML</label><textarea id="source-input" aria-describedby="source-status source-error"></textarea>
    <p id="source-status" role="status">Unapplied Source</p><p id="source-error" role="alert" hidden></p>
    <button id="source-apply" type="button">Apply source</button>
  </div></section>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing ${id}`);
  return result as T;
}

function fixture(markup = simpleMarkup) {
  document.body.innerHTML = markup;
  const input = element<HTMLTextAreaElement>('source-input');
  const error = element('source-error');
  const body = error.closest<HTMLElement>('.popover-body')!;
  input.value = source;
  const feedback = new SourceFeedback();
  return { feedback, input, error, body };
}

function rect(top: number, height: number, width = 300): DOMRect {
  return { x: 20, y: top, top, bottom: top + height, left: 20, right: 20 + width, width, height, toJSON: () => ({}) };
}

function geometry(body: HTMLElement, error: HTMLElement, options: {
  scrollTop?: number; scrollHeight?: number; clientHeight?: number; clientTop?: number;
  bodyTop?: number; bodyHeight?: number; offsetHeight?: number; errorTop: number; errorHeight?: number;
}) {
  const clientHeight = options.clientHeight ?? 180;
  const clientTop = options.clientTop ?? 0;
  const bodyHeight = options.bodyHeight ?? clientHeight + clientTop * 2;
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: options.scrollHeight ?? 800 },
    clientTop: { configurable: true, value: clientTop },
    offsetHeight: { configurable: true, value: options.offsetHeight ?? bodyHeight },
  });
  body.scrollTop = options.scrollTop ?? 100;
  body.scrollLeft = 17;
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(options.bodyTop ?? 100, bodyHeight));
  vi.spyOn(error, 'getBoundingClientRect').mockReturnValue(rect(options.errorTop, options.errorHeight ?? 30));
}

afterEach(() => { document.body.replaceChildren(); });

describe('Source feedback identity and accessible text', () => {
  it('requires the actual textarea and alert supplied by the authoring shell', () => {
    const f = fixture(shellMarkup);
    expect(f.input.localName).toBe('textarea');
    expect(f.error.getAttribute('role')).toBe('alert');
    expect(f.error.closest('#source-panel')).not.toBeNull();
    expect(f.body).not.toBeNull();
    expect(f.input.getAttribute('aria-describedby')?.split(/\s+/)).toContain('source-error');
    f.feedback.fail('opened-1', source, 'The measure contains an unsupported element.');
    expect(f.error.textContent).toBe('The measure contains an unsupported element.');
  });

  it.each([
    '<p id="source-error" role="alert"></p>',
    '<input id="source-input"><p id="source-error" role="alert"></p>',
    '<textarea id="source-input"></textarea>',
    '<textarea id="source-input"></textarea><p id="source-error" role="status"></p>',
  ])('fails clearly if required source controls are missing or have the wrong semantics', markup => {
    document.body.innerHTML = markup;
    expect(() => new SourceFeedback()).toThrow(/source-input|source-error/);
  });

  it('starts clear and removes a stale DOM error from an earlier controller instance', () => {
    const f = fixture(simpleMarkup.replace('role="alert" hidden', 'role="alert"').replace('<p id="source-error" role="alert"></p>', '<p id="source-error" role="alert">Old error</p>'));
    expect(f.feedback.message).toBe('');
    expect(f.error.hidden).toBe(true);
    expect(f.error.textContent).toBe('');
    expect(f.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('renders supplied diagnostics as text and marks only the source field invalid', () => {
    const f = fixture();
    const message = '<img src=x onerror="bad()"> is not supported. Use musical HTML.';
    f.feedback.fail('opened-1', source, message);
    expect(f.feedback.message).toBe(message);
    expect(f.error.textContent).toBe(message);
    expect(f.error.children).toHaveLength(0);
    expect(f.error.hidden).toBe(false);
    expect(f.error.getAttribute('role')).toBe('alert');
    expect(f.input.getAttribute('aria-invalid')).toBe('true');
    expect(element('source-status').textContent).toBe('Unapplied Source');
    expect(f.input.getAttribute('aria-describedby')).toBe('source-status source-error');
  });

  it('retains the local error across refreshes with the same opened document and exact draft text', () => {
    const f = fixture();
    f.feedback.fail('opened-1', source, 'A measure cannot overflow.');
    for (let i = 0; i < 5; i++) f.feedback.refresh('opened-1', source);
    expect(f.feedback.message).toBe('A measure cannot overflow.');
    expect(f.error.hidden).toBe(false);
    expect(f.input.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears an error as soon as the exact draft changes, including a whitespace-only edit', () => {
    const f = fixture();
    f.feedback.fail('opened-1', source, 'A measure cannot overflow.');
    f.feedback.refresh('opened-1', `${source}\n`);
    expect(f.feedback.message).toBe('');
    expect(f.error.textContent).toBe('');
    expect(f.error.hidden).toBe(true);
    expect(f.input.hasAttribute('aria-invalid')).toBe(false);
    f.feedback.refresh('opened-1', source);
    expect(f.feedback.message).toBe('');
  });

  it('clears a previous opened-document error even when the new document uses identical source IDs and text', () => {
    const f = fixture();
    f.feedback.fail('opened-1', source, 'Only the earlier opened document failed.');
    f.feedback.refresh('opened-2', source);
    expect(f.feedback.message).toBe('');
    expect(f.error.hidden).toBe(true);
    expect(f.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('explicit clear on replacement invalidates a failure even if persisted document ID and text are reused', () => {
    const f = fixture();
    f.feedback.fail('same-persisted-id', source, 'An earlier open failed.');
    f.feedback.clear();
    f.feedback.refresh('same-persisted-id', source);
    expect(f.feedback.message).toBe('');
    expect(f.error.hidden).toBe(true);
  });

  it('replaces the last failure with the next attempted draft and diagnostic', () => {
    const f = fixture();
    f.feedback.fail('opened-1', source, 'First problem');
    const changed = `${source}\n<!-- Changed draft -->`;
    f.feedback.fail('opened-1', changed, 'Second problem');
    f.feedback.refresh('opened-1', changed);
    expect(f.feedback.message).toBe('Second problem');
    f.feedback.refresh('opened-1', source);
    expect(f.feedback.message).toBe('');
  });

  it('is session-only and never changes the textarea value or accepted notation', () => {
    const f = fixture();
    const score = element('score-editor');
    score.innerHTML = '<music-staff id="accepted"></music-staff>';
    const sourceElement = score.firstElementChild;
    const events = vi.fn();
    f.input.addEventListener('input', events);
    f.input.addEventListener('change', events);
    f.feedback.fail('opened-1', 'other invalid raw draft', 'Correct this draft.');
    f.feedback.refresh('opened-1', 'other invalid raw draft');
    f.feedback.clear();
    expect(f.input.value).toBe(source);
    expect(score.firstElementChild).toBe(sourceElement);
    expect(score.innerHTML).toBe('<music-staff id="accepted"></music-staff>');
    expect(events).not.toHaveBeenCalled();
  });

  it('scopes all operations to a supplied document rather than the global page', () => {
    const global = fixture();
    const alternate = document.implementation.createHTMLDocument('Another editor');
    alternate.body.innerHTML = simpleMarkup;
    const feedback = new SourceFeedback(alternate);
    feedback.fail('alternate', source, 'Alternate document error');
    expect(alternate.getElementById('source-error')!.textContent).toBe('Alternate document error');
    expect(global.feedback.message).toBe('');
    expect(global.error.hidden).toBe(true);
  });
});

describe('Source error scroll containment', () => {
  it('reveals a newly failed message below the body viewport by scrolling only that body', () => {
    const f = fixture();
    geometry(f.body, f.error, { errorTop: 300, errorHeight: 40 });
    const apply = element('source-apply');
    apply.focus();
    const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const score = element('score-editor');
    score.scrollTop = 321;
    document.documentElement.scrollTop = 55;
    f.feedback.fail('opened-1', source, 'Error below the viewport.');
    expect(f.body.scrollTop).toBe(160);
    expect(f.body.scrollLeft).toBe(17);
    expect(score.scrollTop).toBe(321);
    expect(document.documentElement.scrollTop).toBe(55);
    expect(document.activeElement).toBe(apply);
    expect(reveal).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('reveals a message above the current viewport without changing focus', () => {
    const f = fixture();
    geometry(f.body, f.error, { scrollTop: 200, errorTop: 70, errorHeight: 20 });
    f.feedback.fail('opened-1', source, 'Error above the viewport.');
    expect(f.body.scrollTop).toBe(170);
  });

  it('does not scroll an error that is already entirely visible', () => {
    const f = fixture();
    geometry(f.body, f.error, { errorTop: 150, errorHeight: 40 });
    f.feedback.fail('opened-1', source, 'Visible error.');
    expect(f.body.scrollTop).toBe(100);
  });

  it('aligns the beginning of a long error rather than scrolling past its first lines', () => {
    const f = fixture();
    geometry(f.body, f.error, { scrollTop: 400, errorTop: 40, errorHeight: 240 });
    f.feedback.fail('opened-1', source, 'A long diagnostic.');
    expect(f.body.scrollTop).toBe(340);
  });

  it.each([
    { scrollTop: 5, errorTop: -50, scrollHeight: 800, expected: 0 },
    { scrollTop: 590, errorTop: 310, scrollHeight: 800, expected: 620 },
    { scrollTop: 0, errorTop: 300, scrollHeight: 180, expected: 0 },
  ])('clamps a reveal to actual scrollable body bounds', ({ expected, ...options }) => {
    const f = fixture();
    geometry(f.body, f.error, options);
    f.feedback.fail('opened-1', source, 'Bounded error.');
    expect(f.body.scrollTop).toBe(expected);
  });

  it('uses the content viewport inside the body border', () => {
    const f = fixture();
    geometry(f.body, f.error, { clientTop: 4, bodyHeight: 188, errorTop: 280, errorHeight: 20 });
    f.feedback.fail('opened-1', source, 'Error at the lower content border.');
    expect(f.body.scrollTop).toBe(116);
  });

  it('converts measured visual deltas to scroll units if the body is scaled', () => {
    const f = fixture();
    geometry(f.body, f.error, { clientHeight: 180, bodyHeight: 360, offsetHeight: 180, errorTop: 480, errorHeight: 60 });
    f.feedback.fail('opened-1', source, 'Scaled body error.');
    expect(f.body.scrollTop).toBe(140);
  });

  it.each([
    { clientHeight: 0, bodyHeight: 0, errorTop: 300 },
    { bodyHeight: 0, errorTop: 300 },
    { errorTop: 300, errorHeight: 0 },
  ])('does not try to reveal an unmeasurable or closed popover', options => {
    const f = fixture();
    geometry(f.body, f.error, options);
    f.feedback.fail('opened-1', source, 'Keep the error for the next opening.');
    expect(f.body.scrollTop).toBe(100);
    expect(f.feedback.message).toBe('Keep the error for the next opening.');
  });

  it('does not re-scroll the retained error on tab, view, or global Review refresh', () => {
    const f = fixture();
    geometry(f.body, f.error, { errorTop: 300 });
    f.feedback.fail('opened-1', source, 'Retained local error.');
    f.body.scrollTop = 20;
    for (let i = 0; i < 4; i++) f.feedback.refresh('opened-1', source);
    expect(f.body.scrollTop).toBe(20);
    expect(f.feedback.message).toBe('Retained local error.');
  });

  it('clears without scrolling the source body or any notation container', () => {
    const f = fixture();
    geometry(f.body, f.error, { errorTop: 300 });
    f.feedback.fail('opened-1', source, 'Old error.');
    f.body.scrollTop = 44;
    f.feedback.clear();
    expect(f.body.scrollTop).toBe(44);
    expect(f.input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('still reports the error if no scrollable popover body is present', () => {
    const f = fixture(simpleMarkup.replace('class="popover-body"', 'class="ordinary-section"'));
    expect(f.body).toBeNull();
    expect(() => f.feedback.fail('opened-1', source, 'Visible in the ordinary fallback.')).not.toThrow();
    expect(f.error.hidden).toBe(false);
    expect(f.error.textContent).toBe('Visible in the ordinary fallback.');
  });
});
