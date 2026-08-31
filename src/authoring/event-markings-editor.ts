import { phArrowDown, phArrowUp, phTrash } from '../ui/icons/phosphor.js';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, harmonyIntervalText, pitchDescription } from '../model/index.js';
import { html, render } from 'lit';
import { buttonContent } from '../ui/button-content.js';
import { setControlLabel } from '../ui/control-content.js';
import { renderNativeOptions } from '../ui/native-options.js';
import type { NativeOption } from '../ui/native-options.js';
import { articulationIcon, ornamentIcon } from '../ui/notation-icons.js';
import type { ArticulationType, EventMarking, MusicEvent, OrnamentType, Score, Staff } from '../model/types.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';
import type { EditorSession } from './editor.js';
import { inspectRoadTieChain } from './event-markings-commands.js';
import type { RoadTieChainInspection } from './event-markings-commands.js';
import { DraftStore } from './form-drafts.js';
import type { DraftSnapshot, DraftTarget } from './form-drafts.js';
import { exactSelectedEventId, inspectedEventId, inspectionDiscardKey, syncInspectionCaptions } from './inspector-forms.js';
import type { InspectionSelectionContext } from './inspector-forms.js';
import { focusInTools } from './tool-pane-focus.js';
import { enhanceSelects } from './select.js';
import type { EventMarkingEdit, EventMarkingField, EventMarkingInput, ViewMode } from './types.js';

export interface EventMarkingsContext extends InspectionSelectionContext {
  mode: ViewMode;
}

export interface EventMarkingsEditorOptions {
  session: EditorSession;
  context: () => EventMarkingsContext;
  select: (eventId: string) => void;
  openTools?: () => void;
  onDraftChange?: () => void;
  report?: (message: string) => void;
}

export interface EventMarkingRow {
  key: string;
  markingId?: string;
  kind: EventMarking['kind'];
  type: string;
  /** Raw text stays editable until Apply, including unfinished interval figures. */
  value: string;
  /** Form defaults for automatic marks; only interval direction is editable. */
  placement: 'auto' | 'above' | 'below';
}
export interface EventMarkingsDraft { rows: EventMarkingRow[] }
export interface EventMarkingsSnapshot extends DraftSnapshot<EventMarkingsDraft> { blockedReason: string | null }

interface Location { staff: Staff; measureId: string; measureNumber: string; voiceId: string; voiceIndex: number; event: MusicEvent }
interface RowView { element: HTMLFieldSetElement; controls: Map<EventMarkingField, HTMLInputElement | HTMLSelectElement>; remove: HTMLButtonElement }
interface DisplayedTarget {
  documentId: string | null; eventId: string | null; event?: MusicEvent; blockedReason: string | null; chain: RoadTieChainInspection | null;
}
interface OpenMarking { documentId: string; eventId: string; markingId: string; kind: EventMarking['kind']; source: Element }
type Target = DraftTarget<EventMarkingsDraft>;
const names: Record<ArticulationType | OrnamentType, string> = {
  accent: 'Accent', staccato: 'Staccato', tenuto: 'Tenuto', marcato: 'Marcato', staccatissimo: 'Staccatissimo', fermata: 'Fermata',
  trill: 'Trill', turn: 'Turn', 'inverted-turn': 'Inverted turn', 'upper-mordent': 'Upper mordent', 'lower-mordent': 'Lower mordent',
};
const kindNames = { articulation: 'Articulation', ornament: 'Ornament', interval: 'Harmony interval' } as const;
let editorSequence = 0;

function location(score: Score, id: string | undefined): Location | undefined {
  if (!id) return undefined;
  for (const staff of score.staves) for (const measure of staff.measures) for (const [voiceIndex, voice] of measure.voices.entries()) {
    const event = voice.events.find(item => item.id === id);
    if (event) return { staff, measureId: measure.id, measureNumber: String(measure.number), voiceId: voice.id, voiceIndex, event };
  }
  return undefined;
}

function rowsFor(event: MusicEvent): EventMarkingRow[] {
  return (event.markings ?? []).map(marking => ({
    key: marking.id, markingId: marking.id, kind: marking.kind,
    type: marking.kind === 'interval' ? '' : marking.type,
    value: marking.kind === 'interval' ? harmonyIntervalText(marking.interval) : '',
    // Legacy sides have no active engraving meaning for standard marks. Keep
    // them out of draft comparisons without changing the source or model.
    placement: marking.kind === 'interval' ? marking.placement : marking.kind === 'articulation' ? 'auto' : 'above',
  }));
}

function eventName(event: MusicEvent): string {
  if (event.kind === 'note' || event.kind === 'chord') return event.pitches.map(pitchDescription).join(' + ');
  if (event.kind === 'road') return `3 roads note · ${event.pitchDirection}`;
  if (event.kind === 'rhythm') return 'Rhythm note';
  if (event.kind === 'rest') return event.measureRest ? 'Full-measure rest' : 'Rest';
  return event.rhythmic ? 'Rhythmic slash' : 'Open slash';
}

