import { setControlLabel } from '../ui/control-content.js';
import { compare, formatRational, rational } from '../model/index.js';
import type { Annotation, Duration, Measure, MusicEvent, Staff } from '../model/types.js';
import { renderNativeCheckboxes } from '../ui/native-checkboxes.js';
import { renderNativeOptions } from '../ui/native-options.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';
import type { EditorSession } from './editor.js';
import { DraftStore } from './form-drafts.js';
import type { DraftConflict, DraftTarget } from './form-drafts.js';
import { partLabel } from './part-label.js';
import { enhanceSelects } from './select.js';
import { focusInTools } from './tool-pane-focus.js';
import type { AnnotationInput, AuthorProject, InstructionScope, ViewMode } from './types.js';

export interface MarkingsContext {
  mode: ViewMode;
  staff: Staff;
  measure: Measure;
  voiceIndex: number;
  event?: MusicEvent;
  annotation?: Annotation;
}

export interface MarkingsEditorOptions {
  session: EditorSession;
  context: () => MarkingsContext;
  /** Explicit musical navigation; passive refresh never invokes this callback. */
  select: (id: string) => void;
  /** Open Markings and park note entry. This controller then focuses the text field. */
  openTools: () => void;
  onDraftChange?: () => void;
  report?: (message: string) => void;
}

type Recipients = 'staff' | 'all' | string[];
interface MarkingFields {
  kind: AnnotationInput['kind'];
  text: string;
  at: string;
  placement: AnnotationInput['placement'];
  bpm: string;
  beat: Duration;
  dots: string;
  recipients: Recipients;
}
type MarkingTarget = DraftTarget<MarkingFields>;
interface Location { staff: Staff; measure: Measure; annotation?: Annotation }
interface NewSeed {
  documentId: string; staffId: string; measureId: string; values: MarkingFields;
  guardMatches: boolean; matchingValues: MarkingFields;
}
interface Collision { targetId: string; message: string }
interface PartDependency { id: string; label: string; staffIds: string[] | null }
interface RecipientIntent { documentId: string; targetId: string; parts: Map<string, PartDependency> }

const newPrefix = 'new-instruction:';
const editPrefix = 'instruction:';
const chooseValue = '__choose-instruction__';
const kinds: Record<AnnotationInput['kind'], string> = {
  harmony: 'chord symbol', direction: 'direction', rehearsal: 'rehearsal mark', dynamics: 'dynamics', tempo: 'tempo',
};
const fieldNames: Record<keyof MarkingFields, string> = {
  kind: 'kind', text: 'printed text', at: 'position', placement: 'placement', bpm: 'tempo BPM',
  beat: 'tempo beat', dots: 'tempo dots', recipients: 'recipients',
};
const fieldIds = {
  kind: 'annotation-kind', text: 'annotation-text', at: 'annotation-at', placement: 'annotation-placement',
  bpm: 'annotation-bpm', beat: 'annotation-beat', dots: 'annotation-dots',
} as const;

function scopeValue(scope: InstructionScope | undefined): Recipients {
  return scope === 'all' ? 'all' : Array.isArray(scope) ? [...scope].sort() : 'staff';
}

function sameRecipients(a: Recipients, b: Recipients): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? [...a].sort().join('\0') === [...b].sort().join('\0') : a === b;
}

function annotationValues(annotation: Annotation, project: AuthorProject): MarkingFields {
  return {
    kind: annotation.kind, text: annotation.text, at: formatRational(annotation.onset), placement: annotation.placement,
    bpm: annotation.bpm === undefined ? '' : String(annotation.bpm), beat: annotation.beat ?? 'quarter',
    dots: String(annotation.dots ?? 0), recipients: scopeValue(project.instructionScopes[annotation.id]),
  };
}

function fraction(value: string): ReturnType<typeof rational> {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim() || '0');
  if (!match) throw new Error('Use an exact nonnegative position such as 0, 1/4, or 3/8.');
  return rational(Number(match[1]), Number(match[2] ?? 1));
}

function sameWrittenValue(a: MarkingFields, b: MarkingFields): boolean {
  let sameAt = false;
  try { sameAt = compare(fraction(a.at), fraction(b.at)) === 0; } catch { /* Validation will explain an invalid fraction. */ }
  return a.kind === b.kind && a.text === b.text && sameAt && a.placement === b.placement
    && sameRecipients(a.recipients, b.recipients)
    && (a.kind !== 'tempo' || (a.bpm.trim() === b.bpm && a.beat === b.beat && Number(a.dots) === Number(b.dots)));
}

function labelFor(location: Location): string {
  return `${location.staff.label || 'Staff'} · bar ${location.measure.number}`;
}

function recipientLabel(scope: InstructionScope | undefined, project: AuthorProject, staff?: Staff): string {
  if (scope === 'all') return 'Score and all relevant parts';
  if (scope === undefined) return `Staff only: ${staff?.label || 'selected staff'}`;
  const names = scope.map(id => {
    const part = project.parts.find(candidate => candidate.id === id);
    if (!part) return `Missing part (${id})`;
    return partLabel(part, project.parts);
  }).sort((a, b) => a.localeCompare(b));
  return `Chosen parts: ${names.join(', ') || 'none'}`;
}

/**
 * A mounted form for a sustained harmony/instruction pass. Its draft belongs to
 * one document and source target, independently of selection, tabs, and revision.
 */
