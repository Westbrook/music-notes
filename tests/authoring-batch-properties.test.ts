// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { analyzeEventPropertyChange, applyEventPropertyChange } from '../src/authoring/batch-properties';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession, EditorValidationError } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import type { AuthorCommand, EventPropertyChange } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { durationTime, rational } from '../src/model/index';
import type { ArticulationType, MusicEvent, PitchAlteration, Score } from '../src/model/types';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function note(id: string, attributes = 'pitch="C4" duration="eighth"', children = ''): string {
  return '<music-note id="' + id + '" ' + attributes + '>' + children + '</music-note>';
}

function score(body: string, measureAttributes = 'incomplete="true"', staffAttributes = ''): Element {
  return element('<music-system id="score"><music-staff id="staff" ' + staffAttributes
    + '><music-measure id="bar" ' + measureAttributes + '>' + body + '</music-measure></music-staff></music-system>');
}

function batch(eventIds: readonly string[], change: EventPropertyChange): AuthorCommand {
  return { type: 'set-events-property', eventIds, change };
}

function event(root: Element, id: string): MusicEvent {
  return readScore(root).score.staves.flatMap(staff => staff.measures.flatMap(measure =>
    measure.voices.flatMap(voice => voice.events))).find(value => value.id === id)!;
}

function attrs(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

function errors(root: Element): string[] {
  return readScore(root).diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function session(root: Element): EditorSession {
  const editor = new EditorSession(createProject(root.outerHTML, 'Exact selection'));
  editor.select('n2');
  return editor;
}

function sourceData(html: string): string {
  const root = element(html);
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const values = Object.entries(attrs(node)).sort(([a], [b]) => a.localeCompare(b));
    for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
    for (const [name, value] of values) node.setAttribute(name, value);
  }
  return root.outerHTML;
}

function validationCodes(action: () => unknown): string[] {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(EditorValidationError);
    return (error as EditorValidationError).diagnostics.map(item => item.code);
  }
  throw new Error('The invalid edit unexpectedly committed.');
}

