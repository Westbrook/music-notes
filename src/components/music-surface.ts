import { readScore, serializeScore } from '../dom/index.js';
import { formatRational, pitchText } from '../model/index.js';
import type { Diagnostic, Score } from '../model/types.js';
import type { EngravingOptions, EngravingResult, HitRegion } from '../engraving/render.js';
import { MusicDataElement, reflectAttributes } from './data-element.js';
import style from './music-surface.css?inline';

function describeScore(score: Score): string {
  const lines = [score.label || 'Music score'];
  for (const staff of score.staves) {
    lines.push(`${staff.label || 'Staff'}; ${staff.clef} clef.`);
    for (const measure of staff.measures) {
      lines.push(`Measure ${measure.number}; ${measure.meter.display}, groups ${measure.meter.groups.join(' + ')}; key ${measure.key}; ${measure.clef} clef${measure.pickup ? '; pickup' : ''}${measure.incomplete ? '; incomplete draft' : ''}.`);
      for (const [index, voice] of measure.voices.entries()) {
        const events = voice.events.map((event) => {
          const name = event.kind === 'rest' ? event.measureRest ? 'full-measure rest' : 'rest'
            : event.kind === 'slash' ? event.rhythmic ? 'rhythmic slash' : 'improvised beat slash'
              : event.pitches.map(pitchText).join(' + ');
          const tuplets = event.tupletIds.map((id) => voice.tuplets.find((tuplet) => tuplet.id === id))
            .filter((tuplet) => tuplet !== undefined).map((tuplet) => `${tuplet.actual}:${tuplet.normal}`).join(' within ');
          return `${name}, ${event.dots ? `${event.dots} dot${event.dots > 1 ? 's' : ''} ` : ''}${event.duration}`
            + `${tuplets ? ` in ${tuplets} tuplet` : ''}${event.tie !== 'none' ? `, tie ${event.tie}` : ''}`
            + ` (at ${formatRational(event.onset)}, duration ${formatRational(event.time)} whole notes)`;
        });
        lines.push(`  Voice ${index + 1}: ${events.join('; ')}.`);
      }
      for (const annotation of measure.annotations) {
        lines.push(`  ${annotation.kind} at ${formatRational(annotation.onset)}: ${annotation.text}`
          + (annotation.bpm === undefined ? '' : `; ${annotation.dots ? 'dotted ' : ''}${annotation.beat ?? 'quarter'} = ${annotation.bpm}`));
      }
      if (measure.breakBefore !== 'auto') lines.push(`  Starts a new ${measure.breakBefore}.`);
    }
  }
  return lines.join('\n');
}

/** One coordinator owns all descendant music; nested surfaces remain source data. */
export class MusicSurface extends MusicDataElement {
  declare label: string;
  declare meter: string;
  declare groups: string;
  declare clef: string;
  declare key: string;
  declare maxMeasures: number;
  declare justifyLast: boolean;
  declare measureNumbers: string;
  declare printWidth: number;
  declare printPreview: boolean;

