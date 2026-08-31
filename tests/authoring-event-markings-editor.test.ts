// @vitest-environment happy-dom
import { mountAuthorFixture } from './author-fixture.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import { EventMarkingsEditor } from '../src/authoring/event-markings-editor.js';
import type { EventMarkingsContext } from '../src/authoring/event-markings-editor.js';
import { createProject } from '../src/authoring/project.js';
import type { EventMarkingField, ViewMode } from '../src/authoring/types.js';

const accent = '<music-articulation id="accent" type="accent" data-keep="accent"></music-articulation>';
const ornament = '<music-ornament id="ornament" type="trill" data-keep="ornament"></music-ornament>';
const third = '<music-interval id="third" value="b3" placement="below" data-keep="interval"></music-interval>';
const road = (children = `${accent}${ornament}${third}`) => `<music-staff id="staff" notation="three-roads" label="Roads"><music-measure id="bar" number="1"><music-road id="n" direction="higher" duration="half">${children}</music-road><music-road id="other" direction="lower" duration="half"><music-articulation id="other-mark" type="tenuto"></music-articulation></music-road></music-measure></music-staff>`;
const chain = `<music-staff id="staff" notation="three-roads" label="Roads"><music-measure id="bar" number="1"><music-road id="n" direction="higher" duration="whole" tie="start">${accent}${ornament}${third}</music-road></music-measure><music-measure id="bar-two" number="2"><music-road id="continuation" direction="same" duration="whole" tie="end"><music-articulation id="release" type="fermata" data-keep="release"></music-articulation><music-interval id="continued-third" value="♭3" placement="below" data-keep="continuation"></music-interval></music-road></music-measure></music-staff>`;
const cleanups: (() => void)[] = [];
type FixtureControlRoot = Document | HTMLElement | ShadowRoot;

function el<T extends HTMLElement = HTMLElement>(id: string, root: FixtureControlRoot = document): T {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`Missing actual Author element ${id}`);
  return element as T;
}
function row(id: string, root: FixtureControlRoot = document): HTMLElement {
  const result = [...el('event-markings-rows', root).querySelectorAll<HTMLElement>('[data-marking-row]')]
    .find(element => element.dataset.markingId === id || element.dataset.markingRow === id);
  if (!result) throw new Error(`Missing marking row ${id}`);
  return result;
}
function field(id: string, name: EventMarkingField, root: FixtureControlRoot = document): HTMLInputElement | HTMLSelectElement {
  const result = row(id, root).querySelector<HTMLInputElement | HTMLSelectElement>(`[data-marking-field="${name}"]`);
  if (!result) throw new Error(`Missing ${name} field for ${id}`);
  return result;
}
function change(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function click(id: string, root: FixtureControlRoot = document): void { el(id, root).dispatchEvent(new Event('click', { bubbles: true })); }
function remove(id: string): void { row(id).querySelector<HTMLButtonElement>('[data-remove-marking]')!.click(); }
function state(editor: EditorSession) {
  return { project: editor.project, revision: editor.revision, selection: editor.selectionId, cursor: editor.cursor,
    undo: editor.canUndo, redo: editor.canRedo };
}
function fixture(source = road(), selection = 'n', root?: HTMLElement, controls: FixtureControlRoot = root ?? document) {
  mountAuthorFixture(root);
  el('workspace-tools', controls).hidden = false;
  const editor = new EditorSession(createProject(source, 'Attachment draft regression'));
  editor.select(selection);
  const context: EventMarkingsContext = { mode: 'write', selectionId: selection, rangeEventIds: [selection] };
  let syncing = true;
  let controller: EventMarkingsEditor;
  const refresh = () => { if (syncing) controller.refresh(); };
  const select = vi.fn((id: string) => {
    editor.select(id); context.selectionId = editor.selectionId;
    context.rangeEventIds = editor.selectionId ? [editor.selectionId] : []; refresh();
  });
  const openTools = vi.fn(() => { el('workspace-tools', controls).hidden = false; el('selection-inspector', controls).hidden = false; });
  const report = vi.fn();
  controller = new EventMarkingsEditor({ session: editor, context: () => context, select, openTools, report }, controls);
  editor.addEventListener('change', refresh);
  const execute = vi.spyOn(editor, 'execute');
  cleanups.push(() => { editor.removeEventListener('change', refresh); controller.dispose(); execute.mockRestore(); });
  const unseen = (action: () => void) => { syncing = false; try { action(); } finally { syncing = true; } };
  const interval = (value: string) => editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'third',
    value: { kind: 'interval', value, placement: 'below' }, fields: ['value'] });
  return { editor, controller, context, select, openTools, report, execute, unseen, interval };
}

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