export class MarkingsEditor {
  private readonly options: MarkingsEditorOptions;
  private readonly scope: ControlScope;
  private readonly abort = new AbortController();
  private store = new DraftStore<{ markings: MarkingFields }>();
  private readonly newSeeds = new Map<string, NewSeed>();
  private recipe: MarkingFields;
  private collision: Collision | undefined;
  private explicitTarget: MarkingTarget | undefined;
  private pendingStart: { chord: boolean } | undefined;
  private selectionStamp = '';
  private message = '';
  private error = false;
  private lastDirtyCount = 0;
  private reviewedConflictSignature = '';
  private visibleCollisionSignature = '';
  private recipientIntent: RecipientIntent | undefined;
  private visibleRecipientSignature = '';
  private chooserPlaceholder = chooseValue;
  private ownAction = false;
  private disposed = false;

  constructor(options: MarkingsEditorOptions, root: ControlRoot = document) {
    this.options = options;
    this.scope = asControlScope(root);
    this.recipe = {
      kind: this.value('annotation-kind') as MarkingFields['kind'], text: '', at: '0',
      placement: this.value('annotation-placement') as MarkingFields['placement'],
      bpm: '', beat: (this.value('annotation-beat') || 'quarter') as Duration, dots: this.value('annotation-dots') || '0',
      recipients: 'staff',
    };
    this.bind();
    this.refresh();
  }

  get dirtyCount(): number { return this.store.dirtyCount; }
  get hasDirty(): boolean { return this.dirtyCount > 0; }

  /** Call after selection, accepted transactions, Source draft changes, or view changes. */
  refresh(): void {
    if (this.disposed || this.ownAction) return;
    const context = this.options.context();
    const stamp = this.stamp(context);
    if (stamp !== this.selectionStamp) {
      this.explicitTarget = undefined;
      if (!this.hasDirty) { this.collision = undefined; this.message = ''; this.error = false; }
      this.selectionStamp = stamp;
    }
    const selected = this.explicitTarget ? this.readTarget(this.explicitTarget.id) : this.selectedTarget(context);
    this.store.sync('markings', {
      documentId: this.options.session.project.id, revision: this.options.session.revision,
      selected, read: id => this.readTarget(id),
    });
    const snapshot = this.store.snapshot('markings');
    if (!snapshot.dirty) this.recipientIntent = undefined;
    if (!snapshot.dirty && snapshot.values && snapshot.targetId?.startsWith(editPrefix)) {
      this.recipe = { ...structuredClone(snapshot.values), text: '', at: '0' };
    }
    this.refreshCollision();
    this.render();
    this.notifyDraft();
  }

  /** Explicit Add always starts New; it never guesses that an existing symbol should be overwritten. */
  startChordSymbol(): void { this.startNew(true, true); }

  editAnnotation(id: string, options: { navigate?: boolean } = {}): void {
    if (this.disposed) return;
    const target = this.readTarget(`${editPrefix}${id}`);
    if (!target) { this.feedback('That instruction no longer exists. Choose a current instruction.', true); return; }
    this.pendingStart = undefined;
    // Reopening the current selection's properties is not score navigation.
    // Explicit instruction choices still select and reveal their destination.
    if (options.navigate !== false) this.options.select(id);
    this.options.openTools();
    if (this.hasDirty && this.store.snapshot('markings').targetId !== target.id) {
      this.refresh();
      this.feedback('Your unapplied instruction stays with its original target. Discard/start here to edit this selection.', true);
    } else {
      this.explicitTarget = target;
      this.collision = undefined;
      this.selectionStamp = this.stamp(this.options.context());
      this.refresh();
    }
    this.focusText();
  }

  /** Only the owner calls this after confirming replacement/discard of unsaved inspector drafts. */
  reset(): void {
    if (this.disposed) return;
    this.store = new DraftStore<{ markings: MarkingFields }>();
    this.newSeeds.clear();
    this.explicitTarget = undefined;
    this.pendingStart = undefined;
    this.collision = undefined;
    this.selectionStamp = '';
    this.message = '';
    this.error = false;
    this.recipientIntent = undefined;
    this.visibleRecipientSignature = '';
    this.refresh();
  }

