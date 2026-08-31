import { Signal } from 'signal-polyfill';
import { batch } from 'signal-utils/subtle/batched-effect';
import { readScore } from '../dom/read-score.js';
import type { Diagnostic, Score } from '../model/types.js';
import { applyCommand } from './commands.js';
import {
  copyProjectNotices, copySourceContext, getSourceHtml, MAX_SOURCE_LENGTH, normalizeProject, parseSource,
} from './project.js';
import type { AuthorCommand, AuthorProject, Cursor, EditResult } from './types.js';
import { createSelection, pruneSelection, reduceSelection, selectionFingerprint } from './selection.js';
import type { SelectionContext, SelectionState } from './selection.js';
import { createEditorSignals, freezeEditorValue } from './state/editor-signals.js';
import type { EditorSignals } from './state/editor-signals.js';

export interface EditorChangeDetail {
  label: string;
  revision: number;
  selectionId: string | undefined;
  kind: 'edit' | 'draft' | 'replace' | 'history';
}

interface Snapshot {
  project: AuthorProject;
  selectionId: string | undefined;
  cursor: Cursor | undefined;
  selection: SelectionState;
  independentSelection: boolean;
}
interface Prepared { project: AuthorProject; source: Element }

/** One published value makes source, selection, revision, and history atomic. */
interface EditorState {
  readonly project: AuthorProject;
  readonly source: Element;
  /** Source snapshot represented by the cached score, independent of recovery drafts. */
  readonly parsedSourceHtml: string;
  readonly score: Score;
  readonly diagnostics: readonly Diagnostic[];
  readonly selectionId: string | undefined;
  readonly cursor: Cursor | undefined;
  readonly documentEpoch: number;
  readonly selection: SelectionState;
  readonly independentSelection: boolean;
  readonly revision: number;
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
}

interface HistoryState {
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
}

const HISTORY_LIMIT = 100;
const ROOT_LAYOUT_ATTRIBUTES = ['max-measures', 'justify-last', 'measure-numbers', 'print-width', 'print-preview'];
let systemSequence = 0;
let documentSequence = 0;

/** Every reader error blocks a transaction; warnings remain visible draft information. */
export class EditorValidationError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('\n'));
    this.name = 'EditorValidationError';
    this.diagnostics = diagnostics.map(diagnostic => ({ ...diagnostic }));
  }
}

function assertValid(source: Element): void {
  const errors = readScore(source).diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (errors.length) throw new EditorValidationError(errors);
}

