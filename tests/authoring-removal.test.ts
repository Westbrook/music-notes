// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands.js';
import { EditorSession, EditorValidationError } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import { reduceSelection } from '../src/authoring/selection.js';
import type { SelectionState } from '../src/authoring/selection.js';
import type { Cursor, EventInput } from '../src/authoring/types.js';
import { readScore } from '../src/dom/index.js';
import { add, rational } from '../src/model/index.js';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}
const note = (id: string, duration = 'quarter', attributes = '') => `<music-note id="${id}" pitch="C4" duration="${duration}" ${attributes}></music-note>`;
const bar = (body: string, id = 'bar', attributes = '') => `<music-measure id="${id}" ${attributes}>${body}</music-measure>`;
const staff = (body: string, id = 'staff', attributes = '') => `<music-staff id="${id}" label="Lead" ${attributes}>${body}</music-staff>`;
const system = (body: string) => `<music-system id="score">${body}</music-system>`;
const root = (body: string, attributes = '') => element(system(staff(body, 'staff', attributes)));
const music = (source: Element) => readScore(source).score;
const events = (source: Element, measureIndex = 0, voiceIndex = 0) => music(source).staves[0].measures[measureIndex].voices[voiceIndex].events;
const remove = (source: Element, eventIds: readonly string[]) => applyCommand(source, { type: 'remove-events', eventIds });
const errors = (source: Element) => readScore(source).diagnostics.filter(item => item.severity === 'error');
const ids = (source: Element) => [source, ...source.querySelectorAll('[id]')].map(node => node.id).filter(Boolean);
const session = (html: string) => new EditorSession(createProject(html, 'Removal'));
function choose(editor: EditorSession, eventIds: readonly string[], primaryId = eventIds[0], focusId = primaryId): void {
  const next = reduceSelection(editor.selection, { type: 'set', ids: eventIds, primaryId, anchorId: eventIds[0], focusId }, {
    score: editor.score, documentId: editor.project.id, documentEpoch: editor.documentEpoch, partId: 'score',
  });
  expect(next.reason).toBeUndefined();
  editor.setSelection(next.state);
}
function semantic(selection: SelectionState): Omit<SelectionState, 'version'> {
  const { version: _version, ...state } = selection;
  return state;
}

const ensemble = system(staff(
  bar(`<music-direction id="instruction" text="Leave space"></music-direction><music-voice id="v1">${note('a')}${note('b')}${note('c')}${note('d')}</music-voice><music-voice id="v2">${note('writer', 'whole')}</music-voice>`, 'm1')
  + bar(`<music-voice id="v3">${note('e', 'half')}${note('f', 'half')}</music-voice><music-voice id="v4"><music-rest id="other-rest" measure></music-rest></music-voice>`, 'm2'),
  'staff', 'key="Bb"')
  + staff(bar('<music-rest id="bass-rest-1" measure></music-rest>', 'bass-m1')
    + bar('<music-rest id="bass-rest-2" measure></music-rest>', 'bass-m2'), 'bass', 'clef="bass"'));
const writing: Cursor = { staffId: 'staff', measureId: 'm1', voiceIndex: 1, eventId: 'writer' };
const input: EventInput = { kind: 'note', pitch: 'Dqf4', pitches: '', duration: 'quarter', dots: 0,
  rhythmic: false, measureRest: false, accidentalDisplay: 'courtesy', stem: 'auto', beam: 'auto' };

