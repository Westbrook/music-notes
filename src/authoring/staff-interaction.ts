import type { LayoutGeometry, MusicSurface } from '../components/music-surface.js';
import { readScore } from '../dom/index.js';
import { formatRational, parsePitch, pitchText } from '../model/index.js';
import type { Measure, MusicEvent, Pitch, Score, Staff, Voice } from '../model/types.js';
import type { EventGeometry, MeasureGeometry, SystemGeometry } from '../engraving/render.js';
import { createPitchPreview, createRestPreview } from '../engraving/pointer-preview.js';
import type { RestPreview } from '../engraving/pointer-preview.js';
import { applyCommand } from './commands.js';
import type { EditorSession } from './editor.js';
import { PointerController } from './pointer-controller.js';
import { insertionTarget, pitchAtStaffY, staffPitchY } from './pointer-targets.js';
import { copySourceContext, getSourceHtml } from './project.js';
import type { AuthorCommand, Cursor, EventInput, ViewMode } from './types.js';
import { AuthorTextSelection, classifyAuthorInput, hasInputModifier, isNativeSecondaryClick, selectionModifier } from './input-ownership.js';

type Position = 'before' | 'after' | 'replace';
export interface PointerFeedback {
  readonly message: string;
  readonly kind: 'selection' | 'gesture' | 'notice' | 'info';
}
interface InteractionState {
  mode: ViewMode;
  entryMode: boolean;
  voiceIndex: number;
  partId: string;
  position: Position;
  surface: MusicSurface | undefined;
  ready: boolean;
}
export interface PointerSelection {
  /** Includes document epoch and selection version, not only the primary ID. */
  fingerprint: string;
  eventIds: readonly string[];
  selectMore: boolean;
  activeMarkingId?: string;
}
interface InteractionOptions {
  session: EditorSession;
  host: HTMLElement;
  editor: HTMLElement;
  entryHandle: HTMLButtonElement;
  pitchHandle: HTMLButtonElement;
  status: HTMLElement;
  state: () => InteractionState;
  readEntry: () => EventInput;
  commit: (command: AuthorCommand) => void;
  /** A released, exactly targeted insertion failed without changing accepted music.
   * Return true when the application has presented a separate recovery action. */
  rejected?: (command: Extract<AuthorCommand, { type: 'insert-event' }>, error: unknown) => boolean | void;
  /** A rest has no pitch. Undefined must leave the dormant pitch recipe alone. */
  completed: (kind: 'insert' | 'pitch', pitch: string | undefined) => void;
  error: (error: unknown) => void;
  /** Present the same live text without making transient previews into persistent errors. */
  feedback?: (value: PointerFeedback) => void;
  /** Omit only for legacy single-selection embeddings. */
  selection?: () => PointerSelection;
  /** Park entry before a selection modifier reaches any mutation gesture. */
  beforeSelectionGesture?: () => void;
  /** Root-owned native popovers/task sheets suspend gestures, not writing intent.
   * Call cancel() when a blocker opens so an open→close between samples cannot
   * revive a captured gesture. Omission retains legacy admission behavior. */
  canStartGesture?: () => boolean;
}
interface Frame {
  svg: SVGSVGElement;
  system: SystemGeometry;
  matrix: string;
}
interface Origin {
  staff: Staff;
  measure: Measure;
  voice: Voice;
  event: MusicEvent;
  geometry: EventGeometry;
  lane: MeasureGeometry;
  frame: Frame;
  /** A notehead grab retains its initial offset; a deliberate handle lands directly. */
  offsetY: number;
}
interface Gesture {
  kind: 'insert' | 'pitch';
  state: InteractionState;
  revision: number;
  selectionId: string | undefined;
  selection: PointerSelection | undefined;
  documentId: string;
  cursor: Cursor | undefined;
  layout: LayoutGeometry;
  frames: readonly Frame[];
  score: Score;
  source: Element;
  sourceHtml: string;
  projectedVoiceIds: ReadonlyMap<string, string>;
  entry?: EventInput;
  blocked?: string;
  origin?: Origin;
  candidate?: Candidate;
  feedback?: PointerFeedback;
  lastKey?: string;
  validations: Map<string, { message: string; error: unknown } | null>;
}
interface CandidateFields {
  command: AuthorCommand;
  value: Pick<EventInput, 'duration' | 'dots' | 'stem'>;
  notation: Staff['notation'];
  measure: Measure;
  lane: MeasureGeometry;
  frame: Frame;
  x: number;
  y: number;
  label: string;
  chip: string;
  invalid?: string;
  rejection?: unknown;
}
type Candidate = CandidateFields & ({ entryKind: 'note'; pitch: Pitch } | { entryKind: 'rest' });

const NS = 'http://www.w3.org/2000/svg';
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const matrixKey = (matrix: DOMMatrix): string => [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(',');
const sameCursor = (a: Cursor | undefined, b: Cursor | undefined): boolean => a?.staffId === b?.staffId
  && a?.measureId === b?.measureId && a?.voiceIndex === b?.voiceIndex && a?.eventId === b?.eventId;
interface ScreenBox { left: number; top: number; right: number; bottom: number }
const screenBox = (box: { x: number; y: number; width: number; height: number }, matrix: DOMMatrix): ScreenBox => {
  const corners = [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height)].map(point => point.matrixTransform(matrix));
  return { left: Math.min(...corners.map(point => point.x)), top: Math.min(...corners.map(point => point.y)),
    right: Math.max(...corners.map(point => point.x)), bottom: Math.max(...corners.map(point => point.y)) };
};
const overlapsBox = (a: ScreenBox, b: ScreenBox, gap = 4): boolean => a.left < b.right + gap && a.right > b.left - gap
  && a.top < b.bottom + gap && a.bottom > b.top - gap;

