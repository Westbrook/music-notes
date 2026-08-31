import { describe, expect, it } from 'vitest';
import { readScore } from '../src/dom/read-score.js';
import { createProject, parseSource } from '../src/authoring/project.js';
import { createSelection, pruneSelection, reduceSelection, selectionFingerprint } from '../src/authoring/selection.js';
import type { SelectionAction, SelectionContext, SelectionState } from '../src/authoring/selection.js';

const source = `<music-system id="score"><music-staff id="lead">
  <music-measure id="bar-a" number="20B"><music-direction id="instruction" text="Leave space"></music-direction>
    <music-voice id="voice-a"><music-note id="z" pitch="C4" duration="quarter"><music-articulation id="accent" type="accent"></music-articulation></music-note><music-rest id="b" duration="quarter"></music-rest><music-chord id="y" pitches="C4 E4" duration="quarter"></music-chord><music-slash id="a" rhythmic duration="quarter"></music-slash></music-voice>
    <music-voice id="second-a"><music-note id="v2-a" pitch="G4" duration="whole"></music-note></music-voice>
  </music-measure>
  <music-measure id="bar-b" number="3A"><music-voice id="voice-b"><music-note id="x" pitch="D4" duration="half"></music-note><music-note id="c" pitch="E4" duration="half"></music-note></music-voice><music-voice id="second-b"><music-note id="v2-b" pitch="A4" duration="whole"></music-note></music-voice></music-measure>
</music-staff><music-staff id="other"><music-measure id="other-a"><music-rest id="other-rest-a" measure></music-rest></music-measure><music-measure id="other-b"><music-rest id="other-rest-b" measure></music-rest></music-measure></music-staff></music-system>`;

function context(html = source, patch: Partial<SelectionContext> = {}): SelectionContext {
  const project = createProject(html, 'Selection reducer');
  return { score: readScore(parseSource(project.sourceHtml)).score, documentId: 'document', documentEpoch: 1,
    partId: 'score', visibleStaffIds: ['lead', 'other'], ...patch };
}
function act(state: SelectionState, action: SelectionAction, frame: SelectionContext): SelectionState {
  const result = reduceSelection(state, action, frame);
  expect(result.reason).toBeUndefined(); return result.state;
}
function selected(frame: SelectionContext, ids = ['b', 'a', 'c'], primaryId = ids.at(-1)!): SelectionState {
  return act(createSelection(frame), { type: 'set', ids, primaryId, anchorId: ids[0], focusId: primaryId }, frame);
}