describe('BATCH-PATCH-UNTOUCHED: exact property and exact membership', () => {
  it('keeps disjoint holes, source order, identities and every member’s own dots', () => {
    const root = score(note('n1', 'pitch="f4" accidental="quarter-sharp" duration="8" dotted data-user="keep"',
      '<!-- retain --> <music-articulation id="a1" type="tenuto" placement="below"></music-articulation>')
      + '<music-harmony id="h" text="C7" at="0/2"></music-harmony>'
      + note('n2', 'pitch="G4" duration="quarter"')
      + note('n3', 'pitch="A4" duration="16" dots="2" stem="down" beam="none"'));
    const nodes = ['n1', 'n2', 'n3'].map(id => root.querySelector('#' + id)!);
    const before = nodes.map(attrs);
    const content = nodes[0].innerHTML;
    const untouched = nodes[1].outerHTML;
    const result = applyCommand(root, batch(['n3', 'n1'], { property: 'duration', value: 'thirty-second' }));
    expect(result.selectionId).toBeUndefined();
    expect(result.cursor).toBeUndefined();
    expect(attrs(nodes[0])).toEqual({ ...before[0], duration: 'thirty-second' });
    expect(attrs(nodes[2])).toEqual({ ...before[2], duration: 'thirty-second' });
    expect(nodes[0].innerHTML).toBe(content);
    expect(nodes[1].outerHTML).toBe(untouched);
    expect(root.querySelector('#h')?.getAttribute('at')).toBe('0/2');
    expect([...root.querySelectorAll('music-note')]).toEqual(nodes);
    expect(event(root, 'n1').dots).toBe(1);
    expect(event(root, 'n3').dots).toBe(2);
    expect(errors(root)).toEqual([]);
  });

  it('changes dots without borrowing any selected event’s duration or normalizing a matching event', () => {
    const root = score(note('n1', 'pitch="C4" duration="8" dotted')
      + note('n2', 'pitch="D4" duration="16"')
      + note('n3', 'pitch="E4" duration="32" dots="2"'));
    const n3 = root.querySelector('#n3')!.outerHTML;
    applyCommand(root, batch(['n1', 'n2', 'n3'], { property: 'dots', value: 2 }));
    expect(['n1', 'n2', 'n3'].map(id => root.querySelector('#' + id)?.getAttribute('duration'))).toEqual(['8', '16', '32']);
    expect(root.querySelector('#n1')?.hasAttribute('dotted')).toBe(false);
    expect(event(root, 'n1').time).toEqual(durationTime('eighth', 2));
    expect(event(root, 'n2').time).toEqual(durationTime('sixteenth', 2));
    expect(root.querySelector('#n3')!.outerHTML).toBe(n3);
    expect(errors(root)).toEqual([]);
  });

  it.each([
    { property: 'duration', value: 'eighth' }, { property: 'dots', value: 1 },
    { property: 'stem', value: 'auto' }, { property: 'accidentalDisplay', value: 'courtesy' },
    { property: 'alter', value: 0.5, ties: 'reject' },
    { property: 'articulation', value: 'tenuto', present: true },
    { property: 'articulation', value: 'accent', present: false },
  ] satisfies EventPropertyChange[])('preserves a literal no-op for $property', change => {
    const root = score(note('n1', 'pitch="f4" accidental="quarter-sharp" duration="8" dotted stem="auto" accidental-display="courtesy"',
      '<music-articulation id="a1" type="tenuto" placement="below" data-legacy="keep"></music-articulation>')
      + note('n2', 'pitch="Fqs4" duration="eighth" dots="1" accidental-display="courtesy"',
        '<music-articulation id="a2" type="tenuto" placement="above"></music-articulation>'));
    const before = root.outerHTML;
    const result = applyCommand(root, batch(['n2', 'n1'], change));
    expect(result.message).toContain('nothing changed');
    expect(result.selectionId).toBeUndefined();
    expect(result.cursor).toBeUndefined();
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    '<music-chord id="n2" pitches="Cqs4 E4 G4" duration="quarter"></music-chord>',
    '<music-rest id="n2" duration="quarter"></music-rest>',
    '<music-slash id="n2" duration="quarter" rhythmic></music-slash>',
  ])('changes written duration on compatible mixed event kinds: %s', body => {
    const root = score(note('n1') + body);
    const accepted = event(root, 'n2');
    applyCommand(root, batch(['n1', 'n2'], { property: 'duration', value: 'sixteenth' }));
    expect(event(root, 'n2')).toMatchObject({ kind: accepted.kind, pitches: accepted.pitches, rhythmic: accepted.rhythmic, duration: 'sixteenth' });
    expect(errors(root)).toEqual([]);
  });

  it.each(['rhythm', 'road'] as const)('retains pitch-free %s semantics and local markings', kind => {
    const staffAttributes = kind === 'road' ? 'notation="three-roads"' : 'notation="rhythm"';
    const direction = kind === 'road' ? ' direction="lower"' : '';
    const root = score('<music-' + kind + ' id="n1" duration="quarter"' + direction
      + '><music-articulation id="a1" type="accent"></music-articulation></music-' + kind + '>'
      + '<music-rest id="n2" duration="quarter"></music-rest>', 'incomplete', staffAttributes);
    const marks = root.querySelector('#n1')!.innerHTML;
    applyCommand(root, batch(['n1', 'n2'], { property: 'dots', value: 1 }));
    expect(event(root, 'n1').dots).toBe(1);
    expect(event(root, 'n2').dots).toBe(1);
    expect(event(root, 'n1').pitches).toEqual([]);
    expect(event(root, 'n1').pitchDirection).toBe(kind === 'road' ? 'lower' : undefined);
    expect(root.querySelector('#n1')!.innerHTML).toBe(marks);
    expect(errors(root)).toEqual([]);
  });

  it.each([
    '<music-rest id="n2" measure></music-rest>',
    '<music-slash id="n2" duration="whole"></music-slash>',
  ])('rejects the whole rhythm batch when its last member has no written attack: %s', bad => {
    const root = element('<music-staff id="staff"><music-measure id="b1" incomplete>' + note('n1')
      + '</music-measure><music-measure id="b2">' + bad + '</music-measure></music-staff>');
    const before = root.outerHTML;
    for (const change of [{ property: 'duration', value: 'sixteenth' }, { property: 'dots', value: 1 }] satisfies EventPropertyChange[]) {
      expect(() => applyCommand(root, batch(['n1', 'n2'], change))).toThrow();
      expect(root.outerHTML).toBe(before);
    }
  });

  it.each([[], ['n1', 'n1'], ['n1', 'missing'], ['n1', 'mark'], ['n1', 'bar']].map(ids => ({ ids })))('rejects empty, repeated or non-event IDs before any edit: $ids', ({ ids }) => {
    const root = score(note('n1', 'pitch="C4" duration="quarter"', '<music-articulation id="mark" type="accent"></music-articulation>'));
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(ids, { property: 'duration', value: 'eighth' }))).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    { property: 'duration', value: 'invalid' }, { property: 'dots', value: 0.5 }, { property: 'dots', value: 4 },
    { property: 'stem', value: 'sideways' }, { property: 'accidentalDisplay', value: 'sometimes' },
    { property: 'alter', value: 0.25, ties: 'reject' }, { property: 'alter', value: 1, ties: 'clear' },
    { property: 'articulation', value: 'slur', present: true }, { property: 'articulation', value: 'accent', present: 'yes' },
    { property: 'beam', value: 'start' },
  ])('rejects unsupported runtime property input before mutation: %j', change => {
    const root = score(note('n1') + note('n2'));
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['n1', 'n2'], change as EventPropertyChange))).toThrow();
    expect(root.outerHTML).toBe(before);
  });
});

