// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import type { AuthorCommand, EventAttackInput, EventInput } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, rational } from '../src/model/index';

const cursor = { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'event' };

function input(overrides: Partial<EventInput> = {}): EventInput {
  return { kind: 'note', pitch: 'C4', pitches: 'C4 E4 G4', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto', ...overrides };
}

function session(body = '<music-rest id="event" measure></music-rest>', barAttributes = '', staffAttributes = ''): EditorSession {
  return new EditorSession(createProject(`<music-staff id="staff" ${staffAttributes}><music-measure id="bar" ${barAttributes}>${body}</music-measure></music-staff>`, 'Entry attacks'));
}

const attacks: EventAttackInput[] = [
  ...ARTICULATION_TYPES.map(type => ({ kind: 'articulation' as const, type })),
  ...ORNAMENT_TYPES.map(type => ({ kind: 'ornament' as const, type })),
];

describe('entry attack commands', () => {
  it.each(attacks)('inserts $kind $type as a stable child sharing the event rhythm', attack => {
    const editor = session('<music-note id="event" pitch="D4" duration="quarter"></music-note>', 'incomplete');
    const result = editor.execute({ type: 'insert-event', cursor, value: input({ attack }), position: 'after' });
    const event = editor.score.staves[0].measures[0].voices[0].events[1];
    const marking = event.markings?.[0];
    expect(event).toMatchObject({ id: result.selectionId, onset: rational(1, 4), time: rational(1, 4), duration: 'quarter' });
    expect(marking).toMatchObject({ ...attack, placement: attack.kind === 'articulation' ? 'auto' : 'above' });
    expect(marking?.id).toBeTruthy();
    const node = editor.source.querySelector(`#${marking?.id}`);
    expect(node?.localName).toBe(`music-${attack.kind}`);
    expect(node?.parentElement?.id).toBe(event.id);
    expect(readScore(editor.source).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  });

  it.each(['insert-event', 'append-and-insert', 'continue-piece'] as const)('keeps the event and its attack in one undoable %s transaction', type => {
    const editor = type === 'insert-event' ? session()
      : session('<music-note id="event" pitch="D4" duration="whole"></music-note>', type === 'continue-piece' ? 'end-bar="final"' : '');
    editor.select('event');
    const before = editor.project.sourceHtml;
    const value = input({ attack: { kind: 'ornament', type: 'trill' } });
    const command: AuthorCommand = type === 'continue-piece'
      ? { type, cursor, value, position: 'after', confirmation: 'final-to-single' }
      : { type, cursor, value, position: 'after' };
    editor.execute(command);
    const after = editor.project.sourceHtml;
    const markingId = editor.source.querySelector('music-ornament')?.id;
    expect(markingId).toBeTruthy();
    expect(editor.revision).toBe(1);
    editor.undo();
    expect(editor.project.sourceHtml).toBe(before);
    expect(editor.canUndo).toBe(false);
    expect(editor.source.querySelector('music-ornament')).toBeNull();
    editor.redo();
    expect(editor.project.sourceHtml).toBe(after);
    expect(editor.source.querySelector('music-ornament')?.id).toBe(markingId);
  });

  it.each([
    { kind: 'rest', attack: { kind: 'articulation', type: 'staccato' } },
    { kind: 'slash', rhythmic: false, attack: { kind: 'articulation', type: 'accent' } },
    { kind: 'chord', attack: { kind: 'ornament', type: 'turn' } },
    { kind: 'slash', rhythmic: true, attack: { kind: 'ornament', type: 'trill' } },
    { kind: 'note', attack: { kind: 'articulation', type: 'trill' } },
    { kind: 'note', attack: { kind: 'ornament', type: 'accent' } },
    { kind: 'note', attack: { kind: 'interval', type: 'accent' } },
  ])('rejects incompatible or invalid attack $kind $attack before mutating source', overrides => {
    const editor = session();
    const before = editor.source.outerHTML;
    expect(() => applyCommand(editor.source, { type: 'insert-event', cursor,
      value: input(overrides as Partial<EventInput>), position: 'replace' })).toThrow();
    expect(editor.source.outerHTML).toBe(before);
    expect(editor.revision).toBe(0);
  });

  it.each(['append-and-insert', 'continue-piece'] as const)('rejects incompatible attack before %s changes barlines or adds measures', type => {
    const editor = session('<music-note id="event" pitch="C4" duration="whole"></music-note>', type === 'continue-piece' ? 'end-bar="final"' : '');
    const before = editor.source.outerHTML;
    const value = input({ kind: 'rest', attack: { kind: 'articulation', type: 'accent' } });
    const command: AuthorCommand = type === 'continue-piece'
      ? { type, cursor, value, position: 'after', confirmation: 'final-to-single' }
      : { type, cursor, value, position: 'after' };
    expect(() => applyCommand(editor.source, command)).toThrow('only fermata');
    expect(editor.source.outerHTML).toBe(before);
  });

  it.each(['rest', 'slash'] as const)('allows a fermata on a %s', kind => {
    const editor = session();
    editor.execute({ type: 'insert-event', cursor, value: input({ kind, attack: { kind: 'articulation', type: 'fermata' } }), position: 'replace' });
    expect(editor.score.staves[0].measures[0].voices[0].events[0].markings?.[0]).toMatchObject({ kind: 'articulation', type: 'fermata' });
  });

  it('allows a pitch ornament on a road without adding an absolute pitch', () => {
    const editor = session(undefined, '', 'notation="three-roads"');
    editor.execute({ type: 'insert-event', cursor, value: input({ kind: 'road', pitchDirection: 'higher', attack: { kind: 'ornament', type: 'turn' } }), position: 'replace' });
    const event = editor.score.staves[0].measures[0].voices[0].events[0];
    expect(event).toMatchObject({ kind: 'road', pitchDirection: 'higher', pitches: [], markings: [{ kind: 'ornament', type: 'turn' }] });
  });

  it('retains attached source and metadata on replacement, adds an attack once, and keeps markings when attack is absent', () => {
    const editor = session('<music-note id="event" pitch="C4" duration="whole" data-user="keep"><!-- preserve -->'
      + '<music-articulation id="held" type="fermata" placement="below" data-mark="keep"></music-articulation></music-note>');
    const value = input({ kind: 'chord', duration: 'whole', attack: { kind: 'articulation', type: 'staccato' } });
    applyCommand(editor.source, { type: 'insert-event', cursor, value, position: 'replace' });
    const event = editor.source.querySelector('#event')!;
    const held = event.querySelector('#held')!;
    const added = event.querySelector('music-articulation[type="staccato"]')!;
    expect(event.localName).toBe('music-chord');
    expect(event.getAttribute('data-user')).toBe('keep');
    expect(event.innerHTML).toContain('<!-- preserve -->');
    expect(held.outerHTML).toContain('placement="below" data-mark="keep"');
    expect(added.id).toBeTruthy();
    applyCommand(editor.source, { type: 'insert-event', cursor, value, position: 'replace' });
    expect(event.querySelectorAll('music-articulation')).toHaveLength(2);
    expect(event.querySelector('music-articulation[type="staccato"]')).toBe(added);
    applyCommand(editor.source, { type: 'update-event', eventId: 'event', value: input({ kind: 'chord', duration: 'whole' }) });
    expect(event.querySelector('#held')).toBe(held);
    expect(event.querySelector('music-articulation[type="staccato"]')).toBe(added);
    expect(readScore(editor.source).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
  });
});