describe('isolated attached-markings controls', () => {
  it.each(['nested element', 'shadow root'] as const)('edits and applies inside a %s with duplicate document controls', kind => {
    const global = fixture();
    const globalAccepted = state(global.editor);
    const globalInput = field('third', 'value');
    const globalApply = el<HTMLButtonElement>('apply-event-markings');
    const globalStatus = el('event-markings-draft-status').textContent;
    const host = document.createElement('section');
    document.body.append(host);
    const controls = kind === 'shadow root' ? host.attachShadow({ mode: 'open' }) : host;
    const mount = document.createElement('section');
    controls.append(mount);
    const scoped = fixture(road(), 'n', mount, controls);
    const input = field('third', 'value', controls);
    const apply = el<HTMLButtonElement>('apply-event-markings', controls);

    expect(document.getElementById('apply-event-markings')).toBe(globalApply);
    expect(input).not.toBe(globalInput);
    expect(apply).not.toBe(globalApply);
    change(input, '5');
    expect(scoped.controller.snapshot()).toMatchObject({ status: 'dirty', canApply: true });
    expect(scoped.editor.source.querySelector('#third')?.getAttribute('value')).toBe('b3');
    expect(global.controller.hasDirty).toBe(false);
    expect(globalInput.value).toBe('b3');
    expect(globalApply.disabled).toBe(true);
    expect(el('event-markings-draft-status').textContent).toBe(globalStatus);

    click('apply-event-markings', controls);
    expect(scoped.editor.source.querySelector('#third')?.getAttribute('value')).toBe('5');
    expect(scoped.editor.revision).toBe(1);
    expect(scoped.controller.hasDirty).toBe(false);
    expect(state(global.editor)).toEqual(globalAccepted);
    expect(global.execute).not.toHaveBeenCalled();
    expect(field('third', 'value')).toBe(globalInput);

    const accepted = state(scoped.editor);
    const disposedSnapshot = scoped.controller.snapshot();
    scoped.execute.mockClear();
    scoped.controller.dispose();
    change(input, '#11');
    click('add-event-interval', controls);
    click('apply-event-markings', controls);
    expect(scoped.controller.snapshot()).toEqual(disposedSnapshot);
    expect(state(scoped.editor)).toEqual(accepted);
    expect(scoped.execute).not.toHaveBeenCalled();
    expect(state(global.editor)).toEqual(globalAccepted);
  });
});

describe('automatic placement and inactive legacy fields', () => {
  it.each([
    ['articulation', 'accent', 'tenuto', 'after'],
    ['ornament', 'trill', 'turn', 'after'],
    ['articulation', 'accent', 'tenuto', 'before'],
    ['ornament', 'trill', 'turn', 'before'],
  ] as const)('merges legacy %s placement changed %s-to-%s %s the first type input without Review', (kind, originalType, nextType, when) => {
    const source = road(`<music-${kind} id="legacy" type="${originalType}" placement="above" data-keep="legacy"><!-- keep inside --></music-${kind}>${third}`);
    const h = fixture(source), input = field('legacy', 'type');
    const marking = h.editor.source.querySelector('#legacy');
    expect(row('legacy').querySelector('[data-marking-field="placement"]')).toBeNull();
    const external = () => h.editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'legacy',
      value: kind === 'articulation' ? { kind, type: 'accent', placement: 'below' } : { kind, type: 'trill', placement: 'below' }, fields: ['placement'] });
    if (when === 'after') { change(input, nextType); external(); }
    else { h.unseen(external); change(input, nextType); }
    const accepted = state(h.editor);
    expect(h.controller.snapshot()).toMatchObject({ status: 'dirty', canApply: true, conflicts: [] });
    expect(el('review-event-markings').hidden).toBe(true);
    expect(field('legacy', 'type').value).toBe(nextType);
    click('apply-event-markings');
    expect(h.execute.mock.calls.at(-1)?.[0]).toEqual({ type: 'edit-event-markings', eventId: 'n', edits: [
      { type: 'update', markingId: 'legacy', value: { kind, type: nextType, placement: 'below' }, fields: ['type'] },
    ] });
    expect(h.editor.source.querySelector('#legacy')).toBe(marking);
    expect(marking?.getAttribute('type')).toBe(nextType);
    expect(marking?.getAttribute('placement')).toBe('below');
    expect(marking?.getAttribute('data-keep')).toBe('legacy');
    expect(marking?.innerHTML).toBe('<!-- keep inside -->');
    expect(h.editor.revision).toBe(accepted.revision + 1);
    h.editor.undo();
    expect(marking?.getAttribute('type')).toBe(originalType);
    expect(marking?.getAttribute('placement')).toBe('below');
  });

  it('still conflicts on a real interval direction change', () => {
    const h = fixture(); change(field('third', 'value'), '5');
    h.editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'third',
      value: { kind: 'interval', value: 'b3', placement: 'above' }, fields: ['placement'] });
    const accepted = state(h.editor);
    expect(h.controller.snapshot()).toMatchObject({ status: 'conflict', canApply: false });
    expect(el('event-markings-draft-status').textContent).toMatch(/Accepted[\s\S]*above[\s\S]*Draft[\s\S]*below/);
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
  });

  it('still conflicts on an unseen real articulation type change', () => {
    const h = fixture(), input = field('accent', 'type');
    h.unseen(() => h.editor.execute({ type: 'update-event-marking', eventId: 'n', markingId: 'accent',
      value: { kind: 'articulation', type: 'staccato', placement: 'auto' }, fields: ['type'] }));
    const accepted = state(h.editor);
    change(input, 'tenuto');
    expect(h.controller.snapshot()).toMatchObject({ status: 'conflict', canApply: false });
    expect(el('event-markings-draft-status').textContent).toMatch(/Accepted[\s\S]*Staccato[\s\S]*Draft[\s\S]*Tenuto/);
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
  });

  it.each(['accent', 'ornament'])('rejects a nonmounted legacy placement field on %s', id => {
    const h = fixture(), accepted = state(h.editor);
    const obsolete = document.createElement('input'); obsolete.dataset.markingField = 'placement';
    row(id).append(obsolete);
    change(obsolete, 'below'); click('apply-event-markings');
    expect(h.controller.hasDirty).toBe(false);
    expect(h.execute).not.toHaveBeenCalled();
    expect(state(h.editor)).toEqual(accepted);
  });
});