function copyProject(project: AuthorProject): AuthorProject {
  const copy = structuredClone(project);
  copyProjectNotices(project, copy);
  return copy;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function comparableProject(project: AuthorProject): string {
  const { updatedAt: _updatedAt, ...content } = project;
  return stableJson(content);
}

/** Reviewing a turn must not invalidate itself; only fields affecting its music/page matter. */
function pageFingerprint(project: AuthorProject): string {
  return stableJson({
    metadata: project.metadata,
    parts: project.parts,
    columns: project.columns,
    instructionScopes: project.instructionScopes,
    layouts: Object.fromEntries(Object.entries(project.layouts).map(([id, layout]) => {
      const { reviewedTurns: _reviewedTurns, ...settings } = layout;
      return [id, settings];
    })),
  });
}

function sourceElements(source: Element): Element[] {
  return [source, ...source.querySelectorAll('*')];
}

/** A cursor is a complete location, never an invitation to choose a nearby event. */
function resolveCursor(source: Element, cursor: Cursor | undefined): Cursor | undefined {
  if (!cursor || !Number.isInteger(cursor.voiceIndex) || cursor.voiceIndex < 0) return undefined;
  const staff = readScore(source).score.staves.find(item => item.id === cursor.staffId);
  const measure = staff?.measures.find(item => item.id === cursor.measureId);
  const voice = measure?.voices[cursor.voiceIndex];
  if (!staff || !measure || !voice) return undefined;
  if (cursor.eventId !== undefined && !voice.events.some(event => event.id === cursor.eventId)) return undefined;
  return {
    staffId: staff.id, measureId: measure.id, voiceIndex: cursor.voiceIndex,
    ...(cursor.eventId !== undefined ? { eventId: cursor.eventId } : {}),
  };
}

/** Known source selections can establish a cursor without replacing the selected ID. */
function cursorForSelection(source: Element, id: string | undefined, previous: Cursor | undefined): Cursor | undefined {
  if (!id) return undefined;
  const score = readScore(source).score;
  for (const staff of score.staves) {
    for (const measure of staff.measures) {
      for (const [voiceIndex, voice] of measure.voices.entries()) {
        const event = voice.events.find(item => item.id === id || item.markings?.some(marking => marking.id === id));
        if (event) return { staffId: staff.id, measureId: measure.id, voiceIndex, eventId: event.id };
        if (voice.id === id || voice.tuplets.some(tuplet => tuplet.id === id)) {
          return { staffId: staff.id, measureId: measure.id, voiceIndex };
        }
      }
      if (measure.id === id || measure.annotations.some(annotation => annotation.id === id)) {
        const voiceIndex = previous?.staffId === staff.id && measure.voices[previous.voiceIndex]
          ? previous.voiceIndex : 0;
        return { staffId: staff.id, measureId: measure.id, voiceIndex };
      }
    }
    if (staff.id === id) {
      const sameStaff = previous?.staffId === id ? resolveCursor(source, previous) : undefined;
      const measure = sameStaff ? staff.measures.find(item => item.id === sameStaff.measureId) : staff.measures[0];
      if (!measure) return undefined;
      return { staffId: staff.id, measureId: measure.id, voiceIndex: sameStaff?.voiceIndex ?? 0 };
    }
  }
  return undefined;
}

/** Source edits must not keep voice 2 by index after replacing/reordering its owner. */
function preserveCursor(before: Element, after: Element, cursor: Cursor | undefined): Cursor | undefined {
  const resolved = resolveCursor(after, cursor);
  if (!resolved) return undefined;
  const previous = readScore(before);
  const next = readScore(after);
  const voiceOwner = (value: ReturnType<typeof readScore>): Element | undefined => {
    const voice = value.score.staves.find(staff => staff.id === resolved.staffId)?.measures
      .find(measure => measure.id === resolved.measureId)?.voices[resolved.voiceIndex];
    return voice ? value.sources.get(voice.id) : undefined;
  };
  const oldOwner = voiceOwner(previous);
  const newOwner = voiceOwner(next);
  if (!oldOwner || !newOwner || !sameElementKind(oldOwner, newOwner) || oldOwner.id !== newOwner.id) return undefined;
  return resolved;
}

/** Generated implicit-voice IDs are not stable across detached parsing. Compare their authored owners. */
function selectionOwner(parsed: ReturnType<typeof readScore>, id: string, allowEventKindChange: boolean): string | undefined {
  const node = parsed.sources.get(id);
  if (!node) return undefined;
  for (const staff of parsed.score.staves) for (const measure of staff.measures) {
    for (const [voiceIndex, voice] of measure.voices.entries()) {
      const event = voice.events.find(event => event.id === id);
      if (!event) continue;
      const owner = parsed.sources.get(voice.id);
      if (!owner) return undefined;
      return JSON.stringify([allowEventKindChange ? 'event' : node.localName, node.namespaceURI,
        staff.id, measure.id, voiceIndex, owner.localName, owner.id]);
    }
  }
  const staff = node.closest('music-staff');
  const measure = node.closest('music-measure');
  const voice = node.closest('music-voice');
  return JSON.stringify([node.localName, node.namespaceURI, staff?.id, measure?.id, voice?.id]);
}

function sameSelection(a: SelectionState, b: SelectionState): boolean {
  return selectionFingerprint({ ...a, version: 0 }) === selectionFingerprint({ ...b, version: 0 });
}

/** A second staff needs a system, without renaming the original staff or its music. */
function promoteStaff(staff: Element): Element {
  const system = staff.ownerDocument.createElement('music-system');
  const sourceIds = new Set(readScore(staff).sources.keys());
  do { system.id = `music-edit-system-${++systemSequence}`; } while (sourceIds.has(system.id));
  copySourceContext(staff, system);
  for (const name of ['label', 'aria-label', 'aria-description', 'title', 'lang', 'dir']) {
    const value = staff.getAttribute(name);
    if (value !== null) system.setAttribute(name, value);
  }
  // Only the outer surface controls engraving layout. Musical context remains
  // on the original staff; add-staff resolves it into the new staff's measures.
  for (const name of ROOT_LAYOUT_ATTRIBUTES) {
    const value = staff.getAttribute(name);
    if (value === null) continue;
    system.setAttribute(name, value);
    staff.removeAttribute(name);
  }
  system.append(staff);
  return system;
}

function copyInstructionScopes(project: AuthorProject, result: EditResult): void {
  for (const [originalId, copiedId] of Object.entries(result.copiedIds ?? {})) {
    if (!Object.hasOwn(project.instructionScopes, originalId)) continue;
    const scope = project.instructionScopes[originalId];
    project.instructionScopes[copiedId] = scope === 'all' ? 'all' : [...scope];
  }
}

/** Only deliberate commands may clean references to source objects they actually remove. */
function cleanRemovedReferences(project: AuthorProject, before: Element, after: Element): void {
  const previousIds = new Set(sourceElements(before).map(element => element.id));
  const remainingIds = new Set(sourceElements(after).map(element => element.id));
  for (const id of Object.keys(project.instructionScopes)) {
    if (previousIds.has(id) && !remainingIds.has(id)) delete project.instructionScopes[id];
  }

  const removedColumns = project.columns.filter(column =>
    column.measureIds.length > 0 && column.measureIds.every(id => !remainingIds.has(id)));
  for (const layout of Object.values(project.layouts)) {
    for (const column of removedColumns) {
      delete layout.breaks[column.id];
      delete layout.keeps[column.id];
      delete layout.reviewedTurns[column.id];
    }
  }
  project.reviewedShortMeasures = project.reviewedShortMeasures.filter(id => remainingIds.has(id));
}

function sameElementKind(a: Element, b: Element): boolean {
  return a.localName === b.localName && a.namespaceURI === b.namespaceURI;
}

/**
 * Reconcile authored light DOM, never generated SVG or shadow roots. Keyed elements
 * survive attribute edits, reordering, and movement into/out of voices or tuplets.
 * Text and comments remain source nodes rather than being canonicalized from Score.
 */
function reconcileSource(current: Element, staged: Element): Element {
  const byId = new Map(sourceElements(current).filter(element => element.id)
    .map(element => [element.id, element] as const));
  const used = new Set<Node>();
  const parent = current.parentNode;
  const following = current.nextSibling;
  const keyedRoot = byId.get(staged.id);
  const root = sameElementKind(current, staged) ? current
    : keyedRoot && sameElementKind(keyedRoot, staged) ? keyedRoot : staged.cloneNode(false) as Element;
  if (root !== current) root.remove();
  used.add(root);

  function reconcile(target: Element, template: Element): void {
    for (const attribute of [...target.attributes]) {
      if (!template.hasAttributeNS(attribute.namespaceURI, attribute.localName)) {
        target.removeAttributeNS(attribute.namespaceURI, attribute.localName);
      }
    }
    for (const attribute of template.attributes) {
      if (target.getAttributeNS(attribute.namespaceURI, attribute.localName) !== attribute.value) {
        target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      }
    }

    const oldChildren = [...target.childNodes];
    const children = [...template.childNodes];
    for (let index = 0; index < children.length; index++) {
      const next = children[index];
      let child: Node | undefined;
      if (next.nodeType === 1) {
        const element = next as Element;
        const keyed = element.id ? byId.get(element.id) : undefined;
        if (keyed && !used.has(keyed) && sameElementKind(keyed, element)) child = keyed;
        if (!element.id) {
          child = oldChildren.find(candidate => candidate.nodeType === 1 && !used.has(candidate)
            && !(candidate as Element).id && sameElementKind(candidate as Element, element));
        }
      } else {
        child = oldChildren.find(candidate => candidate.nodeType === next.nodeType
          && !used.has(candidate) && candidate.nodeValue === next.nodeValue)
          ?? oldChildren.find(candidate => candidate.nodeType === next.nodeType && !used.has(candidate));
      }
      child ??= next.cloneNode(false);
      used.add(child);

      // Place a moved ancestor before reconciling its descendants, avoiding cycles
      // when a Source edit reverses the nesting order of existing containers.
      const position = target.childNodes[index] ?? null;
      if (child !== position) target.insertBefore(child, position);
      if (next.nodeType === 1) reconcile(child as Element, next as Element);
      else if (child.nodeValue !== next.nodeValue) child.nodeValue = next.nodeValue;
    }
    while (target.childNodes.length > children.length) target.lastChild!.remove();
  }

  reconcile(root, staged);
  if (root !== current && parent) {
    if (current.parentNode === parent) parent.replaceChild(root, current);
    else parent.insertBefore(root, following?.parentNode === parent ? following : null);
  }
  return root;
}

/**
 * The accepted musical DOM is the authority. Score and diagnostics are read-only
 * projections, and serialized HTML exists only in project/recovery/history snapshots.
 */
export class EditorSession extends EventTarget {
  private readonly state: Signal.State<EditorState>;
  readonly signals: EditorSignals;

  private get current(): EditorState { return this.state.get(); }

  constructor(project: AuthorProject) {
    super();
    const prepared = this.prepare(project);
    const documentEpoch = ++documentSequence;
    const parsed = readScore(prepared.source);
    this.state = new Signal.State(Object.freeze({
      project: freezeEditorValue(prepared.project), source: prepared.source, parsedSourceHtml: prepared.project.sourceHtml,
      score: freezeEditorValue(parsed.score), diagnostics: freezeEditorValue(parsed.diagnostics),
      selection: freezeEditorValue(createSelection(this.selectionContext(prepared.project, prepared.source, 'score', documentEpoch))),
      selectionId: undefined, cursor: undefined, documentEpoch, revision: 0,
      independentSelection: false, past: [], future: [],
    }));
    this.signals = createEditorSignals(() => this.state.get());
  }

  /** A detached, mutable snapshot; changing it cannot mutate this session. */
  get project(): AuthorProject {
    const project = copyProject(this.current.project);
    project.sourceHtml = getSourceHtml(this.current.source);
    return project;
  }

  /** Read access to accepted light DOM. Make changes through session transactions. */
  get source(): Element { return this.current.source; }
  // These compatibility reads intentionally inspect live DOM, including external
  // changes that stale-action guards must catch synchronously. Renderers use the
  // cached accepted projections in signals.score and signals.diagnostics.
  get score(): Score { return readScore(this.current.source).score; }
  get diagnostics(): readonly Diagnostic[] { return readScore(this.current.source).diagnostics; }
  get revision(): number { return this.current.revision; }
  get selectionId(): string | undefined { return this.current.selectionId; }
  get documentEpoch(): number { return this.current.documentEpoch; }
  get selectionVersion(): number { return this.current.selection.version; }
  /** The caller may inspect or copy membership, but cannot mutate the session through this object. */
  get selection(): SelectionState { return { ...this.current.selection, ids: [...this.current.selection.ids] }; }
  /** A detached location; changing the returned object cannot move this session. */
  get cursor(): Cursor | undefined { return this.current.cursor ? { ...this.current.cursor } : undefined; }
  get canUndo(): boolean { return this.current.past.length > 0; }
  get canRedo(): boolean { return this.current.future.length > 0; }

  /** Navigation only. Do not alter the selection, revision, history, or redo branch. */
  setCursor(cursor: Cursor): void {
    const resolved = resolveCursor(this.current.source, cursor);
    if (stableJson(resolved) === stableJson(this.current.cursor)) return;
    this.publish({ ...this.current, cursor: resolved });
  }

  /** Explicit inspection navigation. It never moves writing or emits a musical/save change. */
  setSelection(next: SelectionState): void {
    if (next.documentId !== this.current.project.id || next.documentEpoch !== this.current.documentEpoch) {
      throw new Error('This selection belongs to another document. Select the music again.');
    }
    if (!Number.isSafeInteger(next.version) || next.version < 0) throw new Error('This selection has an invalid version.');
    if (next.sourceId !== undefined && (typeof next.sourceId !== 'string' || !next.sourceId || /[\s\0]/.test(next.sourceId))) {
      throw new Error('The selected instruction or structure must have a complete, nonempty source ID.');
    }
    if (next.sourceId !== undefined && readScore(this.current.source).sources.get(next.sourceId)?.id !== next.sourceId) {
      throw new Error('Choose an authored source ID. An implicit voice uses its measure and voice index, not a generated model ID.');
    }
    if (next.partId !== 'score' && !this.current.project.parts.some(part => part.id === next.partId)) {
      throw new Error('This selection belongs to a part that is no longer available.');
    }
    if (!Array.isArray(next.ids) || next.sourceId !== undefined
      && (next.ids.length || next.primaryId !== undefined || next.anchorId !== undefined || next.focusId !== undefined)) {
      throw new Error('Select either complete events or one instruction or structure.');
    }
    const context = this.selectionContext(this.current.project, this.current.source, next.partId);
    const resolved = reduceSelection(createSelection(context), next.sourceId ? { type: 'source', id: next.sourceId }
      : { type: 'set', ids: next.ids, primaryId: next.primaryId, anchorId: next.anchorId, focusId: next.focusId }, context);
    if (resolved.reason) throw new Error(resolved.reason);
    if (next.staffId !== undefined && next.staffId !== resolved.state.staffId
      || next.voiceIndex !== undefined && next.voiceIndex !== resolved.state.voiceIndex) {
      throw new Error('This selection no longer belongs to its stated staff and voice.');
    }
    const changed = !sameSelection(this.current.selection, resolved.state);
    if (changed && next.version <= this.current.selection.version) {
      throw new Error('The selection changed. Select the music again before using this earlier selection.');
    }
    const selection = this.nextSelection(resolved.state);
    if (selection === this.current.selection && this.current.independentSelection) return;
    this.publish({ ...this.current, selection, selectionId: selection.primaryId ?? selection.sourceId, independentSelection: true });
  }

  /** Re-selecting the same source is still a no-op; report any new location with setCursor. */
  select(id?: string): void {
    const next = this.resolveSelection(id);
    if (next === this.current.selectionId) return;
    this.publish({ ...this.current, selectionId: next,
      cursor: cursorForSelection(this.current.source, next, this.current.cursor), independentSelection: false,
      selection: this.nextSelection(this.seedSelection(this.current.project, this.current.source, next, 'score')),
    }, 'Select', 'draft');
  }

  execute(command: AuthorCommand, amendProject?: (draft: AuthorProject, result: EditResult) => void): EditResult {
    const draft = this.project;
    let source = this.current.source.cloneNode(true) as Element;
    copySourceContext(this.current.source, source);
    if (command.type === 'add-staff' && source.localName === 'music-staff') source = promoteStaff(source);
    const result = applyCommand(source, command);
    cleanRemovedReferences(draft, this.current.source, source);
    copyInstructionScopes(draft, result);
    draft.sourceHtml = getSourceHtml(source);
    amendProject?.(draft, result);
    const prepared = this.prepare(draft, draft.sourceHtml === getSourceHtml(source) ? source : undefined);
    const advancesWriting = ['insert-event', 'append-and-insert', 'continue-piece', 'append-measure'].includes(command.type);
    const cursor = prepared.project.id !== this.current.project.id ? undefined
      : result.cursor !== undefined ? resolveCursor(prepared.source, result.cursor)
        : this.current.independentSelection && !advancesWriting ? preserveCursor(this.current.source, prepared.source, this.current.cursor)
        : result.selectionId !== undefined ? cursorForSelection(prepared.source, result.selectionId, this.current.cursor)
          : preserveCursor(this.current.source, prepared.source, this.current.cursor);
    let selection: SelectionState | undefined;
    if (this.current.independentSelection) {
      const previous = this.current.selection;
      const preserved = this.preserveSelection(prepared, true);
      // Creating a named structure deliberately inspects it without relocating writing.
      // Property/group commands, including wrap-tuplet, retain their exact event set.
      const inspectCreated = ['add-staff', 'add-voice', 'duplicate-measures', 'add-annotation'].includes(command.type);
      const lostSelection = (previous.ids.length > 0 || previous.sourceId !== undefined)
        && preserved.ids.length === 0 && preserved.sourceId === undefined;
      const useRemovalFallback = lostSelection && result.selectionId !== undefined
        && ['remove-event', 'remove-events', 'remove-annotation', 'remove-measure', 'unwrap-tuplet'].includes(command.type);
      selection = advancesWriting || inspectCreated || useRemovalFallback
        ? this.seedSelection(prepared.project, prepared.source, result.selectionId, previous.partId)
        : preserved;
    }
    this.accept(result.message, prepared, result.selectionId ?? this.current.selectionId, cursor, selection);
    return result;
  }

  update(label: string, mutate: (draft: AuthorProject) => void): void {
    const draft = this.project;
    mutate(draft);
    const prepared = this.prepare(draft);
    const cursor = prepared.project.id === this.current.project.id
      ? preserveCursor(this.current.source, prepared.source, this.current.cursor) : undefined;
    this.accept(label, prepared, this.current.selectionId, cursor, this.current.independentSelection ? this.preserveSelection(prepared) : undefined);
  }

  applySource(html: string): void {
    const draft = this.project;
    draft.sourceHtml = html;
    draft.pendingSource = null;
    const prepared = this.prepare(draft);
    this.accept('Apply source', prepared, this.current.selectionId,
      preserveCursor(this.current.source, prepared.source, this.current.cursor), this.current.independentSelection ? this.preserveSelection(prepared) : undefined);
  }

  /** Preserve unapplied text without adding an undo step for every keystroke. */
  setPendingSource(html: string | null): void {
    if (html === this.current.project.pendingSource) return;
    if (html !== null && typeof html !== 'string') throw new Error('The source draft must be text or null.');
    if (html !== null && html.length > MAX_SOURCE_LENGTH) {
      throw new Error(`The source draft cannot exceed ${MAX_SOURCE_LENGTH.toLocaleString()} characters.`);
    }
    if (html?.includes('\0')) throw new Error('The source draft cannot contain null characters.');
    const draft = this.project;
    draft.pendingSource = html;
    draft.updatedAt = Date.now();
    this.publish({ ...this.current, project: draft, future: [], revision: this.current.revision + 1 }, 'Edit source draft', 'draft');
  }

  undo(): void {
    const snapshot = this.current.past.at(-1);
    if (!snapshot) return;
    const prepared = this.prepare(copyProject(snapshot.project));
    this.restore('Undo', prepared, snapshot.selectionId, snapshot.cursor, 'history', snapshot.selection, snapshot.independentSelection,
      { past: this.current.past.slice(0, -1), future: this.push(this.current.future, this.snapshot()) });
  }

  redo(): void {
    const snapshot = this.current.future.at(-1);
    if (!snapshot) return;
    const prepared = this.prepare(copyProject(snapshot.project));
    this.restore('Redo', prepared, snapshot.selectionId, snapshot.cursor, 'history', snapshot.selection, snapshot.independentSelection,
      { past: this.push(this.current.past, this.snapshot()), future: this.current.future.slice(0, -1) });
  }

  replaceProject(project: AuthorProject): void {
    const prepared = this.prepare(project);
    this.restore('Open project', prepared, undefined, undefined, 'replace', undefined, false, { past: [], future: [] });
  }

  private prepare(project: AuthorProject, source?: Element): Prepared {
    const field = Object.getOwnPropertyDescriptor(project, 'sourceHtml');
    if (!field || !('value' in field)) throw new Error('Project sourceHtml must be an ordinary text field.');
    const staged = source ?? parseSource(field.value as string);
    assertValid(staged);
    const normalized = normalizeProject(project, staged);
    // Normalization assigns persistent IDs to newly imported source nodes. Parse
    // that safe, validated HTML without serializing a parallel Score model.
    const accepted = parseSource(normalized.sourceHtml);
    assertValid(accepted);
    return { project: normalized, source: accepted };
  }

  private accept(label: string, prepared: Prepared, selectionId: string | undefined, cursor: Cursor | undefined, selection?: SelectionState): void {
    const previous = this.project;
    const sourceChanged = getSourceHtml(prepared.source) !== getSourceHtml(this.current.source);
    if (sourceChanged) prepared.project.reviewedShortMeasures = [];
    if (sourceChanged || pageFingerprint(previous) !== pageFingerprint(prepared.project)) {
      for (const layout of Object.values(prepared.project.layouts)) layout.reviewedTurns = {};
    }

    if (comparableProject(previous) === comparableProject(prepared.project)) {
      const next = this.current.independentSelection && selection ? selection.primaryId ?? selection.sourceId : this.resolveSelection(selectionId);
      const selectionChanged = next !== this.current.selectionId;
      const notify = selectionChanged && !this.current.independentSelection;
      this.publish({ ...this.current, selectionId: next, cursor: resolveCursor(this.current.source, cursor),
        selection: this.nextSelection(selection ?? this.seedSelection(this.current.project, this.current.source, next, 'score')),
      }, notify ? 'Select' : undefined, notify ? 'draft' : undefined);
      return;
    }
    this.restore(label, prepared, selectionId, cursor, 'edit', selection, this.current.independentSelection,
      { past: this.push(this.current.past, { ...this.snapshot(), project: previous }), future: [] });
  }

  private restore(label: string, prepared: Prepared, selectionId: string | undefined,
    cursor: Cursor | undefined, kind: EditorChangeDetail['kind'], selection: SelectionState | undefined,
    independentSelection: boolean, history: HistoryState): void {
    const previous = this.current;
    const documentEpoch = kind === 'replace' || prepared.project.id !== previous.project.id
      ? ++documentSequence : previous.documentEpoch;
    const sourceUnchanged = prepared.project.sourceHtml === previous.parsedSourceHtml;
    const source = reconcileSource(previous.source, prepared.source);
    copySourceContext(prepared.source, source);
    const project = prepared.project;
    project.sourceHtml = getSourceHtml(source);
    project.updatedAt = Date.now();
    const resolvedId = this.resolveSelection(selectionId, source);
    const fresh = kind === 'history' || kind === 'replace';
    let resolvedSelection: SelectionState;
    if (selection) {
      const context = this.selectionContext(project, source, selection.partId, documentEpoch);
      const rebound = { ...selection, documentId: context.documentId, documentEpoch: context.documentEpoch };
      resolvedSelection = this.nextSelection(pruneSelection(rebound, context).state, fresh);
    } else resolvedSelection = this.nextSelection(this.seedSelection(project, source, resolvedId, 'score', documentEpoch), fresh);
    // Parse the reconciled DOM so implicit voice IDs belong to accepted source
    // nodes. Metadata, draft, and navigation changes reuse the same projection.
    const parsed = sourceUnchanged ? previous : readScore(source);
    this.publish({ project, source, parsedSourceHtml: project.sourceHtml, documentEpoch, revision: previous.revision + 1,
      score: parsed.score, diagnostics: parsed.diagnostics, selection: resolvedSelection,
      selectionId: independentSelection ? resolvedSelection.primaryId ?? resolvedSelection.sourceId : resolvedId,
      cursor: resolveCursor(source, cursor), independentSelection, ...history,
    }, label, kind);
  }

  private resolveSelection(id: string | undefined, source = this.current.source): string | undefined {
    if (!id) return undefined;
    const parsed = readScore(source);
    if (!parsed.sources.has(id)) return undefined;
    // Attached markings select their complete musical event. They are not a
    // separate rhythmic cursor or a measure-level annotation target.
    for (const staff of parsed.score.staves) for (const measure of staff.measures) {
      for (const voice of measure.voices) {
        const owner = voice.events.find(event => event.markings?.some(marking => marking.id === id));
        if (owner) return owner.id;
      }
    }
    return id;
  }

  private snapshot(): Snapshot {
    return { project: this.project, selectionId: this.current.selectionId, cursor: this.cursor,
      selection: this.selection, independentSelection: this.current.independentSelection };
  }

  private selectionContext(project: AuthorProject, source: Element, partId: string, documentEpoch = this.current.documentEpoch): SelectionContext {
    const score = readScore(source).score, part = project.parts.find(part => part.id === partId);
    return { score, documentId: project.id, documentEpoch,
      partId: partId === 'score' || part ? partId : 'score', visibleStaffIds: part?.staffIds ?? score.staves.map(staff => staff.id) };
  }

  private seedSelection(project: AuthorProject, source: Element, id: string | undefined, partId: string, documentEpoch = this.current.documentEpoch): SelectionState {
    const context = this.selectionContext(project, source, partId, documentEpoch), empty = createSelection(context);
    if (!id) return empty;
    const selected = reduceSelection(empty, { type: 'source', id }, context);
    return selected.reason ? empty : selected.state;
  }

  private preserveSelection(prepared: Prepared, allowEventKindChange = false): SelectionState {
    const state = this.current.selection;
    const context = this.selectionContext(prepared.project, prepared.source, state.partId);
    if (state.partId !== context.partId) return createSelection(context);
    const before = readScore(this.current.source), after = readScore(prepared.source);
    const allowedIds = new Set<string>();
    for (const id of [...state.ids, state.primaryId, state.anchorId, state.focusId, state.sourceId]) {
      if (!id) continue;
      const oldOwner = selectionOwner(before, id, allowEventKindChange);
      if (oldOwner !== undefined && oldOwner === selectionOwner(after, id, allowEventKindChange)) allowedIds.add(id);
    }
    return pruneSelection(state, context, { previousScore: before.score, allowedIds }).state;
  }

  private nextSelection(selection: SelectionState, fresh = false): SelectionState {
    const previous = this.current.selection;
    const changed = !sameSelection(previous, selection);
    return changed || fresh ? { ...selection, ids: [...selection.ids], version: previous.version + 1 } : previous;
  }

  private push(history: readonly Snapshot[], snapshot: Snapshot): readonly Snapshot[] {
    return [...history.slice(-(HISTORY_LIMIT - 1)), freezeEditorValue(snapshot)];
  }

  private publish(next: EditorState, label?: string, kind?: EditorChangeDetail['kind']): void {
    const previous = this.current;
    const cursor = stableJson(next.cursor) === stableJson(previous.cursor) ? previous.cursor : freezeEditorValue(next.cursor);
    const state = Object.freeze({ ...next, cursor,
      project: freezeEditorValue(next.project), score: freezeEditorValue(next.score),
      diagnostics: freezeEditorValue(next.diagnostics), selection: freezeEditorValue(next.selection),
      past: Object.freeze(next.past), future: Object.freeze(next.future),
    });
    if ((Object.keys(state) as (keyof EditorState)[]).every(key => state[key] === previous[key])) return;
    batch(() => {
      this.state.set(state);
      if (label && kind) this.dispatchEvent(new CustomEvent<EditorChangeDetail>('change', {
        detail: { label, revision: state.revision, selectionId: state.selectionId, kind },
      }));
    });
  }
}
