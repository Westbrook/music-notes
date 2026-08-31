// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands.js';
import { analyzeContinuation } from '../src/authoring/continuation.js';
import type { ContinuationAnalysis, ContinuationInput } from '../src/authoring/continuation.js';
import { EditorSession } from '../src/authoring/editor.js';
import { createProject } from '../src/authoring/project.js';
import type { EventInput } from '../src/authoring/types.js';
import { readScore } from '../src/dom/index.js';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function score(body: string, staffAttributes = '', rootAttributes = ''): Element {
  return element(`<music-system id="score" ${rootAttributes}><music-staff id="staff" ${staffAttributes}>${body}</music-staff></music-system>`);
}

function bar(body: string, attributes = '', id = 'm'): string {
  return `<music-measure id="${id}" ${attributes}>${body}</music-measure>`;
}

function note(id = 'n', duration = 'whole', attributes = ''): string {
  return `<music-note id="${id}" pitch="C4" duration="${duration}" ${attributes}></music-note>`;
}

function rest(id = 'r', attributes = 'measure'): string {
  return `<music-rest id="${id}" ${attributes}></music-rest>`;
}

function rhythm(id = 'n', duration = 'whole', attributes = ''): string {
  return `<music-rhythm id="${id}" duration="${duration}" ${attributes}></music-rhythm>`;
}

function value(overrides: Partial<EventInput> = {}): EventInput {
  return {
    kind: 'note', pitch: 'D4', pitches: 'C4 E4 G4', duration: 'quarter', dots: 0,
    rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
    ...overrides,
  };
}

function input(overrides: Partial<ContinuationInput> = {}): ContinuationInput {
  return {
    cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'n' },
    value: value(), position: 'after', ...overrides,
  };
}

function analyze(root: Element, overrides: Partial<ContinuationInput> = {}): ContinuationAnalysis {
  const html = root.outerHTML;
  const nodes = [...root.querySelectorAll('*')];
  const result = analyzeContinuation(root, input(overrides));
  expect(root.outerHTML).toBe(html);
  expect([...root.querySelectorAll('*')].every((node, index) => node === nodes[index])).toBe(true);
  return result;
}

function blocked(result: ContinuationAnalysis, reason: RegExp): void {
  expect(result).toMatchObject({ eligible: false, ending: false, reason: expect.stringMatching(reason) });
  expect(result.newMeasureLabel).toBeUndefined();
}

function ensemble(hiddenAttributes = ''): Element {
  return element(`<music-system id="score">
    <music-staff id="staff" label="Lead">${bar(note())}</music-staff>
    <music-staff id="hidden" label="Rhythm" clef="bass">${bar(
      `<music-voice id="h1">${rest('hr1')}</music-voice><music-voice id="h2">${rest('hr2')}</music-voice>`,
      hiddenAttributes, 'hm',
    )}</music-staff>
  </music-system>`);
}

