// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readScore } from '../src/dom/index.js';
import { rational } from '../src/model/index.js';
import { buildProjection, publicationPreflight, turnFingerprint } from '../src/authoring/projection.js';
import { defaultLayout, findSource, parseSource } from '../src/authoring/project.js';
import { planPages } from '../src/authoring/pages.js';
import type { AuthorProject } from '../src/authoring/types.js';
import type { Diagnostic } from '../src/model/types.js';

function project(sourceHtml = `<music-system id="score-source" key="G" bracket="brace">
  <music-staff id="flute" label="Flute">
    <music-measure id="f1" meter="4/4" keep-with-next>
      <music-tempo id="tempo" marking="Bright" bpm="120"></music-tempo>
      <music-note id="fn1" pitch="F4" duration="quarter"></music-note>
      <music-direction id="global" text="Listen for the cue"></music-direction>
      <music-direction id="piano-only" text="Pedal lightly" at="1/2"></music-direction>
      <music-direction id="flute-only" text="Air tone" at="0"></music-direction>
      <music-note id="fn2" pitch="F#4" duration="quarter"></music-note>
      <music-rest id="fr1" duration="half"></music-rest>
    </music-measure>
    <music-measure id="f2" break-before="page"><music-rest id="fr2" measure></music-rest></music-measure>
  </music-staff>
  <music-staff id="right" label="Piano">
    <music-measure id="r1" meter="4/4"><music-chord id="rn1" pitches="C4 E4 G4" duration="whole"></music-chord></music-measure>
    <music-measure id="r2"><music-rest id="rr2" measure></music-rest></music-measure>
  </music-staff>
  <music-staff id="left" clef="bass">
    <music-measure id="l1" meter="4/4"><music-note id="ln1" pitch="C3" duration="whole"></music-note></music-measure>
    <music-measure id="l2"><music-rest id="lr2" measure></music-rest></music-measure>
  </music-staff>
</music-system>`): AuthorProject {
  return {
    version: 1, id: 'project-test', metadata: { title: 'A small chart', composer: 'Composer', subtitle: '' },
    sourceHtml, parts: [
      { id: 'flute-part', label: 'Flute', staffIds: ['flute'] },
      { id: 'piano-part', label: 'Piano', staffIds: ['right', 'left'] },
    ],
    columns: [{ id: 'column-a', measureIds: ['f1', 'r1', 'l1'] }, { id: 'column-b', measureIds: ['f2', 'r2', 'l2'] }],
    layouts: { score: defaultLayout(), 'flute-part': defaultLayout(), 'piano-part': defaultLayout() },
    instructionScopes: { global: 'all', 'piano-only': ['piano-part'], 'flute-only': ['flute-part'] },
    reviewedShortMeasures: [], pendingSource: null, updatedAt: 1,
  };
}
function errors(diagnostics: readonly Diagnostic[]) { return diagnostics.filter(value => value.severity === 'error'); }
function draftProject(html: string): AuthorProject {
  const value = project(html);
  value.parts = [{ id: 'solo-part', label: 'Solo', staffIds: ['solo'] }];
  value.columns = [{ id: 'solo-column', measureIds: ['short'] }];
  value.instructionScopes = {};
  return value;
}