  private readonly observer = new MutationObserver(() => this.scheduleRender());
  private resizeObserver?: ResizeObserver;
  private revision = 0;
  private scheduled = false;
  private resolveRender?: () => void;
  private complete: Promise<void> = Promise.resolve();
  private width = -1;
  private currentScore?: Score;
  private currentDiagnostics: readonly Diagnostic[] = [];
  private sources: ReadonlyMap<string, Element> = new Map();
  private hits: readonly HitRegion[] = [];
  private printed?: EngravingResult;
  private readonly onNotationChange = () => this.scheduleRender();
  private readonly onSelection = (event: Event) => {
    const target = event.composedPath().find((node) => node instanceof Element && node.hasAttribute('data-source-id'));
    if (!(target instanceof Element)) return;
    const sourceId = target.getAttribute('data-source-id')!;
    this.dispatchEvent(new CustomEvent('notation-select', {
      bubbles: true, composed: true, detail: { sourceId, sourceElement: this.sources.get(sourceId) },
    }));
  };

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${style}</style><div class="surface"><div class="loading" role="status">Preparing notation…</div><details class="diagnostics" hidden><summary></summary><ul></ul></details><div class="screen"></div><div class="print"></div><details class="transcript"><summary>Read score as text</summary><pre></pre></details></div><slot hidden></slot>`;
    shadow.addEventListener('click', this.onSelection);
  }

  private get isRoot(): boolean {
    return !this.parentElement?.closest('music-system, music-staff, music-measure');
  }

  connectedCallback(): void {
    super.connectedCallback();
    const surface = this.shadowRoot!.querySelector<HTMLElement>('.surface')!;
    surface.hidden = !this.isRoot;
    if (!this.isRoot) return;
    this.observer.observe(this, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    this.addEventListener('notation-change', this.onNotationChange);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (!this.isConnected || !this.isRoot) return;
        const measured = entries[0]?.contentRect.width;
        if (measured === undefined || !Number.isFinite(measured) || measured < 0) return;
        const width = measured > 0 ? Math.max(1, Math.floor(measured)) : 0;
        if (width === this.width) return;
        this.width = width;
        // Hidden geometry is not a reusable print measurement. Rebuild when the
        // surface becomes visible again, including a return to its former width.
        if (width === 0) { this.printed = undefined; return; }
        this.scheduleRender('resize');
      });
      this.resizeObserver.observe(surface);
    }
    this.scheduleRender();
  }

  disconnectedCallback(): void {
    this.observer.disconnect();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.width = -1;
    this.printed = undefined;
    this.removeEventListener('notation-change', this.onNotationChange);
    this.revision++;
    this.finishRender();
  }

  /** Await source edits. Use refresh() for an immediate ancestor-width change. */
  get renderComplete(): Promise<void> {
    if (this.observer.takeRecords().length) this.scheduleRender();
    return this.complete;
  }

  get score(): Score | undefined { return this.currentScore; }
  get diagnostics(): readonly Diagnostic[] { return this.currentDiagnostics; }
  getSource(id: string): Element | undefined { return this.sources.get(id); }
  getHitRegions(): readonly HitRegion[] { return this.hits; }

  /** Export validated musical data, never a mutable reference to rendering state. */
  toJSON(): Score {
    const result = readScore(this);
    if (result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new Error('Fix notation errors before exporting a score. See diagnostics.');
    }
    return structuredClone(result.score);
  }

  toHTML(): string { return serializeScore(this.toJSON()); }

  /** Invalidation hook for integrations that change their containing layout. */
  refresh(): Promise<void> { this.scheduleRender(); return this.complete; }

  private scheduleRender(reason: 'source' | 'resize' = 'source'): void {
    if (!this.isConnected || !this.isRoot) return;
    // Only a viewport resize can reuse print geometry. Source/options changes,
    // reconnects, explicit refreshes, and edits from event handlers invalidate it.
    if (reason !== 'resize') this.printed = undefined;
    this.revision++;
    if (!this.resolveRender) this.complete = new Promise((resolve) => { this.resolveRender = resolve; });
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.isConnected || !this.isRoot) { this.finishRender(); return; }
      void this.redraw(this.revision);
    });
  }

  private finishRender(): void {
    const resolve = this.resolveRender;
    this.resolveRender = undefined;
    resolve?.();
  }

  private contentWidth(): number {
    const surface = this.shadowRoot!.querySelector<HTMLElement>('.surface')!;
    const computed = getComputedStyle(surface).width;
    // The used CSS width is untransformed and excludes the host's padding and
    // border. clientWidth is only a fallback when no used pixel value is exposed.
    const width = computed.endsWith('px') ? Number.parseFloat(computed) : surface.clientWidth;
    return Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width)) : 0;
  }

  private options(diagnostics: Diagnostic[], sourceId: string): EngravingOptions & { printWidth: number } {
    const positive = (name: string, fallback: number, integer = false): number => {
      const value = this.getAttribute(name);
      if (value === null) return fallback;
      const parsed = Number(value);
      if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
        diagnostics.push({ severity: 'error', code: 'invalid-layout', sourceId, message: `${name} must be a positive ${integer ? 'integer' : 'number'}.` });
        return fallback;
      }
      return parsed;
    };
    const numbering = this.getAttribute('measure-numbers') ?? 'system';
    if (!['system', 'all', 'none'].includes(numbering)) diagnostics.push({ severity: 'error', code: 'invalid-layout', sourceId, message: 'measure-numbers must be system, all, or none.' });
    this.width = this.contentWidth();
    if (this.width === 0) this.printed = undefined;
    return {
      width: this.width || 680,
      maxMeasures: this.hasAttribute('max-measures') ? positive('max-measures', 4, true) : undefined,
      justifyLast: this.hasAttribute('justify-last'),
      measureNumbers: ['system', 'all', 'none'].includes(numbering) ? numbering as 'system' | 'all' | 'none' : 'system',
      printWidth: Math.max(1, Math.floor(positive('print-width', 680))),
    };
  }

  private async redraw(revision: number): Promise<void> {
    const screen = this.shadowRoot!.querySelector<HTMLElement>('.screen')!;
    const print = this.shadowRoot!.querySelector<HTMLElement>('.print')!;
    let diagnostics: Diagnostic[] = [];
    try {
      const result = readScore(this);
      this.currentScore = result.score;
      this.sources = result.sources;
      diagnostics = [...result.diagnostics];
      const options = this.options(diagnostics, result.score.id);
      this.shadowRoot!.querySelector('.transcript pre')!.textContent = describeScore(result.score);
      this.shadowRoot!.querySelector('.surface')!.setAttribute('aria-label', result.score.label || 'Music score');
      // The displayed print projection has not changed during a viewport-only
      // resize, so its selection coordinates remain valid while screen work waits.
      this.hits = this.hasAttribute('print-preview') && this.printed ? this.printed.hitRegions : [];
      if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        screen.replaceChildren();
        print.replaceChildren();
        this.printed = undefined;
        this.hits = [];
      } else {
        const engraving = await import('../engraving/render.js');
        await engraving.engravingReady();
        if (revision !== this.revision || !this.isConnected || !this.isRoot) return;
        // SVG text metrics are zero inside display:none, including print media.
        // Keep a hidden projection measurable only while it is being engraved.
        if (getComputedStyle(screen).display === 'none') screen.classList.add('measuring');
        const rendered = engraving.renderScore(screen, result.score, options);
        let printed = this.printed;
        if (!printed) {
          print.classList.add('measuring');
          printed = engraving.renderScore(print, result.score, { ...options, width: options.printWidth });
        }
        this.hits = this.hasAttribute('print-preview') ? printed.hitRegions : rendered.hitRegions;
        diagnostics.push(...rendered.diagnostics, ...printed.diagnostics.map((diagnostic) => ({
          ...diagnostic, code: `print-${diagnostic.code}`, message: `Print: ${diagnostic.message}`,
        })));
        // Hidden geometry and errored projections must be retried, not cached.
        this.printed = this.width > 0 && !diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? printed : undefined;
      }
    } catch (error: unknown) {
      if (revision !== this.revision) return;
      screen.replaceChildren();
      print.replaceChildren();
      this.printed = undefined;
      this.hits = [];
      diagnostics.push({ severity: 'error', code: 'engraving-error', sourceId: this.currentScore?.id ?? this.id,
        message: error instanceof Error ? error.message : 'Notation could not be rendered.' });
    } finally {
      screen.classList.remove('measuring');
      print.classList.remove('measuring');
      if (revision === this.revision) {
        this.currentDiagnostics = diagnostics;
        this.showDiagnostics();
        this.shadowRoot!.querySelector<HTMLElement>('.loading')!.hidden = true;
        this.dispatchEvent(new CustomEvent('notation-diagnostics', { bubbles: true, composed: true, detail: { diagnostics: this.diagnostics } }));
        this.dispatchEvent(new CustomEvent('notation-render', { bubbles: true, composed: true,
          detail: { score: this.score, diagnostics: this.diagnostics, hitRegions: this.hits } }));
        // A consumer may edit the source from either event handler. That new
        // revision must finish before this batch's completion promise resolves.
        if (this.observer.takeRecords().length) this.scheduleRender();
        if (revision === this.revision) this.finishRender();
      }
    }
  }

  private showDiagnostics(): void {
    const panel = this.shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!;
    const errors = this.currentDiagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    panel.hidden = this.currentDiagnostics.length === 0;
    panel.toggleAttribute('data-errors', errors > 0);
    panel.open = errors > 0;
    panel.querySelector('summary')!.textContent = errors ? `Notation needs attention (${errors} error${errors === 1 ? '' : 's'})`
      : `${this.currentDiagnostics.length} notation notice${this.currentDiagnostics.length === 1 ? '' : 's'}`;
    panel.querySelector('ul')!.replaceChildren(...this.currentDiagnostics.map((diagnostic) => {
      const item = document.createElement('li');
      item.textContent = `${diagnostic.message} [${diagnostic.sourceId}]`;
      item.dataset.sourceId = diagnostic.sourceId;
      return item;
    }));
  }
}

reflectAttributes(MusicSurface, {
  label: {}, meter: { default: '4/4' }, groups: {}, clef: { default: 'treble' }, key: { default: 'C' },
  maxMeasures: { type: 'number' }, justifyLast: { type: 'boolean' }, measureNumbers: { default: 'system' },
  printWidth: { type: 'number', default: 680 }, printPreview: { type: 'boolean' },
});
