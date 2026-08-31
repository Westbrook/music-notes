// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { EventMarkingsEditor } from '../src/authoring/event-markings-editor.js';
import type { EventMarkingsContext } from '../src/authoring/event-markings-editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext } from '../src/authoring/inspector-forms.js';
import { MarkingsEditor } from '../src/authoring/markings-editor.js';
import type { MarkingsContext } from '../src/authoring/markings-editor.js';
import { createProject } from '../src/authoring/project.js';

const source = `<music-staff id="staff" notation="three-roads"><music-measure id="bar"><music-road id="n" direction="higher" duration="whole"><music-articulation id="accent" type="accent"></music-articulation><music-ornament id="ornament" type="trill"></music-ornament><music-interval id="third" value="b3" placement="below"></music-interval></music-road></music-measure></music-staff>`;
const cleanups: (() => void)[] = [];
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function field(id: string): HTMLInputElement | HTMLSelectElement {
  return document.querySelector(`[data-marking-id="${id}"] [data-marking-field]`) as HTMLInputElement | HTMLSelectElement;
}
function accepted(editor: EditorSession) { return { project: editor.project, revision: editor.revision, selection: editor.selectionId, cursor: editor.cursor, undo: editor.canUndo, redo: editor.canRedo }; }
function fixture() {
  mountAuthorFixture(); el('workspace-tools').hidden = false; el('selection-inspector').hidden = false;
  const editor = new EditorSession(createProject(source, 'Focus through the tools')); editor.select('n');
  const context: EventMarkingsContext = { mode: 'write', selectionId: 'n', rangeEventIds: ['n'], inspectionSelectionId: 'n', entryMode: false };
  const controller = new EventMarkingsEditor({ session: editor, context: () => context, select: id => editor.select(id),
    openTools: () => { el('workspace-tools').hidden = false; el('selection-inspector').hidden = false; } });
  field('third').value = '#'; field('third').dispatchEvent(new Event('input', { bubbles: true }));
  cleanups.push(() => controller.dispose());
  return { editor, controller, context };
}
function metrics(element: HTMLElement, height: number, scrollHeight: number, width = 220, scrollWidth = width): void {
  Object.defineProperties(element, {
    clientHeight: { value: height, configurable: true }, scrollHeight: { value: scrollHeight, configurable: true },
    clientWidth: { value: width, configurable: true }, scrollWidth: { value: scrollWidth, configurable: true },
  });
}
interface Geometry {
  panelId?: string;
  outerHeight?: number; outerContent?: number; outerWidth?: number; outerWidthContent?: number;
  innerHeight?: number; innerContent?: number; innerWidth?: number; innerWidthContent?: number;
  outerTop?: number; innerTop?: number; outerLeft?: number; innerLeft?: number;
  panelOffset?: number; targetY?: number; targetX?: number; labelHeight?: number;
}
function geometry(options: Geometry = {}) {
  const outer = el('workspace-tools'), inner = el(options.panelId ?? 'selection-inspector'), score = el('score-scroll'), workbench = el('author-workbench');
  metrics(outer, options.outerHeight ?? 160, options.outerContent ?? 1200, options.outerWidth ?? 220, options.outerWidthContent ?? options.outerWidth ?? 220);
  metrics(inner, options.innerHeight ?? 1100, options.innerContent ?? 1100, options.innerWidth ?? 220, options.innerWidthContent ?? options.innerWidth ?? 220);
  outer.scrollTop = options.outerTop ?? 31; inner.scrollTop = options.innerTop ?? 0;
  outer.scrollLeft = options.outerLeft ?? 0; inner.scrollLeft = options.innerLeft ?? 0;
  score.scrollTop = 237; score.scrollLeft = 29; workbench.scrollTop = 41; workbench.scrollLeft = 13;
  document.documentElement.scrollTop = 370; document.documentElement.scrollLeft = 53;
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === outer) return new DOMRect(40, 100, outer.clientWidth, outer.clientHeight);
    const panelTop = 100 + (options.panelOffset ?? 48) - outer.scrollTop;
    const panelLeft = 40 - outer.scrollLeft;
    if (this === inner) return new DOMRect(panelLeft, panelTop, inner.clientWidth, inner.clientHeight);
    const x = panelLeft + (options.targetX ?? 16) - inner.scrollLeft;
    const y = panelTop + (options.targetY ?? 600) - inner.scrollTop;
    const labelHeight = options.labelHeight ?? 64;
    return this.localName === 'label' ? new DOMRect(x, y - labelHeight + 44, 140, labelHeight) : new DOMRect(x, y, 120, 44);
  });
  const windowScroll = vi.spyOn(window, 'scrollTo'), intoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  cleanups.push(() => { bounds.mockRestore(); windowScroll.mockRestore(); intoView.mockRestore(); });
  const preserved = () => {
    expect(score.scrollTop).toBe(237); expect(score.scrollLeft).toBe(29);
    expect(workbench.scrollTop).toBe(41); expect(workbench.scrollLeft).toBe(13);
    expect(document.documentElement.scrollTop).toBe(370); expect(document.documentElement.scrollLeft).toBe(53);
    expect(windowScroll).not.toHaveBeenCalled(); expect(intoView).not.toHaveBeenCalled();
  };
  const visible = (target: HTMLElement, pane: HTMLElement) => {
    const targetRect = target.getBoundingClientRect(), paneRect = pane.getBoundingClientRect();
    expect(targetRect.top).toBeGreaterThanOrEqual(paneRect.top); expect(targetRect.bottom).toBeLessThanOrEqual(paneRect.top + pane.clientHeight);
    expect(targetRect.left).toBeGreaterThanOrEqual(paneRect.left); expect(targetRect.right).toBeLessThanOrEqual(paneRect.left + pane.clientWidth);
  };
  el('score-editor').focus();
  return { outer, inner, preserved, visible };
}

afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); document.body.replaceChildren(); document.documentElement.scrollTop = 0; document.documentElement.scrollLeft = 0; });

describe('attached-mark focus through actual tool scrollports', () => {
  it.each(['add', 'exact row', 'remove'] as const)('reveals %s through the outer tools pane without moving the natural-height inner panel', action => {
    const h = fixture(), acceptedBefore = accepted(h.editor), g = geometry();
    let target: HTMLElement;
    if (action === 'add') {
      el('add-event-interval').click(); target = el('event-markings-rows').lastElementChild!.querySelector<HTMLElement>('[data-marking-field="value"]')!;
    } else if (action === 'exact row') {
      target = field('ornament'); h.controller.openFor('n', 'ornament');
    } else {
      target = field('third'); document.querySelector<HTMLButtonElement>('[data-marking-id="ornament"] [data-remove-marking]')!.click();
    }
    expect(document.activeElement).toBe(target); expect(g.outer.scrollTop).toBeGreaterThan(31); expect(g.inner.scrollTop).toBe(0);
    g.visible(target, g.outer); g.preserved();
    expect(field('third').value).toBe('#'); expect(h.controller.snapshot().targetId).toBe('n'); expect(h.controller.hasDirty).toBe(true);
    expect(accepted(h.editor)).toEqual(acceptedBefore);
  });

  it('remeasures after the inner scroll before revealing through an outer scrollport', () => {
    const h = fixture(), g = geometry({ outerHeight: 180, outerContent: 1400, innerHeight: 120, innerContent: 1000, outerTop: 40, innerTop: 25, panelOffset: 320 });
    h.controller.openFor('n', 'ornament');
    expect(g.inner.scrollTop).toBeGreaterThan(25); expect(g.outer.scrollTop).toBeGreaterThan(40);
    g.visible(field('ornament'), g.inner); g.visible(field('ornament'), g.outer); g.preserved();
  });

  it.each([{ name: 'above', start: 600 }, { name: 'already visible', start: 100 }])('handles a target $name without an unnecessary second scroll', ({ name, start }) => {
    const h = fixture(), g = geometry({ outerTop: start, targetY: 80 }); h.controller.openFor('n', 'ornament');
    if (name === 'above') expect(g.outer.scrollTop).toBeLessThan(start); else expect(g.outer.scrollTop).toBe(start);
    expect(g.outer.scrollLeft).toBe(0); expect(g.inner.scrollTop).toBe(0); g.visible(field('ornament'), g.outer); g.preserved();
  });

  it('reveals horizontal clipping only inside the tools and leaves the visible vertical position alone', () => {
    const h = fixture(), g = geometry({ outerTop: 100, targetY: 80, outerWidth: 180, outerWidthContent: 1000, innerWidth: 1000, targetX: 600 });
    h.controller.openFor('n', 'ornament');
    expect(g.outer.scrollTop).toBe(100); expect(g.outer.scrollLeft).toBeGreaterThan(0); expect(g.inner.scrollLeft).toBe(0);
    g.visible(field('ornament'), g.outer); g.preserved();
  });

  it.each([180, 50])('reveals the actual control when its label is taller than the %s px scrollport', height => {
    const h = fixture(), g = geometry({ outerHeight: 1300, outerContent: 1300, outerTop: 0, innerHeight: height, innerContent: 1100, labelHeight: 340 });
    h.controller.openFor('n', 'ornament');
    expect(document.activeElement).toBe(field('ornament')); g.visible(field('ornament'), g.inner);
    expect(g.outer.scrollTop).toBe(0); g.preserved();
  });

  it('clamps the tools offset at its content boundary instead of continuing into page scrolling', () => {
    const h = fixture(), g = geometry({ outerHeight: 160, outerContent: 800, targetY: 708 }); h.controller.openFor('n', 'ornament');
    expect(g.outer.scrollTop).toBe(640); g.visible(field('ornament'), g.outer); g.preserved();
  });

  it.each(['redirected', 'hidden', 'disabled'] as const)('does not scroll when focus is %s before revealing', reason => {
    const h = fixture(), g = geometry({ innerHeight: 120, innerContent: 1100 });
    const target = field('ornament');
    target.addEventListener('focus', () => {
      if (reason === 'redirected') el('score-editor').focus();
      else if (reason === 'hidden') el('selection-inspector').hidden = true;
      else target.disabled = true;
    }, { once: true });
    const before = h.controller.snapshot(); h.controller.openFor('n', 'ornament');
    expect(g.outer.scrollTop).toBe(31); expect(g.inner.scrollTop).toBe(0); g.preserved();
    expect(h.controller.snapshot().values).toEqual(before.values); expect(h.editor.canUndo).toBe(false);
  });

  it('keeps the original tools boundary when a focus listener moves the field into another pane', () => {
    const h = fixture(), g = geometry({ innerHeight: 120, innerContent: 1100 });
    const foreignTools = document.createElement('div'), foreignPanel = document.createElement('section');
    foreignTools.className = 'workspace-tools'; foreignPanel.className = 'tool-panel'; foreignTools.append(foreignPanel); document.body.append(foreignTools);
    metrics(foreignTools, 140, 1000); metrics(foreignPanel, 100, 900);
    const bounds = vi.spyOn(foreignPanel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 100));
    cleanups.push(() => bounds.mockRestore());
    const target = field('ornament');
    target.addEventListener('focus', () => { foreignPanel.append(target); target.focus(); }, { once: true });
    h.controller.openFor('n', 'ornament');
    expect(g.outer.scrollTop).toBe(31); expect(g.inner.scrollTop).toBe(0);
    expect(foreignTools.scrollTop).toBe(0); expect(foreignPanel.scrollTop).toBe(0); g.preserved();
  });

  it('does not reveal on a passive refresh or while restoring a held pane during entry', () => {
    const h = fixture(), g = geometry(); const before = h.controller.snapshot().values;
    h.controller.refresh(); h.context.entryMode = true; h.controller.refresh(); h.controller.openFor('n', 'ornament');
    expect(g.outer.scrollTop).toBe(31); expect(g.inner.scrollTop).toBe(0); expect(document.activeElement).toBe(el('score-editor'));
    expect(h.controller.snapshot().values).toEqual(before); expect(h.editor.canUndo).toBe(false); g.preserved();
  });
});

