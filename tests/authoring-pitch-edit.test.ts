// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import { readScore } from '../src/dom/index';

const source = `<music-system id="score"><music-staff id="staff" key="G">
  <music-measure id="bar"><!-- keep this instruction -->
    <music-note id="n1" pitch="F4" accidental="sharp" duration="half" accidental-display="courtesy" data-author="kept"></music-note>
    <music-direction id="direction" text="Listen"></music-direction>
    <music-note id="n2" pitch="G4" duration="half"></music-note>
  </music-measure>
</music-staff></music-system>`;

function session(html = source): EditorSession {
  const editor = new EditorSession(createProject(html, 'Pointer pitch test'));
  editor.select('n1');
  return editor;
}

/** Native reconciliation can restore an attribute in a different list position. */
function sourceData(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const attributes = [...element.attributes].map(attribute => [attribute.name, attribute.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
  return template.innerHTML;
}

describe('pitch-only edit transactions', () => {
  it('commits a pitch edit as one undo step and restores source data and stable DOM identities', () => {
    const editor = session();
    const before = editor.project.sourceHtml;
    const note = editor.source.querySelector('#n1');
    const beforeEvent = editor.score.staves[0].measures[0].voices[0].events[0];
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'G#4', ties: 'reject' });
    const after = editor.project.sourceHtml;
    expect(editor.revision).toBe(1);
    expect(editor.selectionId).toBe('n1');
    expect(editor.source.querySelector('#n1')).toBe(note);
    expect(note?.getAttribute('pitch')).toBe('G#4');
    expect(note?.hasAttribute('accidental')).toBe(false);
    expect(editor.score.staves[0].measures[0].voices[0].events[0].time).toEqual(beforeEvent.time);
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(note?.getAttribute('accidental')).toBe('sharp');
    expect(editor.source.querySelector('#n1')).toBe(note);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(editor.project.sourceHtml).toBe(after);
    expect(editor.source.querySelector('#n1')).toBe(note);
  });

  it('keeps any number of detached previews out of the accepted source and undo history', () => {
    const editor = session();
    const before = editor.project.sourceHtml;
    for (const pitch of ['G#4', 'A#4', 'B#4', 'C#5']) {
      const staged = editor.source.cloneNode(true) as Element;
      applyCommand(staged, { type: 'set-note-pitch', eventId: 'n1', pitch, ties: 'reject' });
      expect(readScore(staged).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
      expect(editor.project.sourceHtml).toBe(before);
      expect(editor.canUndo).toBe(false);
      expect(editor.revision).toBe(0);
    }
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'C#5', ties: 'reject' });
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
  });

  it('does not canonicalize an unchanged pitch or add history, including after undo', () => {
    const editor = session();
    const before = editor.project.sourceHtml;
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'f♯4', ties: 'reject' });
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.canUndo).toBe(false);
    expect(editor.revision).toBe(0);
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'G#4', ties: 'reject' });
    editor.undo();
    const undone = editor.project.sourceHtml;
    const revision = editor.revision;
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'F#4', ties: 'reject' });
    expect(editor.project.sourceHtml).toBe(undone);
    expect(sourceData(undone)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(editor.revision).toBe(revision);
  });

  it('preserves source, selection, revision, and redo history after invalid requests', () => {
    const editor = session();
    editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'G#4', ties: 'reject' });
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    const node = editor.source.querySelector('#n1');
    expect(() => editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'H4', ties: 'reject' })).toThrow();
    expect(() => editor.execute({ type: 'set-note-pitch', eventId: 'missing', pitch: 'D4', ties: 'reject' })).toThrow();
    expect(editor.project).toEqual(before);
    expect(editor.source.querySelector('#n1')).toBe(node);
    expect(editor.selectionId).toBe('n1');
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
  });

  it('rejects a tied pitch change without altering any event or history', () => {
    const html = `<music-staff id="staff"><music-measure id="bar"><music-note id="n1" pitch="C4" duration="half" tie="start"></music-note><music-note id="n2" pitch="C4" duration="half" tie="end"></music-note></music-measure></music-staff>`;
    const editor = session(html);
    const before = editor.project;
    expect(() => editor.execute({ type: 'set-note-pitch', eventId: 'n1', pitch: 'D4', ties: 'reject' })).toThrow('tied note');
    expect(editor.project).toEqual(before);
    expect(editor.selectionId).toBe('n1');
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });
});
