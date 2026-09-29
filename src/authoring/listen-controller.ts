import { buildProjection } from './projection.js';
import { createPlaybackPlan } from './playback-plan.js';
import type { PlaybackPlan } from './playback-plan.js';
import { encodeWav, renderPlayback } from './playback-audio.js';
import type { AuthorProject } from './types.js';

interface ListenSnapshot { project: AuthorProject; partId: string; active: boolean; hasDrafts: boolean }
interface ListenOptions {
  control: <T extends HTMLElement = HTMLElement>(id: string) => T;
  snapshot: () => ListenSnapshot;
  highlight: (ids: readonly string[]) => void;
}
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Owns ephemeral transport/cache only; never writes a project or reads recovery. */
export class ListenController {
  private readonly abort = new AbortController();
  private plan?: PlaybackPlan;
  private buffer?: AudioBuffer;
  private pending?: Promise<AudioBuffer>;
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private generation = 0;
  private action = 0;
  private key = '';
  private documentId = '';
  private tempo?: number;
  private offset = 0;
  private started = 0;
  private frame = 0;
  private preparing = false;
  private disposed = false;
  private highlighted = '';

  private readonly options: ListenOptions;

  constructor(options: ListenOptions) {
    this.options = options;
    const bind = (id: string, type: string, callback: () => void): void => options.control(id).addEventListener(type, callback, { signal: this.abort.signal });
    bind('listen-play', 'click', () => { if (this.source) this.pause(); else void this.play(); });
    bind('listen-stop', 'click', () => this.stop());
    bind('listen-download', 'click', () => { void this.download(); });
    bind('listen-tempo', 'change', () => {
      this.tempo = options.control<HTMLInputElement>('listen-tempo').valueAsNumber;
      this.key = ''; this.refresh();
    });
    bind('listen-score-tempo', 'click', () => { this.tempo = undefined; this.key = ''; this.refresh(); });
    window.addEventListener('pagehide', () => this.stop(), { signal: this.abort.signal });
  }

  refresh(): void {
    const snapshot = this.options.snapshot();
    if (!snapshot.active) { this.stop(); return; }
    if (snapshot.project.id !== this.documentId) { this.documentId = snapshot.project.id; this.tempo = undefined; }
    const key = JSON.stringify([snapshot.project.id, snapshot.project.sourceHtml, snapshot.project.pendingSource, snapshot.project.parts, snapshot.project.instructionScopes, snapshot.partId, snapshot.hasDrafts, this.tempo]);
    if (key === this.key) { this.controls(); return; }
    this.key = key; this.generation++; this.stop(); this.buffer = undefined; this.pending = undefined; this.plan = undefined; this.preparing = false;
    this.options.control('listen-notices').textContent = '';
    try {
      if (snapshot.project.pendingSource !== null) throw new Error('Source has unapplied changes. Return to Write and Apply or Revert before listening.');
      if (snapshot.hasDrafts) throw new Error('There are unapplied form edits. Return to Write and apply or discard them before listening.');
      const projection = buildProjection(snapshot.project, snapshot.partId);
      const error = projection.diagnostics.find(item => item.severity === 'error');
      if (error) throw new Error(error.message);
      this.plan = createPlaybackPlan(projection.score, this.tempo);
      this.options.control<HTMLInputElement>('listen-tempo').value = String(Math.round(this.plan.startBpm * 100) / 100);
      this.options.control('listen-notices').textContent = this.plan.notices.join(' ');
      this.status('Ready · current accepted music.');
    } catch (error) { this.fail(error); }
    this.controls(); this.updatePosition();
  }

