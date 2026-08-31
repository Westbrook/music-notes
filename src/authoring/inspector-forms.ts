import { pitchDescription, pitchText } from '../model/index.js';
import type { Measure, MusicEvent, Score, Staff, Tuplet, Voice } from '../model/types.js';
import { renderNativeCheckboxes } from '../ui/native-checkboxes.js';
import { renderNativeOptions } from '../ui/native-options.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';
import type { EditorSession } from './editor.js';
import { DraftStore } from './form-drafts.js';
import type { DraftFields, DraftResolution, DraftSnapshot, DraftTarget } from './form-drafts.js';
import { defaultLayout } from './project.js';
import { enhanceSelects } from './select.js';
import { focusInTools } from './tool-pane-focus.js';
import type { AuthorProject, Cursor, ViewMode } from './types.js';

export type InspectorFormName = 'selected' | 'measure' | 'staff' | 'part' | 'page' | 'boundary' | 'tuplet';
type Forms = Record<InspectorFormName, DraftFields>;
type Target = DraftTarget<DraftFields>;

export interface InspectionSelectionContext {
  selectionId?: string;
  rangeEventIds?: readonly string[];
  /** Undefined follows ordinary selection; null explicitly has no inspected event. */
  inspectionSelectionId?: string | null;
  /** Reading a held pane does not authorize editing while entering new music. */
  entryMode?: boolean;
}

export interface InspectorContext extends InspectionSelectionContext {
  mode: ViewMode;
  partId: string;
  cursor: Cursor;
}

/** A held inspection is never a substitute for the actual selected membership. */
export function exactSelectedEventId(context: InspectionSelectionContext): string | undefined {
  const ids = context.rangeEventIds ?? (context.selectionId ? [context.selectionId] : []);
  return Array.isArray(ids) && ids.length === 1 && ids[0] === context.selectionId ? ids[0] : undefined;
}

export function inspectedEventId(context: InspectionSelectionContext): string | undefined {
  return context.inspectionSelectionId !== undefined ? context.inspectionSelectionId ?? undefined : exactSelectedEventId(context);
}

/** A named recovery action remains bound to the destination the musician saw. */
export function inspectionDiscardKey(context: InspectionSelectionContext, documentId: string,
  target: { documentId: string | null; targetId: string | null }): string {
  return JSON.stringify([documentId, target.documentId, target.targetId, exactSelectedEventId(context) ?? null, !!context.entryMode]);
}

/** Share a caption only when both independently bound owners and documents agree. */
export function syncInspectionCaptions(root: ControlRoot = document): void {
  const scope = asControlScope(root);
  const properties = scope.getElementById('event-form-context');
  const markings = scope.getElementById('event-markings-target');
  const panel = scope.getElementById('event-markings-editor');
  if (!markings || !panel) return;
  const shared = !!properties && !properties.closest('[hidden], [inert]') && !!properties.dataset.documentId
    && properties.dataset.documentId === markings.dataset.documentId && properties.dataset.targetId === markings.dataset.targetId;
  markings.hidden = shared;
  const captionId = shared ? properties!.id : markings.id;
  markings.dataset.captionId = captionId;
  panel.setAttribute('aria-describedby', captionId);
  for (const control of panel.querySelectorAll<HTMLElement>('input, select, button')) {
    if (control.parentElement?.localName === 'select') continue;
    const references = (control.getAttribute('aria-describedby') ?? '').split(/\s+/)
      .filter(id => id && id !== 'event-form-context' && id !== 'event-markings-target');
    control.setAttribute('aria-describedby', [...new Set([captionId, ...references])].join(' '));
  }
}

export interface InspectorTargetContext {
  partId?: string;
  staffId?: string;
  measureId?: string;
  sourceId?: string;
  voiceId?: string;
  columnId?: string;
  eventIds?: string[];
  creating?: boolean;
}

export interface InspectorFormsOptions {
  session: EditorSession;
  context: () => InspectorContext;
  select: (id: string) => void;
  returnTarget?: (target: { form: InspectorFormName; targetId: string; context: InspectorTargetContext }) => void;
  onDraftChange?: () => void;
  report?: (message: string) => void;
}

export interface InspectorSnapshot extends DraftSnapshot<DraftFields> {
  context: InspectorTargetContext | null;
  blockedReason: string | null;
}

export type InspectorResolution = Extract<DraftResolution<DraftFields>, { ok: true }> & {
  context: InspectorTargetContext;
};

interface Frame { project: AuthorProject; score: Score; context: InspectorContext; revision: number }
interface Location { staff: Staff; measure: Measure; voice: Voice; voiceIndex: number; event?: MusicEvent; tuplet?: Tuplet }
interface Field { key: string; id: string; check?: boolean; checks?: boolean }