  dispose(): void { this.disposed = true; this.abort.abort(); }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.scope.getElementById(id);
    if (!element) throw new Error(`Missing Markings control: ${id}`);
    return element as T;
  }

  private value(id: string): string { return this.el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).value; }
  private setValue(id: string, value: string): void {
    const field = this.el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
    if (field.value !== value) field.value = value;
  }
  private on(id: string, type: string, callback: () => void): void {
    this.scope.getElementById(id)?.addEventListener(type, () => {
      if (this.disposed) return;
      try { callback(); } catch (error) { this.feedback(error instanceof Error ? error.message : String(error), true); }
    }, { signal: this.abort.signal });
  }

  private stamp(context: MarkingsContext): string {
    return JSON.stringify([this.options.session.project.id, context.staff.id, context.measure.id, context.voiceIndex,
      context.event?.id ?? '', context.annotation?.id ?? '']);
  }

  private location(id: string): Location | undefined {
    for (const staff of this.options.session.score.staves) {
      for (const measure of staff.measures) {
        if (measure.id === id) return { staff, measure };
        const annotation = measure.annotations.find(item => item.id === id);
        if (annotation) return { staff, measure, annotation };
      }
    }
    return undefined;
  }

  private matching(location: Location, values: MarkingFields) {
    let onset: ReturnType<typeof rational>;
    try { onset = fraction(values.at); } catch { return []; }
    const project = this.options.session.project;
    return location.measure.annotations.filter(annotation => annotation.kind === values.kind
      && annotation.placement === values.placement && compare(annotation.onset, onset) === 0)
      .map(annotation => ({ id: annotation.id, text: annotation.text, recipients: scopeValue(project.instructionScopes[annotation.id]) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private guardedMatches() {
    const snapshot = this.store.snapshot('markings');
    const seed = snapshot.targetId ? this.newSeeds.get(snapshot.targetId) : undefined;
    const location = this.boundLocation();
    return seed?.guardMatches && location && snapshot.documentId === this.options.session.project.id
      ? { targetId: snapshot.targetId!, seed, location, matches: this.matching(location, seed.matchingValues) } : undefined;
  }

  private refreshCollision(): void {
    const guarded = this.guardedMatches();
    if (!guarded?.matches.length) { this.collision = undefined; return; }
    const differentRecipients = guarded.matches.length === 1
      && !sameRecipients(guarded.matches[0].recipients, guarded.seed.matchingValues.recipients);
    const description = guarded.matches.length > 1 ? 'several matching instructions'
      : differentRecipients ? 'an instruction for different recipients' : 'an instruction';
    const texts = guarded.matches.slice(0, 3).map(item => `“${item.text.slice(0, 80)}”`).join(', ');
    this.collision = { targetId: guarded.targetId,
      message: `Bar ${guarded.location.measure.number} already has ${description} here (${texts}). Choose an existing instruction to edit, or explicitly keep this as New.` };
    this.message = this.collision.message;
  }

  private hasOtherConflict(conflicts: readonly DraftConflict<MarkingFields>[]): boolean {
    const withoutMatches = (value: unknown) => {
      const copy = { ...(value as Record<string, unknown> | undefined) };
      delete copy.matching;
      return JSON.stringify(copy);
    };
    return conflicts.some(item => item.reason !== 'context' || withoutMatches(item.base) !== withoutMatches(item.current));
  }

  private keepDraftAsNew(): void {
    const displayed = this.visibleCollisionSignature;
    this.store.resolve('markings', this.draftContext());
    this.refreshCollision();
    const guarded = this.guardedMatches();
    const snapshot = this.store.snapshot('markings');
    if (!guarded || snapshot.status === 'missing' || snapshot.status === 'document-changed') {
      this.feedback(snapshot.message || 'This draft’s original location is no longer available.', true);
      return;
    }
    if (JSON.stringify(guarded.matches) !== displayed) {
      this.feedback('Instructions at this position changed again. Check the current choices before keeping this draft as New.', true);
      return;
    }
    if (this.hasOtherConflict(snapshot.conflicts) || this.recipientConflict()) {
      this.feedback('Review the other accepted changes before choosing to keep a separate New instruction.', true);
      return;
    }
    guarded.seed.guardMatches = false;
    this.store.review('markings', this.draftContext());
    this.explicitTarget = this.readTarget(guarded.targetId) ?? undefined;
    this.selectionStamp = this.stamp(this.options.context());
    this.collision = undefined;
    this.pendingStart = undefined;
    this.message = 'Kept this draft as New. Add creates a separate instruction; the existing instructions stay unchanged.';
    this.error = false;
    this.refresh();
    this.focusText();
  }

  private target(location: Location, id: string, values: MarkingFields): MarkingTarget {
    const project = this.options.session.project;
    const partDependencies = Array.isArray(values.recipients) ? values.recipients.map(partId => {
      const part = project.parts.find(item => item.id === partId);
      return { id: partId, staffIds: part ? [...part.staffIds].sort() : null };
    }) : values.recipients;
    return {
      documentId: project.id, id, label: labelFor(location), values,
      context: { staffId: location.staff.id, measureId: location.measure.id,
        meter: location.measure.meter.display, pickup: location.measure.pickup,
        kind: id.startsWith(editPrefix) ? location.annotation?.kind : null,
        matching: this.newSeeds.get(id)?.guardMatches ? this.matching(location, this.newSeeds.get(id)!.matchingValues) : null },
      dependencies: { recipients: partDependencies },
    };
  }

  private newTarget(context: Pick<MarkingsContext, 'staff' | 'measure' | 'event' | 'annotation'>,
    chord = false, at?: string, forceSeed = false, guardMatches = false): MarkingTarget {
    const id = `${newPrefix}${context.measure.id}`;
    const values: MarkingFields = { ...structuredClone(this.recipe), text: '',
      kind: chord ? 'harmony' : this.recipe.kind,
      at: at ?? formatRational(context.event?.onset ?? context.annotation?.onset ?? rational(0)) };
    const seed = { documentId: this.options.session.project.id, staffId: context.staff.id, measureId: context.measure.id,
      values, guardMatches, matchingValues: structuredClone(values) };
    if (forceSeed || !this.hasDirty || !this.newSeeds.has(id)) this.newSeeds.set(id, seed);
    return this.target(context, id, values);
  }

  private selectedTarget(context: MarkingsContext): MarkingTarget {
    if (context.annotation) return this.target(context, `${editPrefix}${context.annotation.id}`, annotationValues(context.annotation, this.options.session.project));
    return this.newTarget(context);
  }

  private readTarget(id: string): MarkingTarget | null {
    if (id.startsWith(newPrefix)) {
      const seed = this.newSeeds.get(id);
      if (!seed || seed.documentId !== this.options.session.project.id) return null;
      const location = this.location(seed.measureId);
      if (!location || location.staff.id !== seed.staffId) return null;
      return this.target(location, id, structuredClone(seed.values));
    }
    if (!id.startsWith(editPrefix)) return null;
    const location = this.location(id.slice(editPrefix.length));
    return location?.annotation
      ? this.target(location, id, annotationValues(location.annotation, this.options.session.project)) : null;
  }

  private boundLocation(): Location | undefined {
    const snapshot = this.store.snapshot('markings');
    if (snapshot.documentId !== this.options.session.project.id) return undefined;
    const id = snapshot.targetId;
    return id ? this.location(id.slice(id.startsWith(newPrefix) ? newPrefix.length : editPrefix.length)) : undefined;
  }

  private notifyDraft(): void {
    if (this.lastDirtyCount === this.dirtyCount) return;
    this.lastDirtyCount = this.dirtyCount;
    this.options.onDraftChange?.();
  }

  private feedback(message: string, error = false): void {
    this.message = message;
    this.error = error;
    this.render();
  }

  private focusText(): void {
    focusInTools(this.el(this.collision ? 'annotation-select' : 'annotation-text'));
  }

  private startNew(chord: boolean, open: boolean): void {
    if (this.disposed) return;
    if (open) this.options.openTools();
    if (this.hasDirty) {
      if (!chord && !open && this.collision) { this.keepDraftAsNew(); return; }
      this.pendingStart = { chord };
      this.feedback('Your unapplied instruction stays with its original target. Choose Discard/start here before starting a new instruction.', true);
      this.focusText();
      return;
    }
    const context = this.options.context();
    const current = this.store.snapshot('markings').values;
    if (current) this.recipe = { ...structuredClone(current), text: '', at: '0' };
    const target = this.newTarget(context, chord, undefined, true);
    this.explicitTarget = target;
    this.selectionStamp = this.stamp(context);
    this.collision = undefined;
    this.pendingStart = undefined;
    this.message = '';
    this.error = false;
    this.store.discard('markings', target);
    this.refresh();
    this.focusText();
  }

  private discard(): void {
    const context = this.options.context();
    const target = this.pendingStart ? this.newTarget(context, this.pendingStart.chord, undefined, true)
      : context.annotation ? this.selectedTarget(context) : this.newTarget(context, false, undefined, true);
    this.pendingStart = undefined;
    this.recipientIntent = undefined;
    this.explicitTarget = target;
    this.selectionStamp = this.stamp(context);
    this.collision = undefined;
    this.message = '';
    this.error = false;
    this.store.discard('markings', target);
    this.refresh();
    this.focusText();
  }

  private patch(patch: Partial<MarkingFields>): void {
    if (this.collision && Object.keys(patch).some(key => key !== 'recipients')) { this.feedback(this.collision.message, true); return; }
    this.store.patch('markings', patch);
    if (patch.recipients !== undefined) this.captureRecipients(patch.recipients);
    const snapshot = this.store.snapshot('markings');
    const seed = snapshot.targetId ? this.newSeeds.get(snapshot.targetId) : undefined;
    if (seed?.guardMatches && snapshot.values) seed.matchingValues = structuredClone(snapshot.values);
    this.message = '';
    this.error = false;
    this.refresh();
  }

  private bind(): void {
    for (const [name, id] of Object.entries(fieldIds) as [keyof typeof fieldIds, string][]) {
      this.on(id, name === 'text' || name === 'at' || name === 'bpm' ? 'input' : 'change', () => {
        this.patch({ [name]: this.value(id) });
      });
    }
    this.on('annotation-scope', 'change', () => this.patch({ recipients: this.readRecipients() }));
    this.on('annotation-part-scopes', 'change', () => this.patch({ recipients: this.readRecipients() }));
    this.on('annotation-select', 'change', () => {
      const id = this.value('annotation-select');
      if (id === this.chooserPlaceholder) return;
      if (id) this.editAnnotation(id); else this.startNew(false, false);
    });
    this.on('add-chord-symbol', 'click', () => this.startChordSymbol());
    this.on('new-annotation', 'click', () => this.startNew(false, false));
    this.on('discard-annotation-draft', 'click', () => this.discard());
    this.on('return-annotation-draft', 'click', () => this.returnToTarget());
    this.on('review-annotation-draft', 'click', () => this.review());
    this.on('annotation-at-start', 'click', () => this.patch({ at: '0' }));
    this.on('annotation-at-selection', 'click', () => {
      const context = this.options.context();
      const bound = this.boundLocation();
      if (!context.event || !bound || context.staff.id !== bound.staff.id || context.measure.id !== bound.measure.id) {
        throw new Error('Select a note in this instruction’s staff and bar to capture its current position.');
      }
      this.patch({ at: formatRational(context.event.onset) });
      this.feedback('Captured this note’s current exact position. The instruction will not follow future note movement.');
    });
    this.on('add-annotation', 'click', () => this.commit(false, false));
    this.on('add-annotation-next', 'click', () => this.commit(false, true));
    this.on('update-annotation', 'click', () => this.commit(true, false));
    this.on('update-annotation-next', 'click', () => this.commit(true, true));
    this.on('remove-annotation', 'click', () => this.remove());
  }

  private readRecipients(): Recipients {
    const mode = this.value('annotation-scope');
    return mode === 'parts'
      ? [...this.el('annotation-part-scopes').querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value).sort()
      : mode === 'all' ? 'all' : 'staff';
  }

  private partDependencies(ids: readonly string[]): PartDependency[] {
    const project = this.options.session.project;
    return [...ids].sort().map(id => {
      const part = project.parts.find(item => item.id === id);
      return { id, label: part ? partLabel(part, project.parts) : id, staffIds: part ? [...part.staffIds].sort() : null };
    });
  }

  /** A chosen part is an intent, even while the accepted/empty form still says “staff only”. */
  private captureRecipients(recipients: Recipients): void {
    const snapshot = this.store.snapshot('markings');
    if (!Array.isArray(recipients) || !snapshot.documentId || !snapshot.targetId) { this.recipientIntent = undefined; return; }
    const previous = this.recipientIntent?.documentId === snapshot.documentId && this.recipientIntent.targetId === snapshot.targetId
      ? this.recipientIntent : undefined;
    const parts = new Map(this.partDependencies(recipients).map(part => [part.id, previous?.parts.get(part.id) ?? part]));
    this.recipientIntent = { documentId: snapshot.documentId, targetId: snapshot.targetId, parts };
  }

  private recipientConflict() {
    const intent = this.recipientIntent;
    const snapshot = this.store.snapshot('markings');
    const recipients = snapshot.values?.recipients;
    if (!intent || !snapshot.dirty || snapshot.targetId !== intent.targetId || snapshot.documentId !== intent.documentId
      || snapshot.documentId !== this.options.session.project.id || !Array.isArray(recipients)) return undefined;
    const current = this.partDependencies(recipients);
    const changed = current.filter(part => intent.parts.has(part.id)
      && JSON.stringify(intent.parts.get(part.id)!.staffIds) !== JSON.stringify(part.staffIds));
    if (!changed.length) return undefined;
    const staves = this.options.session.score.staves;
    const missing = changed.some(part => part.staffIds === null);
    const details = changed.map(part => part.staffIds === null ? `${intent.parts.get(part.id)!.label} no longer exists`
      : `${part.label} now includes ${part.staffIds.map(id => staves.find(staff => staff.id === id)?.label || id).join(', ')}`);
    return {
      signature: JSON.stringify(current.map(({ id, staffIds }) => ({ id, staffIds }))), missing,
      message: `Chosen recipients changed: ${details.join('; ')}. ${missing
        ? 'Choose available recipients before applying; your text is kept.'
        : 'Review the current recipients before applying; your typed fields are kept.'}`,
    };
  }

  private acceptCurrentRecipients(): void {
    if (!this.recipientIntent) return;
    const recipients = this.store.snapshot('markings').values?.recipients;
    if (Array.isArray(recipients)) this.recipientIntent.parts = new Map(this.partDependencies(recipients).map(part => [part.id, part]));
  }

  private draftContext() {
    return { documentId: this.options.session.project.id, revision: this.options.session.revision,
      read: (id: string) => this.readTarget(id) };
  }

  private assertWritable(): void {
    if (this.options.context().mode !== 'write') throw new Error('Return to Write to apply an instruction. The draft is kept.');
    if (this.options.session.project.pendingSource !== null) {
      throw new Error('Apply or Revert the Source draft before changing accepted music. This instruction draft is kept.');
    }
  }

  private input(values: MarkingFields, accepted: Annotation | undefined, dirty: readonly (keyof MarkingFields)[]): AnnotationInput {
    const value: AnnotationInput = {
      kind: values.kind, text: accepted && !dirty.includes('text') ? accepted.text : values.text.trim(),
      at: formatRational(fraction(values.at)), placement: values.placement,
    };
    if (values.kind === 'tempo') {
      if (values.bpm.trim()) value.bpm = Number(values.bpm);
      // An omitted beat/dots declaration stays omitted when only prose or scope changed.
      const existingTempo = accepted?.kind === 'tempo';
      if (!existingTempo || dirty.includes('beat') || accepted.beat !== undefined) value.beat = values.beat;
      if (!existingTempo || dirty.includes('dots') || accepted.dots !== undefined) value.dots = Number(values.dots);
    }
    return value;
  }

  private validateRecipients(recipients: Recipients): void {
    if (!Array.isArray(recipients)) return;
    if (!recipients.length) throw new Error('Choose at least one part, or choose This staff only.');
    const available = new Set(this.options.session.project.parts.map(part => part.id));
    if (recipients.some(id => !available.has(id))) {
      throw new Error('A chosen part no longer exists. Choose the instruction’s recipients explicitly before applying.');
    }
  }

  private commit(update: boolean, next: boolean): void {
    this.assertWritable();
    const resolution = this.store.resolve('markings', this.draftContext());
    this.refreshCollision();
    const recipientConflict = this.recipientConflict();
    if (recipientConflict) { this.feedback(recipientConflict.message, true); return; }
    if (this.collision) { this.feedback(this.collision.message, true); return; }
    if (!resolution.ok) { this.feedback(resolution.message, true); return; }
    const location = this.boundLocation();
    if (!location || update !== !!location.annotation) throw new Error(update
      ? 'Choose an existing instruction to edit, or use Add for a new instruction.'
      : 'Choose New instruction before adding. Add never overwrites an existing instruction.');
    const values = resolution.values;
    this.validateRecipients(values.recipients);
    const value = this.input(values, location.annotation, resolution.dirtyFields);
    const unchanged = !!location.annotation && (!resolution.changed
      || sameWrittenValue(values, annotationValues(location.annotation, this.options.session.project)));
    const session = this.options.session;
    const focused = this.scope.activeElement as HTMLElement | null;
    const origin = { staffId: location.staff.id, measureId: location.measure.id };
    let acceptedId = location.annotation?.id;
    this.ownAction = true;
    try {
      if (session.revision !== resolution.revision || session.project.id !== resolution.documentId) {
        throw new Error('The document changed before this instruction could be applied. Review the current draft.');
      }
      if (!unchanged) {
        const fields = resolution.dirtyFields.filter((name): name is keyof AnnotationInput => name !== 'recipients');
        const result = session.execute(update
          ? { type: 'update-annotation', annotationId: location.annotation!.id, value, fields }
          : { type: 'add-annotation', measureId: location.measure.id, value }, (project, result) => {
          const id = result.selectionId;
          if (!id) throw new Error('The instruction transaction did not return its source identity.');
          if (values.recipients === 'staff') delete project.instructionScopes[id];
          else project.instructionScopes[id] = values.recipients === 'all' ? 'all' : [...values.recipients];
        });
        acceptedId = result.selectionId;
      }
      if (!acceptedId) throw new Error('The instruction was not accepted. The draft is kept.');
      const accepted = this.readTarget(`${editPrefix}${acceptedId}`);
      if (!accepted) throw new Error('The accepted instruction could not be located.');
      // Creation changes a temporary measure target into the new stable annotation ID.
      this.store.discard('markings', accepted);
      this.recipientIntent = undefined;
      this.explicitTarget = accepted;
      this.recipe = { ...structuredClone(accepted.values), text: '', at: '0' };
      this.collision = undefined;
      this.pendingStart = undefined;
      this.message = unchanged ? 'No changes to apply.' : `Saved ${kinds[values.kind]}.`;
      this.error = false;
      if (next) this.advance(origin.staffId, origin.measureId);
      else this.selectionStamp = this.stamp(this.options.context());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.fail('markings', message);
      this.message = message;
      this.error = true;
    } finally { this.ownAction = false; }
    this.refresh();
    if (!this.error && (next || focused?.hidden)) this.focusText();
    if (!this.error) this.options.report?.(this.message);
  }

  private advance(staffId: string, measureId: string): void {
    const staff = this.options.session.score.staves.find(item => item.id === staffId);
    const index = staff?.measures.findIndex(measure => measure.id === measureId) ?? -1;
    const measure = index >= 0 ? staff?.measures[index + 1] : undefined;
    if (!staff || !measure) {
      this.message += ' This is the last existing bar; no measure was added.';
      this.selectionStamp = this.stamp(this.options.context());
      return;
    }
    this.options.select(measure.id);
    const target = this.newTarget({ staff, measure }, false, '0', true, true);
    const candidates = measure.annotations.filter(annotation => annotation.kind === this.recipe.kind
      && compare(annotation.onset, rational(0)) === 0 && annotation.placement === this.recipe.placement);
    const project = this.options.session.project;
    if (candidates.length === 1 && sameRecipients(scopeValue(project.instructionScopes[candidates[0].id]), this.recipe.recipients)) {
      const annotation = candidates[0];
      this.options.select(annotation.id);
      const existing = this.target({ staff, measure, annotation }, `${editPrefix}${annotation.id}`, annotationValues(annotation, project));
      this.store.discard('markings', existing);
      this.explicitTarget = existing;
      this.message = `Editing existing ${kinds[annotation.kind]} in bar ${measure.number}. Apply & next bar keeps this source identity.`;
    } else {
      this.store.discard('markings', target);
      this.explicitTarget = target;
      if (candidates.length) {
        this.collision = { targetId: target.id,
          message: `Bar ${measure.number} already has ${candidates.length === 1 ? 'an instruction for different recipients' : 'several matching instructions'} here. Choose an existing instruction to edit, or choose New explicitly.` };
        this.message = this.collision.message;
      } else this.message = `New ${kinds[this.recipe.kind]} · bar ${measure.number}, position 0.`;
    }
    this.selectionStamp = this.stamp(this.options.context());
  }

  private remove(): void {
    this.assertWritable();
    if (this.hasDirty) throw new Error('Apply or discard this instruction draft before removing its accepted instruction.');
    const resolution = this.store.resolve('markings', this.draftContext());
    if (!resolution.ok) { this.feedback(resolution.message, true); return; }
    const location = this.boundLocation();
    if (!location?.annotation) throw new Error('Choose an existing instruction before removing it.');
    this.ownAction = true;
    try {
      this.options.session.execute({ type: 'remove-annotation', annotationId: location.annotation.id });
      const current = this.location(location.measure.id);
      if (!current) throw new Error('The instruction’s original bar is no longer available.');
      const target = this.newTarget(current, false, formatRational(location.annotation.onset), true);
      this.store.discard('markings', target);
      this.explicitTarget = target;
      this.selectionStamp = this.stamp(this.options.context());
      this.message = 'Removed the instruction. Undo restores it and its recipients.';
      this.error = false;
    } finally { this.ownAction = false; }
    this.refresh();
    this.focusText();
    this.options.report?.(this.message);
  }

  private returnToTarget(): void {
    const snapshot = this.store.snapshot('markings');
    if (snapshot.documentId !== this.options.session.project.id) {
      throw new Error('This draft belongs to another document. It cannot retarget an instruction with a reused ID.');
    }
    const location = this.boundLocation();
    if (!location) throw new Error('This draft’s original target is no longer available.');
    this.options.select(location.annotation?.id ?? location.measure.id);
    this.refresh();
  }

  private review(): void {
    const before = this.store.snapshot('markings');
    if (before.status !== 'conflict' && !this.recipientConflict()) return;
    const latest = this.store.resolve('markings', this.draftContext());
    const recipients = this.recipientConflict();
    if ((!latest.ok && JSON.stringify(latest.conflicts) !== this.reviewedConflictSignature)
      || (recipients && recipients.signature !== this.visibleRecipientSignature)) {
      this.feedback('Accepted changes have moved again. Review the updated values below before keeping your draft.', true);
      return;
    }
    if (recipients?.missing) { this.feedback(recipients.message, true); return; }
    const result = this.store.review('markings', this.draftContext());
    if (result.status === 'missing' || result.status === 'document-changed') { this.feedback(result.message, true); return; }
    this.acceptCurrentRecipients();
    this.feedback('Current accepted changes reviewed. Your unapplied fields are kept; Apply will validate them against the current music.');
    this.notifyDraft();
  }

  private conflictSummary(conflicts: readonly DraftConflict<MarkingFields>[], location: Location | undefined): string {
    const changes = new Set<string>();
    for (const item of conflicts) {
      if (item.reason === 'value') {
        const current = Array.isArray(item.current) ? item.current.join(', ') : String(item.current ?? '');
        changes.add(`${fieldNames[item.field]} is now “${current.slice(0, 100)}”`);
      } else if (item.reason === 'context') {
        const before = item.base as Record<string, unknown> | undefined;
        const after = item.current as Record<string, unknown> | undefined;
        if (before?.meter !== after?.meter) changes.add(`meter is now ${String(after?.meter)}`);
        if (before?.pickup !== after?.pickup) changes.add(after?.pickup ? 'this bar is now a pickup' : 'this bar is no longer a pickup');
        if (before?.kind !== after?.kind) changes.add(`kind is now ${kinds[after?.kind as AnnotationInput['kind']] ?? String(after?.kind)}`);
        if (before?.staffId !== after?.staffId || before?.measureId !== after?.measureId) {
          changes.add(`the instruction now belongs to ${location ? labelFor(location) : 'a different musical location'}`);
        }
        if (JSON.stringify(before?.matching) !== JSON.stringify(after?.matching)) {
          changes.add('instructions at this position changed; choose an existing instruction or explicitly keep this draft as New');
        }
      } else if (item.field === 'recipients') {
        changes.add('a chosen part’s staff membership changed; check the current recipients');
      }
    }
    return changes.size ? ` Accepted ${[...changes].join('; ')}. Your typed values remain in the fields.` : '';
  }

  private renderOptions(location: Location | undefined, id: string | null): void {
    const select = this.el<HTMLSelectElement>('annotation-select');
    const annotations = location?.measure.annotations ?? [];
    const project = this.options.session.project;
    let placeholder = chooseValue;
    while (annotations.some(annotation => annotation.id === placeholder)) placeholder += '_';
    this.chooserPlaceholder = placeholder;
    const instructions = annotations.map(annotation => ({ value: annotation.id,
      label: `${kinds[annotation.kind]} · ${annotation.text || annotation.bpm} · at ${formatRational(annotation.onset)}`
        + ` · ${annotation.placement === 'above' ? 'Above' : 'Below'} staff`
        + ` · ${recipientLabel(project.instructionScopes[annotation.id], project, location?.staff)}`,
      disabled: false }));
    const labelCounts = new Map<string, number>();
    for (const instruction of instructions) labelCounts.set(instruction.label, (labelCounts.get(instruction.label) ?? 0) + 1);
    // Identical printed instructions still have separate authored identities.
    // Expose those IDs only when the complete musical descriptions collide.
    for (const instruction of instructions) {
      if (labelCounts.get(instruction.label)! > 1) instruction.label += ` · ID: ${instruction.value}`;
    }
    const options = [
      ...(this.collision ? [{ value: placeholder, label: 'Choose an instruction or New…', disabled: true }] : []),
      { value: '', label: 'New instruction', disabled: false },
      ...instructions,
    ];
    const selected = this.collision ? placeholder : id?.startsWith(editPrefix) ? id.slice(editPrefix.length) : '';
    if (selected && selected !== placeholder && !options.some(option => option.value === selected)) {
      options.push({ value: selected, label: 'Original instruction unavailable', disabled: true });
    }
    renderNativeOptions(select, options, selected);
    enhanceSelects(select);
  }

  private renderRecipients(values: MarkingFields): void {
    this.setValue('annotation-scope', Array.isArray(values.recipients) ? 'parts' : values.recipients);
    const checks = this.el('annotation-part-scopes');
    const selected = Array.isArray(values.recipients) ? values.recipients : [];
    const project = this.options.session.project;
    const parts = project.parts.map(part => ({ id: part.id, label: partLabel(part, project.parts), missing: false }));
    for (const id of selected) if (!parts.some(part => part.id === id)) parts.push({ id, label: `Missing part (${id})`, missing: true });
    const inputs = renderNativeCheckboxes(checks, parts.map(part => ({ value: part.id, label: part.label })));
    for (const [index, input] of inputs.entries()) {
      input.dataset.missingPart = String(parts[index].missing);
      input.checked = selected.includes(input.value);
    }
    checks.hidden = !Array.isArray(values.recipients);
  }

  private render(): void {
    if (this.disposed) return;
    const focused = this.scope.activeElement as HTMLElement | null;
    const snapshot = this.store.snapshot('markings');
    const values = snapshot.values;
    const location = this.boundLocation();
    const context = this.options.context();
    const recipientConflict = this.recipientConflict();
    const unavailable = snapshot.status === 'missing' || snapshot.status === 'document-changed' || snapshot.status === 'unbound';
    const formConflict = snapshot.status === 'conflict';
    const conflict = formConflict || !!recipientConflict;
    const pendingSource = this.options.session.project.pendingSource !== null;
    const canWrite = context.mode === 'write' && !pendingSource;
    const ready = canWrite && !unavailable && !conflict && !this.collision;
    const editing = snapshot.targetId?.startsWith(editPrefix) ?? false;
    this.renderOptions(location, snapshot.targetId);
    if (values) {
      for (const [name, id] of Object.entries(fieldIds) as [keyof typeof fieldIds, string][]) this.setValue(id, values[name]);
      this.renderRecipients(values);
    }
    const targetLabel = this.scope.getElementById('annotation-draft-target');
    const heading = values ? `${editing ? 'Edit' : 'New'} ${kinds[values.kind]} · ${snapshot.label} · at ${values.at || '0'}` : 'Select a staff and bar.';
    if (targetLabel) targetLabel.textContent = heading;
    const tempo = values?.kind === 'tempo';
    const tempoFields = this.scope.getElementById('annotation-tempo-fields');
    if (tempoFields) tempoFields.hidden = !tempo;
    for (const id of ['annotation-bpm', 'annotation-beat', 'annotation-dots']) {
      const label = this.el(id).closest('label');
      if (label) label.hidden = !tempo;
    }
    for (const id of Object.values(fieldIds)) {
      this.el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).disabled = unavailable || !!this.collision;
    }
    // Recipient recovery must remain possible even when a New-vs-existing choice is pending.
    this.el<HTMLSelectElement>('annotation-scope').disabled = unavailable;
    for (const input of this.el('annotation-part-scopes').querySelectorAll<HTMLInputElement>('input')) input.disabled = unavailable;
    for (const [id, visible] of [
      ['add-annotation', !editing], ['add-annotation-next', !editing],
      ['update-annotation', editing], ['update-annotation-next', editing], ['remove-annotation', editing],
    ] as const) {
      const button = this.scope.getElementById(id) as HTMLButtonElement | null;
      if (!button) continue;
      button.hidden = !visible;
      button.disabled = !ready || (id === 'remove-annotation' && snapshot.dirty);
    }
    const atSelection = this.scope.getElementById('annotation-at-selection') as HTMLButtonElement | null;
    if (atSelection) atSelection.disabled = unavailable || !!this.collision || !context.event
      || !location || location.measure.id !== context.measure.id || location.staff.id !== context.staff.id;
    const atStart = this.scope.getElementById('annotation-at-start') as HTMLButtonElement | null;
    if (atStart) atStart.disabled = unavailable || !!this.collision;
    const returnButton = this.scope.getElementById('return-annotation-draft') as HTMLButtonElement | null;
    if (returnButton) {
      returnButton.hidden = !snapshot.dirty || snapshot.matchesSelection;
      returnButton.disabled = unavailable;
    }
    const discardButton = this.scope.getElementById('discard-annotation-draft') as HTMLButtonElement | null;
    if (discardButton) discardButton.hidden = !snapshot.dirty && !unavailable && !this.pendingStart;
    const reviewButton = this.scope.getElementById('review-annotation-draft') as HTMLButtonElement | null;
    if (reviewButton) {
      reviewButton.hidden = !(recipientConflict && !recipientConflict.missing)
        && (!formConflict || (!!this.collision && !this.hasOtherConflict(snapshot.conflicts)));
      reviewButton.disabled = unavailable || !!recipientConflict?.missing;
    }
    const newButton = this.scope.getElementById('new-annotation');
    if (newButton) {
      setControlLabel(newButton, this.collision && snapshot.dirty ? 'Keep draft as New' : 'New instruction');
      newButton.hidden = !editing && !this.collision;
    }
    let message = unavailable || formConflict ? snapshot.message
      : recipientConflict ? recipientConflict.message
      : pendingSource ? 'Apply or Revert the Source draft before changing accepted music. You can inspect and keep this draft.'
        : context.mode !== 'write' ? 'Return to Write to apply this instruction. The draft is kept.'
          : this.message || snapshot.error || (snapshot.dirty ? 'Unapplied instruction draft · not saved in recovery or downloaded projects.' : '');
    if (formConflict) message += this.conflictSummary(snapshot.conflicts, location);
    if (formConflict && recipientConflict) message += ` ${recipientConflict.message}`;
    this.reviewedConflictSignature = formConflict ? JSON.stringify(snapshot.conflicts) : '';
    this.visibleRecipientSignature = recipientConflict?.signature ?? '';
    this.visibleCollisionSignature = this.collision ? JSON.stringify(this.guardedMatches()?.matches ?? []) : '';
    if (snapshot.dirty && !snapshot.matchesSelection && !unavailable) message += ' This draft still belongs to its named original target.';
    const status = this.el('annotation-draft-status');
    const statusText = targetLabel ? message : `${heading}. ${message}`;
    // Do not re-announce the same unapplied-draft notice on every keystroke.
    if (status.textContent !== statusText) status.textContent = statusText;
    const alert = unavailable || conflict || this.error;
    status.setAttribute('role', alert ? 'alert' : 'status');
    status.setAttribute('aria-live', alert ? 'assertive' : 'polite');
    status.dataset.draftState = recipientConflict ? 'conflict' : snapshot.status;
    const panel = this.el('annotation-inspector');
    panel.dataset.annotationTarget = snapshot.targetId ?? '';
    panel.dataset.annotationState = this.collision ? 'choose' : recipientConflict ? 'conflict' : snapshot.status;
    panel.dataset.annotationMode = editing ? 'edit' : 'new';
    // Only the current and selected temporary targets are needed in this session.
    for (const id of this.newSeeds.keys()) if (id !== snapshot.targetId && id !== this.explicitTarget?.id) this.newSeeds.delete(id);
    if (focused && panel.contains(focused) && !panel.closest('[hidden], [inert]')
      && (focused.hidden || focused.matches(':disabled') || focused.closest('label[hidden]'))) {
      const apply = this.scope.getElementById(editing ? 'update-annotation' : 'add-annotation') as HTMLButtonElement | null;
      const text = this.el<HTMLTextAreaElement>('annotation-text');
      const chooser = this.el<HTMLSelectElement>('annotation-select');
      if (focused.id === 'review-annotation-draft' && apply && !apply.hidden && !apply.disabled) focusInTools(apply);
      else if (!text.disabled) focusInTools(text);
      else focusInTools(chooser);
    }
  }
}