describe('disposable score and part projections', () => {
  it('keeps source and project immutable while retaining authored pitch spellings and event IDs', () => {
    const value = project();
    const before = JSON.stringify(value);
    const result = buildProjection(value);
    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.score.staves.map(staff => staff.id)).toEqual(['flute', 'right', 'left']);
    const notes = result.score.staves[0].measures[0].voices[0].events;
    expect(notes.slice(0, 2).map(event => [event.id, event.pitches[0].step, event.pitches[0].alter])).toEqual([
      ['fn1', 'F', 0], ['fn2', 'F', 1],
    ]);
    expect(result.source.isConnected).toBe(false);
    expect(JSON.stringify(value)).toBe(before);
    expect(findSource(result.source, 'fn1')).toBeDefined();
    result.profile.breaks['column-a'] = 'line';
    expect(value.layouts.score.breaks).toEqual({});
  });

  it('extracts both piano staves in source order and keeps the original multistaff bracket', () => {
    const value = project();
    value.parts[1].staffIds.reverse();
    const result = buildProjection(value, 'piano-part');
    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.score.staves.map(staff => staff.id)).toEqual(['right', 'left']);
    expect(result.score.bracket).toBe('brace');
    expect(result.score.staves[1].clef).toBe('bass');
    expect(result.score.staves[1].measures[0].voices[0].events[0].pitches[0]).toMatchObject({ step: 'C', octave: 3, alter: 0 });
    expect(result.label).toContain('authored pitch');
  });

  it('removes an ensemble bracket from a one-staff projection', () => {
    const result = buildProjection(project(), 'flute-part');
    expect(result.score.bracket).toBe('none');
    expect(result.score.staves).toHaveLength(1);
  });

  it('carries shared and scoped instructions from removed staves at their exact original onsets', () => {
    const value = project();
    const result = buildProjection(value, 'piano-part');
    const annotations = result.score.staves[0].measures[0].annotations;
    expect(annotations.map(annotation => annotation.id)).toEqual(['global', 'piano-only']);
    expect(annotations[0].onset).toEqual(rational(1, 4));
    expect(annotations[1].onset).toEqual(rational(1, 2));
    expect(findSource(result.source, 'global')?.getAttribute('at')).toBe('1/4');
    expect(findSource(result.source, 'flute-only')).toBeUndefined();
    expect(findSource(result.source, 'tempo')).toBeUndefined();
    expect(findSource(result.source, 'global')?.closest('music-measure')?.id).toBe('r1');
    expect(errors(result.diagnostics)).toEqual([]);
  });

  it('includes an explicitly shared tempo while avoiding duplicates within a multistaff part', () => {
    const value = project();
    value.instructionScopes.tempo = 'all';
    value.instructionScopes['piano-only'] = 'all';
    for (const target of ['score', 'flute-part', 'piano-part']) {
      const result = buildProjection(value, target);
      expect(result.source.querySelectorAll('[id="tempo"]')).toHaveLength(1);
      expect(result.source.querySelectorAll('[id="global"]')).toHaveLength(1);
      expect(result.source.querySelectorAll('[id="piano-only"]')).toHaveLength(1);
      expect(errors(result.diagnostics)).toEqual([]);
    }
  });

  it('retains full-score authored instruction placement even for explicitly part-scoped instructions', () => {
    const value = project();
    const full = buildProjection(value);
    expect(findSource(full.source, 'piano-only')?.closest('music-staff')?.id).toBe('flute');
    const flute = buildProjection(value, 'flute-part');
    expect(findSource(flute.source, 'piano-only')).toBeUndefined();
    expect(findSource(flute.source, 'flute-only')).toBeDefined();
  });

  it('inherits source column constraints even when they were authored on an excluded staff', () => {
    const result = buildProjection(project(), 'piano-part');
    for (const staff of result.score.staves) {
      expect(staff.measures[0].keepWithNext).toBe(true);
      expect(staff.measures[1].breakBefore).toBe('page');
    }
  });

  it('lets a part profile explicitly return breaks and keeps to automatic without changing the score profile', () => {
    const value = project();
    value.layouts['piano-part'].breaks['column-b'] = 'auto';
    value.layouts['piano-part'].keeps['column-a'] = false;
    const piano = buildProjection(value, 'piano-part');
    expect(piano.score.staves.every(staff => !staff.measures[0].keepWithNext && staff.measures[1].breakBefore === 'auto')).toBe(true);
    const full = buildProjection(value);
    expect(full.score.staves[0].measures[0].keepWithNext).toBe(true);
    expect(full.score.staves[0].measures[1].breakBefore).toBe('page');
  });

  it('resolves stable column IDs by their measure membership rather than column-array positions', () => {
    const value = project();
    value.columns.reverse();
    value.layouts.score.breaks['column-b'] = 'line';
    value.layouts.score.keeps['column-a'] = false;
    const result = buildProjection(value);
    expect(result.score.staves.every(staff => staff.measures[0].breakBefore === 'auto'
      && !staff.measures[0].keepWithNext && staff.measures[1].breakBefore === 'line')).toBe(true);
  });

  it('reports orphaned and ambiguous layout anchors instead of silently changing an unrelated bar', () => {
    const orphan = project();
    orphan.layouts.score.breaks.missing = 'page';
    expect(buildProjection(orphan).diagnostics.some(diagnostic => diagnostic.code === 'orphaned-layout-anchor')).toBe(true);
    const ambiguous = project();
    ambiguous.columns[0].measureIds.push('r2');
    expect(buildProjection(ambiguous).diagnostics.some(diagnostic => diagnostic.code === 'ambiguous-layout-anchor' && diagnostic.severity === 'error')).toBe(true);
  });

  it('applies root profile options without setting a fixed screen preview', () => {
    const value = project();
    Object.assign(value.layouts.score, { paper: 'a4', marginMm: 20, staffScale: 1.25, measureNumbers: 'all', maxMeasures: 3, justifyLast: true });
    const result = buildProjection(value);
    expect(result.source.getAttribute('print-width')).toBe(String(Math.floor((210 - 40) * 96 / 25.4 / 1.25)));
    expect(result.source.getAttribute('max-measures')).toBe('3');
    expect(result.source.getAttribute('measure-numbers')).toBe('all');
    expect(result.source.hasAttribute('justify-last')).toBe(true);
    expect(result.source.hasAttribute('print-preview')).toBe(false);
  });

  it('fails clearly for stale part membership and invalid accepted source', () => {
    expect(() => buildProjection(project(), 'missing')).toThrow('no longer exists');
    const stale = project();
    stale.parts[1].staffIds.push('missing-staff');
    expect(() => buildProjection(stale, 'piano-part')).toThrow('missing staff');
    const duplicated = project();
    duplicated.parts[1].staffIds.push('right');
    expect(() => buildProjection(duplicated, 'piano-part')).toThrow('duplicate');
    const invalid = project('<music-staff id="solo"><music-measure id="empty"></music-measure></music-staff>');
    expect(() => buildProjection(invalid)).toThrow();
  });

  it('returns diagnosable page-setting errors rather than accepting a zero staff scale', () => {
    const value = project();
    value.layouts.score.staffScale = 0;
    expect(buildProjection(value).diagnostics.some(diagnostic => diagnostic.code === 'invalid-page-settings')).toBe(true);
  });

  it('retains a standalone staff source and its event identities', () => {
    const value = draftProject('<music-staff id="solo" clef="alto"><music-measure id="short"><music-rest id="whole-rest" measure></music-rest></music-measure></music-staff>');
    const result = buildProjection(value, 'solo-part');
    expect(result.source.localName).toBe('music-staff');
    expect(result.score.staves[0].id).toBe('solo');
    expect(result.score.staves[0].clef).toBe('alto');
    expect(result.score.staves[0].measures[0].voices[0].events[0].id).toBe('whole-rest');
    expect(errors(result.diagnostics)).toEqual([]);
  });
});

