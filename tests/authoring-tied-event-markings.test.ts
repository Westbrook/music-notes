// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { readScore } from '../src/dom/index.js';
import { EditorSession } from '../src/authoring/editor.js';
import { applyRoadTieIntervalEdits, EventMarkingCompatibilityError, inspectRoadTieChain } from '../src/authoring/event-markings-commands.js';
import type { RoadTieChainInspection } from '../src/authoring/event-markings-commands.js';
import { createProject } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';
import type { AuthorCommand, EventInput, EventMarkingEdit, EventMarkingInput } from '../src/authoring/types.js';
import { harmonyIntervalText } from '../src/model/index.js';
import type { IntervalMarking, MusicEvent, Score } from '../src/model/types.js';

type ScopedCommand = Extract<AuthorCommand, { type: 'edit-event-markings' }> & { intervalScope?: 'tie-chain' };
const chainIds = ['r1', 'r2', 'r3'];
const interval = (id: string, value: string, placement = 'above') =>
  `<music-interval id="${id}" value="${value}" placement="${placement}" data-user="${id}"><!-- ${id} inside --></music-interval>`;
function attached(id: string): string {
  const alias = id === 'r1' ? '♭3' : id === 'r3' ? ' b3 ' : 'b3';
  const first = interval(`${id}-a`, alias);
  const second = interval(`${id}-b`, 'b3', 'below');
  const third = interval(`${id}-c`, id === 'r1' ? '♯11' : '#11');
  const accent = `<music-articulation id="${id}-art" type="${id === 'r2' ? 'tenuto' : 'accent'}" placement="auto" data-user="local"><!-- articulation --></music-articulation>`;
  const ornament = `<music-ornament id="${id}-orn" type="${id === 'r3' ? 'turn' : 'trill'}" data-user="local"></music-ornament>`;
  return `<!-- ${id} before -->${id === 'r3' ? second + accent + third + ornament + first : first + accent + second + ornament + third}<!-- ${id} after -->`;
}
const road = (id: string, tie: string, duration: string, direction: string) =>
  `<music-road id="${id}" direction="${direction}" duration="${duration}" dots="0" stem="${id === 'r2' ? 'down' : 'auto'}" beam="none" ${tie ? `tie="${tie}"` : ''} data-owner="${id}">${attached(id)}</music-road>`;
const source = `<!-- document before -->
<music-system id="score" bracket="bracket" data-user="score">
 <music-staff id="roads" notation="three-roads" label="Lead">
  <music-measure id="m1" number="A"><music-direction id="cue" text="Choose a starting pitch" at="0"></music-direction>
   <music-voice id="v1">${road('r1', 'start', 'whole', 'higher')}</music-voice>
   <music-voice id="p1">${road('parallel1', 'start', 'whole', 'lower')}</music-voice>
  </music-measure>
  <music-measure id="m2" number="B" break-before="line">
   <music-voice id="v2">${road('r2', 'continue', 'half', 'same')}${road('r3', 'end', 'half', 'same')}</music-voice>
   <music-voice id="p2">${road('parallel2', 'end', 'whole', 'same')}</music-voice>
  </music-measure>
  <music-measure id="m3" number="C">
   <music-voice id="v3">${road('r4', '', 'whole', 'lower')}</music-voice>
   <music-voice id="p3">${road('parallel3', '', 'whole', 'higher')}</music-voice>
  </music-measure>
 </music-staff>
 <music-staff id="hidden" label="Piano"><music-measure id="h1"><music-rest id="rest1" measure></music-rest></music-measure><music-measure id="h2"><music-rest id="rest2" measure></music-rest></music-measure><music-measure id="h3"><music-rest id="rest3" measure></music-rest></music-measure></music-staff>
</music-system>
<!-- document after -->`;

function fixture(html = source): EditorSession {
  const project = createProject(html, 'Sustained harmony', [
    { id: 'lead-part', label: 'Lead', staffIds: ['roads'] }, { id: 'piano-part', label: 'Piano', staffIds: ['hidden'] },
  ]);
  project.metadata.composer = 'Composer'; project.metadata.subtitle = 'Keep every written segment';
  project.instructionScopes.cue = 'all';
  for (const profile of Object.values(project.layouts)) {
    profile.breaks[project.columns[1].id] = 'page';
    profile.keeps[project.columns[0].id] = true;
    profile.reviewedTurns[project.columns[1].id] = 'reviewed fixture boundary';
  }
  const session = new EditorSession(project); session.select('r2');
  return session;
}

