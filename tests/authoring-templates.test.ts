// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createTemplate, templateOptions } from '../src/authoring/templates';
import type { TemplateId } from '../src/authoring/templates';
import { importProject, serializeProject } from '../src/authoring/project';
import { EditorSession } from '../src/authoring/editor';
import { analyzeContinuation } from '../src/authoring/continuation';
import { publicationPreflight } from '../src/authoring/projection';
import type { AuthorCommand, EventInput } from '../src/authoring/types';
import { readScore, serializeScore } from '../src/dom/index';
import { add, rational } from '../src/model/index';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

const dimensions: Record<TemplateId, { staves: number; measures: number; parts: number }> = {
  blank: { staves: 1, measures: 1, parts: 1 },
  rhythm: { staves: 1, measures: 1, parts: 1 },
  'three-roads': { staves: 1, measures: 1, parts: 1 },
  lead: { staves: 1, measures: 12, parts: 1 },
  piano: { staves: 2, measures: 4, parts: 1 },
  ensemble: { staves: 3, measures: 4, parts: 3 },
};
const draftTemplates = new Set<TemplateId>(['blank', 'rhythm', 'three-roads']);
const noteInput: EventInput = { kind: 'note', pitch: 'C4', pitches: '', duration: 'quarter', dots: 0,
  rhythmic: false, measureRest: false, accidentalDisplay: 'auto', stem: 'auto', beam: 'auto' };

