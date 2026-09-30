// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { reduceSelection } from '../src/authoring/selection.js';
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

describe('Select Note/Rest conversion', () => {
  const rest = '<music-rest id="b" duration="eighth" dots="1" data-user="keep"><music-articulation id="fermata" type="fermata"></music-articulation></music-rest>';
  const withRest = () => source.replace('<music-note id="b" pitch="G#4" duration="eighth"></music-note>', rest);
  it('converts exact notes to rests, preserving identity, rhythm, recipe, selection and Undo', async () => {
    mount(); await select('b'); await select('c', true);
    const before = app!.session.project.sourceHtml;
    const recipe = control<HTMLInputElement>('event-pitch').value;
    const cursor = app!.session.cursor;
    const ids = [...app!.session.selection.ids];
    await choose('selection-kind', 'rest');
    expect(event('a').kind).toBe('note');
    expect([event('b'), event('c')]).toMatchObject([{ id:'b',kind:'rest',duration:'eighth',dots:0 },{ id:'c',kind:'rest',duration:'eighth',dots:0 }]);
    expect(app!.session.selection.ids).toEqual(ids);
    expect(app!.session.cursor).toEqual(cursor);
    expect(control<HTMLInputElement>('event-pitch').value).toBe(recipe);
    const revision=app!.session.revision;
    await choose('selection-kind', 'rest'); expect(app!.session.revision).toBe(revision);
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
  });

  it('uses the middle line immediately, keeps existing notes untouched, and preserves compatible markings', async () => {
    mount(withRest()); await select('b'); await select('c', true);
    const before=app!.session.project.sourceHtml;
    expect(group('selection-kind').choiceStates).toEqual({ note:'mixed',rest:'mixed' });
    await choose('selection-kind','note');
    expect(control('selection-kind-chooser')).toBeNull();
    expect(event('b')).toMatchObject({kind:'note',duration:'eighth',dots:1,pitches:[{step:'B',alter:0,octave:4}],markings:[{id:'fermata',type:'fermata'}]});
    expect(event('c').pitches[0]).toMatchObject({step:'A',alter:0,octave:4});
    expect(app!.session.source.querySelector('#b')?.getAttribute('data-user')).toBe('keep');
    expect(control<HTMLInputElement>('event-pitch').value).toBe('C4');
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
  });

  it('rejects a captured conversion after selection changes', async () => {
    mount(withRest()); await select('b');
    group('selection-kind').dispatchEvent(new PointerEvent('pointerdown', { bubbles:true,composed:true,button:0,isPrimary:true,pointerId:1 }));
    const before=app!.session.project.sourceHtml;
    const selection=app!.session.selection;
    const next=reduceSelection(selection,{type:'replace',id:'c'},{score:app!.session.score,documentId:selection.documentId,documentEpoch:selection.documentEpoch,partId:selection.partId});
    app!.session.setSelection(next.state); await flush();
    await choose('selection-kind','rest');
    expect(app!.session.project.sourceHtml).toBe(before); expect(app!.session.canUndo).toBe(false);
  });

  it.each([['treble','B4'],['bass','D3'],['alto','C4'],['tenor','A3']] as const)('uses the middle line in %s clef', async (clef, pitch) => {
    mount(`<music-staff id="staff" clef="${clef}"><music-measure id="bar" incomplete>${rest}</music-measure></music-staff>`);
    await select('b'); await choose('selection-kind','note');
    expect(app!.session.source.querySelector('#b')?.getAttribute('pitch')).toBe(pitch);
  });

  it('resolves clef and key changes per selected event in one transaction', async () => {
    mount('<music-staff id="staff" clef="treble" key="F"><music-measure id="bar" incomplete><music-rest id="a" duration="quarter"></music-rest></music-measure><music-measure id="bar2" clef="bass" key="Eb" incomplete><music-rest id="b" duration="eighth" dots="1"></music-rest></music-measure><music-measure id="bar3" clef="alto" key="D" incomplete><music-rest id="c" duration="quarter"></music-rest></music-measure></music-staff>');
    await select('a'); await select('b',true); await select('c',true);
    const before=app!.session.project.sourceHtml; const ids=[...app!.session.selection.ids]; const revision=app!.session.revision;
    await choose('selection-kind','note');
    expect(['a','b','c'].map(id=>app!.session.source.querySelector(`#${id}`)?.getAttribute('pitch'))).toEqual(['Bb4','D3','C#4']);
    expect(app!.session.selection.ids).toEqual(ids); expect(app!.session.revision).toBe(revision+1);
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
  });

  it('keeps full-measure rests and incompatible markings protected', async () => {
    mount(); await select('a');
    expect(group('selection-kind').options.find(option=>option.value==='rest')?.disabled).toBe(true);
    const before=app!.session.project.sourceHtml;
    group('selection-kind').dispatchEvent(new CustomEvent('change',{detail:{value:'rest'}})); await flush();
    expect(app!.session.project.sourceHtml).toBe(before);
    app!.dispose(); app=undefined; await releaseAuthorFixture(); mountAuthorFixture();
    mount('<music-staff id="staff"><music-measure id="bar"><music-rest id="b" measure></music-rest></music-measure></music-staff>');
    await select('b');
    expect(group('selection-kind').options.find(option=>option.value==='note')?.disabled).toBe(true);
    await choose('selection-kind','rest'); expect(app!.session.canUndo).toBe(false);
  });

  it.each(['rhythm','three-roads'] as const)('uses %s notation without inventing absolute pitches', async notation => {
    mount(`<music-staff id="staff" notation="${notation}"><music-measure id="bar" incomplete>${rest}</music-measure></music-staff>`);
    await select('b'); const before=app!.session.project.sourceHtml;
    await choose('selection-kind','note');
    if(notation==='three-roads') expect(event('b').pitchDirection).toBe('same');
    expect(event('b')).toMatchObject({kind:notation==='rhythm'?'rhythm':'road',pitches:[],duration:'eighth',dots:1});
    app!.session.undo(); expect(app!.session.project.sourceHtml).toBe(before);
  });

  it('blocks tied conversions and Source drafts; repeated Note creates no history', async () => {
    mount('<music-staff id="staff"><music-measure id="bar" incomplete><music-note id="a" pitch="F4" duration="quarter" tie="start"></music-note><music-note id="b" pitch="F4" duration="quarter" tie="end"></music-note></music-measure></music-staff>');
    await select('a');
    expect(group('selection-kind').options.find(option=>option.value==='rest')?.disabled).toBe(true);
    await choose('selection-kind','note'); expect(app!.session.canUndo).toBe(false);
    app!.session.setPendingSource('unapplied'); await flush();
    expect(group('selection-kind').disabled).toBe(true);
  });
});