function events(session: EditorSession): MusicEvent[] {
  return session.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
}
function event(session: EditorSession, id: string): MusicEvent { return events(session).find(item => item.id === id)!; }
function intervals(session: EditorSession, id: string): IntervalMarking[] {
  return (event(session, id).markings ?? []).filter((marking): marking is IntervalMarking => marking.kind === 'interval');
}
function keys(session: EditorSession, id: string): string[] {
  return intervals(session, id).map(marking => `${harmonyIntervalText(marking.interval)}:${marking.placement}`).sort();
}
function command(edits: readonly EventMarkingEdit[], eventId = 'r2'): ScopedCommand {
  return { type: 'edit-event-markings', eventId, intervalScope: 'tie-chain', edits };
}
function attrs(node: Element): Record<string, string> { return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])); }
function sourceData(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html;
  for (const node of template.content.querySelectorAll('*')) {
    const entries = Object.entries(attrs(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    for (const [name, value] of entries) node.setAttribute(name, value);
  }
  return template.innerHTML;
}
function expectRejected(session: EditorSession, value: AuthorCommand): unknown {
  const before = session.project; const root = session.source; const nodes = [...root.querySelectorAll('*')];
  const revision = session.revision; const selection = session.selectionId; const cursor = session.cursor;
  const undo = session.canUndo; const redo = session.canRedo;
  let failure: unknown;
  try { session.execute(value); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error); expect(session.project).toEqual(before);
  expect(session.source).toBe(root); expect([...root.querySelectorAll('*')]).toEqual(nodes);
  nodes.forEach((node, index) => expect(root.querySelectorAll('*')[index]).toBe(node));
  expect(session.revision).toBe(revision); expect(session.selectionId).toBe(selection); expect(session.cursor).toEqual(cursor);
  expect(session.canUndo).toBe(undo); expect(session.canRedo).toBe(redo);
  return failure;
}

describe('AUTHOR-TIED-INTERVALS command contract', () => {
  it.each(chainIds)('adds one semantic interval to the complete chain from %s without touching other voices or later attacks', selected => {
    const session = fixture(); session.select(selected);
    const before = new Map(events(session).map(value => [value.id, { ...value, markings: undefined }]));
    const otherNodes = ['parallel1', 'parallel2', 'parallel3', 'r4', 'hidden'].map(id => session.source.querySelector(`#${id}`)!);
    const otherHtml = otherNodes.map(node => node.outerHTML);
    const owners = chainIds.map(id => session.source.querySelector(`#${id}`)!);
    const oldChildren = owners.map(owner => [...owner.childNodes]); const oldAttrs = owners.map(attrs);
    const result = session.execute(command([{ type: 'add', value: { kind: 'interval', value: '13', placement: 'below' } }], selected));
    expect(result.selectionId).toBe(selected); expect(session.selectionId).toBe(selected);
    for (const [index, id] of chainIds.entries()) {
      expect(keys(session, id)).toEqual(['#11:above', '13:below', 'b3:above', 'b3:below']);
      expect(attrs(owners[index])).toEqual(oldAttrs[index]);
      oldChildren[index].forEach((child, childIndex) => expect(owners[index].childNodes[childIndex]).toBe(child));
      expect({ ...event(session, id), markings: undefined }).toEqual(before.get(id));
    }
    expect(otherNodes.map(node => node.outerHTML)).toEqual(otherHtml);
    expect(new Set(chainIds.flatMap(id => intervals(session, id).filter(mark => harmonyIntervalText(mark.interval) === '13').map(mark => mark.id))).size).toBe(3);
    expect(session.revision).toBe(1); expect(session.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  });

  it('updates the accepted figure and side, retaining child IDs, comments, raw untouched aliases, and source order', () => {
    const session = fixture();
    const nodes = chainIds.map(id => session.source.querySelector(`#${id}-a`)!);
    const comments = nodes.map(node => node.innerHTML);
    const childOrder = chainIds.map(id => [...session.source.querySelector(`#${id}`)!.children].map(node => node.id));
    const oppositeSide = chainIds.map(id => session.source.querySelector(`#${id}-b`)!.outerHTML);
    session.execute(command([{ type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '5', placement: 'below' }, fields: ['value'] }]));
    chainIds.forEach((id, index) => {
      expect(session.source.querySelector(`#${id}-a`)).toBe(nodes[index]);
      expect(nodes[index].getAttribute('value')).toBe('5'); expect(nodes[index].getAttribute('placement')).toBe('above');
      expect(nodes[index].getAttribute('data-user')).toBe(`${id}-a`); expect(nodes[index].innerHTML).toBe(comments[index]);
      expect([...session.source.querySelector(`#${id}`)!.children].map(node => node.id)).toEqual(childOrder[index]);
      expect(session.source.querySelector(`#${id}-b`)!.outerHTML).toBe(oppositeSide[index]);
    });
    expect(session.source.querySelector('#r1-c')?.getAttribute('value')).toBe('♯11');
  });

  it('changes interval placement without consuming an unfinished value field or normalizing its literal figure', () => {
    const session = fixture(); const spellings = chainIds.map(id => session.source.querySelector(`#${id}-c`)!.getAttribute('value'));
    session.execute(command([{ type: 'update', markingId: 'r2-c', value: { kind: 'interval', value: 'unfinished text', placement: 'below' }, fields: ['placement'] }]));
    chainIds.forEach((id, index) => {
      expect(session.source.querySelector(`#${id}-c`)!.getAttribute('placement')).toBe('below');
      expect(session.source.querySelector(`#${id}-c`)!.getAttribute('value')).toBe(spellings[index]);
    });
  });

  it('removes only the accepted figure on its stated side across the chain', () => {
    const session = fixture(); session.execute(command([{ type: 'remove', markingId: 'r2-a' }]));
    for (const id of chainIds) {
      expect(session.source.querySelector(`#${id}-a`)).toBeNull(); expect(session.source.querySelector(`#${id}-b`)).not.toBeNull();
      expect(keys(session, id)).toEqual(['#11:above', 'b3:below']);
    }
    expect(session.source.querySelector('#parallel1-a')).not.toBeNull();
  });

  it('applies simultaneous interval changes but keeps articulation and ornament changes on the selected segment', () => {
    const session = fixture(); const untouched = ['r1-art', 'r1-orn', 'r3-art', 'r3-orn'].map(id => session.source.querySelector(`#${id}`)!.outerHTML);
    session.execute(command([
      { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '5', placement: 'above' } },
      { type: 'remove', markingId: 'r2-b' }, { type: 'add', value: { kind: 'interval', value: '#9', placement: 'below' } },
      { type: 'update', markingId: 'r2-art', value: { kind: 'articulation', type: 'staccato', placement: 'auto' }, fields: ['type'] },
      { type: 'remove', markingId: 'r2-orn' }, { type: 'add', value: { kind: 'ornament', type: 'lower-mordent', placement: 'below' } },
    ]));
    for (const id of chainIds) expect(keys(session, id)).toEqual(['#11:above', '#9:below', '5:above']);
    expect(['r1-art', 'r1-orn', 'r3-art', 'r3-orn'].map(id => session.source.querySelector(`#${id}`)!.outerHTML)).toEqual(untouched);
    expect(session.source.querySelector('#r2-art')?.getAttribute('type')).toBe('staccato');
    expect(session.source.querySelector('#r2-orn')).toBeNull();
    expect((event(session, 'r2').markings ?? []).filter(mark => mark.kind === 'ornament')).toHaveLength(1);
    expect(session.revision).toBe(1);
  });

  it('commits once, clears relevant page-turn reviews, and restores source, layout reviews, and cursor in one Undo', () => {
    const session = fixture(); const before = session.project; const beforeCursor = session.cursor;
    const owner = session.source.querySelector('#r2')!;
    session.execute(command([{ type: 'add', value: { kind: 'interval', value: '#9', placement: 'above' } }]));
    const after = session.project; const addedIds = chainIds.map(id => intervals(session, id).find(mark => harmonyIntervalText(mark.interval) === '#9')!.id);
    expect(session.revision).toBe(1); expect(session.canUndo).toBe(true);
    expect(after.metadata).toEqual(before.metadata); expect(after.parts).toEqual(before.parts); expect(after.columns).toEqual(before.columns); expect(after.instructionScopes).toEqual(before.instructionScopes);
    for (const [id, profile] of Object.entries(after.layouts)) {
      expect(profile.reviewedTurns).toEqual({}); expect({ ...profile, reviewedTurns: before.layouts[id].reviewedTurns }).toEqual(before.layouts[id]);
    }
    const part = buildProjection(after, 'lead-part'); expect(part.source.querySelectorAll('music-interval')).toHaveLength(24);
    expect(buildProjection(after, 'piano-part').source.querySelector('music-interval')).toBeNull();
    session.undo();
    expect(sourceData(session.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(session.project.layouts).toEqual(before.layouts); expect(session.cursor).toEqual(beforeCursor); expect(session.selectionId).toBe('r2');
    expect(session.source.querySelector('#r2')).toBe(owner); expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(true);
    session.redo(); expect(chainIds.map(id => intervals(session, id).find(mark => harmonyIntervalText(mark.interval) === '#9')!.id)).toEqual(addedIds);
  });

  it.each(['alias', 'empty-fields', 'swap', 'remove-and-add'] as const)('keeps an unchanged interval set literal and preserves Redo for %s', kind => {
    const session = fixture(); session.execute({ type: 'add-event-marking', eventId: 'r2', value: { kind: 'articulation', type: 'fermata', placement: 'above' } }); session.undo(); session.select('r2');
    const edits: EventMarkingEdit[] = kind === 'alias'
      ? [{ type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '♭3', placement: 'above' } }]
      : kind === 'empty-fields' ? [{ type: 'update', markingId: 'r2-a', value: { kind: 'ornament', type: 'unfinished', placement: 'auto' } as unknown as EventMarkingInput, fields: [] }]
        : kind === 'swap' ? [
          { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#11', placement: 'above' } },
          { type: 'update', markingId: 'r2-c', value: { kind: 'interval', value: 'b3', placement: 'above' } },
        ] : [{ type: 'remove', markingId: 'r2-a' }, { type: 'add', value: { kind: 'interval', value: '♭3', placement: 'above' } }];
    const before = session.project; const revision = session.revision; const nodes = [...session.source.querySelectorAll('*')];
    session.execute(command(edits));
    expect(session.project).toEqual(before); expect(session.revision).toBe(revision); expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(true);
    [...session.source.querySelectorAll('*')].forEach((node, index) => expect(node).toBe(nodes[index]));
  });

  it('keeps a final matching interval node when its semantic figure is still requested by a different row', () => {
    const session = fixture(); const oldMatches = chainIds.map(id => session.source.querySelector(`#${id}-c`)!);
    const reused = chainIds.map(id => session.source.querySelector(`#${id}-a`)!);
    const contents = reused.map(node => node.innerHTML);
    session.execute(command([
      { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#11', placement: 'above' } },
      { type: 'update', markingId: 'r2-c', value: { kind: 'interval', value: '13', placement: 'above' } },
    ]));
    chainIds.forEach((id, index) => {
      expect(session.source.querySelector(`#${id}-c`)).toBe(oldMatches[index]); expect(oldMatches[index].getAttribute('value')).toBe(id === 'r1' ? '♯11' : '#11');
      expect(session.source.querySelector(`#${id}-a`)).toBe(reused[index]); expect(reused[index].getAttribute('value')).toBe('13');
      expect(reused[index].innerHTML).toBe(contents[index]);
      expect(keys(session, id)).toEqual(['#11:above', '13:above', 'b3:below']);
    });
  });

  it('does not collapse enharmonic figures, compound intervals, or opposing unison directions', () => {
    const session = fixture();
    session.execute(command(['#4', 'b5', '6', '13', '1'].map<EventMarkingEdit>(value => ({ type: 'add', value: { kind: 'interval', value, placement: 'above' } }))
      .concat([{ type: 'add', value: { kind: 'interval', value: '1', placement: 'below' } }])));
    for (const id of chainIds) expect(keys(session, id)).toEqual(['#11:above', '#4:above', '13:above', '1:above', '1:below', '6:above', 'b3:above', 'b3:below', 'b5:above']);
  });

  it.each<EventMarkingEdit>([
    { type: 'add', value: { kind: 'interval', value: '14', placement: 'above' } },
    { type: 'add', value: { kind: 'interval', value: 'b1', placement: 'above' } },
    { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '5', placement: 'auto' } as unknown as EventMarkingInput },
    { type: 'update', markingId: 'r2-a', value: { kind: 'ornament', type: 'trill', placement: 'above' }, fields: ['placement'] },
    { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '5', placement: 'above' }, fields: ['type'] },
    { type: 'remove', markingId: 'r1-a' }, { type: 'remove', markingId: 'missing' },
  ])('rejects stale ownership or invalid interval input without touching any source or reviews ($type)', invalid => {
    const session = fixture(); expectRejected(session, command([
      { type: 'update', markingId: 'r2-art', value: { kind: 'articulation', type: 'fermata', placement: 'above' } }, invalid,
    ]));
  });

  it('validates the final complete score and rolls back every chain edit when a local marking is invalid', () => {
    const session = fixture(); expectRejected(session, command([
      { type: 'add', value: { kind: 'interval', value: '13', placement: 'above' } },
      { type: 'add', value: { kind: 'articulation', type: 'tenuto', placement: 'below' } },
    ]));
  });

  it('rejects duplicate final semantic figures and repeated edits instead of silently dropping either intent', () => {
    const session = fixture();
    expectRejected(session, command([{ type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#11', placement: 'above' } }]));
    expectRejected(session, command([{ type: 'add', value: { kind: 'interval', value: 'b3', placement: 'above' } }]));
    expectRejected(session, command([{ type: 'remove', markingId: 'r2-a' }, { type: 'remove', markingId: 'r2-a' }]));
  });

  it('retains ordinary one-owner behavior when explicit chain scope is omitted', () => {
    const session = fixture();
    expectRejected(session, { type: 'edit-event-markings', eventId: 'r2', edits: [{ type: 'add', value: { kind: 'interval', value: '13', placement: 'above' } }] });
    session.execute({ type: 'edit-event-markings', eventId: 'r2', edits: [{ type: 'add', value: { kind: 'articulation', type: 'fermata', placement: 'above' } }] });
    expect((event(session, 'r2').markings ?? []).some(mark => mark.kind === 'articulation' && mark.type === 'fermata')).toBe(true);
    expect((event(session, 'r1').markings ?? []).some(mark => mark.kind === 'articulation' && mark.type === 'fermata')).toBe(false);
  });

  it('accepts explicit chain scope for an untied road as exactly one event', () => {
    const session = fixture(); const originalChains = chainIds.map(id => session.source.querySelector(`#${id}`)!.outerHTML);
    session.execute(command([{ type: 'add', value: { kind: 'interval', value: '13', placement: 'above' } }], 'r4'));
    expect(keys(session, 'r4')).toContain('13:above'); expect(chainIds.map(id => session.source.querySelector(`#${id}`)!.outerHTML)).toEqual(originalChains);
  });

  it('rejects explicit interval-chain scope on a non-road event rather than guessing a chain', () => {
    const session = fixture(); expectRejected(session, command([{ type: 'add', value: { kind: 'articulation', type: 'fermata', placement: 'above' } }], 'rest1'));
  });

  it.each([null, 'all', 'event', false])('rejects an unknown explicit scope (%s)', intervalScope => {
    const session = fixture(); expectRejected(session, { ...command([]), intervalScope } as unknown as AuthorCommand);
  });

  it('returns a structured incompatible-mark error with the existing message prefix and exact source IDs', () => {
    const session = fixture();
    const value: EventInput = { kind: 'rest', pitch: '', pitches: '', duration: 'whole', dots: 0, rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };
    const failure = expectRejected(session, { type: 'update-event', eventId: 'r4', value, fields: ['kind'] });
    expect(failure).toBeInstanceOf(EventMarkingCompatibilityError);
    expect(failure).toMatchObject({ name: 'EventMarkingCompatibilityError', eventId: 'r4', markingId: 'r4-a' });
    expect((failure as Error).message).toMatch(/^The attached harmony interval cannot be kept on this event kind\./);
  });

  it('NOTATION-RECOVERY: gives the exact attached mark when a named rhythmic flag would turn an accented slash open', () => {
    const session = new EditorSession(createProject('<music-staff id="staff"><music-measure id="bar"><music-slash id="slash" rhythmic duration="whole"><music-articulation id="slash-accent" type="accent"></music-articulation></music-slash></music-measure></music-staff>'));
    const value = { kind: 'unfinished', pitch: 'unfinished pitch', pitches: 'unfinished chord', duration: 'unfinished', rhythmic: false } as unknown as EventInput;
    const failure = expectRejected(session, { type: 'update-event', eventId: 'slash', value, fields: ['rhythmic'] });
    expect(failure).toBeInstanceOf(EventMarkingCompatibilityError);
    expect(failure).toMatchObject({ eventId: 'slash', markingId: 'slash-accent' });
    expect((failure as Error).message).toMatch(/^The attached accent cannot be kept on this event kind\./);
  });

  it('NOTATION-RECOVERY: ignores unrelated unfinished kinds and rhythmic values for a different field patch', () => {
    const session = new EditorSession(createProject('<music-staff id="staff"><music-measure id="bar"><music-slash id="slash" rhythmic duration="whole"><music-articulation id="slash-accent" type="accent"></music-articulation></music-slash></music-measure></music-staff>'));
    const value = { kind: 'unfinished', pitch: 'unfinished pitch', rhythmic: false, stem: 'down' } as unknown as EventInput;
    session.execute({ type: 'update-event', eventId: 'slash', value, fields: ['stem'] });
    expect(session.source.querySelector('#slash')?.hasAttribute('rhythmic')).toBe(true);
    expect(session.source.querySelector('#slash')?.getAttribute('stem')).toBe('down'); expect(session.source.querySelector('#slash-accent')).not.toBeNull();
    const before = session.project; const revision = session.revision;
    session.execute({ type: 'update-event', eventId: 'slash', value: { ...value, rhythmic: true }, fields: ['rhythmic'] });
    expect(session.project).toEqual(before); expect(session.revision).toBe(revision);
  });

  it('NOTATION-RECOVERY: retains the flag validation error for an invalid named rhythmic value', () => {
    const session = new EditorSession(createProject('<music-staff id="staff"><music-measure id="bar"><music-slash id="slash" rhythmic duration="whole"><music-articulation id="slash-accent" type="accent"></music-articulation></music-slash></music-measure></music-staff>'));
    const failure = expectRejected(session, { type: 'update-event', eventId: 'slash', value: { rhythmic: 'unfinished' } as unknown as EventInput, fields: ['rhythmic'] });
    expect((failure as Error).message).toBe('The rhythmic slash flag must be true or false.');
  });
});

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
function model(): Mutable<Score> { return structuredClone(fixture().score) as Mutable<Score>; }
function modelEvent(score: Mutable<Score>, id: string): Mutable<MusicEvent> {
  return score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events))).find(event => event.id === id)!;
}

describe('complete road tie inspection and stricter scope preservation', () => {
  it.each(chainIds)('inspects the same ordered chain from %s without changing model, source, or history', selected => {
    const session = fixture(); const score = session.score; const before = JSON.stringify(score); const project = session.project;
    const inspected = inspectRoadTieChain(score, selected);
    expect(inspected).toMatchObject({ eventId: selected, staffId: 'roads', voiceIndex: 0, tied: true });
    expect(inspected.members.map(member => member.eventId)).toEqual(chainIds);
    expect(inspected.members.map(member => [member.measureId, member.measureNumber, member.voiceId, member.tie])).toEqual([
      ['m1', 'A', 'v1', 'start'], ['m2', 'B', 'v2', 'continue'], ['m2', 'B', 'v2', 'end'],
    ]);
    expect(inspected.members[0].intervals).toEqual([
      { id: 'r1-a', value: 'b3', placement: 'above' }, { id: 'r1-b', value: 'b3', placement: 'below' }, { id: 'r1-c', value: '#11', placement: 'above' },
    ]);
    expect(JSON.stringify(score)).toBe(before); expect(session.project).toEqual(project); expect(session.revision).toBe(0); expect(session.canUndo).toBe(false);
  });

  it('returns independent plain data and keeps another simultaneous voice in its own chain', () => {
    const score = model(); const result = inspectRoadTieChain(score, 'parallel2') as Mutable<RoadTieChainInspection>;
    expect(result.voiceIndex).toBe(1); expect(result.members.map(member => member.eventId)).toEqual(['parallel1', 'parallel2']);
    result.members[0].intervals[0].value = '13'; result.members[0].measureId = 'wrong';
    const next = inspectRoadTieChain(score, 'parallel2');
    expect(next.members[0].intervals[0].value).toBe('b3'); expect(next.members[0].measureId).toBe('m1');
  });

  it('returns one member for an untied road and rejects stale or non-road IDs', () => {
    const score = model(); expect(inspectRoadTieChain(score, 'r4')).toMatchObject({ tied: false, members: [{ eventId: 'r4', tie: 'none' }] });
    for (const id of ['missing', 'r2-a', 'rest1']) expect(() => inspectRoadTieChain(score, id)).toThrow();
    const session = fixture(); expectRejected(session, command([], 'missing')); expectRejected(session, command([], 'r2-a'));
  });

  it('carries the same voice’s pending tie through an existing empty voice', () => {
    const score = model();
    for (const staff of score.staves) {
      const previous = staff.measures[0];
      staff.measures.splice(1, 0, { ...structuredClone(previous), id: `${staff.id}-empty-bar`, number: 'empty', annotations: [],
        voices: previous.voices.map((_, index) => ({ id: `${staff.id}-empty-${index}`, events: [], tuplets: [] })) });
    }
    expect(inspectRoadTieChain(score, 'r2').members.map(member => member.eventId)).toEqual(chainIds);
  });

  it.each(['missing-voice', 'rest', 'new-start', 'orphan', 'unclosed', 'changed-direction'] as const)('refuses an invalid connected chain after %s', change => {
    const score = model();
    if (change === 'missing-voice') score.staves[0].measures[1].voices = [];
    else if (change === 'rest') Object.assign(modelEvent(score, 'r2'), { kind: 'rest', pitchDirection: undefined, tie: 'none', markings: [] });
    else if (change === 'new-start') modelEvent(score, 'r2').tie = 'start';
    else if (change === 'orphan') modelEvent(score, 'r1').tie = 'continue';
    else if (change === 'unclosed') modelEvent(score, 'r3').tie = 'continue';
    else modelEvent(score, 'r2').pitchDirection = 'higher';
    expect(() => inspectRoadTieChain(score, 'r1')).toThrow();
    if (change !== 'missing-voice') expect(() => inspectRoadTieChain(score, 'r3')).toThrow();
  });

  it.each(['removed', 'different-figure', 'different-side', 'duplicate', 'reused-id'] as const)('never repairs or guesses an invalid interval declaration (%s)', change => {
    const score = model(); const selected = modelEvent(score, 'r3'); const marks = selected.markings!;
    const mark = marks.find(marking => marking.kind === 'interval' && marking.placement === 'above' && marking.interval.number === 3)!;
    if (mark.kind !== 'interval') throw new Error('Expected a fixture interval.');
    if (change === 'removed') selected.markings = marks.filter(marking => marking.id !== mark.id);
    else if (change === 'different-figure') mark.interval = { number: 2, alter: 1 };
    else if (change === 'different-side') mark.placement = 'below';
    else if (change === 'duplicate') marks.push({ ...structuredClone(mark), id: 'extra-duplicate' });
    else mark.id = 'r1-a';
    expect(() => inspectRoadTieChain(score, 'r2')).toThrow();
  });

  it('keeps a matching final semantic node even when the row batch explicitly removed that node’s old ID', () => {
    const session = fixture(); const matches = chainIds.map(id => session.source.querySelector(`#${id}-c`)!);
    session.execute(command([
      { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#11', placement: 'above' } },
      { type: 'remove', markingId: 'r2-c' },
    ]));
    chainIds.forEach((id, index) => {
      expect(session.source.querySelector(`#${id}-c`)).toBe(matches[index]);
      expect(session.source.querySelector(`#${id}-a`)).toBeNull(); expect(keys(session, id)).toEqual(['#11:above', 'b3:below']);
    });
  });

  it('preserves original update nodes when other simultaneous changes also need an unused interval node', () => {
    const session = fixture(); const original = chainIds.map(id => session.source.querySelector(`#${id}-a`)!);
    session.execute(command([
      { type: 'add', value: { kind: 'interval', value: '13', placement: 'above' } },
      { type: 'remove', markingId: 'r2-c' },
      { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '5', placement: 'above' } },
    ]));
    chainIds.forEach((id, index) => { expect(session.source.querySelector(`#${id}-a`)).toBe(original[index]); expect(original[index].getAttribute('value')).toBe('5'); });
  });

  it('keeps nested tuplets, written time, ties, scalar attributes, and local markings unchanged', () => {
    const nested = `<music-tuplet id="outer" actual="3" normal="2" data-user="outer"><music-tuplet id="inner" actual="5" normal="4" data-user="inner">${road('r2', 'continue', 'eighth', 'same')}${road('r3', 'end', 'eighth', 'same')}<music-rest id="inner-rest1" duration="eighth"></music-rest><music-rest id="inner-rest2" duration="eighth"></music-rest><music-rest id="inner-rest3" duration="eighth"></music-rest></music-tuplet><music-rest id="outer-rest" duration="quarter"></music-rest></music-tuplet><music-rest id="after-group" duration="half"></music-rest>`;
    const html = source.replace(`<music-voice id="v2">${road('r2', 'continue', 'half', 'same')}${road('r3', 'end', 'half', 'same')}</music-voice>`, `<music-voice id="v2">${nested}</music-voice>`);
    const session = fixture(html); const before = session.score.staves[0].measures[1].voices[0];
    const tuplets = ['outer', 'inner'].map(id => session.source.querySelector(`#${id}`)!); const attributes = tuplets.map(attrs);
    session.execute(command([{ type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#9', placement: 'above' } }]));
    const after = session.score.staves[0].measures[1].voices[0];
    expect(after.tuplets).toEqual(before.tuplets);
    expect(after.events.map(event => ({ ...event, markings: undefined }))).toEqual(before.events.map(event => ({ ...event, markings: undefined })));
    tuplets.forEach((node, index) => { expect(session.source.querySelector(`#${node.id}`)).toBe(node); expect(attrs(node)).toEqual(attributes[index]); });
    expect(inspectRoadTieChain(session.score, 'r3').members.map(member => member.eventId)).toEqual(chainIds);
    expect(session.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  });

  it('prepares every owner before mutating the detached source or allocating IDs', () => {
    const session = fixture(); const detached = session.source.cloneNode(true) as Element; const parsed = readScore(detached);
    detached.querySelector('#r4')!.append(detached.querySelector('#r3-a')!);
    const before = detached.outerHTML; const create = vi.fn((tag: string) => document.createElement(tag));
    expect(() => applyRoadTieIntervalEdits(parsed.score, 'r2', parsed.sources, [
      { type: 'update', markingId: 'r2-art', value: { kind: 'articulation', type: 'fermata', placement: 'auto' } },
      { type: 'add', value: { kind: 'interval', value: '13', placement: 'above' } },
    ], create)).toThrow('direct child');
    expect(detached.outerHTML).toBe(before); expect(create).not.toHaveBeenCalled();
  });

  it('makes equivalent set swaps without source mutations or ID allocation at the command helper boundary', () => {
    const session = fixture(); const detached = session.source.cloneNode(true) as Element; const parsed = readScore(detached);
    const before = detached.outerHTML; const create = vi.fn((tag: string) => document.createElement(tag));
    const changed = applyRoadTieIntervalEdits(parsed.score, 'r2', parsed.sources, [
      { type: 'update', markingId: 'r2-a', value: { kind: 'interval', value: '#11', placement: 'above' } },
      { type: 'update', markingId: 'r2-c', value: { kind: 'interval', value: 'b3', placement: 'above' } },
    ], create);
    expect(changed).toBe(false); expect(detached.outerHTML).toBe(before); expect(create).not.toHaveBeenCalled();
  });
});