const fields: Record<InspectorFormName, readonly Field[]> = {
  selected: [
    { key: 'kind', id: 'selected-kind' }, { key: 'pitch', id: 'selected-pitch' },
    { key: 'pitches', id: 'selected-pitches' }, { key: 'pitchDirection', id: 'selected-direction' },
    { key: 'duration', id: 'selected-duration' },
    { key: 'dots', id: 'selected-dots' }, { key: 'rhythmic', id: 'selected-rhythmic', check: true },
    { key: 'measureRest', id: 'selected-measure-rest', check: true },
    { key: 'accidentalDisplay', id: 'selected-accidental-display' },
    { key: 'stem', id: 'selected-stem' }, { key: 'beam', id: 'selected-beam' },
  ],
  measure: [
    { key: 'meter', id: 'measure-meter' }, { key: 'groups', id: 'measure-groups' },
    { key: 'key', id: 'measure-key' }, { key: 'clef', id: 'measure-clef' },
    { key: 'endBar', id: 'measure-end-bar' }, { key: 'pickup', id: 'measure-pickup', check: true },
    { key: 'incomplete', id: 'measure-incomplete', check: true },
    { key: 'repeatStart', id: 'measure-repeat-start', check: true },
  ],
  staff: [
    { key: 'label', id: 'staff-label' }, { key: 'clef', id: 'staff-clef' },
    { key: 'key', id: 'staff-key' }, { key: 'notation', id: 'staff-notation' },
  ],
  part: [{ key: 'label', id: 'part-label' }, { key: 'staffIds', id: 'part-staves', checks: true }],
  page: [
    { key: 'paper', id: 'page-paper' }, { key: 'orientation', id: 'page-orientation' },
    { key: 'marginMm', id: 'page-margin' }, { key: 'staffScale', id: 'page-scale' },
    { key: 'maxMeasures', id: 'page-max-measures' }, { key: 'measureNumbers', id: 'page-measure-numbers' },
    { key: 'justifyLast', id: 'page-justify-last', check: true },
  ],
  boundary: [{ key: 'breakBefore', id: 'layout-break' }, { key: 'keepWithNext', id: 'layout-keep', check: true }],
  tuplet: [
    { key: 'actual', id: 'tuplet-actual' }, { key: 'normal', id: 'tuplet-normal' },
    { key: 'bracket', id: 'tuplet-bracket' }, { key: 'ratio', id: 'tuplet-ratio', check: true },
  ],
};
const names = Object.keys(fields) as InspectorFormName[];
const applyIds: Record<InspectorFormName, string[]> = {
  selected: ['update-event'], measure: ['apply-measure'], staff: ['apply-staff'], part: ['update-part'],
  page: ['apply-pages'], boundary: ['apply-break'], tuplet: ['update-tuplet'],
};
const regionIds: Record<InspectorFormName, string> = {
  selected: 'selection-inspector', measure: 'measure-inspector', staff: 'staff-inspector',
  part: 'part-inspector', page: 'paper-inspector', boundary: 'break-inspector', tuplet: 'tuplet-inspector',
};
// Whitespace is forbidden in authored IDs, so creation targets cannot collide
// with a real source element or imported part that happens to share a prefix.
const newPartPrefix = 'new part:';
const newTupletPrefix = 'new tuplet:';

function location(score: Score, id: string | undefined): Location | null {
  if (!id) return null;
  for (const staff of score.staves) for (const measure of staff.measures) {
    for (const [voiceIndex, voice] of measure.voices.entries()) {
      const event = voice.events.find(item => item.id === id);
      const tuplet = voice.tuplets.find(item => item.id === id);
      if (event || tuplet || voice.id === id || measure.id === id || staff.id === id) {
        return { staff, measure, voice, voiceIndex, event, tuplet };
      }
    }
  }
  return null;
}

function eventValues(event: MusicEvent): DraftFields {
  return {
    kind: event.kind === 'slash' && event.rhythmic ? 'rhythmic-slash' : event.kind,
    pitch: event.pitches[0] ? pitchText(event.pitches[0]) : 'C4',
    pitches: event.pitches.length ? event.pitches.map(pitchText).join(' ') : 'C4 E4 G4',
    pitchDirection: event.kind === 'road' ? event.pitchDirection ?? '' : '',
    duration: event.duration, dots: String(event.dots), rhythmic: event.rhythmic,
    measureRest: event.measureRest, accidentalDisplay: event.pitches[0]?.display ?? 'auto', stem: event.stem, beam: event.beam,
  };
}

/** Timing dependencies exclude pitch spelling, directions, and unrelated measures. */
function voiceRhythm(voice: Voice): unknown {
  return {
    events: voice.events.map(event => ({
      id: event.id, duration: event.duration, dots: event.dots, time: event.time,
      measureRest: event.measureRest, tupletIds: event.tupletIds, tie: event.tie,
    })),
    tuplets: voice.tuplets.map(tuplet => ({ id: tuplet.id, actual: tuplet.actual, normal: tuplet.normal, eventIds: tuplet.eventIds })),
  };
}

function musicalContext(value: Location): InspectorTargetContext {
  return { sourceId: value.event?.id ?? value.tuplet?.id ?? value.measure.id,
    staffId: value.staff.id, measureId: value.measure.id, voiceId: value.voice.id };
}

function eventName(event: MusicEvent): string {
  return event.kind === 'rest' ? event.measureRest ? 'Full-measure rest' : 'Rest'
    : event.kind === 'slash' ? event.rhythmic ? 'Rhythmic slash' : 'Open slash'
      : event.kind === 'road' ? `3 roads note · ${event.pitchDirection === 'higher' ? 'Higher (top)' : event.pitchDirection === 'same' ? 'Same (middle)' : event.pitchDirection === 'lower' ? 'Lower (bottom)' : 'Direction missing'}`
      : event.kind === 'rhythm' ? 'Rhythm note' : event.pitches.map(pitchDescription).join(' + ');
}

function target(frame: Frame, id: string, label: string, values: DraftFields,
  context: InspectorTargetContext, dependencies: Target['dependencies'] = {}): Target {
  return { documentId: frame.project.id, id, label, values, context, dependencies };
}