function supports(kind: EventMarking['kind'], event: MusicEvent): boolean {
  return kind === 'articulation' || kind === 'ornament' && (event.kind === 'note' || event.kind === 'road')
    || kind === 'interval' && event.kind === 'road';
}
function fermataOnly(event: MusicEvent): boolean { return event.kind === 'rest' || event.kind === 'slash' && !event.rhythmic; }
function unusedTypes(kind: 'articulation' | 'ornament', event: MusicEvent, rows: readonly EventMarkingRow[]): readonly (ArticulationType | OrnamentType)[] {
  const allowed = kind === 'ornament' ? ORNAMENT_TYPES : fermataOnly(event) ? ['fermata'] as const : ARTICULATION_TYPES;
  return allowed.filter(type => !rows.some(row => row.kind === kind && row.type === type));
}
function rowFields(row: EventMarkingRow): readonly EventMarkingField[] { return row.kind === 'interval' ? ['value', 'placement'] : ['type']; }
function rowChanged(row: EventMarkingRow, base: EventMarkingRow | undefined): boolean {
  return !base || row.kind !== base.kind || rowFields(row).some(field => row[field] !== base[field]);
}
function rowDescription(row: EventMarkingRow | undefined): string {
  if (!row) return 'removed';
  const name = row.kind === 'interval' ? `Harmony interval ${row.value || '(unfinished figure)'}`
    : names[row.type as keyof typeof names] ?? row.type;
  return `${name} · ${row.kind === 'interval' ? row.placement : 'automatic placement'}`;
}
function recoveryRow(row: EventMarkingRow, current: readonly EventMarkingRow[]): boolean {
  if (!row.markingId) return false;
  const accepted = current.find(item => item.markingId === row.markingId);
  return !accepted || accepted.kind !== row.kind;
}
function inputFor(row: EventMarkingRow, accepted?: EventMarking): EventMarkingInput {
  if (row.kind === 'interval') return { kind: 'interval', value: row.value, placement: row.placement as 'above' | 'below' };
  if (row.kind === 'ornament') return { kind: 'ornament', type: row.type as OrnamentType,
    placement: accepted?.kind === 'ornament' ? accepted.placement : row.placement as 'above' | 'below' };
  return { kind: 'articulation', type: row.type as ArticulationType,
    placement: accepted?.kind === 'articulation' ? accepted.placement : row.placement };
}

/** Child order is not part of a sustained sonority; identities and written figures are. */
function roadChain(score: Score, place: Location): RoadTieChainInspection | null {
  if (place.event.kind !== 'road') return null;
  const chain = inspectRoadTieChain(score, place.event.id);
  return { ...chain, members: chain.members.map(member => ({ ...member,
    intervals: [...member.intervals].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  })) };
}
function dependencyDescription(value: unknown): string {
  const dependency = value as { kind: string; notation: string; tie: string; chain: RoadTieChainInspection | null };
  const context = `${dependency.kind}, ${dependency.notation} staff, tie ${dependency.tie}`;
  if (!dependency.chain?.tied) return `${context}; no complete tied sound`;
  return `${context}; complete tied sound: ${dependency.chain.members.map(member =>
    `bar ${member.measureNumber}, event ${member.eventId}, ${member.tie}, intervals ${member.intervals.map(interval =>
      `${interval.value} ${interval.placement} (${interval.id})`).join(', ') || 'none'}`).join('; ')}`;
}

/** A selected-event draft, independent of scalar note fields and measure-level instructions. */
export class EventMarkingsEditor {
  private readonly options: EventMarkingsEditorOptions;
  private readonly scope: ControlScope;
  private readonly doc: Document;
  private readonly abort = new AbortController();
  private readonly store = new DraftStore<{ markings: EventMarkingsDraft }>();
  private readonly rowViews = new Map<string, RowView>();
  private readonly instance = ++editorSequence;
  private sequence = 0;
  private baseline?: EventMarkingRow[];
  private displayed?: DisplayedTarget;
  private discardKey = '';
  private mountedTarget = '';
  private visibleReviewSignature = '';
  private activeMarking?: OpenMarking;
  private intervalScope = false;
  private lastTarget = '';
  private lastSignature = '';
  private message = '';
  private error = false;
  private ownAction = false;
  private initialized = false;
  private disposed = false;