/** A rectangular clip cannot safely approximate rotation, skew, or perspective. */
function hasRectangularClip(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView!;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if (style.perspective && style.perspective !== 'none') return false;
    if (style.rotate && !['none', '0deg'].includes(style.rotate)) return false;
    if (style.scale && style.scale !== 'none'
      && !style.scale.trim().split(/\s+/).every(value => Number.isFinite(Number(value)) && Number(value) > 0)) return false;
    if (!style.transform || style.transform === 'none') continue;
    const values = /^matrix\(([^)]+)\)$/.exec(style.transform)?.[1].split(',').map(Number);
    if (!values || values.length !== 6 || !values.every(Number.isFinite)
      || values[0] <= 0 || values[3] <= 0 || values[1] !== 0 || values[2] !== 0) return false;
  }
  return true;
}
const describeEvent = (event: MusicEvent): string => event.kind === 'rest' ? event.measureRest ? 'full-measure rest' : 'rest'
  : event.kind === 'slash' ? 'improvisation slash' : event.kind === 'rhythm' ? 'rhythm note'
    : event.kind === 'road' ? `${event.pitchDirection} road event` : event.pitches.map(pitchText).join(' + ');
const candidateName = (candidate: Candidate): string => candidate.entryKind === 'rest'
  ? `${candidate.value.duration} rest` : pitchText(candidate.pitch);

/**
 * Author-only interaction over disposable renderer geometry. A pointer never writes
 * SVG or coordinates into musical source; every accepted change is an editor command.
 */
export class StaffInteraction {
  private readonly options: InteractionOptions;
  private readonly controller: PointerController<Gesture>;
  private readonly textSelection: AuthorTextSelection;
  private readonly abort = new AbortController();
  private readonly overlay: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly ghostCache = new Map<string, RestPreview>();
  private hover?: Gesture;
  private announcement = '';
  private announcementKind?: PointerFeedback['kind'];

  constructor(options: InteractionOptions) {
    this.options = options;
    const doc = options.host.ownerDocument;
    this.overlay = doc.createElement('div');
    this.overlay.className = 'pointer-preview';
    this.overlay.setAttribute('aria-hidden', 'true');
    const style = doc.createElement('style');
    style.textContent = `
      .pointer-preview{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:3}
      .pointer-preview-content,.pointer-ghost{position:absolute;inset:0;pointer-events:none}
      .pointer-geometry{display:block;position:absolute;inset:0;width:100%;height:100%;overflow:visible}
      .pointer-ghost[data-valid="false"] .pointer-geometry{opacity:.42}
      .pointer-preview-symbol{color:var(--author-insertion,#087368)}
      .pointer-target-caret{stroke:var(--author-insertion,#087368);stroke-width:2;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
      .pointer-ghost[data-valid="false"] .pointer-target-caret{stroke:var(--author-error,#a32934)}
      .pointer-ghost[data-valid="false"] .pointer-preview-symbol{color:var(--author-error,#a32934)}
      .pointer-target-label{position:absolute;box-sizing:border-box;max-width:min(264px,90%);padding:6px 9px;border:1px solid var(--author-insertion,#087368);border-radius:6px;background:var(--author-paper,#fff);color:var(--author-ink,#20252b);box-shadow:0 2px 8px var(--author-insertion-fill,rgba(8,115,104,.1));font:12px/1.4 ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}
      .pointer-target-label[data-valid="false"]{color:var(--author-error,#a32934);border-color:var(--author-error,#a32934)}
      @media print{.pointer-preview{display:none!important}}
    `;
    this.content = doc.createElement('div');
    this.content.className = 'pointer-preview-content';
    this.overlay.append(style, this.content);
    options.host.shadowRoot!.append(this.overlay);
    this.textSelection = new AuthorTextSelection({ host: options.host, context: () => {
      const state = options.state(); return { enabled: state.mode === 'write', surface: state.surface };
    } });
    this.controller = new PointerController<Gesture>({
      root: doc.body,
      begin: event => this.begin(event),
      preview: (gesture, event, dragging) => this.preview(gesture, event, dragging),
      commit: (gesture, event, dragging) => this.commit(gesture, event, dragging),
      cancel: (_gesture, reason) => {
        this.clear();
        if (!['selection-tap', 'dispose', 'callback-error'].includes(reason)) {
          this.announce(reason === 'native-pan' ? 'Scroll the score. No music changed.' : 'Gesture cancelled. No music changed.',
            ['stale', 'invalid-pointer'].includes(reason) ? 'notice' : 'info');
        }
      },
      isCurrent: gesture => this.isCurrent(gesture),
      onError: error => {
        this.clear();
        try { options.error(error); }
        finally { this.announce(messageOf(error).trim() || 'The staff interaction could not finish.', 'notice'); }
      },
    });
    options.host.addEventListener('pointermove', event => this.hoverAt(event), { signal: this.abort.signal });
    options.host.addEventListener('pointerleave', () => { if (!this.controller.active) this.clear(); }, { signal: this.abort.signal });
    // Native #score-scroll movement stays unprevented and cancels the old geometry.
    // The inner score mount's non-composed scroll needs its own shadow listener.
    doc.addEventListener('scroll', () => this.cancel('scroll'), { capture: true, passive: true, signal: this.abort.signal });
    options.host.shadowRoot!.addEventListener('scroll', () => this.cancel('scroll'), { capture: true, passive: true, signal: this.abort.signal });
    doc.defaultView!.addEventListener('resize', () => this.cancel('resize'), { signal: this.abort.signal });
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') this.cancel('visibility'); }, { signal: this.abort.signal });
    for (const name of ['input', 'change']) doc.addEventListener(name, () => this.cancel('settings'), { capture: true, signal: this.abort.signal });
  }