describe('whole-event selection reducer', () => {
  it('starts empty without inventing a primary, scope or insertion location', () => {
    const frame = context(), state = createSelection(frame);
    expect(state).toMatchObject({ documentId: 'document', documentEpoch: 1, partId: 'score', ids: [], version: 0 });
    for (const key of ['primaryId', 'anchorId', 'focusId', 'sourceId', 'staffId', 'voiceIndex'] as const) expect(state[key]).toBeUndefined();
  });

  it('plain replacement establishes one whole event, anchor, focus and voice', () => {
    const frame = context(); const state = act(createSelection(frame), { type: 'replace', id: 'y' }, frame);
    expect(state).toMatchObject({ ids: ['y'], primaryId: 'y', anchorId: 'y', focusId: 'y', staffId: 'lead', voiceIndex: 0, version: 1 });
  });

  it('toggles exact membership without filling holes and preserves its fixed anchor', () => {
    const frame = context(); let state = act(createSelection(frame), { type: 'replace', id: 'b' }, frame);
    state = act(state, { type: 'toggle', id: 'c' }, frame);
    expect(state).toMatchObject({ ids: ['b', 'c'], primaryId: 'c', anchorId: 'b', focusId: 'c', version: 2 });
  });

  it('removes the primary using nearest surviving musical position, with earlier winning a tie', () => {
    const frame = context(); const before = selected(frame, ['b', 'a', 'c'], 'a');
    const state = act(before, { type: 'toggle', id: 'a' }, frame);
    expect(state).toMatchObject({ ids: ['b', 'c'], primaryId: 'b', anchorId: 'b', focusId: 'a' });
  });

  it('chooses the nearest survivor rather than always the first selected event', () => {
    const frame = context(); const state = act(selected(frame, ['z', 'x', 'c'], 'c'), { type: 'toggle', id: 'c' }, frame);
    expect(state.primaryId).toBe('x');
  });

  it('removes an anchor without moving a surviving primary', () => {
    const frame = context(); const state = act(selected(frame), { type: 'toggle', id: 'b' }, frame);
    expect(state).toMatchObject({ ids: ['a', 'c'], primaryId: 'c', anchorId: 'a', focusId: 'b' });
  });

  it('replaces a disjoint set with the inclusive anchored range, then shrinks and reverses it', () => {
    const frame = context(); let state = selected(frame, ['b', 'c']);
    state = act(state, { type: 'range', id: 'x' }, frame);
    expect(state).toMatchObject({ ids: ['b', 'y', 'a', 'x'], primaryId: 'x', anchorId: 'b', focusId: 'x' });
    state = act(state, { type: 'range', id: 'y' }, frame); expect(state.ids).toEqual(['b', 'y']);
    state = act(state, { type: 'range', id: 'z' }, frame);
    expect(state).toMatchObject({ ids: ['z', 'b'], primaryId: 'z', anchorId: 'b', focusId: 'z' });
  });

  it('moves Select-more focus without altering membership, primary or anchor', () => {
    const frame = context(); const before = selected(frame, ['b', 'c']);
    const state = act(before, { type: 'focus', id: 'y' }, frame);
    expect(state).toMatchObject({ ids: ['b', 'c'], primaryId: 'c', anchorId: 'b', focusId: 'y', version: before.version + 1 });
    expect(before.focusId).toBe('c');
  });

  it('retains only focus after toggling the last member off; Clear removes that focus', () => {
    const frame = context(); let state = act(createSelection(frame), { type: 'toggle', id: 'b' }, frame);
    state = act(state, { type: 'toggle', id: 'b' }, frame);
    expect(state.ids).toEqual([]); expect(state.focusId).toBe('b');
    expect(state.primaryId).toBeUndefined(); expect(state.anchorId).toBeUndefined(); expect(state.staffId).toBeUndefined();
    state = act(state, { type: 'clear' }, frame); expect(state.focusId).toBeUndefined();
    expect(state.ids).toEqual([]);
  });

  it('does not lock an empty focus-only selection to the old staff', () => {
    const frame = context(); let state = act(createSelection(frame), { type: 'focus', id: 'b' }, frame);
    state = act(state, { type: 'toggle', id: 'other-rest-a' }, frame);
    expect(state).toMatchObject({ ids: ['other-rest-a'], staffId: 'other', voiceIndex: 0 });
  });

  it('moves from structural inspection to empty Select-more focus without producing a mixed state', () => {
    const frame = context(); const structural = act(createSelection(frame), { type: 'source', id: 'instruction' }, frame);
    const state = act(structural, { type: 'focus', id: 'b' }, frame);
    expect(state).toMatchObject({ ids: [], focusId: 'b' }); expect(state.sourceId).toBeUndefined();
    expect(state.primaryId).toBeUndefined(); expect(state.anchorId).toBeUndefined();
  });

  it.each(['toggle', 'range', 'focus'] as const)('rejects out-of-voice %s without changing the old selection or its version', type => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type, id: 'v2-a' }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toMatch(/staff|voice/i); expect(result.state).toEqual(before);
  });

  it.each(['toggle', 'range'] as const)('rejects out-of-staff %s without guessing a new scope', type => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type, id: 'other-rest-a' }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toMatch(/staff|voice/i); expect(result.state).toEqual(before);
  });

  it('allows plain replacement to establish another voice or staff', () => {
    const frame = context(); let state = act(selected(frame), { type: 'replace', id: 'v2-a' }, frame);
    expect(state).toMatchObject({ ids: ['v2-a'], staffId: 'lead', voiceIndex: 1 });
    state = act(state, { type: 'replace', id: 'other-rest-a' }, frame);
    expect(state).toMatchObject({ ids: ['other-rest-a'], staffId: 'other', voiceIndex: 0 });
  });

  it('resolves direct marking targets to their complete event without putting children in membership', () => {
    const frame = context(); const state = act(createSelection(frame), { type: 'replace', id: 'accent' }, frame);
    expect(state.ids).toEqual(['z']);
    const toggled = act(state, { type: 'toggle', id: 'accent' }, frame);
    expect(toggled.ids).toEqual([]); expect(toggled.focusId).toBe('z');
  });

  it.each(['missing', 'instruction', 'bar-a', 'lead'])('rejects non-event target %s without selecting its nearby note', id => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'toggle', id }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toBeTruthy(); expect(result.state).toEqual(before);
  });

  it('rejects a hidden target even when its source ID exists', () => {
    const frame = context(source, { partId: 'lead-part', visibleStaffIds: ['lead'] });
    const before = selected(frame), result = reduceSelection(before, { type: 'replace', id: 'other-rest-a' }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toMatch(/visible|part/i); expect(result.state).toEqual(before);
  });

  it('normalizes exact sets by musical order and uniqueness, not source ID or measure label', () => {
    const frame = context(); const state = act(createSelection(frame), {
      type: 'set', ids: ['c', 'z', 'y', 'z'], primaryId: 'y', anchorId: 'z', focusId: 'y',
    }, frame);
    expect(state.ids).toEqual(['z', 'y', 'c']);
    const same = reduceSelection(state, { type: 'set', ids: ['y', 'z', 'c', 'z'], primaryId: 'y', anchorId: 'z', focusId: 'y' }, frame);
    expect(same.changed).toBe(false); expect(same.state.version).toBe(state.version);
  });

  it.each([
    ['z', 'missing'], ['z', 'v2-a'], ['z', 'other-rest-a'], ['z', 'instruction'], ['z', 'accent'],
  ])('rejects an invalid exact set atomically: %j', (...ids: string[]) => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'set', ids }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toBeTruthy(); expect(result.state).toEqual(before);
  });

  it.each(['primaryId', 'anchorId'] as const)('rejects an exact set whose %s is not a member', field => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'set', ids: ['z', 'c'], [field]: 'b' }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toBeTruthy(); expect(result.state).toEqual(before);
  });

  it.each(['primaryId', 'anchorId', 'focusId'] as const)('rejects an explicitly empty %s instead of losing the selected target', field => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'set', ids: ['z'], [field]: '' }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toBeTruthy(); expect(result.state).toEqual(before);
  });

  it('rejects sparse exact-set arrays rather than producing an undefined member', () => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'set', ids: new Array<string>(1) }, frame);
    expect(result.changed).toBe(false); expect(result.reason).toBeTruthy(); expect(result.state).toEqual(before);
  });

  it('ranges across a missing voice without taking events from another voice', () => {
    const html = '<music-staff id="lead"><music-measure id="first"><music-voice id="first-1"><music-rest id="r1" measure></music-rest></music-voice><music-voice id="first-2"><music-note id="v2-first" pitch="C4" duration="whole"></music-note></music-voice></music-measure><music-measure id="middle"><music-rest id="r2" measure></music-rest></music-measure><music-measure id="last"><music-voice id="last-1"><music-rest id="r3" measure></music-rest></music-voice><music-voice id="last-2"><music-note id="v2-last" pitch="D4" duration="whole"></music-note></music-voice></music-measure></music-staff>';
    const frame = context(html); const before = act(createSelection(frame), { type: 'replace', id: 'v2-first' }, frame);
    const state = act(before, { type: 'range', id: 'v2-last' }, frame);
    expect(state.ids).toEqual(['v2-first', 'v2-last']); expect(state.voiceIndex).toBe(1);
  });

  it('increments the fingerprint for membership changes even when the primary is unchanged', () => {
    const frame = context(), before = selected(frame, ['z', 'c'], 'c');
    const after = act(before, { type: 'set', ids: ['z', 'y', 'c'], primaryId: 'c', anchorId: 'z', focusId: 'c' }, frame);
    expect(after.version).toBe(before.version + 1); expect(selectionFingerprint(after)).not.toBe(selectionFingerprint(before));
  });

  it('leaves both input objects untouched', () => {
    const frame = context(), before = selected(frame), frozen = structuredClone(before);
    const ids = ['c', 'z', 'z']; act(before, { type: 'set', ids }, frame);
    expect(before).toEqual(frozen); expect(ids).toEqual(['c', 'z', 'z']);
  });

  it.each(['score', 'lead', 'bar-a', 'voice-a', 'instruction'])('represents structural source %s distinctly from an empty event selection', id => {
    const frame = context(); const state = act(selected(frame), { type: 'source', id }, frame);
    expect(state.sourceId).toBe(id); expect(state.ids).toEqual([]);
    expect(state.primaryId).toBeUndefined(); expect(state.anchorId).toBeUndefined(); expect(state.focusId).toBeUndefined();
    expect(act(state, { type: 'clear' }, frame).sourceId).toBeUndefined();
  });

  it('does not allow a stale document epoch to select reused IDs', () => {
    const frame = context(), before = selected(frame);
    const result = reduceSelection(before, { type: 'replace', id: 'z' }, { ...frame, documentEpoch: 2 });
    expect(result.changed).toBe(false); expect(result.reason).toMatch(/document|composition/i); expect(result.state).toEqual(before);
  });
});

