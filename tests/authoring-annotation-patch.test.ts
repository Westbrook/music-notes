// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/authoring/commands';
import { EditorSession } from '../src/authoring/editor';
import { createProject } from '../src/authoring/project';
import type { AnnotationInput, AuthorCommand } from '../src/authoring/types';
import { readScore } from '../src/dom/index';
import { formatRational, rational } from '../src/model/index';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function score(markup: string): Element {
  return element(`<music-staff id="staff"><music-measure id="bar"><music-note id="before" pitch="C4" duration="quarter"></music-note>${markup}<music-note id="after" pitch="D4" duration="half" dots="1"></music-note></music-measure></music-staff>`);
}

function annotation(root: Element) { return readScore(root).score.staves[0].measures[0].annotations[0]; }

function input(root: Element, changes: Partial<AnnotationInput> = {}): AnnotationInput {
  const current = annotation(root);
  return { kind: current.kind, text: current.text, at: formatRational(current.onset), placement: current.placement,
    ...(current.bpm === undefined ? {} : { bpm: current.bpm }), ...(current.beat === undefined ? {} : { beat: current.beat }),
    ...(current.dots === undefined ? {} : { dots: current.dots }), ...changes };
}

function command(root: Element, fields: readonly (keyof AnnotationInput)[], changes: Partial<AnnotationInput> = {}): Extract<AuthorCommand, { type: 'update-annotation' }> {
  return { type: 'update-annotation', annotationId: 'mark', value: input(root, changes), fields };
}

function attrs(node: Element): Record<string, string> {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

function errors(root: Element): string[] {
  return readScore(root).diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function editor(root: Element): EditorSession {
  const project = createProject(root.outerHTML, 'Annotation patches', [
    { id: 'one', label: 'Part one', staffIds: ['staff'] }, { id: 'two', label: 'Part two', staffIds: ['staff'] },
  ]);
  const session = new EditorSession(project);
  session.select('mark');
  return session;
}

describe('annotation field patch regressions', () => {
  it('MARK-PATCH-UNTOUCHED: a BPM patch preserves literal text, onset, beat aliases, dots, comments, and source identity', () => {
    const root = score('<music-tempo id="mark" marking=" Easy swing " text="shadowed text" at="0/2" bpm="0112.00" beat="8" dotted data-author="keep">\n<!--keep comment-->ignored body\n</music-tempo>');
    const node = root.querySelector('#mark')!;
    const before = attrs(node);
    const body = node.innerHTML;
    applyCommand(root, command(root, ['bpm'], { bpm: 96, text: 'DO NOT APPLY', at: '3/4', beat: 'whole', dots: 0, placement: 'below' }));
    expect(root.querySelector('#mark')).toBe(node);
    expect(attrs(node)).toEqual({ ...before, bpm: '96' });
    expect(node.innerHTML).toBe(body);
    expect(annotation(root)).toMatchObject({ text: ' Easy swing ', onset: rational(0), beat: 'eighth', dots: 1, placement: 'above', bpm: 96 });
    expect(errors(root)).toEqual([]);
  });

  it('MARK-PATCH-UNTOUCHED: a text patch preserves sequential anchoring and absent placement', () => {
    const root = score('<music-harmony id="mark" text="Dm9" data-author="keep"><!--keep comment--></music-harmony>');
    const node = root.querySelector('#mark')!;
    const before = attrs(node);
    applyCommand(root, command(root, ['text'], { text: 'G13', at: '0', placement: 'below' }));
    expect(attrs(node)).toEqual({ ...before, text: 'G13' });
    expect(node.innerHTML).toBe('<!--keep comment-->');
    expect(annotation(root).onset).toEqual(rational(1, 4));
    expect(errors(root)).toEqual([]);
  });

  it('MARK-SCOPE-ONLY: changes recipients in one undo step with identical musical HTML', () => {
    const session = editor(score('<music-tempo id="mark" marking=" Swing " at="0/2" bpm="9e1" beat="4" dotted="true" data-author="keep"><!--keep--></music-tempo>'));
    const before = session.project.sourceHtml;
    const node = session.source.querySelector('#mark');
    const result = session.execute(command(session.source, []), (project, result) => { project.instructionScopes[result.selectionId!] = ['two']; });
    expect(result.selectionId).toBe('mark');
    expect(session.project.sourceHtml).toBe(before);
    expect(session.source.querySelector('#mark')).toBe(node);
    expect(session.project.instructionScopes).toEqual({ mark: ['two'] });
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.project.sourceHtml).toBe(before);
    expect(session.project.instructionScopes).toEqual({});
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.project.sourceHtml).toBe(before);
    expect(session.project.instructionScopes).toEqual({ mark: ['two'] });
  });

  it('MARK-SCOPE-ONLY: an empty musical patch never validates or applies unused form values', () => {
    const root = score('<music-harmony id="mark" at="0/2" data-author="keep">  Dm9 <!--keep comment--> </music-harmony>');
    const before = root.outerHTML;
    const result = applyCommand(root, { type: 'update-annotation', annotationId: 'mark', fields: [],
      value: { kind: 'invalid', text: '', at: 'not a time', placement: 'invalid', bpm: -1, beat: 'invalid', dots: -3 } as unknown as AnnotationInput });
    expect(result.selectionId).toBe('mark');
    expect(root.outerHTML).toBe(before);
  });
});