  cancel(reason = 'context'): void { this.controller.cancel(reason); this.textSelection.clear(); this.clear(); }
  dispose(): void { this.controller.dispose(); this.textSelection.dispose(); this.abort.abort(); this.overlay.remove(); this.ghostCache.clear(); }

  private announce(message: string, kind: PointerFeedback['kind']): void {
    if (message === this.announcement && kind === this.announcementKind) return;
    this.announcement = message;
    this.announcementKind = kind;
    this.options.status.textContent = message;
    try { this.options.feedback?.({ message, kind }); }
    catch (error) {
      // A presentation subscriber must not cancel an otherwise valid musical
      // gesture or turn an accepted command into a second attempted action.
      try { this.options.error(error); } catch { /* Preserve the pointer lifecycle. */ }
    }
  }
  private clear(): void {
    this.hover = undefined;
    this.content.replaceChildren();
    delete this.options.host.ownerDocument.body.dataset.pointerGesture;
    if (this.announcementKind === 'gesture') this.announce(this.announcement, 'info');
  }
  private snapshot(kind: Gesture['kind']): Gesture | undefined {
    const state = { ...this.options.state() };
    if (state.mode !== 'write' || !state.ready || this.options.canStartGesture?.() === false) return undefined;
    const layout = state.surface?.getLayoutGeometry();
    if (!layout || layout.projection !== 'screen') return undefined;
    const source = this.options.session.source.cloneNode(true) as Element;
    copySourceContext(this.options.session.source, source);
    const svgNodes = [...state.surface!.shadowRoot!.querySelectorAll<SVGSVGElement>('.screen svg.notation-svg')];
    const frames: Frame[] = [];
    for (const system of layout.systems) {
      const svg = svgNodes[system.index];
      const matrix = svg?.getScreenCTM();
      if (!matrix) return undefined;
      frames.push({ svg, system, matrix: matrixKey(matrix) });
    }
    const score = this.options.session.score;
    const gesture: Gesture = {
      kind, state, revision: this.options.session.revision, selectionId: this.options.session.selectionId,
      selection: this.selectionSnapshot(), documentId: this.options.session.project.id,
      cursor: this.options.session.cursor, layout, frames, score,
      source, sourceHtml: getSourceHtml(source), projectedVoiceIds: this.projectedEmptyVoices(score, source, state.surface!), validations: new Map(),
    };
    if (this.options.session.project.pendingSource !== null) gesture.blocked = 'Apply or Revert the source draft before editing notes on the staff.';
    if (kind === 'insert') {
      try {
        gesture.entry = { ...this.options.readEntry() };
        if (gesture.entry.kind === 'rest' && gesture.entry.measureRest) {
          gesture.blocked ??= 'Use Insert here in an empty voice, or explicitly Replace a sole eligible event, to write a full-measure rest. Staff gestures place ordinary written rest values.';
        } else if (gesture.entry.kind !== 'note' && gesture.entry.kind !== 'rest') gesture.blocked ??= gesture.entry.kind === 'rhythm'
          ? 'Rhythm notes have no vertical pitch position. Select a rhythm staff and use Insert to add the written duration.'
          : gesture.entry.kind === 'road' ? '3 roads events use Higher, Same, or Lower instructions, not fixed pitch positions. Choose a direction and use Insert.'
            : 'Staff entry adds single notes and written rests. Use Insert for chords or improvisation slashes.';
        else if (gesture.entry.kind === 'note') parsePitch(gesture.entry.pitch, undefined, gesture.entry.accidentalDisplay);
      } catch (error) { gesture.blocked ??= messageOf(error); }
    }
    return gesture;
  }

  /** Empty voices cannot use neighboring event IDs to bridge generated aliases. */
  private projectedEmptyVoices(score: Score, source: Element, surface: MusicSurface): ReadonlyMap<string, string> {
    const ids = new Map<string, string>();
    if (!score.staves.some(staff => staff.measures.some(measure => measure.voices.some(voice => !voice.events.length)))) return ids;
    const projected = surface.score;
    if (!projected || typeof surface.getSource !== 'function') return ids;
    const canonicalSources = readScore(source).sources;
    const directVoices = (measure: Element): Element[] => [...measure.children].filter(element => element.localName === 'music-voice');
    for (const staff of score.staves) {
      const projectedStaff = projected.staves.find(item => item.id === staff.id);
      const staffNode = canonicalSources.get(staff.id); const projectedStaffNode = surface.getSource(staff.id);
      const notation = staff.notation ?? 'pitched';
      if (!projectedStaff || !staffNode || !projectedStaffNode || !['pitched', 'rhythm', 'three-roads'].includes(notation)
        || (projectedStaff.notation ?? 'pitched') !== notation) continue;
      for (const [measureIndex, measure] of staff.measures.entries()) {
        const current = projectedStaff.measures[measureIndex];
        if (!measure.incomplete || measure.pickup || current?.id !== measure.id || !current.incomplete || current.pickup
          || current.voices.length !== measure.voices.length) continue;
        const measureNode = canonicalSources.get(measure.id); const projectedMeasureNode = surface.getSource(measure.id);
        if (measureNode?.localName !== 'music-measure' || projectedMeasureNode?.localName !== 'music-measure'
          || measureNode.closest('music-staff') !== staffNode || projectedMeasureNode.closest('music-staff') !== projectedStaffNode
          || !surface.contains(projectedMeasureNode)) continue;
        const authoredVoices = directVoices(measureNode); const renderedVoices = directVoices(projectedMeasureNode);
        measure.voices.forEach((voice, voiceIndex) => {
          const projectedVoice = current.voices[voiceIndex];
          if (voice.events.length || voice.tuplets.length || !projectedVoice || projectedVoice.events.length || projectedVoice.tuplets.length) return;
          const owner = surface.getSource(projectedVoice.id);
          if (authoredVoices.length) {
            if (authoredVoices.length !== measure.voices.length || renderedVoices.length !== current.voices.length
              || authoredVoices[voiceIndex]?.id !== voice.id || canonicalSources.get(voice.id) !== authoredVoices[voiceIndex]
              || projectedVoice.id !== voice.id || renderedVoices[voiceIndex]?.id !== voice.id || owner !== renderedVoices[voiceIndex]) return;
          } else if (renderedVoices.length || measure.voices.length !== 1 || voiceIndex !== 0 || owner !== projectedMeasureNode) return;
          ids.set(voice.id, projectedVoice.id);
        });
      }
    }
    return ids;
  }