describe('continuation eligibility and exact time', () => {
  it('offers a new measure after the full final voice and reports the current column', () => {
    const result = analyze(score(bar(note()), 'label="Lead"'));
    expect(result).toMatchObject({ eligible: true, ending: false, currentMeasureLabel: '1', newMeasureLabel: '2' });
    expect(result.affectedStaves).toEqual([
      { staffId: 'staff', label: 'Lead', measureId: 'm', measureNumber: '1', endBar: 'single', voiceCount: 1 },
    ]);
  });

  it('accepts an eventless end cursor in an ordinary full voice', () => {
    expect(analyze(score(bar(note())), {
      cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0 },
    }).eligible).toBe(true);
  });

  it.each(['before', 'replace'] as const)('does not redirect %s insertion to another measure', position => {
    blocked(analyze(score(bar(note())), { position }), /Insert after/);
  });

  it('does not redirect insertion after an interior event', () => {
    const root = score(bar(note('a', 'quarter') + note('n', 'half', 'dots="1"')));
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'a' } }), /last event/);
  });

  it('does not skip the remaining time of a short draft', () => {
    blocked(analyze(score(bar(note('n', 'quarter'), 'incomplete'))), /Finish this voice.*1\/4 of 1/);
  });

  it.each(['before', 'after', 'replace'] as const)('keeps %s entry in an empty draft voice and explains how to resume', position => {
    const root = score(bar('<music-voice id="empty"></music-voice><music-voice id="other">' + rest('other-rest') + '</music-voice>', 'incomplete'));
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0 }, position }),
      /Write in this empty voice before continuing/);
  });

  it('uses the empty second voice instead of offering continuation from its full neighbor', () => {
    const root = score(bar('<music-voice id="other">' + note('other-note') + '</music-voice><music-voice id="empty"></music-voice>', 'incomplete'));
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 1 } }),
      /Write in this empty voice before continuing/);
  });

  it('uses exact dotted time in additive meter, even when a full bar retains its draft flag', () => {
    const root = score(bar(note('a', 'quarter') + note('b', 'quarter') + note('n', 'quarter', 'dots="1"'),
      'meter="7/8" groups="2+2+3" incomplete'));
    expect(analyze(root, { value: value({ duration: 'half', dots: 1 }) }).eligible).toBe(true);
    blocked(analyze(root, { value: value({ duration: 'whole' }) }), /shorter event.*7\/8/);
  });

  it('recognizes existing numeric duration aliases and legacy dots without normalizing them', () => {
    const root = score(bar(note('a', '4') + note('n', '1/2', 'dotted="true"')));
    expect(analyze(root).eligible).toBe(true);
    expect(root.querySelector('#n')?.getAttribute('duration')).toBe('1/2');
    expect(root.querySelector('#n')?.getAttribute('dotted')).toBe('true');
  });

  it.each(['before', 'after', 'replace'] as const)('keeps full-measure-rest replacement ahead of continuation for %s', position => {
    blocked(analyze(score(bar(rest('n'))), { position }), /replace the existing full-measure rest/);
  });

  it('does not mistake an ordinary written whole rest for a replaceable measure rest', () => {
    expect(analyze(score(bar(rest('n', 'duration="whole"')))).eligible).toBe(true);
  });

  it('does not shift or replace existing later measures', () => {
    blocked(analyze(score(bar(note()) + bar(rest(), '', 'later'))), /existing later measures/);
  });

  it.each(['quarter', 'whole'])('requires explicit addition after a %s pickup', duration => {
    blocked(analyze(score(bar(note('n', duration), 'pickup'))), /pickup/);
  });

  it('uses the selected second voice, preserving other voices and their unfinished music', () => {
    const root = score(bar(`<music-voice id="v1">${note('a', 'quarter')}</music-voice>
      <music-voice id="v2">${note()}</music-voice>`, 'incomplete'));
    const result = analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 1, eventId: 'n' } });
    expect(result.eligible).toBe(true);
    expect(result.affectedStaves[0].voiceCount).toBe(2);
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'a' } }), /Finish this voice/);
  });
});

