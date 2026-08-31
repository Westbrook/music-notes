// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand } from '../src/authoring/commands.js';
import { EditorSession } from '../src/authoring/editor.js';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject, parseSource } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { readScore } from '../src/dom/index.js';
import type { Clef } from '../src/model/types.js';


function source(firstBarKey?: string): string {
  return `<music-system id="score" key="F"><music-staff id="original" label="Flute" clef="treble" key="G" data-preserve="yes">
    <music-measure id="first" number="12A"${firstBarKey ? ` key="${firstBarKey}"` : ''}><!-- keep the original spelling --><music-note id="theme" pitch="Fqs4" duration="whole"></music-note></music-measure>
    <music-measure id="second" number="12B"><music-rest id="original-rest-2" measure></music-rest></music-measure>
    <music-measure id="third" number="13" key="Bb"><music-rest id="original-rest-3" measure></music-rest></music-measure>
    <music-measure id="fourth" number="14"><music-rest id="original-rest-4" measure></music-rest></music-measure>
  </music-staff></music-system>`;
}

describe('STAFF-INITIAL-KEY command', () => {
  it.each([['Eb', 'Eb'], [' e♭ major ', 'Eb'], ['c minor', 'Cm'], ['F#m', 'F#m']])('uses requested pitched key %j without changing existing music', (requested, canonical) => {
    const root = parseSource(source());
    const original = root.querySelector('#original')!;
    const accepted = original.outerHTML;
    const before = readScore(root).score.staves[0];
    const result = applyCommand(root, { type: 'add-staff', label: 'Cello', clef: 'bass', key: requested });
    const parsed = readScore(root);
    const added = parsed.score.staves[1];
    expect(added).toMatchObject({ id: result.selectionId, label: 'Cello', clef: 'bass', key: canonical });
    expect(added.measures.map(measure => measure.key)).toEqual([canonical, canonical, 'Bb', 'Bb']);
    expect(added.measures.every(measure => measure.clef === 'bass')).toBe(true);
    expect(added.measures.every(measure => measure.voices[0].events.every(event => event.kind === 'rest' && event.measureRest))).toBe(true);
    expect(added.measures.map(measure => measure.number)).toEqual(['12A', '12B', '13', '14']);
    expect(root.querySelector('#original')).toBe(original);
    expect(original.outerHTML).toBe(accepted);
    expect(parsed.score.staves[0]).toEqual(before);
    expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  });

  it('lets an explicit initial key govern the first bar even when the reference has a first-bar override', () => {
    const root = parseSource(source('D'));
    applyCommand(root, { type: 'add-staff', label: 'Horn at written pitch', clef: 'treble', key: 'Eb' });
    const score = readScore(root).score;
    expect(score.staves[0].key).toBe('G');
    expect(score.staves[0].measures.map(measure => measure.key)).toEqual(['D', 'D', 'Bb', 'Bb']);
    expect(score.staves[1].key).toBe('Eb');
    expect(score.staves[1].measures.map(measure => measure.key)).toEqual(['Eb', 'Eb', 'Bb', 'Bb']);
    const added = root.lastElementChild!;
    expect(added.children[0].hasAttribute('key')).toBe(false);
    expect(added.children[1].hasAttribute('key')).toBe(false);
    expect(added.children[2].getAttribute('key')).toBe('Bb');
    expect(root.querySelector('#theme')!.getAttribute('pitch')).toBe('Fqs4');
  });

  it('honors an explicit key equal to the staff default instead of reapplying a first-bar override', () => {
    const root = parseSource(source('D'));
    applyCommand(root, { type: 'add-staff', label: 'Second flute', clef: 'treble', key: 'G' });
    expect(readScore(root).score.staves[1].measures.map(measure => measure.key)).toEqual(['G', 'G', 'Bb', 'Bb']);
  });

  it('preserves the previous reference inheritance behavior when key is omitted', () => {
    const root = parseSource(source('D'));
    applyCommand(root, { type: 'add-staff', label: 'Bass', clef: 'bass' });
    const added = readScore(root).score.staves[1];
    expect(added.key).toBe('G');
    expect(added.measures.map(measure => measure.key)).toEqual(['D', 'D', 'Bb', 'Bb']);
    expect(root.lastElementChild!.children[0].getAttribute('key')).toBe('D');
  });

  it.each(['', 'H', 'C#minor-not-a-key'])('rejects invalid explicit key %j before creating any notation node', key => {
    const root = parseSource(source());
    const before = root.outerHTML;
    const create = vi.spyOn(root.ownerDocument, 'createElement');
    expect(() => applyCommand(root, { type: 'add-staff', label: 'Must not be created', clef: 'bass', key })).toThrow(/key/i);
    expect(create).not.toHaveBeenCalled();
    expect(root.outerHTML).toBe(before);
    create.mockRestore();
  });

  it.each(['rhythm', 'three-roads'] as const)('ignores hidden invalid key and clef for a %s staff and emits neither', notation => {
    const root = parseSource(source('D'));
    const original = root.querySelector('#original')!.outerHTML;
    applyCommand(root, { type: 'add-staff', label: 'No pitch context', notation, clef: 'hidden-invalid-clef' as Clef, key: 'hidden-invalid-key' });
    const added = root.lastElementChild!;
    expect(added.getAttribute('notation')).toBe(notation);
    expect(added.hasAttribute('key')).toBe(false);
    expect(added.hasAttribute('clef')).toBe(false);
    expect(added.querySelectorAll('[key], [clef]')).toHaveLength(0);
    expect(root.querySelector('#original')!.outerHTML).toBe(original);
    expect(readScore(root).diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  });

  it('adds the requested key with one history step, retaining original IDs through Undo and Redo', () => {
    const session = new EditorSession(createProject(source('D'), 'Initial-key history'));
    session.select('theme');
    const before = session.project;
    const original = session.source.querySelector('#original');
    const result = session.execute({ type: 'add-staff', label: 'Cello', clef: 'bass', key: 'Eb' });
    expect(session.revision).toBe(1);
    expect(session.score.staves[1].key).toBe('Eb');
    expect(session.source.querySelector('#original')).toBe(original);
    const accepted = session.project;
    session.undo();
    expect(session.project.sourceHtml).toBe(before.sourceHtml);
    expect(session.score.staves).toHaveLength(1);
    expect(session.selectionId).toBe('theme');
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
    session.redo();
    expect(session.project.sourceHtml).toBe(accepted.sourceHtml);
    expect(session.score.staves[1].id).toBe(result.selectionId);
    expect(session.score.staves[1].measures.map(measure => measure.key)).toEqual(['Eb', 'Eb', 'Bb', 'Bb']);
    expect(session.source.querySelector('#original')).toBe(original);
  });

  it('rejects an invalid key atomically without consuming Redo or promoting an accepted standalone staff', () => {
    const standalone = source().replace('<music-system id="score" key="F">', '').replace('</music-system>', '');
    const session = new EditorSession(createProject(standalone, 'Failed staff'));
    session.select('theme');
    session.execute({ type: 'set-note-pitch', eventId: 'theme', pitch: 'G4', ties: 'reject' });
    session.undo();
    const before = session.project;
    const root = session.source;
    const revision = session.revision;
    expect(() => session.execute({ type: 'add-staff', label: 'Rejected', clef: 'bass', key: 'H' })).toThrow(/key/i);
    expect(session.project).toEqual(before);
    expect(session.source).toBe(root);
    expect(session.source.localName).toBe('music-staff');
    expect(session.revision).toBe(revision);
    expect(session.selectionId).toBe('theme');
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
  });
});

let workspace: AuthorWorkspace | undefined;
let sequence = 0;
function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The real Author shell is missing #${id}.`);
  return element as T;
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
async function click(id: string): Promise<void> { control<HTMLButtonElement>(id).click(); await flush(); }
async function field(id: string, value: string): Promise<void> {
  const element = control<HTMLInputElement | HTMLSelectElement>(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

describe('STAFF-INITIAL-KEY actual Author shell', () => {
  beforeEach(() => {
    for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
    mountAuthorFixture();
    // Real shell, application listeners, forms, commands, and history. This
    // intentionally stubs rendering and makes no engraving/geometry claim.
    vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
    const values = new Map<string, string>();
    const recovery = new RecoveryStore({ key: `staff-creation-${++sequence}`, writerId: 'test',
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
      locks: { request: async (_name, action) => action() },
    });
    workspace = new AuthorWorkspace({ project: createProject(source('D'), 'Visible initial key'), recovery });
  });

  afterEach(async () => {
    workspace?.dispose(); workspace = undefined;
    await flush(); vi.restoreAllMocks(); document.body.replaceChildren();
  });

  it('uses the visible Initial key for Add new staff and restores it with one Undo and Redo', async () => {
    const app = workspace!;
    const original = app.session.source.querySelector('#original')!;
    const before = original.outerHTML;
    await click('document-menu-trigger'); await click('score-setup-trigger');
    expect(control<HTMLInputElement>('staff-key').disabled).toBe(false);
    expect(control('staff-key').closest('label')!.hidden).toBe(false);
    await field('staff-label', 'Cello'); await field('staff-clef', 'bass'); await field('staff-key', 'Eb');
    expect(app.session.revision).toBe(0);
    await click('add-staff');
    expect(app.session.score.staves).toHaveLength(2);
    expect(app.session.score.staves[1]).toMatchObject({ label: 'Cello', key: 'Eb', clef: 'bass' });
    expect(app.session.score.staves[1].measures.map(measure => measure.key)).toEqual(['Eb', 'Eb', 'Bb', 'Bb']);
    expect(original.outerHTML).toBe(before);
    expect(app.session.revision).toBe(1);
    expect(control<HTMLInputElement>('staff-key').value).toBe('Eb');
    const accepted = app.session.project.sourceHtml;
    await click('undo');
    expect(app.session.score.staves).toHaveLength(1);
    expect(app.session.canUndo).toBe(false);
    expect(app.session.source.querySelector('#original')!.outerHTML).toBe(before);
    await click('redo');
    expect(app.session.project.sourceHtml).toBe(accepted);
    expect(app.session.score.staves[1].key).toBe('Eb');
  });

  it('keeps an invalid typed key and local error without adding a staff or history', async () => {
    const app = workspace!;
    const before = app.session.project;
    await click('document-menu-trigger'); await click('score-setup-trigger');
    await field('staff-label', 'Waiting cello'); await field('staff-key', 'H major');
    await click('add-staff');
    expect(app.session.project).toEqual(before);
    expect(app.session.revision).toBe(0);
    expect(app.session.canUndo).toBe(false);
    expect(control<HTMLInputElement>('staff-key').value).toBe('H major');
    expect(control<HTMLInputElement>('staff-label').value).toBe('Waiting cello');
    expect(control('staff-draft-status').textContent).toMatch(/key/i);
    expect(control('staff-inspector').dataset.draftState).toBe('dirty');
  });

  it.each(['rhythm', 'three-roads'] as const)('ignores hidden invalid pitch context when Add creates a %s staff', async notation => {
    const app = workspace!;
    const original = app.session.source.querySelector('#original')!.outerHTML;
    await click('document-menu-trigger'); await click('score-setup-trigger');
    await field('staff-label', 'Pitchless part'); await field('staff-key', 'H major');
    await field('staff-clef', 'not-a-clef'); await field('staff-notation', notation);
    expect(control<HTMLInputElement>('staff-key').disabled).toBe(true);
    expect(control('staff-key').closest('label')!.hidden).toBe(true);
    await click('add-staff');
    expect(app.session.score.staves).toHaveLength(2);
    const added = app.session.source.lastElementChild!;
    expect(added.getAttribute('notation')).toBe(notation);
    expect(added.hasAttribute('key')).toBe(false);
    expect(added.hasAttribute('clef')).toBe(false);
    expect(added.querySelectorAll('[key], [clef]')).toHaveLength(0);
    expect(app.session.source.querySelector('#original')!.outerHTML).toBe(original);
    expect(app.session.revision).toBe(1);
    expect(app.session.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  });
});