const pitchedSource = `<music-staff id="staff" label="Flute"><music-measure id="m1" number="1"><music-note id="n1" pitch="C4" duration="whole"><music-articulation id="scalar-mark" type="accent"></music-articulation></music-note></music-measure><music-measure id="m2" number="2"><music-note id="n2" pitch="D4" duration="whole"></music-note></music-measure></music-staff>`;
function change(id: string, value: string): void {
  const input = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id); input.value = value;
  input.dispatchEvent(new Event(input.localName === 'select' ? 'change' : 'input', { bubbles: true }));
}
function propertyFixture() {
  mountAuthorFixture(); el('workspace-tools').hidden = false; el('selection-inspector').hidden = false;
  el<HTMLDetailsElement>('event-details').open = true;
  const editor = new EditorSession(createProject(pitchedSource, 'Property focus')); editor.select('n1');
  const context: InspectorContext = { mode: 'write', partId: 'score', cursor: { staffId: 'staff', measureId: 'm1', voiceIndex: 0, eventId: 'n1' },
    selectionId: 'n1', rangeEventIds: ['n1'], inspectionSelectionId: 'n1', entryMode: false };
  const forms = new InspectorForms({ session: editor, context: () => context, select: id => editor.select(id) });
  const marks = new EventMarkingsEditor({ session: editor, context: () => context, select: id => editor.select(id) });
  const refresh = () => { forms.refresh(); marks.refresh(); }; editor.addEventListener('change', refresh);
  cleanups.push(() => { editor.removeEventListener('change', refresh); forms.dispose(); marks.dispose(); });
  return { editor, forms, marks };
}
function instructionFixture(annotations = '', selected = 'n1') {
  mountAuthorFixture(); el('workspace-tools').hidden = false; el('selection-inspector').hidden = true; el('annotation-inspector').hidden = false;
  const html = selected === 'h1' ? pitchedSource.replace('</music-note></music-measure>', `</music-note>${annotations}</music-measure>`)
    : pitchedSource.replace('</music-staff>', '').replace(/<\/music-measure>$/, `${annotations}</music-measure></music-staff>`);
  const editor = new EditorSession(createProject(html, 'Instruction focus')); editor.select(selected);
  const context = (): MarkingsContext => {
    const staff = editor.score.staves[0], measure = staff.measures.find(item => item.id === editor.cursor?.measureId) ?? staff.measures[0];
    return { mode: 'write', staff, measure, voiceIndex: 0, event: measure.voices[0].events.find(item => item.id === editor.selectionId),
      annotation: measure.annotations.find(item => item.id === editor.selectionId) };
  };
  const select = vi.fn((id: string) => editor.select(id)), openTools = vi.fn();
  const markings = new MarkingsEditor({ session: editor, context, select, openTools });
  const refresh = () => markings.refresh(); editor.addEventListener('change', refresh);
  cleanups.push(() => { editor.removeEventListener('change', refresh); markings.dispose(); });
  return { editor, markings, context, select, openTools };
}