describe('canonical ensemble boundaries and ending confirmation', () => {
  it('includes staves that are absent from the active part view', () => {
    const result = analyze(ensemble());
    expect(result.eligible).toBe(true);
    expect(result.affectedStaves).toEqual([
      { staffId: 'staff', label: 'Lead', measureId: 'm', measureNumber: '1', endBar: 'single', voiceCount: 1 },
      { staffId: 'hidden', label: 'Rhythm', measureId: 'hm', measureNumber: '1', endBar: 'single', voiceCount: 2 },
    ]);
  });

  it.each(['repeat-start', 'end-bar="repeat-end"'])('blocks a hidden staff repeat boundary: %s', attributes => {
    blocked(analyze(ensemble(attributes)), /repeat boundary/);
  });

  it('reports a hidden final barline as the sole blocker when all other conditions pass', () => {
    const result = analyze(ensemble('end-bar="final"'));
    expect(result).toMatchObject({ eligible: false, ending: true, newMeasureLabel: '2', reason: expect.stringMatching(/final barline/) });
    expect(result.affectedStaves[1].endBar).toBe('final');
    expect(result.affectedStaves[0].endBar).toBe('single');
  });

  it.each(['single', 'double', 'none'])('permits a %s boundary without ending confirmation', endBar => {
    expect(analyze(score(bar(note(), `end-bar="${endBar}"`)))).toMatchObject({ eligible: true, ending: false });
  });

  it('does not offer ending confirmation when a repeat is also present', () => {
    blocked(analyze(ensemble('end-bar="final" repeat-start')), /repeat boundary/);
  });

  it.each([
    value({ pitch: 'H4' }), value({ duration: 'breve' }), value({ kind: 'rest', measureRest: true }),
  ])('does not offer ending confirmation for an impossible inserted event', event => {
    const result = analyze(ensemble('end-bar="final"'), { value: event });
    expect(result).toMatchObject({ eligible: false, ending: false });
    expect(result.reason).not.toMatch(/^A final barline/);
    expect(result.newMeasureLabel).toBeUndefined();
  });

  it('does not offer ending confirmation for a short selected voice', () => {
    const root = ensemble('end-bar="final"');
    root.querySelector('#n')!.setAttribute('duration', 'quarter');
    root.querySelector('#m')!.setAttribute('incomplete', '');
    blocked(analyze(root), /Finish this voice/);
  });
});

describe('tuplet and tie boundaries', () => {
  const terminalTuplet = () => score(bar(note('a', 'half')
    + `<music-tuplet id="t" actual="3" normal="2">${note('b', 'quarter')}${note('c', 'quarter')}${note('n', 'quarter')}</music-tuplet>`));

  it.each([true, false])('blocks a terminal tuplet with a selected-event cursor: %s', selected => {
    const root = terminalTuplet();
    expect(readScore(root).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    blocked(analyze(root, {
      cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0, ...(selected ? { eventId: 'n' } : {}) },
    }), /ends inside a tuplet/);
  });

  it('blocks a terminal legacy triplet even without a selected event', () => {
    const root = score(bar(note('a', 'half') + note('b', 'quarter', 'triplet="start"')
      + note('c', 'quarter') + note('n', 'quarter', 'triplet="end"')));
    expect(readScore(root).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0 } }), /ends inside a tuplet/);
  });

  it('blocks an event inside nested terminal tuplets', () => {
    const inner = ['i1', 'i2', 'i3', 'i4', 'n'].map(id => note(id, 'eighth')).join('');
    const root = score(bar(note('before', 'half')
      + `<music-tuplet id="outer" actual="3" normal="2">${note('a', 'quarter')}`
      + `<music-tuplet id="inner" actual="5" normal="4">${inner}</music-tuplet></music-tuplet>`));
    expect(readScore(root).diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    blocked(analyze(root), /ends inside a tuplet/);
  });

  it('allows an earlier closed tuplet followed by an ordinary terminal event', () => {
    const root = score(bar(`<music-tuplet id="t" actual="3" normal="2">${note('a', 'eighth')}${note('b', 'eighth')}${note('c', 'eighth')}</music-tuplet>`
      + note('n', 'half', 'dots="1"')));
    expect(analyze(root).eligible).toBe(true);
  });

  it('does not convert a terminal tuplet into an ending-only decision', () => {
    const root = terminalTuplet();
    root.querySelector('#m')!.setAttribute('end-bar', 'final');
    blocked(analyze(root), /tuplet/);
  });

  it('allows a completed incoming tie but not insertion through its outgoing start', () => {
    const root = score(bar(note('start', 'whole', 'tie="start"'), '', 'previous')
      + bar(note('n', 'whole', 'tie="end"')));
    expect(analyze(root).eligible).toBe(true);
    blocked(analyze(root, { cursor: { staffId: 'staff', measureId: 'previous', voiceIndex: 0, eventId: 'start' } }), /outgoing tie/);
  });

  it('rejects an unclosed outgoing tie as invalid initial music', () => {
    blocked(analyze(score(bar(note('n', 'whole', 'tie="start"')))), /Fix the score.*tie/);
  });
});

