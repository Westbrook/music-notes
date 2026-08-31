// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import type { AnnotationInput, AuthorCommand, EventInput } from '../src/authoring/types';
import { readScore, serializeScore } from '../src/dom/index';
import { add, parsePitch, rational } from '../src/model/index';
import type { Measure, Score } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function score(body: string, attributes = ''): Element {
  return element(`<music-system id="score"><music-staff id="staff" ${attributes}>${body}</music-staff></music-system>`);
}

function bar(body: string, attributes = '', id = 'bar'): string {
  return `<music-measure id="${id}" ${attributes}>${body}</music-measure>`;
}

function note(id: string, duration = 'quarter', attributes = ''): string {
  return `<music-note id="${id}" pitch="C4" duration="${duration}" ${attributes}></music-note>`;
}

function rest(id: string, attributes = 'measure'): string {
  return `<music-rest id="${id}" ${attributes}></music-rest>`;
}

function event(overrides: Partial<EventInput> = {}): EventInput {
  return { kind: 'note', pitch: 'C4', pitches: 'C4 E4 G4', duration: 'quarter', dots: 0, rhythmic: false,
    measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto', ...overrides };
}

function annotation(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return { kind: 'direction', text: 'Solo until cue', at: '0', placement: 'above', ...overrides };
}

function parsed(root: Element) { return readScore(root); }
function music(root: Element): Score { return parsed(root).score; }
function measure(root: Element, index = 0, staff = 0): Measure { return music(root).staves[staff].measures[index]; }
function errors(root: Element): string[] { return parsed(root).diagnostics.filter(item => item.severity === 'error').map(item => item.code); }
function run(root: Element, command: AuthorCommand) { return applyCommand(root, command); }
function ids(root: Element): string[] { return [root, ...root.querySelectorAll('[id]')].map(node => node.id).filter(Boolean); }
function assertValid(root: Element): void {
  expect(errors(root)).toEqual([]);
  expect(music(element(serializeScore(music(root))))).toEqual(music(root));
}

function contexts(root: Element): Map<string, unknown> {
  return new Map(music(root).staves.flatMap(staff => staff.measures.map(({ id, meter, key, clef, voices }) => [id, { meter, key, clef, voices }] as const)));
}

function ensemble(): Element {
  const part = (id: string, clef: string) => `<music-staff id="${id}" clef="${clef}">`
    + bar(rest(`${id}-r1`), 'meter="4/4" key="C"', `${id}-m1`)
    + bar(`<music-meter id="${id}-meter" top="3" bottom="4"></music-meter>${rest(`${id}-r2`)}`, 'key="Bb" clef="alto"', `${id}-m2`)
    + bar(rest(`${id}-r3`), '', `${id}-m3`)
    + bar(rest(`${id}-r4`), 'meter="5/4" groups="3+2" key="D" clef="tenor"', `${id}-m4`)
    + '</music-staff>';
  return element(`<music-system id="score">${part('upper', 'treble')}${part('lower', 'bass')}</music-system>`);
}

function tiedScore(): Element {
  return score(bar(note('a', 'whole', 'tie="start"'), '', 'm1')
    + bar(note('b', 'whole', 'tie="continue"'), '', 'm2')
    + bar(note('c', 'whole', 'tie="end"'), '', 'm3')
    + bar(rest('r'), '', 'm4'));
}

describe('authoring event commands', () => {
  it.each(['before', 'after', 'replace'] as const)('intentionally replaces a full-measure rest for insertion %s', position => {
    const root = score(bar(rest('blank')));
    const result = run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: event({ pitch: 'F#4' }), position });
    expect(result.selectionId).toBe('blank');
    expect(root.querySelector('#blank')?.localName).toBe('music-note');
    expect(root.querySelector('music-rest')).toBeNull();
    expect(measure(root).incomplete).toBe(true);
    expect(measure(root).voices[0].events[0]).toMatchObject({ id: 'blank', time: rational(1, 4), pitches: [{ step: 'F', alter: 1 }] });
    assertValid(root);
  });

  it('inserts into a selected tuplet without flattening it', () => {
    const root = score(bar(`<music-tuplet id="t" actual="3" normal="2">${note('a', 'eighth')}${note('b', 'eighth')}</music-tuplet>`, 'incomplete'));
    const result = run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0, eventId: 'a' }, value: event({ pitch: 'D4', duration: 'eighth' }), position: 'after' });
    expect(root.querySelector(`#${result.selectionId}`)?.parentElement?.id).toBe('t');
    expect(measure(root).voices[0].events.map(item => item.id)).toEqual(['a', result.selectionId, 'b']);
    expect(measure(root).voices[0].events.map(item => item.time)).toEqual([rational(1, 12), rational(1, 12), rational(1, 12)]);
    assertValid(root);
  });

  it('appends to the chosen voice when no event is selected', () => {
    const root = score(bar(note('a'), 'incomplete'));
    run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: event({ kind: 'rest', duration: 'half', dots: 1 }), position: 'after' });
    expect(measure(root).voices[0].events.map(item => item.kind)).toEqual(['note', 'rest']);
    assertValid(root);
  });

  it('removes legacy pitch and dot attributes while preserving identity and ties on update', () => {
    const root = score(bar(`<music-note id="a" pitch="F4" accidental="sharp" duration="half" dotted tie="start" data-user="keep"></music-note>`
      + `<music-note id="b" pitch="F#4" duration="quarter" tie="end"></music-note>`), 'key="G"');
    run(root, { type: 'update-event', eventId: 'a', value: event({ pitch: 'F#4', duration: 'half', dots: 1, accidentalDisplay: 'courtesy', stem: 'up', beam: 'none' }) });
    const updated = root.querySelector('#a')!;
    expect(updated.getAttribute('accidental')).toBeNull();
    expect(updated.getAttribute('dotted')).toBeNull();
    expect(updated.getAttribute('dots')).toBe('1');
    expect(updated.getAttribute('tie')).toBe('start');
    expect(updated.getAttribute('data-user')).toBe('keep');
    expect(updated.getAttribute('beam')).toBe('none');
    assertValid(root);
  });

  it('keeps explicit spelling absolute under a key change and cleans kind-specific attributes', () => {
    const root = score(bar(`<music-chord id="a" pitches="F#4 A4" duration="whole" accidental-display="courtesy"></music-chord>`), 'key="G"');
    run(root, { type: 'update-event', eventId: 'a', value: event({ pitch: 'F4', duration: 'whole' }) });
    expect(root.querySelector('#a')?.getAttribute('pitches')).toBeNull();
    expect(measure(root).voices[0].events[0].pitches[0].alter).toBe(0);
    assertValid(root);
  });

  it('leaves overflow visible for transaction validation rather than rewriting music', () => {
    const root = score(bar(note('a', 'whole')));
    run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: event(), position: 'after' });
    expect(errors(root)).toContain('measure-overfull');
    expect(measure(root).voices[0].events.map(item => item.duration)).toEqual(['whole', 'quarter']);
    expect(measure(root).incomplete).toBe(false);
  });

  it('removes an event and marks the remainder as an incomplete draft without adding rests', () => {
    const root = score(bar(note('a', 'half') + note('b', 'half')));
    const result = run(root, { type: 'remove-event', eventId: 'a' });
    expect(result.selectionId).toBe('b');
    expect(measure(root).incomplete).toBe(true);
    expect(measure(root).voices[0].events.map(item => item.id)).toEqual(['b']);
    assertValid(root);
  });

  it('refuses to empty a voice or remove a tied event', () => {
    const root = score(bar(rest('only')));
    const original = root.outerHTML;
    expect(() => run(root, { type: 'remove-event', eventId: 'only' })).toThrow('empty voice');
    expect(root.outerHTML).toBe(original);
    const tied = score(bar(note('a', 'half', 'tie="start"') + note('b', 'half', 'tie="end"')));
    expect(() => run(tied, { type: 'remove-event', eventId: 'a' })).toThrow('tie chain');
  });

  it('preserves annotations while pruning a tuplet emptied by explicit deletion', () => {
    const root = score(bar(`<music-tuplet id="t" actual="2" normal="3"><music-direction id="d" text="Wait"></music-direction>${note('a', 'quarter')}</music-tuplet>${rest('r', 'duration="half"')}`, 'incomplete'));
    run(root, { type: 'remove-event', eventId: 'a' });
    expect(root.querySelector('#t')).toBeNull();
    expect(root.querySelector('#d')?.parentElement?.id).toBe('bar');
    expect(measure(root).annotations[0].onset).toEqual(rational(0));
    assertValid(root);
  });

  it.each([false, true])('preserves the imported annotation anchoring policy after deleting rhythm (explicit at: %s)', explicit => {
    const root = score(bar(note('a') + `<music-harmony id="h" text="G7"${explicit ? ' at="1/4"' : ''}></music-harmony>` + note('b', 'half', 'dots="1"')));
    run(root, { type: 'remove-event', eventId: 'a' });
    expect(root.querySelector('#h')?.hasAttribute('at')).toBe(explicit);
    expect(measure(root).annotations[0].onset).toEqual(explicit ? rational(1, 4) : rational(0));
    assertValid(root);
  });

  it('rejects mismatched cursors and invalid input before editing', () => {
    const root = score(bar(note('a', 'whole')));
    expect(() => run(root, { type: 'insert-event', cursor: { staffId: 'wrong', measureId: 'bar', voiceIndex: 0 }, value: event(), position: 'after' })).toThrow('cursor');
    expect(() => run(root, { type: 'update-event', eventId: 'a', value: event({ pitch: 'H4' }) })).toThrow();
    expect(() => run(root, { type: 'update-event', eventId: 'a', value: event({ kind: 'chord', pitches: 'C4 C4' }) })).toThrow('repeat');
    expect(() => run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: event(), position: 'replace' })).toThrow('Select an event');
    expect(() => run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'bar', voiceIndex: 0 }, value: event({ kind: 'rest', measureRest: true }), position: 'after' })).toThrow('full-measure rest');
  });
});

