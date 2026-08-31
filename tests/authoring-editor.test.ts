import { describe, expect, it } from 'vitest';
import { EditorSession } from '../src/authoring/editor.js';
import type { EditorChangeDetail } from '../src/authoring/editor.js';
import { createProject, getProjectNotices, getSourceHtml } from '../src/authoring/project.js';
import { buildProjection } from '../src/authoring/projection.js';
import { createTemplate } from '../src/authoring/templates.js';
import type { AuthorProject, EventInput } from '../src/authoring/types.js';

const sourceHtml = `<music-system id="score" data-origin="authored">
  <music-staff id="staff" label="Tenor" clef="treble">
    <music-measure id="m1"><!-- leave room to breathe --><music-direction id="direction" text="Freely, in time"></music-direction><music-note id="n1" pitch="C4" duration="whole"></music-note></music-measure>
    <music-measure id="m2"><music-rest id="r2" measure></music-rest></music-measure>
  </music-staff>
</music-system>`;

function project(html = sourceHtml): AuthorProject { return createProject(html, 'First sketch'); }
function editor(html = sourceHtml): EditorSession { return new EditorSession(project(html)); }
function profileKey(value: AuthorProject): string { return Object.keys(value.layouts)[0]; }
function note(pitch = 'D4', duration: EventInput['duration'] = 'whole'): EventInput {
  return {
    kind: 'note', pitch, pitches: '', duration, dots: 0, rhythmic: false,
    measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto',
  };
}

function reviewedProject(): AuthorProject {
  const draft = project(sourceHtml.replace('id="m1"', 'id="m1" incomplete')
    .replace('duration="whole"', 'duration="quarter"'));
  draft.reviewedShortMeasures = ['m1'];
  draft.layouts[profileKey(draft)].reviewedTurns[draft.columns[1].id] = 'reviewed-page';
  return draft;
}