function readTarget(form: InspectorFormName, id: string, frame: Frame): Target | null {
  const { score, project } = frame;
  const place = location(score, id);
  if (form === 'selected') {
    if (!place?.event) return null;
    const { event, staff, measure, voice, voiceIndex } = place;
    const context = musicalContext(place);
    const timing = { meter: measure.meter, voice: voiceRhythm(voice), kind: event.kind, rhythmic: event.rhythmic };
    const pitch = { kind: event.kind, tie: event.tie, notation: staff.notation ?? 'pitched' };
    return target(frame, id, `${eventName(event)} · ${staff.label || 'Staff'}, bar ${measure.number}, voice ${voiceIndex + 1}`,
      eventValues(event), context, {
        kind: { timing, notation: staff.notation ?? 'pitched' }, pitch, pitches: pitch, pitchDirection: pitch,
        duration: timing, dots: timing, rhythmic: timing, measureRest: timing,
        accidentalDisplay: { kind: event.kind, pitches: event.pitches.length },
        stem: { kind: event.kind, rhythmic: event.rhythmic },
        beam: { kind: event.kind, rhythmic: event.rhythmic, timing, groups: measure.meter.groups },
      });
  }
  if (form === 'measure') {
    if (!place || place.measure.id !== id) return null;
    const { staff, measure } = place;
    const column = project.columns.find(item => item.measureIds.includes(id));
    const columnMusic = column?.measureIds.map(member => {
      const next = location(score, member);
      return next ? { id: member, meter: next.measure.meter, pickup: next.measure.pickup, voices: next.measure.voices.map(voiceRhythm) } : null;
    });
    const notation = staff.notation ?? 'pitched';
    return target(frame, id, `${staff.label || 'Staff'} · bar ${measure.number}`, {
      meter: measure.meter.display, groups: measure.meter.explicitGroups ? measure.meter.groups.join('+') : '',
      key: measure.key, clef: measure.clef, endBar: measure.endBar, pickup: measure.pickup,
      incomplete: measure.incomplete, repeatStart: measure.repeatStart,
    }, { sourceId: id, staffId: staff.id, measureId: id, columnId: column?.id }, {
      meter: columnMusic, groups: columnMusic, pickup: columnMusic,
      incomplete: { meter: measure.meter, voices: measure.voices.map(voiceRhythm) },
      key: notation, clef: notation,
    });
  }
  if (form === 'staff') {
    const staff = score.staves.find(item => item.id === id);
    if (!staff) return null;
    const notation = staff.notation ?? 'pitched';
    return target(frame, id, staff.label || 'Staff', { label: staff.label, clef: staff.clef, key: staff.key, notation },
      { staffId: id, sourceId: id }, {
        clef: notation, key: notation,
        notation: staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events.map(event => ({ id: event.id, kind: event.kind })))),
      });
  }
  if (form === 'part') {
    if (id.startsWith(newPartPrefix)) {
      const staffId = id.slice(newPartPrefix.length);
      if (!score.staves.some(staff => staff.id === staffId)) return null;
      return target(frame, id, 'New part', { label: '', staffIds: [staffId] }, { partId: 'score', staffId, sourceId: staffId, creating: true });
    }
    const part = project.parts.find(item => item.id === id);
    return part ? target(frame, id, part.label || 'Part', { label: part.label, staffIds: [...part.staffIds] }, { partId: id }) : null;
  }
  if (form === 'page') {
    const part = project.parts.find(item => item.id === id);
    if (id !== 'score' && !part) return null;
    const profile = project.layouts[id] ?? defaultLayout();
    return target(frame, id, `${part?.label ?? 'Full score'} page settings`, {
      paper: profile.paper, orientation: profile.orientation, marginMm: String(profile.marginMm),
      staffScale: String(profile.staffScale), maxMeasures: profile.maxMeasures === null ? '' : String(profile.maxMeasures),
      measureNumbers: profile.measureNumbers, justifyLast: profile.justifyLast,
    }, { partId: id });
  }
  if (form === 'boundary') {
    let ids: unknown;
    try { ids = JSON.parse(id); } catch { return null; }
    if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(item => typeof item === 'string')) return null;
    const [partId, columnId] = ids as [string, string];
    const part = project.parts.find(item => item.id === partId);
    const column = project.columns.find(item => item.id === columnId);
    if (!column || (partId !== 'score' && !part)) return null;
    const members = column.measureIds.flatMap(member => { const item = location(score, member); return item ? [item] : []; });
    const first = members.find(item => !part || part.staffIds.includes(item.staff.id));
    if (!first) return null;
    const profile = project.layouts[partId] ?? defaultLayout();
    const defaultBreak = members.some(item => item.measure.breakBefore === 'page') ? 'page'
      : members.some(item => item.measure.breakBefore === 'line') ? 'line' : 'auto';
    return target(frame, id, `${part?.label ?? 'Full score'} · before bar ${first.measure.number}`, {
      breakBefore: profile.breaks[columnId] ?? defaultBreak,
      keepWithNext: profile.keeps[columnId] ?? members.some(item => item.measure.keepWithNext),
    }, { partId, columnId, staffId: first.staff.id, measureId: first.measure.id, sourceId: first.measure.id }, {
      // A keep preference names this adjacency. Moving/deleting its neighbor
      // must not silently redirect a pending preference to another column.
      keepWithNext: project.columns[project.columns.indexOf(column) + 1]?.id ?? null,
    });
  }
  if (form === 'tuplet') {
    if (place?.tuplet) {
      const { tuplet, measure, staff, voiceIndex, voice } = place;
      const timing = { meter: measure.meter, voice: voiceRhythm(voice) };
      return target(frame, id, `${tuplet.actual}:${tuplet.normal} group · ${staff.label || 'Staff'}, bar ${measure.number}, voice ${voiceIndex + 1}`, {
        actual: String(tuplet.actual), normal: String(tuplet.normal), bracket: tuplet.bracket, ratio: tuplet.showRatio,
      }, { ...musicalContext(place), eventIds: [...tuplet.eventIds] }, { actual: timing, normal: timing });
    }
    if (!id.startsWith(newTupletPrefix)) return null;
    let eventIds: unknown;
    try { eventIds = JSON.parse(id.slice(newTupletPrefix.length)); } catch { return null; }
    if (!Array.isArray(eventIds) || !eventIds.length || !eventIds.every(item => typeof item === 'string')) return null;
    const members = eventIds.map(eventId => location(score, eventId));
    const first = members[0];
    if (!first?.event || members.some(item => !item?.event)) return null;
    const timing = members.map(item => ({ context: musicalContext(item!), meter: item!.measure.meter, voice: voiceRhythm(item!.voice) }));
    return target(frame, id, `${eventIds.length} selected event(s) · ${first.staff.label || 'Staff'}, bar ${first.measure.number}, voice ${first.voiceIndex + 1}`, {
      actual: '3', normal: '2', bracket: 'auto', ratio: false,
    }, { ...musicalContext(first), eventIds: [...eventIds] as string[], creating: true },
    { actual: timing, normal: timing, bracket: timing, ratio: timing });
  }
  return null;
}