describe('exact bounded rest completion', () => {
  it('fills additive meter at group boundaries, preserving existing notes', () => {
    const root = score(bar(note('a'), 'meter="7/8" groups="2+2+3" incomplete'));
    const existing = root.querySelector('#a');
    run(root, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 });
    expect(root.querySelector('#a')).toBe(existing);
    expect(measure(root).voices[0].events.map(item => [item.kind, item.duration, item.dots])).toEqual([
      ['note', 'quarter', 0], ['rest', 'quarter', 0], ['rest', 'quarter', 1],
    ]);
    expect(measure(root).incomplete).toBe(false);
    assertValid(root);
  });

  it('clears incomplete status only when every voice is full', () => {
    const root = score(bar(`<music-voice id="v1">${note('a')}</music-voice><music-voice id="v2">${note('b', 'half')}</music-voice>`, 'incomplete'));
    run(root, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 });
    expect(measure(root).incomplete).toBe(true);
    expect(measure(root).voices[1].events).toHaveLength(1);
    run(root, { type: 'fill-rests', measureId: 'bar', voiceIndex: 1 });
    expect(measure(root).incomplete).toBe(false);
    assertValid(root);
  });

  it('can exactly complete a draft containing very short dotted values', () => {
    const root = score(bar(note('a', '128th', 'dots="3"'), 'incomplete'));
    run(root, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 });
    expect(measure(root).voices[0].events.reduce((sum, item) => add(sum, item.time), rational(0))).toEqual(rational(1));
    expect(measure(root).voices[0].events.length).toBeLessThan(257);
    assertValid(root);
  });

  it('refuses a remainder below the available written-rest values without adding anything', () => {
    const body = note('a', '128th', 'dots="1"') + Array.from({ length: 126 }, (_, i) => rest(`r${i}`, 'duration="128th"')).join('');
    const root = score(bar(body, 'incomplete'));
    const before = root.outerHTML;
    expect(() => run(root, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 })).toThrow('unsupported rest values');
    expect(root.outerHTML).toBe(before);
  });

  it('refuses unknown tuplet scope, incomplete tuplets, pickup capacity, and overflow', () => {
    const tuplet = score(bar(`<music-tuplet id="t" actual="3" normal="2">${note('a', 'eighth')}</music-tuplet>`, 'incomplete'));
    expect(() => run(tuplet, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0, tupletId: 't' })).toThrow('intended total span');
    expect(() => run(tuplet, { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 })).toThrow('incomplete tuplet');
    expect(() => run(score(bar(note('a'), 'pickup')), { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 })).toThrow('pickup');
    expect(() => run(score(bar(note('a', 'whole') + note('b'))), { type: 'fill-rests', measureId: 'bar', voiceIndex: 0 })).toThrow('overflows');
  });
});