describe('property and instruction task focus in the outer tools pane', () => {
  it('reveals the editable property after Discard without losing an independent attached-mark draft', () => {
    const h = propertyFixture(); change('selected-pitch', 'C#4'); change(field('scalar-mark').id, 'staccato');
    const before = accepted(h.editor), g = geometry({ outerTop: 600, targetY: 80 });
    el('load-event-values').click();
    expect(document.activeElement).toBe(el('selected-kind')); expect(g.outer.scrollTop).toBeLessThan(600); g.visible(el('selected-kind'), g.outer);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('C4'); expect(h.forms.snapshot('selected').dirty).toBe(false);
    expect(h.marks.hasDirty).toBe(true); expect(field('scalar-mark').value).toBe('staccato'); expect(accepted(h.editor)).toEqual(before); g.preserved();
  });

  it('reveals the now-enabled property Apply after Review while retaining the raw pitch and current source', () => {
    const h = propertyFixture(); change('selected-pitch', 'C#4');
    h.editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'D4', ties: 'reject' });
    const before = accepted(h.editor), g = geometry(); el('review-selected-draft').focus(); el('review-selected-draft').click();
    expect(document.activeElement).toBe(el('update-event')); expect(g.outer.scrollTop).toBeGreaterThan(31); g.visible(el('update-event'), g.outer);
    expect(el<HTMLInputElement>('selected-pitch').value).toBe('C#4'); expect(h.forms.snapshot('selected')).toMatchObject({ dirty: true, status: 'dirty', targetId: 'n1' });
    expect(accepted(h.editor)).toEqual(before); g.preserved();
    el('score-editor').focus(); g.outer.scrollTop = 31; h.forms.refresh(); expect(g.outer.scrollTop).toBe(31); expect(document.activeElement).toBe(el('score-editor'));
  });

  it('reveals the property caption after Discard when Event details was deliberately closed', () => {
    const h = propertyFixture(); change('selected-pitch', 'C#4'); el<HTMLDetailsElement>('event-details').open = false;
    const before = accepted(h.editor), g = geometry({ outerTop: 600, targetY: 80 }); el('load-event-values').click();
    expect(document.activeElement).toBe(el('event-form-context')); expect(g.outer.scrollTop).toBeLessThan(600); g.visible(el('event-form-context'), g.outer);
    expect(el<HTMLDetailsElement>('event-details').open).toBe(false); expect(accepted(h.editor)).toEqual(before); g.preserved();
  });

  it('reveals the next instruction text after exactly one Add & next transaction and preserves its recipe', () => {
    const h = instructionFixture(); change('annotation-text', 'Dm9'); change('annotation-scope', 'all');
    const before = h.editor.project.sourceHtml, g = geometry({ panelId: 'annotation-inspector' }); el('add-annotation-next').click();
    expect(document.activeElement).toBe(el('annotation-text')); expect(g.outer.scrollTop).toBeGreaterThan(31); g.visible(el('annotation-text'), g.outer);
    expect(h.editor.revision).toBe(1); expect(h.context().measure.id).toBe('m2'); expect(h.openTools).not.toHaveBeenCalled();
    const added = h.editor.score.staves[0].measures[0].annotations[0]; expect(added.text).toBe('Dm9'); expect(h.editor.project.instructionScopes[added.id]).toBe('all');
    expect(el<HTMLTextAreaElement>('annotation-text').value).toBe(''); expect(el<HTMLSelectElement>('annotation-kind').value).toBe('harmony');
    expect(el<HTMLSelectElement>('annotation-scope').value).toBe('all'); expect(el<HTMLInputElement>('annotation-at').value).toBe('0'); g.preserved();
    h.editor.undo(); expect(h.editor.project.sourceHtml).toBe(before); expect(h.editor.canUndo).toBe(false);
  });

  it('reveals a next-bar collision chooser without changing the existing instruction', () => {
    const h = instructionFixture('<music-harmony id="h2" text="G13" at="0" data-keep="collision"></music-harmony>');
    const existing = h.editor.source.querySelector('#h2')!, original = existing.outerHTML;
    change('annotation-text', 'Dm9'); change('annotation-scope', 'all');
    const g = geometry({ panelId: 'annotation-inspector' }); el('add-annotation-next').click();
    expect(document.activeElement).toBe(el('annotation-select')); expect(g.outer.scrollTop).toBeGreaterThan(31); g.visible(el('annotation-select'), g.outer);
    expect(h.context().measure.id).toBe('m2'); expect(h.editor.revision).toBe(1); expect(h.editor.source.querySelector('#h2')).toBe(existing); expect(existing.outerHTML).toBe(original);
    expect(el('annotation-inspector').dataset.annotationState).toBe('choose'); expect(el<HTMLButtonElement>('add-annotation-next').disabled).toBe(true); g.preserved();
  });

  it('reveals instruction Apply after Review without applying or losing the conflicting text', () => {
    const h = instructionFixture('<music-harmony id="h1" text="Cmaj9" at="0"></music-harmony>', 'h1');
    change('annotation-text', 'Cmaj13');
    h.editor.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'C6/9', at: '0', placement: 'above' } });
    const before = accepted(h.editor), g = geometry({ panelId: 'annotation-inspector' }); el('review-annotation-draft').focus(); el('review-annotation-draft').click();
    expect(document.activeElement).toBe(el('update-annotation')); expect(g.outer.scrollTop).toBeGreaterThan(31); g.visible(el('update-annotation'), g.outer);
    expect(el<HTMLTextAreaElement>('annotation-text').value).toBe('Cmaj13'); expect(h.markings.hasDirty).toBe(true); expect(accepted(h.editor)).toEqual(before); g.preserved();
    el('score-editor').focus(); g.outer.scrollTop = 31; h.markings.refresh(); expect(g.outer.scrollTop).toBe(31); expect(document.activeElement).toBe(el('score-editor'));
  });
});
