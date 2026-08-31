import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountAuthorFixture } from './author-fixture.js';
import { EditorSession } from '../src/authoring/editor.js';
import { InspectorForms } from '../src/authoring/inspector-forms.js';
import type { InspectorContext } from '../src/authoring/inspector-forms.js';
import { MarkingsEditor } from '../src/authoring/markings-editor.js';
import { createProject } from '../src/authoring/project.js';

const cleanups: (() => void)[] = [];
const music = `<music-system id="score">
  <music-staff id="upper" label="Flute"><music-measure id="bar" incomplete>
    <music-tuplet id="trip" actual="3" normal="2"><music-note id="n1" pitch="C4" duration="quarter"></music-note><music-note id="n2" pitch="D4" duration="quarter"></music-note></music-tuplet>
    <music-harmony id="h1" text="Cmaj7"></music-harmony><music-harmony id="h2" text="G7" at="1/2"></music-harmony>
  </music-measure></music-staff>
  <music-staff id="lower" label="Bass" clef="bass"><music-measure id="bass-bar" incomplete><music-note id="bass" pitch="C3" duration="quarter"></music-note></music-measure></music-staff>
</music-system>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function checks(id: string): HTMLInputElement[] { return [...element(id).querySelectorAll<HTMLInputElement>('input')]; }
function choose(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function session(): EditorSession {
  mountAuthorFixture();
  const project = createProject(music, 'Collection rendering', [
    { id: 'flute', label: 'Lead', staffIds: ['upper'] },
    { id: 'bass', label: 'Lead', staffIds: ['lower'] },
  ]);
  project.instructionScopes.h1 = ['flute'];
  return new EditorSession(project);
}

function inspectors() {
  const editor = session();
  const context: InspectorContext = {
    mode: 'write', partId: 'flute', cursor: { staffId: 'upper', measureId: 'bar', voiceIndex: 0 }, selectionId: 'trip',
  };
  const forms = new InspectorForms({ session: editor, context: () => context, select: vi.fn() });
  const refresh = () => forms.refresh();
  editor.addEventListener('change', refresh);
  cleanups.push(() => { editor.removeEventListener('change', refresh); forms.dispose(); });
  return { editor, forms, context };
}

function markings() {
  const editor = session();
  editor.select('h1');
  const forms = new MarkingsEditor({
    session: editor,
    context: () => {
      const staff = editor.score.staves[0];
      const measure = staff.measures[0];
      return { mode: 'write', staff, measure, voiceIndex: 0, annotation: measure.annotations.find(item => item.id === editor.selectionId) };
    },
    select: id => editor.select(id), openTools: vi.fn(),
  });
  const refresh = () => forms.refresh();
  editor.addEventListener('change', refresh);
  cleanups.push(() => { editor.removeEventListener('change', refresh); forms.dispose(); });
  return { editor, forms };
}

afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
});

describe('form collection integration', () => {
  it('retains tuplet options and native selectedcontent while their accepted descriptions change', () => {
    const { editor } = inspectors();
    const select = element<HTMLSelectElement>('tuplet-select');
    const option = [...select.options].find(item => item.value === 'trip')!;
    const button = select.firstElementChild;
    const selectedcontent = button?.querySelector('selectedcontent');
    select.focus();
    const focus = vi.spyOn(select, 'focus');

    editor.execute({ type: 'set-tuplet', tupletId: 'trip', actual: 5, normal: 4, bracket: 'auto', ratio: true });

    expect([...select.options].find(item => item.value === 'trip')).toBe(option);
    expect(option.textContent).toBe('5:4 · 2 events');
    expect(select.value).toBe('trip');
    expect(select.firstElementChild).toBe(button);
    expect(select.querySelector('selectedcontent')).toBe(selectedcontent);
    expect(document.activeElement).toBe(select);
    expect(focus).not.toHaveBeenCalled();
  });

  it('retains checked staff drafts, their native labels, and focus when staff names change', () => {
    const { editor, forms } = inspectors();
    const original = checks('part-staves');
    const bass = original.find(input => input.value === 'lower')!;
    choose(bass, true);
    bass.focus();
    const focus = vi.spyOn(bass, 'focus');

    editor.execute({ type: 'set-staff', staffId: 'lower', label: 'Double bass', clef: 'bass', key: 'C' });

    expect(checks('part-staves')).toEqual(original);
    expect(bass.checked).toBe(true);
    expect(bass.labels).toHaveLength(1);
    expect(bass.labels?.[0].control).toBe(bass);
    expect(bass.labels?.[0].textContent).toBe('Double bass');
    expect(document.activeElement).toBe(bass);
    expect(focus).not.toHaveBeenCalled();
    expect(forms.snapshot('part').dirty).toBe(true);
    expect(forms.resolve('part').values.staffIds).toEqual(['upper', 'lower']);
    expect(editor.project.parts.find(part => part.id === 'flute')?.staffIds).toEqual(['upper']);
  });

  it('retains instruction options and their native selection when accepted text changes', () => {
    const { editor } = markings();
    const select = element<HTMLSelectElement>('annotation-select');
    const options = [...select.options];
    const button = select.firstElementChild;
    const selectedcontent = button?.querySelector('selectedcontent');
    select.focus();

    editor.execute({ type: 'update-annotation', annotationId: 'h1', value: { kind: 'harmony', text: 'Cmaj9', at: '0', placement: 'above' } });

    expect([...select.options]).toEqual(options);
    expect(select.selectedOptions[0].textContent).toContain('Cmaj9');
    expect(select.value).toBe('h1');
    expect(select.firstElementChild).toBe(button);
    expect(select.querySelector('selectedcontent')).toBe(selectedcontent);
    expect(document.activeElement).toBe(select);
  });

  it('keeps recipient draft properties and unambiguous labels through reorder and removal', () => {
    const { editor, forms } = markings();
    const original = checks('annotation-part-scopes');
    const flute = original.find(input => input.value === 'flute')!;
    const bass = original.find(input => input.value === 'bass')!;
    expect(flute.labels?.[0].textContent).toBe('Lead (flute)');
    expect(bass.labels?.[0].textContent).toBe('Lead (bass)');
    expect(flute.labels?.[0].control).toBe(flute);
    expect(bass.labels?.[0].control).toBe(bass);
    choose(bass, true);
    bass.focus();

    editor.update('Rename and reorder parts', project => {
      project.parts.reverse();
      project.parts.find(part => part.id === 'bass')!.label = 'Lower voice';
    });
    expect(checks('annotation-part-scopes')).toEqual([...original].reverse());
    expect(bass.labels?.[0].textContent).toBe('Lower voice');
    expect(bass.checked).toBe(true);
    expect(flute.checked).toBe(true);
    expect(document.activeElement).toBe(bass);

    editor.update('Remove selected recipient', project => {
      project.parts = project.parts.filter(part => part.id !== 'bass');
      delete project.layouts.bass;
    });
    expect(checks('annotation-part-scopes').find(input => input.value === 'bass')).toBe(bass);
    expect(bass.labels?.[0].textContent).toBe('Missing part (bass)');
    expect(bass.dataset.missingPart).toBe('true');
    expect(bass.checked).toBe(true);
    expect(document.activeElement).toBe(bass);
    expect(forms.hasDirty).toBe(true);
    expect(editor.project.instructionScopes.h1).toEqual(['flute']);
  });
});