describe('ensemble measure commands', () => {
  it('appends an aligned measure and preserves all original inherited context', () => {
    const root = ensemble();
    const before = contexts(root);
    const result = run(root, { type: 'append-measure', afterMeasureId: 'lower-m2' });
    expect(music(root).staves.map(staff => staff.measures.length)).toEqual([5, 5]);
    expect(measure(root, 2, 1).id).toBe(result.selectionId);
    for (const [id, original] of before) expect(contexts(root).get(id)).toEqual(original);
    expect(measure(root, 2).meter.display).toBe('3/4');
    expect(measure(root, 2).voices[0].events[0].measureRest).toBe(true);
    expect(new Set(ids(root)).size).toBe(ids(root).length);
    assertValid(root);
  });

  it('continues the preceding voice count in a newly appended bar', () => {
    const root = score(bar(`<music-voice id="v1">${rest('a')}</music-voice><music-voice id="v2">${rest('b')}</music-voice>`));
    run(root, { type: 'append-measure' });
    expect(measure(root, 1).voices).toHaveLength(2);
    expect(measure(root, 1).voices.map(voice => voice.events[0].measureRest)).toEqual([true, true]);
    assertValid(root);
  });

  it('duplicates contiguous columns with fresh IDs, including nested meter identities', () => {
    const root = ensemble();
    const before = contexts(root);
    const result = run(root, { type: 'duplicate-measures', measureIds: ['lower-m2', 'upper-m3', 'lower-m3'] });
    expect(music(root).staves.map(staff => staff.measures.length)).toEqual([6, 6]);
    expect(measure(root, 3, 1).id).toBe(result.selectionId);
    expect(result.copiedIds?.['lower-m2']).toBe(result.selectionId);
    expect(result.copiedIds?.['upper-meter']).not.toBe('upper-meter');
    expect(root.querySelector(`[id="${result.copiedIds?.['upper-meter']}"]`)?.localName).toBe('music-meter');
    expect(music(root).staves[0].measures.map(item => item.meter.display)).toEqual(['4/4', '3/4', '3/4', '3/4', '3/4', '5/4']);
    for (const [id, original] of before) expect(contexts(root).get(id)).toEqual(original);
    expect(root.querySelector('#upper-meter')).not.toBeNull();
    expect(root.querySelectorAll('music-meter')).toHaveLength(4);
    expect(new Set(ids(root)).size).toBe(ids(root).length);
    assertValid(root);
  });

  it.each([-1, 1] as const)('moves the complete column direction %s without changing existing musical context', direction => {
    const root = ensemble();
    const before = contexts(root);
    run(root, { type: 'move-measure', measureId: 'lower-m2', direction });
    expect(music(root).staves[0].measures[1 + direction].id).toBe('upper-m2');
    expect(music(root).staves[1].measures[1 + direction].id).toBe('lower-m2');
    for (const [id, original] of before) expect(contexts(root).get(id)).toEqual(original);
    assertValid(root);
  });

  it('preserves a following inherited context when its declaration bar is removed', () => {
    const root = ensemble();
    const before = contexts(root);
    run(root, { type: 'remove-measure', measureId: 'lower-m2' });
    expect(music(root).staves.map(staff => staff.measures.length)).toEqual([3, 3]);
    expect(contexts(root).get('upper-m3')).toEqual(before.get('upper-m3'));
    expect(contexts(root).get('lower-m3')).toEqual(before.get('lower-m3'));
    assertValid(root);
  });

  it('updates default numbering while retaining custom measure labels', () => {
    const root = score(bar(rest('a'), '', 'm1') + bar(rest('b'), 'number="B"', 'm2') + bar(rest('c'), '', 'm3'));
    run(root, { type: 'move-measure', measureId: 'm3', direction: -1 });
    expect(music(root).staves[0].measures.map(item => item.number)).toEqual(['1', '2', 'B']);
    expect(root.querySelector('#m3')?.hasAttribute('number')).toBe(false);
    assertValid(root);
  });

  it('never reclassifies an explicit numeric override as automatic after a move', () => {
    const root = score(bar(rest('a'), 'number="2"', 'custom') + bar(rest('b'), 'number="B"', 'other'));
    run(root, { type: 'move-measure', measureId: 'custom', direction: 1 });
    expect(music(root).staves[0].measures.map(item => item.number)).toEqual(['B', '2']);
    run(root, { type: 'move-measure', measureId: 'custom', direction: -1 });
    expect(music(root).staves[0].measures.map(item => item.number)).toEqual(['2', 'B']);
    assertValid(root);
  });

  it('returns copied annotation IDs so project-owned instruction scopes can follow duplication', () => {
    const root = score(bar('<music-direction id="cue" text="To C on cue"></music-direction><music-harmony id="__proto__" text="Dm9"></music-harmony>' + rest('r')));
    const result = run(root, { type: 'duplicate-measures', measureIds: ['bar'] });
    const copiedCue = result.copiedIds?.cue;
    expect(copiedCue).toBeDefined();
    expect(root.querySelector(`[id="${copiedCue}"]`)?.getAttribute('text')).toBe('To C on cue');
    expect(Object.hasOwn(result.copiedIds!, '__proto__')).toBe(true);
    expect(root.querySelector(`[id="${result.copiedIds?.['__proto__']}"]`)?.localName).toBe('music-harmony');
    expect(result.copiedIds?.bar).toBe(result.selectionId);
    assertValid(root);
  });

  it.each<AuthorCommand>([
    { type: 'append-measure', afterMeasureId: 'm1' },
    { type: 'duplicate-measures', measureIds: ['m1'] },
    { type: 'move-measure', measureId: 'm2', direction: 1 },
    { type: 'remove-measure', measureId: 'm2' },
  ])('preserves unaffected inheritance when applying $type', command => {
    const root = score(bar(rest('a'), '', 'm1') + bar(rest('b'), '', 'm2') + bar(rest('c'), '', 'm3'));
    run(root, command);
    expect(root.querySelectorAll('music-measure[key], music-measure[clef], music-measure[meter]')).toHaveLength(0);
    run(root, { type: 'set-staff', staffId: 'staff', label: 'Bass', clef: 'bass', key: 'G' });
    expect(music(root).staves[0].measures.every(item => item.key === 'G' && item.clef === 'bass')).toBe(true);
    assertValid(root);
  });

  it('restores the full signature when a groups-only bar moves after a different meter', () => {
    const root = score(bar(rest('a'), 'meter="7/8" groups="2+2+3"', 'm1')
      + bar(rest('b'), 'groups="3+2+2"', 'm2') + bar(rest('c'), 'meter="4/4"', 'm3'));
    run(root, { type: 'move-measure', measureId: 'm2', direction: 1 });
    expect(music(root).staves[0].measures.map(item => item.meter.display)).toEqual(['7/8', '4/4', '7/8']);
    expect(measure(root, 2).meter.groups).toEqual([3, 2, 2]);
    assertValid(root);
  });

  it('refuses partial tied-phrase changes before mutating source', () => {
    const commands: AuthorCommand[] = [
      { type: 'append-measure', afterMeasureId: 'm1' },
      { type: 'duplicate-measures', measureIds: ['m1', 'm2'] },
      { type: 'move-measure', measureId: 'm3', direction: 1 },
      { type: 'remove-measure', measureId: 'm2' },
    ];
    for (const command of commands) {
      const root = tiedScore();
      const before = root.outerHTML;
      expect(() => run(root, command)).toThrow(/tie/i);
      expect(root.outerHTML).toBe(before);
    }
  });

  it('duplicates an entire tied phrase without joining it to either copy', () => {
    const root = tiedScore();
    run(root, { type: 'duplicate-measures', measureIds: ['m1', 'm2', 'm3'] });
    expect(music(root).staves[0].measures.map(item => item.voices[0].events[0].tie)).toEqual(['start', 'continue', 'end', 'start', 'continue', 'end', 'none']);
    assertValid(root);
  });

  it('refuses noncontiguous duplication, out-of-range moves, and removing the final measure', () => {
    const root = ensemble();
    expect(() => run(root, { type: 'duplicate-measures', measureIds: ['upper-m1', 'upper-m3'] })).toThrow('contiguous');
    expect(() => run(root, { type: 'move-measure', measureId: 'upper-m1', direction: -1 })).toThrow('end of the score');
    expect(() => run(score(bar(rest('r'))), { type: 'remove-measure', measureId: 'bar' })).toThrow('at least one measure');
  });
});