  private isCurrent(gesture: Gesture): boolean {
    if (this.options.canStartGesture?.() === false) return false;
    const state = this.options.state();
    const layout = state.surface?.getLayoutGeometry();
    const selection = this.options.selection?.();
    const sameSelection = !selection && !gesture.selection || !!selection && !!gesture.selection
      && selection.fingerprint === gesture.selection.fingerprint && selection.selectMore === gesture.selection.selectMore
      && selection.activeMarkingId === gesture.selection.activeMarkingId
      && selection.eventIds.length === gesture.selection.eventIds.length
      && selection.eventIds.every((id, index) => id === gesture.selection!.eventIds[index]);
    return state.mode === 'write' && state.ready && this.options.session.revision === gesture.revision
      && this.options.session.project.id === gesture.documentId && sameSelection
      && this.options.session.selectionId === gesture.selectionId && state.surface === gesture.state.surface
      && sameCursor(this.options.session.cursor, gesture.cursor)
      && state.partId === gesture.state.partId && state.voiceIndex === gesture.state.voiceIndex
      && state.entryMode === gesture.state.entryMode && state.position === gesture.state.position
      && layout?.projectionId === gesture.layout.projectionId && layout.revision === gesture.layout.revision
      && gesture.frames.every(frame => {
        const matrix = frame.svg.getScreenCTM();
        return frame.svg.isConnected && matrix !== null && matrixKey(matrix) === frame.matrix;
      });
  }

  /** Validation and commit failures may offer recovery only for the captured score. */
  private acceptedContextUnchanged(gesture: Gesture): boolean {
    return this.isCurrent(gesture) && getSourceHtml(this.options.session.source) === gesture.sourceHtml;
  }

  private selectionSnapshot(): PointerSelection | undefined {
    const selection = this.options.selection?.();
    return selection ? { ...selection, eventIds: [...selection.eventIds] } : undefined;
  }

  private begin(event: PointerEvent) {
    const path = event.composedPath();
    const entryHandle = path.includes(this.options.entryHandle);
    const pitchHandle = path.includes(this.options.pitchHandle);
    const onScore = path.includes(this.options.host);
    if (!entryHandle && !pitchHandle && !onScore) return undefined;
    const state = this.options.state();
    if (state.mode !== 'write') return undefined;
    if (this.options.canStartGesture?.() === false) { this.clear(); return undefined; }
    const owner = classifyAuthorInput(event, { host: this.options.host, surface: state.surface });
    if (!entryHandle && !pitchHandle && owner.owner === 'native') return undefined;
    const selection = this.options.selection?.();
    const platform = this.options.host.ownerDocument.defaultView?.navigator.platform ?? '';
    if (isNativeSecondaryClick(event, platform)) return undefined;
    if (hasInputModifier(event) || selection?.selectMore) {
      if (onScore && (selectionModifier(event, platform) || selection?.selectMore)) this.options.beforeSelectionGesture?.();
      this.clear(); return undefined;
    }
    // Review may have been dismissed by another action since the previous
    // attempt. A new press must be able to report the same refusal again.
    // Resetting dedupe is silent, so an ordinary Select tap stays ordinary.
    this.announcementKind = undefined;
    if (!state.ready) { this.announce('Wait for the score to finish engraving.', 'notice'); return undefined; }
    const insert = entryHandle || (!pitchHandle && state.entryMode);
    if (!insert && selection && (selection.eventIds.length !== 1 || selection.activeMarkingId)) {
      if (pitchHandle) this.announce('Select one untied pitched note to drag its pitch. A selection of several events or an attached mark cannot drag its owner.', 'notice');
      return undefined;
    }
    const gesture = this.snapshot(insert ? 'insert' : 'pitch');
    if (!gesture) return undefined;
    if (!insert) {
      gesture.origin = pitchHandle ? this.selectedOrigin(gesture) : this.originAt(gesture, event);
      if (!gesture.origin) return undefined;
      const eventValue = gesture.origin.event;
      if (eventValue.kind !== 'note' || eventValue.pitches.length !== 1) gesture.blocked ??= 'Drag a single notehead. Use Apply to selection to edit chord pitches; rests, slashes, rhythm notes, and road events have no fixed pitch.';
      else if (eventValue.tie !== 'none') gesture.blocked ??= 'This note is tied, so pitch dragging is unavailable. Use the selection and passage controls to edit the phrase.';
    }
    this.hover = undefined;
    this.options.host.ownerDocument.body.dataset.pointerGesture = gesture.kind;
    return {
      value: gesture,
      capture: entryHandle ? this.options.entryHandle : pitchHandle ? this.options.pitchHandle : this.options.host,
      allowTap: insert && !entryHandle,
      nativePan: event.pointerType === 'touch' && !entryHandle && !pitchHandle,
    };
  }