describe('exact event removal command', () => {
  it.each([
    ['note', note('only', 'whole'), ''],
    ['chord', '<music-chord id="only" pitches="C4 E4 G4" duration="whole"></music-chord>', ''],
    ['written rest', '<music-rest id="only" duration="whole"></music-rest>', ''],
    ['measure rest', '<music-rest id="only" measure></music-rest>', ''],
    ['open slash', '<music-slash id="only" duration="whole"></music-slash>', ''],
    ['rhythm', '<music-rhythm id="only" duration="whole"></music-rhythm>', 'notation="rhythm"'],
    ['road', '<music-road id="only" direction="higher" duration="whole"></music-road>', 'notation="three-roads"'],
  ])('removes a sole %s and leaves its voice empty and explicitly incomplete', (_kind, body, attributes) => {
    const source = root(bar(body), attributes), originalIds = ids(source);
    expect(errors(source)).toEqual([]);
    const result = remove(source, ['only']);
    expect(source.querySelector('#only')).toBeNull();
    expect(events(source)).toEqual([]); expect(source.querySelector('music-rest')).toBeNull();
    expect(ids(source)).toEqual(originalIds.filter(id => id !== 'only'));
    expect(result.selectionId).toBe('bar'); expect(result.message).toMatch(/incomplete draft/i);
    expect(music(source).staves[0].measures[0]).toMatchObject({ incomplete: true, voices: [{ events: [], tuplets: [] }] });
    expect(errors(source)).toEqual([]);
  });

  it('preserves inherited meter, staff and bar settings without transferring attached marks', () => {
    const body = '<music-note id="only" pitch="Fqf3" duration="half" dots="2" stem="up" data-note="authored"><music-articulation id="accent" type="accent"></music-articulation><music-ornament id="trill" type="trill"></music-ornament></music-note>';
    const source = root(bar(body, 'bar', 'number="C7" incomplete break-before="page" keep-with-next end-bar="double" repeat-start data-bar="keep"'), 'clef="bass" key="Eb" meter="7/8" groups="2+2+3"');
    const oldBar = source.querySelector('#bar')!, oldStaff = source.querySelector('#staff')!;
    const barAttributes = oldBar.getAttributeNames().map(name => [name, oldBar.getAttribute(name)]);
    const staffHtml = oldStaff.cloneNode(false) as Element;
    remove(source, ['only']);
    expect(source.querySelector('#bar')).toBe(oldBar); expect(source.querySelector('#staff')).toBe(oldStaff);
    expect(oldBar.getAttributeNames().map(name => [name, oldBar.getAttribute(name)])).toEqual(barAttributes);
    expect((oldStaff.cloneNode(false) as Element).outerHTML).toBe(staffHtml.outerHTML);
    expect(events(source)).toEqual([]);
    expect(source.querySelector('#accent, #trill, [data-note]')).toBeNull();
    expect(source.querySelector('music-rest')).toBeNull();
    expect(errors(source)).toEqual([]);
  });

  it('removes an existing sole measure rest and its attached mark without creating another event', () => {
    const source = root(bar('<music-rest id="blank" measure data-authored="keep"><music-articulation id="fermata" type="fermata"></music-articulation></music-rest>'));
    const container = source.querySelector('#bar');
    const result = remove(source, ['blank']);
    expect(source.querySelector('#blank, #fermata, [data-authored], music-rest')).toBeNull();
    expect(source.querySelector('#bar')).toBe(container); expect(events(source)).toEqual([]);
    expect(result.selectionId).toBe('bar'); expect(result.message).toMatch(/removed/i);
    expect(source.querySelector('#bar')?.hasAttribute('incomplete')).toBe(true); expect(errors(source)).toEqual([]);
  });

  it('removes selected full-measure rests and notes equally across bars', () => {
    const source = root(bar('<music-rest id="blank" measure></music-rest>', 'm1') + bar(note('only', 'whole'), 'm2'));
    const result = remove(source, ['blank', 'only']);
    expect(source.querySelector('#blank, #only, music-rest')).toBeNull();
    expect(events(source, 0)).toEqual([]); expect(events(source, 1)).toEqual([]); expect(result.selectionId).toBe('m1');
    expect(music(source).staves[0].measures.map(measure => measure.incomplete)).toEqual([true, true]);
    expect(errors(source)).toEqual([]);
  });

  it('removes only the disjoint set across bars and preserves every unselected event and other voice/staff', () => {
    const source = element(ensemble), b = source.querySelector('#b'), d = source.querySelector('#d'), f = source.querySelector('#f');
    const v2 = source.querySelector('#v2')!, v4 = source.querySelector('#v4')!, bass = source.querySelector('#bass')!;
    const untouched = [v2.outerHTML, v4.outerHTML, bass.outerHTML];
    const result = remove(source, ['e', 'c', 'a']);
    expect(events(source, 0).map(event => event.id)).toEqual(['b', 'd']);
    expect(events(source, 1).map(event => event.id)).toEqual(['f']); expect(result.selectionId).toBe('b');
    expect(source.querySelector('#b')).toBe(b); expect(source.querySelector('#d')).toBe(d); expect(source.querySelector('#f')).toBe(f);
    expect([v2.outerHTML, v4.outerHTML, bass.outerHTML]).toEqual(untouched);
    expect(source.querySelector('#v1 music-rest, #v3 music-rest')).toBeNull();
    expect(music(source).staves[0].measures.map(measure => measure.incomplete)).toEqual([true, true]);
    expect(errors(source)).toEqual([]);
  });

  it('uses the nearest preceding survivor when no following event survives in that voice', () => {
    const source = root(bar(note('a') + note('b') + note('c') + note('d')));
    const result = remove(source, ['d', 'c']);
    expect(result.selectionId).toBe('b'); expect(events(source).map(event => event.id)).toEqual(['a', 'b']);
    expect(source.querySelector('music-rest')).toBeNull();
  });

  it('preserves explicit annotation anchors while sequential instructions follow the removed rhythm', () => {
    const source = root(bar(note('a') + '<music-harmony id="sequential" text="G7"></music-harmony><music-direction id="fixed" text="Cue" at="1/4"></music-direction>' + note('b', 'half', 'dots="1"')));
    const sequential = source.querySelector('#sequential'), fixed = source.querySelector('#fixed');
    remove(source, ['a']);
    expect(source.querySelector('#sequential')).toBe(sequential); expect(source.querySelector('#fixed')).toBe(fixed);
    expect(sequential?.hasAttribute('at')).toBe(false); expect(fixed?.getAttribute('at')).toBe('1/4');
    expect(music(source).staves[0].measures[0].annotations.map(annotation => [annotation.id, annotation.onset])).toEqual([
      ['sequential', rational(0)], ['fixed', rational(1, 4)],
    ]);
    expect(errors(source)).toEqual([]);
  });

  it('unwraps emptied nested tuplets, preserving instruction/comment nodes without replacement rhythm', () => {
    const source = root(bar('<music-voice id="voice"><music-direction id="before" text="Wait"></music-direction><music-tuplet id="outer" actual="2" normal="1"><music-tuplet id="inner" actual="2" normal="1">'
      + note('only', 'whole') + '<!-- keep this cue --><music-direction id="sequential" text="Listen"></music-direction></music-tuplet><music-harmony id="fixed" text="C7" at="1/8"></music-harmony></music-tuplet><music-direction id="after" text="Breathe"></music-direction></music-voice>', 'bar', 'meter="1/4"'));
    const retained = ['voice', 'before', 'sequential', 'fixed', 'after'].map(id => source.querySelector(`#${id}`)!);
    const comment = source.querySelector('#inner')!.childNodes[1];
    expect(errors(source)).toEqual([]);
    const result = remove(source, ['only']);
    expect(source.querySelector('music-tuplet')).toBeNull();
    for (const node of retained) expect(source.querySelector(`#${node.id}`)).toBe(node);
    expect(comment.parentNode).toBe(retained[0]); expect(comment.nodeValue).toBe(' keep this cue ');
    expect(source.querySelector('music-rest')).toBeNull(); expect(events(source)).toEqual([]);
    expect(retained[0].lastElementChild?.id).toBe('after'); expect(result.selectionId).toBe('voice');
    expect(music(source).staves[0].measures[0].annotations.map(annotation => [annotation.id, annotation.onset])).toEqual([
      ['before', rational(0)], ['sequential', rational(0)], ['fixed', rational(1, 8)], ['after', rational(0)],
    ]);
    expect(source.querySelector('#sequential')?.hasAttribute('at')).toBe(false);
    expect(errors(source)).toEqual([]);
  });

  it('keeps a surviving outer tuplet and its exact written value while unwrapping only the emptied inner group', () => {
    const source = root(bar('<music-tuplet id="outer" actual="3" normal="2" bracket="yes"><music-tuplet id="inner" actual="2" normal="1">'
      + note('a', 'eighth') + '<music-direction id="cue" text="Cue"></music-direction>' + note('b', 'eighth')
      + '</music-tuplet>' + note('c', 'eighth') + '</music-tuplet>', 'bar', 'incomplete'));
    const c = events(source)[2], outer = source.querySelector('#outer'), cue = source.querySelector('#cue');
    remove(source, ['b', 'a']);
    expect(source.querySelector('#inner')).toBeNull(); expect(source.querySelector('#outer')).toBe(outer);
    expect(source.querySelector('#cue')).toBe(cue); expect(cue?.parentElement).toBe(outer);
    expect(events(source)[0]).toEqual({ ...c, onset: rational(0) });
    expect(source.querySelector('music-rest')).toBeNull(); expect(errors(source)).toEqual([]);
    expect(readScore(source).diagnostics.some(item => item.code === 'tuplet-span' && item.severity === 'warning')).toBe(true);
  });

  it.each([
    ['empty', []], ['duplicate', ['a', 'a']], ['missing', ['a', 'gone']], ['measure ID', ['a', 'bar']],
    ['attached mark', ['a', 'accent']], ['empty ID', ['a', '']], ['sparse', Object.assign(new Array<string>(2), { 0: 'a' })],
    ['nonstring', ['a', 7]], ['not an array', 'a'],
  ])('rejects an invalid %s set before any source mutation', (_case, eventIds) => {
    const source = root(bar(note('a', 'half') + '<music-note id="b" pitch="D4" duration="half"><music-articulation id="accent" type="accent"></music-articulation></music-note>'));
    const before = source.outerHTML, a = source.querySelector('#a');
    expect(() => remove(source, eventIds as readonly string[])).toThrow(/select|existing|event|distinct/i);
    expect(source.outerHTML).toBe(before); expect(source.querySelector('#a')).toBe(a);
  });

  it.each([['different voice', ['a', 'writer']], ['different staff', ['a', 'bass-rest-2']]])('rejects %s in one set before mutation', (_case, eventIds) => {
    const source = element(ensemble), before = source.outerHTML;
    expect(() => remove(source, eventIds)).toThrow(/same staff and voice/i);
    expect(source.outerHTML).toBe(before);
  });

  it.each([['start'], ['middle'], ['end'], ['start', 'middle', 'end']])('refuses any tied member, including a complete chain: %j', (...tiedIds) => {
    const source = root(bar(note('safe', 'whole'), 'safe-bar') + bar(note('start', 'whole', 'tie="start"'), 'm1')
      + bar(note('middle', 'whole', 'tie="continue"'), 'm2') + bar(note('end', 'whole', 'tie="end"'), 'm3'));
    const before = source.outerHTML;
    expect(() => remove(source, ['safe', ...tiedIds])).toThrow(/Clear connected ties/i);
    expect(source.outerHTML).toBe(before);
  });

  it('rejects emptying a pickup before editing any bar and names the written-rest recovery', () => {
    const source = root(bar(note('pickup', 'quarter', 'dots="1"'), 'upbeat', 'pickup number="0"') + bar(note('safe', 'whole'), 'm1'));
    const before = source.outerHTML;
    expect(() => remove(source, ['safe', 'pickup'])).toThrow(/Lead.*bar 0.*voice 1.*written rest.*value.*dots.*tuplet/i);
    expect(source.outerHTML).toBe(before);
  });

  it('permits partial pickup removal without adding silence or changing the remaining written duration', () => {
    const source = root(bar(note('a', 'eighth') + note('b', 'eighth'), 'bar', 'pickup'));
    remove(source, ['a']);
    expect(events(source).map(event => event.id)).toEqual(['b']); expect(events(source)[0].time).toEqual(rational(1, 8));
    expect(music(source).staves[0].measures[0]).toMatchObject({ pickup: true, incomplete: false });
    expect(source.querySelector('music-rest')).toBeNull(); expect(errors(source)).toEqual([]);
  });

  it.each([['a'], ['c'], ['a', 'c']])('rejects partial legacy boundary removal without silently retiming the survivor: %j', (...boundaryIds) => {
    const source = root(bar(note('a', 'eighth', 'triplet="start"') + note('b', 'eighth') + note('c', 'eighth', 'triplet="end"') + note('safe', 'half', 'dots="1"')));
    const before = source.outerHTML;
    expect(() => remove(source, ['safe', ...boundaryIds])).toThrow(/legacy.*triplet|music-tuplet/i);
    expect(source.outerHTML).toBe(before); expect(events(source)[1].time).toEqual(rational(1, 12));
  });

  it.each([['interior', ['b']], ['complete group', ['a', 'b', 'c']]])('permits legacy triplet %s removal while preserving surviving values', (_case, eventIds) => {
    const source = root(bar(note('a', 'eighth', 'triplet="start"') + note('b', 'eighth') + note('c', 'eighth', 'triplet="end"') + note('safe', 'half', 'dots="1"')));
    remove(source, eventIds as string[]);
    for (const id of eventIds) expect(source.querySelector(`#${id}`)).toBeNull();
    expect(events(source).at(-1)).toMatchObject({ id: 'safe', time: rational(3, 4), duration: 'half', dots: 1 });
    if (eventIds.length === 1) expect(events(source).slice(0, 2).map(event => event.time)).toEqual([rational(1, 12), rational(1, 12)]);
    else expect(music(source).staves[0].measures[0].voices[0].tuplets).toEqual([]);
    expect(errors(source)).toEqual([]);
  });

  it('accepts current reader event IDs on a direct source tree without authored IDs', () => {
    const source = element('<music-staff><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
    const original = events(source)[0].id;
    const measureId = music(source).staves[0].measures[0].id;
    const result = remove(source, [original]);
    expect(events(source)).toEqual([]); expect(result.selectionId).toBe(measureId);
    expect(source.querySelector('music-note, music-rest')).toBeNull();
    expect(errors(source)).toEqual([]);
  });
});

describe('atomic removal session history', () => {
  it('deletes the exact disjoint multibar selection in one transaction and restores full selection and writing with one Undo', () => {
    const editor = session(ensemble); editor.setCursor(writing); choose(editor, ['a', 'c', 'e'], 'c', 'd');
    const selected = semantic(editor.selection), before = editor.project, revision = editor.revision;
    const changes: string[] = []; editor.addEventListener('change', event => changes.push((event as CustomEvent).detail.kind));
    editor.execute({ type: 'remove-events', eventIds: ['e', 'a', 'c'] });
    const accepted = editor.project.sourceHtml, afterSelection = semantic(editor.selection);
    expect(editor.revision).toBe(revision + 1); expect(changes).toEqual(['edit']); expect(editor.canUndo).toBe(true);
    expect(editor.selection.ids).toEqual(['b']); expect(editor.selectionId).toBe('b'); expect(editor.cursor).toEqual(writing);
    expect(editor.source.querySelector('#a, #c, #e')).toBeNull(); expect(editor.source.querySelector('#d, #f')).not.toBeNull();
    editor.undo();
    expect(editor.project.sourceHtml).toBe(before.sourceHtml); expect(semantic(editor.selection)).toEqual(selected);
    expect(editor.cursor).toEqual(writing); expect(editor.canUndo).toBe(false); expect(editor.canRedo).toBe(true);
    editor.redo();
    expect(editor.project.sourceHtml).toBe(accepted); expect(semantic(editor.selection)).toEqual(afterSelection); expect(editor.cursor).toEqual(writing);
    expect(changes).toEqual(['edit', 'history', 'history']);
  });

  it('inspects the empty voice container while preserving measure-only writing in voice two', () => {
    const editor = session(ensemble); const parked = { ...writing }; delete parked.eventId;
    editor.setCursor(parked); choose(editor, ['a', 'b', 'c', 'd'], 'c');
    const before = editor.project.sourceHtml, selected = semantic(editor.selection);
    const result = editor.execute({ type: 'remove-events', eventIds: ['a', 'b', 'c', 'd'] });
    expect(editor.score.staves[0].measures[0].voices[0].events).toEqual([]);
    expect(result.selectionId).toBe('v1'); expect(editor.selection).toMatchObject({ ids: [], sourceId: 'v1' });
    expect(editor.selectionId).toBe(editor.score.staves[0].measures[0].voices[0].id);
    expect(editor.cursor).toEqual(parked); expect(editor.source.querySelector('#v1 music-rest')).toBeNull();
    editor.undo(); expect(editor.project.sourceHtml).toBe(before); expect(semantic(editor.selection)).toEqual(selected); expect(editor.cursor).toEqual(parked);
    editor.redo(); expect(editor.selection.sourceId).toBe('v1'); expect(editor.selection.ids).toEqual([]); expect(editor.cursor).toEqual(parked);
  });

  it('does not retarget a deleted writing event and restores that exact cursor on Undo', () => {
    const editor = session(ensemble), parked: Cursor = { staffId: 'staff', measureId: 'm1', voiceIndex: 0, eventId: 'a' };
    editor.setCursor(parked); choose(editor, ['a']);
    editor.execute({ type: 'remove-events', eventIds: ['a'] });
    expect(editor.selectionId).toBe('b'); expect(editor.cursor).toBeUndefined();
    editor.undo(); expect(editor.cursor).toEqual(parked); expect(editor.selection.ids).toEqual(['a']);
    editor.redo(); expect(editor.cursor).toBeUndefined();
  });

  it('empties voice two across multiple bars with one Undo, preserving containers, voice one and other staves', () => {
    const editor = session(ensemble.replace('<music-rest id="other-rest" measure></music-rest>', note('writer-next', 'whole')));
    const parked: Cursor = { staffId: 'staff', measureId: 'm2', voiceIndex: 0, eventId: 'f' };
    editor.setCursor(parked); choose(editor, ['writer', 'writer-next'], 'writer-next');
    const before = editor.project.sourceHtml, selected = semantic(editor.selection), originalIds = ids(editor.source);
    const untouched = ['v1', 'v3', 'bass'].map(id => editor.source.querySelector(`#${id}`)!);
    const html = untouched.map(node => node.outerHTML);
    editor.execute({ type: 'remove-events', eventIds: ['writer-next', 'writer'] });
    expect(editor.score.staves[0].measures.map(measure => measure.voices[1].events)).toEqual([[], []]);
    expect(editor.score.staves[0].measures.map(measure => measure.voices[1].id)).toEqual(['v2', 'v4']);
    expect(ids(editor.source)).toEqual(originalIds.filter(id => !['writer', 'writer-next'].includes(id)));
    expect(editor.selection).toMatchObject({ ids: [], sourceId: 'v2' });
    expect(editor.selectionId).toBe(editor.score.staves[0].measures[0].voices[1].id);
    expect(editor.cursor).toEqual(parked);
    untouched.forEach((node, index) => {
      expect(editor.source.querySelector(`#${node.id}`)).toBe(node); expect(node.outerHTML).toBe(html[index]);
    });
    editor.undo(); expect(editor.project.sourceHtml).toBe(before); expect(semantic(editor.selection)).toEqual(selected);
    expect(editor.cursor).toEqual(parked); expect(editor.canUndo).toBe(false);
    editor.redo(); expect(editor.score.staves[0].measures.map(measure => measure.voices[1].events)).toEqual([[], []]);
    expect(editor.cursor).toEqual(parked);
  });

  it('keeps surviving exact membership instead of replacing it with the command fallback', () => {
    const editor = session(ensemble); editor.setCursor(writing); choose(editor, ['a', 'c', 'e'], 'c');
    editor.execute({ type: 'remove-events', eventIds: ['a', 'c'] });
    expect(editor.selection.ids).toEqual(['e']); expect(editor.selectionId).toBe('e'); expect(editor.cursor).toEqual(writing);
  });

  it('treats deleting a sole full-measure rest as a real edit and restores its exact identity, selection and cursor on Undo', () => {
    const editor = session(system(staff(bar('<music-rest id="blank" measure></music-rest>'))));
    editor.update('Title', draft => { draft.metadata.title = 'Another title'; }); editor.undo();
    const cursor: Cursor = { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'blank' };
    editor.setCursor(cursor); choose(editor, ['blank']);
    const before = editor.project, selected = semantic(editor.selection), revision = editor.revision;
    const changes: Event[] = []; editor.addEventListener('change', event => changes.push(event));
    editor.execute({ type: 'remove-events', eventIds: ['blank'] });
    expect(editor.source.querySelector('#blank, music-rest')).toBeNull(); expect(editor.score.staves[0].measures[0].voices[0].events).toEqual([]);
    expect(editor.selection).toMatchObject({ ids: [], sourceId: 'bar' }); expect(editor.selectionId).toBe('bar'); expect(editor.cursor).toBeUndefined();
    expect(editor.revision).toBe(revision + 1); expect(editor.canUndo).toBe(true); expect(editor.canRedo).toBe(false); expect(changes).toHaveLength(1);
    editor.undo(); expect(editor.project.sourceHtml).toBe(before.sourceHtml); expect(semantic(editor.selection)).toEqual(selected);
    expect(editor.cursor).toEqual(cursor); expect(editor.canUndo).toBe(false);
    editor.redo(); expect(editor.source.querySelector('#blank, music-rest')).toBeNull(); expect(editor.cursor).toBeUndefined();
  });

  it('preserves surviving instruction scopes and keyed instruction nodes through deletion and history', () => {
    const project = createProject(ensemble, 'Scoped instructions'); project.instructionScopes.instruction = 'all';
    const editor = new EditorSession(project); choose(editor, ['a', 'b', 'c', 'd']);
    const instruction = editor.source.querySelector('#instruction');
    editor.execute({ type: 'remove-events', eventIds: ['a', 'b', 'c', 'd'] });
    expect(editor.project.instructionScopes).toEqual({ instruction: 'all' }); expect(editor.source.querySelector('#instruction')).toBe(instruction);
    editor.undo(); expect(editor.source.querySelector('#instruction')).toBe(instruction); expect(editor.project.instructionScopes).toEqual({ instruction: 'all' });
    editor.redo(); expect(editor.source.querySelector('#instruction')).toBe(instruction);
  });

  it.each([
    ['missing member', bar(note('a', 'half') + note('b', 'half')), ['a', 'gone'], /existing/i],
    ['duplicate member', bar(note('a', 'half') + note('b', 'half')), ['a', 'a'], /distinct/i],
    ['tied member', bar(note('a', 'half', 'tie="start"') + note('b', 'half', 'tie="end"')), ['a', 'b'], /Clear connected ties/i],
    ['empty pickup', bar(note('a'), 'bar', 'pickup'), ['a'], /written rest/i],
    ['beam boundary', bar(note('safe', 'whole'), 'safe-bar') + bar(note('a', 'eighth', 'beam="start"') + note('b', 'eighth', 'beam="end"') + note('tail', 'half', 'dots="1"')), ['safe', 'a'], /beam/i],
    ['pickup voice mismatch', bar(`<music-voice id="v1">${note('a', 'eighth')}${note('b', 'eighth')}</music-voice><music-voice id="v2">${note('c')}</music-voice>`, 'bar', 'pickup'), ['a'], /pickup/i],
    ['fixed pickup instruction beyond new end', bar(note('a') + note('b') + '<music-direction id="cue" text="Wait" at="3/8"></music-direction>', 'bar', 'pickup'), ['a'], /annotation|beyond|outside/i],
  ])('rejects %s without accepted changes, lost cursor/selection or a cleared Redo branch', (_case, body, eventIds, message) => {
    const editor = session(system(staff(body as string)));
    editor.update('Title', draft => { draft.metadata.title = 'Another title'; }); editor.undo();
    choose(editor, ['a']); editor.setCursor({ staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'a' });
    const before = editor.project, selected = editor.selection, cursor = editor.cursor, revision = editor.revision, accepted = editor.source;
    const changes: Event[] = []; editor.addEventListener('change', event => changes.push(event));
    expect(() => editor.execute({ type: 'remove-events', eventIds: eventIds as string[] })).toThrow(message as RegExp);
    expect(editor.project).toEqual(before); expect(editor.source).toBe(accepted); expect(editor.selection).toEqual(selected);
    expect(editor.cursor).toEqual(cursor); expect(editor.revision).toBe(revision); expect(changes).toEqual([]);
    expect(editor.canUndo).toBe(false); expect(editor.canRedo).toBe(true);
  });

  it('retains explicit beam validation without inventing repair attributes', () => {
    const editor = session(system(staff(bar(note('a', 'eighth', 'beam="start"') + note('b', 'eighth', 'beam="continue"')
      + note('c', 'eighth', 'beam="end"') + note('tail', 'half', 'dots="1"'), 'bar', 'meter="9/8"'))));
    expect(() => editor.execute({ type: 'remove-events', eventIds: ['a'] })).toThrow(EditorValidationError);
    const beforeA = editor.source.querySelector('#a'), beforeC = editor.source.querySelector('#c');
    editor.execute({ type: 'remove-events', eventIds: ['b'] });
    expect(editor.source.querySelector('#a')).toBe(beforeA); expect(editor.source.querySelector('#c')).toBe(beforeC);
    expect(editor.source.querySelector('#a')?.getAttribute('beam')).toBe('start'); expect(editor.source.querySelector('#c')?.getAttribute('beam')).toBe('end');
    expect(editor.diagnostics.some(item => item.severity === 'error')).toBe(false);
  });

  it('rejects an old set after Source removes an ID instead of deleting its replacement or the remaining member', () => {
    const editor = session(ensemble); choose(editor, ['a', 'c']);
    editor.applySource(editor.project.sourceHtml.replace('id="a"', 'id="replacement"'));
    const before = editor.project, selected = editor.selection, revision = editor.revision;
    expect(() => editor.execute({ type: 'remove-events', eventIds: ['a', 'c'] })).toThrow(/existing/i);
    expect(editor.project).toEqual(before); expect(editor.selection).toEqual(selected); expect(editor.revision).toBe(revision);
    expect(editor.source.querySelector('#replacement')).not.toBeNull(); expect(editor.source.querySelector('#c')).not.toBeNull();
  });
});

describe('explicit entry after emptying an ordinary voice', () => {
  it('starts a new event in the exact emptied second voice without moving other music and keeps separate Undo steps', () => {
    const editor = session(ensemble), original = editor.project.sourceHtml;
    const parked: Cursor = { staffId: 'staff', measureId: 'm2', voiceIndex: 0, eventId: 'f' };
    editor.setCursor(parked); choose(editor, ['writer']);
    const voiceOne = editor.source.querySelector('#v1')!, unchanged = voiceOne.outerHTML;
    editor.execute({ type: 'remove-events', eventIds: ['writer'] });
    expect(editor.selection).toMatchObject({ ids: [], sourceId: 'v2' });
    expect(editor.selectionId).toBe(editor.score.staves[0].measures[0].voices[1].id);
    expect(editor.score.staves[0].measures[0].voices[1].events).toEqual([]); expect(editor.cursor).toEqual(parked);
    const blank = editor.project.sourceHtml;
    const cursor: Cursor = { staffId: 'staff', measureId: 'm1', voiceIndex: 1 };
    editor.setCursor(cursor);
    const inserted = editor.execute({ type: 'insert-event', cursor, position: 'after', value: input });
    expect(editor.source.querySelector(`#${inserted.selectionId}`)?.parentElement?.id).toBe('v2');
    expect(inserted.selectionId).not.toBe('writer'); expect(editor.selection.ids).toEqual([inserted.selectionId]);
    expect(editor.cursor).toEqual({ ...cursor, eventId: inserted.selectionId });
    expect(editor.source.querySelector('#v1')).toBe(voiceOne); expect(voiceOne.outerHTML).toBe(unchanged);
    editor.undo(); expect(editor.project.sourceHtml).toBe(blank); expect(editor.selection.sourceId).toBe('v2'); expect(editor.cursor).toEqual(cursor);
    editor.undo(); expect(editor.project.sourceHtml).toBe(original); expect(editor.selection.ids).toEqual(['writer']); expect(editor.cursor).toEqual(parked);
  });

  it.each(['before', 'after'] as const)('allows the author to insert an explicit full-measure rest %s into the empty voice', position => {
    const editor = session(ensemble); editor.setCursor(writing); choose(editor, ['a', 'b', 'c', 'd']);
    editor.execute({ type: 'remove-events', eventIds: ['a', 'b', 'c', 'd'] });
    expect(editor.score.staves[0].measures[0].voices[0].events).toEqual([]);
    const blank = editor.project.sourceHtml;
    const result = editor.execute({ type: 'insert-event', cursor: { staffId: 'staff', measureId: 'm1', voiceIndex: 0 },
      position, value: { ...input, kind: 'rest', duration: 'whole', measureRest: true } });
    expect(editor.score.staves[0].measures[0].voices[0].events).toEqual([
      expect.objectContaining({ id: result.selectionId, kind: 'rest', measureRest: true, time: rational(1), tupletIds: [] }),
    ]);
    expect(editor.source.querySelector(`#${result.selectionId}`)?.parentElement?.id).toBe('v1');
    editor.undo(); expect(editor.project.sourceHtml).toBe(blank); expect(editor.cursor).toEqual(writing);
    expect(editor.selection.sourceId).toBe('v1');
  });

  it('fills an empty voice only on an explicit Fill command, with exact time and a reversible blank state', () => {
    const editor = session(ensemble); editor.setCursor(writing); choose(editor, ['a', 'b', 'c', 'd']);
    editor.execute({ type: 'remove-events', eventIds: ['a', 'b', 'c', 'd'] });
    const blank = editor.project.sourceHtml;
    expect(editor.score.staves[0].measures[0].voices[0].events).toEqual([]);
    editor.execute({ type: 'fill-rests', measureId: 'm1', voiceIndex: 0 });
    const measure = editor.score.staves[0].measures[0], rests = measure.voices[0].events;
    expect(rests.length).toBeGreaterThan(0); expect(rests.every(event => event.kind === 'rest' && !event.measureRest)).toBe(true);
    expect(rests.reduce((total, event) => add(total, event.time), rational(0))).toEqual(rational(1));
    expect(measure.incomplete).toBe(false); expect(editor.cursor).toEqual(writing);
    editor.undo(); expect(editor.project.sourceHtml).toBe(blank); expect(editor.selection.sourceId).toBe('v1'); expect(editor.cursor).toEqual(writing);
  });

  it('does not pretend an empty voice has an event to Replace', () => {
    const editor = session(ensemble); editor.setCursor(writing); choose(editor, ['a', 'b', 'c', 'd']);
    editor.execute({ type: 'remove-events', eventIds: ['a', 'b', 'c', 'd'] });
    const blank = editor.project.sourceHtml, revision = editor.revision, selected = editor.selection;
    expect(() => editor.execute({ type: 'insert-event', cursor: { staffId: 'staff', measureId: 'm1', voiceIndex: 0 },
      position: 'replace', value: input })).toThrow('This voice is empty. In Next entry → Position, choose Before or After to start writing. Replace needs an existing event.');
    expect(editor.project.sourceHtml).toBe(blank); expect(editor.selection).toEqual(selected); expect(editor.cursor).toEqual(writing);
    expect(editor.revision).toBe(revision); expect(editor.canUndo).toBe(true);
  });
});