describe('planned labels and read-only analysis', () => {
  it('uses default numbering instead of incrementing a custom current label', () => {
    expect(analyze(score(bar(note(), 'number="Outro 42a"')))).toMatchObject({
      eligible: true, currentMeasureLabel: 'Outro 42a', newMeasureLabel: '2',
    });
  });

  it('derives numbering after an opening pickup even when the final bar has a custom label', () => {
    const root = score(bar(note('pickup-note', 'quarter'), 'pickup number="Intro"', 'pickup')
      + bar(note(), 'number="Solo"'));
    expect(analyze(root)).toMatchObject({ eligible: true, currentMeasureLabel: 'Solo', newMeasureLabel: '2' });
  });

  it('plans a standalone staff with inherited meter, clef, and key without changing source', () => {
    const root = element(`<music-staff id="staff" label="Viola" clef="alto" key="Bb" meter="3/4">
      ${bar(note('n', 'half', 'dotted'), 'number="C"')}
    </music-staff>`);
    expect(analyze(root, { value: value({ duration: 'half', dots: 1 }) })).toMatchObject({
      eligible: true, currentMeasureLabel: 'C', newMeasureLabel: '2',
    });
  });

  it('plans the inherited final meter declaration rather than the different system defaults', () => {
    const root = score(bar('<music-meter id="meter" top="2+2+3" bottom="8"></music-meter>'
      + note('a', 'quarter') + note('b', 'quarter') + note('n', 'quarter', 'dots="1"'), 'key="Bb" clef="tenor"'),
    '', 'meter="3/4" key="G" clef="alto"');
    const before = readScore(root).score;
    expect(analyze(root, { value: value({ duration: 'half', dots: 1 }) })).toMatchObject({ eligible: true, newMeasureLabel: '2' });
    expect(readScore(root).score).toEqual(before);
  });

  it('derives the selected lower staff label while preserving canonical column context', () => {
    const root = ensemble();
    root.querySelector('#hr2')!.replaceWith(element(note('lower-note')));
    root.querySelector('#hm')!.setAttribute('number', 'Bass ending');
    const result = analyze(root, { cursor: { staffId: 'hidden', measureId: 'hm', voiceIndex: 1, eventId: 'lower-note' } });
    expect(result).toMatchObject({ eligible: true, currentMeasureLabel: 'Bass ending', newMeasureLabel: '2' });
  });

  it('avoids temporary ID collisions and returns the same result across repeated analysis', () => {
    const root = score(bar(note('music-continuation-plan-1')), 'label="Lead"');
    const overrides = { cursor: { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'music-continuation-plan-1' } };
    const first = analyze(root, overrides);
    expect(first.eligible).toBe(true);
    expect(analyze(root, overrides)).toEqual(first);
  });

  it('preserves reader-generated source identities without adding attributes', () => {
    const root = element('<music-staff><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
    const before = readScore(root).score;
    const staff = before.staves[0];
    const measure = staff.measures[0];
    expect(analyze(root, { cursor: { staffId: staff.id, measureId: measure.id, voiceIndex: 0, eventId: measure.voices[0].events[0].id } }).eligible).toBe(true);
    expect(root.querySelectorAll('[id]')).toHaveLength(0);
    expect(readScore(root).score).toEqual(before);
  });
});

describe('rhythm staff and microtonal grammar compatibility', () => {
  it('continues rhythm notes on a rhythm staff with neutral inherited pitch context', () => {
    const root = score(bar(rhythm()), 'notation="rhythm" label="Percussion"', 'key="Bb" clef="bass"');
    const parsed = readScore(root);
    expect(parsed.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    expect(parsed.score.staves[0]).toMatchObject({ notation: 'rhythm', key: 'C', clef: 'treble' });
    expect(analyze(root, { value: value({ kind: 'rhythm', pitch: 'unused', pitches: 'unused' }) })).toMatchObject({
      eligible: true, ending: false, newMeasureLabel: '2',
    });
    expect(root.querySelectorAll('music-staff[key], music-staff[clef], music-measure[key], music-measure[clef]')).toHaveLength(0);
  });

  it('supports a standalone rhythm staff', () => {
    const root = element(`<music-staff id="staff" notation="rhythm" meter="3/8">${bar(rhythm('n', 'quarter', 'dotted'))}</music-staff>`);
    expect(analyze(root, { value: value({ kind: 'rhythm', duration: 'eighth' }) }).eligible).toBe(true);
  });

  it.each(['', 'notation="pitched"'])('does not put a rhythm note on a pitched staff: %s', attributes => {
    blocked(analyze(score(bar(note()), attributes), { value: value({ kind: 'rhythm' }) }), /Rhythm notes need.*rhythm staff/);
  });

  it.each(['note', 'chord'] as const)('does not put a pitched %s on a rhythm staff', kind => {
    blocked(analyze(score(bar(rhythm()), 'notation="rhythm"'), { value: value({ kind }) }), /rhythm staff has no pitches/);
  });

  it.each([
    value({ kind: 'rest' }), value({ kind: 'slash', rhythmic: false }), value({ kind: 'slash', rhythmic: true }),
  ])('permits ordinary rests and both kinds of slash on rhythm staves', event => {
    expect(analyze(score(bar(rhythm()), 'notation="rhythm"'), { value: event }).eligible).toBe(true);
  });

  it('checks the selected staff notation while still including all canonical staves', () => {
    const root = element(`<music-system id="score" key="D" clef="alto">
      <music-staff id="lead">${bar(note('lead-note'), '', 'lead-bar')}</music-staff>
      <music-staff id="staff" notation="rhythm" label="Percussion">${bar(rhythm())}</music-staff>
    </music-system>`);
    const result = analyze(root, { value: value({ kind: 'rhythm' }) });
    expect(result).toMatchObject({ eligible: true, newMeasureLabel: '2' });
    expect(result.affectedStaves.map(staff => staff.staffId)).toEqual(['lead', 'staff']);
  });

  it('recognizes a completed incoming rhythm tie', () => {
    const root = score(bar(rhythm('start', 'whole', 'tie="start"'), '', 'previous')
      + bar(rhythm('n', 'whole', 'tie="end"')), 'notation="rhythm"');
    expect(analyze(root, { value: value({ kind: 'rhythm' }) }).eligible).toBe(true);
  });

  it('does not offer ending confirmation when the event conflicts with staff notation', () => {
    blocked(analyze(score(bar(rhythm(), 'end-bar="final"'), 'notation="rhythm"')), /rhythm staff has no pitches/);
  });

  it.each(['Fqs4', 'Bqf3', 'Ctqs5', 'Etqf4'])('accepts the parser-supported microtonal spelling %s', pitch => {
    const root = score(bar('<music-note id="n" pitch="F4" accidental="quarter-sharp" duration="whole"></music-note>'), 'key="G"');
    expect(analyze(root, { value: value({ pitch }) }).eligible).toBe(true);
    expect(root.querySelector('#n')?.getAttribute('accidental')).toBe('quarter-sharp');
  });

  it('checks complete microtonal chord spelling without rejecting enharmonic alternatives', () => {
    const root = score(bar(note()));
    expect(analyze(root, { value: value({ kind: 'chord', pitches: 'Cqs4 Dtqf4 G4' }) }).eligible).toBe(true);
    blocked(analyze(root, { value: value({ kind: 'chord', pitches: 'Fqs4 fqs4' }) }), /repeat the same spelled pitch/);
  });
});

describe('CONTINUATION-MODEL-PARITY', () => {
  it.each([
    ['single', 'Fqf4 F4 Fqs4'], ['final', 'Fqf4 F4 Fqs4'],
    ['single', 'Fbb4 Fb4 F4'], ['final', 'Fbb4 Fb4 F4'],
    ['single', ' fqs4  F4 Fqf4 '], ['final', ' fqs4  F4 Fqf4 '],
  ])('rejects the unsupported chord %s / %s before offering continuation or ending review', (endBar, pitches) => {
    const model = readScore(score(bar(`<music-chord id="candidate" pitches="${pitches}" duration="whole"></music-chord>`)));
    expect(model.diagnostics.some(item => item.code === 'unsupported-chord-cluster')).toBe(true);
    const result = analyze(score(bar(note(), `end-bar="${endBar}"`)), {
      value: value({ kind: 'chord', pitches }),
    });
    blocked(result, /at most two pitches on the same letter and octave/i);
    expect(result.reason).toMatch(/distinct staff positions|separate staves/i);
  });

  it.each([
    'Fqf4 Fqs4', 'C4 Eqs4 G4', 'Cqs4 Dtqf4 G4',
    'Fqf4 F4 Fqs5', 'Fqf4 Fqs4 Gqf4 Gqs4',
  ])('keeps the supported chord %s available without changing its spelling or display policy', pitches => {
    const model = readScore(score(bar(`<music-chord id="candidate" pitches="${pitches}" duration="whole"></music-chord>`)));
    expect(model.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
    for (const endBar of ['single', 'final']) for (const duration of ['quarter', 'whole'] as const) {
      const candidate = Object.freeze(value({ kind: 'chord', pitches, duration, accidentalDisplay: 'courtesy' }));
      const before = JSON.stringify(candidate);
      const result = analyze(score(bar(note(), `end-bar="${endBar}"`), 'key="G"'), { value: candidate });
      expect(result).toMatchObject({ eligible: endBar === 'single', ending: endBar === 'final', newMeasureLabel: '2' });
      expect(JSON.stringify(candidate)).toBe(before);
    }
  });

  it('validates the requested chord in voice 2 before offering a hidden-staff final exception', () => {
    const root = ensemble('end-bar="final"');
    root.querySelector('#m')!.replaceChildren(element(`<music-voice id="lead-one">${rest('lead-rest')}</music-voice>`),
      element(`<music-voice id="lead-two">${note()}</music-voice>`));
    const cursor = { staffId: 'staff', measureId: 'm', voiceIndex: 1, eventId: 'n' };
    blocked(analyze(root, { cursor, value: value({ kind: 'chord', pitches: 'Fqf4 F4 Fqs4' }) }), /same letter and octave/i);
    expect(analyze(root, { cursor, value: value({ kind: 'chord', pitches: 'Fqf4 Fqs4' }) })).toMatchObject({
      eligible: false, ending: true, newMeasureLabel: '2',
      affectedStaves: [expect.objectContaining({ staffId: 'staff', voiceCount: 2 }),
        expect.objectContaining({ staffId: 'hidden', endBar: 'final', voiceCount: 2 })],
    });
  });

  it('keeps accepted source, history, input and authoring ID allocation unchanged during repeated model checks', () => {
    const session = new EditorSession(createProject(ensemble('end-bar="final"').outerHTML));
    session.select('n');
    session.update('Prepare redo', project => { project.metadata.title = 'Changed title'; });
    session.undo();
    const before = { project: structuredClone(session.project), score: structuredClone(session.score),
      selectionId: session.selectionId, cursor: session.cursor, revision: session.revision,
      canUndo: session.canUndo, canRedo: session.canRedo };
    const probeIdentity = (): number => {
      const probe = score(bar(note('n', 'half'), 'incomplete'));
      const id = applyCommand(probe, { type: 'insert-event', ...input() }).selectionId!;
      expect(id).toMatch(/^music-edit-note-\d+$/);
      return Number(id.split('-').at(-1));
    };
    const firstIdentity = probeIdentity();
    const observer = new MutationObserver(() => {});
    observer.observe(session.source, { attributes: true, childList: true, characterData: true, subtree: true });
    try {
      for (const pitches of ['Fqf4 F4 Fqs4', 'Fqf4 Fqs4', 'C4 Eqs4 G4']) {
        const request = Object.freeze(input({ cursor: Object.freeze({ staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'n' }),
          value: Object.freeze(value({ kind: 'chord', pitches, accidentalDisplay: 'always' })) }));
        const originalInput = JSON.stringify(request);
        const first = analyze(session.source, request);
        expect(analyze(session.source, request)).toEqual(first);
        expect(JSON.stringify(request)).toBe(originalInput);
      }
      expect(observer.takeRecords()).toEqual([]);
    } finally { observer.disconnect(); }
    expect(probeIdentity()).toBe(firstIdentity + 1);
    expect({ project: session.project, score: session.score, selectionId: session.selectionId,
      cursor: session.cursor, revision: session.revision, canUndo: session.canUndo, canRedo: session.canRedo }).toEqual(before);
  });
});

describe('input and source rejection', () => {
  it.each([
    { staffId: 'missing', measureId: 'm', voiceIndex: 0, eventId: 'n' },
    { staffId: 'staff', measureId: 'missing', voiceIndex: 0, eventId: 'n' },
    { staffId: 'staff', measureId: 'm', voiceIndex: -1, eventId: 'n' },
    { staffId: 'staff', measureId: 'm', voiceIndex: 1, eventId: 'n' },
    { staffId: 'staff', measureId: 'm', voiceIndex: 0.5, eventId: 'n' },
    { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: 'missing' },
    { staffId: 'staff', measureId: 'm', voiceIndex: 0, eventId: '' },
  ])('rejects a stale or inconsistent cursor %j', cursor => {
    blocked(analyze(score(bar(note())), { cursor }), /Choose/);
  });

  it.each([
    { duration: 'bad' }, { duration: '4' }, { dots: -1 }, { dots: 4 }, { dots: 0.5 }, { dots: undefined },
    { pitch: 'H4' }, { pitch: 'C10' }, { kind: 'chord', pitches: 'C4' },
    { kind: 'chord', pitches: 'F#4 F♯4' }, { kind: 'chord', pitches: 'C4 H4' },
    { beam: 'start' }, { beam: 'continue' }, { beam: 'end' }, { beam: 'bad' },
    { stem: 'left' }, { accidentalDisplay: 'bad' }, { measureRest: 'false' }, { rhythmic: 'false' }, { kind: 'cue' },
  ])('does not offer continuation for invalid event fields %j', overrides => {
    const result = analyze(score(bar(note())), { value: { ...value(), ...overrides } as EventInput });
    expect(result).toMatchObject({ eligible: false, ending: false });
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.newMeasureLabel).toBeUndefined();
  });

  it.each([
    value({ kind: 'chord', pitches: 'F#4 Gb4', accidentalDisplay: 'courtesy' }),
    value({ kind: 'rest', pitch: 'unused', beam: 'none', dots: 1 }),
    value({ kind: 'slash', rhythmic: false }), value({ kind: 'slash', rhythmic: true, stem: 'up' }),
  ])('accepts supported ordinary event kinds without interpreting unused pitch fields', event => {
    expect(analyze(score(bar(note())), { value: event }).eligible).toBe(true);
  });

  it.each([
    score(bar(note('a') + note())),
    score(bar(note('n', 'quarter'))),
    score(bar(note('n', 'whole', 'unknown="value"'))),
    ensemble('meter="3/4"'),
  ])('rejects initial reader errors instead of planning around invalid source', root => {
    blocked(analyze(root), /Fix the score/);
  });

  it.each([
    '<div></div>', bar(note()), '<music-voice></music-voice>',
  ])('supports only authoring staff and system roots', html => {
    blocked(analyze(element(html)), /music-system or music-staff/);
  });
});
