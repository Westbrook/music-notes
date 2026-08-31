import { render } from 'lit/html.js';
import { readScore, serializeScore } from '../dom/index.js';
import type { Diagnostic, Score } from '../model/types.js';
import type { EngravingOptions, EngravingResult, HitRegion, SystemGeometry } from '../engraving/render.js';
import { MusicDataElement, reflectAttributes } from './data-element.js';
import { describeScore } from './score-description.js';
import { surfaceTemplate } from './surface-template.js';
import type { SurfaceView } from './surface-template.js';

/** A snapshot of the currently displayed projection; coordinates belong to its SVGs. */
export interface LayoutGeometry {
  readonly projection: 'screen' | 'print';
  /** Unique across surfaces and replacements; retained for a cached print view. */
  readonly projectionId: string;
  readonly revision: number;
  readonly scoreId: string;
  readonly systems: readonly SystemGeometry[];
}

/** Measured system and its current DOM frame. SVG references are measurement-only. */
export interface RenderedFrame {
  readonly system: SystemGeometry;
  readonly svg: SVGSVGElement;
  readonly row: HTMLElement | undefined;
}

/** Recheck layout identity/revision before using frames retained across an edit. */
export interface RenderedProjection {
  readonly surface: MusicSurface;
  readonly renderRevision: number;
  readonly layout: LayoutGeometry;
  readonly frames: readonly RenderedFrame[];
}

/** The actual scroll owner is retained even when the event crosses a shadow root. */
export interface NotationViewportChangeDetail {
  readonly scroller: HTMLElement;
  readonly layout: LayoutGeometry | undefined;
}

/** One semantic click, including the intent carried through either hit route. */
export interface NotationSelectionDetail {
  readonly sourceId: string;
  readonly sourceElement: Element | undefined;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly clickCount: number;
  /** Empty for an activation whose originating pointer type is unavailable. */
  readonly pointerType: string;
}

let surfaceSequence = 0;
const diagnosticsPresentationAttribute = 'data-diagnostics-presentation';

function hasSourceChanges(records: readonly MutationRecord[]): boolean {
  // This one metadata attribute configures presentation, never musical meaning.
  return records.some(record => record.type !== 'attributes' || record.attributeName !== diagnosticsPresentationAttribute);
}

/** One coordinator owns all descendant music; nested surfaces remain source data. */
export class MusicSurface extends MusicDataElement {
  static override observedAttributes = [...MusicDataElement.observedAttributes, diagnosticsPresentationAttribute];
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
  /** Reflects presentation metadata without changing music or invalidating engraving. */
  declare diagnosticsPresentation: 'all' | 'errors';

