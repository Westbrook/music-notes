import { readScore, serializeScore } from '../dom/index.js';
import { formatRational, harmonyIntervalDescription, harmonyIntervalText, pitchDescription } from '../model/index.js';
import type { Diagnostic, Score } from '../model/types.js';
import type { EngravingOptions, EngravingResult, HitRegion, SystemGeometry } from '../engraving/render.js';
import { MusicDataElement, reflectAttributes } from './data-element.js';
import style from './music-surface.css?inline';

/** A snapshot of the currently displayed projection; coordinates belong to its SVGs. */
export interface LayoutGeometry {
  readonly projection: 'screen' | 'print';
  /** Unique across surfaces and replacements; retained for a cached print view. */
  readonly projectionId: string;
  readonly revision: number;
  readonly scoreId: string;
  readonly systems: readonly SystemGeometry[];
}

let surfaceSequence = 0;

function describeScore(score: Score): string {
  const lines = [score.label || 'Music score'];
  for (const staff of score.staves) {
    const rhythm = staff.notation === 'rhythm';
    const roads = staff.notation === 'three-roads';
    lines.push(`${staff.label || 'Staff'}; ${roads ? '3 roads music; top higher, middle same, bottom lower; pitch chosen by the performer' : rhythm ? 'single-line rhythm staff; pitch unspecified' : `${staff.clef} clef`}.`);
    if (roads) lines.push('Choose a starting reference pitch for each voice. Each attack compares with the last main pitch in that voice; rests preserve the reference. Harmony tones and ornament auxiliaries do not change that reference. A tied same direction sustains the main pitch and its harmonies without a new attack.');
    for (const measure of staff.measures) {
      lines.push(`Measure ${measure.number}; ${measure.meter.display}, groups ${measure.meter.groups.join(' + ')}`
        + `${rhythm || roads ? '' : `; key ${measure.key}; ${measure.clef} clef`}${measure.pickup ? '; pickup' : ''}${measure.incomplete ? '; incomplete draft' : ''}.`);
      for (const [index, voice] of measure.voices.entries()) {
        const events = voice.events.map((event) => {
          const name = event.kind === 'rest' ? event.measureRest ? 'full-measure rest' : 'rest'
            : event.kind === 'slash' ? event.rhythmic ? 'rhythmic slash' : 'improvised beat slash'
              : event.kind === 'rhythm' ? 'rhythm note; pitch unspecified'
                : event.kind === 'road' ? `${event.pitchDirection}, ${event.pitchDirection === 'higher' ? 'top' : event.pitchDirection === 'lower' ? 'bottom' : 'middle'} road${event.tie === 'continue' || event.tie === 'end' ? '; sustain without a new attack' : ''}`
                  : event.pitches.map(pitchDescription).join(' + ');
          const tuplets = event.tupletIds.map((id) => voice.tuplets.find((tuplet) => tuplet.id === id))
            .filter((tuplet) => tuplet !== undefined).map((tuplet) => `${tuplet.actual}:${tuplet.normal}`).join(' within ');
          const markings = (event.markings ?? []).map(marking => marking.kind === 'interval'
            ? `harmony ${harmonyIntervalText(marking.interval)}: ${harmonyIntervalDescription(marking.interval)} ${marking.placement} the main pitch`
            : marking.type.replaceAll('-', ' '));
          return `${name}, ${event.dots ? `${event.dots} dot${event.dots > 1 ? 's' : ''} ` : ''}${event.duration}`
            + `${tuplets ? ` in ${tuplets} tuplet` : ''}${event.tie !== 'none' ? `, tie ${event.tie}` : ''}`
            + `${markings.length ? `; ${markings.join('; ')}` : ''}`
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
  private readonly projectionPrefix = `music-projection-${++surfaceSequence}`;
  private geometryRevision = 0;
  private layoutGeometry?: LayoutGeometry;
  private printedGeometry?: LayoutGeometry;
  private readonly onNotationChange = () => this.scheduleRender();
  private readonly onSelection = (event: Event) => {
    const target = event.composedPath().find((node) => node instanceof Element && node.hasAttribute('data-source-id'));
    let sourceId = target instanceof Element ? target.getAttribute('data-source-id')! : undefined;
    if (!sourceId && this.localName === 'music-system' && event instanceof MouseEvent && event.button === 0) {
      if (event.composedPath().some(node => node instanceof Element && node.matches('details, summary, button, a, input, select, textarea, [contenteditable]'))) return;
      sourceId = this.sourceAtPoint(event.clientX, event.clientY);
      // The semantic selection owns this click. Embedding editors can avoid
      // replacing it with their blank-staff/measure fallback selection.
      if (sourceId) event.preventDefault();
    }
    if (!sourceId) return;
    this.dispatchEvent(new CustomEvent('notation-select', {
      bubbles: true, composed: true, detail: { sourceId, sourceElement: this.sources.get(sourceId) },
    }));
  };
  private readonly onHostSelection = (event: Event) => {
    // Fitting systems have no pointer-active shadow content beneath the score.
    // Overflow rows and disclosures still route through the shadow listener.
    if (this.localName === 'music-system' && event.composedPath()[0] === this) this.onSelection(event);
  };

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${style}</style><div class="surface"><div class="loading" role="status">Preparing notation…</div><details class="diagnostics" hidden><summary></summary><ul></ul></details><div class="screen"></div><div class="print"></div><details class="transcript"><summary>Read score as text</summary><pre></pre></details></div><slot hidden></slot>`;
    shadow.addEventListener('click', this.onSelection);
    this.addEventListener('click', this.onHostSelection);
  }

  /** Resolve inert drawings through their current, measured projection. */
  private sourceAtPoint(clientX: number, clientY: number): string | undefined {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return undefined;
    const layout = this.getLayoutGeometry();
    if (!layout) return undefined;
    const svgs = [...this.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} svg.notation-svg`)];
    const contains = (box: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
      x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    for (const system of layout.systems) {
      const svg = svgs[system.index];
      if (!svg) continue;
      const bounds = svg.getBoundingClientRect();
      const viewport = svg.closest('.system-row')?.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || !contains(bounds, clientX, clientY)
        || (viewport && !contains(viewport, clientX, clientY))) continue;
      const matrix = svg.getScreenCTM();
      if (!matrix) continue;
      let point: DOMPoint;
      try { point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()); }
      catch { continue; }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !contains(system.viewBox, point.x, point.y)) continue;
      // Markings belong to a note but retain their own source identity. Test
      // their small ink bounds before the enclosing event's fallback target.
      const candidates = [
        ...(system.markings ?? []), ...system.annotations, ...system.tuplets,
        ...this.hits.filter(hit => hit.system === system.index),
      ];
      const hit = candidates.find(region => contains(region, point.x, point.y));
      if (hit && this.sources.has(hit.sourceId)) return hit.sourceId;
    }
    return undefined;
  }

  private syncPointerSurfaces(): void {
    if (this.localName !== 'music-system') return;
    for (const row of this.shadowRoot!.querySelectorAll<HTMLElement>('.system-row')) {
      row.toggleAttribute('data-scrollable', row.clientWidth > 0 && row.scrollWidth > row.clientWidth);
    }
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
        if (width === 0) {
          this.printed = undefined;
          this.printedGeometry = undefined;
          this.layoutGeometry = undefined;
          this.geometryRevision++;
          return;
        }
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
    this.printedGeometry = undefined;
    this.layoutGeometry = undefined;
    this.geometryRevision++;
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

  /**
   * Compare this token and projectionId before using a saved selection rectangle.
   * A viewport-only resize retains the token when the fixed print view is cached.
   */
  get renderRevision(): number {
    if (this.observer.takeRecords().length) this.scheduleRender();
    return this.geometryRevision;
  }

  /** Undefined while current geometry is unavailable, invalidated, or erroneous. */
  getLayoutGeometry(): LayoutGeometry | undefined {
    if (this.observer.takeRecords().length) this.scheduleRender();
    return this.layoutGeometry;
  }

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
    if (reason !== 'resize') {
      this.printed = undefined;
      this.printedGeometry = undefined;
    }
    // The source revision and projection revision are deliberately different:
    // screen work must not invalidate an unchanged, displayed print projection.
    if (reason !== 'resize' || !this.hasAttribute('print-preview') || !this.printedGeometry) {
      this.layoutGeometry = undefined;
      this.geometryRevision++;
    }
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
    if (this.width === 0) {
      this.printed = undefined;
      this.printedGeometry = undefined;
    }
    return {
      width: this.width || 680,
      maxMeasures: this.hasAttribute('max-measures') ? positive('max-measures', 4, true) : undefined,
      justifyLast: this.hasAttribute('justify-last'),
      measureNumbers: ['system', 'all', 'none'].includes(numbering) ? numbering as 'system' | 'all' | 'none' : 'system',
      printWidth: Math.max(1, Math.floor(positive('print-width', 680))),
    };
  }

  private geometryFor(result: EngravingResult, projection: LayoutGeometry['projection'], scoreId: string): LayoutGeometry | undefined {
    if (!result.systemGeometry) return undefined;
    return { projection, projectionId: `${this.projectionPrefix}:${projection}:${this.geometryRevision}`,
      revision: this.geometryRevision, scoreId, systems: result.systemGeometry };
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
        this.printedGeometry = undefined;
        if (this.layoutGeometry) this.geometryRevision++;
        this.layoutGeometry = undefined;
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
        let printedGeometry = this.printedGeometry;
        if (!printed) {
          print.classList.add('measuring');
          printed = engraving.renderScore(print, result.score, { ...options, width: options.printWidth });
          printedGeometry = this.geometryFor(printed, 'print', result.score.id);
        }
        this.hits = this.hasAttribute('print-preview') ? printed.hitRegions : rendered.hitRegions;
        diagnostics.push(...rendered.diagnostics, ...printed.diagnostics.map((diagnostic) => ({
          ...diagnostic, code: `print-${diagnostic.code}`, message: `Print: ${diagnostic.message}`,
        })));
        // Hidden geometry and errored projections must be retried, not cached.
        this.printed = this.width > 0 && !diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? printed : undefined;
        this.printedGeometry = this.printed ? printedGeometry : undefined;
        if (!this.printed && this.layoutGeometry) this.geometryRevision++;
        this.layoutGeometry = this.printed ? this.hasAttribute('print-preview') ? printedGeometry
          : this.geometryFor(rendered, 'screen', result.score.id) : undefined;
      }
    } catch (error: unknown) {
      if (revision !== this.revision) return;
      screen.replaceChildren();
      print.replaceChildren();
      this.printed = undefined;
      this.printedGeometry = undefined;
      if (this.layoutGeometry) this.geometryRevision++;
      this.layoutGeometry = undefined;
      this.hits = [];
      diagnostics.push({ severity: 'error', code: 'engraving-error', sourceId: this.currentScore?.id ?? this.id,
        message: error instanceof Error ? error.message : 'Notation could not be rendered.' });
    } finally {
      screen.classList.remove('measuring');
      print.classList.remove('measuring');
      if (revision === this.revision) {
        this.syncPointerSurfaces();
        this.currentDiagnostics = diagnostics;
        this.showDiagnostics();
        this.shadowRoot!.querySelector<HTMLElement>('.loading')!.hidden = true;
        this.dispatchEvent(new CustomEvent('notation-diagnostics', { bubbles: true, composed: true, detail: { diagnostics: this.diagnostics } }));
        this.dispatchEvent(new CustomEvent('notation-render', { bubbles: true, composed: true,
          detail: { score: this.score, diagnostics: this.diagnostics, hitRegions: this.hits,
            layoutGeometry: this.layoutGeometry, renderRevision: this.geometryRevision } }));
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