  constructor(options: EventMarkingsEditorOptions, root: ControlRoot = document) {
    this.options = options; this.scope = asControlScope(root); this.doc = this.scope.document;
    const host = this.el('event-markings-rows');
    for (const eventType of ['input', 'change']) host.addEventListener(eventType, event => this.run(() => {
      const element = event.target as Element | null;
      const control = element?.closest<HTMLInputElement | HTMLSelectElement>('[data-marking-field]');
      const row = control?.closest<HTMLElement>('[data-marking-row]');
      const field = control?.dataset.markingField as EventMarkingField | undefined;
      if (!row || !control || !field || !['type', 'value', 'placement'].includes(field)) return;
      // Record intent against the displayed owner and baseline before reading
      // new source. Otherwise a pristine form can silently rebind this input.
      const value = control.value;
      const view = this.requireDisplayed();
      const mounted = this.rowViews.get(row.dataset.markingRow ?? '');
      if (mounted?.element !== row || !mounted.controls.get(field)?.isSameNode(control)) throw new Error('This field no longer belongs to the displayed mark. Review the current rows.');
      const rows = structuredClone(view.values!.rows);
      const target = rows.find(item => item.key === row.dataset.markingRow);
      if (!target || target.kind !== row.dataset.markingKind) throw new Error('This mark is no longer in the draft. Review the current rows.');
      if (field === 'placement') target.placement = value as EventMarkingRow['placement'];
      else target[field] = value;
      this.patchRows(rows);
    }), { signal: this.abort.signal });
    host.addEventListener('click', event => this.run(() => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-remove-marking]');
      if (!button) return;
      const view = this.requireDisplayed();
      const key = button.dataset.removeMarking ?? '';
      if (this.rowViews.get(key)?.remove !== button) throw new Error('This row is no longer available. Review the current rows.');
      const index = view.values!.rows.findIndex(row => row.key === key);
      if (index < 0) throw new Error('This row is no longer available. Review the current rows.');
      const target = view.values!.rows[index];
      const accepted = view.current!.rows.find(row => row.markingId === target.markingId);
      const rows = view.values!.rows.flatMap(row => row.key !== key ? [row]
        : recoveryRow(row, view.current!.rows) && accepted ? [structuredClone(accepted)] : []);
      this.patchRows(rows);
      this.focusNearRow(index);
    }), { signal: this.abort.signal });
    for (const kind of ['articulation', 'ornament', 'interval'] as const) this.listen(`add-event-${kind}`, () => this.add(kind));
    this.listen('apply-event-markings', () => this.apply());
    this.listen('discard-event-markings', () => this.discard());
    this.listen('return-event-markings', () => this.returnToDraft());
    this.listen('review-event-markings', () => this.review());
    this.el('event-markings-tie-scope').addEventListener('change', () => this.run(() => this.changeScope()), { signal: this.abort.signal });
    this.refresh(); this.initialized = true;
  }

  get dirtyCount(): number { return this.store.dirtyCount; }
  get hasDirty(): boolean { return this.dirtyCount > 0; }

  snapshot(): EventMarkingsSnapshot {
    const stored = this.store.snapshot('markings');
    const snapshot = { ...stored, matchesSelection: !!stored.targetId && stored.documentId === this.options.session.project.id
      && exactSelectedEventId(this.options.context()) === stored.targetId };
    const blockedReason = this.blockedReason(snapshot);
    const unresolved = snapshot.values?.rows.some(row => recoveryRow(row, snapshot.current?.rows ?? []));
    return { ...snapshot, blockedReason, canApply: snapshot.canApply && !blockedReason && !unresolved };
  }

  refresh(): void {
    if (this.disposed || this.ownAction) return;
    const view = this.store.sync('markings', { ...this.draftContext(), selected: this.selectedTarget() });
    if (!view.dirty) this.baseline = undefined;
    const target = JSON.stringify([view.documentId, view.targetId]);
    if (target !== this.lastTarget && !view.dirty) { this.message = ''; this.error = false; this.intervalScope = false; }
    this.lastTarget = target;
    this.render(); this.notify();
  }

  /** Only the workspace calls this after explicitly replacing or discarding the document. */
  reset(): void {
    if (this.disposed) return;
    this.store.discardAll(); this.baseline = undefined; this.message = ''; this.error = false;
    this.intervalScope = false; this.activeMarking = undefined; this.refresh();
  }
  dispose(): void { this.disposed = true; this.abort.abort(); }

  returnToDraft(): void {
    if (this.disposed) return;
    const view = this.snapshot();
    if (view.documentId === this.options.session.project.id && view.targetId && this.readTarget(view.targetId)) this.options.select(view.targetId);
    this.options.openTools?.(); this.refresh(); this.focusStatus();
  }

  /** An explicit edit route; ordinary selection never opens the tool pane. */
  openFor(eventId: string, markingId?: string): void {
    if (this.disposed) return;
    this.options.openTools?.(); this.refresh();
    const view = this.snapshot(), documentId = this.options.session.project.id;
    const explain = (message: string, error = false) => {
      this.message = message; this.error = error; this.render(); this.notify(); this.focusStatus();
    };
    if (this.options.context().entryMode) {
      this.message = 'Return to this event before editing its attached marks.'; this.error = false;
      this.render(); this.notify();
      return;
    }
    this.activeMarking = undefined;
    if (view.dirty && (view.documentId !== documentId || view.targetId !== eventId)) {
      explain('Return to these attached marks, or Discard them to edit the selected event.');
      return;
    }
    const target = this.readTarget(eventId);
    const marking = target?.values.rows.find(row => row.markingId === markingId);
    if (!target || markingId && !marking) {
      explain(markingId ? 'That attached mark is no longer available on this event. No different row was selected.'
        : 'That event is no longer available. Your draft has not moved.', true);
      return;
    }
    if (this.selectedTarget()?.id !== eventId) this.options.select(markingId ?? eventId);
    this.refresh();
    const current = this.snapshot();
    if (current.documentId !== documentId || current.targetId !== eventId || !current.matchesSelection) {
      explain('Return to the named draft target before editing its attached marks. Your rows have not moved.');
      return;
    }
    if (markingId) {
      const draftRow = current.values!.rows.find(row => row.markingId === markingId);
      const source = this.sourceNode(markingId);
      if (!draftRow || draftRow.kind !== marking!.kind || !source) {
        explain('That mark was removed or changed family in this draft. Review or Discard its row change before opening the accepted mark.');
        return;
      }
      this.activeMarking = { documentId, eventId, markingId, kind: marking!.kind, source };
      this.message = ''; this.error = false; this.render();
      const control = [...this.rowViews.get(draftRow.key)!.controls.values()].find(control => !control.disabled);
      if (control) this.focusInPane(control); else this.focusStatus();
    } else {
      this.message = ''; this.error = false; this.render(); this.focusNearRow(0);
    }
    this.notify();
  }

  private readTarget(id: string): Target | null {
    const score = this.options.session.score, place = location(score, id);
    if (!place) return null;
    const { event, staff, measureId, voiceId } = place;
    return {
      documentId: this.options.session.project.id, id: event.id,
      label: `${eventName(event)} · ${staff.label || 'Staff'}, bar ${place.measureNumber}, voice ${place.voiceIndex + 1}`,
      values: { rows: rowsFor(event) }, context: { staffId: staff.id, measureId, voiceId },
      dependencies: { rows: { kind: event.kind, rhythmic: event.rhythmic, notation: staff.notation ?? 'pitched', tie: event.tie, chain: roadChain(score, place) } },
    };
  }

  private selectedTarget(): Target | null {
    const id = inspectedEventId(this.options.context());
    return id ? this.readTarget(id) : null;
  }
  private draftContext() {
    return { documentId: this.options.session.project.id, revision: this.options.session.revision, read: (id: string) => this.readTarget(id) };
  }
  private blockedReason(view: DraftSnapshot<EventMarkingsDraft>): string | null {
    if (this.options.session.project.pendingSource !== null) return 'Apply or Revert the Source draft before applying attached marks. Your rows are kept.';
    if (this.options.context().mode !== 'write') return 'Return to Write to edit attached marks. Your rows are kept.';
    if (!view.targetId) return 'Select one event to edit its attached marks.';
    if (view.status === 'missing') return 'The original event was removed. Discard these rows to start elsewhere.';
    if (view.status === 'document-changed') return 'These rows belong to another document. Discard them to start here.';
    if (this.options.context().entryMode) return 'Return to this event before editing its attached marks.';
    if (!view.matchesSelection) return 'Return to this draft’s event before applying it. Selecting other music has not moved these rows.';
    return null;
  }
  private requireEditable(): EventMarkingsSnapshot {
    this.refresh();
    const view = this.snapshot();
    if (view.blockedReason) throw new Error(view.blockedReason);
    return view;
  }

  /** Local edits use the last rendered binding; refresh then detects unseen changes. */
  private requireDisplayed(): EventMarkingsSnapshot {
    const shown = this.displayed, view = this.snapshot();
    if (this.options.session.project.pendingSource !== null) throw new Error('Apply or Revert the Source draft before editing attached marks. Your rows are kept.');
    if (this.options.context().mode !== 'write') throw new Error('Return to Write to edit attached marks. Your rows are kept.');
    if (this.options.context().entryMode) throw new Error('Return to this event before editing its attached marks.');
    if (!shown?.eventId || !view.values || shown.documentId !== view.documentId || shown.eventId !== view.targetId) {
      throw new Error('This field no longer belongs to the displayed event. Review the current target.');
    }
    if (shown.blockedReason) throw new Error(shown.blockedReason);
    return view;
  }

  private patchRows(rows: EventMarkingRow[]): void {
    const before = this.store.snapshot('markings');
    if (!before.dirty) this.baseline = structuredClone(before.current!.rows);
    this.store.patch('markings', { rows }); this.message = ''; this.error = false; this.refresh();
  }
  private changeScope(): void {
    const requested = this.el<HTMLInputElement>('event-markings-tie-scope').checked;
    const shown = this.requireDisplayed(), shownChain = this.displayed!.chain;
    const view = this.requireEditable();
    if (shown.documentId !== view.documentId || shown.targetId !== view.targetId
      || JSON.stringify(shownChain) !== JSON.stringify(this.displayed!.chain)) {
      throw new Error('The connected notes changed. Review the displayed scope before choosing it again.');
    }
    if (requested && !this.displayed!.chain?.tied) throw new Error('Complete tied-sound scope requires connected tied road notes.');
    this.intervalScope = requested; this.message = ''; this.error = false;
    this.render(); this.notify();
  }
  private add(kind: EventMarking['kind']): void {
    const view = this.requireDisplayed();
    const event = this.displayed!.event!;
    if (!supports(kind, event)) throw new Error(kind === 'interval' ? 'Harmony intervals attach only to 3 roads main notes.' : 'Ornaments attach only to single notes or 3 roads main notes.');
    const nextType = kind === 'interval' ? '' : unusedTypes(kind, event, view.values!.rows)[0];
    if (nextType === undefined) throw new Error(`Every supported ${kind} type is already in this draft. Edit or remove an existing row.`);
    // Authored source IDs cannot contain whitespace; pending rows cannot alias them.
    const row: EventMarkingRow = { key: `new marking:${this.instance}:${++this.sequence}`, kind,
      type: nextType,
      value: '', placement: kind === 'articulation' ? 'auto' : 'above' };
    this.patchRows([...view.values!.rows, row]);
    const control = [...this.rowViews.get(row.key)!.controls.values()].find(control => !control.disabled);
    if (control) this.focusInPane(control); else this.focusStatus();
  }

  private edits(base: readonly EventMarkingRow[], current: readonly EventMarkingRow[], rows: readonly EventMarkingRow[], source: readonly EventMarking[]): EventMarkingEdit[] {
    const edits: EventMarkingEdit[] = [];
    for (const prior of base) if (prior.markingId && !rows.some(row => row.markingId === prior.markingId)
      && current.some(row => row.markingId === prior.markingId)) edits.push({ type: 'remove', markingId: prior.markingId });
    for (const row of rows) {
      if (!row.markingId) { edits.push({ type: 'add', value: inputFor(row) }); continue; }
      const accepted = current.find(item => item.markingId === row.markingId);
      if (!accepted) throw new Error('An attached mark in this draft was removed from the source. Remove that draft row or discard the draft; it will not be recreated silently.');
      if (accepted.kind !== row.kind) throw new Error('An attached mark changed its family. Remove that draft row and add the intended kind explicitly.');
      const prior = base.find(item => item.markingId === row.markingId) ?? accepted;
      const fields = rowFields(row).filter(field => row[field] !== prior[field]);
      if (fields.length) edits.push({ type: 'update', markingId: row.markingId,
        value: inputFor(row, source.find(marking => marking.id === row.markingId)), fields });
    }
    return edits;
  }

  private apply(): void {
    this.requireEditable();
    const resolved = this.store.resolve('markings', this.draftContext());
    if (!resolved.ok) throw new Error(resolved.message);
    const accepted = this.readTarget(resolved.targetId);
    const owner = location(this.options.session.score, resolved.targetId);
    if (!accepted || !owner) throw new Error('This event no longer exists. Your rows have not been applied.');
    const edits = this.edits(this.baseline ?? accepted.values.rows, accepted.values.rows, resolved.values.rows, owner.event.markings ?? []);
    const intervalEdit = edits.some(edit => edit.type === 'add' ? edit.value.kind === 'interval'
      : accepted.values.rows.some(row => row.markingId === edit.markingId && row.kind === 'interval'));
    const chain = this.displayed?.chain;
    if (this.intervalScope && intervalEdit && !chain?.tied) throw new Error('The complete tied sound is no longer available. Turn off complete-tie scope to edit only this event.');
    const intervalScope = this.intervalScope && intervalEdit && chain?.tied ? 'tie-chain' as const : undefined;
    const before = this.options.session.revision;
    this.ownAction = true;
    try {
      if (this.options.session.project.id !== resolved.documentId || before !== resolved.revision) throw new Error('The document changed before these marks could be applied. Review the draft.');
      if (edits.length) this.options.session.execute({ type: 'edit-event-markings', eventId: resolved.targetId, edits,
        ...(intervalScope ? { intervalScope } : {}),
      });
      const next = this.readTarget(resolved.targetId);
      if (!next) throw new Error('The updated event could not be found.');
      this.store.commit('markings', next); this.baseline = undefined;
      this.message = this.options.session.revision === before ? 'These marks already match the accepted music.' : 'Applied attached marks. One Undo restores this edit.';
      this.error = false;
    } finally { this.ownAction = false; }
    const feedback = this.message; this.message = '';
    this.refresh(); this.focusStatus(); this.options.report?.(feedback);
  }

  private discard(): void {
    const context = this.options.context(), view = this.snapshot();
    if (this.discardKey !== inspectionDiscardKey(context, this.options.session.project.id, view)) {
      throw new Error('The selection or document changed. Review the updated destination before discarding.');
    }
    const id = exactSelectedEventId(context);
    const next = id ? this.readTarget(id) : null;
    if (id && !next) throw new Error('The selected event is no longer available. Your draft is kept.');
    this.store.discard('markings', next); this.baseline = undefined;
    if (id && (!view.matchesSelection || context.entryMode)) this.options.select(id);
    this.intervalScope = false;
    this.message = ''; this.error = false;
    this.refresh(); this.focusStatus(); this.options.report?.('Discarded the unapplied rows. Accepted music is unchanged.');
  }

  private review(): void {
    const displayed = this.visibleReviewSignature;
    const view = this.requireEditable();
    if (view.status !== 'conflict') { this.focusStatus(); return; }
    if (!displayed || displayed !== this.reviewSignature(view)) {
      this.message = 'The accepted music changed again. Review the newly displayed changes before applying your rows.';
      this.error = false; this.render(); this.notify(); this.focusStatus(); return;
    }
    const current = view.current!.rows, desired = view.values!.rows, base = this.baseline ?? current;
    // Rebase only intentional row changes. Source additions and untouched fields survive review.
    const rows: EventMarkingRow[] = [];
    for (const accepted of current) {
      const prior = base.find(row => row.markingId === accepted.markingId);
      const draft = desired.find(row => row.markingId === accepted.markingId);
      if (prior && !draft) continue;
      const next = structuredClone(accepted);
      if (draft && prior) {
        if (draft.kind !== accepted.kind) {
          rows.push(structuredClone(rowChanged(draft, prior) ? draft : accepted)); continue;
        }
        for (const field of rowFields(draft)) if (draft[field] !== prior[field]) {
          if (field === 'placement') next.placement = draft.placement; else next[field] = draft[field];
        }
      }
      rows.push(next);
    }
    rows.push(...desired.filter(row => !row.markingId || !current.some(accepted => accepted.markingId === row.markingId)
      && rowChanged(row, base.find(prior => prior.markingId === row.markingId))));
    this.store.review('markings', this.draftContext());
    this.baseline = structuredClone(current); this.store.patch('markings', { rows });
    this.message = 'Reviewed the current event. Your row changes are kept; untouched source marks remain. Apply still validates the whole score.';
    this.error = false; this.refresh(); this.focusStatus();
  }

  private createRow(row: EventMarkingRow): RowView {
    const element = this.doc.createElement('fieldset'); element.className = 'plain-fieldset subsection';
    element.dataset.markingRow = row.key; element.dataset.markingKind = row.kind;
    if (row.markingId) element.dataset.markingId = row.markingId;
    const legend = this.doc.createElement('legend'); legend.textContent = kindNames[row.kind]; element.append(legend);
    const grid = this.doc.createElement('div'); grid.className = row.kind === 'interval' ? 'field-grid two-fields' : 'field-grid'; element.append(grid);
    if (row.kind !== 'interval') grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
    const controls = new Map<EventMarkingField, HTMLInputElement | HTMLSelectElement>();
    const field = (key: EventMarkingField, title: string, choices?: readonly NativeOption[]) => {
      const label = this.doc.createElement('label'); label.className = 'field'; label.append(this.doc.createTextNode(title));
      const control = this.doc.createElement(choices ? 'select' : 'input') as HTMLInputElement | HTMLSelectElement;
      control.id = `event-marking-${this.instance}-${++this.sequence}-${key}`; control.name = control.id;
      control.dataset.markingField = key; control.setAttribute('aria-describedby', `event-markings-draft-status ${row.kind === 'interval' ? 'event-markings-interval-help' : 'event-markings-placement-help'}`);
      label.htmlFor = control.id;
      if (choices) {
        const button = this.doc.createElement('button'); button.type = 'button'; button.append(this.doc.createElement('selectedcontent')); control.append(button);
        renderNativeOptions(control as HTMLSelectElement, choices, row[key]);
      } else { const input = control as HTMLInputElement; input.type = 'text'; input.placeholder = '5, b3, #11'; input.autocomplete = 'off'; input.spellcheck = false; }
      label.append(control); grid.append(label); controls.set(key, control);
    };
    if (row.kind === 'interval') {
      field('value', 'Interval figure');
      field('placement', 'Harmony direction', [
        { value: 'above', label: 'Above main pitch', icon: phArrowUp },
        { value: 'below', label: 'Below main pitch', icon: phArrowDown },
      ]);
    } else field('type', `${kindNames[row.kind]} type`, row.kind === 'articulation'
      ? ARTICULATION_TYPES.map(type => ({ value: type, label: names[type], icon: articulationIcon(type) }))
      : ORNAMENT_TYPES.map(type => ({ value: type, label: names[type], icon: ornamentIcon(type) })));
    const remove = this.doc.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button';
    render(buttonContent(phTrash, html`<span data-control-label>Remove</span>`, { layout: 'inline' }), remove);
    remove.dataset.removeMarking = row.key; remove.setAttribute('aria-label', `Remove ${kindNames[row.kind].toLowerCase()}`); element.append(remove);
    enhanceSelects(element);
    return { element, controls, remove };
  }

  private reviewSignature(view: EventMarkingsSnapshot): string {
    return view.status === 'conflict' ? JSON.stringify([view.documentId, view.targetId, view.conflicts]) : '';
  }

  private conflictDetails(view: EventMarkingsSnapshot): string {
    const current = view.current?.rows ?? [], desired = view.values?.rows ?? [];
    if (view.status !== 'conflict' && !desired.some(row => recoveryRow(row, current))) return '';
    const keys = new Set([...current, ...desired].map(row => row.markingId ?? row.key));
    const differences: string[] = [];
    for (const key of keys) {
      const accepted = current.find(row => (row.markingId ?? row.key) === key);
      const draft = desired.find(row => (row.markingId ?? row.key) === key);
      if (!accepted || !draft || rowChanged(draft, accepted)) {
        const id = accepted?.markingId ?? draft?.markingId;
        differences.push(`${id ? `Mark ${id}` : 'New mark'} — Accepted: ${rowDescription(accepted)}. Draft: ${rowDescription(draft)}.`);
      }
    }
    for (const conflict of view.conflicts) {
      if (conflict.reason === 'dependency') differences.push(`Accepted setting: ${dependencyDescription(conflict.current)}. Draft began with: ${dependencyDescription(conflict.base)}.`);
      else if (conflict.reason === 'context') {
        differences.push(`Accepted location: ${JSON.stringify(conflict.current)}. Draft began at: ${JSON.stringify(conflict.base)}.`);
      }
    }
    if (desired.some(row => recoveryRow(row, current))) differences.push('Use Discard row change to leave a removed mark absent or keep its accepted replacement. Other draft rows are kept.');
    return differences.join(' ');
  }

  private sourceNode(id: string): Element | undefined {
    const root = this.options.session.source;
    return root.id === id ? root : [...root.querySelectorAll('[id]')].find(node => node.id === id);
  }

  private syncActiveMarking(view: EventMarkingsSnapshot, place: Location | undefined): void {
    const active = this.activeMarking;
    if (!active) return;
    const context = this.options.context();
    const inspecting = exactSelectedEventId(context) === active.eventId
      || !!context.entryMode && inspectedEventId(context) === active.eventId;
    const accepted = place?.event.markings?.find(marking => marking.id === active.markingId);
    const draft = view.values?.rows.find(row => row.markingId === active.markingId);
    if (this.options.session.project.id !== active.documentId || view.documentId !== active.documentId
      || view.targetId !== active.eventId || !inspecting
      || !accepted || accepted.kind !== active.kind || !draft || draft.kind !== active.kind
      || this.sourceNode(active.markingId) !== active.source || active.source.parentElement?.id !== active.eventId) {
      this.activeMarking = undefined;
    }
  }

  private render(): void {
    const view = this.snapshot(); const rows = view.values?.rows ?? [];
    const score = this.options.session.score;
    const place = view.documentId === this.options.session.project.id ? location(score, view.targetId ?? undefined) : undefined;
    const chain = place ? roadChain(score, place) : null;
    const blocked = !!view.blockedReason;
    const panel = this.el('event-markings-editor');
    const focused = this.scope.activeElement as HTMLElement | null, hadFocus = !!focused && panel.contains(focused);
    const context = this.options.context();
    const unavailableInspection = typeof context.inspectionSelectionId === 'string' && !view.targetId;
    const caption = this.el('event-markings-target');
    caption.textContent = view.label ?? (unavailableInspection ? 'The inspected event is no longer available.' : 'Select one event to edit its attached marks.');
    caption.dataset.documentId = view.documentId ?? this.options.session.project.id;
    caption.dataset.targetId = view.targetId ?? '';
    const currentId = exactSelectedEventId(context), current = currentId ? location(score, currentId) : undefined;
    const needsReturn = !!view.targetId && (!view.matchesSelection || !!context.entryMode);
    const unavailable = view.status === 'missing' ? 'The original event was removed. Discard these rows to start elsewhere.'
      : view.status === 'document-changed' ? 'These rows belong to another document. Discard them to start here.'
        : view.status === 'conflict' ? 'Accepted marks changed. Review the differences before applying.' : '';
    const selectionMessage = needsReturn && !context.entryMode
      ? current ? `${eventName(current.event)} selected.`
        : (context.rangeEventIds?.length ?? 0) > 1 ? `${context.rangeEventIds!.length} events selected.` : 'No single event selected.' : '';
    const showNotice = view.dirty || !!view.error || this.error || !!unavailable || needsReturn;
    const status = this.el('event-markings-draft-status');
    const statusText = showNotice ? [view.dirty ? 'Unapplied attached marks.' : '', selectionMessage, unavailable,
      this.conflictDetails(view), this.message, view.error, view.blockedReason]
      .filter((text, index, all) => text && all.indexOf(text) === index).join(' ') : '';
    if (status.textContent !== statusText) status.textContent = statusText;
    const notice = status.closest<HTMLElement>('.draft-notice'); if (notice) notice.hidden = !showNotice;
    status.setAttribute('role', this.error || !!view.error ? 'alert' : 'status'); status.setAttribute('aria-live', this.error || !!view.error ? 'assertive' : 'polite');
    status.dataset.draftState = view.status;
    panel.dataset.draftTarget = view.targetId ?? ''; panel.dataset.draftState = view.status;
    this.syncActiveMarking(view, place);
    panel.dataset.activeMarkingId = this.activeMarking?.markingId ?? '';
    const host = this.el('event-markings-rows');
    const identity = JSON.stringify([view.documentId, view.targetId]);
    if (identity !== this.mountedTarget) {
      for (const row of this.rowViews.values()) row.element.remove();
      this.rowViews.clear(); this.mountedTarget = identity;
    }
    for (const [key, row] of this.rowViews) if (!rows.some(item => item.key === key)) { row.element.remove(); this.rowViews.delete(key); }
    rows.forEach((row, index) => {
      let mounted = this.rowViews.get(row.key);
      if (mounted && mounted.element.dataset.markingKind !== row.kind) {
        mounted.element.remove(); this.rowViews.delete(row.key); mounted = undefined;
      }
      if (!mounted) { mounted = this.createRow(row); this.rowViews.set(row.key, mounted); }
      if (host.children[index] !== mounted.element) host.insertBefore(mounted.element, host.children[index] ?? null);
      if (row.markingId && row.markingId === this.activeMarking?.markingId) mounted.element.setAttribute('aria-current', 'true');
      else mounted.element.removeAttribute('aria-current');
      for (const [field, control] of mounted.controls) {
        if (control.value !== row[field]) control.value = row[field];
        control.disabled = blocked || !place || !supports(row.kind, place.event);
        if (field === 'type') for (const option of (control as HTMLSelectElement).options) {
          option.disabled = row.kind === 'articulation' && !!place && fermataOnly(place.event) && option.value !== 'fermata'
            || rows.some(other => other.key !== row.key && other.kind === row.kind && other.type === option.value);
        }
      }
      mounted.remove.disabled = blocked;
      const recovery = recoveryRow(row, view.current?.rows ?? []);
      setControlLabel(mounted.remove, recovery ? 'Discard row change' : 'Remove');
      mounted.remove.setAttribute('aria-label', `${recovery ? 'Discard row change for' : 'Remove'} ${rowDescription(row)}${row.markingId ? ` (${row.markingId})` : ''}`);
    });
    this.el('event-markings-empty').hidden = rows.length > 0;
    for (const kind of ['articulation', 'ornament', 'interval'] as const) {
      const button = this.el<HTMLButtonElement>(`add-event-${kind}`);
      const exhausted = !!place && kind !== 'interval' && !unusedTypes(kind, place.event, rows).length;
      button.disabled = blocked || !place || !supports(kind, place.event) || exhausted;
      button.title = button.disabled ? view.blockedReason ?? (exhausted ? `Every supported ${kind} type is already in this draft.`
        : kind === 'interval' ? 'Harmony intervals require a 3 roads main note.' : 'Ornaments require a single note or 3 roads main note.') : '';
    }
    this.el('event-markings-availability').textContent = !place ? '' : fermataOnly(place.event) ? 'Rests and open slashes accept fermatas only.'
      : place.event.kind === 'road' ? 'Articulations, ornaments, and harmony intervals attach to this main note.'
        : place.event.kind === 'note' ? 'Articulations and ornaments attach to this note. Harmony intervals belong to 3 roads notes.'
          : 'This event accepts articulations. Ornaments need a single note or 3 roads main note.';
    this.el('event-markings-interval-help').hidden = place?.event.kind !== 'road' && !rows.some(row => row.kind === 'interval');
    this.el('event-markings-ornament-help').hidden = !rows.some(row => row.kind === 'ornament');
    const scope = this.el<HTMLInputElement>('event-markings-tie-scope');
    scope.checked = this.intervalScope;
    scope.disabled = blocked || !chain?.tied && !this.intervalScope;
    this.el('event-markings-tie-options').hidden = !chain?.tied && !this.intervalScope;
    const bars = chain ? [...new Set(chain.members.map(member => member.measureNumber))] : [];
    this.el('event-markings-tie-help').textContent = chain?.tied
      ? `${chain.members.length} tied notes · ${place!.staff.label || 'Staff'}, voice ${chain.voiceIndex + 1}, ${bars.length === 1 ? 'bar' : 'bars'} ${bars.join(', ')}. Complete scope applies only interval edits across this sound. Articulations and ornaments stay on the selected segment. Leave scope off to edit this segment only.`
      : this.intervalScope ? 'The complete tied sound is no longer available. Turn off this scope to edit only the selected event, or review the changed chain. Your rows are kept.'
        : 'Complete scope is available for connected tied road notes. Articulations and ornaments always stay on the selected segment.';
    this.el<HTMLButtonElement>('apply-event-markings').disabled = !view.canApply;
    const discard = this.el<HTMLButtonElement>('discard-event-markings'); discard.hidden = !view.dirty && !view.error && !this.error;
    setControlLabel(discard, (!view.matchesSelection || context.entryMode) && current ? `Discard and edit ${eventName(current.event)}`
      : 'Discard changes');
    const back = this.el<HTMLButtonElement>('return-event-markings'); back.hidden = !needsReturn;
    back.disabled = view.status === 'missing' || view.status === 'document-changed';
    setControlLabel(back, place ? `Return to ${eventName(place.event)}` : 'Return to original event');
    const review = this.el<HTMLButtonElement>('review-event-markings'); review.hidden = view.status !== 'conflict'; review.disabled = blocked;
    this.displayed = { documentId: view.documentId, eventId: view.targetId, event: place?.event, blockedReason: view.blockedReason, chain };
    this.discardKey = inspectionDiscardKey(context, this.options.session.project.id, view);
    this.visibleReviewSignature = this.reviewSignature(view);
    syncInspectionCaptions(this.scope);
    if (hadFocus && (!focused!.isConnected || (focused as HTMLButtonElement).disabled || focused!.closest('[hidden], [inert]'))) this.focusStatus();
  }

  /** Reveal only inside the tool pane; never scroll the music or the page. */
  private focusInPane(element: HTMLElement): void {
    if (!this.disposed) focusInTools(element);
  }
  private focusNearRow(index: number): void {
    const rows = this.snapshot().values?.rows ?? [];
    const from = Math.min(index, rows.length - 1);
    const order = [...rows.slice(Math.max(0, from)), ...rows.slice(0, Math.max(0, from)).reverse()];
    for (const row of order) {
      const control = [...(this.rowViews.get(row.key)?.controls.values() ?? [])].find(control => !control.disabled);
      if (control) { this.focusInPane(control); return; }
    }
    const add = this.el<HTMLButtonElement>('add-event-articulation');
    if (!add.disabled) this.focusInPane(add); else this.focusStatus();
  }
  private focusStatus(): void {
    const status = this.el('event-markings-draft-status');
    const caption = this.el('event-markings-target');
    const target = !status.closest('[hidden], [inert]') ? status
      : this.scope.getElementById(caption.dataset.captionId ?? caption.id) ?? caption;
    target.tabIndex = -1; this.focusInPane(target);
  }
  private notify(): void {
    const signature = JSON.stringify(this.snapshot());
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    if (this.initialized) this.options.onDraftChange?.();
  }
  private run(action: () => void): void {
    if (this.disposed) return;
    try { action(); } catch (error) {
      this.message = error instanceof Error ? error.message : String(error); this.error = true;
      this.store.fail('markings', this.message); this.refresh();
    }
  }
  private listen(id: string, action: () => void): void { this.el(id).addEventListener('click', () => this.run(action), { signal: this.abort.signal }); }
  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.scope.getElementById(id);
    if (!element) throw new Error(`Missing attached-markings control: ${id}`);
    return element as T;
  }
}