function selectedTarget(form: InspectorFormName, frame: Frame): Target | null {
  const { context, project } = frame;
  let id: string | undefined;
  switch (form) {
    case 'selected': {
      id = inspectedEventId(context); break;
    }
    case 'measure': id = context.cursor.measureId; break;
    case 'staff': id = context.cursor.staffId; break;
    case 'part': id = context.partId === 'score' ? `${newPartPrefix}${context.cursor.staffId}` : context.partId; break;
    case 'page': id = context.partId; break;
    case 'boundary': {
      const column = project.columns.find(item => item.measureIds.includes(context.cursor.measureId));
      if (column) id = JSON.stringify([context.partId, column.id]);
      break;
    }
    case 'tuplet': {
      const selected = location(frame.score, context.selectionId);
      const ids = context.rangeEventIds ?? (selected?.event ? [selected.event.id] : []);
      id = selected?.tuplet ? selected.tuplet.id : ids.length ? `${newTupletPrefix}${JSON.stringify(ids)}` : undefined;
      break;
    }
  }
  return id ? readTarget(form, id, frame) : null;
}

function contextOf(target: Target): InspectorTargetContext { return target.context as InspectorTargetContext; }
function displayValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'yes' : 'no' : String(value ?? 'none');
}

/** Long-lived inspector drafts are separate from entry settings and accepted musical history. */
export class InspectorForms {
  private readonly options: InspectorFormsOptions;
  private readonly scope: ControlScope;
  private readonly doc: Document;
  private readonly abort = new AbortController();
  private readonly store = new DraftStore<Forms>();
  private readonly contexts = new Map<InspectorFormName, { documentId: string; targetId: string; value: InspectorTargetContext }>();
  private lastSignature = '';
  private projectCache: { revision: number; project: AuthorProject } | undefined;
  private selectedDiscardKey = '';
  private readonly commitFocus = new Map<InspectorFormName, HTMLElement>();
  private initialized = false;
  private disposed = false;

  constructor(options: InspectorFormsOptions, root: ControlRoot = document) {
    this.options = options;
    this.scope = asControlScope(root);
    this.doc = this.scope.document;
    for (const form of names) {
      this.ensureDraftControls(form);
      for (const field of fields[form]) {
        const element = this.el(field.id);
        if (!element) continue;
        const change = () => {
          if (this.disposed) return;
          try {
            if (form === 'selected' && this.options.context().entryMode) {
              throw new Error('Return to this event before editing its properties.');
            }
            const value = field.checks ? [...element.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value)
              : field.check ? (element as HTMLInputElement).checked : (element as HTMLInputElement).value;
            const patch: DraftFields = { [field.key]: value };
            if (form === 'selected' && field.key === 'kind' && (value === 'slash' || value === 'rhythmic-slash')) {
              patch.rhythmic = value === 'rhythmic-slash';
            }
            if (form === 'selected' && field.key === 'kind') {
              const snapshot = this.store.snapshot(form);
              if (value === 'road') {
                const direction = snapshot.values?.pitchDirection;
                // Only an explicit kind change supplies the new event's direction.
                if (!['higher', 'same', 'lower'].includes(String(direction))) patch.pitchDirection = 'same';
              } else if (snapshot.dirtyFields.includes('pitchDirection')) {
                // A kind without direction must not retain an invisible direction patch.
                patch.pitchDirection = snapshot.current?.pitchDirection ?? '';
              }
            }
            if (form === 'selected' && field.key === 'rhythmic') {
              const kind = this.store.snapshot(form).values?.kind;
              if (kind === 'slash' || kind === 'rhythmic-slash') patch.kind = value ? 'rhythmic-slash' : 'slash';
            }
            this.store.patch(form, patch);
            this.refresh();
          } catch (error) { this.markFailure(form, error); }
        };
        element.addEventListener('input', change, { signal: this.abort.signal });
        element.addEventListener('change', change, { signal: this.abort.signal });
        this.describe(element, `${form}-draft-status`);
        this.describe(element, field.id === 'selected-beam' && this.el('beam-target-context') ? 'beam-target-context' : this.captionId(form));
      }
      for (const id of applyIds[form]) { const button = this.el(id); if (button) { this.describe(button, `${form}-draft-status`); this.describe(button, this.captionId(form)); } }
      this.listen(form === 'selected' && this.el('load-event-values') ? 'load-event-values' : `discard-${form}-draft`, () => this.discard(form));
      this.listen(`review-${form}-draft`, () => this.review(form));
      this.listen(`return-${form}-draft`, () => this.returnTo(form));
    }
    this.refresh();
    this.initialized = true;
  }