describe('BATCH-ALTERATION: absolute spellings and truthful eligibility', () => {
  it.each([-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2] satisfies PitchAlteration[])('sets supported absolute alteration %s on each original letter/octave', value => {
    const root = score(note('n1', 'pitch="f4" accidental="sharp" duration="8" dotted accidental-display="courtesy"')
      + note('n2', 'pitch="Bb3" duration="quarter" accidental-display="always"'), 'incomplete', 'key="G"');
    const before = ['n1', 'n2'].map(id => event(root, id));
    applyCommand(root, batch(['n1', 'n2'], { property: 'alter', value, ties: 'reject' }));
    for (const [index, id] of ['n1', 'n2'].entries()) {
      expect(event(root, id).pitches[0]).toEqual({ ...before[index].pitches[0], alter: value });
      expect(event(root, id).time).toEqual(before[index].time);
    }
    expect(root.querySelector('#n1')?.hasAttribute('accidental')).toBe(value === 1);
    expect(root.querySelector('#n1')?.getAttribute('duration')).toBe('8');
    expect(root.querySelector('#n1')?.hasAttribute('dotted')).toBe(true);
    expect(errors(root)).toEqual([]);
  });

  it.each(['start', 'end'] as const)('rejects a tied %s member even when its alteration already matches', tie => {
    const root = score(note('free', 'pitch="G4" duration="quarter"')
      + note('n1', 'pitch="F#4" duration="quarter" tie="start"')
      + note('n2', 'pitch="F#4" duration="quarter" tie="end"'));
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['free', tie === 'start' ? 'n1' : 'n2'], { property: 'alter', value: 1, ties: 'reject' })))
      .toThrow('Clear the connected tie chain');
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    '<music-chord id="n2" pitches="C4 E4" duration="quarter"></music-chord>',
    '<music-rest id="n2" duration="quarter"></music-rest>',
    '<music-slash id="n2" duration="quarter" rhythmic></music-slash>',
  ])('does not alter an eligible first note when another member is not a single note: %s', other => {
    const root = score(note('n1') + other);
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['n1', 'n2'], { property: 'alter', value: 1, ties: 'reject' }))).toThrow('single');
    expect(root.outerHTML).toBe(before);
  });
});