describe('authoring transactions', () => {
  it('exposes safe project and score snapshots without a parallel mutable score', () => {
    const original = project();
    const session = new EditorSession(original);
    original.metadata.title = 'Changed outside the editor';
    const snapshot = session.project;
    snapshot.metadata.title = 'Changed snapshot';
    snapshot.columns[0].measureIds.length = 0;
    expect(session.project.metadata.title).toBe('First sketch');
    expect(session.project.columns[0].measureIds).toContain('m1');
    expect(session.project.sourceHtml).toBe(getSourceHtml(session.source));

    const score = session.score;
    (score.staves[0].measures[0].voices[0].events[0].pitches as unknown as { step: string }[])[0].step = 'F';
    expect(session.score.staves[0].measures[0].voices[0].events[0].pitches[0].step).toBe('C');
    expect(session.revision).toBe(0);
    expect(session.canUndo).toBe(false);
  });

  it('reconciles accepted attributes and text while retaining source elements, comments, and shadow SVG', () => {
    const session = editor();
    const root = session.source;
    const staff = root.querySelector('#staff');
    const measure = root.querySelector('#m1');
    const event = root.querySelector('#n1');
    const comment = measure!.firstChild;
    const shadow = root.attachShadow({ mode: 'open' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M0 0L10 10');
    svg.append(path);
    shadow.append(svg);

    session.execute({ type: 'update-event', eventId: 'n1', value: note('F#4') });
    expect(session.source).toBe(root);
    expect(root.querySelector('#staff')).toBe(staff);
    expect(root.querySelector('#m1')).toBe(measure);
    expect(root.querySelector('#n1')).toBe(event);
    expect(measure!.firstChild).toBe(comment);
    expect(event!.getAttribute('pitch')).toBe('F#4');
    expect(root.shadowRoot!.firstChild).toBe(svg);
    expect(svg.firstChild).toBe(path);
    expect(path.getAttribute('d')).toBe('M0 0L10 10');
    expect(session.project.sourceHtml).toContain('<!-- leave room to breathe -->');
    expect(session.project.sourceHtml).toContain('data-origin="authored"');
    expect(session.project.sourceHtml).not.toContain('<svg');
  });

  it('retains comments surrounding the source root through commands and history', () => {
    const session = editor(`<!-- Chart notes -->\n${sourceHtml}\n<!-- End chart -->`);
    expect(session.project.sourceHtml).toBe(`<!-- Chart notes -->\n${sourceHtml}\n<!-- End chart -->`);
    session.execute({ type: 'update-event', eventId: 'n1', value: note() });
    expect(session.project.sourceHtml).toContain('<!-- Chart notes -->');
    expect(session.project.sourceHtml).toContain('<!-- End chart -->');
    session.undo();
    expect(session.project.sourceHtml).toContain('<!-- Chart notes -->');
    expect(session.project.sourceHtml).toContain('<!-- End chart -->');
  });

  it('rejects project accessors and custom prototypes before copying can execute or erase them', () => {
    const input = project();
    let reads = 0;
    Object.defineProperty(input, 'sourceHtml', {
      enumerable: true, get: () => { reads++; return sourceHtml; },
    });
    expect(() => new EditorSession(input)).toThrow();
    expect(reads).toBe(0);
    const inherited = Object.assign(Object.create({ external: true }) as AuthorProject, project());
    expect(() => new EditorSession(inherited)).toThrow();
  });

  it('rejects overflow, invalid pitch, and all associated state changes atomically', () => {
    const session = editor();
    session.select('n1');
    const before = session.project;
    const root = session.source;
    const event = root.querySelector('#n1');
    const changes: Event[] = [];
    session.addEventListener('change', change => changes.push(change));

    expect(() => session.execute({ type: 'update-event', eventId: 'n1', value: note('D4', 'breve') })).toThrow();
    expect(() => session.execute({ type: 'update-event', eventId: 'n1', value: note('H4') })).toThrow();
    expect(session.project).toEqual(before);
    expect(session.source).toBe(root);
    expect(root.querySelector('#n1')).toBe(event);
    expect(event!.getAttribute('pitch')).toBe('C4');
    expect(session.selectionId).toBe('n1');
    expect(session.revision).toBe(0);
    expect(session.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });

  it('rejects every change in an invalid metadata transaction', () => {
    const session = editor();
    const before = session.project;
    expect(() => session.update('Invalid page', draft => {
      draft.metadata.title = 'Must not leak';
      draft.layouts[profileKey(draft)].marginMm = -10;
    })).toThrow();
    expect(session.project).toEqual(before);
    expect(session.canUndo).toBe(false);

    expect(() => session.update('Invalid music', draft => {
      draft.metadata.composer = 'Must not leak either';
      draft.sourceHtml = draft.sourceHtml.replace('pitch="C4"', 'pitch="not-a-pitch"');
    })).toThrow();
    expect(session.project).toEqual(before);
  });

  it('keeps unapplied invalid source separate from the accepted score and recovery history', () => {
    const session = editor();
    const accepted = session.source.outerHTML;
    session.setPendingSource('<music-system>');
    session.setPendingSource('<music-system id="unfinished">');
    const before = session.project;
    expect(session.canUndo).toBe(false);
    expect(session.revision).toBe(2);
    expect(() => session.applySource(session.project.pendingSource!)).toThrow();
    expect(session.project).toEqual(before);
    expect(session.source.outerHTML).toBe(accepted);
    expect(session.diagnostics).toEqual([]);
  });

  it.each([
    sourceHtml.replace('<music-note', '<music-note onclick="alert(1)"'),
    sourceHtml.replace('<music-note', '<script>alert(1)</script><music-note'),
    sourceHtml.replace('id="r2"', 'id="n1"'),
  ])('rejects unsafe or duplicate-identity source without changing accepted state', html => {
    const session = editor();
    const before = session.project;
    expect(() => session.applySource(html)).toThrow();
    expect(session.project).toEqual(before);
    expect(session.canUndo).toBe(false);
  });

  it('allows explicit incomplete drafts while exposing the exact reader warnings', () => {
    const session = editor();
    session.applySource(session.project.sourceHtml.replace('id="m1"', 'id="m1" incomplete')
      .replace('duration="whole"', 'duration="quarter"'));
    expect(session.diagnostics.some(diagnostic => diagnostic.code === 'incomplete-measure'
      && diagnostic.severity === 'warning' && diagnostic.measureId === 'm1')).toBe(true);
    expect(session.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
    expect(session.canUndo).toBe(true);
  });

  it('preserves source identity through wrapper changes and undo', () => {
    const session = editor();
    const event = session.source.querySelector('#n1')!;
    const original = event.outerHTML;
    session.applySource(session.project.sourceHtml.replace(original, `<music-voice id="melody">${original}</music-voice>`));
    expect(session.source.querySelector('#n1')).toBe(event);
    expect(event.parentElement!.id).toBe('melody');
    session.undo();
    expect(session.source.querySelector('#n1')).toBe(event);
    expect(event.parentElement!.id).toBe('m1');
    expect(session.source.querySelector('#melody')).toBeNull();
  });

  it('can reverse the nesting order of keyed tuplets without creating a DOM cycle', () => {
    const first = '<music-tuplet id="outer" actual="2" normal="1"><music-tuplet id="inner" actual="2" normal="1">';
    const second = '<music-tuplet id="inner" actual="2" normal="1"><music-tuplet id="outer" actual="2" normal="1">';
    const html = `<music-system id="score"><music-staff id="staff"><music-measure id="m1" meter="1/4">${first}<music-note id="n1" pitch="C4" duration="whole"></music-note></music-tuplet></music-tuplet></music-measure></music-staff></music-system>`;
    const session = editor(html);
    const outer = session.source.querySelector('#outer');
    const inner = session.source.querySelector('#inner');
    const event = session.source.querySelector('#n1');
    session.applySource(session.project.sourceHtml.replace(first, second));
    expect(session.source.querySelector('#outer')).toBe(outer);
    expect(session.source.querySelector('#inner')).toBe(inner);
    expect(session.source.querySelector('#n1')).toBe(event);
    expect(outer!.parentElement).toBe(inner);
    expect(event!.parentElement).toBe(outer);
  });

  it('can wrap an existing staff root in a system and undo without replacing that staff', () => {
    const standalone = '<music-staff id="staff"><music-measure id="m1"><music-note id="n1" pitch="C4" duration="whole"></music-note></music-measure></music-staff>';
    const session = editor(standalone);
    const staff = session.source;
    const event = staff.querySelector('#n1');
    session.applySource(`<music-system id="score">${standalone}</music-system>`);
    expect(session.source.localName).toBe('music-system');
    expect(session.source.querySelector('#staff')).toBe(staff);
    expect(session.source.querySelector('#n1')).toBe(event);
    expect(session.source.contains(session.source.parentNode)).toBe(false);
    session.undo();
    expect(session.source).toBe(staff);
    expect(session.source.querySelector('#n1')).toBe(event);
    session.redo();
    expect(session.source.localName).toBe('music-system');
    expect(session.source.querySelector('#staff')).toBe(staff);
  });

  it.each(['blank', 'lead'] as const)('adds a second staff to the %s template in one undoable action', template => {
    const session = new EditorSession(createTemplate(template));
    const originalStaff = session.source;
    const firstMeasure = originalStaff.querySelector('music-measure')!;
    const firstEvent = originalStaff.querySelector('music-note, music-rest');
    const before = session.project;
    const result = session.execute({ type: 'add-staff', label: 'Bass', clef: 'bass' });
    expect(session.source.localName).toBe('music-system');
    expect(session.source.querySelector(`#${originalStaff.id}`)).toBe(originalStaff);
    expect(session.source.querySelector(`#${firstMeasure.id}`)).toBe(firstMeasure);
    if (firstEvent) expect(session.source.querySelector(`#${firstEvent.id}`)).toBe(firstEvent);
    else expect(session.score.staves[0].measures[0].voices[0].events).toEqual([]);
    expect(session.score.staves).toHaveLength(2);
    expect(session.score.staves[1]).toMatchObject({ id: result.selectionId, label: 'Bass', clef: 'bass' });
    expect(session.score.staves[1].measures).toHaveLength(session.score.staves[0].measures.length);
    expect(session.project.columns.map(column => column.id)).toEqual(before.columns.map(column => column.id));
    expect(session.project.columns.every(column => column.measureIds.length === 2)).toBe(true);
    expect(session.project.parts).toEqual(before.parts);
    expect(session.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.source).toBe(originalStaff);
    expect(session.project.columns).toEqual(before.columns);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.source.localName).toBe('music-system');
    expect(session.source.querySelector(`#${originalStaff.id}`)).toBe(originalStaff);
    expect(session.score.staves[1].id).toBe(result.selectionId);
  });

  it('promotes staff root layout settings without changing musical context or source framing', () => {
    const html = `<!-- Original chart -->\n<music-staff id="solo" label="Viola" clef="alto" key="Eb" meter="7/8" groups="2+2+3" max-measures="3" justify-last measure-numbers="all" print-width="700" print-preview>
      <music-measure id="one"><music-rest id="rest-one" measure></music-rest></music-measure>
      <music-measure id="two" meter="3/4" groups="1+1+1" key="G"><music-rest id="rest-two" measure></music-rest></music-measure>
    </music-staff>\n<!-- Keep this note -->`;
    const session = editor(html);
    const staff = session.source;
    const before = session.score.staves[0];
    const oldIds = new Set([staff.id, ...[...staff.querySelectorAll('[id]')].map(element => element.id)]);
    session.execute({ type: 'add-staff', label: 'Cello', clef: 'bass' });
    expect(oldIds.has(session.source.id)).toBe(false);
    expect(session.source.querySelector('#solo')).toBe(staff);
    expect(session.score.staves[0]).toEqual(before);
    expect(session.score.staves[1].measures.map(measure => [measure.meter, measure.key, measure.clef]))
      .toEqual(before.measures.map(measure => [measure.meter, measure.key, 'bass']));
    expect(session.source.getAttribute('max-measures')).toBe('3');
    expect(session.source.getAttribute('measure-numbers')).toBe('all');
    expect(session.source.getAttribute('print-width')).toBe('700');
    expect(session.source.hasAttribute('justify-last')).toBe(true);
    expect(session.source.hasAttribute('print-preview')).toBe(true);
    expect(staff.hasAttribute('max-measures')).toBe(false);
    expect(session.project.sourceHtml).toContain('<!-- Original chart -->');
    expect(session.project.sourceHtml).toContain('<!-- Keep this note -->');
    session.undo();
    expect(session.source).toBe(staff);
    expect(staff.getAttribute('max-measures')).toBe('3');
    expect(staff.hasAttribute('print-preview')).toBe(true);
  });

  it('does not promote the accepted staff when adding a staff fails validation', () => {
    const session = new EditorSession(createTemplate('blank'));
    const before = session.project;
    const staff = session.source;
    expect(() => session.execute({ type: 'add-staff', label: 'Invalid', clef: 'unsupported' as 'bass' })).toThrow();
    expect(session.source).toBe(staff);
    expect(session.source.localName).toBe('music-staff');
    expect(session.project).toEqual(before);
    expect(session.canUndo).toBe(false);
  });
});

describe('authoring history and notifications', () => {
  it('combines annotation edits and instruction scopes into one atomic undo step', () => {
    const session = editor();
    const result = session.execute({ type: 'add-annotation', measureId: 'm2', value: {
      kind: 'direction', text: 'Trade fours', at: '0', placement: 'above',
    } }, (draft, edit) => { draft.instructionScopes[edit.selectionId!] = 'all'; });
    expect(session.source.querySelectorAll('music-direction')).toHaveLength(2);
    expect(session.project.instructionScopes[result.selectionId!]).toBe('all');
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.source.querySelectorAll('music-direction')).toHaveLength(1);
    expect(session.project.instructionScopes).toEqual({});
    expect(session.canUndo).toBe(false);

    const before = session.project;
    expect(() => session.execute({ type: 'add-annotation', measureId: 'm2', value: {
      kind: 'direction', text: 'Not accepted', at: '0', placement: 'above',
    } }, (draft, edit) => { draft.instructionScopes[edit.selectionId!] = ['missing-part']; })).toThrow();
    expect(session.project).toEqual(before);
    expect(session.source.querySelectorAll('music-direction')).toHaveLength(1);
  });

  it('keeps selection transient and ignores no-op metadata changes', () => {
    const session = editor();
    const details: EditorChangeDetail[] = [];
    session.addEventListener('change', event => details.push((event as CustomEvent<EditorChangeDetail>).detail));
    session.select('n1');
    session.select('n1');
    session.update('No change', draft => { draft.metadata.title = draft.metadata.title; });
    expect(session.revision).toBe(0);
    expect(session.canUndo).toBe(false);
    expect(details).toEqual([{ label: 'Select', revision: 0, selectionId: 'n1', kind: 'draft' }]);
    session.select('missing');
    expect(session.selectionId).toBeUndefined();
  });

  it('stores one undo step for a complete action, including metadata, selection, and pending source', () => {
    const session = editor();
    session.select('n1');
    session.setPendingSource('Unapplied working text');
    session.update('Describe sketch', draft => {
      draft.metadata.title = 'Second sketch';
      draft.metadata.composer = 'A composer';
      draft.pendingSource = 'Different working text';
    });
    session.select('r2');
    session.undo();
    expect(session.project.metadata).toMatchObject({ title: 'First sketch', composer: '' });
    expect(session.project.pendingSource).toBe('Unapplied working text');
    expect(session.selectionId).toBe('n1');
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
    session.redo();
    expect(session.project.metadata).toMatchObject({ title: 'Second sketch', composer: 'A composer' });
    expect(session.project.pendingSource).toBe('Different working text');
    expect(session.selectionId).toBe('r2');
    expect(session.canRedo).toBe(false);
  });

  it('restores an applied source buffer on undo and consumes it again on redo', () => {
    const session = editor();
    const original = session.source.outerHTML;
    const applied = original.replace('pitch="C4"', 'pitch="D4"');
    session.setPendingSource(applied);
    session.applySource(applied);
    expect(session.project.pendingSource).toBeNull();
    expect(session.source.querySelector('#n1')!.getAttribute('pitch')).toBe('D4');
    session.undo();
    expect(session.source.outerHTML).toBe(original);
    expect(session.project.pendingSource).toBe(applied);
    session.redo();
    expect(session.project.pendingSource).toBeNull();
    expect(session.source.querySelector('#n1')!.getAttribute('pitch')).toBe('D4');
  });

  it('restores command selections and source objects retained across undo/redo', () => {
    const session = editor();
    session.select('n1');
    const firstMeasure = session.source.querySelector('#m1');
    const result = session.execute({ type: 'append-measure', afterMeasureId: 'm1' });
    expect(session.source.querySelectorAll('music-measure')).toHaveLength(3);
    expect(session.selectionId).toBe(result.selectionId);
    session.undo();
    expect(session.source.querySelectorAll('music-measure')).toHaveLength(2);
    expect(session.selectionId).toBe('n1');
    expect(session.source.querySelector('#m1')).toBe(firstMeasure);
    session.redo();
    expect(session.source.querySelectorAll('music-measure')).toHaveLength(3);
    expect(session.selectionId).toBe(result.selectionId);
    expect(session.source.querySelector('#m1')).toBe(firstMeasure);
  });

  it('invalidates redo on a new edit, but not on a transient selection', () => {
    const session = editor();
    session.update('Title', draft => { draft.metadata.title = 'New title'; });
    session.undo();
    session.select('m2');
    expect(session.canRedo).toBe(true);
    session.update('Composer', draft => { draft.metadata.composer = 'New composer'; });
    expect(session.canRedo).toBe(false);
  });

  it('bounds history to one hundred accepted actions', () => {
    const session = editor();
    for (let index = 1; index <= 105; index++) {
      session.update('Title', draft => { draft.metadata.title = `Title ${index}`; });
    }
    let steps = 0;
    while (session.canUndo) { session.undo(); steps++; }
    expect(steps).toBe(100);
    expect(session.project.metadata.title).toBe('Title 5');
    expect(session.revision).toBe(205);
  });

  it('replaces projects atomically and resets history, drafts, and selection', () => {
    const session = editor();
    session.update('Title', draft => { draft.metadata.title = 'Updated'; });
    session.select('n1');
    session.setPendingSource('Draft');
    const before = session.project;
    const invalid = project();
    invalid.sourceHtml = '<music-system></music-system>';
    expect(() => session.replaceProject(invalid)).toThrow();
    expect(session.project).toEqual(before);
    expect(session.canUndo).toBe(true);
    const replacement = project(sourceHtml.replace('id="score"', 'id="different-score"'));
    replacement.metadata.title = 'Replacement';
    session.replaceProject(replacement);
    expect(session.project.metadata.title).toBe('Replacement');
    expect(session.project.pendingSource).toBeNull();
    expect(session.selectionId).toBeUndefined();
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
    expect(session.source.id).toBe('different-score');
  });

  it('emits the documented action kinds with monotonic content revisions', () => {
    const session = editor();
    const details: EditorChangeDetail[] = [];
    session.addEventListener('change', event => details.push((event as CustomEvent<EditorChangeDetail>).detail));
    session.select('n1');
    session.execute({ type: 'update-event', eventId: 'n1', value: note() });
    session.setPendingSource('Draft');
    session.undo();
    session.replaceProject(project());
    expect(details.map(detail => [detail.kind, detail.revision])).toEqual([
      ['draft', 0], ['edit', 1], ['draft', 2], ['history', 3], ['replace', 4],
    ]);
    expect(details.every(detail => typeof detail.label === 'string' && detail.label.length > 0)).toBe(true);
  });
});

describe('authoring review records and source references', () => {
  it('duplicates shared and part-scoped instructions into an extracted lower-staff part', () => {
    const html = sourceHtml
      .replace('<music-note id="n1"', '<music-direction id="lower-instruction" text="Leave space" at="1/2"></music-direction><music-dynamics id="upper-dynamics" level="p"></music-dynamics><music-note id="n1"')
      .replace('</music-system>', '<music-staff id="lower" label="Bass" clef="bass"><music-measure id="lower-m1"><music-rest id="lower-r1" measure></music-rest></music-measure><music-measure id="lower-m2"><music-rest id="lower-r2" measure></music-rest></music-measure></music-staff></music-system>');
    const initial = createProject(html, 'Shared instructions', [
      { id: 'upper-part', label: 'Tenor', staffIds: ['staff'] },
      { id: 'lower-part', label: 'Bass', staffIds: ['lower'] },
    ]);
    initial.instructionScopes = { direction: 'all', 'lower-instruction': ['lower-part'] };
    initial.layouts.score.reviewedTurns[initial.columns[1].id] = 'prior-review';
    const session = new EditorSession(initial);
    const result = session.execute({ type: 'duplicate-measures', measureIds: ['m1'] });
    const sharedCopy = result.copiedIds!.direction;
    const partCopy = result.copiedIds!['lower-instruction'];
    expect(sharedCopy).toBeTruthy();
    expect(partCopy).toBeTruthy();
    expect(session.project.instructionScopes[sharedCopy]).toBe('all');
    expect(session.project.instructionScopes[partCopy]).toEqual(['lower-part']);
    const projected = buildProjection(session.project, 'lower-part');
    expect(projected.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    expect(projected.score.staves.map(staff => staff.id)).toEqual(['lower']);
    expect(projected.score.staves[0].measures[0].annotations.map(annotation => annotation.id)).toEqual(['direction', 'lower-instruction']);
    expect(projected.score.staves[0].measures[1].annotations.map(annotation => annotation.id)).toEqual([sharedCopy, partCopy]);
    expect(projected.score.staves[0].measures[1].annotations[1].onset).toEqual({ numerator: 1, denominator: 2 });
    expect(projected.source.querySelector('music-dynamics')).toBeNull();
    expect(session.project.layouts.score.reviewedTurns).toEqual({});
    expect(session.revision).toBe(1);
    session.undo();
    expect(session.project.instructionScopes).toEqual(initial.instructionScopes);
    expect(session.project.layouts.score.reviewedTurns).toEqual(initial.layouts.score.reviewedTurns);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(buildProjection(session.project, 'lower-part').score.staves[0].measures[1].annotations.map(annotation => annotation.id)).toEqual([sharedCopy, partCopy]);
  });

  it('clears both kinds of review on music edits and restores them with undo', () => {
    const session = new EditorSession(reviewedProject());
    const before = session.project;
    session.execute({ type: 'update-event', eventId: 'n1', value: note('E4', 'quarter') });
    expect(session.project.reviewedShortMeasures).toEqual([]);
    expect(Object.values(session.project.layouts).every(layout => Object.keys(layout.reviewedTurns).length === 0)).toBe(true);
    session.undo();
    expect(session.project.reviewedShortMeasures).toEqual(before.reviewedShortMeasures);
    expect(session.project.layouts).toEqual(before.layouts);
  });

  it('permits explicit page-turn review updates without invalidating themselves', () => {
    const session = new EditorSession(reviewedProject());
    session.update('Review page turn', draft => {
      draft.layouts[profileKey(draft)].reviewedTurns[draft.columns[1].id] = 'new-review';
    });
    const after = session.project;
    expect(after.layouts[profileKey(after)].reviewedTurns[after.columns[1].id]).toBe('new-review');
    expect(after.reviewedShortMeasures).toEqual(['m1']);
    session.update('Approve short ending', draft => { draft.reviewedShortMeasures = []; });
    const approval = session.project;
    expect(approval.layouts[profileKey(approval)].reviewedTurns[approval.columns[1].id]).toBe('new-review');
  });

  it.each(['metadata', 'page', 'instructions', 'parts'] as const)('clears turn reviews after relevant %s changes, retaining short-measure approval', kind => {
    const session = new EditorSession(reviewedProject());
    session.update('Change page content', draft => {
      if (kind === 'metadata') draft.metadata.composer = 'A composer';
      else if (kind === 'page') draft.layouts[profileKey(draft)].marginMm += 1;
      else if (kind === 'instructions') draft.instructionScopes.direction = 'all';
      else draft.parts.push({ id: 'solo-part', label: 'Solo', staffIds: ['staff'] });
    });
    expect(session.project.reviewedShortMeasures).toEqual(['m1']);
    expect(Object.values(session.project.layouts).every(layout => Object.keys(layout.reviewedTurns).length === 0)).toBe(true);
  });

  it('does not clear review marks merely by typing or discarding a source draft', () => {
    const session = new EditorSession(reviewedProject());
    const before = session.project;
    session.setPendingSource('Draft source');
    session.setPendingSource(null);
    expect(session.project.layouts).toEqual(before.layouts);
    expect(session.project.reviewedShortMeasures).toEqual(before.reviewedShortMeasures);
    expect(session.canUndo).toBe(false);
  });

  it('cleans removed instruction and column references as part of a deliberate measure deletion', () => {
    const initial = project();
    initial.instructionScopes.direction = 'all';
    const removedColumn = initial.columns[0].id;
    const retainedColumn = initial.columns[1].id;
    const key = profileKey(initial);
    initial.layouts[key].breaks[removedColumn] = 'line';
    initial.layouts[key].keeps[removedColumn] = true;
    const session = new EditorSession(initial);
    const retainedMeasure = session.source.querySelector('#m2');
    session.execute({ type: 'remove-measure', measureId: 'm1' });
    expect(session.project.instructionScopes).not.toHaveProperty('direction');
    expect(session.project.layouts[key].breaks).not.toHaveProperty(removedColumn);
    expect(session.project.layouts[key].keeps).not.toHaveProperty(removedColumn);
    expect(session.project.columns.map(column => column.id)).toContain(retainedColumn);
    expect(session.source.querySelector('#m2')).toBe(retainedMeasure);
    session.undo();
    expect(session.project.instructionScopes.direction).toBe('all');
    expect(session.project.layouts[key].breaks[removedColumn]).toBe('line');
    expect(session.source.querySelector('#m2')).toBe(retainedMeasure);
  });

  it('cleans instruction scopes on explicit annotation removal but refuses unresolved raw source edits', () => {
    const initial = project();
    initial.instructionScopes.direction = 'all';
    const session = new EditorSession(initial);
    const annotation = session.source.querySelector('#direction')!.outerHTML;
    const sourceWithoutAnnotation = session.project.sourceHtml.replace(annotation, '');
    session.setPendingSource(sourceWithoutAnnotation);
    const before = session.project;
    expect(() => session.applySource(sourceWithoutAnnotation)).toThrow();
    expect(session.project).toEqual(before);
    session.execute({ type: 'remove-annotation', annotationId: 'direction' });
    expect(session.project.instructionScopes).not.toHaveProperty('direction');
    expect(session.source.querySelector('#direction')).toBeNull();
  });

  it('retains normalization notices on safe project snapshots', () => {
    const session = editor();
    session.update('Add extracted part', draft => {
      draft.parts.push({ id: 'partial-part', label: 'Partial', staffIds: ['staff', 'missing-staff'] });
    });
    expect(session.project.parts.find(part => part.id === 'partial-part')!.staffIds).toEqual(['staff']);
    expect(getProjectNotices(session.project).length).toBeGreaterThan(0);
  });
});
