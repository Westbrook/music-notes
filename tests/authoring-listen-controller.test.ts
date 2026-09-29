import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../src/authoring/project.js';
import { ListenController } from '../src/authoring/listen-controller.js';
import { renderPlayback } from '../src/authoring/playback-audio.js';
import { buildProjection } from '../src/authoring/projection.js';
vi.mock('../src/authoring/playback-audio.js', () => ({ renderPlayback: vi.fn(), encodeWav: vi.fn(() => new ArrayBuffer(44)) }));
const contexts: FakeContext[] = [];
class FakeSource {
  buffer?: AudioBuffer; onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class FakeContext {
  currentTime = 0; state = 'running'; destination = {}; sources: FakeSource[] = [];
  constructor() { contexts.push(this); }
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
}
const buffer = { duration: 3.12 } as AudioBuffer;
let controller: ListenController | undefined;
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function fixture(source = '<music-staff><music-measure><music-note pitch="G3" duration="whole"></music-note></music-measure></music-staff>') {
  document.body.innerHTML = '<button id="listen-play"></button><button id="listen-stop"></button><button id="listen-download"></button><button id="listen-score-tempo"></button><input id="listen-tempo" type="number"><p id="listen-status"></p><p id="listen-notices"></p><output id="listen-time"></output>';
  const snapshot = { project: createProject(source), partId: 'score', active: true, hasDrafts: false };
  const control = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const highlight = vi.fn();
  controller = new ListenController({ control, snapshot: () => snapshot, highlight }); controller.refresh();
  return { snapshot, control, highlight, controller };
}
afterEach(() => { controller?.dispose(); controller = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.clearAllMocks(); contexts.length = 0; });

describe('Listen lifecycle and current-score ownership', () => {
  it('keeps the reported half-note in 5/4 notation notice playable', async () => {
    vi.stubGlobal('AudioContext', FakeContext); vi.mocked(renderPlayback).mockResolvedValue(buffer);
    const f = fixture('<music-staff><music-measure meter="5/4" incomplete><music-note pitch="G3" duration="half"></music-note></music-measure></music-staff>');
    expect(buildProjection(f.snapshot.project).diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'incomplete-measure',
      message: 'Voice contains 1/2 of 5/4 whole notes. This measure is an incomplete draft.',
    }));
    expect(f.control<HTMLButtonElement>('listen-play').disabled).toBe(false);
    expect(f.control<HTMLButtonElement>('listen-download').disabled).toBe(false);
    f.control('listen-play').click(); await settle();
    const plan = vi.mocked(renderPlayback).mock.calls[0][0];
    expect(plan.duration).toBe(3.75);
    expect(plan.cues[0]).toMatchObject({ start: 0, end: 1.5 });
    expect(f.control('listen-status').textContent).toBe('Playing.');
  });
  it('enables preview and download for an accepted unfinished score without adding rests to it', async () => {
    vi.stubGlobal('AudioContext', FakeContext); vi.mocked(renderPlayback).mockResolvedValue(buffer);
    const f = fixture('<music-staff><music-measure incomplete><music-note pitch="G3" duration="quarter"></music-note></music-measure><music-measure incomplete></music-measure></music-staff>');
    const before = structuredClone(f.snapshot.project);
    expect(f.control<HTMLButtonElement>('listen-play').disabled).toBe(false);
    expect(f.control<HTMLButtonElement>('listen-download').disabled).toBe(false);
    expect(f.control('listen-time').textContent).toBe('0:00 / 0:06');
    expect(f.control('listen-notices').textContent).toMatch(/play as rests/);
    f.control('listen-play').click(); await settle();
    const plan = vi.mocked(renderPlayback).mock.calls[0][0];
    expect(plan.duration).toBe(6); expect(plan.notes).toHaveLength(1); expect(plan.cues).toHaveLength(1);
    expect(f.snapshot.project).toEqual(before);
  });
  it('uses current accepted pitches and invalidates cached audio after an edit', async () => {
    vi.stubGlobal('AudioContext', FakeContext); vi.mocked(renderPlayback).mockResolvedValue(buffer);
    const f = fixture(); f.control('listen-play').click(); await settle();
    expect(renderPlayback).toHaveBeenCalledOnce();
    expect(vi.mocked(renderPlayback).mock.calls[0][0].notes[0].frequency).toBeCloseTo(196);
    expect(f.control('listen-play').textContent).toBe('Pause');
    f.snapshot.project = { ...f.snapshot.project, sourceHtml: f.snapshot.project.sourceHtml.replace('G3', 'G4') }; f.controller.refresh();
    expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();
    f.control('listen-play').click(); await settle();
    expect(renderPlayback).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderPlayback).mock.calls[1][0].notes[0].frequency).toBeCloseTo(392);
  });
  it('resumes from the audio clock and Stop returns to the beginning', async () => {
    vi.stubGlobal('AudioContext', FakeContext); vi.mocked(renderPlayback).mockResolvedValue(buffer);
    const f = fixture(); f.control('listen-play').click(); await settle();
    contexts[0].currentTime = 1.25; f.control('listen-play').click();
    expect(f.control('listen-play').textContent).toBe('Resume');
    f.control('listen-play').click(); await settle();
    expect(contexts[0].sources[1].start).toHaveBeenCalledWith(0, 1.25);
    expect(renderPlayback).toHaveBeenCalledOnce();
    f.control('listen-stop').click(); f.control('listen-play').click(); await settle();
    expect(contexts[0].sources[2].start).toHaveBeenCalledWith(0, 0);
  });
  it('never starts a stale render after Stop or after leaving Listen', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    let finish!: (value: AudioBuffer) => void;
    vi.mocked(renderPlayback).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = fixture(); f.control('listen-play').click(); await settle();
    f.control('listen-stop').click(); finish(buffer); await settle();
    expect(contexts[0].sources).toHaveLength(0);
    f.control('listen-play').click(); f.snapshot.active = false; f.controller.refresh(); await settle();
    expect(contexts[0].sources).toHaveLength(0);
  });
  it('blocks unapplied Source and form drafts instead of playing older music', async () => {
    const f = fixture(); f.snapshot.project.pendingSource = '<bad>'; f.controller.refresh();
    expect(f.control<HTMLButtonElement>('listen-play').disabled).toBe(true);
    expect(f.control('listen-status').textContent).toMatch(/Apply or Revert/);
    f.snapshot.project.pendingSource = null; f.snapshot.hasDrafts = true; f.controller.refresh();
    expect(f.control<HTMLButtonElement>('listen-download').disabled).toBe(true);
    expect(f.control('listen-status').textContent).toMatch(/form edits/);
    expect(renderPlayback).not.toHaveBeenCalled();
  });
});