  private status(message: string): void { this.options.control('listen-status').textContent = message; }
  private fail(error: unknown): void { this.status(error instanceof Error ? error.message : String(error)); }
  private controls(): void {
    const enabled = !!this.plan && !this.preparing && this.options.snapshot().active;
    this.options.control<HTMLButtonElement>('listen-play').disabled = !enabled;
    this.options.control('listen-play').textContent = this.source ? 'Pause' : this.offset > 0 ? 'Resume' : 'Play';
    this.options.control<HTMLButtonElement>('listen-stop').disabled = !this.source && this.offset === 0 && !this.preparing;
    this.options.control<HTMLButtonElement>('listen-download').disabled = !enabled;
  }
  private position(): number { return this.source && this.context ? Math.min(this.plan?.duration ?? 0, this.offset + this.context.currentTime - this.started) : this.offset; }
  private updatePosition(): void {
    const position = this.position();
    this.options.control('listen-time').textContent = `${clock(position)} / ${clock(this.plan?.duration ?? 0)}`;
    const ids = this.source || this.offset > 0 ? this.plan?.cues.filter(cue => cue.start <= position && position < cue.end).map(cue => cue.id) ?? [] : [];
    const key = ids.join('|');
    if (key !== this.highlighted) { this.highlighted = key; this.options.highlight(ids); }
  }
  private tick = (): void => {
    this.updatePosition();
    if (this.source) this.frame = requestAnimationFrame(this.tick);
  };
  private async prepare(): Promise<AudioBuffer | undefined> {
    if (this.buffer) return this.buffer;
    if (!this.plan) return;
    const generation = this.generation;
    this.preparing = true; this.status('Preparing audio…'); this.controls();
    this.pending ??= renderPlayback(this.plan);
    try {
      const buffer = await this.pending;
      if (this.disposed || generation !== this.generation || !this.options.snapshot().active) return;
      this.buffer = buffer; this.status('Ready · current accepted music.'); return buffer;
    } finally {
      if (generation === this.generation) { this.preparing = false; this.pending = undefined; this.controls(); }
    }
  }
  private async play(): Promise<void> {
    this.refresh();
    if (!this.plan || this.preparing || this.source) return;
    const action = ++this.action;
    try {
      if (typeof AudioContext === 'undefined') throw new Error('This browser does not support audio playback.');
      this.context ??= new AudioContext();
      // Resume while still inside the deliberate user gesture, before rendering.
      await this.context.resume();
      const buffer = await this.prepare();
      if (!buffer || action !== this.action || !this.options.snapshot().active) return;
      if (this.context.state !== 'running') throw new Error('Audio is suspended. Press Play again to resume audio in this browser.');
      if (this.offset >= this.plan.duration) this.offset = 0;
      const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
      this.source = source; this.started = this.context.currentTime;
      source.onended = () => { if (this.source === source) { source.disconnect(); this.source = undefined; this.offset = 0; cancelAnimationFrame(this.frame); this.updatePosition(); this.controls(); this.status('Finished.'); } };
      source.start(0, this.offset); this.controls(); this.status('Playing.'); this.tick();
    } catch (error) { if (action === this.action && !this.disposed) { this.fail(error); this.controls(); } }
  }
  private disconnect(): void {
    const source = this.source; this.source = undefined;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
    cancelAnimationFrame(this.frame);
  }
  private pause(): void {
    this.offset = this.position(); this.action++; this.disconnect(); this.updatePosition(); this.controls(); this.status('Paused.');
  }
  stop(): void {
    this.action++; this.disconnect(); this.offset = 0; this.updatePosition(); this.controls();
    if (this.plan && !this.preparing) this.status('Stopped.');
  }
  private async download(): Promise<void> {
    this.refresh(); if (!this.plan || this.preparing) return;
    const generation = this.generation;
    try {
      const buffer = await this.prepare();
      if (!buffer || this.disposed || generation !== this.generation || !this.options.snapshot().active) return;
      const { project, partId } = this.options.snapshot();
      const part = partId === 'score' ? '' : `-${project.parts.find(part => part.id === partId)?.label ?? 'part'}`;
      const name = `${project.metadata.title || 'score'}${part}`.replace(/[^a-z0-9_-]+/gi, '-');
      const url = URL.createObjectURL(new Blob([encodeWav(buffer)], { type: 'audio/wav' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name}-${this.plan.startBpm}bpm.wav`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      this.status('WAV download requested · same audio as this preview.');
    } catch (error) { if (generation === this.generation && !this.disposed) this.fail(error); }
  }
  dispose(): void { this.disposed = true; this.generation++; this.stop(); this.abort.abort(); void this.context?.close(); this.buffer = undefined; this.pending = undefined; }
}
