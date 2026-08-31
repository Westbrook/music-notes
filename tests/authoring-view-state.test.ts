// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reaction } from 'signal-utils/subtle/reaction';
import { AuthorViewState } from '../src/authoring/state/view-state.js';

describe('AuthorViewState', () => {
  it('is independent per workspace and publishes immutable snapshots', () => {
    const first = new AuthorViewState(); const second = new AuthorViewState();
    first.update({ mode: 'read', partId: 'violin', readingWidth: 680 });
    expect(second.signals.mode.get()).toBe('write');
    expect(second.signals.partId.get()).toBe('score');
    expect(first.snapshot.get()).toMatchObject({ mode: 'read', partId: 'violin', readingWidth: 680 });
    expect(Object.isFrozen(first.snapshot.get())).toBe(true);
    expect('set' in first.signals.mode).toBe(false);
    const current = first.snapshot.get(); first.update({ mode: 'read' });
    expect(first.snapshot.get()).toBe(current);
  });

  it('publishes a coherent patch and does not redraw mode consumers for entry feedback', async () => {
    const state = new AuthorViewState(); const modes: string[] = []; const snapshots: unknown[] = [];
    const stopMode = reaction(() => state.signals.mode.get(), value => modes.push(value));
    const stopSnapshot = reaction(() => state.snapshot.get(), value => snapshots.push(value));
    try {
      state.update({ pointerSummary: 'C4 ready', entryMode: true }); await Promise.resolve();
      expect(modes).toEqual([]);
      state.update({ mode: 'pages', entryMode: false }); await Promise.resolve();
      expect(modes).toEqual(['pages']);
      expect(snapshots.at(-1)).toMatchObject({ mode: 'pages', entryMode: false });
      expect(state.signals.isWriting.get()).toBe(false);
    } finally { stopMode(); stopSnapshot(); }
  });
});