  get dirtyCount(): number { return this.store.dirtyCount; }

  snapshot(form: InspectorFormName): InspectorSnapshot {
    const stored = this.store.snapshot(form);
    const snapshot = form === 'selected' ? { ...stored,
      matchesSelection: !!stored.targetId && stored.documentId === this.project().id
        && exactSelectedEventId(this.options.context()) === stored.targetId,
    } : stored;
    const bound = this.contexts.get(form);
    const context = bound?.targetId === snapshot.targetId && bound.documentId === snapshot.documentId ? structuredClone(bound.value) : null;
    const blockedReason = this.blockedReason(form, snapshot);
    return { ...snapshot, context, blockedReason, canApply: snapshot.canApply && !blockedReason };
  }

  refresh(): void {
    if (this.disposed) return;
    const frame = this.frame();
    for (const form of names) {
      const snapshot = this.store.sync(form, { ...this.storeContext(form, frame), selected: selectedTarget(form, frame) });
      const current = snapshot.targetId && snapshot.documentId === frame.project.id ? readTarget(form, snapshot.targetId, frame) : null;
      if (current) this.contexts.set(form, { documentId: current.documentId, targetId: current.id, value: contextOf(current) });
      if (!snapshot.targetId) this.contexts.delete(form);
      this.render(form, frame);
    }
    this.notify();
  }

  /** Re-read the exact named target, merge only dirty fields, and update the command's DOM inputs. */
  resolve(form: InspectorFormName): InspectorResolution {
    this.commitFocus.delete(form);
    const focused = this.scope.activeElement as HTMLElement | null;
    const trigger = focused && applyIds[form].includes(focused.id) ? focused : null;
    this.refresh();
    const view = this.snapshot(form);
    // Availability is already explained by the live status; do not retain it as
    // a stale transaction error after the musician returns to the right mode.
    if (view.blockedReason) throw new Error(view.blockedReason);
    const frame = this.frame();
    const resolved = this.store.resolve(form, this.storeContext(form, frame));
    if (!resolved.ok) return this.reject(form, resolved.message);
    if (form === 'part') {
      const staffIds = resolved.values.staffIds;
      if (!Array.isArray(staffIds) || staffIds.some(id => !frame.score.staves.some(staff => staff.id === id))) {
        return this.reject(form, 'A staff in this draft no longer exists. Choose the intended staves before applying.');
      }
    }
    const current = readTarget(form, resolved.targetId, frame);
    if (!current) return this.reject(form, 'The named target no longer exists. Your draft has not been applied.');
    this.render(form, frame);
    if (trigger) this.commitFocus.set(form, trigger);
    return { ...resolved, context: structuredClone(contextOf(current)) };
  }

  /** Clear only this draft after its corresponding command has succeeded. */
  commit(form: InspectorFormName): void {
    const focused = this.scope.activeElement as HTMLElement | null;
    const trigger = focused && applyIds[form].includes(focused.id) ? focused : this.commitFocus.get(form);
    this.commitFocus.delete(form);
    const snapshot = this.store.snapshot(form);
    const frame = this.frame();
    const accepted = snapshot.targetId && snapshot.documentId === frame.project.id ? readTarget(form, snapshot.targetId, frame) : null;
    if (accepted) this.store.commit(form, accepted);
    else this.store.discard(form, selectedTarget(form, frame));
    this.refresh();
    if (trigger && (!focused || focused === this.doc.body || focused === trigger)
      && ((trigger as HTMLButtonElement).disabled || !trigger.isConnected || trigger.closest('[hidden], [inert]'))) this.focusForm(form);
  }

  /** Creation deliberately consumes the draft and follows the newly selected target. */
  consume(form: InspectorFormName): void { this.commitFocus.delete(form); this.store.discard(form, selectedTarget(form, this.frame())); this.refresh(); }

  /** Caller confirms loss before replacing the project or resetting the session. */
  reset(): void { this.store.discardAll(); this.contexts.clear(); this.commitFocus.clear(); this.refresh(); }

  markFailure(form: InspectorFormName, error: unknown): void {
    this.commitFocus.delete(form);
    const message = error instanceof Error ? error.message : String(error);
    this.store.fail(form, message);
    this.render(form, this.frame());
    this.notify();
  }

  dispose(): void { this.disposed = true; this.abort.abort(); }

  private frame(): Frame {
    return { project: this.project(), score: this.options.session.score, context: this.options.context(), revision: this.options.session.revision };
  }

  /** A snapshot already belongs to this revision; form status need not clone an entire long score repeatedly. */
  private project(): AuthorProject {
    const revision = this.options.session.revision;
    if (!this.projectCache || this.projectCache.revision !== revision) {
      this.projectCache = { revision, project: this.options.session.project };
    }
    return this.projectCache.project;
  }

  private storeContext(form: InspectorFormName, frame: Frame) {
    return { documentId: frame.project.id, revision: frame.revision, read: (id: string) => readTarget(form, id, frame) };
  }

  private blockedReason(form: InspectorFormName, snapshot: DraftSnapshot<DraftFields>): string | null {
    if (this.project().pendingSource !== null) return 'Apply or Revert the Source draft before applying inspector changes. Your fields are kept.';
    const context = this.options.context(), mode = context.mode;
    if ((form === 'page' || form === 'boundary') ? mode !== 'pages' : mode !== 'write') {
      return `Return to ${form === 'page' || form === 'boundary' ? 'Pages' : 'Write'} to apply these changes. Your fields are kept.`;
    }
    if (form === 'selected' && context.entryMode && snapshot.targetId) return 'Return to this event before editing its properties.';
    if (form === 'selected' && snapshot.targetId && !snapshot.matchesSelection
      && snapshot.status !== 'missing' && snapshot.status !== 'document-changed') {
      return 'Return to this draft’s event to apply it. The current selection has not replaced your draft.';
    }
    return null;
  }