  private readonly observer = new MutationObserver(records => { if (hasSourceChanges(records)) this.scheduleRender(); });
  private resizeObserver?: ResizeObserver;
  private revision = 0;
  private scheduled = false;
  private resolveRender?: () => void;
  private complete: Promise<void> = Promise.resolve();
  private width = -1;
  private currentScore?: Score;
  private view: SurfaceView = {
    initialized: false, visible: false, loading: true, label: 'Music score', description: '', diagnostics: [], diagnosticsPresentation: 'all',
  };
  private sources: ReadonlyMap<string, Element> = new Map();
  private hits: readonly HitRegion[] = [];
  private printed?: EngravingResult;
  private readonly projectionPrefix = `music-projection-${++surfaceSequence}`;
  private geometryRevision = 0;
  private layoutGeometry?: LayoutGeometry;
  private printedGeometry?: LayoutGeometry;
  private renderedProjection?: { projection: RenderedProjection; mount: HTMLElement };
  private readonly onNotationChange = () => this.scheduleRender();
  private readonly onViewportScroll = (event: Event) => {
    const scroller = event.composedPath()[0];
    if (!this.isConnected || !this.isRoot || !(scroller instanceof HTMLElement)) return;
    this.dispatchEvent(new CustomEvent<NotationViewportChangeDetail>('notation-viewport-change', {
      bubbles: true, composed: true, detail: { scroller, layout: this.getLayoutGeometry() },
    }));
  };
  private readonly onSelection = (event: Event) => {
    if (event.defaultPrevented) return;
    const path = event.composedPath();
    const boundary = path.indexOf(this);
    // A workbook may place a whole score inside a disclosure. Only the native
    // controls/text within this surface own its inner events.
    const surfacePath = boundary < 0 ? path : path.slice(0, boundary + 1);
    if (surfacePath.some(node => node instanceof Element
      && node.matches('details,summary,button,a[href],input,select,textarea,[contenteditable],.transcript,.diagnostics'))) return;
    const mouse = event instanceof MouseEvent ? event : undefined;
    if (mouse && (mouse.button !== 0 || (mouse.ctrlKey && /Mac|iPhone|iPad|iPod/i.test(this.ownerDocument.defaultView?.navigator.platform ?? '')))) return;
    const target = path.find((node) => node instanceof Element && node.hasAttribute('data-source-id'));
    let sourceId = target instanceof Element ? target.getAttribute('data-source-id')! : undefined;
    if (!sourceId && this.isRoot && mouse) {
      sourceId = this.getSourceAtPoint(mouse.clientX, mouse.clientY);
      // The semantic selection owns this click. Embedding editors can avoid
      // replacing it with their blank-staff/measure fallback selection.
      // Printed instructions still allow native text selection and copying.
      const source = sourceId ? this.sources.get(sourceId) : undefined;
      if (sourceId && !source?.matches('music-tempo,music-dynamics,music-direction,music-harmony,music-rehearsal')) event.preventDefault();
    }
    if (!sourceId) return;
    this.dispatchEvent(new CustomEvent<NotationSelectionDetail>('notation-select', {
      bubbles: true, composed: true, detail: {
        sourceId, sourceElement: this.sources.get(sourceId), shiftKey: mouse?.shiftKey ?? false,
        ctrlKey: mouse?.ctrlKey ?? false, metaKey: mouse?.metaKey ?? false, altKey: mouse?.altKey ?? false,
        clickCount: mouse && Number.isInteger(mouse.detail) && mouse.detail >= 0 ? mouse.detail : 0,
        pointerType: 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : '',
      },
    }));
  };
  private readonly onHostSelection = (event: Event) => {
    // A host hit can bypass the shadow listener on any rendered root. Restrict
    // this route to host-originated clicks so shadow hits dispatch only once;
    // nested staff/measure elements remain source data, never another renderer.
    if (this.isRoot && event.composedPath()[0] === this) this.onSelection(event);
  };

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    this.updateView();
    shadow.addEventListener('click', this.onSelection);
    shadow.addEventListener('scroll', this.onViewportScroll, { capture: true, passive: true });
    this.addEventListener('click', this.onHostSelection);
  }

  private updateView(patch: Partial<SurfaceView> = {}): void {
    this.view = { ...this.view, ...patch };
    // Commit synchronously inside the existing projection lifecycle so its
    // completion promise and events always include the current accessible UI.
    render(surfaceTemplate(this.view), this.shadowRoot!, { host: this });
  }

  override attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (name === diagnosticsPresentationAttribute) {
      if (previous !== value) this.updateView({ diagnosticsPresentation: value === 'errors' ? 'errors' : 'all' });
      return;
    }
    super.attributeChangedCallback(name, previous, value);
  }

  /** Current complete frame association, without caching screen transforms. */
  getRenderedProjection(): RenderedProjection | undefined {
    const layout = this.getLayoutGeometry();
    if (!this.isConnected || !this.isRoot || !layout) { this.renderedProjection = undefined; return undefined; }
    const cached = this.renderedProjection;
    if (cached?.projection.layout === layout) {
      return cached.projection.frames.every(frame => frame.svg.isConnected && cached.mount.contains(frame.svg)) ? cached.projection : undefined;
    }
    const mount = this.shadowRoot!.querySelector<HTMLElement>(`.${layout.projection}`);
    if (!mount) return undefined;
    const svgs = mount.querySelectorAll<SVGSVGElement>('svg.notation-svg');
    const frames: RenderedFrame[] = [];
    for (const system of layout.systems) {
      const svg = svgs[system.index];
      if (!svg?.isConnected) return undefined;
      frames.push({ system, svg, row: svg.closest<HTMLElement>('.system-row') ?? undefined });
    }
    const projection = { surface: this, renderRevision: this.geometryRevision, layout, frames };
    this.renderedProjection = { projection, mount };
    return projection;
  }

  /** Validate saved frames before reading fresh CTMs; scrolling itself changes no revision. */
  isProjectionCurrent(projection: RenderedProjection): boolean {
    return projection.surface === this && this.getRenderedProjection() === projection
      && projection.renderRevision === this.renderRevision;
  }

  /** Client-coordinate obstacles that previews must not cover with decoration. */
  getNativeControlBounds(): readonly DOMRectReadOnly[] {
    if (!this.isConnected || !this.isRoot) return [];
    return [...this.shadowRoot!.querySelectorAll<HTMLElement>('.diagnostics:not([hidden]),.transcript')]
      .filter(element => element.getClientRects().length > 0).map(element => element.getBoundingClientRect())
      .filter(bounds => bounds.width > 0 && bounds.height > 0);
  }

  /** Resolve inert drawings through their current, measured projection. */
  getSourceAtPoint(clientX: number, clientY: number): string | undefined {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return undefined;
    const projection = this.getRenderedProjection();
    if (!projection) return undefined;
    const contains = (box: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
      x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    for (const { system, svg, row } of projection.frames) {
      const bounds = svg.getBoundingClientRect();
      const viewport = row?.getBoundingClientRect();
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
    this.updateView({ visible: this.isRoot, initialized: this.view.initialized || this.isRoot });
    const surface = this.shadowRoot!.querySelector<HTMLElement>('.surface')!;
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
          this.renderedProjection = undefined;
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
    this.renderedProjection = undefined;
    this.geometryRevision++;
    this.removeEventListener('notation-change', this.onNotationChange);
    this.revision++;
    this.finishRender();
  }

  /** Await source edits. Use refresh() for an immediate ancestor-width change. */
  get renderComplete(): Promise<void> {
    if (hasSourceChanges(this.observer.takeRecords())) this.scheduleRender();
    return this.complete;
  }

  get score(): Score | undefined { return this.currentScore; }
  get diagnostics(): readonly Diagnostic[] { return this.view.diagnostics; }
  getSource(id: string): Element | undefined { return this.sources.get(id); }
  getHitRegions(): readonly HitRegion[] { return this.hits; }

  /**
   * Compare this token and projectionId before using a saved selection rectangle.
   * A viewport-only resize retains the token when the fixed print view is cached.
   */
  get renderRevision(): number {
    if (hasSourceChanges(this.observer.takeRecords())) this.scheduleRender();
    return this.geometryRevision;
  }

  /** Undefined while current geometry is unavailable, invalidated, or erroneous. */
  getLayoutGeometry(): LayoutGeometry | undefined {
    if (hasSourceChanges(this.observer.takeRecords())) this.scheduleRender();
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
      this.renderedProjection = undefined;
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
      this.updateView({ description: describeScore(result.score), label: result.score.label || 'Music score' });
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
        this.renderedProjection = undefined;
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
      this.renderedProjection = undefined;
      this.hits = [];
      diagnostics.push({ severity: 'error', code: 'engraving-error', sourceId: this.currentScore?.id ?? this.id,
        message: error instanceof Error ? error.message : 'Notation could not be rendered.' });
    } finally {
      screen.classList.remove('measuring');
      print.classList.remove('measuring');
      if (revision === this.revision) {
        this.syncPointerSurfaces();
        this.updateView({ diagnostics, loading: false });
        this.dispatchEvent(new CustomEvent('notation-diagnostics', { bubbles: true, composed: true, detail: { diagnostics: this.diagnostics } }));
        this.dispatchEvent(new CustomEvent('notation-render', { bubbles: true, composed: true,
          detail: { score: this.score, diagnostics: this.diagnostics, hitRegions: this.hits,
            layoutGeometry: this.layoutGeometry, renderRevision: this.geometryRevision } }));
        // A consumer may edit the source from either event handler. That new
        // revision must finish before this batch's completion promise resolves.
        if (hasSourceChanges(this.observer.takeRecords())) this.scheduleRender();
        if (revision === this.revision) this.finishRender();
      }
    }
  }
}

reflectAttributes(MusicSurface, {
  label: {}, meter: { default: '4/4' }, groups: {}, clef: { default: 'treble' }, key: { default: 'C' },
  maxMeasures: { type: 'number' }, justifyLast: { type: 'boolean' }, measureNumbers: { default: 'system' },
  printWidth: { type: 'number', default: 680 }, printPreview: { type: 'boolean' },
  diagnosticsPresentation: { attribute: diagnosticsPresentationAttribute, default: 'all' },
});