describe('publication preflight', () => {
  it.each([false, true])('keeps empty draft voices out of ordinary publication even with short-measure review=%s', reviewed => {
    const value = draftProject('<music-staff id="solo"><music-measure id="short" incomplete><music-voice id="empty"></music-voice><music-voice id="written"><music-rest id="silence" measure></music-rest></music-voice></music-measure></music-staff>');
    if (reviewed) value.reviewedShortMeasures = ['short'];
    const result = buildProjection(value);
    expect(errors(result.diagnostics)).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[0].events).toEqual([]);
    expect(result.score.staves[0].measures[0].voices[1].events[0].id).toBe('silence');
    for (const diagnostics of [result.diagnostics, []]) {
      const ordinary = publicationPreflight(value, result.score, diagnostics);
      expect(ordinary.canPublish).toBe(false);
      expect(ordinary.errors.join(' ')).toMatch(/Complete the empty voice or write an explicit rest/);
      const draft = publicationPreflight(value, result.score, diagnostics, { draft: true });
      expect(draft.canPublish).toBe(true);
      expect(draft.warnings.join(' ')).toMatch(/empty|blank/);
      expect(draft.warnings.join(' ')).toContain('DRAFT');
    }
  });

  it('projects an implicit empty draft without inventing silence and permits only marked draft output', () => {
    const value = draftProject('<music-staff id="solo"><music-measure id="short" incomplete><music-direction id="cue" text="Listen" at="0"></music-direction></music-measure></music-staff>');
    value.instructionScopes = { cue: 'all' };
    const before = JSON.stringify(value);
    for (const partId of ['score', 'solo-part']) {
      const result = buildProjection(value, partId);
      expect(errors(result.diagnostics)).toEqual([]);
      expect(result.source.querySelector('music-note, music-rest')).toBeNull();
      expect(result.score.staves[0].measures[0].voices).toHaveLength(1);
      expect(result.score.staves[0].measures[0].voices[0].events).toEqual([]);
      expect(result.score.staves[0].measures[0].annotations[0]).toMatchObject({ id: 'cue', onset: rational(0) });
      expect(publicationPreflight(value, result.score, result.diagnostics).canPublish).toBe(false);
      expect(publicationPreflight(value, result.score, result.diagnostics, { draft: true }).canPublish).toBe(true);
    }
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each(['', 'pickup incomplete'])('does not let draft output waive an empty voice with attributes "%s"', attributes => {
    const value = draftProject(`<music-staff id="solo"><music-measure id="short" ${attributes}></music-measure></music-staff>`);
    const template = document.createElement('template'); template.innerHTML = value.sourceHtml;
    const result = readScore(template.content.firstElementChild!);
    expect(result.diagnostics.some(item => item.code === 'empty-voice' && item.severity === 'error')).toBe(true);
    expect(() => buildProjection(value)).toThrow();
    expect(publicationPreflight(value, result.score, result.diagnostics, { draft: true }).canPublish).toBe(false);
  });

  it('requires completion or explicit short-measure review for accepted incomplete music', () => {
    const value = draftProject('<music-staff id="solo"><music-measure id="short" incomplete><music-note id="short-note" pitch="C4" duration="quarter"></music-note></music-measure></music-staff>');
    const result = buildProjection(value);
    const ordinary = publicationPreflight(value, result.score, result.diagnostics);
    expect(ordinary.canPublish).toBe(false);
    expect(ordinary.errors.join(' ')).toContain('short measure');
    const draft = publicationPreflight(value, result.score, result.diagnostics, { draft: true });
    expect(draft.canPublish).toBe(true);
    expect(draft.warnings.join(' ')).toContain('DRAFT');
    value.reviewedShortMeasures = ['short'];
    const reviewed = publicationPreflight(value, result.score, result.diagnostics);
    expect(reviewed.canPublish).toBe(true);
    expect(reviewed.warnings.join(' ')).toContain('intentionally short');
  });

  it('does not let a short-measure approval approve unfinished tuplets', () => {
    const value = draftProject('<music-staff id="solo"><music-measure id="short" incomplete><music-tuplet id="unfinished" actual="3" normal="2"><music-note id="one" pitch="C4" duration="eighth"></music-note></music-tuplet></music-measure></music-staff>');
    value.reviewedShortMeasures = ['short'];
    const result = buildProjection(value);
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'tuplet-span')).toBe(true);
    expect(publicationPreflight(value, result.score, result.diagnostics).canPublish).toBe(false);
    expect(publicationPreflight(value, result.score, result.diagnostics, { draft: true }).canPublish).toBe(true);
  });

  it('blocks pending source and hard notation errors even for draft output', () => {
    const value = project();
    const result = buildProjection(value);
    value.pendingSource = '<music-note';
    expect(publicationPreflight(value, result.score, result.diagnostics, { draft: true }).canPublish).toBe(false);
    value.pendingSource = null;
    const diagnostic: Diagnostic = { severity: 'error', code: 'unsupported', sourceId: 'fn1', message: 'Unsupported written notation.' };
    expect(publicationPreflight(value, result.score, [diagnostic], { draft: true }).errors).toContain(diagnostic.message);
  });

  it('validates supplied model data instead of trusting an empty diagnostics argument', () => {
    const value = project();
    const malformed = readScore(parseSource(value.sourceHtml)).score;
    const altered = { ...malformed, staves: [{ ...malformed.staves[0], measures: [] }] };
    expect(publicationPreflight(value, altered, [], { draft: true }).canPublish).toBe(false);
  });

  it('requires explicit layout acknowledgement while preserving the risk notices', () => {
    const value = project();
    const result = buildProjection(value);
    const diagnostic: Diagnostic = { severity: 'warning', code: 'print-layout-overflow', sourceId: 'f1', message: 'A measure exceeds the page width.' };
    const options = { layoutIssues: ['System 2 is too tall for page 1.'] };
    const blocked = publicationPreflight(value, result.score, [diagnostic], options);
    expect(blocked.canPublish).toBe(false);
    expect(blocked.warnings).toHaveLength(2);
    const acknowledged = publicationPreflight(value, result.score, [diagnostic], { ...options, acknowledgeLayoutWarnings: true });
    expect(acknowledged.canPublish).toBe(true);
    expect(acknowledged.warnings).toEqual(blocked.warnings);
  });
});