describe('staff, voice, and musical context edits', () => {
  it('adds a staff with aligned rests and preserves its requested clef', () => {
    const root = ensemble();
    const result = run(root, { type: 'add-staff', label: 'Bass <solo>', clef: 'bass' });
    const staff = music(root).staves[2];
    expect(staff.id).toBe(result.selectionId);
    expect(staff.label).toBe('Bass <solo>');
    expect(staff.measures.map(item => item.meter)).toEqual(music(root).staves[0].measures.map(item => item.meter));
    expect(staff.measures.every(item => item.clef === 'bass' && item.voices[0].events[0].measureRest)).toBe(true);
    expect(new Set(ids(root)).size).toBe(ids(root).length);
    assertValid(root);
  });

  it('lets new-staff defaults continue to govern bars without local changes', () => {
    const root = score(bar(rest('a'), '', 'm1') + bar(rest('b'), '', 'm2'));
    const result = run(root, { type: 'add-staff', label: 'Bass', clef: 'bass' });
    run(root, { type: 'set-staff', staffId: result.selectionId!, label: 'Viola', clef: 'alto', key: 'G' });
    expect(music(root).staves[1].measures.every(item => item.clef === 'alto' && item.key === 'G')).toBe(true);
    expect(music(root).staves[1].measures.map(item => item.number)).toEqual(['1', '2']);
    expect(root.querySelector(`[id="${result.selectionId}"]`)?.querySelectorAll('music-measure[number]')).toHaveLength(0);
    assertValid(root);
  });

  it('uses the exact existing pickup length when adding a voice or staff', () => {
    const root = score(bar(note('a', 'quarter', 'dots="1"'), 'pickup'));
    run(root, { type: 'add-voice', measureId: 'bar' });
    run(root, { type: 'add-staff', label: 'Bass', clef: 'bass' });
    expect(music(root).staves.flatMap(staff => staff.measures[0].voices.map(voice => voice.events.reduce((sum, item) => add(sum, item.time), rational(0))))).toEqual([rational(3, 8), rational(3, 8), rational(3, 8)]);
    expect(music(root).staves[1].measures[0].voices[0].events[0].measureRest).toBe(false);
    assertValid(root);
  });

  it('wraps an implicit voice without changing its identity, event order, or annotation onset', () => {
    const root = score(bar(note('a') + '<music-harmony id="h" text="G13(b9)"></music-harmony>' + note('b', 'half', 'dots="1"')));
    const voiceId = measure(root).voices[0].id;
    const first = root.querySelector('#a');
    const result = run(root, { type: 'add-voice', measureId: 'bar' });
    expect(measure(root).voices[0].id).toBe(voiceId);
    expect(measure(root).voices[1].id).toBe(result.selectionId);
    expect(root.querySelector('#a')).toBe(first);
    expect(measure(root).voices[0].events.map(item => item.id)).toEqual(['a', 'b']);
    expect(measure(root).annotations[0].onset).toEqual(rational(1, 4));
    expect(root.querySelector('#h')?.hasAttribute('at')).toBe(false);
    expect(root.querySelector('#h')?.parentElement?.id).toBe(voiceId);
    run(root, { type: 'update-event', eventId: 'b', value: event({ duration: 'half' }) });
    run(root, { type: 'update-event', eventId: 'a', value: event({ duration: 'half' }) });
    expect(measure(root).annotations[0].onset).toEqual(rational(1, 2));
    assertValid(root);
  });

  it('appends a voice without changing existing voice indices or cross-bar ties', () => {
    const root = tiedScore();
    run(root, { type: 'add-voice', measureId: 'm2' });
    expect(music(root).staves[0].measures.map(item => item.voices[0].events[0].id)).toEqual(['a', 'b', 'c', 'r']);
    assertValid(root);
  });

  it('changes staff defaults without transposing authored pitches or overriding explicit context', () => {
    const root = score(bar('<music-note id="a" pitch="F4" duration="whole"></music-note>', '', 'm1') + bar(rest('r'), 'clef="alto" key="Bb"', 'm2'));
    run(root, { type: 'set-staff', staffId: 'staff', label: 'Viola', clef: 'bass', key: 'G' });
    expect(measure(root).key).toBe('G');
    expect(measure(root).voices[0].events[0].pitches[0].alter).toBe(0);
    expect(measure(root, 1)).toMatchObject({ clef: 'alto', key: 'Bb' });
    assertValid(root);
  });

  it('applies meter/group edits to the column while restoring following inherited context', () => {
    const root = ensemble();
    const following = contexts(root).get('upper-m3');
    const meterNode = root.querySelector('#upper-meter');
    run(root, { type: 'set-measure', measureId: 'lower-m2', values: { meter: '7/8', groups: '2+2+3' } });
    expect(measure(root, 1).meter.display).toBe('7/8');
    expect(measure(root, 1, 1).meter.groups).toEqual([2, 2, 3]);
    expect(contexts(root).get('upper-m3')).toEqual(following);
    expect(root.querySelector('#upper-meter')).toBe(meterNode);
    assertValid(root);
  });

  it('marks newly short voices as drafts after enlarging this measure', () => {
    const root = score(bar(note('a', 'half', 'dots="1"'), 'meter="3/4"', 'm1') + bar(rest('r'), '', 'm2'));
    run(root, { type: 'set-measure', measureId: 'm1', values: { meter: '4/4' } });
    expect(measure(root).incomplete).toBe(true);
    expect(measure(root, 1).meter.display).toBe('3/4');
    assertValid(root);
  });

  it('changes pickup status across the column and adjusts automatic numbering', () => {
    const root = element(`<music-system id="score"><music-staff id="upper">${bar(note('a'), 'incomplete', 'u1')}${bar(rest('ur'), '', 'u2')}</music-staff>`
      + `<music-staff id="lower">${bar(note('b'), 'incomplete', 'l1')}${bar(rest('lr'), '', 'l2')}</music-staff></music-system>`);
    run(root, { type: 'set-measure', measureId: 'u1', values: { pickup: true, incomplete: false } });
    expect(music(root).staves.map(staff => staff.measures[0].pickup)).toEqual([true, true]);
    expect(music(root).staves.map(staff => staff.measures.map(item => item.number))).toEqual([['0', '1'], ['0', '1']]);
    assertValid(root);
  });

  it('does not freeze key and clef inheritance while restoring a local meter change', () => {
    const root = score(bar(rest('a'), '', 'm1') + bar(rest('b'), '', 'm2'));
    run(root, { type: 'set-measure', measureId: 'm1', values: { meter: '3/4' } });
    expect(root.querySelector('#m2')?.hasAttribute('key')).toBe(false);
    expect(root.querySelector('#m2')?.hasAttribute('clef')).toBe(false);
    run(root, { type: 'set-staff', staffId: 'staff', label: 'Bass', clef: 'bass', key: 'G' });
    expect(music(root).staves[0].measures.every(item => item.clef === 'bass' && item.key === 'G')).toBe(true);
    assertValid(root);
  });

  it('changes key and clef only on the selected staff measure', () => {
    const root = ensemble();
    run(root, { type: 'set-measure', measureId: 'upper-m2', values: { key: 'F#m', clef: 'bass', endBar: 'double', repeatStart: true } });
    expect(measure(root, 1)).toMatchObject({ key: 'F#m', clef: 'bass', endBar: 'double', repeatStart: true });
    expect(measure(root, 1, 1)).toMatchObject({ key: 'Bb', clef: 'alto', endBar: 'single', repeatStart: false });
    expect(measure(root, 2)).toMatchObject({ key: 'Bb', clef: 'alto' });
    assertValid(root);
  });

  it('does not mark an underfilled measure complete or silently repair meter overflow', () => {
    const draft = score(bar(note('a'), 'incomplete'));
    expect(() => run(draft, { type: 'set-measure', measureId: 'bar', values: { incomplete: false } })).toThrow('still short');
    const root = score(bar(note('a', 'whole')));
    run(root, { type: 'set-measure', measureId: 'bar', values: { meter: '3/4' } });
    expect(errors(root)).toContain('measure-overfull');
    expect(measure(root).voices[0].events[0].duration).toBe('whole');
  });
});