describe('BATCH-ARTICULATION: add missing and remove only the named type', () => {
  const existing = '<music-articulation id="kept" type="accent" placement="below" data-author="legacy"><!-- inside --></music-articulation>';

  it('keeps existing marks byte-for-byte and creates one automatic mark only where missing', () => {
    const root = score(note('n1', 'pitch="C4" duration="quarter"', existing
      + '<music-ornament id="orn" type="trill" placement="below"></music-ornament>')
      + note('gap') + note('n2', 'pitch="D4" duration="quarter"', '<!-- next -->'));
    const oldMark = root.querySelector('#kept')!;
    const gap = root.querySelector('#gap')!.outerHTML;
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value: 'accent', present: true }));
    expect(root.querySelector('#kept')).toBe(oldMark);
    expect(oldMark.outerHTML).toBe(existing);
    expect(root.querySelector('#gap')!.outerHTML).toBe(gap);
    const added = root.querySelector('#n2 > music-articulation')!;
    expect(added.id).toBeTruthy();
    expect(added.getAttribute('type')).toBe('accent');
    expect(added.hasAttribute('placement')).toBe(false);
    expect(root.querySelectorAll('music-articulation')).toHaveLength(2);
    const after = root.outerHTML;
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value: 'accent', present: true }));
    expect(root.outerHTML).toBe(after);
    expect(errors(root)).toEqual([]);
  });

  it('removes only exact articulation matches, preserving other children and absent members', () => {
    const root = score(note('n1', 'pitch="C4" duration="quarter"', existing
      + '<!-- retain --> <music-articulation id="tenuto" type="tenuto" placement="above"></music-articulation>'
      + '<music-ornament id="orn" type="trill" placement="below"></music-ornament>')
      + '<music-rest id="n2" duration="quarter"><music-articulation id="fermata" type="fermata"></music-articulation></music-rest>');
    const unchanged = ['tenuto', 'orn', 'n2'].map(id => root.querySelector('#' + id)!.outerHTML);
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value: 'accent', present: false }));
    expect(root.querySelector('#kept')).toBeNull();
    expect(['tenuto', 'orn', 'n2'].map(id => root.querySelector('#' + id)!.outerHTML)).toEqual(unchanged);
    expect(root.outerHTML).toContain('<!-- retain -->');
    expect(errors(root)).toEqual([]);
  });

  it.each([
    '<music-rest id="n2" measure></music-rest>',
    '<music-slash id="n2" duration="whole"></music-slash>',
  ])('allows fermata but refuses accent on every non-attack event: %s', rest => {
    const root = element('<music-staff id="staff"><music-measure id="bar" incomplete>' + note('n1')
      + '</music-measure><music-measure id="next">' + rest + '</music-measure></music-staff>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value: 'accent', present: true }))).toThrow('fermata');
    expect(root.outerHTML).toBe(before);
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value: 'fermata', present: true }));
    expect(root.querySelectorAll('music-articulation[type="fermata"]')).toHaveLength(2);
    expect(errors(root)).toEqual([]);
  });

  it.each(['accent', 'staccato', 'tenuto', 'marcato', 'staccatissimo', 'fermata'] satisfies ArticulationType[])('adds/removes supported %s without removing a different type', value => {
    const otherType = value === 'fermata' ? 'accent' : 'fermata';
    const root = score(note('n1', 'pitch="C4" duration="quarter"',
      '<music-articulation id="other" type="' + otherType + '" placement="above"></music-articulation>')
      + '<music-chord id="n2" pitches="C4 E4" duration="quarter"></music-chord>');
    const other = root.querySelector('#other')!.outerHTML;
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value, present: true }));
    expect(root.querySelectorAll('music-articulation[type="' + value + '"]')).toHaveLength(2);
    expect(root.querySelector('#other')!.outerHTML).toBe(other);
    applyCommand(root, batch(['n1', 'n2'], { property: 'articulation', value, present: false }));
    expect(root.querySelectorAll('music-articulation[type="' + value + '"]')).toHaveLength(0);
    expect(root.querySelector('#other')!.outerHTML).toBe(other);
    expect(errors(root)).toEqual([]);
  });

  it('keeps articulations local to the exact selected road segment without editing its sustained harmony', () => {
    const root = score('<music-road id="n1" direction="higher" duration="half" tie="start">'
      + '<music-interval id="i1" value="b3" placement="below"></music-interval>'
      + '<music-ornament id="orn" type="turn" placement="below"></music-ornament></music-road>'
      + '<music-road id="n2" direction="same" duration="half" tie="end">'
      + '<music-interval id="i2" value="b3" placement="below"></music-interval></music-road>', '', 'notation="three-roads"');
    const before = root.querySelector('#n1')!.outerHTML;
    const interval = root.querySelector('#i2')!.outerHTML;
    const written = attrs(root.querySelector('#n2')!);
    applyCommand(root, batch(['n2'], { property: 'articulation', value: 'tenuto', present: true }));
    expect(root.querySelector('#n1')!.outerHTML).toBe(before);
    expect(root.querySelector('#i2')!.outerHTML).toBe(interval);
    expect(attrs(root.querySelector('#n2')!)).toEqual(written);
    expect(root.querySelectorAll('#n2 > music-articulation[type="tenuto"]')).toHaveLength(1);
    expect(errors(root)).toEqual([]);
  });

  it('allocates IDs only for missing marks and never for a no-op or rejected late member', () => {
    const root = score(note('n1', 'pitch="C4" duration="quarter"', existing)
      + note('n2') + '<music-rest id="rest" duration="quarter"></music-rest>');
    const create = vi.fn((tag: string) => {
      const node = document.createElement(tag);
      node.id = 'new-' + create.mock.calls.length;
      return node;
    });
    let parsed = readScore(root);
    const change = { property: 'articulation', value: 'accent', present: true } as const;
    expect(() => applyEventPropertyChange(parsed.score, parsed.sources, ['n2', 'rest'], change, create)).toThrow('fermata');
    expect(create).not.toHaveBeenCalled();
    applyEventPropertyChange(parsed.score, parsed.sources, ['n1', 'n2'], change, create);
    expect(create).toHaveBeenCalledTimes(1);
    parsed = readScore(root);
    const after = root.outerHTML;
    applyEventPropertyChange(parsed.score, parsed.sources, ['n2', 'n1'], change, create);
    expect(create).toHaveBeenCalledTimes(1);
    expect(root.outerHTML).toBe(after);
  });
});