describe('MARK-DISPLAYED-BINDING', () => {
  it('keeps the displayed baseline when an unseen accepted interval changes before the first input', () => {
    const h = fixture();
    const input = field('third', 'value');
    h.unseen(() => h.interval('#4'));
    const accepted = state(h.editor);
    change(input, '5');
    expect(h.controller.snapshot()).toMatchObject({ targetId: 'n', status: 'conflict', canApply: false });
    expect(field('third', 'value').value).toBe('5');
    expect(el('event-markings-draft-status').textContent).toContain('#4');
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
  });

  it.each(['input', 'remove'] as const)('retains an old document draft after reused-ID replacement before a native %s', action => {
    const h = fixture();
    const documentId = h.editor.project.id;
    const input = field('third', 'value');
    const oldRow = row('third');
    const button = oldRow.querySelector<HTMLButtonElement>('[data-remove-marking]')!;
    h.unseen(() => { h.editor.replaceProject(createProject(road().replace('value="b3"', 'value="#4"'), 'Other document')); h.select('n'); });
    const accepted = state(h.editor);
    if (action === 'input') change(input, '5'); else button.click();
    expect(h.controller.snapshot()).toMatchObject({ documentId, targetId: 'n', status: 'document-changed', canApply: false });
    if (action === 'input') expect(field('third', 'value').value).toBe('5');
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('#4');
  });

  it('replaces mounted row controls when a clean displayed document changes with reused IDs', () => {
    const h = fixture();
    const oldRow = row('third'), oldInput = field('third', 'value');
    h.unseen(() => { h.editor.replaceProject(createProject(road(), 'New document')); h.select('n'); });
    h.controller.refresh();
    expect(row('third')).not.toBe(oldRow);
    const accepted = state(h.editor);
    change(oldInput, '#11');
    expect(h.controller.hasDirty).toBe(false);
    expect(state(h.editor)).toEqual(accepted);
  });

  it('keeps a stale Add action with its displayed document instead of adding to a reused owner ID', () => {
    const h = fixture(), documentId = h.editor.project.id;
    h.unseen(() => { h.editor.replaceProject(createProject(road(), 'Other document')); h.select('n'); });
    const accepted = state(h.editor);
    click('add-event-interval');
    expect(h.controller.snapshot()).toMatchObject({ documentId, targetId: 'n', status: 'document-changed', canApply: false });
    expect(h.controller.snapshot().values?.rows.at(-1)).toMatchObject({ kind: 'interval', value: '' });
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
  });

  it('does not follow a child ID moved to another owner before an old input arrives', () => {
    const h = fixture(), input = field('third', 'value');
    h.unseen(() => h.editor.applySource(h.editor.project.sourceHtml.replace(third, '').replace(
      '<music-articulation id="other-mark"', `${third}<music-articulation id="other-mark"`)));
    const accepted = state(h.editor), moved = h.editor.source.querySelector('#third');
    change(input, '5');
    expect(h.controller.snapshot()).toMatchObject({ targetId: 'n', status: 'conflict', canApply: false });
    click('review-event-markings'); click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
    remove('third');
    expect(h.controller.hasDirty).toBe(false);
    expect(h.editor.source.querySelector('#third')).toBe(moved);
    expect(moved?.parentElement?.id).toBe('other');
    expect(moved?.getAttribute('value')).toBe('b3');
  });

  it('retains the original owner when selection changes before an old connected input arrives', () => {
    const h = fixture();
    const input = field('third', 'value');
    h.unseen(() => h.select('other'));
    change(input, '#11');
    expect(h.controller.snapshot()).toMatchObject({ targetId: 'n', matchesSelection: false, canApply: false });
    expect(field('third', 'value').value).toBe('#11');
    expect(h.editor.canUndo).toBe(false);
  });

  it('keeps an unseen family replacement separate from an old native type edit', () => {
    const h = fixture();
    const input = field('ornament', 'type');
    h.unseen(() => h.editor.applySource(h.editor.project.sourceHtml.replace(ornament,
      '<music-interval id="ornament" value="5" placement="above" data-keep="replacement"></music-interval>')));
    const accepted = state(h.editor);
    change(input, 'upper-mordent');
    expect(h.controller.snapshot()).toMatchObject({ status: 'conflict', canApply: false });
    expect(field('ornament', 'type').value).toBe('upper-mordent');
    expect(el('event-markings-draft-status').textContent).toMatch(/Accepted[\s\S]*5/);
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
  });

  it('merges unrelated unseen metadata and direction edits without forcing Review', () => {
    const h = fixture();
    const input = field('third', 'value');
    h.unseen(() => {
      h.editor.update('Retitle', project => { project.metadata.title = 'New title'; });
      h.editor.applySource(h.editor.project.sourceHtml.replace('id="n" direction="higher"', 'id="n" direction="lower"'));
    });
    change(input, '5');
    expect(h.controller.snapshot()).toMatchObject({ status: 'dirty', canApply: true });
    click('apply-event-markings');
    expect(h.editor.project.metadata.title).toBe('New title');
    expect(h.editor.source.querySelector('#n')?.getAttribute('direction')).toBe('lower');
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('5');
  });

  it('keeps unfinished input, duplicate native events, caret, and selection without rebuilding its field', () => {
    const h = fixture();
    const input = field('third', 'value') as HTMLInputElement;
    input.focus(); input.value = '#'; input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(field('third', 'value')).toBe(input);
    expect(input.value).toBe('#');
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
    expect(document.activeElement).toBe(input);
    expect(h.controller.dirtyCount).toBe(1);
    expect(h.editor.revision).toBe(0);
  });
});