  private reject(form: InspectorFormName, message: string): never {
    this.markFailure(form, message);
    throw new Error(message);
  }

  private discard(form: InspectorFormName): void {
    const frame = this.frame();
    const before = this.snapshot(form);
    if (form === 'selected' && this.selectedDiscardKey !== inspectionDiscardKey(frame.context, frame.project.id, before)) {
      this.refresh();
      this.markFailure(form, 'The selection or document changed. Review the updated destination before discarding.');
      return;
    }
    const id = form === 'selected' ? exactSelectedEventId(frame.context) : undefined;
    const next = form === 'selected' ? id ? readTarget(form, id, frame) : null : selectedTarget(form, frame);
    if (form === 'selected' && id && !next) {
      this.refresh();
      this.markFailure(form, 'The selected event is no longer available. Your draft is kept.');
      return;
    }
    this.store.discard(form, next);
    if (form === 'selected' && id && (!before.matchesSelection || frame.context.entryMode)) this.options.select(id);
    this.refresh();
    this.focusForm(form);
    this.options.report?.('Discarded the unapplied fields. Accepted music is unchanged.');
  }

  private review(form: InspectorFormName): void {
    this.store.review(form, this.storeContext(form, this.frame()));
    this.refresh();
    this.focusForm(form, true);
    this.options.report?.('Kept your fields against the current musical context. Apply still validates the whole score.');
  }

  private returnTo(form: InspectorFormName): void {
    const snapshot = this.snapshot(form);
    if (!snapshot.targetId || !snapshot.context || snapshot.status === 'missing' || snapshot.status === 'document-changed') return;
    const frame = this.frame();
    const current = snapshot.documentId === frame.project.id ? readTarget(form, snapshot.targetId, frame) : null;
    if (!current) { this.refresh(); return; }
    const context = contextOf(current);
    if (this.options.returnTarget) this.options.returnTarget({ form, targetId: snapshot.targetId, context });
    else if (context.sourceId) this.options.select(context.sourceId);
    this.refresh();
  }

