// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import { authorActiveElement, findAuthorControl, mountAuthorFixture } from './author-fixture.js';
import { MUSIC_CLIPBOARD_TYPE } from '../src/authoring/music-clipboard.js';
import { pitchText } from '../src/model/index.js';

const source = `<music-staff id="staff"><music-measure id="from" incomplete>
  <music-note id="a" pitch="Fqs3" duration="quarter"><music-articulation id="accent" type="accent"></music-articulation></music-note>
  <music-note id="b" pitch="Ab3" duration="quarter"></music-note></music-measure>
  <music-measure id="to" incomplete></music-measure></music-staff>`;
let app: AuthorWorkspace;
const el = <T extends HTMLElement = HTMLElement>(id: string) => findAuthorControl(document, id)! as T;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function click(id: string) { el(id).click(); await flush(); }
async function select(id: string, shiftKey = false) {
  el('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true,
    detail: { sourceId: id, sourceElement: app.session.source.querySelector('#' + id), shiftKey, ctrlKey: false, metaKey: false, altKey: false, clickCount: 1, pointerType: 'mouse' } }));
  await flush();
}
async function clipboard(kind: 'copy' | 'paste', data: DataTransfer, target = el('score-editor')) {
  const event = new ClipboardEvent(kind, { clipboardData: data, bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event); await flush(); return event;
}
async function destination() {
  await click('location-trigger');
  const field = el<HTMLSelectElement>('measure-select'); field.value = 'to'; field.dispatchEvent(new Event('change', { bubbles: true }));
  await click('start-entry-here');
}
beforeEach(() => {
  mountAuthorFixture();
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
  window.getSelection()?.removeAllRanges();
  const values = new Map<string, string>();
  app = new AuthorWorkspace({ project: createProject(source), recovery: new RecoveryStore({ key: 'clipboard-test',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() } }) });
});
afterEach(() => { app.dispose(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('Select copy / Write notes paste', () => {
  it('copies without history, pastes at the writer, advances it, and undoes the complete paste', async () => {
    await select('a'); await select('b', true);
    const before = app.session.project.sourceHtml; const data = new DataTransfer();
    expect((await clipboard('copy', data)).defaultPrevented).toBe(true);
    expect(data.getData(MUSIC_CLIPBOARD_TYPE)).toContain('Music Notes passage v1');
    expect(app.session.canUndo).toBe(false);
    await destination();
    const recipe = el<HTMLInputElement>('event-pitch').value;
    expect((await clipboard('paste', data)).defaultPrevented).toBe(true);
    const pasted = app.session.score.staves[0].measures[1].voices[0].events;
    expect(pasted.map(event => pitchText(event.pitches[0]))).toEqual(['Fqs3', 'Ab3']);
    expect(pasted[0].markings?.[0]).toMatchObject({ type: 'accent' });
    expect(app.session.cursor?.eventId).toBe(pasted[1].id);
    expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
    expect(authorActiveElement(document)).toBe(el('score-editor'));
    expect(el<HTMLInputElement>('event-pitch').value).toBe(recipe);
    await click('undo'); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
    await click('redo'); expect(app.session.score.staves[0].measures[1].voices[0].events).toHaveLength(2);
  });
  it('leaves native text copy/paste alone and blocks musical paste outside writing mode', async () => {
    await select('a'); const data = new DataTransfer(); await clipboard('copy', data);
    const before = app.session.project.sourceHtml;
    await clipboard('paste', data); expect(app.session.project.sourceHtml).toBe(before);
    expect(el('author-errors').textContent).toMatch(/Write notes/);
    const input = document.createElement('textarea'); el('score-editor').append(input);
    expect((await clipboard('copy', data, input)).defaultPrevented).toBe(false);
    expect((await clipboard('paste', data, input)).defaultPrevented).toBe(false);
    expect(app.session.canUndo).toBe(false);
  });
  it('blocks pending Source and malformed clipboard data without changing the cursor or score', async () => {
    await select('a'); const data = new DataTransfer(); await clipboard('copy', data); await destination();
    const before = app.session.project.sourceHtml, cursor = app.session.cursor;
    app.session.setPendingSource(before + '\n<!-- pending -->');
    await clipboard('paste', data); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.cursor).toEqual(cursor);
    app.session.setPendingSource(null); data.clearData(); data.setData('text/plain', 'unrelated text');
    await clipboard('paste', data); expect(app.session.project.sourceHtml).toBe(before); expect(app.session.canUndo).toBe(false);
  });
  it('ordinary Enter pushes notes through later bars without a continuation preference', async () => {
    await destination();
    const field = el<HTMLSelectElement>('event-duration'); field.value = 'whole'; field.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 3; i++) {
      el('score-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true })); await flush();
    }
    expect(app.session.score.staves[0].measures).toHaveLength(4);
    expect(app.session.score.staves[0].measures.slice(1).map(measure => measure.voices[0].events.length)).toEqual([1, 1, 1]);
    expect(el('author-errors').hidden).toBe(true);
    await click('undo'); expect(app.session.score.staves[0].measures).toHaveLength(3);
  });
});