describe('MARK-REVIEW-VISIBLE and MARK-EXTERNAL-DELETION', () => {
  it('shows accepted and draft values, then requires a second Review for an unseen newer conflict', () => {
    const h = fixture();
    change(field('third', 'value'), '5'); h.interval('3');
    expect(el('event-markings-draft-status').textContent).toMatch(/Accepted[\s\S]*3[\s\S]*Draft[\s\S]*5/);
    h.unseen(() => h.interval('#4'));
    const accepted = state(h.editor);
    click('review-event-markings');
    expect(h.controller.snapshot()).toMatchObject({ status: 'conflict', canApply: false });
    expect(el('event-markings-draft-status').textContent).toContain('#4');
    expect(state(h.editor)).toEqual(accepted);
    click('review-event-markings');
    expect(h.controller.snapshot().canApply).toBe(true);
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('5');
    expect(h.editor.revision).toBe(accepted.revision + 1);
    h.editor.undo();
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('#4');
  });

  it('does not require another Review for an unseen unrelated title change', () => {
    const h = fixture();
    change(field('third', 'value'), '5'); h.interval('3');
    h.unseen(() => h.editor.update('Title', project => { project.metadata.title = 'Unrelated'; }));
    click('review-event-markings');
    expect(h.controller.snapshot().canApply).toBe(true);
    expect(h.editor.project.metadata.title).toBe('Unrelated');
  });

  it('adopts an external deletion of a row with no local change', () => {
    const h = fixture();
    change(field('accent', 'type'), 'tenuto');
    expect(h.controller.snapshot(), el('event-markings-draft-status').textContent ?? '').toMatchObject({ status: 'dirty', error: null });
    h.editor.execute({ type: 'remove-event-marking', eventId: 'n', markingId: 'ornament' });
    const accepted = state(h.editor);
    click('review-event-markings');
    expect(el('event-markings-rows').querySelector('[data-marking-id="ornament"]')).toBeNull();
    expect(h.controller.snapshot().canApply).toBe(true);
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#ornament')).toBeNull();
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
    expect(h.editor.revision).toBe(accepted.revision + 1);
  });

  it('adopts an external family replacement of a row with no local change', () => {
    const h = fixture();
    change(field('accent', 'type'), 'tenuto');
    h.editor.applySource(h.editor.project.sourceHtml.replace(ornament,
      '<music-interval id="ornament" value="5" placement="above" data-keep="replacement"></music-interval>'));
    const replacement = h.editor.source.querySelector('#ornament');
    click('review-event-markings');
    expect(row('ornament').dataset.markingKind).toBe('interval');
    expect(field('ornament', 'value').value).toBe('5');
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#ornament')).toBe(replacement);
    expect(replacement?.getAttribute('data-keep')).toBe('replacement');
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
  });

  it('retains a locally changed deleted row for explicitly discarding that row without musical history', () => {
    const h = fixture();
    change(field('ornament', 'type'), 'turn');
    h.editor.execute({ type: 'remove-event-marking', eventId: 'n', markingId: 'ornament' });
    click('review-event-markings');
    expect(field('ornament', 'type').value).toBe('turn');
    click('apply-event-markings');
    expect(el('event-markings-draft-status').textContent).toMatch(/removed|no longer/);
    h.editor.update('Temporary title', project => { project.metadata.title = 'temporary'; }); h.editor.undo();
    const accepted = state(h.editor);
    expect(row('ornament').querySelector('[data-remove-marking]')?.textContent).toContain('Discard');
    remove('ornament');
    expect(h.controller.hasDirty).toBe(false);
    click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
    expect(h.editor.canRedo).toBe(true);
  });

  it('discards a locally changed old family without deleting its accepted replacement', () => {
    const h = fixture();
    change(field('ornament', 'type'), 'turn');
    change(field('accent', 'type'), 'tenuto');
    h.editor.applySource(h.editor.project.sourceHtml.replace(ornament,
      '<music-interval id="ornament" value="5" placement="above" data-keep="replacement"></music-interval>'));
    const replacement = h.editor.source.querySelector('#ornament');
    click('review-event-markings');
    expect(field('ornament', 'type').value).toBe('turn');
    expect(row('ornament').querySelector('[data-remove-marking]')?.textContent).toContain('Discard');
    remove('ornament');
    expect(field('ornament', 'value').value).toBe('5');
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#ornament')).toBe(replacement);
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
  });
});