  private render(form: InspectorFormName, frame: Frame): void {
    const snapshot = this.snapshot(form);
    const values = snapshot.values;
    if (form === 'part') this.renderStaffChecks(frame, Array.isArray(values?.staffIds) ? values.staffIds : []);
    if (form === 'tuplet') this.renderTupletChoices(frame, snapshot);
    for (const field of fields[form]) {
      const element = this.el(field.id) as HTMLInputElement | HTMLSelectElement | null;
      if (!element) continue;
      if (field.checks) {
        const checked = Array.isArray(values?.[field.key]) ? values[field.key] as string[] : [];
        for (const input of element.querySelectorAll<HTMLInputElement>('input')) {
          input.checked = checked.includes(input.value);
          input.disabled = !values || !!snapshot.blockedReason || !frame.score.staves.some(staff => staff.id === input.value);
        }
      } else {
        if (values && Object.hasOwn(values, field.key)) {
          if (field.check) (element as HTMLInputElement).checked = Boolean(values[field.key]);
          else if (element.value !== String(values[field.key])) element.value = String(values[field.key]);
        }
        element.disabled = !values || !!snapshot.blockedReason;
      }
      element.dataset.draftField = snapshot.dirtyFields.includes(field.key) ? 'dirty' : 'clean';
      element.setAttribute('aria-invalid', String(snapshot.conflicts.some(conflict => conflict.field === field.key)));
    }
    const status = this.el(`${form}-draft-status`);
    const unavailableInspection = form === 'selected' && typeof frame.context.inspectionSelectionId === 'string' && !values;
    const label = snapshot.label ?? (unavailableInspection ? 'The inspected event is no longer available.'
      : form === 'selected' ? 'Select one event to edit its written values.' : 'Select a musical target.');
    const currentId = form === 'selected' ? exactSelectedEventId(frame.context) : undefined;
    const currentEvent = currentId ? location(frame.score, currentId)?.event : undefined;
    const needsReturn = !!snapshot.targetId && (form === 'selected'
      ? !snapshot.matchesSelection || !!frame.context.entryMode : snapshot.dirty && !snapshot.matchesSelection);
    const changedContext = snapshot.status === 'missing' ? 'The original target was removed. Discard these changes to start elsewhere.'
      : snapshot.status === 'document-changed' ? 'These changes belong to another document. Discard them to start here.'
        : snapshot.status === 'conflict' ? 'Accepted music changed. Review the differences before applying.' : '';
    const selectionMessage = needsReturn && form === 'selected' && !frame.context.entryMode
      ? currentEvent ? `${eventName(currentEvent)} selected.`
        : (frame.context.rangeEventIds?.length ?? 0) > 1 ? `${frame.context.rangeEventIds!.length} events selected.` : 'No single event selected.' : '';
    // A reviewed kind change must not turn a pending nominal span into an
    // undisclosed written-value edit after its dedicated fields are hidden.
    const pendingSpan = form === 'selected' && this.el('selected-nominal-span') && values && values.kind !== 'slash'
      && snapshot.dirtyFields.some(field => field === 'duration' || field === 'dots')
      ? `Pending value: ${displayValue(values.duration)}, ${displayValue(values.dots)} ${String(values.dots) === '1' ? 'dot' : 'dots'}.`
        + (values.kind === 'rhythmic-slash' ? ' This slash writes rhythm; Apply changes its written value.' : '') : '';
    const showNotice = snapshot.dirty || !!snapshot.error || !!changedContext || needsReturn;
    const details = snapshot.conflicts.map(conflict => {
      const field = fields[form].find(item => item.key === conflict.field);
      const name = field ? this.scope.querySelector(`label[for="${field.id}"]`)?.firstChild?.textContent?.trim() || conflict.field : conflict.field;
      return conflict.reason === 'value' ? `${name}: accepted ${displayValue(conflict.current)}; draft ${displayValue(conflict.draft)}.`
        : `${name} uses musical context that changed.`;
    });
    if (status) {
      status.dataset.draftState = snapshot.status;
      status.dataset.targetId = snapshot.targetId ?? '';
      status.textContent = showNotice ? [snapshot.dirty ? 'Unapplied changes.' : '', selectionMessage, changedContext, pendingSpan,
        ...new Set(details), snapshot.blockedReason].filter(Boolean).join(' ') : '';
      if (snapshot.error && !status.textContent.includes(snapshot.error)) status.textContent += ` ${snapshot.error}`;
      const notice = status.closest<HTMLElement>('.draft-notice');
      if (notice) notice.hidden = !showNotice;
    }
    const caption = this.el(this.captionId(form));
    if (caption) {
      caption.textContent = label;
      caption.dataset.documentId = snapshot.documentId ?? frame.project.id;
      caption.dataset.targetId = snapshot.targetId ?? '';
    }
    if (form === 'selected') {
      const beamCaption = this.el('beam-target-context');
      if (beamCaption) {
        beamCaption.textContent = label;
        beamCaption.dataset.documentId = snapshot.documentId ?? frame.project.id;
        beamCaption.dataset.targetId = snapshot.targetId ?? '';
      }
      this.selectedDiscardKey = inspectionDiscardKey(frame.context, frame.project.id, snapshot);
      syncInspectionCaptions(this.scope);
    }
    const region = this.el(regionIds[form]);
    if (region) {
      region.dataset.draftState = snapshot.status; region.dataset.draftTarget = snapshot.targetId ?? '';
    }
    const discard = this.el<HTMLButtonElement>(form === 'selected' && this.el('load-event-values') ? 'load-event-values' : `discard-${form}-draft`);
    if (discard) {
      discard.hidden = !snapshot.dirty && !snapshot.error; discard.disabled = !snapshot.dirty && !snapshot.error;
      discard.textContent = form === 'selected' && (!snapshot.matchesSelection || frame.context.entryMode) && currentEvent
        ? `Discard and edit ${eventName(currentEvent)}` : form === 'selected' || snapshot.matchesSelection ? 'Discard changes' : 'Discard and start here';
    }
    const review = this.el<HTMLButtonElement>(`review-${form}-draft`);
    if (review) { review.hidden = snapshot.status !== 'conflict'; review.disabled = snapshot.status !== 'conflict'; }
    const returnButton = this.el<HTMLButtonElement>(`return-${form}-draft`);
    if (returnButton) {
      returnButton.hidden = !needsReturn;
      returnButton.disabled = !snapshot.targetId || snapshot.status === 'missing' || snapshot.status === 'document-changed';
      const event = form === 'selected' ? location(frame.score, snapshot.targetId ?? undefined)?.event : undefined;
      returnButton.textContent = event ? `Return to ${eventName(event)}` : 'Return to draft target';
    }
    for (const id of applyIds[form]) {
      const button = this.el<HTMLButtonElement>(id);
      if (button) button.disabled = !snapshot.canApply || (form === 'part' || form === 'tuplet') && !!snapshot.context?.creating;
    }
    if (form === 'tuplet') {
      const make = this.el<HTMLButtonElement>('wrap-tuplet');
      if (make) make.disabled = !values || !!snapshot.blockedReason || !snapshot.context?.creating
        || snapshot.status === 'conflict' || snapshot.status === 'missing' || snapshot.status === 'document-changed';
      const unwrap = this.el<HTMLButtonElement>('unwrap-tuplet');
      if (unwrap) unwrap.disabled = !values || !!snapshot.blockedReason || !!snapshot.context?.creating || !snapshot.matchesSelection;
    }
    if (form === 'selected') this.selectedVisibility(values, frame.score.staves.find(staff => staff.id === snapshot.context?.staffId)?.notation);
    if (form === 'staff') {
      const pitchless = values?.notation === 'rhythm' || values?.notation === 'three-roads';
      for (const id of ['staff-clef', 'staff-key']) {
        const input = this.el<HTMLInputElement>(id);
        if (input) { input.disabled ||= pitchless; const label = input.closest('label'); if (label) label.hidden = pitchless; }
      }
    }
    if (form === 'measure') {
      const notation = frame.score.staves.find(staff => staff.id === snapshot.context?.staffId)?.notation;
      const pitchless = notation === 'rhythm' || notation === 'three-roads';
      for (const id of ['measure-clef', 'measure-key']) {
        const input = this.el<HTMLInputElement>(id);
        if (input) { input.disabled ||= pitchless; const label = input.closest('label'); if (label) label.hidden = pitchless; }
      }
    }
  }