describe('authoring templates', () => {
  it('offers a small, described set of progressively richer starting points', () => {
    expect(templateOptions.map(option => option.value)).toEqual(['blank', 'rhythm', 'three-roads', 'lead', 'piano', 'ensemble']);
    for (const option of templateOptions) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.description.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(templateOptions)('creates the intended $value draft or study with stable source identities', ({ value }) => {
    const project = createTemplate(value);
    const root = element(project.sourceHtml);
    const source = root.outerHTML;
    const result = readScore(root);
    const expected = dimensions[value];

    expect(result.diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual(draftTemplates.has(value) ? [
      { code: 'empty-voice', severity: 'warning' }, { code: 'incomplete-measure', severity: 'warning' },
    ] : []);
    expect(root.outerHTML).toBe(source);
    expect(result.score.staves).toHaveLength(expected.staves);
    expect(project.parts).toHaveLength(expected.parts);
    expect(project.columns).toHaveLength(expected.measures);
    expect(project.reviewedShortMeasures).toEqual([]);
    expect(project.pendingSource).toBeNull();
    expect(result.score.staves.map(staff => staff.measures.length)).toEqual(
      Array(expected.staves).fill(expected.measures),
    );

    const nodes = [root, ...root.querySelectorAll('*')];
    const ids = nodes.map(node => node.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(createTemplate(value).sourceHtml).toBe(project.sourceHtml);
    expect(readScore(root).score).toEqual(result.score);
    const restored = readScore(element(project.sourceHtml));
    // Implicit voice/standalone score IDs belong to the parser's DOM lifetime;
    // persisted selection and instructions refer to explicit source-node IDs.
    for (const id of ids) {
      expect(result.sources.get(id)?.id).toBe(id);
      expect(restored.sources.get(id)?.id).toBe(id);
    }

    for (const staff of result.score.staves) {
      for (const measure of staff.measures) {
        expect(measure.incomplete).toBe(draftTemplates.has(value));
        expect(measure.pickup).toBe(false);
        for (const voice of measure.voices) {
          expect(voice.events.reduce((total, event) => add(total, event.time), rational(0))).toEqual(
            draftTemplates.has(value) ? rational(0) : rational(measure.meter.numerator, measure.meter.denominator),
          );
          if (draftTemplates.has(value)) expect(voice.events).toEqual([]);
        }
      }
    }
  });

  it.each(templateOptions)('round-trips $value through the pure reader and serializer', ({ value }) => {
    const project = createTemplate(value);
    const original = readScore(element(project.sourceHtml));
    const html = serializeScore(original.score);
    const reparsed = readScore(element(html));
    expect(reparsed.diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual(
      original.diagnostics.map(({ code, severity }) => ({ code, severity })),
    );
    expect(reparsed.score).toEqual(original.score);
    expect(serializeScore(reparsed.score)).toBe(html);
    expect(html).not.toMatch(/<music-[^>]+\/>/);
  });

  it.each(templateOptions)('preserves $value source, part membership and scopes in project JSON', ({ value }) => {
    const project = createTemplate(value);
    expect(importProject(serializeProject(project))).toEqual(project);
  });

  it.each(templateOptions)('leaves $value system wrapping and pagination automatic', ({ value }) => {
    const project = createTemplate(value);
    const root = element(project.sourceHtml);
    expect(root.matches('[max-measures], [break-before], [keep-with-next]')).toBe(false);
    expect(root.querySelectorAll('[max-measures], [break-before], [keep-with-next]')).toHaveLength(0);
    for (const profile of Object.values(project.layouts)) {
      expect(profile.maxMeasures).toBeNull();
      expect(Object.values(profile.breaks).every(choice => choice === 'auto')).toBe(true);
      expect(Object.values(profile.keeps).every(keep => !keep)).toBe(true);
      expect(profile.reviewedTurns).toEqual({});
    }
  });

  it.each([...draftTemplates])('starts %s as one unwritten ordinary bar, not published silence', value => {
    const project = createTemplate(value), session = new EditorSession(project);
    const root = element(project.sourceHtml), { score, diagnostics } = readScore(root);
    expect(score.staves[0]).toMatchObject({ id: `${value}-staff`, clef: 'treble', key: 'C' });
    expect(score.staves[0].measures).toHaveLength(1);
    expect(score.staves[0].measures[0]).toMatchObject({ id: `${value}-m1`, incomplete: true, pickup: false,
      meter: { numerator: 4, denominator: 4 }, voices: [{ events: [], tuplets: [] }] });
    expect(root.querySelector('music-note, music-chord, music-rest, music-rhythm, music-road, music-slash')).toBeNull();
    expect(session.revision).toBe(0); expect(session.canUndo).toBe(false); expect(session.canRedo).toBe(false);
    expect(publicationPreflight(project, score, diagnostics).canPublish).toBe(false);
    expect(publicationPreflight(project, score, diagnostics, { draft: true }).canPublish).toBe(true);
  });

  it.each([...draftTemplates])('writes the first %s event at onset zero and Undo restores the actual blank draft', value => {
    const session = new EditorSession(createTemplate(value)), before = session.project.sourceHtml;
    const staff = session.score.staves[0], measure = staff.measures[0];
    expect(measure.voices[0].events).toEqual([]);
    const cursor = { staffId: staff.id, measureId: measure.id, voiceIndex: 0 };
    session.setCursor(cursor);
    const input: EventInput = { ...noteInput, kind: value === 'rhythm' ? 'rhythm' : value === 'three-roads' ? 'road' : 'note',
      ...(value === 'three-roads' ? { pitchDirection: 'same' as const } : {}) };
    const result = session.execute({ type: 'insert-event', cursor, value: input, position: 'after' });
    expect(session.score.staves[0].measures).toHaveLength(1);
    expect(session.score.staves[0].measures[0].voices[0].events).toEqual([
      expect.objectContaining({ id: result.selectionId, kind: input.kind, onset: rational(0), time: rational(1, 4) }),
    ]);
    expect(result.selectionId).not.toBe(`${value}-m1-rest`);
    expect(session.source.querySelector('music-rest')).toBeNull();
    session.undo(); expect(session.project.sourceHtml).toBe(before); expect(session.cursor).toEqual(cursor);
    expect(session.score.staves[0].measures[0].voices[0].events).toEqual([]); expect(session.canUndo).toBe(false);
  });

  it('preserves all existing road instructions and their source IDs at the start of the blank bar', () => {
    const root = element(createTemplate('three-roads').sourceHtml), measure = readScore(root).score.staves[0].measures[0];
    expect(measure.annotations.map(annotation => [annotation.id, annotation.text, annotation.onset, annotation.placement])).toEqual([
      ['three-roads-instruction', 'Start on Same (middle) at any main pitch.', rational(0), 'below'],
      ['three-roads-lanes', 'Top higher; middle same; bottom lower.', rational(0), 'below'],
      ['three-roads-reference', "Rests keep each voice's last main pitch.", rational(0), 'below'],
      ['three-roads-ties', 'Ties hold main pitch and added harmonies.', rational(0), 'below'],
    ]);
    expect([...root.querySelectorAll('music-direction')].every(node => !node.hasAttribute('at'))).toBe(true);
    expect(measure.voices[0].events).toEqual([]);
  });

  it('keeps explicit silent creation actions and continuation eligibility distinct from a blank starter', () => {
    const session = new EditorSession(createTemplate('blank')), before = session.project.sourceHtml;
    const cursor = { staffId: 'blank-staff', measureId: 'blank-m1', voiceIndex: 0 };
    const continuation = analyzeContinuation(session.source, { cursor, value: noteInput, position: 'after' });
    expect(continuation.eligible).toBe(false); expect(continuation.reason).toMatch(/empty|unwritten/i);
    const commands: AuthorCommand[] = [
      { type: 'append-measure', afterMeasureId: 'blank-m1' },
      { type: 'add-voice', measureId: 'blank-m1' },
      { type: 'add-staff', label: 'Bass', clef: 'bass' },
    ];
    for (const command of commands) {
      session.execute(command);
      const score = session.score;
      expect(score.staves[0].measures[0].voices[0].events).toEqual([]);
      expect(score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)))).toEqual([
        expect.objectContaining({ kind: 'rest', measureRest: true, time: rational(1) }),
      ]);
      session.undo(); expect(session.project.sourceHtml).toBe(before); expect(session.canUndo).toBe(false);
    }
  });

  it('distinguishes the eight-bar head, open vamp, prescribed cue rhythm and written ending', () => {
    const root = element(createTemplate('lead').sourceHtml);
    const measures = readScore(root).score.staves[0].measures;
    expect(measures.slice(0, 8).flatMap(measure => measure.voices[0].events).every(event => event.kind !== 'slash')).toBe(true);
    for (const measure of measures.slice(8, 10)) {
      expect(measure.voices[0].events).toHaveLength(4);
      expect(measure.voices[0].events.every(event => event.kind === 'slash' && !event.rhythmic)).toBe(true);
    }
    const cue = measures[10].voices[0].events;
    expect(cue.filter(event => event.kind === 'slash')).toHaveLength(4);
    expect(cue.filter(event => event.kind === 'slash').every(event => event.rhythmic)).toBe(true);
    expect(cue.filter(event => event.kind === 'rest')).toHaveLength(2);
    expect(measures[11].voices[0].events.every(event => event.kind === 'note')).toBe(true);
    expect(measures[11].endBar).toBe('final');
    expect(root.querySelectorAll('[repeat-start], [end-bar="repeat-end"]')).toHaveLength(0);
    expect(root.querySelector('#lead-vamp-instruction')?.getAttribute('text')).toContain('written once');
    expect(root.querySelector('#lead-cue-instruction')?.getAttribute('text')).toContain('choose pitches');
  });

  it('keeps the piano together as one part and preserves mixed, nested tuplet timing', () => {
    const project = createTemplate('piano');
    const score = readScore(element(project.sourceHtml)).score;
    expect(score.bracket).toBe('brace');
    expect(project.parts).toEqual([{ id: 'piano', label: 'Piano', staffIds: ['piano-upper', 'piano-lower'] }]);
    expect(score.staves[0].measures.every(measure => measure.voices.length === 2)).toBe(true);

    const melody = score.staves[0].measures[2].voices[0];
    expect(melody.tuplets).toEqual([
      expect.objectContaining({ id: 'piano-outer-tuplet', actual: 3, normal: 2 }),
      expect.objectContaining({ id: 'piano-inner-tuplet', actual: 5, normal: 4 }),
    ]);
    expect(melody.tuplets.map(tuplet => tuplet.eventIds.length)).toEqual([6, 5]);
    expect(melody.events[0].time).toEqual(rational(1, 6));
    expect(melody.events.slice(1, 6).map(event => event.time)).toEqual(Array(5).fill(rational(1, 15)));
    expect(melody.events.slice(1, 6).some(event => event.kind === 'rest')).toBe(true);
    expect(melody.events.at(-1)?.onset).toEqual(rational(1, 2));
  });

  it('declares additive grouping and the intended recipients of ensemble instructions', () => {
    const project = createTemplate('ensemble');
    const score = readScore(element(project.sourceHtml)).score;
    const annotations = score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.annotations));
    const annotationIds = new Set(annotations.map(annotation => annotation.id));
    const partIds = new Set(project.parts.map(part => part.id));

    for (const staff of score.staves) {
      for (const measure of staff.measures) {
        expect(measure.meter).toMatchObject({
          numerator: 7, denominator: 8, groups: [2, 2, 3], display: '2+2+3/8', explicitGroups: true,
        });
      }
    }
    for (const annotation of annotations.filter(annotation => ['tempo', 'rehearsal'].includes(annotation.kind))) {
      expect(project.instructionScopes[annotation.id]).toBe('all');
    }
    expect(new Set(Object.keys(project.instructionScopes))).toEqual(annotationIds);
    for (const [sourceId, scope] of Object.entries(project.instructionScopes)) {
      expect(annotationIds.has(sourceId)).toBe(true);
      if (scope !== 'all') expect(scope.every(partId => partIds.has(partId))).toBe(true);
    }
    expect(project.instructionScopes['ensemble-flute-instruction']).toEqual(['flute']);
    expect(project.instructionScopes['ensemble-vibes-instruction']).toEqual(['vibraphone']);
  });

  it('returns fresh project metadata rather than shared template state', () => {
    const first = createTemplate('ensemble');
    first.parts[0].staffIds.push('unrelated');
    first.metadata.title = 'Changed';
    const scope = first.instructionScopes['ensemble-flute-instruction'];
    if (scope !== 'all') scope.push('cello');
    first.instructionScopes['ensemble-tempo'] = ['cello'];

    const second = createTemplate('ensemble');
    expect(second.parts[0].staffIds).toEqual(['ensemble-flute']);
    expect(second.metadata.title).toBe('Three Small Windows');
    expect(second.instructionScopes['ensemble-flute-instruction']).toEqual(['flute']);
    expect(second.instructionScopes['ensemble-tempo']).toBe('all');
  });

  it('rejects unknown template values before creating a project', () => {
    expect(() => createTemplate('constructor' as TemplateId)).toThrow('Unknown score template.');
  });
});