describe('annotation commands', () => {
  it('stores prose as inert text at an exact whole-note fraction', () => {
    const root = score(bar(rest('r')));
    const text = 'Swing; <script>solo until cue</script> & listen';
    const result = run(root, { type: 'add-annotation', measureId: 'bar', value: annotation({ text, at: '2/4' }) });
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector(`#${result.selectionId}`)?.getAttribute('at')).toBe('1/2');
    expect(measure(root).annotations[0]).toMatchObject({ kind: 'direction', text, onset: rational(1, 2) });
    expect(measure(root).voices[0].events).toHaveLength(1);
    assertValid(root);
  });

  it('keeps harmony literal and strips old tempo fields when changing annotation kind', () => {
    const root = score(bar('<music-tempo id="a" marking="Fast" bpm="140" beat="quarter" dots="1" data-user="keep"></music-tempo>' + rest('r')));
    run(root, { type: 'update-annotation', annotationId: 'a', value: annotation({ kind: 'harmony', text: 'G13(b9)/F', at: '3/4' }) });
    expect(root.querySelector('#a')?.localName).toBe('music-harmony');
    expect(root.querySelector('#a')?.hasAttribute('bpm')).toBe(false);
    expect(root.querySelector('#a')?.hasAttribute('dots')).toBe(false);
    expect(root.querySelector('#a')?.getAttribute('data-user')).toBe('keep');
    expect(measure(root).annotations[0].text).toBe('G13(b9)/F');
    assertValid(root);
  });

  it('supports metronome-only annotations and removes only the selected annotation', () => {
    const root = score(bar(rest('r')));
    const added = run(root, { type: 'add-annotation', measureId: 'bar', value: annotation({ kind: 'tempo', text: '', bpm: 84, beat: 'quarter', dots: 1 }) });
    expect(measure(root).annotations[0]).toMatchObject({ text: '', bpm: 84, beat: 'quarter', dots: 1 });
    assertValid(root);
    expect(run(root, { type: 'remove-annotation', annotationId: added.selectionId! }).selectionId).toBe('bar');
    expect(measure(root).annotations).toEqual([]);
    assertValid(root);
  });

  it('rejects empty annotations and malformed fractions; out-of-range positions remain validation errors', () => {
    const root = score(bar(rest('r')));
    expect(() => run(root, { type: 'add-annotation', measureId: 'bar', value: annotation({ text: '' }) })).toThrow('needs text');
    expect(() => run(root, { type: 'add-annotation', measureId: 'bar', value: annotation({ at: '1/0' }) })).toThrow();
    run(root, { type: 'add-annotation', measureId: 'bar', value: annotation({ at: '5/4' }) });
    expect(errors(root)).toContain('annotation-outside-measure');
  });
});