  private selectedVisibility(values: DraftFields | null, notation: Staff['notation']): void {
    const kind = values?.kind;
    const kinds = notation === 'three-roads' ? ['road', 'rest'] : notation === 'rhythm'
      ? ['rhythm', 'rest', 'slash', 'rhythmic-slash'] : ['note', 'chord', 'rest', 'slash', 'rhythmic-slash'];
    for (const option of this.el<HTMLSelectElement>('selected-kind')?.options ?? []) option.disabled = !kinds.includes(option.value);
    for (const [id, visible] of [
      ['selected-pitch-field', kind === 'note'], ['selected-pitches-field', kind === 'chord'],
      ['selected-pitch-help', kind === 'note' || kind === 'chord'],
      ['selected-accidental-help', kind === 'note' || kind === 'chord'],
      ['selected-direction-field', kind === 'road'], ['selected-direction-help', kind === 'road'],
      ['selected-nominal-span', kind === 'slash'],
      ['selected-slash-field', kind === 'slash' || kind === 'rhythmic-slash'],
      ['selected-measure-rest-field', kind === 'rest'],
    ] as const) { const element = this.el(id); if (element) element.hidden = !visible; }
    const direction = this.el<HTMLSelectElement>('selected-direction');
    if (direction) direction.disabled ||= kind !== 'road';
    const pitched = kind === 'note' || kind === 'chord';
    const accidentalDisplay = this.el<HTMLSelectElement>('selected-accidental-display');
    if (accidentalDisplay) accidentalDisplay.disabled ||= !pitched;
    const accidentalLabel = this.scope.querySelector<HTMLLabelElement>('label[for="selected-accidental-display"]');
    if (accidentalLabel) accidentalLabel.hidden = !pitched;
  }

  private renderStaffChecks(frame: Frame, selected: readonly string[]): void {
    const host = this.el('part-staves');
    if (!host) return;
    const available = frame.score.staves.map((staff, index) => ({ value: staff.id, label: staff.label || `Staff ${index + 1}` }));
    const options = [...available, ...selected.filter(id => !available.some(option => option.value === id))
      .map(id => ({ value: id, label: `${id} (removed staff)` }))];
    // The form render below remains the owner of checked and disabled state.
    renderNativeCheckboxes(host, options);
  }

  private renderTupletChoices(frame: Frame, snapshot: InspectorSnapshot): void {
    const select = this.el<HTMLSelectElement>('tuplet-select');
    if (!select) return;
    const current = location(frame.score, frame.context.selectionId) ?? location(frame.score, frame.context.cursor.measureId);
    const options = [{ value: '', label: 'New tuplet around selection' }, ...(current?.voice.tuplets ?? []).map(tuplet => ({ value: tuplet.id, label: `${tuplet.actual}:${tuplet.normal} · ${tuplet.eventIds.length} events` }))];
    const chosen = snapshot.context?.creating ? '' : snapshot.targetId ?? '';
    if (chosen && !options.some(option => option.value === chosen)) options.push({ value: chosen, label: snapshot.label ?? 'Original tuplet draft' });
    renderNativeOptions(select, options, chosen);
    enhanceSelects(select);
  }

  private ensureDraftControls(form: InspectorFormName): void {
    if (!fields[form].some(field => this.el(field.id))) return;
    const first = fields[form].map(field => this.el(field.id)).find(Boolean)!;
    const host = this.el(regionIds[form])?.querySelector('.inspector-content')
      ?? this.el(regionIds[form]) ?? first.closest('.subsection') ?? first.parentElement?.parentElement;
    if (!host) return;
    if (!this.el(`${form}-draft-status`)) {
      const status = this.doc.createElement('p'); status.id = `${form}-draft-status`; status.className = 'field-help'; status.setAttribute('role', 'status');
      host.append(status);
    }
    const status = this.el(`${form}-draft-status`)!;
    let notice = status.closest<HTMLElement>('.draft-notice');
    if (!notice) {
      notice = this.doc.createElement('div'); notice.className = 'draft-notice';
      status.before(notice); notice.append(status);
    }
    if (!this.el(this.captionId(form))) {
      const caption = this.doc.createElement('p'); caption.id = this.captionId(form); caption.className = 'target-context';
      notice.before(caption);
    }
    const actions = this.doc.createElement('div'); actions.className = 'button-row draft-actions';
    for (const [prefix, text] of [['discard', 'Discard changes'], ['return', 'Return to draft target'], ['review', 'Review current music']]) {
      if (prefix === 'discard' && form === 'selected' && this.el('load-event-values')) continue;
      if (this.el(`${prefix}-${form}-draft`)) continue;
      const button = this.doc.createElement('button'); button.type = 'button'; button.id = `${prefix}-${form}-draft`; button.textContent = text; button.hidden = true;
      this.describe(button, `${form}-draft-status`);
      actions.append(button);
    }
    if (actions.childElementCount) notice.append(actions);
  }

  private describe(element: Element, id: string): void {
    element.setAttribute('aria-describedby', [...new Set([...(element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean), id])].join(' '));
  }

  private focusForm(form: InspectorFormName, preferApply = false): void {
    const candidates = [
      ...(preferApply ? applyIds[form] : []), ...fields[form].map(field => field.id),
    ].map(id => this.el<HTMLInputElement>(id));
    const next = candidates.find(element => element && !element.disabled && !element.closest('[hidden], [inert], details:not([open])'));
    if (next) focusInTools(next);
    else {
      const status = this.el(this.captionId(form));
      if (status && !status.closest('[hidden], [inert], details:not([open])')) { status.tabIndex = -1; focusInTools(status); }
    }
  }

  private captionId(form: InspectorFormName): string { return form === 'selected' ? 'event-form-context' : `${form}-target-context`; }

  private notify(): void {
    const signature = JSON.stringify(names.map(form => this.snapshot(form)));
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (this.initialized) this.options.onDraftChange?.();
  }

  private listen(id: string, action: () => void): void { this.el(id)?.addEventListener('click', action, { signal: this.abort.signal }); }
  private el<T extends HTMLElement = HTMLElement>(id: string): T | null { return this.scope.getElementById(id) as T | null; }
}