describe('attachment draft guards and lifecycle', () => {
  it.each<ViewMode>(['read', 'pages'])('keeps rows but rejects native mutation handlers in %s', mode => {
    const h = fixture(); change(field('third', 'value'), '5');
    h.context.mode = mode; h.controller.refresh();
    const draft = h.controller.snapshot().values;
    const accepted = state(h.editor);
    change(field('third', 'value'), '#11'); click('add-event-articulation'); click('apply-event-markings');
    row('third').querySelector('[data-remove-marking]')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(h.controller.snapshot().values).toEqual(draft);
    expect(state(h.editor)).toEqual(accepted);
    expect(h.execute).not.toHaveBeenCalled();
    h.context.mode = 'write'; h.controller.refresh();
    expect(h.controller.snapshot().canApply).toBe(true);
  });

  it('blocks attached edits while Source is pending and retains their independent draft', () => {
    const h = fixture(); change(field('third', 'value'), '5');
    h.editor.setPendingSource(`${h.editor.project.sourceHtml}\n<!-- unfinished -->`);
    const accepted = state(h.editor), draft = h.controller.snapshot().values;
    change(field('third', 'value'), '#11'); click('add-event-ornament'); click('apply-event-markings');
    expect(h.controller.snapshot().values).toEqual(draft);
    expect(state(h.editor)).toEqual(accepted);
    expect(h.controller.snapshot().blockedReason).toContain('Source');
    h.editor.setPendingSource(null);
    expect(h.controller.snapshot().canApply).toBe(true);
  });

  it('blocks ranges and retains the original event draft until Return', () => {
    const h = fixture(); change(field('third', 'value'), '5');
    h.context.rangeEventIds = ['n', 'other']; h.controller.refresh();
    const accepted = state(h.editor), draft = h.controller.snapshot().values;
    click('add-event-interval'); click('apply-event-markings');
    change(field('third', 'value'), '#11');
    expect(h.controller.snapshot().values).toEqual(draft);
    expect(state(h.editor)).toEqual(accepted);
    click('return-event-markings');
    expect(h.context.rangeEventIds).toEqual(['n']);
    expect(h.controller.snapshot().canApply).toBe(true);
  });

  it.each(['removed', 'other document'] as const)('does not acknowledge a draft after its owner becomes %s during stale Review', reason => {
    const h = fixture(); change(field('third', 'value'), '5'); h.interval('3');
    h.unseen(() => {
      if (reason === 'removed') h.editor.execute({ type: 'remove-event', eventId: 'n' });
      else { h.editor.replaceProject(createProject(road(), 'Other')); h.select('n'); }
    });
    const accepted = state(h.editor);
    click('review-event-markings'); click('apply-event-markings');
    expect(h.controller.snapshot().canApply).toBe(false);
    expect(field('third', 'value').value).toBe('5');
    expect(state(h.editor)).toEqual(accepted);
  });

  it('aborts native listeners and explicit opening when disposed', () => {
    const h = fixture();
    const accepted = state(h.editor);
    h.controller.dispose();
    change(field('third', 'value'), '5'); click('add-event-articulation'); click('apply-event-markings');
    h.controller.openFor('other', 'other-mark'); h.controller.refresh();
    expect(h.controller.hasDirty).toBe(false);
    expect(h.openTools).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
    expect(state(h.editor)).toEqual(accepted);
  });
});