describe('structural tuplet commands', () => {
  it('wraps mixed values based on duration rather than child count', () => {
    const root = score(bar(note('a', 'quarter') + note('b', 'eighth') + rest('r', 'duration="half"') + rest('tail', 'duration="eighth"')));
    const result = run(root, { type: 'wrap-tuplet', eventIds: ['b', 'a'], actual: 3, normal: 2, bracket: 'yes', ratio: true });
    expect(measure(root).voices[0].tuplets[0]).toMatchObject({ id: result.selectionId, actual: 3, normal: 2, eventIds: ['a', 'b'], showRatio: true });
    expect(measure(root).voices[0].events.slice(0, 2).map(item => item.time)).toEqual([rational(1, 6), rational(1, 12)]);
    expect(measure(root).voices[0].events.slice(0, 2).map(item => item.duration)).toEqual(['quarter', 'eighth']);
    assertValid(root);
  });

  it.each([false, true])('keeps sequential versus fixed annotation anchors through wrapping and unwrapping (explicit at: %s)', explicit => {
    const root = score(bar(note('a', 'quarter') + `<music-direction id="d" text="Cue"${explicit ? ' at="1/4"' : ''}></music-direction>`
      + note('b', 'eighth') + rest('r', 'duration="half"') + rest('tail', 'duration="eighth"')));
    const result = run(root, { type: 'wrap-tuplet', eventIds: ['a', 'b'], actual: 3, normal: 2, bracket: 'yes', ratio: false });
    expect(root.querySelector('#d')?.hasAttribute('at')).toBe(explicit);
    expect(measure(root).annotations[0].onset).toEqual(explicit ? rational(1, 4) : rational(1, 6));
    assertValid(root);
    run(root, { type: 'unwrap-tuplet', tupletId: result.selectionId! });
    expect(root.querySelector('#d')?.hasAttribute('at')).toBe(explicit);
    expect(measure(root).annotations[0].onset).toEqual(rational(1, 4));
    assertValid(root);
  });

  it('nests a whole existing tuplet while preserving wrapper and event identities', () => {
    const inner = Array.from({ length: 5 }, (_, i) => note(`n${i}`, 'eighth')).join('');
    const root = score(bar(note('a') + `<music-tuplet id="inner" actual="5" normal="4">${inner}</music-tuplet>` + note('end')));
    const existing = root.querySelector('#inner');
    const result = run(root, { type: 'wrap-tuplet', eventIds: ['a', 'n0', 'n1', 'n2', 'n3', 'n4'], actual: 3, normal: 2, bracket: 'auto', ratio: false });
    expect(root.querySelector('#inner')).toBe(existing);
    expect(existing?.parentElement?.id).toBe(result.selectionId);
    expect(measure(root).voices[0].events[1].tupletIds).toEqual([result.selectionId, 'inner']);
    expect(measure(root).incomplete).toBe(true);
    assertValid(root);
  });

  it('rejects noncontiguous, cross-voice, and partially overlapping tuplet selections', () => {
    const root = score(bar(`<music-tuplet id="t" actual="3" normal="2">${note('a', 'eighth')}${note('b', 'eighth')}${note('c', 'eighth')}</music-tuplet>${note('d', 'half', 'dots="1"')}`));
    const wrap = (eventIds: string[]): AuthorCommand => ({ type: 'wrap-tuplet', eventIds, actual: 3, normal: 2, bracket: 'auto', ratio: false });
    expect(() => run(root, wrap(['a', 'c']))).toThrow('contiguous');
    expect(() => run(root, wrap(['b', 'c', 'd']))).toThrow('whole nested tuplet');
    const polyphonic = score(bar(`<music-voice>${note('a', 'whole')}</music-voice><music-voice>${note('b', 'whole')}</music-voice>`));
    expect(() => run(polyphonic, wrap(['a', 'b']))).toThrow('one voice');
    expect(() => run(score(bar(rest('r'))), wrap(['r']))).toThrow('full-measure rest');
  });

  it('sets and unwraps ratios without rewriting the written values', () => {
    const root = score(bar(`<music-tuplet id="t" actual="3" normal="2">${note('a')}${note('b')}${note('c')}</music-tuplet>${rest('r', 'duration="half"')}`));
    run(root, { type: 'set-tuplet', tupletId: 't', actual: 3, normal: 1, bracket: 'no', ratio: true });
    expect(measure(root).voices[0].events[0].time).toEqual(rational(1, 12));
    expect(measure(root).incomplete).toBe(true);
    assertValid(root);
    run(root, { type: 'unwrap-tuplet', tupletId: 't' });
    expect(root.querySelector('#t')).toBeNull();
    expect(measure(root).voices[0].events.map(item => item.id)).toEqual(['a', 'b', 'c', 'r']);
    expect(errors(root)).toContain('measure-overfull');
  });
});