describe('annotation patch values and no-ops', () => {
  it('preserves every literal representation for a semantically unchanged named patch', () => {
    const root = score('<music-tempo id="mark" marking=" Swing " text="shadow" bpm="9e1" beat="4" dotted="true" at="0/2" data-author="keep"> <!--keep--> body </music-tempo>');
    const before = root.outerHTML;
    const result = applyCommand(root, command(root, ['kind', 'text', 'at', 'placement', 'bpm', 'beat', 'dots']));
    expect(result.message).toContain('nothing changed');
    expect(root.outerHTML).toBe(before);
  });

  it('keeps absent quarter-beat, zero-dot, and placement defaults absent', () => {
    const root = score('<music-tempo id="mark" marking="Swing" bpm="112"></music-tempo>');
    const before = root.outerHTML;
    applyCommand(root, command(root, ['beat', 'dots', 'placement'], { beat: 'quarter', dots: 0, placement: 'above' }));
    expect(root.outerHTML).toBe(before);
  });

  it('does not freeze sequential anchoring when a named onset equals its current exact value', () => {
    const root = score('<music-harmony id="mark">Dm9</music-harmony>');
    const before = root.outerHTML;
    applyCommand(root, command(root, ['at'], { at: '2/8' }));
    expect(root.outerHTML).toBe(before);
    applyCommand(root, { type: 'set-event-rhythm', eventId: 'before', duration: 'eighth', dots: 0 });
    expect(root.querySelector('#mark')?.hasAttribute('at')).toBe(false);
    expect(annotation(root).onset).toEqual(rational(1, 8));
  });

  it('moves only the named fixed onset and preserves body text and comments', () => {
    const root = score('<music-harmony id="mark" at="0/2" data-author="keep"> Dm9 <!--keep--> </music-harmony>');
    const body = root.querySelector('#mark')!.innerHTML;
    const before = attrs(root.querySelector('#mark')!);
    applyCommand(root, command(root, ['at'], { at: '2/4', text: 'Do not write', placement: 'below' }));
    expect(attrs(root.querySelector('#mark')!)).toEqual({ ...before, at: '1/2' });
    expect(root.querySelector('#mark')!.innerHTML).toBe(body);
    expect(annotation(root).onset).toEqual(rational(1, 2));
  });

  it('changes plain body text without removing comments or interpreting HTML', () => {
    const root = score('<music-direction id="mark" data-author="keep"> Listen <!--keep--> together </music-direction>');
    const node = root.querySelector('#mark')!;
    const comment = [...node.childNodes].find(child => child.nodeType === 8);
    const before = attrs(node);
    const next = '<script> is printed text';
    applyCommand(root, command(root, ['text'], { text: next }));
    expect(attrs(node)).toEqual(before);
    expect([...node.childNodes]).toContain(comment);
    expect(node.querySelector('script')).toBeNull();
    expect(annotation(root).text).toBe(next);
    expect(errors(root)).toEqual([]);
  });

  it('clears active tempo text without revealing shadowed attributes or body text', () => {
    const root = score('<music-tempo id="mark" marking="Swing" text="fallback" bpm="112">body<!--keep--></music-tempo>');
    const node = root.querySelector('#mark')!;
    const body = node.innerHTML;
    applyCommand(root, command(root, ['text'], { text: '' }));
    expect(node.getAttribute('marking')).toBe('');
    expect(node.getAttribute('text')).toBe('fallback');
    expect(node.innerHTML).toBe(body);
    expect(annotation(root)).toMatchObject({ text: '', bpm: 112 });
    expect(errors(root)).toEqual([]);
  });

  it.each(['bpm', 'beat', 'dots'] as const)('clears only the explicitly named optional %s declaration', field => {
    const root = score('<music-tempo id="mark" marking="Swing" bpm="9e1" beat="8" dotted dots="1" at="0/2" data-author="keep"><!--keep--></music-tempo>');
    const expected = attrs(root.querySelector('#mark')!);
    delete expected[field];
    if (field === 'dots') delete expected.dotted;
    applyCommand(root, command(root, [field], { [field]: undefined }));
    expect(attrs(root.querySelector('#mark')!)).toEqual(expected);
    expect(root.querySelector('#mark')!.innerHTML).toBe('<!--keep-->');
    expect(errors(root)).toEqual([]);
  });

  it.each([0, 2, 3])('changes only the dot declaration to %s without canonicalizing beat or tempo', dots => {
    const root = score('<music-tempo id="mark" marking="Swing" bpm="9e1" beat="8" dotted dots="1" at="0/2"></music-tempo>');
    const expected = attrs(root.querySelector('#mark')!);
    delete expected.dotted;
    if (dots) expected.dots = String(dots);
    else delete expected.dots;
    applyCommand(root, command(root, ['dots'], { dots }));
    expect(attrs(root.querySelector('#mark')!)).toEqual(expected);
    expect(annotation(root).dots ?? 0).toBe(dots);
    expect(errors(root)).toEqual([]);
  });

  it('does not inspect stale unnamed kind or metronome values during a placement patch', () => {
    const root = score('<music-harmony id="mark" at="0/2"> Dm9 <!--keep--> </music-harmony>');
    const body = root.querySelector('#mark')!.innerHTML;
    applyCommand(root, command(root, ['placement'], { kind: 'tempo', bpm: -1, beat: 'invalid' as AnnotationInput['beat'], dots: -3, text: '', at: 'invalid', placement: 'below' }));
    expect(root.querySelector('#mark')?.localName).toBe('music-harmony');
    expect(root.querySelector('#mark')?.getAttribute('at')).toBe('0/2');
    expect(root.querySelector('#mark')!.innerHTML).toBe(body);
    expect(annotation(root)).toMatchObject({ kind: 'harmony', text: 'Dm9', placement: 'below' });
  });

  it.each([
    [['at'], { at: '-1' }], [['placement'], { placement: 'sideways' }],
    [['bpm'], { bpm: 0 }], [['beat'], { beat: 'invalid' }], [['dots'], { dots: 0.5 }],
    [['text'], { text: '' }], [['unknown'], {}],
  ] as const)('rejects invalid named fields %s before mutating source', (fields, changes) => {
    const root = score('<music-tempo id="mark" marking="Swing" beat="8" dotted at="0/2"></music-tempo>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, command(root, fields as readonly (keyof AnnotationInput)[], changes as Partial<AnnotationInput>))).toThrow();
    expect(root.outerHTML).toBe(before);
  });

  it('does not clear the only metronome value and silently leave an empty tempo', () => {
    const root = score('<music-tempo id="mark" bpm="112" beat="8" dotted></music-tempo>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, command(root, ['bpm'], { bpm: undefined }))).toThrow('needs text');
    expect(root.outerHTML).toBe(before);
    applyCommand(root, command(root, ['text', 'bpm'], { text: 'Freely', bpm: undefined }));
    expect(annotation(root)).toMatchObject({ text: 'Freely', beat: 'eighth', dots: 1 });
    expect(annotation(root).bpm).toBeUndefined();
  });
});

describe('deliberate annotation kind conversion', () => {
  it('transfers accepted text and removes only incompatible tempo attributes on kind change', () => {
    const root = score('<music-tempo id="mark" marking=" Swing " text="shadow" bpm="9e1" beat="8" dotted at="0/2" data-author="keep">body<!--keep--></music-tempo>');
    const previous = root.querySelector('#mark')!;
    const body = previous.innerHTML;
    applyCommand(root, command(root, ['kind'], { kind: 'direction', text: 'Do not apply', at: '3/4', placement: 'below' }));
    const node = root.querySelector('#mark')!;
    expect(node.localName).toBe('music-direction');
    expect(node).not.toBe(previous);
    expect(attrs(node)).toEqual({ id: 'mark', text: ' Swing ', at: '0/2', 'data-author': 'keep' });
    expect(node.innerHTML).toBe(body);
    expect(annotation(root)).toMatchObject({ kind: 'direction', text: ' Swing ', onset: rational(0), placement: 'above' });
    expect(errors(root)).toEqual([]);
  });

  it('does not turn a named unchanged kind into a broad replacement', () => {
    const root = score('<music-tempo id="mark" text="Swing" bpm="9e1" beat="8" dotted at="0/2">body<!--keep--></music-tempo>');
    const before = root.outerHTML;
    applyCommand(root, command(root, ['kind'], { kind: 'tempo', text: '', at: 'bad', bpm: -1 }));
    expect(root.outerHTML).toBe(before);
  });

  it('retains the accepted default dynamic text and the authored placement default policy', () => {
    const root = score('<music-dynamics id="mark" data-author="keep"><!--keep--></music-dynamics>');
    expect(annotation(root)).toMatchObject({ text: 'mf', placement: 'below' });
    applyCommand(root, command(root, ['kind'], { kind: 'direction', text: 'stale', placement: 'below' }));
    expect(annotation(root)).toMatchObject({ kind: 'direction', text: 'mf', placement: 'above' });
    expect(root.querySelector('#mark')?.hasAttribute('placement')).toBe(false);
    expect(root.querySelector('#mark')?.getAttribute('text')).toBe('mf');
  });

  it('honors an explicitly named placement when the new kind has a different default', () => {
    const root = score('<music-dynamics id="mark" level="p"></music-dynamics>');
    applyCommand(root, command(root, ['kind', 'placement'], { kind: 'direction', placement: 'below' }));
    expect(annotation(root).placement).toBe('below');
    expect(root.querySelector('#mark')?.getAttribute('placement')).toBe('below');
  });

  it('does not invent a default dynamic when changing a metronome-only tempo', () => {
    const root = score('<music-tempo id="mark" bpm="112"></music-tempo>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, command(root, ['kind'], { kind: 'dynamics' }))).toThrow('needs text');
    expect(root.outerHTML).toBe(before);
    applyCommand(root, command(root, ['kind', 'text'], { kind: 'dynamics', text: 'ff' }));
    expect(root.querySelector('#mark')?.localName).toBe('music-dynamics');
    expect(annotation(root)).toMatchObject({ text: 'ff', kind: 'dynamics' });
    expect(root.querySelector('#mark')?.hasAttribute('bpm')).toBe(false);
  });

  it('does not add unselected tempo settings when deliberately changing to tempo', () => {
    const root = score('<music-direction id="mark" text="Freely" placement="below" at="0/2"></music-direction>');
    applyCommand(root, command(root, ['kind'], { kind: 'tempo', bpm: 144, beat: 'eighth', dots: 1, placement: 'above' }));
    expect(annotation(root)).toMatchObject({ text: 'Freely', kind: 'tempo', placement: 'below', onset: rational(0) });
    expect(annotation(root).bpm).toBeUndefined();
    expect(annotation(root).beat).toBeUndefined();
    expect(annotation(root).dots).toBeUndefined();
    expect(errors(root)).toEqual([]);
  });

  it('retains broad legacy update behavior when fields is omitted', () => {
    const root = score('<music-tempo id="mark" marking="Swing" bpm="9e1" beat="8" dotted at="0/2"><!--legacy comment--></music-tempo>');
    applyCommand(root, { type: 'update-annotation', annotationId: 'mark', value: input(root) });
    expect(root.querySelector('#mark')?.getAttribute('bpm')).toBe('90');
    expect(root.querySelector('#mark')?.getAttribute('at')).toBe('0');
    expect(root.querySelector('#mark')?.getAttribute('beat')).toBe('eighth');
    expect(root.querySelector('#mark')?.getAttribute('dots')).toBe('1');
    expect(root.querySelector('#mark')?.hasAttribute('dotted')).toBe(false);
  });
});

describe('annotation patch transaction boundaries', () => {
  it('preserves source, revision, redo, and review records for a semantic no-op', () => {
    const session = editor(score('<music-tempo id="mark" text="Swing" bpm="9e1" beat="4" dotted at="0/2"><!--keep--></music-tempo>'));
    session.update('Review turn', project => { project.layouts.score.reviewedTurns[project.columns[0].id] = 'reviewed'; });
    session.update('Metadata', project => { project.metadata.composer = 'Test'; });
    session.undo();
    const before = session.project;
    const revision = session.revision;
    session.execute(command(session.source, ['text', 'at', 'placement', 'bpm', 'beat', 'dots']));
    expect(session.project).toEqual(before);
    expect(session.revision).toBe(revision);
    expect(session.canRedo).toBe(true);
    expect(session.project.layouts.score.reviewedTurns).toEqual(before.layouts.score.reviewedTurns);
  });

  it('rolls back musical fields and recipients together if a patch falls outside the measure', () => {
    const session = editor(score('<music-harmony id="mark" text="Dm9" at="0/2"><!--keep--></music-harmony>'));
    const before = session.project;
    expect(() => session.execute(command(session.source, ['at', 'text'], { at: '3/2', text: 'G13' }), project => { project.instructionScopes.mark = 'all'; })).toThrow();
    expect(session.project).toEqual(before);
    expect(session.selectionId).toBe('mark');
    expect(session.revision).toBe(0);
    expect(session.canUndo).toBe(false);
  });

  it('validates the target even when the musical patch is empty', () => {
    const root = score('<music-harmony id="mark" text="Dm9"></music-harmony>');
    const before = root.outerHTML;
    expect(() => applyCommand(root, { type: 'update-annotation', annotationId: 'before', value: input(root), fields: [] })).toThrow('annotation');
    expect(root.outerHTML).toBe(before);
  });
});