describe('explicit attached-mark routes and pane-only focus', () => {
  it('opens and focuses the exact existing row without musical history', () => {
    const h = fixture();
    const accepted = state(h.editor);
    h.controller.openFor('n', 'ornament');
    expect(h.openTools).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(field('ornament', 'type'));
    expect(el('event-markings-editor').dataset.activeMarkingId).toBe('ornament');
    expect(row('ornament').getAttribute('aria-current')).toBe('true');
    expect(state(h.editor)).toEqual(accepted);
    h.controller.openFor('n', 'third');
    expect(document.activeElement).toBe(field('third', 'value'));
    expect(el('event-markings-editor').dataset.activeMarkingId).toBe('third');
    expect(row('ornament').hasAttribute('aria-current')).toBe(false);
  });

  it('opens recovery instead of retargeting a dirty draft to a different owner', () => {
    const h = fixture(); change(field('third', 'value'), '#');
    h.select('other');
    const accepted = state(h.editor), draft = h.controller.snapshot().values;
    h.select.mockClear();
    h.controller.openFor('other', 'other-mark');
    expect(h.controller.snapshot()).toMatchObject({ targetId: 'n', matchesSelection: false });
    expect(h.controller.snapshot().values).toEqual(draft);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.openTools).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(el('event-markings-draft-status'));
    expect(el('event-markings-draft-status').textContent).toMatch(/Return|Discard/);
    expect(state(h.editor)).toEqual(accepted);
  });

  it.each(['other-mark', 'missing'] as const)('rejects an unrelated or missing marking %s instead of focusing a guessed row', markingId => {
    const h = fixture();
    const accepted = state(h.editor);
    h.controller.openFor('n', markingId);
    expect(document.activeElement).toBe(el('event-markings-draft-status'));
    expect(el('event-markings-draft-status').textContent).toMatch(/no longer|belong|available/);
    expect(state(h.editor)).toEqual(accepted);
  });

  it.each(['selection', 'removal', 'family', 'document'] as const)('clears an explicitly opened row identity after %s changes', reason => {
    const h = fixture(); h.controller.openFor('n', 'ornament');
    expect(el('event-markings-editor').dataset.activeMarkingId).toBe('ornament');
    if (reason === 'selection') h.select('other');
    else if (reason === 'removal') h.editor.execute({ type: 'remove-event-marking', eventId: 'n', markingId: 'ornament' });
    else if (reason === 'family') h.editor.applySource(h.editor.project.sourceHtml.replace(ornament,
      '<music-interval id="ornament" value="5" placement="above"></music-interval>'));
    else { h.editor.replaceProject(createProject(road(), 'Replacement')); h.select('n'); }
    h.controller.refresh();
    expect(el('event-markings-editor').dataset.activeMarkingId).toBe('');
    expect(el('event-markings-rows').querySelector('[aria-current]')).toBeNull();
    expect(h.openTools).toHaveBeenCalledOnce();
  });

  it('reveals a newly added field by scrolling only the containing tool panel', () => {
    const h = fixture();
    const pane = el('selection-inspector'), score = el('score-scroll');
    Object.defineProperty(pane, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 1200, configurable: true });
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this === pane ? { top: 100, bottom: 300, height: 200 } : { top: 650, bottom: 694, height: 44 }) as DOMRect;
    });
    const windowScroll = vi.spyOn(window, 'scrollTo');
    const intoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    score.scrollTop = 237; document.documentElement.scrollTop = 19;
    click('add-event-interval');
    const last = el('event-markings-rows').lastElementChild!;
    expect(document.activeElement).toBe(last.querySelector('[data-marking-field="value"]'));
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(score.scrollTop).toBe(237);
    expect(document.documentElement.scrollTop).toBe(19);
    expect(windowScroll).not.toHaveBeenCalled(); expect(intoView).not.toHaveBeenCalled();
    expect(h.editor.revision).toBe(0);
    bounds.mockRestore();
  });

  it('removes a middle row to the following field and a last row to the nearest prior field', () => {
    fixture();
    remove('ornament');
    expect(document.activeElement).toBe(field('third', 'value'));
    remove('third');
    expect(document.activeElement).toBe(field('accent', 'type'));
    remove('accent');
    expect(document.activeElement).toBe(el('add-event-articulation'));
  });

  it('moves focus from successful Apply to an enabled target and never steals focus on passive refresh', () => {
    const h = fixture(); change(field('third', 'value'), '5');
    el('apply-event-markings').focus(); click('apply-event-markings');
    expect(document.activeElement).toBe(el('event-markings-target'));
    expect(el('event-markings-draft-status').closest<HTMLElement>('.draft-notice')?.hidden).toBe(true);
    expect((document.activeElement as HTMLButtonElement).disabled).not.toBe(true);
    const score = el('score-editor'); score.focus();
    h.controller.refresh();
    h.editor.update('Title', project => { project.metadata.title = 'Different title'; });
    expect(document.activeElement).toBe(score);
  });
});