describe('ties and explicit commitment conversion', () => {
  it('ties consecutive identical spellings across measures in voice order', () => {
    const root = score(bar(note('a', 'whole'), '', 'm1') + bar(note('b', 'whole'), '', 'm2'));
    run(root, { type: 'tie-events', eventIds: ['b', 'a'] });
    expect(music(root).staves[0].measures.map(item => item.voices[0].events[0].tie)).toEqual(['start', 'end']);
    assertValid(root);
  });

  it('does not join similarly indexed events when the voice disappears in an intervening measure', () => {
    const root = score(bar(`<music-voice>${rest('r1')}</music-voice><music-voice>${note('a', 'whole')}</music-voice>`, '', 'm1')
      + bar(rest('r2'), '', 'm2')
      + bar(`<music-voice>${rest('r3')}</music-voice><music-voice>${note('b', 'whole')}</music-voice>`, '', 'm3'));
    expect(() => run(root, { type: 'tie-events', eventIds: ['a', 'b'] })).toThrow('every intervening measure');
    expect(root.querySelectorAll('[tie]')).toHaveLength(0);
    assertValid(root);
  });

  it('requires the same complete chord spelling and contiguous voice events', () => {
    const root = score(bar(note('a') + note('b') + note('c', 'half')));
    expect(() => run(root, { type: 'tie-events', eventIds: ['a', 'c'] })).toThrow('consecutive');
    const enharmonic = score(bar('<music-note id="a" pitch="F#4" duration="half"></music-note><music-note id="b" pitch="Gb4" duration="half"></music-note>'));
    expect(() => run(enharmonic, { type: 'tie-events', eventIds: ['a', 'b'] })).toThrow('same spelled pitches');
    const chords = score(bar('<music-chord id="a" pitches="C4 E4 G4" duration="half"></music-chord><music-chord id="b" pitches="G4 C4 E4" duration="half"></music-chord>'));
    run(chords, { type: 'tie-events', eventIds: ['a', 'b'] });
    assertValid(chords);
  });

  it('clears a complete connected chain when only its middle event is selected', () => {
    const root = tiedScore();
    const result = run(root, { type: 'clear-ties', eventIds: ['b'] });
    expect(result.message).toContain('3 events');
    expect(root.querySelectorAll('[tie]')).toHaveLength(0);
    assertValid(root);
  });

  it('refuses partial reties or insertion inside an existing chain', () => {
    const root = tiedScore();
    expect(() => run(root, { type: 'tie-events', eventIds: ['a', 'b'] })).toThrow('complete existing tie chain');
    expect(() => run(root, { type: 'insert-event', cursor: { staffId: 'staff', measureId: 'm2', voiceIndex: 0, eventId: 'b' }, value: event(), position: 'before' })).toThrow('tie chain');
  });

  it('converts open and rhythmic slashes explicitly while retaining exact nominal time and IDs', () => {
    const root = score(bar(note('a', 'quarter', 'dots="1"') + rest('r', 'duration="eighth"') + note('b', 'half')));
    const before = measure(root).voices[0].events.map(item => [item.id, item.time, item.duration, item.dots]);
    const result = run(root, { type: 'convert-events', eventIds: ['a', 'b'], kind: 'slash', rhythmic: false, pitch: '' });
    expect(result.message).toContain('required attacks were removed');
    expect(measure(root).voices[0].events.map(item => [item.id, item.time, item.duration, item.dots])).toEqual(before);
    expect(measure(root).voices[0].events.filter(item => item.kind === 'slash').every(item => item.pitches.length === 0 && !item.rhythmic)).toBe(true);
    run(root, { type: 'convert-events', eventIds: ['a', 'b'], kind: 'slash', rhythmic: true, pitch: '' });
    expect(measure(root).voices[0].events.filter(item => item.kind === 'slash').every(item => item.rhythmic)).toBe(true);
    assertValid(root);
  });

  it('requires an explicit pitch for conversion to notes and retains silence duration for rests', () => {
    const root = score(bar('<music-slash id="a" duration="whole"></music-slash>'), 'key="G"');
    expect(() => run(root, { type: 'convert-events', eventIds: ['a'], kind: 'note', rhythmic: false, pitch: '' })).toThrow();
    run(root, { type: 'convert-events', eventIds: ['a'], kind: 'note', rhythmic: false, pitch: 'F4' });
    expect(measure(root).voices[0].events[0].pitches[0].alter).toBe(0);
    run(root, { type: 'convert-events', eventIds: ['a'], kind: 'rest', rhythmic: false, pitch: '' });
    expect(measure(root).voices[0].events[0]).toMatchObject({ kind: 'rest', time: rational(1), measureRest: false });
    assertValid(root);
  });

  it('requires complete beam-group selection for open slashes and removes the whole grouping', () => {
    const root = score(bar(note('a', 'eighth', 'beam="start"') + note('b', 'eighth', 'beam="end"') + rest('r', 'duration="half" dots="1"')));
    expect(() => run(root, { type: 'convert-events', eventIds: ['a'], kind: 'slash', rhythmic: false, pitch: '' })).toThrow('complete explicit beam group');
    run(root, { type: 'convert-events', eventIds: ['a', 'b'], kind: 'slash', rhythmic: false, pitch: '' });
    expect(measure(root).voices[0].events.slice(0, 2).map(item => item.beam)).toEqual(['none', 'none']);
    assertValid(root);
  });

  it('does not drop ties or guess a written duration for a full-measure rest', () => {
    expect(() => run(tiedScore(), { type: 'convert-events', eventIds: ['b'], kind: 'slash', rhythmic: false, pitch: '' })).toThrow('tie chain');
    const root = score(bar(rest('r'), 'meter="5/4" groups="3+2"'));
    expect(() => run(root, { type: 'convert-events', eventIds: ['r'], kind: 'note', rhythmic: false, pitch: 'C4' })).toThrow('explicit duration');
  });
});