describe('manual page-turn review identity', () => {
  it('is stable across saving and marking a review, but not musical or page changes', () => {
    const value = project();
    const original = turnFingerprint(value, 'piano-part');
    value.updatedAt++;
    value.layouts['piano-part'].reviewedTurns['column-b'] = original;
    expect(turnFingerprint(value, 'piano-part')).toBe(original);
    value.sourceHtml = value.sourceHtml.replace('pitch="C3"', 'pitch="D3"');
    expect(turnFingerprint(value, 'piano-part')).not.toBe(original);
    const updated = turnFingerprint(value, 'piano-part');
    value.layouts['piano-part'].marginMm++;
    expect(turnFingerprint(value, 'piano-part')).not.toBe(updated);
  });

  it('invalidates reviews on instructions, grouping, document headings, and measured pagination', () => {
    for (const change of [
      (value: AuthorProject) => { value.instructionScopes.tempo = 'all'; },
      (value: AuthorProject) => { value.parts[1].staffIds = ['right']; },
      (value: AuthorProject) => { value.metadata.subtitle = 'New performance instructions'; },
    ]) {
      const value = project();
      const before = turnFingerprint(value, 'piano-part');
      change(value);
      expect(turnFingerprint(value, 'piano-part')).not.toBe(before);
    }
    const value = project();
    const first = planPages([{ index: 0, start: 0, end: 2, width: 600, height: 300, pageBreak: false }], defaultLayout());
    const second = planPages([{ index: 0, start: 0, end: 2, width: 600, height: 301, pageBreak: false }], defaultLayout());
    expect(turnFingerprint(value, 'piano-part', first)).not.toBe(turnFingerprint(value, 'piano-part', second));
  });

  it('does not treat record insertion order as a musical or layout change', () => {
    const value = project();
    const before = turnFingerprint(value);
    value.instructionScopes = { 'flute-only': ['flute-part'], 'piano-only': ['piano-part'], global: 'all' };
    expect(turnFingerprint(value)).toBe(before);
    expect(turnFingerprint(value, 'flute-part')).not.toBe(before);
  });
});
