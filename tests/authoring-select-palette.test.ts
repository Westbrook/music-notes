// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { MusicToggleButtonGroup } from '../src/ui/toggle-button-group.js';
import { findAuthorControl, mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';

let app: AuthorWorkspace | undefined;
const source = `<music-staff id="staff"><music-measure id="bar" incomplete>
<music-note id="a" pitch="F4" duration="quarter"><music-articulation id="accent" type="accent"></music-articulation><music-articulation id="tenuto" type="tenuto"></music-articulation></music-note>
<music-note id="b" pitch="G#4" duration="eighth"></music-note><music-note id="c" pitch="A4" duration="eighth"></music-note>
</music-measure></music-staff>`;
const control = <T extends HTMLElement = HTMLElement>(id: string) => findAuthorControl<T>(document, id)!;
const group = (id: string) => control<MusicToggleButtonGroup>(id);
const event = (id: string) => app!.session.score.staves[0].measures[0].voices[0].events.find(event => event.id === id)!;
const marks = (id: string) => event(id).markings?.map(mark => mark.kind === 'interval' ? 'interval' : mark.type) ?? [];
async function flush() { await Promise.resolve(); await Promise.resolve(); }
async function select(id: string, more = false) {
  control('score-host').dispatchEvent(new CustomEvent('notation-select', { bubbles: true, composed: true,
    detail: { sourceId: id, sourceElement: app!.session.source.querySelector(`#${id}`), shiftKey: more } }));
  await flush();
}
async function choose(id: string, value: string) {
  const g = group(id); expect(g.disabled).toBe(false);
  expect(g.options.find(option => option.value === value)?.disabled).toBe(false);
  if (g.choiceStates) g.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value } }));
  else { g.value = value; g.dispatchEvent(new Event('change', { bubbles: true, composed: true })); }
  await flush();
}
function mount(html = source) {
  const values = new Map<string,string>();
  app = new AuthorWorkspace({ project: createProject(html), recovery: new RecoveryStore({key:'select-palette',storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}}}) });
  return app;
}
beforeEach(() => {
  mountAuthorFixture();
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
});
afterEach(async () => { app?.dispose(); app = undefined; vi.restoreAllMocks(); await releaseAuthorFixture(); });

describe('Select quick palette', () => {
  it('changes accepted accidental, duration and dots while preserving the recipe and one-step history', async () => {
    mount(); await select('a');
    const recipe = ['entry-accidentals','entry-duration','entry-dots','entry-attack'].map(id=>group(id).value);
    const before = app!.session.project.sourceHtml;
    await choose('selection-accidentals','0.5');
    expect(event('a').pitches[0].alter).toBe(.5);
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
    await choose('selection-quick-duration','eighth'); await choose('selection-quick-dots','1');
    expect(event('a')).toMatchObject({ duration:'eighth',dots:1 });
    expect(marks('a')).toEqual(['accent','tenuto']);
    expect(['entry-accidentals','entry-duration','entry-dots','entry-attack'].map(id=>group(id).value)).toEqual(recipe);
    expect(document.body.dataset.toolsOpen).toBe('false');
  });
  it('shows mixed values and changes only exact selected events in one Undo', async () => {
    mount(); await select('a'); await select('b',true);
    expect(group('selection-quick-duration').mixed).toBe(true);
    expect(group('selection-accidentals').mixed).toBe(true);
    expect(group('selection-quick-attack').choiceStates?.['articulation:accent']).toBe('mixed');
    const before = app!.session.project.sourceHtml;
    await choose('selection-quick-duration','sixteenth');
    expect([event('a').duration,event('b').duration,event('c').duration]).toEqual(['sixteenth','sixteenth','eighth']);
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
  });
  it('toggles attacks independently, fills mixed presence, and preserves existing mark IDs', async () => {
    mount(); await select('a'); await select('b',true);
    const before = app!.session.project.sourceHtml;
    await choose('selection-quick-attack','articulation:accent');
    expect(marks('a')).toEqual(['accent','tenuto']); expect(marks('b')).toEqual(['accent']);
    expect(event('a').markings?.[0].id).toBe('accent');
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
    await choose('selection-quick-attack','ornament:trill');
    expect(marks('a')).toEqual(['accent','tenuto','trill']); expect(marks('b')).toEqual(['trill']);
    await choose('selection-quick-attack','ornament:trill');
    expect(marks('a')).toEqual(['accent','tenuto']); expect(marks('b')).toEqual([]);
    await choose('selection-quick-attack','none'); expect(marks('a')).toEqual([]);
    app!.session.undo(); expect(marks('a')).toEqual(['accent','tenuto']);
  });
  it('rejects overflowing values atomically and restores the displayed accepted choice', async () => {
    mount(); await select('a');
    const before=app!.session.project.sourceHtml;
    await choose('selection-quick-duration','whole');
    expect(app!.session.project.sourceHtml).toBe(before); expect(app!.session.canUndo).toBe(false);
    expect(group('selection-quick-duration').value).toBe('quarter');
    expect(control('author-errors').hidden).toBe(false);
  });
  it('disables incompatible mixed selections but permits fermatas and mark removal', async () => {
    mount(source.replace('<music-note id="b" pitch="G#4" duration="eighth"></music-note>','<music-rest id="b" duration="eighth"></music-rest>'));
    await select('a'); await select('b',true);
    expect(group('selection-accidentals').disabled).toBe(true);
    expect(group('selection-quick-attack').options.find(option=>option.value==='ornament:trill')?.disabled).toBe(true);
    await choose('selection-quick-attack','articulation:fermata');
    expect(marks('b')).toEqual(['fermata']);
    await choose('selection-quick-attack','none'); expect(marks('a')).toEqual([]); expect(marks('b')).toEqual([]);
  });
  it('clears attacks without removing road intervals or changing direction', async () => {
    mount('<music-staff id="staff" notation="three-roads"><music-measure id="bar" incomplete><music-road id="a" direction="same" duration="quarter"><music-interval id="interval" value="3" placement="above"></music-interval><music-ornament type="trill"></music-ornament></music-road></music-measure></music-staff>');
    await select('a'); await choose('selection-quick-attack','none');
    expect(marks('a')).toEqual(['interval']); expect(event('a').pitchDirection).toBe('same');
  });
});