  private containsPoint(event: Pick<PointerEvent, 'clientX' | 'clientY'>): boolean {
    const bounds = this.visibleScoreBounds();
    const cover = this.visibleChromeBounds();
    if (cover && event.clientX >= cover.left && event.clientX <= cover.right && event.clientY >= cover.top && event.clientY <= cover.bottom) return false;
    return bounds.right > bounds.left && bounds.bottom > bounds.top
      && event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  }
  private visibleChromeBounds(): ScreenBox | undefined {
    // The current dock is a sibling of the score editor. Resolve it from a
    // trusted control, retaining the old embedded toolbar for older integrations.
    const chrome = this.options.status.closest<HTMLElement>('#workspace-dock')
      ?? this.options.status.closest<HTMLElement>('#pointer-tools')
      ?? this.options.editor.querySelector<HTMLElement>('#pointer-tools');
    if (!chrome?.isConnected) return undefined;
    const view = chrome.ownerDocument.defaultView!;
    for (let element: HTMLElement | null = chrome; element; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      if (element.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return undefined;
    }
    const bounds = chrome.getBoundingClientRect();
    return [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)
      && bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : undefined;
  }
  private visibleScoreBounds(): ScreenBox {
    const host = this.options.host.getBoundingClientRect();
    const view = this.options.host.ownerDocument.defaultView!;
    const viewport = this.options.host.closest<HTMLElement>('#score-scroll');
    const bounds = viewport?.getBoundingClientRect();
    if (viewport && bounds && (!viewport.offsetWidth || !viewport.offsetHeight || !hasRectangularClip(viewport))) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    // Client metrics exclude borders/scrollbars but precede CSS scaling. Convert
    // them to the same screen coordinates used by pointer events and SVG CTMs.
    const scaleX = bounds && viewport ? bounds.width / viewport.offsetWidth : 1;
    const scaleY = bounds && viewport ? bounds.height / viewport.offsetHeight : 1;
    const left = bounds && viewport ? bounds.left + viewport.clientLeft * scaleX : host.left;
    const top = bounds && viewport ? bounds.top + viewport.clientTop * scaleY : host.top;
    const right = bounds && viewport ? left + viewport.clientWidth * scaleX : host.right;
    const bottom = bounds && viewport ? top + viewport.clientHeight * scaleY : host.bottom;
    return { left: Math.max(0, host.left, left), top: Math.max(0, host.top, top),
      right: Math.min(view.innerWidth, host.right, right), bottom: Math.min(view.innerHeight, host.bottom, bottom) };
  }
  private point(frame: Frame, event: Pick<PointerEvent, 'clientX' | 'clientY'>): DOMPoint | undefined {
    const matrix = frame.svg.getScreenCTM();
    if (!matrix) return undefined;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  private framePoint(frame: Frame, event: Pick<PointerEvent, 'clientX' | 'clientY'>): DOMPoint | undefined {
    const point = this.point(frame, event); if (!point) return undefined;
    const box = frame.system.viewBox;
    // Ledger extensions cannot reach through the gap into another wrapped system.
    return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height ? point : undefined;
  }
  private findLocation(score: Score, id: string): Omit<Origin, 'geometry' | 'lane' | 'frame' | 'offsetY'> | undefined {
    for (const staff of score.staves) for (const measure of staff.measures) for (const voice of measure.voices) {
      const event = voice.events.find(event => event.id === id);
      if (event) return { staff, measure, voice, event };
    }
    return undefined;
  }
  private selectedOrigin(gesture: Gesture): Origin | undefined {
    const id = gesture.selectionId;
    if (!id) return undefined;
    const location = this.findLocation(gesture.score, id);
    if (!location) return undefined;
    if ((location.staff.notation ?? 'pitched') !== 'pitched') {
      this.announce(location.staff.notation === 'three-roads'
        ? '3 roads music has no fixed pitch to drag. Use the direction selector for Higher, Same, or Lower, and Edit for duration and dots.'
        : 'A rhythm staff has no pitch to drag. Use Edit rhythm note for duration and dots.', 'notice');
      return undefined;
    }
    for (const frame of gesture.frames) {
      const geometry = frame.system.events.find(event => event.sourceId === id);
      const lane = frame.system.measures.find(measure => measure.sourceId === location.measure.id);
      if (geometry && lane && geometry.noteheads?.length) return { ...location, geometry, lane, frame, offsetY: 0 };
    }
    return undefined;
  }
  private originAt(gesture: Gesture, event: PointerEvent): Origin | undefined {
    if (!this.containsPoint(event)) return undefined;
    for (const frame of gesture.frames) {
      const point = this.framePoint(frame, event); if (!point) continue;
      const matrix = frame.svg.getScreenCTM()!;
      const padding = 3 / Math.max(.01, Math.hypot(matrix.a, matrix.b));
      const hits = frame.system.events.filter(region => region.noteheads?.some(head =>
        point.x >= head.x - padding && point.x <= head.x + head.width + padding
        && point.y >= head.y - padding && point.y <= head.y + head.height + padding));
      const candidates = hits.flatMap(geometry => {
        const location = this.findLocation(gesture.score, geometry.sourceId);
        const lane = frame.system.measures.find(measure => measure.sourceId === geometry.measureId);
        if (!location || !lane || (location.staff.notation ?? 'pitched') !== 'pitched' || !location.event.pitches.length
          || location.measure.voices[gesture.state.voiceIndex] !== location.voice) return [];
        return [{ ...location, geometry, lane, frame, offsetY: point.y - staffPitchY(location.event.pitches[0], location.measure.clef, lane) }];
      });
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) { this.announce('These noteheads overlap. Select the intended voice and use Apply to selection.', 'notice'); return undefined; }
      if (hits.length) { this.announce('Select this note’s voice before dragging its pitch.', 'notice'); return undefined; }
    }
    return undefined;
  }

  private hoverAt(event: PointerEvent): void {
    if (this.options.canStartGesture?.() === false) { this.cancel('admission'); return; }
    if (this.controller.active || event.pointerType === 'touch' || !this.options.state().entryMode) return;
    if (hasInputModifier(event) || this.options.selection?.().selectMore
      || classifyAuthorInput(event, { host: this.options.host, surface: this.options.state().surface }).owner === 'native') {
      this.clear(); return;
    }
    if (!this.hover || !this.isCurrent(this.hover)) this.hover = this.snapshot('insert');
    if (this.hover) this.preview(this.hover, event, false);
  }
  private preview(gesture: Gesture, event: PointerEvent, dragging: boolean): void {
    if (hasInputModifier(event)) { this.cancel('selection-modifier'); return; }
    if (gesture.kind === 'pitch' && !dragging) return;
    if (gesture.blocked) { this.invalid(gesture, gesture.blocked, 'notice'); return; }
    let candidate: Candidate | undefined;
    try {
      if (this.containsPoint(event)) candidate = gesture.kind === 'insert' ? this.insertCandidate(gesture, event) : this.pitchCandidate(gesture, event);
    } catch (error) { this.invalid(gesture, messageOf(error), 'notice'); return; }
    if (!candidate) {
      this.invalid(gesture, gesture.kind === 'insert'
        ? 'Point inside a staff at an existing boundary in the active voice. Before/After needs a target on that side; use Replace for an existing event.'
        : 'Keep the pitch drag over the original measure. Its staff, voice, and musical time stay fixed.');
      return;
    }
    const key = JSON.stringify(candidate.command);
    if (!gesture.validations.has(key)) {
      let failure: { message: string; error: unknown } | null = null;
      try {
        const staged = gesture.source.cloneNode(true) as Element;
        copySourceContext(gesture.source, staged);
        applyCommand(staged, candidate.command);
        const errors = readScore(staged).diagnostics.filter(diagnostic => diagnostic.severity === 'error');
        if (errors.length) {
          const message = errors.map(error => error.message).join(' ');
          failure = { message, error: new Error(message) };
        }
      } catch (error) { failure = { message: messageOf(error) || 'The musical edit was rejected.', error }; }
      if (gesture.validations.size >= 128) gesture.validations.delete(gesture.validations.keys().next().value!);
      gesture.validations.set(key, failure);
    }
    const failure = gesture.validations.get(key);
    candidate.invalid = failure?.message;
    candidate.rejection = failure?.error;
    gesture.candidate = candidate;
    const label = candidate.invalid ? `Cannot place ${candidateName(candidate)}. ${candidate.invalid}` : candidate.label;
    gesture.feedback = { message: label, kind: 'gesture' };
    if (gesture.lastKey === key) return;
    gesture.lastKey = key;
    this.announce(label, 'gesture');
    try { this.draw(candidate, candidate.invalid ? `Cannot place ${candidateName(candidate)}` : candidate.chip, gesture.frames); }
    catch (error) { this.invalid(gesture, `Preview unavailable. No music changed. ${messageOf(error)}`, 'notice'); }
  }
  private invalid(gesture: Gesture, message: string, kind: PointerFeedback['kind'] = 'gesture'): void {
    gesture.candidate = undefined;
    gesture.feedback = { message, kind };
    const key = `invalid:${kind}:${message}`;
    if (gesture.lastKey === key) return;
    gesture.lastKey = key;
    this.content.replaceChildren();
    this.announce(message, kind);
  }
  private insertCandidate(gesture: Gesture, event: PointerEvent): Candidate | undefined {
    const entry = gesture.entry!;
    if (entry.kind !== 'note' && entry.kind !== 'rest') return undefined;
    for (const frame of gesture.frames) {
      const point = this.framePoint(frame, event); if (!point) continue;
      const pitchlessLane = entry.kind === 'note' && frame.system.measures.find(lane => gesture.score.staves.some(staff => staff.id === lane.staffId && (staff.notation ?? 'pitched') !== 'pitched')
        && point.x >= lane.noteStartX && point.x <= lane.noteEndX
        && point.y >= lane.topLine - 20 && point.y <= lane.bottomLine + 20);
      if (pitchlessLane) throw new Error(gesture.score.staves.find(staff => staff.id === pitchlessLane.staffId)?.notation === 'three-roads'
        ? 'A 3 roads music staff has no fixed pitch positions. Choose Higher, Same, or Lower and use Insert.'
        : 'A single-line rhythm staff has no pitch positions. Choose Rhythm note and use Insert for its written duration.');
      const options = { system: frame.system, score: gesture.score, x: point.x, y: point.y,
        voiceIndex: gesture.state.voiceIndex, position: gesture.state.position, entryKind: entry.kind, projectedVoiceIds: gesture.projectedVoiceIds };
      const target = insertionTarget(options);
      if (!target) {
        if (gesture.state.position === 'replace' && insertionTarget({ ...options, position: 'after' })?.voice.events.length === 0) {
          throw new Error('Empty voice: choose Before or After to start writing.');
        }
        continue;
      }
      const reference = target.voice.events.find(item => item.id === target.cursor.eventId);
      if (!reference && target.voice.events.length) continue;
      const action = !reference ? 'Start empty voice' : target.starterRest ? 'Replace full-measure rest' : target.position === 'replace' ? `Replace ${describeEvent(reference)}`
        : `Add ${target.position} ${describeEvent(reference)}`;
      const base = { value: entry, notation: target.staff.notation ?? 'pitched', measure: target.measure, lane: target.geometry, frame, x: target.anchorX };
      // Keep the proposed musical value first when compact status text is clipped.
      const suffix = `${entry.dots ? ` · ${entry.dots} dot${entry.dots === 1 ? '' : 's'}` : ''} · ${action} · ${target.staff.label || 'Staff'}, bar ${target.measure.number}, voice ${target.cursor.voiceIndex + 1} · ${formatRational(target.onset)} whole-note onset · ${target.scopeLabel}.`;
      const chipSuffix = `${action} · bar ${target.measure.number}, voice ${target.cursor.voiceIndex + 1}${target.scopeLabel === 'voice' ? '' : ` · ${target.scopeLabel}`}`;
      if (entry.kind === 'rest') return {
        ...base, entryKind: 'rest', y: (target.geometry.topLine + target.geometry.bottomLine) / 2,
        command: { type: 'insert-event', cursor: target.cursor, position: target.position, value: { ...entry } },
        label: `${entry.duration} rest${suffix}`, chip: `${entry.duration} rest · ${chipSuffix}`,
      };
      if ((target.staff.notation ?? 'pitched') !== 'pitched') throw new Error('This staff has no fixed pitch positions. Use its direction or rhythm controls and Insert.');
      const pitch = pitchAtStaffY(point.y, target.measure, target.geometry, parsePitch(entry.pitch, undefined, entry.accidentalDisplay));
      return { ...base, entryKind: 'note', pitch, y: staffPitchY(pitch, target.measure.clef, target.geometry),
        command: { type: 'insert-event', cursor: target.cursor, position: target.position, value: { ...entry, pitch: pitchText(pitch) } },
        label: `${pitchText(pitch)}, ${entry.duration}${suffix}`, chip: `${pitchText(pitch)} · ${chipSuffix}` };
    }
    return undefined;
  }
  private pitchCandidate(gesture: Gesture, event: PointerEvent): Candidate | undefined {
    const origin = gesture.origin!;
    const point = this.framePoint(origin.frame, event); if (!point) return undefined;
    const lane = origin.lane;
    if (point.x < lane.noteStartX || point.x > lane.noteEndX) return undefined;
    const targetY = point.y - origin.offsetY;
    if (origin.frame.system.staves.some(staff => staff.sourceId !== origin.staff.id
      && targetY >= staff.topLine && targetY <= staff.bottomLine)) return undefined;
    // An existing ledger note retains its original staff; the new-note insertion
    // margin must not make a high or low source pitch impossible to grab.
    const pitch = pitchAtStaffY(targetY, origin.measure, lane, origin.event.pitches[0]);
    return {
      command: { type: 'set-note-pitch', eventId: origin.event.id, pitch: pitchText(pitch), ties: 'reject' },
      entryKind: 'note', pitch, value: origin.event, notation: origin.staff.notation ?? 'pitched', measure: origin.measure, lane, frame: origin.frame,
      x: origin.geometry.noteheads![0].centerX, y: staffPitchY(pitch, origin.measure.clef, lane),
      label: `${pitchText(origin.event.pitches[0])} → ${pitchText(pitch)} · ${origin.staff.label || 'Staff'}, bar ${origin.measure.number}, voice ${gesture.state.voiceIndex + 1} · ${formatRational(origin.event.onset)} whole-note onset. Rhythm, alteration, and tuplet scope stay fixed.`,
      chip: `${pitchText(origin.event.pitches[0])} → ${pitchText(pitch)} · rhythm fixed`,
    };
  }

  private draw(candidate: Candidate, labelText: string, frames: readonly Frame[]): void {
    const key = JSON.stringify([candidate.entryKind, candidate.entryKind === 'note' ? candidate.pitch : undefined,
      candidate.value.duration, candidate.value.dots, candidate.value.stem, candidate.measure.clef, candidate.notation]);
    let preview = this.ghostCache.get(key);
    if (!preview) {
      if (candidate.entryKind === 'rest') {
        preview = createRestPreview({ duration: candidate.value.duration, dots: candidate.value.dots, clef: candidate.measure.clef, notation: candidate.notation });
      } else {
        const note = createPitchPreview({ pitch: candidate.pitch, duration: candidate.value.duration, dots: candidate.value.dots, stem: candidate.value.stem, clef: candidate.measure.clef });
        preview = { svg: note.svg, anchorX: note.headX, anchorY: note.headY };
      }
      if (this.ghostCache.size >= 64) this.ghostCache.delete(this.ghostCache.keys().next().value!);
      this.ghostCache.set(key, preview);
    }
    const doc = this.options.host.ownerDocument;
    const ghost = doc.createElement('div'); ghost.className = 'pointer-ghost'; ghost.dataset.valid = String(!candidate.invalid); ghost.dataset.entryKind = candidate.entryKind;
    const coordinate = doc.createElementNS(NS, 'svg'); coordinate.classList.add('pointer-geometry');
    coordinate.setAttribute('width', '100%'); coordinate.setAttribute('height', '100%');
    ghost.append(coordinate);
    const label = doc.createElement('div'); label.className = 'pointer-target-label'; label.dataset.valid = String(!candidate.invalid); label.textContent = labelText;
    this.content.replaceChildren(ghost, label);
    const originalMatrix = candidate.frame.svg.getScreenCTM(); const overlayMatrix = coordinate.getScreenCTM();
    if (!originalMatrix || !overlayMatrix) throw new Error('The engraved preview is not visible. Try the gesture again.');
    // Both coordinate systems include ancestor transforms, CSS scaling, and scroll.
    const matrix = overlayMatrix.inverse().multiply(originalMatrix);
    const group = doc.createElementNS(NS, 'g'); group.setAttribute('transform', `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    const caret = doc.createElementNS(NS, 'line'); caret.classList.add('pointer-target-caret');
    caret.setAttribute('x1', String(candidate.x)); caret.setAttribute('x2', String(candidate.x));
    caret.setAttribute('y1', String(candidate.lane.topLine - 9)); caret.setAttribute('y2', String(candidate.lane.bottomLine + 9));
    const note = preview.svg.cloneNode(true) as SVGSVGElement;
    note.classList.add('pointer-preview-symbol');
    // Recolor only the disposable ghost. Preserve unpainted paths and all
    // engraved geometry; CSS custom properties inherit through the shadow host.
    for (const element of [note, ...note.querySelectorAll<SVGElement>('[fill],[stroke]')]) for (const attribute of ['fill', 'stroke']) {
      const value = element.getAttribute(attribute);
      if (value && value !== 'none' && value !== 'transparent') element.setAttribute(attribute, 'currentColor');
    }
    note.setAttribute('x', String(candidate.x - preview.anchorX)); note.setAttribute('y', String(candidate.y - preview.anchorY));
    note.setAttribute('opacity', '.65');
    group.append(caret, note); coordinate.append(group);
    const view = doc.defaultView!;
    // A nested SVG's native bounds can include unused music-font space. The
    // adapter already cropped this viewBox to actual ink; use that known box.
    const previewBox = preview.svg.viewBox.baseVal;
    const ghostBounds = screenBox({ x: candidate.x - preview.anchorX, y: candidate.y - preview.anchorY,
      width: previewBox.width, height: previewBox.height }, originalMatrix);
    const labelBounds = label.getBoundingClientRect();
    const hostBounds = this.visibleScoreBounds();
    const chrome = this.visibleChromeBounds();
    const minX = Math.max(8, hostBounds.left); const maxX = Math.min(view.innerWidth - 8, hostBounds.right) - labelBounds.width;
    const minY = Math.max(8, hostBounds.top);
    const maxY = Math.min(view.innerHeight - 8, hostBounds.bottom) - labelBounds.height;
    const notation = frames.flatMap(frame => {
      const matrix = frame.svg.getScreenCTM();
      return matrix ? [screenBox(frame.system.ink, matrix)] : [];
    });
    const activeInk = screenBox(candidate.frame.system.ink, originalMatrix);
    const nativeControls = [...this.options.state().surface?.shadowRoot?.querySelectorAll<HTMLElement>('.diagnostics,.transcript') ?? []]
      .filter(element => element.getClientRects().length > 0).map(element => element.getBoundingClientRect());
    const yBeside = Math.max(minY, Math.min(ghostBounds.top, maxY));
    const xAbove = Math.max(minX, Math.min(ghostBounds.left, maxX));
    const positions = [
      { x: ghostBounds.right + 8, y: yBeside },
      { x: ghostBounds.left - labelBounds.width - 8, y: yBeside },
      { x: activeInk.right + 8, y: yBeside },
      { x: activeInk.left - labelBounds.width - 8, y: yBeside },
      { x: xAbove, y: ghostBounds.top - labelBounds.height - 8 },
      { x: xAbove, y: ghostBounds.bottom + 8 },
      { x: xAbove, y: activeInk.top - labelBounds.height - 8 },
      { x: xAbove, y: activeInk.bottom + 8 },
    ];
    const clear = positions.find(position => {
      if (position.x < minX || position.x > maxX || position.y < minY || position.y > maxY) return false;
      const box = { left: position.x, top: position.y, right: position.x + labelBounds.width, bottom: position.y + labelBounds.height };
      return ![ghostBounds, ...notation, ...nativeControls, ...(chrome ? [chrome] : [])].some(obstacle => overlapsBox(box, obstacle));
    });
    // The dock status retains the complete proposal when no nearby space is
    // clear. Never obscure another staff to keep an optional local chip visible.
    if (!clear) { label.remove(); return; }
    const local = new DOMPoint(clear.x, clear.y).matrixTransform(overlayMatrix.inverse());
    label.style.left = `${local.x}px`; label.style.top = `${local.y}px`;
  }

  private commit(gesture: Gesture, event: PointerEvent, dragging: boolean): void {
    if (!this.acceptedContextUnchanged(gesture)) { this.clear(); this.announce('The score changed. Try the gesture again.', 'notice'); return; }
    this.preview(gesture, event, dragging);
    const candidate = gesture.candidate;
    this.clear();
    if (!candidate) {
      if (gesture.feedback) this.announce(gesture.feedback.message, 'notice');
      return;
    }
    if (!this.acceptedContextUnchanged(gesture)) { this.announce('The score changed. Try the gesture again.', 'notice'); return; }
    if (candidate.invalid) {
      if (!this.reportRejected(gesture, candidate, candidate.rejection)) {
        this.announce(gesture.feedback?.message ?? candidate.invalid, 'notice');
      }
      return;
    }
    try {
      const revision = this.options.session.revision;
      this.options.commit(candidate.command);
      this.options.completed(gesture.kind, candidate.entryKind === 'note' ? pitchText(candidate.pitch) : undefined);
      this.announce(this.options.session.revision === revision ? `${candidateName(candidate)} is unchanged. No edit or undo step was added.`
        : `${gesture.kind === 'insert' ? 'Placed' : 'Set pitch to'} ${candidateName(candidate)}. ${gesture.kind === 'pitch' ? 'Rhythm is unchanged. ' : ''}Undo returns to the previous music.`, 'selection');
    } catch (error) {
      const unchanged = this.acceptedContextUnchanged(gesture);
      if (unchanged && this.reportRejected(gesture, candidate, error)) return;
      this.options.error(error);
      this.announce(unchanged ? `No music changed. ${messageOf(error)}` : 'The score or writing context changed. Try the gesture again.', 'notice');
    }
  }

  private reportRejected(gesture: Gesture, candidate: Candidate, error: unknown): boolean {
    if (candidate.command.type !== 'insert-event' || !this.options.rejected || !this.acceptedContextUnchanged(gesture)) return false;
    // Recovery receives the rejected target and captured entry values, never the
    // current palette. It cannot mutate the gesture's command for a later use.
    const command = candidate.command;
    return this.options.rejected({ ...command, cursor: { ...command.cursor }, value: { ...command.value } }, error) === true;
  }
}