describe('BATCH-APPEARANCE: compatible stem and display policies', () => {
  it.each([
    ['note', 'pitch="C4"', ''], ['chord', 'pitches="C4 E4"', ''],
    ['rhythm', '', 'notation="rhythm"'], ['road', 'direction="higher"', 'notation="three-roads"'],
    ['slash', 'rhythmic', ''],
  ])('sets only the stem policy on a stem-bearing %s', (kind, attributes, staffAttributes) => {
    const root = score('<music-' + kind + ' id="n1" duration="eighth" ' + attributes
      + ' data-keep="yes"><!-- keep --></music-' + kind + '>', 'incomplete="true"', staffAttributes);
    const node = root.querySelector('#n1')!;
    const before = attrs(node);
    applyCommand(root, batch(['n1'], { property: 'stem', value: 'down' }));
    expect(attrs(node)).toEqual({ ...before, stem: 'down' });
    expect(node.innerHTML).toBe('<!-- keep -->');
    expect(root.querySelector('#bar')?.getAttribute('incomplete')).toBe('true');
    applyCommand(root, batch(['n1'], { property: 'stem', value: 'auto' }));
    expect(attrs(node)).toEqual(before);
    expect(errors(root)).toEqual([]);
  });

  it.each([
    '<music-rest id="n2" duration="eighth"></music-rest>',
    '<music-rest id="n2" measure></music-rest>',
    '<music-slash id="n2" duration="eighth"></music-slash>',
    note('n2', 'pitch="C4" duration="whole"'),
    note('n2', 'pitch="C4" duration="breve"'),
  ])('rejects stemless members without changing an eligible first note: %s', other => {
    const root = element('<music-staff id="staff"><music-measure id="bar" incomplete>' + note('n1')
      + '</music-measure><music-measure id="next" meter="2/1" incomplete>' + other + '</music-measure></music-staff>');
    const before = root.outerHTML;
    for (const value of ['up', 'auto'] as const) {
      expect(() => applyCommand(root, batch(['n1', 'n2'], { property: 'stem', value }))).toThrow('stem-bearing');
      expect(root.outerHTML).toBe(before);
    }
  });

  it.each(['auto', 'always', 'courtesy'] as const)('applies explicit uniform %s display without touching chord spelling or rhythm', value => {
    const root = score(note('n1', 'pitch="f4" accidental="sharp" duration="8" dotted accidental-display="courtesy"')
      + '<music-chord id="n2" pitches="cqs4  E♭4 G4" duration="16" dots="2" accidental-display="always" stem="up"><!-- tones --></music-chord>');
    const nodes = ['n1', 'n2'].map(id => root.querySelector('#' + id)!);
    const before = nodes.map(attrs);
    const pitches = ['n1', 'n2'].map(id => event(root, id).pitches);
    applyCommand(root, batch(['n1', 'n2'], { property: 'accidentalDisplay', value }));
    nodes.forEach((node, index) => {
      const expected = { ...before[index] };
      if (value === 'auto') delete expected['accidental-display'];
      else expected['accidental-display'] = value;
      expect(attrs(node)).toEqual(expected);
      expect(event(root, node.id).pitches).toEqual(pitches[index].map(pitch => ({ ...pitch, display: value })));
    });
    expect(nodes[1].innerHTML).toBe('<!-- tones -->');
    expect(root.querySelector('#bar')?.getAttribute('incomplete')).toBe('true');
    expect(errors(root)).toEqual([]);
  });

  it('permits display changes on tied notes without editing pitch or the chain', () => {
    const root = score(note('n1', 'pitch="Fqs4" duration="half" tie="start"')
      + note('n2', 'pitch="Fqs4" duration="half" tie="end"'), '');
    const before = ['n1', 'n2'].map(id => event(root, id));
    applyCommand(root, batch(['n1', 'n2'], { property: 'accidentalDisplay', value: 'courtesy' }));
    for (const [index, id] of ['n1', 'n2'].entries()) {
      expect(event(root, id)).toEqual({ ...before[index], pitches: before[index].pitches.map(pitch => ({ ...pitch, display: 'courtesy' })) });
    }
    expect(errors(root)).toEqual([]);
  });

  it('rejects pitch-display changes on a pitch-free member without touching the pitched member', () => {
    const root = score(note('n1') + '<music-rest id="n2" duration="quarter"></music-rest>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['n1', 'n2'], { property: 'accidentalDisplay', value: 'courtesy' }))).toThrow('pitched');
    expect(root.outerHTML).toBe(before);
  });
});

describe('BATCH-TRANSACTION: aggregate validation, rollback and history', () => {
  it('changes a whole explicit beam without rejecting an intermediate stem conflict', () => {
    const root = score(note('n1', 'pitch="C4" duration="eighth" beam="start" stem="down"')
      + note('n2', 'pitch="D4" duration="eighth" beam="end" stem="down"'), 'meter="1/4"');
    const editor = session(root);
    const before = editor.project.sourceHtml;
    const node = editor.source.querySelector('#n1');
    const cursor = editor.cursor;
    editor.execute(batch(['n1', 'n2'], { property: 'stem', value: 'up' }));
    expect(editor.revision).toBe(1);
    expect(editor.selectionId).toBe('n2');
    expect(editor.cursor).toEqual(cursor);
    expect(editor.source.querySelector('#n1')).toBe(node);
    expect(['n1', 'n2'].map(id => event(editor.source, id).stem)).toEqual(['up', 'up']);
    expect(errors(editor.source)).toEqual([]);
    const after = editor.project.sourceHtml;
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.project.sourceHtml).toBe(after);
  });

  it('rejects partial explicit beam conflicts with no source or history change', () => {
    const editor = session(score(note('n1', 'pitch="C4" duration="eighth" beam="start" stem="down"')
      + note('n2', 'pitch="D4" duration="eighth" beam="end" stem="down"'), 'meter="1/4"'));
    const before = editor.project;
    expect(validationCodes(() => editor.execute(batch(['n1'], { property: 'stem', value: 'up' })))).toContain('beam-stem-conflict');
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('rolls back all members on overflow, preserves redo, then recovers in one undo step', () => {
    const editor = session(score(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), ''));
    editor.execute(batch(['n1', 'n2'], { property: 'alter', value: 1, ties: 'reject' }));
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    expect(validationCodes(() => editor.execute(batch(['n1', 'n2'], { property: 'dots', value: 1 })))).toContain('measure-overfull');
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(revision);
    expect(editor.selectionId).toBe('n2');
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    editor.execute(batch(['n1', 'n2'], { property: 'duration', value: 'quarter' }));
    expect(editor.revision).toBe(revision + 1);
    expect(editor.score.staves[0].measures[0].incomplete).toBe(true);
    expect(editor.source.querySelectorAll('music-rest')).toHaveLength(0);
    expect(editor.canRedo).toBe(false);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before.sourceHtml));
    expect(editor.canUndo).toBe(false);
  });

  it('preserves source, selection, cursor, redo and review state for an all-no-op batch', () => {
    const project = createProject(score(note('n1', 'pitch="F4" accidental="sharp" duration="8" dotted')
      + note('n2', 'pitch="G#4" duration="8" dotted')).outerHTML, 'No-op review');
    project.reviewedShortMeasures = ['bar'];
    project.layouts.score.reviewedTurns[project.columns[0].id] = 'reviewed';
    const editor = new EditorSession(project);
    editor.select('n2');
    editor.execute(batch(['n1', 'n2'], { property: 'alter', value: 0, ties: 'reject' }));
    editor.undo();
    const before = editor.project;
    const revision = editor.revision;
    const cursor = editor.cursor;
    for (const change of [
      { property: 'alter', value: 1, ties: 'reject' }, { property: 'duration', value: 'eighth' },
      { property: 'dots', value: 1 }, { property: 'articulation', value: 'accent', present: false },
    ] satisfies EventPropertyChange[]) editor.execute(batch(['n1', 'n2'], change));
    expect(editor.project).toEqual(before);
    expect(editor.selectionId).toBe('n2');
    expect(editor.cursor).toEqual(cursor);
    expect(editor.revision).toBe(revision);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
    expect(editor.project.reviewedShortMeasures).toEqual(['bar']);
    expect(editor.project.layouts.score.reviewedTurns).toEqual(before.layouts.score.reviewedTurns);
  });

  it('keeps nested tuplet ratios and parents while changing exact elapsed time', () => {
    const root = score('<music-tuplet id="outer" actual="3" normal="2"><music-tuplet id="inner" actual="3" normal="2">'
      + note('n1', 'pitch="C4" duration="sixteenth"') + note('n2', 'pitch="D4" duration="sixteenth"')
      + note('n3', 'pitch="E4" duration="sixteenth"') + '</music-tuplet>'
      + note('n4', 'pitch="F4" duration="eighth"') + note('n5', 'pitch="G4" duration="eighth"') + '</music-tuplet>', 'meter="1/4"');
    const editor = session(root);
    const tuplets = editor.score.staves[0].measures[0].voices[0].tuplets;
    const parent = editor.source.querySelector('#n1')!.parentElement;
    const untouched = editor.source.querySelector('#n2')!.outerHTML;
    editor.execute(batch(['n1', 'n3'], { property: 'duration', value: 'thirty-second' }));
    expect(editor.source.querySelector('#n1')!.parentElement).toBe(parent);
    expect(editor.source.querySelector('#n2')!.outerHTML).toBe(untouched);
    expect(editor.score.staves[0].measures[0].voices[0].tuplets).toEqual(tuplets);
    expect(event(editor.source, 'n1').time).toEqual(rational(1, 72));
    expect(event(editor.source, 'n3').time).toEqual(rational(1, 72));
    expect(event(editor.source, 'n4').onset).toEqual(rational(1, 18));
    expect(editor.revision).toBe(1);
    expect(errors(editor.source)).toEqual([]);
  });

  it.each([false, true])('preserves sequential versus explicit instruction anchoring (explicit: %s)', explicit => {
    const root = score(note('n1', 'pitch="C4" duration="half"')
      + '<music-harmony id="h" text="G7"' + (explicit ? ' at="2/4"' : '') + '></music-harmony>'
      + note('n2', 'pitch="D4" duration="half"'), '');
    const annotation = root.querySelector('#h')!.outerHTML;
    const editor = session(root);
    editor.execute(batch(['n1', 'n2'], { property: 'duration', value: 'quarter' }));
    expect(editor.source.querySelector('#h')!.outerHTML).toBe(annotation);
    expect(editor.score.staves[0].measures[0].annotations[0].onset).toEqual(explicit ? rational(1, 2) : rational(1, 4));
    expect(editor.revision).toBe(1);
    expect(errors(editor.source)).toEqual([]);
  });

  it('edits voice two across bars while preserving ties, other voices, gaps and an independent cursor', () => {
    const root = element('<music-staff id="staff"><music-measure id="bar1" incomplete>'
      + '<music-voice id="v11"><music-rest id="rest1" measure></music-rest></music-voice>'
      + '<music-voice id="v12">' + note('gap1', 'pitch="C4" duration="quarter"')
      + note('n1', 'pitch="Gqs4" duration="half" tie="start"') + '</music-voice></music-measure>'
      + '<music-measure id="bar2" incomplete><music-voice id="v21"><music-rest id="rest2" measure></music-rest></music-voice>'
      + '<music-voice id="v22">' + note('n2', 'pitch="Gqs4" duration="half" tie="end"')
      + note('gap2', 'pitch="D4" duration="quarter"') + '</music-voice></music-measure></music-staff>');
    const editor = session(root);
    editor.setCursor({ staffId: 'staff', measureId: 'bar1', voiceIndex: 0, eventId: 'rest1' });
    const cursor = editor.cursor;
    const before = editor.project.sourceHtml;
    const retained = ['v11', 'v21', 'gap1', 'gap2'].map(id => editor.source.querySelector('#' + id)!.outerHTML);
    editor.execute(batch(['n2', 'n1'], { property: 'dots', value: 1 }));
    expect(editor.cursor).toEqual(cursor);
    expect(editor.selectionId).toBe('n2');
    expect(event(editor.source, 'n1')).toMatchObject({ tie: 'start', dots: 1, time: rational(3, 4) });
    expect(event(editor.source, 'n2')).toMatchObject({ tie: 'end', dots: 1, time: rational(3, 4) });
    expect(['v11', 'v21', 'gap1', 'gap2'].map(id => editor.source.querySelector('#' + id)!.outerHTML)).toEqual(retained);
    expect(editor.revision).toBe(1);
    expect(errors(editor.source)).toEqual([]);
    editor.undo();
    expect(sourceData(editor.project.sourceHtml)).toBe(sourceData(before));
    expect(editor.cursor).toEqual(cursor);
    expect(editor.selectionId).toBe('n2');
    expect(editor.canUndo).toBe(false);
  });

  it('rejects an ensemble pickup mismatch instead of changing unselected staves or adding draft flags', () => {
    const root = element('<music-system id="score"><music-staff id="upper"><music-measure id="bar" pickup>'
      + note('n1') + note('n2') + '</music-measure></music-staff><music-staff id="lower">'
      + '<music-measure id="lower-bar" pickup>' + note('lower-note', 'pitch="C3" duration="quarter"')
      + '</music-measure></music-staff></music-system>');
    const editor = session(root);
    const before = editor.project;
    const cursor = editor.cursor;
    expect(validationCodes(() => editor.execute(batch(['n1', 'n2'], { property: 'duration', value: 'sixteenth' }))))
      .toContain('staff-pickup-duration-mismatch');
    expect(editor.project).toEqual(before);
    expect(editor.cursor).toEqual(cursor);
    expect(editor.revision).toBe(0);
    expect(editor.source.querySelectorAll('[incomplete]')).toHaveLength(0);
    expect(editor.canUndo).toBe(false);
  });

  it('rejects a duration change that breaks an existing beam without silently removing it', () => {
    const editor = session(score(note('n1', 'pitch="C4" duration="eighth" beam="start"')
      + note('n2', 'pitch="D4" duration="eighth" beam="end"'), 'incomplete'));
    const before = editor.project;
    expect(validationCodes(() => editor.execute(batch(['n1', 'n2'], { property: 'duration', value: 'quarter' }))))
      .toContain('invalid-beam-member');
    expect(editor.project).toEqual(before);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });
});