describe('selection pruning', () => {
  it('does not widen surviving membership or restore a removed member from its endpoints', () => {
    const frame = context(), before = selected(frame, ['z', 'y', 'x'], 'y');
    const next = context(source.replace('id="y"', 'id="replacement"'));
    const result = pruneSelection(before, next, { previousScore: frame.score });
    expect(result.state).toMatchObject({ ids: ['z', 'x'], primaryId: 'z', anchorId: 'z', focusId: 'z' });
    expect(result.changed).toBe(true); expect(result.reason).toBeTruthy();
  });

  it('can exclude same-ID reparented members identified by the session ownership check', () => {
    const frame = context(), before = selected(frame, ['z', 'y', 'x'], 'y');
    const result = pruneSelection(before, frame, { allowedIds: new Set(['z', 'x']), previousScore: frame.score });
    expect(result.state.ids).toEqual(['z', 'x']); expect(result.state.primaryId).toBe('z');
  });

  it('prunes hidden-part targets without selecting the first visible event', () => {
    const frame = context(), before = selected(frame);
    const result = pruneSelection(before, { ...frame, partId: 'other-part', visibleStaffIds: ['other'] });
    expect(result.state).toMatchObject({ partId: 'other-part', ids: [] });
    expect(result.state.primaryId).toBeUndefined(); expect(result.state.focusId).toBeUndefined();
  });

  it('keeps valid exact membership and version during an unrelated change', () => {
    const frame = context(), before = selected(frame);
    const result = pruneSelection(before, context(source.replace('pitch="D4"', 'pitch="D#4"')), { previousScore: frame.score });
    expect(result.changed).toBe(false); expect(result.state).toEqual(before);
  });

  it('clears structural targets hidden by the current part', () => {
    const frame = context(), before = act(createSelection(frame), { type: 'source', id: 'instruction' }, frame);
    const result = pruneSelection(before, { ...frame, partId: 'other-part', visibleStaffIds: ['other'] });
    expect(result.state.sourceId).toBeUndefined(); expect(result.state.ids).toEqual([]);
  });
});