describe('AUTHOR-TIED-INTERVALS controller scope', () => {
  it('starts off, names the complete connected sound, and treats scope changes as local only', () => {
    const h = fixture(chain);
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    expect(el('event-markings-tie-options').hidden).toBe(false);
    expect(el('event-markings-tie-help').textContent).toMatch(/2[\s\S]*bar[\s\S]*1[\s\S]*2/);
    const accepted = state(h.editor);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state(h.editor)).toEqual(accepted);
    expect(h.controller.hasDirty).toBe(false);
  });

  it('passes explicit chain scope for interval changes in one mixed Apply and preserves local-only attachments', () => {
    const h = fixture(chain);
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '5'); change(field('accent', 'type'), 'tenuto');
    const continued = h.editor.source.querySelector('#continued-third'), release = h.editor.source.querySelector('#release');
    click('apply-event-markings');
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'edit-event-markings', eventId: 'n', intervalScope: 'tie-chain' }));
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('5');
    expect(h.editor.source.querySelector('#continued-third')).toBe(continued);
    expect(continued?.getAttribute('value')).toBe('5');
    expect(h.editor.source.querySelector('#release')).toBe(release);
    expect(release?.getAttribute('placement')).toBeNull();
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
    expect(h.editor.source.querySelector('#accent')?.getAttribute('placement')).toBeNull();
    expect(h.editor.revision).toBe(1);
    h.editor.undo();
    expect(h.editor.source.querySelector('#continued-third')?.getAttribute('value')).toBe('♭3');
    expect(h.editor.source.querySelector('#accent')?.getAttribute('type')).toBe('accent');
    expect(h.editor.source.querySelector('#accent')?.getAttribute('placement')).toBeNull();
    expect(h.editor.canUndo).toBe(false);
  });

  it.each(['articulation', 'ornament'] as const)('does not pass chain scope for %s-only changes', kind => {
    const h = fixture(chain);
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const markingId = kind === 'articulation' ? 'accent' : 'ornament';
    const type = kind === 'articulation' ? 'tenuto' : 'turn';
    change(field(markingId, 'type'), type);
    click('apply-event-markings');
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute.mock.calls[0][0]).not.toHaveProperty('intervalScope');
    expect(h.editor.source.querySelector(`#${markingId}`)?.getAttribute('type')).toBe(type);
    expect(h.editor.source.querySelector(`#${markingId}`)?.getAttribute('placement')).toBeNull();
    expect(h.editor.source.querySelector('#continued-third')?.getAttribute('value')).toBe('♭3');
  });

  it('never propagates an unchecked interval change, retains its failed draft, then permits explicit complete scope', () => {
    const h = fixture(chain); change(field('third', 'value'), '5');
    const accepted = state(h.editor);
    click('apply-event-markings');
    expect(h.execute.mock.calls[0][0]).not.toHaveProperty('intervalScope');
    expect(state(h.editor)).toEqual(accepted);
    expect(field('third', 'value').value).toBe('5');
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#continued-third')?.getAttribute('value')).toBe('5');
    expect(h.editor.revision).toBe(1);
  });

  it('ignores forged scope for an untied road and resets scope when a clean target changes', () => {
    const h = fixture();
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    expect(checkbox.disabled).toBe(true);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '5'); click('apply-event-markings');
    expect(h.execute.mock.calls[0][0]).not.toHaveProperty('intervalScope');
    h.select('other');
    expect(checkbox.checked).toBe(false);
  });

  it('retains target-bound scope while inspecting another owner and opening its dirty row again', () => {
    const h = fixture(chain);
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '#');
    h.select('continuation'); h.controller.openFor('continuation', 'continued-third');
    expect(h.controller.snapshot().targetId).toBe('n');
    expect(checkbox.checked).toBe(true);
    click('return-event-markings'); h.controller.openFor('n', 'third');
    expect(field('third', 'value').value).toBe('#');
    expect(document.activeElement).toBe(field('third', 'value'));
    expect(checkbox.checked).toBe(true);
  });

  it('requires visible Review when the accepted connected chain changes but ignores unrelated segment marks', () => {
    const h = fixture(chain);
    const checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '5');
    h.editor.execute({ type: 'update-event-marking', eventId: 'continuation', markingId: 'release',
      value: { kind: 'articulation', type: 'fermata', placement: 'below' }, fields: ['placement'] });
    expect(h.controller.snapshot().status).toBe('dirty');
    h.editor.applySource(h.editor.project.sourceHtml.replace('id="continuation"', 'id="new-continuation"'));
    expect(h.controller.snapshot()).toMatchObject({ status: 'conflict', canApply: false });
    expect(el('event-markings-draft-status').textContent).toContain('new-continuation');
    click('review-event-markings');
    expect(h.controller.snapshot().canApply).toBe(true);
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#continued-third')?.getAttribute('value')).toBe('5');
    expect(h.editor.source.querySelector('#release')?.getAttribute('placement')).toBe('below');
  });

  it('requires a fresh scope choice after an unseen chain change before checking it', () => {
    const h = fixture(chain), checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    h.unseen(() => h.editor.applySource(h.editor.project.sourceHtml.replace('id="continuation"', 'id="new-continuation"')));
    const accepted = state(h.editor);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(checkbox.checked).toBe(false);
    expect(el('event-markings-draft-status').textContent).toMatch(/changed[\s\S]*scope/);
    expect(state(h.editor)).toEqual(accepted);
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(checkbox.checked).toBe(true);
    expect(state(h.editor)).toEqual(accepted);
  });

  it('does not silently change complete-sound intent to a single note after the chain is removed', () => {
    const h = fixture(chain), checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '5');
    h.editor.execute({ type: 'clear-ties', eventIds: ['n', 'continuation'] });
    const accepted = state(h.editor);
    click('review-event-markings'); click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    expect(el('event-markings-tie-options').hidden).toBe(false);
    expect(el('event-markings-draft-status').textContent).toMatch(/no longer[\s\S]*Turn off/);
    checkbox.checked = false; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    click('apply-event-markings');
    expect(h.editor.source.querySelector('#third')?.getAttribute('value')).toBe('5');
    expect(h.editor.source.querySelector('#continued-third')?.getAttribute('value')).toBe('♭3');
    expect(h.execute.mock.calls.at(-1)?.[0]).not.toHaveProperty('intervalScope');
  });

  it('preserves raw aliases, source identity, and Redo for a semantic interval no-op with explicit scope', () => {
    const h = fixture(chain), checkbox = el<HTMLInputElement>('event-markings-tie-scope');
    h.editor.update('Temporary title', project => { project.metadata.title = 'Temporary'; }); h.editor.undo();
    const accepted = state(h.editor), ownerMark = h.editor.source.querySelector('#third'), continuationMark = h.editor.source.querySelector('#continued-third');
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    change(field('third', 'value'), '♭3'); click('apply-event-markings');
    expect(state(h.editor)).toEqual(accepted);
    expect(h.controller.hasDirty).toBe(false);
    expect(h.editor.source.querySelector('#third')).toBe(ownerMark);
    expect(h.editor.source.querySelector('#continued-third')).toBe(continuationMark);
    expect(ownerMark?.getAttribute('value')).toBe('b3');
    expect(continuationMark?.getAttribute('value')).toBe('♭3');
    expect(h.editor.canRedo).toBe(true);
  });
});