describe('BATCH-ANALYSIS: pure admission, exact set and source preflight', () => {
  it('reports the exact changed IDs without writing the score, source, inputs or identities', () => {
    const root = score(note('n1', 'pitch="C4" duration="eighth"') + note('n2', 'pitch="D4" duration="quarter"')
      + note('gap') + note('n3', 'pitch="E4" duration="eighth"'));
    const accepted = readScore(root).score;
    const before = structuredClone(accepted);
    const html = root.outerHTML;
    const ids = Object.freeze(['n3', 'n2', 'n1']);
    const change = Object.freeze({ property: 'duration', value: 'eighth' } as const);
    for (let index = 0; index < 3; index++) {
      expect(analyzeEventPropertyChange(accepted, ids, change)).toEqual({ eligible: true, changedEventIds: ['n2'] });
    }
    expect(accepted).toEqual(before);
    expect(root.outerHTML).toBe(html);
    expect(ids).toEqual(['n3', 'n2', 'n1']);
    expect(change).toEqual({ property: 'duration', value: 'eighth' });
  });

  it('does not confuse a pure admission result with whole-score capacity validation', () => {
    const root = score(note('n1', 'pitch="C4" duration="half"') + note('n2', 'pitch="D4" duration="half"'), '');
    const change = { property: 'dots', value: 1 } as const;
    expect(analyzeEventPropertyChange(readScore(root).score, ['n1', 'n2'], change)).toEqual({ eligible: true, changedEventIds: ['n1', 'n2'] });
    const editor = session(root);
    expect(validationCodes(() => editor.execute(batch(['n1', 'n2'], change)))).toContain('measure-overfull');
    expect(editor.revision).toBe(0);
  });

  it.each(['staff', 'voice'] as const)('rejects cross-%s sets even though each member alone is eligible', boundary => {
    const root = boundary === 'staff'
      ? element('<music-system id="score"><music-staff id="s1"><music-measure id="b1" incomplete>' + note('n1')
        + '</music-measure></music-staff><music-staff id="s2"><music-measure id="b2" incomplete>' + note('n2')
        + '</music-measure></music-staff></music-system>')
      : score('<music-voice id="v1">' + note('n1') + '</music-voice><music-voice id="v2">' + note('n2') + '</music-voice>');
    const change = { property: 'stem', value: 'down' } as const;
    const accepted = readScore(root).score;
    for (const id of ['n1', 'n2']) expect(analyzeEventPropertyChange(accepted, [id], change).eligible).toBe(true);
    expect(analyzeEventPropertyChange(accepted, ['n1', 'n2'], change)).toMatchObject({ eligible: false, reason: expect.stringContaining('one staff and voice'), changedEventIds: [] });
    const before = root.outerHTML;
    expect(() => applyCommand(root, batch(['n1', 'n2'], change))).toThrow('one staff and voice');
    expect(root.outerHTML).toBe(before);
  });

  it('detects mixed chord display without treating the first tone as the entire event', () => {
    const root = score('<music-chord id="n1" pitches="C4 E4 G4" duration="quarter"></music-chord>');
    const original = readScore(root).score;
    const chord = original.staves[0].measures[0].voices[0].events[0];
    const mixed: MusicEvent = { ...chord, pitches: chord.pitches.map((pitch, index) => ({ ...pitch, display: index === 0 ? 'auto' : 'courtesy' })) };
    const accepted: Score = { ...original, staves: original.staves.map(staff => ({
      ...staff, measures: staff.measures.map(measure => ({
        ...measure, voices: measure.voices.map(voice => ({ ...voice, events: [mixed] })),
      })),
    })) };
    expect(analyzeEventPropertyChange(accepted, ['n1'], { property: 'accidentalDisplay', value: 'auto' }))
      .toEqual({ eligible: true, changedEventIds: ['n1'] });
    const before = structuredClone(mixed);
    expect(analyzeEventPropertyChange(accepted, ['n1'], { property: 'stem', value: 'down' }).eligible).toBe(true);
    expect(mixed).toEqual(before);
    expect(root.querySelector('#n1')?.getAttribute('pitches')).toBe('C4 E4 G4');
  });

  it.each(([undefined, null, '', ['n1', undefined], ['n1', 4]] as unknown[]).map(ids => ({ ids })))('rejects malformed runtime membership without mutating source: $ids', ({ ids }) => {
    const root = score(note('n1'));
    const change = { property: 'dots', value: 1 } as const;
    const before = root.outerHTML;
    expect(analyzeEventPropertyChange(readScore(root).score, ids as string[], change).eligible).toBe(false);
    expect(() => applyCommand(root, batch(ids as string[], change))).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    { name: 'array', value: ['eighth'] },
    { name: 'boxed string', value: new String('eighth') },
    { name: 'coercible object', value: { toString: (): string => 'eighth' } },
  ])('BATCH-DURATION-TYPE: rejects a $name instead of normalizing an accepted alias', ({ value }) => {
    const root = score(note('n1', 'pitch="C4" duration="8" dotted') + note('n2', 'pitch="D4" duration="8" dotted'));
    const change = { property: 'duration', value } as EventPropertyChange;
    const before = root.outerHTML;
    expect(analyzeEventPropertyChange(readScore(root).score, ['n1', 'n2'], change).eligible).toBe(false);
    expect(() => applyCommand(root, batch(['n1', 'n2'], change))).toThrow('duration');
    expect(root.outerHTML).toBe(before);
    const editor = session(root);
    const accepted = editor.project;
    expect(() => editor.execute(batch(['n1', 'n2'], change))).toThrow('duration');
    expect(editor.project).toEqual(accepted);
    expect(editor.revision).toBe(0);
    expect(editor.canUndo).toBe(false);
  });

  it('preflights every removal source before mutating the first selected event', () => {
    const root = score(note('n1', 'pitch="C4" duration="quarter"', '<music-articulation id="a1" type="accent"></music-articulation>')
      + note('n2', 'pitch="D4" duration="quarter"', '<music-articulation id="a2" type="accent"></music-articulation>'));
    const parsed = readScore(root);
    const sources = new Map(parsed.sources);
    sources.set('a2', sources.get('a1')!);
    const before = root.outerHTML;
    const create = vi.fn((tag: string) => document.createElement(tag));
    expect(() => applyEventPropertyChange(parsed.score, sources, ['n1', 'n2'],
      { property: 'articulation', value: 'accent', present: false }, create)).toThrow('direct child');
    expect(root.outerHTML).toBe(before);
    expect(create).not.toHaveBeenCalled();
  });

  it('preflights even a no-op member’s source before changing another member', () => {
    const root = score(note('n1', 'pitch="C4" duration="eighth"') + note('n2', 'pitch="D4" duration="sixteenth"'));
    const parsed = readScore(root);
    const sources = new Map(parsed.sources);
    sources.delete('n2');
    const before = root.outerHTML;
    expect(() => applyEventPropertyChange(parsed.score, sources, ['n1', 'n2'],
      { property: 'duration', value: 'sixteenth' }, tag => document.createElement(tag))).toThrow('no longer matches');
    expect(root.outerHTML).toBe(before);
  });
});