describe('pitch-only note editing', () => {
  it('changes only pitch and the legacy alteration while preserving all other attributes and node identity', () => {
    const root = score(bar('<music-note id="n" pitch="F4" accidental="sharp" duration="4" dotted stem="up" beam="none" accidental-display="courtesy" data-author="keep"></music-note>'
      + rest('r1', 'duration="half"') + rest('r2', 'duration="eighth"'), 'incomplete'), 'key="G"');
    const node = root.querySelector('#n')!;
    const parent = node.parentElement;
    const attributes = Object.fromEntries([...node.attributes].filter(attribute => !['pitch', 'accidental'].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]));
    const before = measure(root).voices[0].events[0];
    const result = run(root, { type: 'set-note-pitch', eventId: 'n', pitch: 'G#4', ties: 'reject' });
    expect(result.selectionId).toBe('n');
    expect(root.querySelector('#n')).toBe(node);
    expect(node.parentElement).toBe(parent);
    expect(node.getAttribute('pitch')).toBe('G#4');
    expect(node.hasAttribute('accidental')).toBe(false);
    expect(Object.fromEntries([...node.attributes].filter(attribute => attribute.name !== 'pitch').map(attribute => [attribute.name, attribute.value]))).toEqual(attributes);
    expect(measure(root).voices[0].events[0]).toEqual({ ...before, pitches: [parsePitch('G#4', undefined, 'courtesy')] });
    expect(measure(root).incomplete).toBe(true);
    assertValid(root);
  });

  it('preserves nested ratios, voice order, exact time, other events, and fixed or sequential annotations', () => {
    const inner = Array.from({ length: 5 }, (_, index) => note(`n${index}`, 'eighth')).join('');
    const root = score(bar(`<music-voice id="v1"><music-tuplet id="outer" actual="3" normal="2">${note('a')}`
      + `<music-direction id="sequential" text="Listen"></music-direction><music-tuplet id="inner" actual="5" normal="4">${inner}</music-tuplet></music-tuplet>`
      + '<music-harmony id="fixed" text="Dm9" at="1/2"></music-harmony>' + note('tail', 'half')
      + `</music-voice><music-voice id="v2">${rest('silent')}</music-voice>`));
    const before = music(root);
    const parent = root.querySelector('#n2')?.parentElement;
    run(root, { type: 'set-note-pitch', eventId: 'n2', pitch: 'Bb4', ties: 'reject' });
    expect(root.querySelector('#n2')?.parentElement).toBe(parent);
    expect(music(root)).toEqual({
      ...before,
      staves: before.staves.map(staff => ({ ...staff, measures: staff.measures.map(item => ({ ...item,
        voices: item.voices.map(voice => ({ ...voice, events: voice.events.map(value => value.id === 'n2'
          ? { ...value, pitches: [parsePitch('Bb4')] } : value) })),
      })) })),
    });
    expect(root.querySelector('#sequential')?.hasAttribute('at')).toBe(false);
    assertValid(root);
  });

  it.each(['treble', 'bass', 'alto', 'tenor'])('keeps explicit pitch independent of the key and %s clef', clef => {
    const root = score(bar('<music-note id="n" pitch="C4" duration="whole" accidental-display="always"></music-note>', `clef="${clef}" key="G"`));
    run(root, { type: 'set-note-pitch', eventId: 'n', pitch: 'F4', ties: 'reject' });
    expect(measure(root).voices[0].events[0].pitches).toEqual([parsePitch('F4', undefined, 'always')]);
    expect(measure(root)).toMatchObject({ clef, key: 'G' });
    assertValid(root);
  });

  it('does not collapse an explicitly requested enharmonic spelling', () => {
    const root = score(bar('<music-note id="n" pitch="F#4" duration="whole"></music-note>'));
    run(root, { type: 'set-note-pitch', eventId: 'n', pitch: 'Gb4', ties: 'reject' });
    expect(root.querySelector('#n')?.getAttribute('pitch')).toBe('Gb4');
    expect(measure(root).voices[0].events[0].pitches).toEqual([parsePitch('Gb4')]);
    assertValid(root);
  });

  it.each([
    '<music-note id="n" pitch="F#4" duration="whole"></music-note>',
    '<music-note id="n" pitch="F4" accidental="sharp" duration="whole"></music-note>',
  ])('leaves unchanged spelling entirely untouched, including legacy attributes', html => {
    const root = score(bar(html));
    const before = root.outerHTML;
    const result = run(root, { type: 'set-note-pitch', eventId: 'n', pitch: ' f♯4 ', ties: 'reject' });
    expect(root.outerHTML).toBe(before);
    expect(result).toMatchObject({ selectionId: 'n', message: expect.stringContaining('nothing changed') });
  });

  it.each(['a', 'b', 'c'])('rejects changes to tied event %s without mutating any chain member', eventId => {
    const root = tiedScore();
    const before = root.outerHTML;
    expect(() => run(root, { type: 'set-note-pitch', eventId, pitch: 'D4', ties: 'reject' })).toThrow('tied note');
    expect(root.outerHTML).toBe(before);
    run(root, { type: 'set-note-pitch', eventId, pitch: 'C4', ties: 'reject' });
    expect(root.outerHTML).toBe(before);
    assertValid(root);
  });

  it.each([
    rest('n'),
    '<music-chord id="n" pitches="C4 E4 G4" duration="whole"></music-chord>',
    '<music-slash id="n" duration="whole"></music-slash>',
    '<music-slash id="n" duration="whole" rhythmic></music-slash>',
  ])('rejects non-note events without converting their meaning', html => {
    const root = score(bar(html));
    const before = root.outerHTML;
    expect(() => run(root, { type: 'set-note-pitch', eventId: 'n', pitch: 'D4', ties: 'reject' })).toThrow('single note only');
    expect(root.outerHTML).toBe(before);
  });

  it.each(['', 'H4', 'C10', 'C-2', 'C4; D4'])('rejects invalid pitch %s before mutating source', pitch => {
    const root = score(bar(note('n', 'whole')));
    const before = root.outerHTML;
    expect(() => run(root, { type: 'set-note-pitch', eventId: 'n', pitch, ties: 'reject' })).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it('preserves a generated source identity without introducing unrelated attributes', () => {
    const root = score(bar('<music-note pitch="C4" duration="whole"></music-note>'));
    const node = root.querySelector('music-note');
    const id = measure(root).voices[0].events[0].id;
    run(root, { type: 'set-note-pitch', eventId: id, pitch: 'D4', ties: 'reject' });
    expect(root.querySelector('music-note')).toBe(node);
    expect(node?.hasAttribute('id')).toBe(false);
    expect(measure(root).voices[0].events[0].id).toBe(id);
    assertValid(root);
  });
});
