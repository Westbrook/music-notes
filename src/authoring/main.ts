import { phArrowDown, phArrowRight, phArrowUp, phMusicNotes } from '../ui/icons/phosphor.js';
import { bravuraNoteQuarterUp, bravuraNoteheadSlashHorizontalEnds, bravuraNoteheadSlashWhiteWhole, bravuraRestWholeLegerLine, bravuraRestQuarter } from '../ui/icons/bravura.js';
import { durationIcon } from '../ui/notation-icons.js';
import { setControlLabel, setControlIcon } from '../ui/control-content.js';
import '../components/index.js';
import './pages.css';
import { mountAuthorShell } from './ui/author-shell.js';
import type { ScoreViewport } from './ui/score-viewport.js';
import type { AuthorViewSwitch } from './ui/view-switch.js';
import { ControlScope } from './control-scope.js';
import { composedAncestors, composedContains } from '../ui/composed-dom.js';
import { AuthorViewState } from './state/view-state.js';
import { renderEventNavigator } from './ui/event-navigator.js';
import { renderNotationNotices } from './ui/notation-notices.js';
import { renderNativeOptions } from '../ui/native-options.js';
import { directionLabel, eventLabel, markingLabel } from './event-label.js';
import { MusicSurface } from '../components/music-surface.js';
import type { NotationSelectionDetail } from '../components/music-surface.js';
import { add, compare, formatRational, meterTime, parsePitch, pitchText, rational, subtract } from '../model/index.js';
import type { Annotation, Clef, Diagnostic, Duration, EventMarking, Measure, MusicEvent, PitchDirection, Staff, StaffNotation, Tuplet, Voice } from '../model/types.js';
import { serializeScore } from '../dom/index.js';
import { applyCommand } from './commands.js';
import { EditorSession } from './editor.js';
import { copyMusic, MUSIC_CLIPBOARD_TYPE } from './music-clipboard.js';
import { createProject, defaultLayout, getProjectNotices, importProject, serializeProject } from './project.js';
import { buildProjection } from './projection.js';
import { renderPageView, updatePagePreflight, setPagePreflightMessage } from './page-view.js';
import type { PageViewResult } from './page-view.js';
import { RecoveryStore } from './storage.js';
import { createTemplate } from './templates.js';
import type { TemplateId } from './templates.js';
import { enhanceSelects } from './select.js';
import { StaffInteraction } from './staff-interaction.js';
import type { NoteEditorState } from './note-editor.js';
import { SelectionControls } from './selection-controls.js';
import type { SelectionControlsState, SelectionPropertiesTarget } from './selection-controls.js';
import { reduceSelection, pruneSelection } from './selection.js';
import type { SelectionAction, SelectionContext } from './selection.js';
import { classifyAuthorInput, isNativeAuthorInput, isNativeSecondaryClick, selectionModifier } from './input-ownership.js';
import { WorkspaceTools } from './workspace-tools.js';
import { WritingFrame } from './writing-frame.js';
import type { WorkspaceTool } from './workspace-tools.js';
import { NativeSurfaces, isNativeSurfaceOpen } from './native-surfaces.js';
import { ActionConfirmation } from './action-confirmation.js';
import { confirmationReturnTarget } from './confirmation-focus.js';
import type { MusicSourceEditor, SourceValueDetail } from './ui/source-editor.js';
import { SelectedFileReader } from './selected-file-reader.js';
import { partLabel } from './part-label.js';
import { InspectorForms } from './inspector-forms.js';
import type { InspectorFormName, InspectorResolution } from './inspector-forms.js';
import { MarkingsEditor } from './markings-editor.js';
import { EventMarkingsEditor } from './event-markings-editor.js';
import { EventMarkingCompatibilityError } from './event-markings-commands.js';
import { EntryPitch } from './entry-pitch.js';
import type { MusicToggleButtonGroup } from '../ui/toggle-button-group.js';
import { ENTRY_ATTACK_OPTIONS, entryAttack, entryAttackAllowed, entryAttackOptions, entryDurationOptions } from './entry-palette.js';
import { ENTRY_KINDS as entryKinds, DEFAULT_ENTRY_KIND as defaultEntryKind } from './notation-capabilities.js';
import { createViewportAnchor } from './viewport-anchor.js';
import { createSelectionHud } from './selection-hud.js';
import type { SelectionHud, SelectionHudTarget } from './selection-hud.js';
import type { ListenController } from './listen-controller.js';
import { analyzeContinuation } from './continuation.js';
import type { AuthorCommand, AuthorProject, Cursor, EventInput, LayoutProfile, MeasureInput, ViewMode } from './types.js';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
interface Location { staff: Staff; measure: Measure; measureIndex: number; voice: Voice; voiceIndex: number; event?: MusicEvent; annotation?: Annotation; tuplet?: Tuplet }
export interface WorkspaceOptions {
  project?: AuthorProject; recovery?: RecoveryStore; print?: () => void;
  /** Kept off in production until the native placement gate is qualified. */
  contextualHud?: boolean;
}
type Insertion = Extract<AuthorCommand, { type: 'insert-event' }>;
interface EntryBookmark { documentId: string; cursor: Cursor; voiceId: string; partId: string }
interface ContinuationOffer { documentId: string; revision: number; selectionId: string | undefined; selectionFingerprint: string; command: Insertion; recipe: string; pointer: boolean }
interface ActiveMarking { documentId: string; partId: string; revision: number; eventId: string; marking: EventMarking }
interface MarkingRecovery { documentId: string; revision: number; partId: string; eventId: string; markingId: string; message: string }

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag); result.textContent = text; result.className = className; return result;
};
/** The application owns commands and project metadata; musical meaning remains in its source DOM. */
export class AuthorWorkspace {
  readonly session: EditorSession;
  private listen?: ListenController;
  private listenLoading?: Promise<void>;
  private playingIds: readonly string[] = [];
  private readonly viewState = new AuthorViewState();
  /** Observe workspace choices; transitions run through the workspace controls. */
  readonly view = this.viewState.snapshot;
  private readonly controls = new Map<string, HTMLElement>();
  private readonly controlScope: ControlScope;
  private readonly abort = new AbortController();
  private readonly recovery: RecoveryStore;
  private readonly printRequest: () => void;
  private readonly scoreMount: HTMLDivElement;
  private readonly overlays: HTMLDivElement;
  private readonly staffInteraction: StaffInteraction;
  private readonly selectionControls: SelectionControls;
  private readonly selectionHud: SelectionHud;
  private readonly contextualHud: boolean;
  private readonly tools: WorkspaceTools;
  private readonly writingFrame: WritingFrame;
  private readonly surfaces: NativeSurfaces;
  private readonly confirmation: ActionConfirmation;
  private readonly sourceEditor: MusicSourceEditor;
  private readonly fileReader: SelectedFileReader;
  private readonly inspectors: InspectorForms;
  private readonly markings: MarkingsEditor;
  private readonly eventMarkings: EventMarkingsEditor;
  private readonly entryPitch: EntryPitch;
  private entryPaletteKind?: string;
  private entryPaletteAlteration = '0';
  private readonly viewport: ReturnType<typeof createViewportAnchor>;
  private viewportRestore?: ReturnType<ReturnType<typeof createViewportAnchor>['capture']>;
  private sheetViewportRestore?: ReturnType<ReturnType<typeof createViewportAnchor>['capture']>;
  private deferredSheetReturn = false;
  private revealAfterRender = false;
  private bookmark?: EntryBookmark;
  private continuationOffer?: ContinuationOffer;
  private pointerOffer?: ContinuationOffer;
  // Session selection and the insertion cursor keep the event owner. A child
  // target belongs only to this workspace, never to music or undo history.
  private activeMarking?: ActiveMarking;
  private markingRecovery?: MarkingRecovery;
  private layoutTransition = false;
  private renderedProjectionKey = '';
  private scoreWidth = 0;
  private editingNote = false;
  private advancingWriting = false;
  private surface?: MusicSurface;
  private observedSurface?: MusicSurface;
  private surfaceScrollAbort?: AbortController;
  private notationNotices: readonly Diagnostic[] = [];
  private notationReviewContext?: { surface: MusicSurface; generation: number; documentId: string; sourceHtml: string; partId: string };
  private get mode(): ViewMode { return this.viewState.snapshot.get().mode; }
  private set mode(value: ViewMode) { this.viewState.update({ mode: value }); }
  private get partId(): string { return this.viewState.snapshot.get().partId; }
  private set partId(value: string) { this.viewState.update({ partId: value }); }
  private cursor!: Cursor;
  private get entryMode(): boolean { return this.viewState.snapshot.get().entryMode; }
  private set entryMode(value: boolean) { this.viewState.update({ entryMode: value }); }
  private get resumeWritingAfterView(): boolean { return this.viewState.snapshot.get().resumeWritingAfterView; }
  private set resumeWritingAfterView(value: boolean) { this.viewState.update({ resumeWritingAfterView: value }); }
  private get entryDragArmed(): boolean { return this.viewState.snapshot.get().entryDragArmed; }
  private set entryDragArmed(value: boolean) { this.viewState.update({ entryDragArmed: value }); }
  private blockedScorePress = false;
  private scorePressActive = false;
  private get pointerSummary(): string { return this.viewState.snapshot.get().pointerSummary; }
  private set pointerSummary(value: string) { this.viewState.update({ pointerSummary: value }); }
  private get writingStatus(): boolean { return this.viewState.snapshot.get().writingStatus; }
  private set writingStatus(value: boolean) { this.viewState.update({ writingStatus: value }); }
  private get selectMore(): boolean { return this.viewState.snapshot.get().selectMore; }
  private set selectMore(value: boolean) { this.viewState.update({ selectMore: value }); }
  private get pitchDragArmed(): boolean { return this.viewState.snapshot.get().pitchDragArmed; }
  private set pitchDragArmed(value: boolean) { this.viewState.update({ pitchDragArmed: value }); }
  /** The last deliberate inspection, never the incidental result of entry. */
  private get inspectionSelectionId(): string | null { return this.viewState.snapshot.get().inspectionSelectionId; }
  private set inspectionSelectionId(value: string | null) { this.viewState.update({ inspectionSelectionId: value }); }
  private get propertiesVisited(): boolean { return this.viewState.snapshot.get().propertiesVisited; }
  private set propertiesVisited(value: boolean) { this.viewState.update({ propertiesVisited: value }); }
  private get selectionError(): string | undefined { return this.viewState.snapshot.get().selectionError; }
  private set selectionError(value: string | undefined) { this.viewState.update({ selectionError: value }); }
  private lastNotationClick?: { id: string; documentEpoch: number; selectionVersion: number };
  private get rangeStart(): string { return this.viewState.snapshot.get().rangeStart; }
  private set rangeStart(value: string) { this.viewState.update({ rangeStart: value }); }
  private get rangeEnd(): string { return this.viewState.snapshot.get().rangeEnd; }
  private set rangeEnd(value: string) { this.viewState.update({ rangeEnd: value }); }
  private get readingWidth(): number | undefined { return this.viewState.snapshot.get().readingWidth; }
  private set readingWidth(value: number | undefined) { this.viewState.update({ readingWidth: value }); }
  private pageView?: PageViewResult;
  private pageViewRevision = -1;
  private pageViewGeneration = -1;
  private pageViewPartId = '';
  private renderGeneration = 0;
  private renderWork: Promise<void> = Promise.resolve();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private metadataTimer?: ReturnType<typeof setTimeout>;
  private metadataDirty = false;
  private saveWork: Promise<void> = Promise.resolve();
  private saveRequestedRevision = -1;
  private savedRevision = -1;
  private resizeObserver?: ResizeObserver;
  private recoveryBlocked = false;
  private recoveryWarning = '';
  private printPreparing = false;
  private disposed = false;

  constructor(options: WorkspaceOptions = {}) {
    const shell = mountAuthorShell();
    shell.viewState = this.viewState;
    this.controlScope = new ControlScope(shell);
    // Only explicitly owned UI roots participate in control discovery. The
    // score viewport's imported musical source remains outside this scope.
    for (const id of ['view-switch', 'event-navigator', 'source-editor', 'entry-kind', 'entry-accidentals', 'entry-duration', 'entry-dots', 'entry-attack', 'selection-accidentals', 'selection-quick-duration', 'selection-quick-dots', 'selection-quick-attack']) {
      const root = shell.querySelector<HTMLElement>(`#${id}`)?.shadowRoot;
      if (root) this.controlScope.register(root);
    }
    this.contextualHud = options.contextualHud ?? false;
    // Cache the application's controls before mounting any user-authored source.
    for (const element of this.controlScope.querySelectorAll<HTMLElement>('[id]')) this.controls.set(element.id, element);
    this.sourceEditor = this.el<MusicSourceEditor>('source-editor');
    this.sourceEditor.mount();
    this.sourceEditor.clearFailure();
    this.el('author-errors').hidden = true;
    this.el('author-errors').textContent = '';
    this.fileReader = new SelectedFileReader(this.el<HTMLInputElement>('project-file'));
    const workspace = new URL(location.href).searchParams.get('workspace') ?? 'default';
    const safeWorkspace = /^[a-zA-Z0-9-]{1,80}$/.test(workspace) ? workspace : 'default';
    this.recovery = options.recovery ?? new RecoveryStore({ key: `music-notes.author.recovery.v1:${safeWorkspace}` });
    this.printRequest = options.print ?? (() => window.print());
    const recovered = this.recovery.load();
    this.session = new EditorSession(options.project ?? (recovered.status === 'ok' ? recovered.project : createTemplate('blank')));
    if (!options.project && recovered.status === 'ok') this.savedRevision = this.session.revision;
    this.recoveryBlocked = recovered.status === 'invalid';
    if (recovered.status === 'invalid' || recovered.status === 'unavailable') this.recoveryWarning = recovered.message;
    this.el('save-status').textContent = recovered.status === 'ok' ? 'Recovered on this device'
      : recovered.status === 'empty' ? 'Local recovery · download a backup' : recovered.message;
    const viewport = this.el<ScoreViewport>('score-host');
    viewport.mount();
    this.scoreMount = viewport.scoreMount;
    this.overlays = viewport.overlayMount;
    const guard = document.getElementById('print-guard')
      ?? node('div', 'Prepare the composition in Pages and resolve publication checks before printing. Use Print / Save as PDF in the authoring workspace.');
    guard.id = 'print-guard'; document.body.append(guard);
    document.body.dataset.authorReady = 'false';
    document.body.dataset.authorPrintReady = 'false';
    for (const root of this.controlScope.roots) enhanceSelects(root);
    this.resetCursor();
    this.entryPitch = new EntryPitch({
      isEnabled: () => this.mode === 'write' && this.session.signals.pendingSource.get() === null
        && this.value('event-kind') === 'note' && (this.location().staff.notation ?? 'pitched') === 'pitched',
      changed: () => { this.syncEntryVisibility(); this.invalidateOffers(); },
    }, this.controlScope);
    this.staffInteraction = new StaffInteraction({
      flowingEntry: true,
      session: this.session, host: viewport, overlayMount: viewport.previewMount,
      getViewport: () => this.el('score-scroll'),
      getChromeBounds: () => {
        const bounds = viewport.getNativeControlBounds();
        const dock = this.el('workspace-dock');
        for (const ancestor of [dock, ...composedAncestors(dock)]) {
          const style = getComputedStyle(ancestor);
          if (ancestor.hasAttribute('hidden') || style.display === 'none'
            || style.visibility === 'hidden' || style.visibility === 'collapse') return bounds;
        }
        const dockBounds = dock.getBoundingClientRect();
        return dockBounds.width > 0 && dockBounds.height > 0 ? [...bounds, dockBounds] : bounds;
      },
      entryHandle: this.el('drag-entry'), pitchHandle: this.el('drag-pitch'), status: this.el('pointer-status'),
      state: () => ({ mode: this.mode, entryMode: this.entryMode, voiceIndex: this.cursor.voiceIndex,
        partId: this.partId, position: this.value('insert-position') as 'before' | 'after' | 'replace',
        surface: this.surface, ready: document.body.dataset.renderState === 'ready' }),
      selection: () => ({ fingerprint: this.selectionFingerprint(), eventIds: this.safeSelectedEvents(),
        selectMore: this.selectMore, activeMarkingId: this.currentMarking()?.marking.id }),
      canStartGesture: () => !this.isScoreInputBlocked() && !this.blockedScorePress,
      beforeSelectionGesture: () => { this.parkEntry(); this.syncEntryVisibility(); },
      readEntry: () => this.readEvent(),
      commit: command => {
        const documentEpoch = this.session.documentEpoch; const partId = this.partId;
        this.el('author-errors').hidden = true;
        this.execute(command);
        // A completed pitch gesture inspects its actual target, even on an
        // unchanged drop. Inspection must not move the parked writing cursor.
        if (command.type === 'set-note-pitch' && documentEpoch === this.session.documentEpoch && partId === this.partId) {
          const result = reduceSelection(this.session.selection, { type: 'replace', id: command.eventId }, this.selectionContext());
          if (!result.reason) this.session.setSelection(result.state);
        }
      },
      completed: (kind, pitch) => {
        this.rangeStart = ''; this.rangeEnd = '';
        if (kind !== 'insert') this.inspectionSelectionId = this.session.selectionId ?? null;
        this.syncPanels(false); this.drawSelection();
        if (kind === 'insert') { if (pitch !== undefined) this.setValue('event-pitch', pitch); this.rememberEntry(); }
        this.syncEntryVisibility();
        this.el('score-editor').focus({ preventScroll: true });
      },
      rejected: (command, error) => this.offerPointerContinuation(command, error),
      feedback: ({ message, kind }) => {
        document.body.dataset.pointerFeedback = kind === 'info' ? 'selection' : kind;
        this.pointerSummary = message;
        if (kind === 'notice') this.showError(message, true);
        else this.syncReviewNotice();
      },
      error: error => this.showError(error, true),
    });
    this.viewport = createViewportAnchor({
      getSurface: () => this.surface, getViewport: () => this.el('score-scroll'),
      getSelection: () => ({ sourceId: this.entryMode ? this.cursor.eventId ?? this.cursor.measureId
        : this.currentMarking()?.marking.id ?? this.session.selectionId ?? this.cursor.measureId,
        staffId: this.cursor.staffId, measureId: this.cursor.measureId, voiceIndex: this.cursor.voiceIndex }),
      getContextKey: () => `${this.session.signals.project.get().id}:${this.partId}:${this.mode}`,
    });
    this.surfaces = new NativeSurfaces({
      ids: ['document-menu', 'location-panel', 'entry-settings', 'entry-value-chooser', 'entry-direction-chooser', 'source-panel', 'score-setup', 'continuation-review', 'pointer-recovery', 'workspace-review'],
      positionedIds: ['document-menu', 'location-panel', 'entry-settings', 'entry-value-chooser', 'entry-direction-chooser'],
      fallbackFocus: () => this.el('score-editor'),
      beforeOpen: () => this.cancelForSurface(),
      afterClose: () => this.syncReviewNotice(),
    }, this.controlScope);
    this.writingFrame = new WritingFrame(this.el('author-workbench'));
    this.tools = new WorkspaceTools({
      initial: { open: false },
      beforeChange: transition => {
        this.cancelForSurface();
        if (transition.previous.presentation !== 'sheet' && transition.next.presentation === 'sheet') {
          this.sheetViewportRestore = this.viewport.capture();
        }
      },
      onOpen: () => this.syncEntryVisibility(),
      afterChange: (_state, transition) => {
        this.syncToolsPresentation(transition.next.presentation);
        const sheet = transition.next.presentation === 'sheet';
        const editor = this.el('score-editor');
        if (sheet) {
          if (composedContains(editor, this.controlScope.activeElement)) this.el('tools-expand').focus({ preventScroll: true });
        } else {
          if (transition.previous.presentation === 'sheet') {
            if (document.body.dataset.renderState === 'rendering') {
              // The task may have changed Source while its paper was hidden.
              // Retain the visible musical anchor until that engraving settles.
              this.viewportRestore = this.sheetViewportRestore;
              this.deferredSheetReturn = !!this.sheetViewportRestore;
            } else this.viewport.restore(this.sheetViewportRestore);
            this.sheetViewportRestore = undefined;
          }
        }
        this.selectionControls?.refresh();
        this.surfaces.refreshPositions();
        this.drawSelection();
      },
      onReturnToScore: () => { this.el('score-editor').focus({ preventScroll: true }); this.syncReturnControl(); },
      closeTransientPopovers: () => this.closeTransientSurfaces(),
    }, this.controlScope);
    this.syncToolsPresentation(this.tools.state.presentation);
    this.inspectors = new InspectorForms({
      session: this.session,
      context: () => ({ mode: this.mode, partId: this.partId, cursor: this.cursor, selectionId: this.session.selectionId,
        rangeEventIds: this.safeSelectedEvents(), inspectionSelectionId: this.inspectionSelectionId, entryMode: this.entryMode }),
      select: id => { this.parkEntry(); this.select(id, false); this.scrollToSelection(); },
      returnTarget: target => {
        this.parkEntry();
        if (target.context.partId) this.partId = target.context.partId;
        const id = target.context.sourceId ?? target.context.measureId ?? target.context.staffId;
        if (id) this.select(id, false);
        this.revealAfterRender = true; this.requestRender();
      },
      onDraftChange: () => this.syncDraftStatus(), report: message => this.status(message),
    }, this.controlScope);
    this.markings = new MarkingsEditor({
      session: this.session,
      context: () => ({ mode: this.mode, ...this.location() }),
      select: id => { this.rangeStart = ''; this.rangeEnd = ''; this.select(id, false); this.revealAfterRender = true; this.scrollToSelection(); this.el('score-editor').focus({ preventScroll: true }); },
      openTools: () => { this.surfaces.close('location-panel'); this.tools.open('markings', '#annotation-text', this.el('add-chord-symbol')); },
      onDraftChange: () => this.syncDraftStatus(), report: message => this.status(message),
    }, this.controlScope);
    this.eventMarkings = new EventMarkingsEditor({
      session: this.session,
      context: () => ({ mode: this.mode, selectionId: this.session.selectionId, rangeEventIds: this.safeSelectedEvents(),
        inspectionSelectionId: this.inspectionSelectionId, entryMode: this.entryMode }),
      select: id => { this.parkEntry(); this.select(id, false); this.revealAfterRender = true; this.scrollToSelection(); },
      openTools: () => { this.propertiesVisited = true; this.tools.open('edit', '#event-markings-draft-status'); },
      onDraftChange: () => this.syncDraftStatus(), report: message => this.status(message),
    }, this.controlScope);
    this.selectionControls = new SelectionControls({
      state: () => this.selectionControlsState(),
      execute: command => this.editNote(() => this.execute(command)),
      openProperties: target => this.showSelectionProperties(target),
      openRelationships: () => this.tools.open('rhythm', '#range-status'),
      openRange: () => this.tools.open('rhythm', '#range-start'),
      selectMore: enabled => this.setSelectMore(enabled),
      preparePitchDrag: () => this.preparePitchDrag(),
      cancelPitchDrag: () => this.finishPitchDrag(),
      resume: () => this.activateWriting(),
      report: message => this.status(message),
      error: message => this.showError(message, true),
      beforeSurfaceOpen: () => this.cancelForSurface(),
      afterSurfaceClose: () => this.syncReviewNotice(),
      success: () => {
        this.pointerSummary = '';
        this.selectionError = undefined; document.body.dataset.selectionFeedback = 'none';
        this.el('author-errors').hidden = true; this.syncReviewNotice();
      },
    }, this.controlScope);
    this.selectionHud = createSelectionHud({
      element: this.el('selection-controls'), getSurface: () => this.surface, getViewport: () => this.el('score-scroll'),
      getContext: () => {
        const target = this.contextualHud ? this.selectionHudTarget() : undefined;
        return { documentEpoch: this.session.documentEpoch, selectionVersion: this.session.selectionVersion,
          revision: this.session.revision, partId: this.partId, mode: this.mode,
          allowFloating: this.contextualHud && this.mode === 'write' && !this.entryMode && !this.selectMore && !this.pitchDragArmed
            && window.innerWidth >= 1100 && window.innerHeight > 480 && !!target
            && this.session.signals.pendingSource.get() === null && document.body.dataset.renderState === 'ready'
            && !document.body.dataset.pointerGesture,
          target,
        };
      },
      getObstacles: () => ['workspace-dock', 'workspace-tools'].flatMap(id => {
        const element = this.controls.get(id); if (!element || element.hidden) return [];
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 ? [{ x: box.left, y: box.top, width: box.width, height: box.height }] : [];
      }),
      isInteracting: () => this.selectionControls.interacting || !!document.body.dataset.pointerGesture,
      cancelInteraction: reason => {
        this.staffInteraction.cancel(reason);
        if (!this.selectionControls.cancel(reason)) return;
        const recovered = this.controlScope.activeElement;
        // Placement settles synchronously after this callback. Repair only a
        // just-closed chooser's focus, never a subsequently focused native field.
        queueMicrotask(() => {
          if (this.disposed || this.mode !== 'write') return;
          const active = this.controlScope.activeElement;
          if (active !== recovered && active !== document.body) return;
          let usable = active instanceof HTMLElement && active !== document.body && active.isConnected
            && !active.closest('[hidden], [inert], [aria-hidden="true"]') && !active.matches(':disabled');
          if (active instanceof HTMLElement) for (const ancestor of [active, ...composedAncestors(active)]) {
            if (!usable) break;
            const style = getComputedStyle(ancestor);
            usable = !ancestor.matches('[hidden], [inert], [aria-hidden="true"]')
              && style.display !== 'none' && style.visibility !== 'hidden';
          }
          if (!usable && !this.el('score-editor').hidden) this.el('score-editor').focus({ preventScroll: true });
        });
      },
    });
    this.confirmation = new ActionConfirmation({ dialogId: 'author-confirmation' }, this.controlScope);
    this.bind();
    this.session.addEventListener('change', (event) => this.changed(event as CustomEvent), { signal: this.abort.signal });
    this.resizeObserver = new ResizeObserver(() => {
      this.staffInteraction.cancel('resize'); this.syncPointerOffset(); this.drawSelection(); this.syncReturnControl();
      this.measureWritingFrame();
      const width = this.el('score-host').getBoundingClientRect().width;
      const changed = this.scoreWidth > 0 && Math.abs(width - this.scoreWidth) > 0.5;
      if (width > 0) this.scoreWidth = width;
      if (changed && !this.layoutTransition && this.mode === 'write') this.requestRender();
    });
    this.resizeObserver.observe(this.el('score-host'));
    this.resizeObserver.observe(this.el('workspace-dock'));
    this.resizeObserver.observe(this.el('author-workbench'));
    viewport.addEventListener('notation-viewport-change', () => {
      this.revealAfterRender = false; this.drawSelection(); this.syncReturnControl();
    }, { signal: this.abort.signal });
    this.el('score-scroll').addEventListener('scroll', () => {
      this.revealAfterRender = false; this.selectionHud.refresh(); this.syncReturnControl();
    }, { passive: true, signal: this.abort.signal });
    for (const type of ['wheel', 'touchstart', 'pointerdown']) this.el('score-scroll').addEventListener(type, () => {
      this.revealAfterRender = false;
      this.deferredSheetReturn = false; this.viewportRestore = undefined; this.sheetViewportRestore = undefined;
    }, { passive: true, capture: true, signal: this.abort.signal });
    window.addEventListener('resize', () => this.drawSelection(), { signal: this.abort.signal });
    window.addEventListener('scroll', () => this.selectionHud.refresh(), { passive: true, signal: this.abort.signal });
    for (const type of ['resize', 'scroll']) window.visualViewport?.addEventListener(type, () => {
      this.drawSelection(); this.syncReturnControl();
    }, { passive: true, signal: this.abort.signal });
    window.addEventListener('pagehide', () => { this.commitMetadata(); void this.saveNow(); }, { signal: this.abort.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.commitMetadata(); void this.saveNow(); }
    }, { signal: this.abort.signal });
    window.addEventListener('beforeunload', (event) => {
      if (this.metadataDirty || this.savedRevision !== this.session.revision || this.dirtyInspectorCount() > 0) { event.preventDefault(); event.returnValue = ''; }
    }, { signal: this.abort.signal });
    window.addEventListener('beforeprint', () => { this.refreshPreflight(); }, { signal: this.abort.signal });
    // A retained shell can be attached to a fresh workspace. Publish the new
    // session's Source and view before inspecting focus or rendering geometry.
    this.syncSourceNotice(true);
    this.setMode(this.mode);
    if (this.session.signals.score.get().staves.every(staff => staff.measures.every(measure => measure.voices.every(voice => !voice.events.length)))) {
      this.status('Choose Write notes, then click the staff.');
    }
    if (this.savedRevision !== this.session.revision) this.scheduleSave();
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.controls.get(id);
    if (!element) throw new Error(`Missing authoring control: ${id}`);
    return element as T;
  }
  private value(id: string): string { return this.el<Control>(id).value; }
  private setValue(id: string, value: string): void { this.el<Control>(id).value = value; }
  private checked(id: string): boolean { return this.el<HTMLInputElement>(id).checked; }
  private check(id: string, checked: boolean): void { this.el<HTMLInputElement>(id).checked = checked; }
  private numeric(id: string): number {
    const value = this.value(id).trim();
    if (!value || !Number.isFinite(Number(value))) throw new Error(`Enter a valid number for ${this.el<Control>(id).labels?.[0]?.textContent?.trim() ?? id}.`);
    return Number(value);
  }
  private measureWritingFrame(): void {
    const frame = this.writingFrame.measure();
    if (frame.measured) this.tools.setPanePlacement(frame.paneFits ? 'side' : 'sheet');
  }
  private syncToolsPresentation(presentation: 'closed' | 'side' | 'sheet'): void {
    this.el('author-workbench').setAttribute('tools-presentation', presentation);
    const editor = this.el('score-editor');
    editor.inert = presentation === 'sheet';
    if (presentation === 'sheet') editor.setAttribute('aria-hidden', 'true');
    else editor.removeAttribute('aria-hidden');
  }
  /** Native surfaces own input while open; merely inspecting a sidebar does not stop writing. */
  private isScoreInputBlocked(): boolean {
    return this.tools?.state.presentation === 'sheet' || this.surfaces?.hasOpenSurface() === true;
  }
  private cancelForSurface(): void {
    // Keep a blocked press blocked even if its light-dismissed surface closes
    // before the compatibility click. A fresh admitted press resets this latch.
    if (this.scorePressActive || document.body.dataset.pointerGesture) this.blockedScorePress = true;
    this.staffInteraction.cancel('surface');
  }
  private on(id: string, event: string, action: (event: Event) => void | Promise<void>): void {
    this.el(id).addEventListener(event, (e) => { void this.run(() => action(e)); }, { signal: this.abort.signal });
  }
  private async run(action: () => unknown | Promise<unknown>): Promise<void> {
    if (this.disposed) return;
    if (!this.selectionError) this.el('author-errors').hidden = true;
    try { await action(); } catch (error) {
      if (this.disposed) return;
      this.showError(error, this.mode === 'write' && [this.el('score-editor'), this.el('workspace-dock')]
        .some(region => composedContains(region, this.controlScope.activeElement)));
    }
    finally { if (!this.disposed) this.syncReviewNotice(); }
  }
  private showError(error: unknown, atSelection = false): void {
    this.markingRecovery = undefined;
    let message = messageOf(error);
    this.selectionError = atSelection ? message : undefined;
    document.body.dataset.selectionFeedback = atSelection ? 'rejected' : 'none';
    if (error instanceof EventMarkingCompatibilityError) {
      const place = this.location(error.eventId);
      const marking = place.event?.id === error.eventId ? place.event.markings?.find(item => item.id === error.markingId) : undefined;
      if (marking) {
        message = `${markingLabel(marking)} · ${this.staffName(place.staff.id)}, bar ${place.measure.number}, voice ${place.voiceIndex + 1}. ${message}`;
        this.markingRecovery = { documentId: this.session.signals.project.get().id, revision: this.session.revision,
          partId: this.partId, eventId: error.eventId, markingId: error.markingId, message };
      }
    }
    this.selectionError = atSelection ? message : undefined;
    if (atSelection) {
      this.el('pointer-status').textContent = message;
      document.body.dataset.pointerFeedback = 'notice';
    }
    this.el('author-errors').textContent = message;
    this.el('author-errors').hidden = false;
    this.syncReviewNotice();
  }
  private validMarkingRecovery(): MarkingRecovery | undefined {
    const recovery = this.markingRecovery;
    if (!recovery) return undefined;
    if (recovery.documentId !== this.session.signals.project.get().id || recovery.revision !== this.session.revision
      || recovery.partId !== this.partId || this.mode !== 'write' || this.session.signals.pendingSource.get() !== null) {
      this.markingRecovery = undefined; return undefined;
    }
    const place = this.location(recovery.eventId);
    if (place.event?.id !== recovery.eventId || !place.event.markings?.some(marking => marking.id === recovery.markingId)) {
      this.markingRecovery = undefined; return undefined;
    }
    return recovery;
  }
  private status(message: string, writingOnly = false): void {
    this.pointerSummary = ''; this.writingStatus = writingOnly;
    this.el('author-status').textContent = message; this.syncReviewNotice();
  }
  private setNotationNotices(diagnostics: readonly Diagnostic[]): void {
    const seen = new Set<string>();
    this.notationNotices = diagnostics.filter(item => {
      if (item.severity !== 'warning') return false;
      const key = JSON.stringify([item.code, item.sourceId, item.measureId, item.message]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const section = this.controls.get('notation-review');
    const list = this.controls.get('notation-review-list');
    if (section && list) {
      section.hidden = !this.notationNotices.length;
      renderNotationNotices(list, this.notationNotices);
      this.el('notation-review-heading').textContent = `${this.notationNotices.length} notation notice${this.notationNotices.length === 1 ? '' : 's'}`;
    }
    this.syncReviewNotice();
  }
  private collectNotationNotices(surface: MusicSurface): void {
    const context = this.notationReviewContext;
    if (!context || this.disposed || this.mode === 'pages' || surface !== this.surface || surface !== context.surface
      || !surface.isConnected || context.generation !== this.renderGeneration
      || context.documentId !== this.session.signals.project.get().id || context.sourceHtml !== this.session.signals.project.get().sourceHtml || context.partId !== this.partId) return;
    // Ordinary unfinished writing belongs in Review, not above the ink. Fatal
    // diagnostics retain the renderer's visible error panel and editing guard.
    this.setNotationNotices(surface.diagnostics);
  }
  private safeSelectedEvents(): string[] { try { return this.selectedEvents(); } catch { return []; } }
  private dirtyInspectorCount(): number { return (this.inspectors?.dirtyCount ?? 0) + (this.markings?.dirtyCount ?? 0) + (this.eventMarkings?.dirtyCount ?? 0); }
  private syncDraftStatus(): void {
    const count = this.dirtyInspectorCount();
    const status = this.controls.get('inspector-draft-status');
    if (status) { status.hidden = !count; status.textContent = `${count} unapplied ${count === 1 ? 'draft' : 'drafts'} · not saved`; }
    this.syncStructuralActions();
    this.syncReviewNotice();
  }
  private syncReviewNotice(): void {
    const trigger = this.controls.get('workspace-review-trigger');
    const summary = this.controls.get('workspace-review-summary');
    if (!trigger || !summary) return;
    if (this.el('author-errors').hidden && this.sourceEditor.failureMessage) {
      this.el('author-errors').textContent = this.sourceEditor.failureMessage;
      this.el('author-errors').hidden = false;
    }
    const pending = this.session.signals.pendingSource.get() !== null;
    const count = this.dirtyInspectorCount();
    const problem = !this.el('author-errors').hidden ? this.el('author-errors').textContent?.trim() ?? '' : '';
    const selectionProblem = !!this.selectionError && problem === this.selectionError;
    const source = this.el('source-draft-notice');
    source.hidden = !pending;
    source.textContent = pending ? 'Source unapplied · editing and printing paused.' : '';
    this.el('inspector-draft-status').hidden = !count || pending || !!problem;
    const drafts = count ? `${count} unsaved ${count === 1 ? 'form' : 'forms'}` : '';
    summary.hidden = selectionProblem && !(pending && count > 0) || !problem && !(pending && count > 0);
    summary.textContent = pending ? [problem ? 'Editing problem' : '', drafts].filter(Boolean).join(' · ')
      : [drafts, problem.split('\n')[0].slice(0, 100)].filter(Boolean).join(' · ');
    const feedback = this.controls.get('workspace-feedback-label');
    const localChooserError = [...this.controlScope.querySelectorAll<HTMLElement>('.selection-chooser [role="alert"]')].some(element => {
      const panel = element.closest<HTMLElement>('[popover], [data-popover-fallback="true"]');
      return !element.hidden && !element.closest('[hidden]') && !!element.textContent?.trim() && !!panel && isNativeSurfaceOpen(panel);
    });
    const recoveryDetail = this.controls.get('workspace-recovery-detail');
    const recoveryDownload = this.controls.get('review-download-project');
    const recoveryMessage = this.recoveryWarning;
    if (recoveryDetail) {
      recoveryDetail.textContent = recoveryMessage && !/download|backup/i.test(recoveryMessage) ? `${recoveryMessage} Download a project backup to keep your work.` : recoveryMessage;
      recoveryDetail.hidden = !recoveryMessage;
    }
    if (recoveryDownload) recoveryDownload.hidden = !recoveryMessage;
    const nextInsertion = this.entryMode && !this.el('entry-destination').hidden
      ? this.el('entry-destination').textContent?.trim() ?? '' : '';
    // The controller downgrades gesture feedback as soon as its preview ends.
    // Keep past refusals in Review while the current proposal names its target.
    const pointerPreview = document.body.dataset.pointerFeedback === 'gesture' ? this.pointerSummary : '';
    const fullFeedback = recoveryMessage ? `${pending ? 'Source unapplied · ' : ''}Local recovery unavailable · Download project from Review. ${recoveryMessage}`
      : pending ? 'Source unapplied · Apply or Revert to continue writing.'
      : pointerPreview || problem || (count ? `${count} unapplied ${count === 1 ? 'draft' : 'drafts'} · not saved`
        : nextInsertion || this.pointerSummary || (this.el('author-status').textContent?.trim() ?? ''));
    if (feedback) {
      // The actionable chooser announces its own failure once; Review retains
      // the full detail, while the stable header still shows a compact status.
      feedback.setAttribute('aria-live', localChooserError ? 'off' : 'polite');
      feedback.dataset.feedbackKind = recoveryMessage || pending ? 'warning' : pointerPreview ? 'gesture' : problem ? 'error'
        : count ? 'warning' : 'info';
      const compact = fullFeedback.split('\n')[0];
      const label = compact.length > 100 ? `${compact.slice(0, 97).trimEnd()}…` : compact;
      if (feedback.textContent !== label) feedback.textContent = label;
      feedback.title = fullFeedback;
      if (fullFeedback) feedback.setAttribute('aria-label', fullFeedback); else feedback.removeAttribute('aria-label');
      feedback.hidden = !fullFeedback;
      this.el('save-status').hidden = !!fullFeedback;
    }
    trigger.hidden = !pending && !count && !problem && !fullFeedback && !this.notationNotices.length;
    setControlLabel(trigger, problem ? 'Review error' : 'Review');
    const retainedReview = this.controls.get('selection-review-history');
    if (retainedReview) retainedReview.hidden = !selectionProblem;
    const localReview = this.controls.get('selection-review');
    if (localReview) localReview.hidden = true;
    this.el('review-source').hidden = !pending;
    this.el('review-drafts').hidden = !count;
    setControlLabel(this.el('review-drafts'), count ? `Review ${drafts}` : 'Review unsaved forms');
    const recovery = this.validMarkingRecovery();
    const recoveryButton = this.el<HTMLButtonElement>('review-incompatible-mark');
    recoveryButton.hidden = !recovery || problem !== recovery.message;
    recoveryButton.disabled = recoveryButton.hidden;
    if (recovery) {
      const place = this.location(recovery.eventId);
      const marking = place.event!.markings!.find(item => item.id === recovery.markingId)!;
      setControlLabel(recoveryButton, `Edit ${markingLabel(marking)} in bar ${place.measure.number}`);
    }
  }
  private requireWriting(): void {
    if (this.mode !== 'write') throw new Error('Return to Write to change music.');
    if (this.session.signals.pendingSource.get() !== null) throw new Error('Apply or Revert the Source draft before changing the accepted music.');
  }
  private async confirmAction(title: string, message: string, confirmLabel: string, destructive = true): Promise<boolean> {
    // Accept already typed metadata before taking the decision snapshot, so its
    // own debounce cannot invalidate the dialog while the musician reads it.
    this.commitMetadata();
    const documentId = this.session.signals.project.get().id;
    const revision = this.session.revision;
    const selectionId = this.session.selectionId;
    const cursor = JSON.stringify(this.cursor);
    const partId = this.partId;
    const mode = this.mode;
    const settings = this.confirmationSettings();
    const fileInput = this.el<HTMLInputElement>('project-file');
    const selectedFiles = [...(fileInput.files ?? [])];
    const returnFocus = confirmationReturnTarget(this.controlScope.activeElement, this.controlScope);
    const isCurrent = () => !this.disposed && this.session.signals.project.get().id === documentId && this.session.revision === revision
      && this.session.selectionId === selectionId && JSON.stringify(this.cursor) === cursor && this.partId === partId && this.mode === mode
      && this.confirmationSettings() === settings
      && selectedFiles.length === (fileInput.files?.length ?? 0)
      && selectedFiles.every((file, index) => fileInput.files?.[index] === file);
    this.staffInteraction.cancel('confirmation'); this.closeTransientSurfaces();
    const accepted = await this.confirmation.ask({ title, message, confirmLabel, destructive, isCurrent, returnFocus });
    return accepted && isCurrent();
  }
  private confirmationSettings(): string {
    const values: unknown[] = [this.selectionFingerprint(), this.selectMore, this.rangeStart, this.rangeEnd];
    for (const [id, control] of this.controls) {
      if (id === 'source-input' || control instanceof HTMLInputElement && control.type === 'file') continue;
      if (control instanceof HTMLInputElement) values.push([id, control.type === 'checkbox' ? control.checked : control.value]);
      else if (control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) values.push([id, control.value]);
    }
    values.push(this.checkedValues('part-staves'), this.checkedValues('annotation-part-scopes'));
    // Attached-mark rows are dynamic controls, outside the initial static-control cache.
    const marks = this.eventMarkings?.snapshot();
    values.push(marks ? [marks.documentId, marks.targetId, marks.values] : null);
    return JSON.stringify(values);
  }
  private closeTransientSurfaces(): void {
    this.surfaces?.closeAll();
    this.selectionControls?.close();
    const editor = this.controls.get('note-editor');
    if (editor && typeof editor.hidePopover === 'function' && editor.matches(':popover-open')) editor.hidePopover();
  }
  private rememberEntry(cursor = this.cursor, partId = this.partId): void {
    const staff = this.session.signals.score.get().staves.find(item => item.id === cursor.staffId);
    const voice = staff?.measures.find(item => item.id === cursor.measureId)?.voices[cursor.voiceIndex];
    if (!voice || cursor.eventId !== undefined && !voice.events.some(event => event.id === cursor.eventId)) return;
    this.bookmark = { documentId: this.session.signals.project.get().id, cursor: { ...cursor }, voiceId: voice.id, partId };
  }
  private parkEntry(): void {
    if (this.entryMode) this.rememberEntry();
    this.entryMode = false;
    if (this.writingStatus) { this.writingStatus = false; this.el('author-status').textContent = ''; }
  }
  private validBookmark(): EntryBookmark | undefined {
    const mark = this.bookmark;
    if (!mark || mark.documentId !== this.session.signals.project.get().id) return undefined;
    const staff = this.session.signals.score.get().staves.find(item => item.id === mark.cursor.staffId);
    const measure = staff?.measures.find(item => item.id === mark.cursor.measureId);
    const voice = measure?.voices[mark.cursor.voiceIndex];
    if (voice?.id !== mark.voiceId || (mark.cursor.eventId && !voice.events.some(item => item.id === mark.cursor.eventId))) return undefined;
    if (mark.partId !== 'score' && !this.session.project.parts.some(part => part.id === mark.partId && part.staffIds.includes(mark.cursor.staffId))) return undefined;
    return mark;
  }
  private entryLocationLabel(cursor: Cursor): string {
    const staff = this.session.signals.score.get().staves.find(item => item.id === cursor.staffId);
    const measure = staff?.measures.find(item => item.id === cursor.measureId);
    return `${this.staffName(cursor.staffId)}, bar ${measure?.number ?? '?'}, voice ${cursor.voiceIndex + 1}`;
  }
  private staffName(id: string): string {
    const staves = this.session.signals.score.get().staves;
    const index = staves.findIndex(staff => staff.id === id);
    const label = staves[index]?.label.trim();
    if (!label) return index >= 0 ? `Staff ${index + 1}` : 'Removed staff';
    return staves.filter(staff => staff.label.trim() === label).length > 1 ? `${label} (staff ${index + 1})` : label;
  }
  private entryDescription(value: EventInput): string {
    if (value.measureRest) return 'full-measure rest';
    const kind = value.kind === 'note' ? value.pitch : value.kind === 'chord' ? `chord ${value.pitches}`
      : value.kind === 'road' ? `3 roads note · ${directionLabel(value.pitchDirection ?? '')}`
        : value.kind === 'slash' ? value.rhythmic ? 'rhythmic slash' : 'open slash (improvised rhythm)'
          : value.kind === 'rhythm' ? 'rhythm note (no pitch)' : 'rest';
    return `${kind} · ${value.kind === 'slash' && !value.rhythmic ? 'nominal ' : ''}${value.duration}${value.dots ? ` · ${value.dots} ${value.dots === 1 ? 'dot' : 'dots'}` : ''}`;
  }
  private startEntry(resume: boolean): void {
    this.requireWriting();
    const mark = resume ? this.validBookmark() : undefined;
    if (resume && !mark) {
      // Keep the choice of a replacement destination explicit, but bring that
      // choice to the user instead of sending them back to a failing toggle.
      this.closeTransientSurfaces();
      this.status('The previous writing location is unavailable. Choose Start writing here to use the location shown, or choose another location.');
      this.surfaces.open('location-panel', 'start-entry-here');
      return;
    }
    this.closeTransientSurfaces(); this.staffInteraction.cancel('mode'); this.clearActiveMarking();
    this.selectMore = false; this.pitchDragArmed = false;
    document.body.dataset.selectionFeedback = 'none';
    // A short screen parks the pane visually, never its buffers or identity.
    if (this.tools.state.presentation === 'sheet') this.tools.hide(false);
    if (mark) {
      this.partId = mark.partId; this.cursor = { ...mark.cursor };
      this.session.setCursor(this.cursor);
    } else {
      const notation = this.location().staff.notation ?? 'pitched';
      const kind = this.value('event-kind');
      if (!entryKinds[notation].includes(kind)) {
        this.setValue('event-kind', defaultEntryKind[notation]);
        this.check('event-rhythmic', false);
        if (notation === 'three-roads') this.setValue('event-direction', 'same');
      }
    }
    this.session.setCursor(this.cursor);
    this.rangeStart = ''; this.rangeEnd = ''; this.entryMode = true; this.rememberEntry();
    this.syncPanels(false);
    const pointerEntry = !this.checked('event-measure-rest') && (this.value('event-kind') === 'rest'
      || this.value('event-kind') === 'note' && (this.location().staff.notation ?? 'pitched') === 'pitched');
    this.status(`${pointerEntry ? 'Click the staff or press Enter to write.' : 'Press Enter or choose Insert here to write.'} ${resume ? 'Resumed' : 'Writing at'} ${this.entryLocationLabel(this.cursor)}.`, true);
    this.revealAfterRender = true; this.requestRender(); this.el('score-editor').focus({ preventScroll: true });
  }
  private activateWriting(): void {
    if (this.mode !== 'write') return;
    if (this.entryMode) {
      this.closeTransientSurfaces();
      if (this.tools.state.presentation === 'sheet') this.tools.hide(false);
      this.el('score-editor').focus({ preventScroll: true });
      return;
    }
    this.startEntry(!!this.bookmark);
  }
  private chooseEntryKind(rest: boolean): void {
    const notation = this.location().staff.notation ?? 'pitched';
    this.staffInteraction.cancel('recipe');
    this.setValue('event-kind', rest ? 'rest' : defaultEntryKind[notation]);
    this.check('event-measure-rest', false);
    this.syncEntryVisibility(); this.invalidateOffers();
    this.status(rest ? 'Rest ready. Click the staff or press Enter to write it.'
      : notation === 'pitched' ? 'Note ready. Click the staff, type A–G or press Enter to write it.'
        : `${notation === 'rhythm' ? 'Rhythm note' : '3 roads note'} ready. Press Enter to write it.`, true);
  }
  private prepareEntryDrag(): void {
    if (!this.entryMode) this.activateWriting();
    if (!this.entryMode) return;
    this.requireWriting(); this.closeTransientSurfaces(); this.staffInteraction.cancel('mode');
    this.entryDragArmed = true; this.syncEntryVisibility();
    const handle = this.el<HTMLButtonElement>('drag-entry');
    if (handle.disabled) {
      this.entryDragArmed = false; this.syncEntryVisibility();
      throw new Error('Drag placement supports a single pitched note or an ordinary rest. Use Insert here for this entry.');
    }
    handle.focus({ preventScroll: true });
  }
  private finishEntryDrag(): void {
    this.staffInteraction.cancel('mode'); this.entryDragArmed = false; this.syncEntryVisibility();
    this.el('score-editor').focus({ preventScroll: true });
  }
  private moveWriting(direction: -1 | 1): void {
    this.requireWriting(); this.staffInteraction.cancel('navigation');
    const place = this.location(this.cursor.eventId ?? this.cursor.measureId);
    const index = place.voice.events.findIndex(event => event.id === this.cursor.eventId);
    // An omitted event reference is the displayed end-of-voice insertion
    // boundary, not a position before its first event.
    const nextIndex = index < 0 ? direction > 0 ? place.voice.events.length : place.voice.events.length - 1 : index + direction;
    const event = place.voice.events[nextIndex];
    if (event) this.cursor = { ...this.cursor, eventId: event.id };
    else {
      const measure = place.staff.measures[place.measureIndex + direction];
      if (!measure) { this.status(direction > 0 ? 'This is the last bar. Add a measure in Location to continue.' : 'This is the first bar.'); return; }
      const voice = measure.voices[this.cursor.voiceIndex];
      if (!voice) { this.status('The adjacent bar has no matching voice. Choose a destination in Location.'); return; }
      const target = direction > 0 ? voice.events[0] : voice.events.at(-1);
      this.cursor = { staffId: place.staff.id, measureId: measure.id, voiceIndex: this.cursor.voiceIndex,
        ...(target ? { eventId: target.id } : {}) };
    }
    this.session.setCursor(this.cursor); this.rememberEntry(); this.invalidateOffers();
    this.syncPanels(false); this.drawSelection(); this.scrollToSelection();
    this.status(`Writing at ${this.entryLocationLabel(this.cursor)} · ${this.value('insert-position')}.`, true);
  }
  private syncReturnControl(): void {
    const button = this.controls.get('return-to-selection');
    if (button) button.hidden = this.mode !== 'write' || !this.surface || this.viewport.isVisible();
  }
  private resetCursor(): void {
    this.clearActiveMarking();
    const staff = this.session.signals.score.get().staves[0];
    this.cursor = { staffId: staff.id, measureId: staff.measures[0].id, voiceIndex: 0 };
    this.rangeStart = ''; this.rangeEnd = ''; this.entryMode = false; this.bookmark = undefined;
    this.resumeWritingAfterView = false; this.entryDragArmed = false;
    this.sheetViewportRestore = undefined;
    this.deferredSheetReturn = false;
    this.selectMore = false; this.pitchDragArmed = false; this.inspectionSelectionId = null;
    this.propertiesVisited = false; this.lastNotationClick = undefined;
    this.session.setCursor(this.cursor);
    this.session.setSelection(reduceSelection(this.session.selection,
      { type: 'source', id: staff.measures[0].id }, this.selectionContext()).state);
  }

  private visibleStaves(): readonly Staff[] {
    const staves = this.session.signals.score.get().staves;
    const part = this.session.project.parts.find(part => part.id === this.partId);
    return part ? staves.filter(staff => part.staffIds.includes(staff.id)) : staves;
  }
  private anchorVisibleSelection(): void {
    const previous = this.location();
    const staves = this.visibleStaves();
    if (staves.some(staff => staff.id === previous.staff.id)) return;
    const staff = staves[0];
    const measure = staff.measures[Math.min(previous.measureIndex, staff.measures.length - 1)];
    this.cursor = { staffId: staff.id, measureId: measure.id, voiceIndex: 0 };
    this.rangeStart = ''; this.rangeEnd = '';
    this.session.setSelection(reduceSelection(this.session.selection, { type: 'source', id: measure.id }, this.selectionContext()).state);
    this.inspectionSelectionId = null;
  }

  private location(id = this.entryMode ? this.cursor?.eventId ?? this.cursor?.measureId
    : this.session.selectionId ?? (this.selectMore ? this.session.selection.focusId : undefined)): Location {
    const score = this.session.signals.score.get();
    for (const staff of score.staves) for (const [measureIndex, measure] of staff.measures.entries()) {
      for (const [voiceIndex, voice] of measure.voices.entries()) {
        const event = voice.events.find(item => item.id === id || item.markings?.some(marking => marking.id === id));
        const tuplet = voice.tuplets.find(item => item.id === id);
        if (event || tuplet || voice.id === id) return { staff, measure, measureIndex, voice, voiceIndex, event, tuplet };
      }
      const annotation = measure.annotations.find(item => item.id === id);
      if (measure.id === id || annotation) {
        const voiceIndex = Math.min(this.cursor?.voiceIndex ?? 0, measure.voices.length - 1);
        return { staff, measure, measureIndex, voiceIndex, voice: measure.voices[voiceIndex], annotation };
      }
    }
    const staff = score.staves.find(item => item.id === id)
      ?? score.staves.find(item => item.id === this.cursor?.staffId) ?? score.staves[0];
    const measureIndex = Math.max(0, staff.measures.findIndex(item => item.id === this.cursor?.measureId));
    const measure = staff.measures[measureIndex];
    const voiceIndex = Math.min(this.cursor?.voiceIndex ?? 0, measure.voices.length - 1);
    return { staff, measure, measureIndex, voiceIndex, voice: measure.voices[voiceIndex] };
  }
  private selectionContext(): SelectionContext {
    return { score: this.session.signals.score.get(), documentId: this.session.signals.project.get().id, documentEpoch: this.session.documentEpoch,
      partId: this.partId, visibleStaffIds: this.visibleStaves().map(staff => staff.id) };
  }
  private selectionFingerprint(): string {
    return `${this.session.documentEpoch}:${this.session.selectionVersion}:${this.partId}:${this.selectMore}:${this.currentMarking()?.marking.id ?? ''}`;
  }
  private syncRangeFields(): void {
    const state = this.session.selection;
    const ids = state.ids;
    const all = this.allVoiceEvents().map(item => item.event.id);
    const start = all.indexOf(ids[0]); const end = all.indexOf(ids.at(-1)!);
    const contiguous = ids.length > 1 && start >= 0 && end - start + 1 === ids.length
      && all.slice(start, end + 1).every((id, index) => id === ids[index]);
    // These fields describe membership, not the separate Shift anchor or the
    // keyboard's unselected focus. They must never imply an omitted member.
    this.rangeStart = contiguous ? ids[0] : '';
    this.rangeEnd = contiguous ? ids.at(-1)! : '';
  }
  private select(id: string, _populate = false, intent: 'replace' | 'toggle' | 'range' | 'focus' = 'replace'): boolean {
    this.parkEntry();
    this.staffInteraction.cancel('selection');
    this.viewport?.cancel(); this.viewportRestore = undefined; this.sheetViewportRestore = undefined;
    this.deferredSheetReturn = false; this.revealAfterRender = false;
    let location = this.location(id);
    if (intent !== 'replace' && (!location.event || !this.visibleStaves().some(staff => staff.id === location.staff.id))) {
      this.status('Select events in the same visible staff and voice. The selection has not changed.'); return false;
    }
    // Shared instructions keep one owner in source. Make that owner visible
    // before editing instead of silently targeting a staff outside this part.
    if (!this.visibleStaves().some(staff => staff.id === location.staff.id)) {
      if (this.mode === 'write') {
        this.partId = 'score'; this.pageView = undefined;
        this.check('ack-layout-warnings', false);
        this.status(`Showing the full score to edit the music on ${location.staff.label || 'its original staff'}.`);
        this.requestRender();
      } else {
        const staff = this.visibleStaves()[0];
        id = staff.measures[Math.min(location.measureIndex, staff.measures.length - 1)].id;
        location = this.location(id);
      }
    }
    const action: SelectionAction = location.event ? { type: intent, id: location.event.id } : { type: 'source', id };
    const result = reduceSelection(this.session.selection, action, this.selectionContext());
    if (result.reason) { this.status(result.reason); return false; }
    this.session.setSelection(result.state);
    // Deliberately selecting the same note is a retry, even when exact
    // membership and its version do not change. Keep the full Review detail.
    this.selectionControls.clearFeedback();
    document.body.dataset.selectionFeedback = 'none';
    const focused = this.location(result.state.primaryId ?? result.state.sourceId ?? result.state.focusId ?? id);
    this.cursor = { staffId: focused.staff.id, measureId: focused.measure.id, voiceIndex: focused.voiceIndex, eventId: focused.event?.id };
    if (this.mode === 'write' && intent !== 'focus') this.inspectionSelectionId = result.state.ids.length === 1 ? result.state.primaryId ?? null : null;
    if (intent === 'replace') this.selectMore = false;
    this.pitchDragArmed = false;
    const marking = intent === 'replace' ? location.event?.markings?.find(item => item.id === id) : undefined;
    this.activeMarking = marking ? { documentId: this.session.signals.project.get().id, partId: this.partId,
      revision: this.session.revision, eventId: location.event!.id, marking } : undefined;
    this.syncRangeFields(); this.syncPanels(false);
    this.drawSelection(); this.syncReturnControl(); this.invalidateOffers();
    return true;
  }
  private clearActiveMarking(): void {
    this.activeMarking = undefined;
    delete this.el('score-editor').dataset.activeMarkingId;
  }
  private currentMarking(): ActiveMarking | undefined {
    const active = this.activeMarking;
    if (!active) { delete this.el('score-editor').dataset.activeMarkingId; return undefined; }
    if (active.documentId !== this.session.signals.project.get().id || active.partId !== this.partId
      || active.eventId !== this.session.selectionId || this.entryMode || this.safeSelectedEvents().length !== 1) {
      this.clearActiveMarking(); return undefined;
    }
    if (active.revision !== this.session.revision) {
      const place = this.location(active.eventId);
      const marking = place.event?.id === active.eventId ? place.event.markings?.find(item => item.id === active.marking.id) : undefined;
      if (!marking || marking.kind !== active.marking.kind) { this.clearActiveMarking(); return undefined; }
      active.marking = marking; active.revision = this.session.revision;
    }
    this.el('score-editor').dataset.activeMarkingId = active.marking.id;
    return active;
  }
  private selectionHudTarget(): SelectionHudTarget | undefined {
    const place = this.location();
    const event = place.event;
    if (!event || !this.isSingleEventSelection(event.id)) return undefined;
    const measure = this.surface?.score?.staves.find(staff => staff.id === place.staff.id)
      ?.measures.find(item => item.id === place.measure.id);
    const voice = measure?.voices[place.voiceIndex];
    if (!voice?.events.some(item => item.id === event.id && item.kind === event.kind)) return undefined;
    // Implicit voices acquire fresh DOM identities in the projection. Resolve
    // their stable event and owner first; authored voice IDs must still agree.
    const authoredVoice = [...this.session.source.querySelectorAll('music-voice[id]')]
      .find(element => element.id === place.voice.id);
    if (authoredVoice && voice.id !== place.voice.id) return undefined;
    const scope = { staffId: place.staff.id, measureId: place.measure.id, voiceId: voice.id };
    const marking = this.currentMarking();
    return marking ? { kind: 'marking', sourceId: marking.marking.id, eventId: event.id, ...scope }
      : { kind: 'event', sourceId: event.id, eventKind: event.kind, ...scope };
  }
  private selectionTool(target?: SelectionPropertiesTarget): WorkspaceTool {
    if (target?.section === 'tools') return this.tools.state.generalTab;
    if (target?.section === 'selection' || target?.section === 'tuplet') return 'rhythm';
    if (target?.section === 'instruction') return 'markings';
    if (target) return 'edit';
    const place = this.location();
    const count = this.safeSelectedEvents().length;
    return count > 1 || place.tuplet ? 'rhythm' : count === 1 ? 'edit'
      : place.annotation ? 'markings' : this.tools.state.generalTab;
  }
  private showSelectionProperties(target?: SelectionPropertiesTarget): void {
    const destination = this.selectionTool(target);
    if (target?.toggle) {
      if (target.invokerId !== 'edit-selected-event') return;
      // More toggles the pane itself, including a pane holding another draft.
      // Closing must not retarget, discard, or first focus that draft.
      if (this.tools.isDestinationVisible(destination)) {
        this.tools.toggleDestination(destination, { invoker: this.el('edit-selected-event'), sameContext: true });
        return;
      }
    }
    if (target?.section === 'tools') { this.tools.showGeneral(undefined, this.el('edit-selected-event')); return; }
    if (target?.section === 'selection') { this.tools.open('rhythm', '#range-status', this.el('edit-selected-event')); return; }
    if (target?.section === 'instruction') { this.activateSelection(); return; }
    if (target?.section === 'tuplet') { this.tools.open('rhythm', '#tuplet-actual', this.el('edit-selected-event')); return; }
    if (target?.markingId || target?.section === 'markings') this.openAttachedMarks(target.markingId);
    else this.openAdvanced(target?.section === 'pitches' ? 'pitches'
      : target?.section === 'nominal-span' ? 'nominal-span' : 'properties');
  }
  private openAttachedMarks(markingId?: string): void {
    if (this.mode !== 'write') throw new Error('Return to Write to inspect this event.');
    this.parkEntry(); this.propertiesVisited = true;
    const place = this.location();
    if (!place.event || !this.isSingleEventSelection(place.event.id)) throw new Error('Select one event to edit its attached marks.');
    if (markingId && !place.event.markings?.some(marking => marking.id === markingId)) {
      throw new Error('That attached mark changed. Select it again before editing.');
    }
    this.inspectionSelectionId = place.event.id;
    this.eventMarkings.openFor(place.event.id, markingId);
  }
  private openAdvanced(target: 'pitches' | 'properties' | 'nominal-span'): void {
    if (this.mode !== 'write') throw new Error('Return to Write to inspect this event.');
    this.parkEntry(); this.propertiesVisited = true;
    const owner = this.location().event;
    if (owner && this.isSingleEventSelection(owner.id)) this.inspectionSelectionId = owner.id;
    this.inspectors.refresh(); this.eventMarkings.refresh(); this.syncEntryVisibility();
    const draft = this.inspectors.snapshot('selected');
    const ready = owner && draft.targetId === owner.id && draft.documentId === this.session.signals.project.get().id
      && draft.matchesSelection && !draft.blockedReason && draft.status !== 'conflict'
      && draft.status !== 'missing' && draft.status !== 'document-changed';
    const field = ready && target === 'nominal-span' ? this.el('selected-nominal-span').hidden ? '#selected-kind' : '#selected-duration'
      : ready && target === 'pitches' ? owner.kind === 'chord' ? '#selected-pitches' : '#selected-pitch'
      : !ready ? '#selected-draft-status' : undefined;
    if (ready && field) {
      const control = this.controls.get(field.slice(1));
      for (let disclosure = control?.closest('details'); disclosure; disclosure = disclosure.parentElement?.closest('details') ?? null) disclosure.open = true;
    }
    this.tools.open('edit', field, this.el('edit-selected-event'));
    if (!ready) this.status(this.session.signals.pendingSource.get() !== null
      ? 'Properties is read-only while Source has unapplied changes.'
      : `Review or discard the existing Properties draft for ${draft.label ?? 'its previous selection'} before editing these properties.`);
  }
  private options(id: string, options: readonly { value: string; label: string }[], selected: string): void {
    const select = this.el<HTMLSelectElement>(id);
    renderNativeOptions(select, options, selected);
    enhanceSelects(select.parentElement!);
  }

  private allVoiceEvents(): { event: MusicEvent; measure: Measure }[] {
    const { staff, voiceIndex } = this.location();
    return staff.measures.flatMap(measure => (measure.voices[voiceIndex]?.events ?? []).map(event => ({ event, measure })));
  }
  private selectedEvents(): string[] {
    const ids = this.session.selection.ids;
    if (!ids.length) throw new Error('Select an event, or choose both passage boundaries first.');
    return [...ids];
  }
  private isSingleEventSelection(id: string | undefined): boolean {
    try {
      const selected = this.selectedEvents();
      return !!id && selected.length === 1 && selected[0] === id;
    } catch { return false; }
  }
  private profile(): LayoutProfile { return this.session.project.layouts[this.partId] ?? defaultLayout(); }
  private syncPanels(_populateEvent: boolean): void {
    const project = this.session.project;
    if (this.partId !== 'score' && !project.parts.some(part => part.id === this.partId)) this.partId = 'score';
    this.session.setSelection(pruneSelection(this.session.selection, this.selectionContext()).state);
    this.anchorVisibleSelection();
    const location = this.location();
    this.cursor = { staffId: location.staff.id, measureId: location.measure.id, voiceIndex: location.voiceIndex, eventId: location.event?.id };
    if (this.entryMode) this.session.setCursor(this.cursor);
    this.currentMarking();
    for (const [id, value] of [['project-title', project.metadata.title], ['project-composer', project.metadata.composer], ['project-subtitle', project.metadata.subtitle]]) {
      if (!this.metadataDirty && this.value(id) !== value) this.setValue(id, value);
    }
    document.title = `${project.metadata.title || 'Untitled composition'} — Author · Music Notes`;
    this.el('document-title').textContent = project.metadata.title || 'Untitled composition';
    const viewedPart = project.parts.find(part => part.id === this.partId);
    const viewedPartName = viewedPart ? partLabel(viewedPart, project.parts) : 'Full score';
    setControlLabel(this.el('active-part-label'), viewedPartName);
    this.syncHistoryControls();
    this.options('part-select', [{ value: 'score', label: 'Full score' }, ...project.parts.map(part => ({ value: part.id, label: partLabel(part, project.parts) }))], this.partId);
    this.options('staff-select', this.visibleStaves().map(staff => ({ value: staff.id, label: this.staffName(staff.id) })), location.staff.id);
    const measureOptions = location.staff.measures.map(measure => ({ value: measure.id, label: `${measure.number}${measure.annotations.find(item => item.kind === 'rehearsal') ? ` · ${measure.annotations.find(item => item.kind === 'rehearsal')!.text}` : ''}` }));
    this.options('measure-select', measureOptions, location.measure.id);
    this.options('read-measure', measureOptions, location.measure.id);
    this.options('page-measure-select', measureOptions, location.measure.id);
    this.options('event-voice', location.measure.voices.map((_, index) => ({ value: String(index), label: `Voice ${index + 1}` })), String(location.voiceIndex));
    const total = location.voice.events.reduce((time, event) => add(time, event.time), rational(0));
    const remaining = subtract(meterTime(location.measure.meter), total);
    const starter = location.voice.events.length === 1 && location.voice.events[0].measureRest;
    this.el('remaining-time').textContent = !location.voice.events.length ? `Empty draft · Voice ${location.voiceIndex + 1}`
      : starter ? 'Rest to replace' : location.measure.pickup ? `Pickup · ${formatRational(total)} whole notes`
      : compare(remaining, rational(0)) === 0 ? `Voice ${location.voiceIndex + 1} full` : `${formatRational(remaining)} whole notes left`;
    this.el('selection-context').textContent = `${this.staffName(location.staff.id)} · bar ${location.measure.number}${location.measure.voices.length > 1 ? ` · voice ${location.voiceIndex + 1}` : ''}`;
    this.el('location-context').textContent = `${this.entryMode ? 'Writing at' : 'Selected'} ${this.entryLocationLabel(this.cursor)}.`;
    this.el('location-trigger').setAttribute('aria-label', `Location and actions: ${this.entryLocationLabel(this.cursor)}. ${this.el('remaining-time').textContent}`);
    const compact = this.controls.get('selection-compact-context');
    if (compact) compact.textContent = `Bar ${location.measure.number} · V${location.voiceIndex + 1}`;
    const compactStaff = this.controls.get('selection-compact-staff');
    if (compactStaff) compactStaff.textContent = this.staffName(location.staff.id);
    setControlLabel(this.el('add-measure'), `Add measure after ${location.measure.number}`);
    this.el('add-measure').title = 'Adds an aligned measure to every staff';
    for (const id of ['add-measure', 'add-chord-symbol', 'start-entry-here']) this.el<HTMLButtonElement>(id).disabled = this.mode !== 'write' || project.pendingSource !== null;
    this.el<HTMLButtonElement>('next-measure').disabled = location.measureIndex >= location.staff.measures.length - 1;
    this.el('read-location').textContent = `${location.staff.label || 'Staff'} · measure ${location.measure.number} · ${location.staff.notation === 'rhythm' ? 'single-line rhythm notation' : location.staff.notation === 'three-roads' ? '3 roads music · relative pitch directions' : 'authored pitch'}. Layout stays fixed until Refit.`;
    this.el('page-selection-context').textContent = `Boundary before measure ${location.measure.number} · applies to the aligned column in ${this.partId === 'score' ? 'the full score' : viewedPartName}.`;
    const rangeOptions = [{ value: '', label: 'Current selection' }, ...this.allVoiceEvents().map(({ event, measure }) => ({ value: event.id, label: `Bar ${measure.number} · ${eventLabel(event)}` }))];
    this.syncRangeFields();
    this.options('range-start', rangeOptions, this.rangeStart);
    this.options('range-end', rangeOptions, this.rangeEnd);
    this.rangeStart = this.value('range-start'); this.rangeEnd = this.value('range-end');
    this.updateRangeStatus();
    this.options('duplicate-from-measure', measureOptions, this.value('duplicate-from-measure') || location.measure.id);
    this.options('duplicate-through-measure', measureOptions, this.value('duplicate-through-measure') || location.measure.id);
    const measure = location.measure;
    const part = project.parts.find(item => item.id === this.partId);
    this.inspectors.refresh(); this.markings.refresh(); this.eventMarkings.refresh(); this.syncDraftStatus();
    this.syncStructuralActions();
    this.el<HTMLButtonElement>('remove-part').disabled ||= !part;
    this.el<HTMLButtonElement>('clear-short-review').disabled ||= !project.reviewedShortMeasures.includes(measure.id);
    this.syncSourceNotice();
    this.syncEntryVisibility();
    this.selectionControls?.refresh();
    this.selectionHud?.refresh();
    this.renderNavigator(); this.syncReturnControl();
    this.listen?.refresh();
  }

  private noteEditorState(): NoteEditorState {
    const location = this.location();
    let selectionCount = 0;
    try { selectionCount = this.selectedEvents().length; } catch { /* A measure or instruction has no event selection. */ }
    const used = location.voice.events.reduce((time, event) => add(time, event.time), rational(0));
    return {
      documentId: this.session.signals.project.get().id, mode: this.mode, revision: this.session.revision,
      pendingSource: this.session.signals.pendingSource.get() !== null,
      activeMarkingId: this.currentMarking()?.marking.id,
      event: this.isSingleEventSelection(location.event?.id) ? location.event : undefined,
      staffLabel: location.staff.label || 'Staff', measureNumber: String(location.measure.number),
      voiceNumber: location.voiceIndex + 1, remaining: subtract(meterTime(location.measure.meter), used),
      tuplets: location.voice.tuplets.filter(tuplet => location.event?.tupletIds.includes(tuplet.id)), selectionCount,
    };
  }

  private selectionControlsState(): SelectionControlsState {
    const note = this.noteEditorState();
    const ids = this.safeSelectedEvents();
    const all = this.session.signals.score.get().staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)));
    const place = this.location();
    const bookmark = this.validBookmark();
    return { ...note, event: all.find(event => event.id === this.session.selection.primaryId),
      score: this.session.signals.score.get(), events: all.filter(event => ids.includes(event.id)), eventIds: ids,
      entryMode: this.entryMode, selectionVersion: this.session.selectionVersion, documentEpoch: this.session.documentEpoch,
      inspectionMatchesSelection: !this.entryMode && !!note.event && this.inspectors.snapshot('selected').matchesSelection
        && this.inspectors.snapshot('selected').targetId === note.event.id,
      selectMoreActive: this.selectMore, pitchDragArmed: this.pitchDragArmed,
      moreExpanded: this.tools.isDestinationVisible(this.selectionTool()),
      resumeLabel: bookmark ? `Resume at bar ${this.location(bookmark.cursor.measureId).measure.number}` : `Enter notes`,
      structural: !ids.length && this.session.selectionId ? {
        id: this.session.selectionId,
        kind: place.annotation ? 'instruction' : place.tuplet ? 'tuplet' : 'measure',
        label: place.annotation ? `${place.annotation.kind}: ${place.annotation.text || place.annotation.bpm || ''}`
          : place.tuplet ? 'Tuplet group' : `Bar ${place.measure.number}`,
      } : undefined,
    };
  }

  private activateSelection(): void {
    if (this.mode !== 'write') return;
    this.parkEntry();
    const place = this.location();
    if (this.safeSelectedEvents().length > 1) { this.tools.open('rhythm', '#range-status'); return; }
    const marking = this.currentMarking();
    if (marking) { this.openAttachedMarks(marking.marking.id); return; }
    if (place.event && this.isSingleEventSelection(place.event.id)) { this.openAdvanced('properties'); return; }
    if (place.annotation) { this.markings.editAnnotation(place.annotation.id, { navigate: false }); return; }
    if (place.tuplet) { this.tools.open('rhythm', '#tuplet-actual'); return; }
    this.tools.open('measure', '#measure-meter');
  }

  private setSelectMore(enabled: boolean): void {
    this.requireWriting(); this.staffInteraction.cancel('selection'); this.parkEntry();
    this.clearActiveMarking(); this.pitchDragArmed = false; this.selectMore = enabled;
    this.selectionControls?.close();
    if (enabled && !this.session.selection.focusId) {
      const first = this.location().voice.events[0];
      if (first) this.session.setSelection(reduceSelection(this.session.selection, { type: 'focus', id: first.id }, this.selectionContext()).state);
    }
    this.syncPanels(false); this.drawSelection(); this.invalidateOffers();
    this.el('score-editor').focus({ preventScroll: true });
    this.status(enabled ? 'Select more: tap events to toggle them. Arrows move focus; Space toggles. Done keeps the selection.' : 'Selection kept.');
  }

  private preparePitchDrag(): void {
    this.requireWriting(); this.parkEntry();
    const event = this.location().event;
    if (!event || !this.isSingleEventSelection(event.id) || event.kind !== 'note' || event.pitches.length !== 1
      || event.tie !== 'none' || this.currentMarking()) throw new Error('Select one untied pitched note before preparing a pitch drag.');
    this.staffInteraction.cancel('mode'); this.selectMore = false; this.pitchDragArmed = true;
    this.selectionControls?.close(); this.tools.hide(false);
    this.syncEntryVisibility(); this.selectionControls?.refresh();
    this.scrollToSelection(); this.el('drag-pitch').focus({ preventScroll: true });
  }

  private finishPitchDrag(): void {
    this.staffInteraction.cancel('mode'); this.pitchDragArmed = false;
    this.syncEntryVisibility(); this.selectionControls?.refresh(); this.drawSelection();
    this.el('score-editor').focus({ preventScroll: true });
  }

  private editNote(action: () => void): void {
    this.staffInteraction.cancel('source'); this.el('author-errors').hidden = true;
    this.selectionError = undefined; document.body.dataset.selectionFeedback = 'none';
    this.editingNote = true;
    try { action(); } finally { this.editingNote = false; }
  }

  private syncAdvancedEditor(): void {
    this.inspectors.refresh(); this.eventMarkings.refresh(); this.syncDraftStatus();
    this.updateRangeStatus();
  }

  private syncSourceNotice(forceValue = false): void {
    const project = this.session.signals.project.get();
    const pending = this.session.signals.pendingSource.get() !== null;
    this.sourceEditor.renderState({
      documentId: project.id,
      value: project.pendingSource ?? project.sourceHtml,
      readOnly: this.mode !== 'write',
      status: pending ? 'Unapplied source draft · the engraving still shows the accepted music. Printing is blocked until Apply or Revert.'
        : 'Source and engraving agree. Apply validates the whole score as one undoable action.',
    }, { forceValue });
    this.sourceEditor.refreshFailure(project.id, this.sourceEditor.inputValue);
    const notice = this.el('source-draft-notice');
    notice.hidden = !pending;
    notice.textContent = pending ? 'Preview has unapplied source changes. The score below is the last accepted music. Open Source in Write to Apply or Revert; printing is blocked.' : '';
    this.syncAdvancedEditor();
    this.markings.refresh();
    this.selectionControls?.refresh();
    this.selectionHud?.refresh();
    this.syncReviewNotice();
  }

  private checkedValues(id: string): string[] { return [...this.el(id).querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value); }
  private updateRangeStatus(): void {
    const ids = this.safeSelectedEvents();
    const place = ids.length ? this.location(ids[0]) : this.location();
    const voice = place.staff.measures.flatMap(measure => measure.voices[place.voiceIndex]?.events ?? []);
    const chosen = voice.filter(event => ids.includes(event.id));
    const first = voice.findIndex(event => event.id === ids[0]);
    const last = voice.findIndex(event => event.id === ids.at(-1));
    const contiguous = ids.length > 0 && first >= 0 && last - first + 1 === ids.length && chosen.length === ids.length;
    const pitched = chosen.length > 0 && chosen.every(event => event.kind === 'note' || event.kind === 'chord');
    const spelled = (event: MusicEvent) => event.pitches.map(pitchText).sort().join(' ');
    const compatible = pitched ? chosen.every(event => spelled(event) === spelled(chosen[0]))
      : chosen.length > 0 && (chosen.every(event => event.kind === 'rhythm')
        || chosen.every((event, index) => event.kind === 'road' && (index === 0 || event.pitchDirection === 'same')));
    let tieReason = !ids.length ? 'Select events to work on their relationships.'
      : !contiguous ? 'Separated events are selected. Ties and tuplets require consecutive events; no gaps will be filled.'
        : ids.length < 2 ? 'A tie needs at least two consecutive events.'
          : !compatible ? 'A tie needs matching complete pitch spellings, rhythm notes, or compatible road continuations.' : '';
    if (!tieReason) for (const event of chosen) {
      const index = voice.findIndex(candidate => candidate.id === event.id);
      let from = index, through = index;
      while (from > 0 && ['continue', 'end'].includes(voice[from].tie)) from--;
      while (through < voice.length - 1 && ['start', 'continue'].includes(voice[through].tie)) through++;
      if (voice.slice(from, through + 1).some(member => !ids.includes(member.id))) {
        tieReason = 'Include the complete existing tie chain before changing its connections.'; break;
      }
    }
    const blocked = this.mode !== 'write' || this.session.signals.pendingSource.get() !== null;
    this.el<HTMLButtonElement>('tie-events').disabled = blocked || !!tieReason;
    this.el<HTMLButtonElement>('clear-ties').disabled = blocked || !chosen.some(event => event.tie !== 'none');
    setControlLabel(this.el('clear-ties'), 'Clear connected ties');
    const oneBar = ids.length > 0 && ids.every(id => this.location(id).measure.id === place.measure.id);
    const wrap = this.el<HTMLButtonElement>('wrap-tuplet');
    wrap.disabled ||= blocked || !contiguous || !oneBar || chosen.some(event => event.measureRest);
    const context = ids.length ? `${ids.length} event${ids.length === 1 ? '' : 's'} · ${this.staffName(place.staff.id)} · voice ${place.voiceIndex + 1}.` : '';
    const message = [context, tieReason || 'Ties and tuplets are validated as complete musical relationships.',
      contiguous && !oneBar ? 'A tuplet must stay within one bar.' : ''].filter(Boolean).join(' ');
    if (this.el('range-status').textContent !== message) this.el('range-status').textContent = message;
  }
  private syncStaffNotation(): void {
    const pitchless = this.value('staff-notation') !== 'pitched';
    for (const id of ['staff-clef', 'staff-key']) {
      this.el<Control>(id).disabled ||= pitchless;
      this.el(id).closest('label')!.hidden = pitchless;
    }
  }
  private syncEntryVisibility(): void {
    const location = this.location();
    const notation = location.staff.notation ?? 'pitched';
    const pitchedStaff = notation === 'pitched';
    const kind = this.value('event-kind');
    document.body.dataset.entryKind = kind;
    // Selection never rewrites the next-note recipe. An explicit Start here on
    // a different staff type may choose a compatible entry kind.
    for (const option of this.el<HTMLSelectElement>('event-kind').options) {
      option.disabled = !entryKinds[notation].includes(option.value);
    }
    this.el('pitch-field').hidden = kind !== 'note'; this.el('pitches-field').hidden = kind !== 'chord'; this.el('slash-field').hidden = true;
    this.el('event-alteration-field').hidden = !pitchedStaff || kind !== 'note';
    this.entryPitch.refresh();
    if (kind !== 'note') this.el('event-alteration-status').hidden = true;
    this.el('direction-field').hidden = kind !== 'road'; this.el('direction-help').hidden = kind !== 'road';
    this.el<HTMLSelectElement>('event-direction').disabled = kind !== 'road';
    this.el<HTMLInputElement>('event-measure-rest').disabled = kind !== 'rest';
    this.el('event-measure-rest').closest('label')!.hidden = kind !== 'rest';
    const pitchedEntry = pitchedStaff && (kind === 'note' || kind === 'chord');
    this.el('pitch-help').hidden = !pitchedEntry;
    this.el<HTMLSelectElement>('event-accidental-display').disabled = !pitchedEntry;
    this.el('event-accidental-display').closest('label')!.hidden = !pitchedEntry;
    this.el('toggle-entry').setAttribute('aria-pressed', String(this.entryMode));
    const missingBookmark = !!this.bookmark && !this.validBookmark();
    this.el('entry-mode-label').textContent = 'Write notes';
    this.el('entry-mode-reason').hidden = !missingBookmark;
    if (missingBookmark) {
      const explanation = 'Write notes: previous writing location unavailable; choose a new location.';
      this.el('toggle-entry').setAttribute('aria-label', explanation);
      this.el('toggle-entry').title = explanation;
    } else { this.el('toggle-entry').removeAttribute('aria-label'); this.el('toggle-entry').removeAttribute('title'); }
    this.el('select-mode').setAttribute('aria-pressed', String(!this.entryMode));
    document.body.dataset.entryMode = String(this.entryMode);
    document.body.dataset.selectMore = String(this.selectMore);
    document.body.dataset.pitchDragArmed = String(this.pitchDragArmed);
    document.body.dataset.entryDragArmed = String(this.entryDragArmed && this.entryMode);
    const propertiesTarget = this.inspectionSelectionId ?? this.inspectors?.snapshot('selected').targetId
      ?? this.eventMarkings?.snapshot().targetId;
    this.tools?.setEntryContext({ entryMode: this.entryMode, hasPropertiesTarget: this.propertiesVisited && !!propertiesTarget });
    this.el('score-host').dataset.entryMode = String(this.entryMode);
    const mark = this.validBookmark();
    const resume = !!mark && !this.entryMode && (JSON.stringify(mark.cursor) !== JSON.stringify(this.cursor) || mark.partId !== this.partId);
    this.el('resume-entry').hidden = !resume; this.el('toggle-entry').hidden = false;
    this.el('select-mode').hidden = false;
    this.el('palette-owner-label').textContent = this.entryMode ? 'New notes'
      : this.safeSelectedEvents().length > 1 ? `Selected ${this.safeSelectedEvents().length}` : 'Selected';
    this.el('tools-toggle').hidden = !this.entryMode;
    if (mark) {
      const measure = this.session.signals.score.get().staves.find(staff => staff.id === mark.cursor.staffId)?.measures.find(item => item.id === mark.cursor.measureId);
      setControlLabel(this.el('resume-entry'), `Resume at bar ${measure?.number ?? '?'}`);
      this.el('resume-entry').setAttribute('aria-label', `Resume writing at ${this.entryLocationLabel(mark.cursor)}`);
      this.el('resume-entry').title = this.entryLocationLabel(mark.cursor);
    }
    const measureRest = kind === 'rest' && this.checked('event-measure-rest');
    const position = this.value('insert-position');
    const dots = this.value('event-dots');
    this.el<HTMLSelectElement>('event-duration').disabled = measureRest;
    this.el<HTMLSelectElement>('event-dots').disabled = measureRest;
    this.el<HTMLSelectElement>('event-beam').disabled = measureRest;
    this.el<HTMLSelectElement>('event-stem').disabled = measureRest;
    this.el('event-duration').title = measureRest ? 'A full-measure rest follows the meter; this ordinary note value is not used.' : '';
    this.el('event-dots').title = measureRest ? 'A full-measure rest follows the meter; dots are not used.' : '';
    this.el('event-beam').title = measureRest ? 'A full-measure rest has no beam; this ordinary entry setting is not used.' : '';
    this.syncEntryPalette();
    const attackLabel = ENTRY_ATTACK_OPTIONS.find(option => option.value === this.el<MusicToggleButtonGroup>('entry-attack').value)?.label;
    const recipe = kind === 'road'
      ? `${dots === '0' ? 'No dots' : `${dots} ${dots === '1' ? 'dot' : 'dots'}`}${attackLabel && attackLabel !== 'None' ? ` · ${attackLabel}` : ''} · ${position ? position[0].toUpperCase() + position.slice(1) : 'Choose position'}`
      : `${measureRest ? `Full-measure rest · ${location.measure.meter.display}` : kind === 'note' ? this.value('event-pitch') : kind === 'chord' ? this.value('event-pitches') : kind === 'rhythmic-slash' ? 'Written rhythm' : kind === 'slash' ? 'Open improvisation' : kind === 'rhythm' ? 'No pitch' : 'Rest'}${!measureRest && dots !== '0' ? ` · ${dots} dot(s)` : ''}${attackLabel && attackLabel !== 'None' ? ` · ${attackLabel}` : ''} · ${position}`;
    const toolName = kind === 'note' ? 'Note' : kind === 'chord' ? 'Chord' : kind === 'road' ? '3 roads'
      : kind === 'rhythm' ? 'Rhythm' : kind === 'rhythmic-slash' ? 'Slash rhythm' : kind === 'slash' ? 'Open slash' : 'Rest';
    this.el('entry-recipe').textContent = kind === 'note' ? this.value('event-pitch') || 'Pitch…'
      : kind === 'road' ? this.value('event-direction') : kind === 'chord' ? 'Pitches…'
        : measureRest ? 'Full bar' : kind === 'rest' ? 'Ordinary' : 'Options';
    this.el('entry-settings-label').textContent = toolName;
    this.el('entry-settings-trigger').hidden = kind === 'road';
    this.el('entry-direction-trigger').hidden = kind !== 'road';
    setControlLabel(this.el('entry-direction-trigger'), kind === 'road'
      ? this.value('event-direction') === 'higher' ? 'Higher' : this.value('event-direction') === 'lower' ? 'Lower' : 'Same' : 'Direction');
    setControlIcon(this.el('entry-direction-trigger'), this.value('event-direction') === 'higher' ? phArrowUp
      : this.value('event-direction') === 'lower' ? phArrowDown : phArrowRight);
    this.el('entry-direction-trigger').setAttribute('aria-label', `New 3 roads direction: ${directionLabel(this.value('event-direction'))}`);
    for (const direction of ['higher', 'same', 'lower']) this.el(`entry-direction-${direction}`).setAttribute('aria-pressed', String(this.value('event-direction') === direction));
    this.el('entry-settings-trigger').setAttribute('aria-label', `Next event settings: ${recipe}`);
    this.el('entry-settings-trigger').setAttribute('aria-describedby', `${kind === 'road' ? 'direction-help ' : pitchedEntry ? 'pitch-help ' : ''}position-help`);
    const nominal = kind === 'slash';
    const duration = this.value('event-duration');
    const valueIcon = measureRest ? bravuraRestWholeLegerLine : nominal ? bravuraNoteheadSlashWhiteWhole
      : durationIcon(duration as Duration, kind === 'rest');
    setControlIcon(this.el('entry-value-trigger'), valueIcon);
    setControlIcon(this.el('entry-settings-trigger'), kind === 'chord' ? phMusicNotes
      : kind === 'rhythmic-slash' ? bravuraNoteheadSlashHorizontalEnds : valueIcon);
    const durationName = duration ? duration[0].toUpperCase() + duration.slice(1) : 'Value';
    const compactDuration = ({ sixteenth: '16th', 'thirty-second': '32nd', 'sixty-fourth': '64th', '128th': '128th' } as Record<string, string>)[duration] ?? durationName;
    this.el('entry-value-label').textContent = measureRest ? 'Follows meter' : nominal ? 'Nominal span' : compactDuration;
    this.el('entry-value-dots').textContent = measureRest ? location.measure.meter.display
      : nominal ? `${compactDuration}${'.'.repeat(Math.max(0, Math.min(3, Number(dots) || 0)))}`
        : dots === '0' ? 'No dots' : `${dots} dot${dots === '1' ? '' : 's'}`;
    this.el('entry-value-field-label').textContent = nominal ? 'Nominal span' : 'Written value';
    this.el('entry-value-trigger').setAttribute('aria-label', measureRest ? `Full-measure rest follows ${location.measure.meter.display}`
      : `${nominal ? 'Nominal span' : 'Written value'} for new ${kind === 'rest' ? 'rests' : 'notes'}: ${durationName}, ${dots} dots`);
    const entryKind = this.el<MusicToggleButtonGroup>('entry-kind');
    entryKind.options = [
      { value: 'note', label: notation === 'three-roads' ? '3 roads note' : notation === 'rhythm' ? 'Rhythm note' : 'Note', icon: notation === 'three-roads' ? bravuraNoteheadSlashHorizontalEnds : bravuraNoteQuarterUp },
      { value: 'rest', label: 'Rest', icon: bravuraRestQuarter },
    ];
    entryKind.value = kind === defaultEntryKind[notation] ? 'note' : kind === 'rest' && !measureRest ? 'rest' : '';
    entryKind.choiceStates = { note: entryKind.value === 'note' ? 'true' : 'false', rest: entryKind.value === 'rest' ? 'true' : 'false' };
    const handle = this.el<HTMLButtonElement>('drag-entry');
    const ordinaryRest = kind === 'rest' && !measureRest;
    const supportsPlacement = pitchedStaff && kind === 'note' || ordinaryRest;
    handle.hidden = !this.entryMode || !this.entryDragArmed;
    let validPitch = false;
    try { parsePitch(this.value('event-pitch')); validPitch = true; } catch { /* The native field remains editable. */ }
    handle.disabled = !supportsPlacement || kind === 'note' && !validPitch || this.mode !== 'write' || this.session.signals.pendingSource.get() !== null;
    handle.setAttribute('aria-label', ordinaryRest ? 'Drag the configured rest to the staff' : 'Drag the configured note to the staff');
    handle.title = ordinaryRest ? 'Drag a rest to its musical position; height does not change the rest' : 'Drag a note to the staff';
    setControlLabel(handle, ordinaryRest ? 'Drag rest' : 'Drag note');
    this.el('drag-entry-value').textContent = supportsPlacement ? recipe : 'Use Insert here for this entry';
    this.el('insert-event').hidden = this.entryMode && this.entryDragArmed;
    this.el('entry-value-trigger').hidden = this.entryMode && this.entryDragArmed;
    this.el('cancel-entry-drag').hidden = !this.entryMode || !this.entryDragArmed;
    this.el('cancel-entry-drag').setAttribute('aria-label', ordinaryRest ? 'Cancel prepared rest drag' : 'Cancel prepared note drag');
    this.el<HTMLButtonElement>('prepare-entry-drag').disabled = handle.disabled;
    setControlLabel(this.el('prepare-entry-drag'), ordinaryRest ? 'Prepare rest drag' : 'Prepare note drag');
    this.el('entry-drag-help').textContent = supportsPlacement
      ? 'Prepare the handle, then drag it to a staff. The written value stays unchanged. Escape or Done returns to ordinary writing.'
      : measureRest ? 'A full-measure rest follows the meter. Use Insert here; dragging is reserved for ordinary rests and single pitched notes.'
        : 'Use Insert here or Enter for this entry. Dragging supports ordinary rests and single pitched notes.';
    const event = location.event;
    const pitchDraggable = pitchedStaff && event?.kind === 'note' && event.pitches.length === 1 && event.tie === 'none'
      && this.isSingleEventSelection(event.id) && !this.selectMore && !this.currentMarking();
    this.el<HTMLButtonElement>('drag-pitch').disabled = this.mode !== 'write' || !pitchDraggable;
    this.el('drag-pitch').hidden = this.entryMode || !pitchDraggable || !this.pitchDragArmed;
    this.el('drag-pitch-help').textContent = pitchDraggable
      ? `${pitchText(event.pitches[0])} · drag vertically; click to edit.`
      : notation === 'three-roads' ? '3 roads notes have no fixed pitch to drag. Use Insert or Enter to write; Edit 3 roads note changes direction and written value.'
        : notation === 'rhythm' ? 'Rhythm notes have no pitch to drag. Use Insert or Enter to write; Edit rhythm note changes written values.'
        : event?.tie !== undefined && event.tie !== 'none' ? 'Tied note: dragging is unavailable. Use the selection controls.'
        : 'Select an untied single note. Other events use the selection controls.';
    this.syncConversionVisibility(); this.syncInsertAction();
    this.selectionControls?.refresh();
  }
  private syncEntryPalette(): void {
    const enabled = this.mode === 'write' && this.session.signals.pendingSource.get() === null;
    const kind = this.value('event-kind');
    const attack = this.el<MusicToggleButtonGroup>('entry-attack');
    if (kind !== this.entryPaletteKind) {
      this.el<MusicToggleButtonGroup>('entry-duration').options = entryDurationOptions(kind === 'rest');
      if (!entryAttackAllowed(attack.value, kind)) {
        const previous = ENTRY_ATTACK_OPTIONS.find(option => option.value === attack.value)?.label ?? 'Attack';
        attack.value = 'none';
        this.el('entry-attack-status').textContent = `${previous} does not apply to this event type. Attack is now None.`;
      } else this.el('entry-attack-status').textContent = '';
      attack.options = entryAttackOptions(kind);
      this.entryPaletteKind = kind;
    }
    attack.disabled = !enabled;
    this.el<MusicToggleButtonGroup>('entry-kind').disabled = !enabled;
    for (const [groupId, fieldId] of [['entry-accidentals', 'event-alteration'], ['entry-duration', 'event-duration'], ['entry-dots', 'event-dots']] as const) {
      const group = this.el<MusicToggleButtonGroup>(groupId);
      const field = this.el<HTMLSelectElement>(fieldId);
      const invalidPitch = fieldId === 'event-alteration' && !field.value;
      if (fieldId === 'event-alteration') {
        if (field.value) this.entryPaletteAlteration = field.value;
        group.value = this.entryPaletteAlteration;
      } else group.value = field.value;
      group.disabled = !enabled || field.disabled || invalidPitch;
      group.title = invalidPitch ? 'Enter a valid pitch in New-note options before choosing an accidental.' : field.title;
    }
  }
  private syncConversionVisibility(): void {
    const notation = this.location().staff.notation ?? 'pitched';
    const kind = this.value('convert-kind');
    for (const option of this.el<HTMLSelectElement>('convert-kind').options) option.disabled = !entryKinds[notation].includes(option.value);
    for (const [id, active] of [['convert-pitch', kind === 'note'], ['convert-rhythmic', kind === 'slash'], ['convert-direction', kind === 'road']] as const) {
      const input = this.el<Control>(id); input.disabled = !active; input.closest('label')!.hidden = !active;
    }
    this.el<HTMLButtonElement>('convert-events').disabled = !entryKinds[notation].includes(kind) || this.mode !== 'write' || this.session.signals.pendingSource.get() !== null;
  }
  private syncHistoryControls(): void {
    const writing = this.mode === 'write';
    this.el<HTMLButtonElement>('undo').disabled = !writing || !this.session.canUndo;
    this.el<HTMLButtonElement>('redo').disabled = !writing || !this.session.canRedo;
    this.el('undo').title = writing ? 'Undo (Command or Control + Z)' : 'Return to Write to undo an edit';
    this.el('redo').title = writing ? 'Redo (Command or Control + Shift + Z)' : 'Return to Write to redo an edit';
  }
  private syncPointerOffset(): number {
    // Both modes now live below the independently scrolling notation viewport.
    this.el('score-editor').style.setProperty('--author-pointer-offset', '0px');
    return 0;
  }
  private renderNavigator(): void {
    const { measure, voiceIndex } = this.location();
    renderEventNavigator(this.el('event-navigator'), {
      measure, voiceIndex, selectedIds: this.session.selection.ids,
      activeMarkingId: this.currentMarking()?.marking.id,
    }, this.el('score-editor'));
  }

  private readEvent(prefix = 'event'): EventInput {
    const kind = this.value(`${prefix}-kind`);
    const measureRest = kind === 'rest' && this.checked(`${prefix}-measure-rest`);
    const meterControlled = prefix === 'event' && measureRest;
    const attack = prefix === 'event' ? entryAttack(this.el<MusicToggleButtonGroup>('entry-attack').value) : undefined;
    return {
      kind: (kind === 'rhythmic-slash' ? 'slash' : kind) as EventInput['kind'], pitch: this.value(`${prefix}-pitch`).trim(), pitches: this.value(`${prefix}-pitches`).trim(),
      duration: meterControlled ? 'whole' : this.value(`${prefix}-duration`) as Duration, dots: meterControlled ? 0 : this.numeric(`${prefix}-dots`), rhythmic: kind === 'rhythmic-slash',
      measureRest,
      ...(kind === 'road' ? { pitchDirection: this.value(`${prefix}-direction`) as PitchDirection } : {}),
      accidentalDisplay: this.value(`${prefix}-accidental-display`) as EventInput['accidentalDisplay'],
      stem: meterControlled ? 'auto' : this.value(`${prefix}-stem`) as EventInput['stem'], beam: meterControlled ? 'none' : this.value(`${prefix}-beam`) as EventInput['beam'],
      ...(attack ? { attack } : {}),
    };
  }
  private execute(command: AuthorCommand): void {
    this.requireWriting();
    if (this.entryMode || command.type === 'insert-event') this.session.setCursor(this.cursor);
    const advancing = ['insert-event', 'paste-music', 'append-and-insert', 'continue-piece', 'append-measure'].includes(command.type);
    this.advancingWriting = advancing;
    let result: ReturnType<EditorSession['execute']>;
    try { result = this.session.execute(command); } finally { this.advancingWriting = false; }
    if (result.cursor) this.cursor = { ...result.cursor };
    this.status(result.message);
  }
  private closeDocumentMenu(): void {
    this.surfaces.close('document-menu');
  }

  private bind(): void {
    this.on('view-switch', 'view-request', event => {
      const mode = (event as CustomEvent<{ mode: ViewMode }>).detail?.mode;
      if (mode === 'write' || mode === 'read' || mode === 'listen' || mode === 'pages') this.setMode(mode);
    });
    this.on('undo', 'click', () => { if (this.mode === 'write') this.session.undo(); }); this.on('redo', 'click', () => { if (this.mode === 'write') this.session.redo(); });
    for (const id of ['project-title', 'project-composer', 'project-subtitle']) this.on(id, 'input', () => {
      this.metadataDirty = true;
      document.body.dataset.authorPrintReady = 'false';
      if (this.mode === 'pages') setPagePreflightMessage(this.el('page-preflight'), 'Updating composition details. Printing waits for the new pages.');
      clearTimeout(this.metadataTimer); this.metadataTimer = setTimeout(() => { void this.run(() => this.commitMetadata()); }, 350);
    });
    this.on('new-project', 'click', async () => {
      this.commitMetadata();
      const template = this.value('new-template') as TemplateId;
      const templateName = this.el<HTMLSelectElement>('new-template').selectedOptions[0]?.textContent || 'a new composition';
      if (!await this.confirmAction('Start a new composition', `Replace “${this.session.signals.project.get().metadata.title || 'Untitled composition'}” with ${templateName}?${this.dirtyInspectorCount() || this.session.signals.pendingSource.get() !== null ? ' Unapplied Source and form drafts will be discarded.' : ''} Download this project first to keep a separate copy.`, 'Replace composition')) return;
      this.closeTransientSurfaces();
      this.partId = 'score'; this.entryMode = false; this.rangeStart = ''; this.rangeEnd = '';
      this.session.replaceProject(createTemplate(template)); this.resetCursor(); this.inspectors.reset(); this.markings.reset(); this.eventMarkings.reset();
      this.setValue('event-kind', defaultEntryKind[this.location().staff.notation ?? 'pitched']); this.setValue('event-direction', 'same'); this.setValue('event-pitch', 'C4'); this.setValue('event-duration', 'quarter'); this.setValue('event-dots', '0'); this.check('event-measure-rest', false);
      this.el<MusicToggleButtonGroup>('entry-attack').value = 'none';
      this.setMode('write');
    });
    this.on('open-project', 'click', () => { this.closeDocumentMenu(); this.el<HTMLInputElement>('project-file').click(); });
    this.on('project-file', 'change', () => this.fileReader.read(async (file, text, isCurrent) => {
      const project = text.trimStart().startsWith('{') ? importProject(text) : createProject(text, file.name.replace(/\.[^.]+$/, ''));
      if (!isCurrent()) return;
      if (!await this.confirmAction('Open another composition', `Replace this workspace with “${project.metadata.title || file.name}”?${this.dirtyInspectorCount() || this.session.signals.pendingSource.get() !== null ? ' Unapplied Source and form drafts will be discarded.' : ''} Download the current project first to keep a separate copy.`, 'Open composition') || !isCurrent()) return;
      this.closeTransientSurfaces();
        this.partId = 'score'; this.session.replaceProject(project); this.resetCursor(); this.inspectors.reset(); this.markings.reset(); this.eventMarkings.reset(); this.setMode('write');
    }));
    this.on('download-project', 'click', () => { this.closeDocumentMenu(); this.commitMetadata(); this.download(serializeProject(this.session.project), 'application/json', '.music-notes.json'); this.status('Project download requested, including layout settings and unapplied source drafts.'); });
    this.on('export-html', 'click', () => {
      this.closeDocumentMenu();
      this.commitMetadata(); if (this.session.signals.pendingSource.get() !== null) throw new Error('Apply or revert the source draft before exporting accepted musical HTML. Download a project to preserve both versions.');
      const projection = buildProjection(this.session.project, this.partId); const html = serializeScore(projection.score);
      this.download(html, 'text/html', '.music.html'); this.status('Exported canonical musical HTML for this view. Download a project to retain all metadata and layout profiles.');
    });
    this.on('part-select', 'change', () => {
      this.parkEntry(); this.clearActiveMarking(); this.partId = this.value('part-select'); this.pageView = undefined;
      this.rangeStart = ''; this.rangeEnd = ''; this.check('ack-layout-warnings', false);
      this.anchorVisibleSelection(); this.syncPanels(false); this.revealAfterRender = true; this.requestRender(); this.invalidateOffers();
    });
    this.on('staff-select', 'change', () => {
      this.parkEntry();
      const old = this.location(); const staff = this.session.signals.score.get().staves.find(item => item.id === this.value('staff-select'))!;
      this.cursor.staffId = staff.id; this.cursor.measureId = staff.measures[Math.min(old.measureIndex, staff.measures.length - 1)].id;
      this.rangeStart = ''; this.rangeEnd = ''; this.select(this.cursor.measureId, false); this.scrollToSelection();
    });
    this.on('measure-select', 'change', () => { this.parkEntry(); this.rangeStart = ''; this.rangeEnd = ''; this.select(this.value('measure-select'), false); this.scrollToSelection(); });
    this.on('page-measure-select', 'change', () => { this.rangeStart = ''; this.rangeEnd = ''; this.select(this.value('page-measure-select'), false); });
    this.on('event-voice', 'change', () => { this.parkEntry(); this.rangeStart = ''; this.rangeEnd = ''; this.cursor.voiceIndex = this.numeric('event-voice'); const location = this.location(this.cursor.measureId); this.select(location.voice.events[0]?.id ?? location.measure.id, false); });
    this.on('event-kind', 'change', () => { this.staffInteraction.cancel('recipe'); this.check('event-measure-rest', false); this.check('event-rhythmic', this.value('event-kind') === 'rhythmic-slash'); this.syncEntryVisibility(); this.invalidateOffers(); });
    this.on('event-rhythmic', 'change', () => {
      if (['slash', 'rhythmic-slash'].includes(this.value('event-kind'))) this.setValue('event-kind', this.checked('event-rhythmic') ? 'rhythmic-slash' : 'slash');
      this.syncEntryVisibility(); this.invalidateOffers();
    });
    for (const id of ['event-pitch', 'event-pitches', 'event-direction', 'event-duration', 'event-dots', 'event-measure-rest', 'event-accidental-display', 'event-stem', 'event-beam']) this.on(id, 'input', () => { this.staffInteraction.cancel('recipe'); this.syncEntryVisibility(); this.invalidateOffers(); });
    for (const [groupId, fieldId] of [['entry-accidentals', 'event-alteration'], ['entry-duration', 'event-duration'], ['entry-dots', 'event-dots']] as const) {
      this.on(groupId, 'change', () => {
        const group = this.el<MusicToggleButtonGroup>(groupId);
        const field = this.el<HTMLSelectElement>(fieldId);
        if (group.disabled || field.disabled) { this.syncEntryPalette(); return; }
        this.staffInteraction.cancel('recipe');
        field.value = group.value;
        // Existing native controls retain their validation and recipe ownership.
        field.dispatchEvent(new Event(fieldId === 'event-alteration' ? 'change' : 'input', { bubbles: true }));
        this.syncEntryPalette();
      });
    }
    this.on('entry-attack', 'change', () => {
      const group = this.el<MusicToggleButtonGroup>('entry-attack');
      if (group.disabled) return;
      this.staffInteraction.cancel('recipe');
      this.el('entry-attack-status').textContent = '';
      this.syncEntryVisibility(); this.invalidateOffers();
    });
    this.on('select-mode', 'click', () => {
      this.staffInteraction.cancel('mode'); this.parkEntry(); this.entryDragArmed = false;
      this.closeTransientSurfaces(); if (this.tools.state.presentation === 'sheet') this.tools.hide(false);
      this.syncPanels(false); this.el('score-editor').focus({ preventScroll: true }); this.drawSelection();
    });
    this.on('toggle-entry', 'click', () => this.activateWriting());
    this.on('resume-entry', 'click', () => this.startEntry(true));
    this.on('start-entry-here', 'click', () => this.startEntry(false));
    this.on('entry-kind', 'change', event => {
      const group = this.el<MusicToggleButtonGroup>('entry-kind');
      if (group.disabled) return;
      this.chooseEntryKind((event as CustomEvent<{ value: string }>).detail.value === 'rest');
    });
    for (const direction of ['higher', 'same', 'lower']) this.on(`entry-direction-${direction}`, 'click', () => {
      this.staffInteraction.cancel('recipe'); this.setValue('event-direction', direction);
      this.syncEntryVisibility(); this.invalidateOffers(); this.surfaces.close('entry-direction-chooser');
      this.status(`${directionLabel(direction)} ready. Press Enter to write this 3 roads note.`, true);
      this.el('score-editor').focus({ preventScroll: true });
    });
    this.on('prepare-entry-drag', 'click', () => this.prepareEntryDrag());
    this.on('cancel-entry-drag', 'click', () => this.finishEntryDrag());
    this.on('drag-entry', 'click', () => { if (!this.entryMode) this.activateWriting(); });
    this.on('drag-pitch', 'click', () => this.activateSelection());
    this.on('insert-position', 'change', () => { this.staffInteraction.cancel('recipe'); this.syncEntryVisibility(); this.drawSelection(); this.invalidateOffers(); });
    this.on('insert-event', 'click', () => this.insert());
    this.on('confirm-continue-piece', 'click', () => this.confirmContinuation(false));
    this.on('continue-piece', 'click', () => { this.requireWriting(); this.reviewEnding(this.captureOffer(this.insertionCommand(), false)); });
    this.on('confirm-pointer-recovery', 'click', () => this.confirmContinuation(true));
    this.on('return-to-selection', 'click', () => { this.scrollToSelection(); this.el('score-editor').focus({ preventScroll: true }); });
    this.on('review-source', 'click', event => {
      event.preventDefault(); this.surfaces.close('workspace-review');
      if (this.mode !== 'write') this.setMode('write');
      if (this.surfaces.open('source-panel')) this.sourceEditor.focusInput();
    });
    this.on('review-download-project', 'click', () => {
      this.commitMetadata(); this.download(serializeProject(this.session.project), 'application/json', '.music-notes.json');
    });
    this.on('review-incompatible-mark', 'click', () => {
      const recovery = this.validMarkingRecovery();
      if (!recovery) throw new Error('That conversion context changed. Review the conversion again; no music changed.');
      this.surfaces.close('workspace-review');
      this.parkEntry(); this.rangeStart = ''; this.rangeEnd = '';
      this.select(recovery.markingId, false);
      this.openAttachedMarks(recovery.markingId);
    });
    this.on('review-drafts', 'click', () => {
      this.surfaces.close('workspace-review');
      const form = (['selected', 'measure', 'tuplet', 'staff', 'part', 'page', 'boundary'] as const).find(name => this.inspectors.snapshot(name).dirty);
      if (!form && this.eventMarkings.hasDirty) {
        if (this.mode !== 'write') this.setMode('write');
        this.tools.open('edit', '#event-markings-draft-status'); return;
      }
      if (!form && this.markings.hasDirty) {
        if (this.mode !== 'write') this.setMode('write');
        this.tools.open('markings', '#annotation-text'); return;
      }
      if (!form) return;
      if (form === 'page' || form === 'boundary') {
        this.setMode('pages'); this.el<HTMLDetailsElement>(form === 'page' ? 'paper-inspector' : 'break-inspector').open = true;
        this.el(form === 'page' ? 'page-paper' : 'layout-break').focus({ preventScroll: true });
      } else {
        if (this.mode !== 'write') this.setMode('write');
        if (form === 'staff') this.surfaces.open('score-setup', '#staff-label');
        else if (form === 'part') this.surfaces.open('score-setup', '#part-label');
        else this.tools.open(form === 'selected' ? 'edit' : form === 'tuplet' ? 'rhythm' : 'measure', form === 'selected' ? '#selected-pitch' : form === 'tuplet' ? '#tuplet-actual' : '#measure-meter');
      }
    });
    this.on('next-measure', 'click', () => { const place = this.location(); const next = place.staff.measures[place.measureIndex + 1]; if (next) { this.parkEntry(); this.select(next.id, false); this.surfaces.close('location-panel'); this.scrollToSelection(); } });
    this.on('update-event', 'click', () => this.applyInspector('selected', draft => {
      this.execute({ type: 'update-event', eventId: draft.targetId, value: this.readEvent('selected'), fields: draft.dirtyFields as (keyof EventInput)[] });
    }));
    for (const [id, field] of [['selected-stem', 'stem'], ['selected-beam', 'beam'], ['selected-accidental-display', 'accidentalDisplay']] as const) this.on(id, 'change', () => {
      const draft = this.inspectors.snapshot('selected');
      if (!draft.targetId || !draft.matchesSelection || !this.isSingleEventSelection(draft.targetId)) throw new Error('Select this draft’s event before changing its engraving.');
      try { this.execute({ type: 'update-event', eventId: draft.targetId, value: this.readEvent('selected'), fields: [field] }); }
      catch (error) { this.inspectors.markFailure('selected', error); throw error; }
    });
    this.on('remove-event', 'click', () => this.execute({ type: 'remove-events', eventIds: [this.structuralTarget('selected')] }));
    this.on('add-measure', 'click', () => { this.parkEntry(); this.execute({ type: 'append-measure', afterMeasureId: this.cursor.measureId, voiceIndex: this.cursor.voiceIndex }); this.surfaces.close('location-panel'); this.revealAfterRender = true; this.scrollToSelection(); });
    this.on('add-voice', 'click', () => this.execute({ type: 'add-voice', measureId: this.structuralTarget('measure') }));
    this.on('apply-measure', 'click', () => this.applyInspector('measure', draft => {
      const pitched = this.session.signals.score.get().staves.some(staff => staff.id === draft.context.staffId && (staff.notation ?? 'pitched') === 'pitched');
      const values: MeasureInput = { meter: this.value('measure-meter').trim(), groups: this.value('measure-groups').trim(),
        ...(pitched ? { key: this.value('measure-key').trim(), clef: this.value('measure-clef') as Clef } : {}),
        pickup: this.checked('measure-pickup'), incomplete: this.checked('measure-incomplete'), endBar: this.value('measure-end-bar') as Measure['endBar'], repeatStart: this.checked('measure-repeat-start') };
      const patch = Object.fromEntries(draft.dirtyFields.filter(key => pitched || key !== 'key' && key !== 'clef').map(key => [key, values[key as keyof MeasureInput]])) as MeasureInput;
      this.execute({ type: 'set-measure', measureId: draft.targetId, values: patch });
    }));
    this.on('review-short-measure', 'click', async () => {
      const id = this.structuralTarget('measure');
      if (!this.location(id).measure.incomplete) throw new Error('This measure is not marked as an incomplete short measure.');
      if (this.location(id).measure.voices.some(voice => !voice.events.length)) throw new Error('Write each empty voice or add explicit rests before approving a short ending. Unwritten music is not a short ending.');
      if (!await this.confirmAction('Approve this short ending', `Approve bar ${this.location(id).measure.number} on ${this.staffName(this.location(id).staff.id)} as an intentional short ending for publication? This does not approve an unfinished tuplet.`, 'Approve short ending', false)) return;
      this.session.update('Review intentional short measure', project => { if (!project.reviewedShortMeasures.includes(id)) project.reviewedShortMeasures.push(id); });
    });
    this.on('clear-short-review', 'click', () => { const id = this.structuralTarget('measure'); this.session.update('Clear short-measure approval', project => { project.reviewedShortMeasures = project.reviewedShortMeasures.filter(item => item !== id); }); });
    this.on('move-measure-earlier', 'click', () => this.execute({ type: 'move-measure', measureId: this.structuralTarget('measure'), direction: -1 }));
    this.on('move-measure-later', 'click', () => this.execute({ type: 'move-measure', measureId: this.structuralTarget('measure'), direction: 1 }));
    this.on('remove-measure', 'click', async () => {
      const id = this.structuralTarget('measure');
      if (await this.confirmAction('Remove a measure', `Remove bar ${this.location(id).measure.number} from every staff, including hidden parts? One Undo restores the measure and its music.`, 'Remove measure')) this.execute({ type: 'remove-measure', measureId: id });
    });
    this.on('staff-notation', 'change', () => this.syncStaffNotation());
    this.on('apply-staff', 'click', () => this.applyInspector('staff', draft => this.execute({ type: 'set-staff', staffId: draft.targetId, label: this.value('staff-label').trim(), clef: this.value('staff-clef') as Clef, key: this.value('staff-key').trim(), notation: this.value('staff-notation') as StaffNotation })));
    this.on('add-staff', 'click', () => this.applyInspector('staff', () => {
      const notation = this.value('staff-notation') as StaffNotation;
      this.execute({ type: 'add-staff', label: this.value('staff-label').trim() || 'New staff',
        clef: this.value('staff-clef') as Clef, notation,
        ...(notation === 'pitched' ? { key: this.value('staff-key').trim() } : {}) });
    }, true));
    for (const id of ['range-start', 'range-end']) this.on(id, 'change', () => {
      this.parkEntry(); this.clearActiveMarking();
      const from = this.value('range-start') || this.session.selection.anchorId || this.session.selection.primaryId;
      const through = this.value('range-end') || from;
      if (!from || !through) throw new Error('Choose both passage boundaries.');
      const initial = reduceSelection(this.session.selection, { type: 'replace', id: from }, this.selectionContext());
      if (initial.reason) throw new Error(initial.reason);
      const result = reduceSelection(initial.state, { type: 'range', id: through }, this.selectionContext());
      if (result.reason) throw new Error(result.reason);
      this.staffInteraction.cancel('selection'); this.session.setSelection(result.state);
      this.inspectionSelectionId = result.state.ids.length === 1 ? result.state.primaryId ?? null : null;
      this.syncRangeFields(); this.syncPanels(false); this.drawSelection(); this.invalidateOffers();
    });
    this.on('tie-events', 'click', () => this.execute({ type: 'tie-events', eventIds: this.selectedEvents() }));
    this.on('clear-ties', 'click', async () => {
      const ids = this.selectedEvents();
      const command: AuthorCommand = { type: 'clear-ties', eventIds: ids };
      const preview = this.session.source.cloneNode(true) as Element;
      applyCommand(preview, command);
      const after = new Map([...preview.querySelectorAll('[id]')].map(element => [element.id, element]));
      const affected = [...this.session.source.querySelectorAll('[id][tie]')]
        .filter(element => element.getAttribute('tie') !== after.get(element.id)?.getAttribute('tie')).map(element => element.id);
      const outside = affected.filter(id => !ids.includes(id));
      if (outside.length) {
        const scopes = [...new Set(affected.map(id => this.entryLocationLabel({
          staffId: this.location(id).staff.id, measureId: this.location(id).measure.id, voiceIndex: this.location(id).voiceIndex,
        })))];
        if (!await this.confirmAction('Clear connected ties', `This clears connected ties on ${affected.length} events, including ${outside.length} outside the selected set: ${scopes.join('; ')}. Written notes and their values remain. One Undo restores the ties.`, 'Clear connected ties', false)) return;
      }
      this.execute(command);
    });
    this.on('duplicate-measures', 'click', () => {
      const measures = this.location().staff.measures;
      const from = measures.findIndex(measure => measure.id === this.value('duplicate-from-measure'));
      const through = measures.findIndex(measure => measure.id === this.value('duplicate-through-measure'));
      if (from < 0 || through < from) throw new Error('Choose a first and last measure in score order.');
      this.execute({ type: 'duplicate-measures', measureIds: measures.slice(from, through + 1).map(measure => measure.id) });
    });
    this.on('convert-kind', 'change', () => this.syncConversionVisibility());
    this.on('convert-events', 'click', async () => {
      const ids = this.selectedEvents(); const kind = this.value('convert-kind') as Extract<AuthorCommand, { type: 'convert-events' }>['kind'];
      const destination = kind === 'slash' ? this.checked('convert-rhythmic') ? 'rhythmic slashes (pitch unspecified)' : 'open slashes (pitch and rhythm improvised)' : kind === 'rest' ? 'rests' : kind === 'rhythm' ? 'rhythm notes (specified durations, no pitch)' : kind === 'road' ? `3 roads notes · ${directionLabel(this.value('convert-direction'))} (relative pitch, written rhythm)` : `notes at ${this.value('convert-pitch')}`;
      const command: AuthorCommand = { type: 'convert-events', eventIds: ids, kind, rhythmic: kind === 'slash' && this.checked('convert-rhythmic'), pitch: this.value('convert-pitch').trim(),
        ...(kind === 'road' ? { pitchDirection: this.value('convert-direction') as PitchDirection } : {}) };
      if (!await this.confirmAction('Convert this passage', `Replace ${ids.length} event(s) with ${destination}? Existing pitches or pitch directions will be removed or replaced. Compatible attached marks are kept; remove incompatible marks before converting. Nominal written durations remain; open slashes do not require those attacks. Undo restores the passage.`, 'Convert passage')) return;
      this.execute(command);
    });
    this.on('fill-rests', 'click', async () => {
      const command: AuthorCommand = { type: 'fill-rests', measureId: this.cursor.measureId, voiceIndex: this.cursor.voiceIndex };
      const preview = this.session.source.cloneNode(true) as Element; const before = new Set([...preview.querySelectorAll('[id]')].map(element => element.id));
      applyCommand(preview, command);
      const rests = [...preview.querySelectorAll('music-rest')].filter(element => !before.has(element.id)).map(element => `${element.getAttribute('duration') ?? 'measure'}${element.hasAttribute('dots') ? ` (${element.getAttribute('dots')} dots)` : ''}`);
      if (preview.isEqualNode(this.session.source)) { this.status('This voice already fills the measure.'); return; }
      if (!rests.length) {
        if (await this.confirmAction('Mark this full bar complete', `Every voice in bar ${this.location().measure.number} on ${this.staffName(this.cursor.staffId)} already fills its meter. Remove its incomplete-draft flag without adding or changing notes or rests? One Undo restores the draft flag.`, 'Mark this full bar complete', false)) this.execute(command);
      } else if (await this.confirmAction('Complete this voice with rests', `Fill ${this.entryLocationLabel(this.cursor)} with ${rests.join(', ')} rest(s)? Existing notes and tuplets stay unchanged.`, 'Fill with rests', false)) this.execute(command);
    });
    this.on('tuplet-select', 'change', () => { const id = this.value('tuplet-select'); if (id) this.select(id, false); });
    this.on('wrap-tuplet', 'click', () => this.applyInspector('tuplet', draft => {
      if (!draft.context.creating || !draft.context.eventIds?.length) throw new Error('Choose the events for a new tuplet first.');
      this.execute({ type: 'wrap-tuplet', eventIds: draft.context.eventIds, ...this.tupletValues() });
    }, true));
    this.on('update-tuplet', 'click', () => this.applyInspector('tuplet', draft => {
      if (draft.context.creating) throw new Error('Choose an existing tuplet first.');
      this.execute({ type: 'set-tuplet', tupletId: draft.targetId, ...this.tupletValues() });
    }));
    this.on('unwrap-tuplet', 'click', () => this.applyInspector('tuplet', draft => {
      if (draft.context.creating) throw new Error('Choose an existing tuplet first.');
      this.execute({ type: 'unwrap-tuplet', tupletId: draft.targetId });
    }, true));
    this.on('add-part', 'click', () => this.editPart(false)); this.on('update-part', 'click', () => this.editPart(true));
    this.on('remove-part', 'click', async () => {
      const id = this.structuralTarget('part');
      const project = this.session.project;
      const label = partLabel(project.parts.find(part => part.id === id)!, project.parts);
      if (!await this.confirmAction('Remove a part definition', `Remove “${label}” and its page layout? Its musical staves remain in the full score. One Undo restores the part definition.`, 'Remove part')) return;
      this.partId = 'score';
      this.session.update('Remove part', project => {
        project.parts = project.parts.filter(part => part.id !== id); delete project.layouts[id];
        for (const [key, scope] of Object.entries(project.instructionScopes)) if (Array.isArray(scope) && scope.includes(id)) {
          const kept = scope.filter(part => part !== id); if (!kept.length) delete project.instructionScopes[key]; else project.instructionScopes[key] = kept;
        }
      });
    });
    this.on('apply-pages', 'click', () => this.applyInspector('page', draft => {
      const values = { paper: this.value('page-paper'), orientation: this.value('page-orientation'), marginMm: this.numeric('page-margin'), staffScale: this.numeric('page-scale'), maxMeasures: this.value('page-max-measures').trim() ? this.numeric('page-max-measures') : null, measureNumbers: this.value('page-measure-numbers'), justifyLast: this.checked('page-justify-last') };
      this.session.update('Change page settings', project => {
        const profile = project.layouts[draft.context.partId!] ??= defaultLayout();
        Object.assign(profile, Object.fromEntries(draft.dirtyFields.map(key => [key, values[key as keyof typeof values]])));
      });
    }));
    this.on('apply-break', 'click', () => this.applyInspector('boundary', draft => {
      const column = draft.context.columnId!;
      this.session.update('Change this layout boundary', project => {
        const profile = project.layouts[draft.context.partId!] ??= defaultLayout();
        if (draft.dirtyFields.includes('breakBefore')) profile.breaks[column] = this.value('layout-break') as LayoutProfile['breaks'][string];
        if (draft.dirtyFields.includes('keepWithNext')) profile.keeps[column] = this.checked('layout-keep');
      });
    }));
    this.on('print-draft', 'change', () => { this.refreshPreflight(); }); this.on('ack-layout-warnings', 'change', () => { this.refreshPreflight(); });
    this.on('print-score', 'click', () => this.print());
    this.on('turn-boundary', 'change', () => this.renderTurn());
    this.on('mark-turn-reviewed', 'click', () => this.reviewTurn(true)); this.on('clear-turn-review', 'click', () => this.reviewTurn(false));
    this.on('source-editor', 'source-change', event => {
      const text = (event as CustomEvent<SourceValueDetail>).detail.value;
      this.sourceEditor.refreshFailure(this.session.signals.project.get().id, text);
      try { this.session.setPendingSource(text === this.session.signals.project.get().sourceHtml ? null : text); }
      catch (error) { this.sourceEditor.fail(this.session.signals.project.get().id, text, messageOf(error)); throw error; }
    });
    this.on('source-editor', 'source-apply', event => {
      if (this.mode !== 'write') throw new Error('Return to Write to apply Source.');
      const text = (event as CustomEvent<SourceValueDetail>).detail.value;
      this.sourceEditor.clearFailure();
      try { this.session.applySource(text); }
      catch (error) { this.sourceEditor.fail(this.session.signals.project.get().id, text, messageOf(error)); throw error; }
    });
    this.on('source-editor', 'source-revert', () => {
      this.sourceEditor.clearFailure(); this.session.setPendingSource(null); this.syncSourceNotice(true);
    });
    this.on('read-previous', 'click', () => this.moveReading(-1)); this.on('read-next', 'click', () => this.moveReading(1));
    this.on('read-go', 'click', () => { this.select(this.value('read-measure'), false); this.scrollToSelection(); });
    this.on('read-refit', 'click', () => { this.readingWidth = undefined; this.requestRender(); });
    this.on('event-navigator', 'navigate-request', event => {
      const detail = (event as CustomEvent<{ sourceId: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>).detail;
      if (!detail?.sourceId) return;
      this.parkEntry();
      this.select(detail.sourceId, false, selectionModifier(detail) ?? (this.selectMore ? 'toggle' : 'replace'));
      this.scrollToSelection();
    });
    this.el('score-host').addEventListener('notation-select', (event) => {
      if (this.isScoreInputBlocked() || this.blockedScorePress) return;
      const detail = (event as CustomEvent<NotationSelectionDetail>).detail;
      if (isNativeSecondaryClick({ button: 0, ctrlKey: detail.ctrlKey })) return;
      if (this.mode !== 'write') { this.select(detail.sourceId); return; }
      const modifier = selectionModifier(detail);
      // Entry commits on release. Its compatibility clicks never become an
      // implicit edit shortcut or steal the next insertion's destination.
      if (this.entryMode && !modifier && !this.selectMore) return;
      const previous = this.lastNotationClick;
      const wasMore = this.selectMore;
      const double = detail.clickCount === 2 && !modifier && !wasMore && previous?.id === detail.sourceId
        && previous.documentEpoch === this.session.documentEpoch && previous.selectionVersion === this.session.selectionVersion;
      this.parkEntry();
      if (!this.select(detail.sourceId, false, modifier ?? (wasMore ? 'toggle' : 'replace'))) return;
      if ((modifier || wasMore) && this.location(detail.sourceId).event?.markings?.some(mark => mark.id === detail.sourceId)) {
        this.status('Selection applies to the owning event; the attached marking remains on that event.');
      }
      this.lastNotationClick = { id: detail.sourceId, documentEpoch: this.session.documentEpoch, selectionVersion: this.session.selectionVersion };
      if (!this.location().annotation) {
        this.el('score-editor').focus({ preventScroll: true });
        if (double) void this.run(() => this.activateSelection());
      }
    }, { signal: this.abort.signal });
    this.el('score-host').addEventListener('click', (event) => this.selectAtPoint(event as MouseEvent), { signal: this.abort.signal });
    for (const id of ['score-editor', 'workspace-dock']) this.el(id).addEventListener('keydown', (event) => {
      void this.run(() => this.keyboard(event as KeyboardEvent));
    }, { signal: this.abort.signal });
    for (const kind of ['copy', 'paste'] as const) this.el('score-editor').addEventListener(kind, event => {
      const clipboard = event as ClipboardEvent;
      if (event.defaultPrevented || this.mode !== 'write' || this.isScoreInputBlocked() || isNativeAuthorInput(event)
        || document.body.dataset.pointerGesture || this.pitchDragArmed || this.entryDragArmed
        || window.getSelection()?.isCollapsed === false || !clipboard.clipboardData) return;
      const path = event.composedPath();
      const owner = classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface });
      if (!['score-editor', 'score-scroll', 'score-host'].some(id => path[0] === this.el(id)) && path[0] !== this.surface && owner.owner !== 'notation') return;
      event.preventDefault();
      void this.run(() => {
        if (kind === 'copy') {
          if (this.entryMode) throw new Error('Choose Select and select notes to copy.');
          if (this.currentMarking()) throw new Error('Select the notes themselves to copy their attached marks.');
          const text = copyMusic(this.session.score, this.session.selection.ids);
          clipboard.clipboardData!.setData('text/plain', text);
          clipboard.clipboardData!.setData(MUSIC_CLIPBOARD_TYPE, text);
          this.status(`Copied ${this.session.selection.ids.length} event${this.session.selection.ids.length === 1 ? '' : 's'}. Choose Write notes and paste at its cursor.`);
        } else {
          if (!this.entryMode) throw new Error('Choose Write notes and a writing location before pasting.');
          const text = clipboard.clipboardData!.getData(MUSIC_CLIPBOARD_TYPE) || clipboard.clipboardData!.getData('text/plain');
          this.execute({ type: 'paste-music', cursor: { ...this.cursor }, text,
            position: this.value('insert-position') === 'before' ? 'before' : 'after' });
          this.finishInsertion();
        }
      });
    }, { signal: this.abort.signal });
    document.addEventListener('selectstart', event => {
      // A fresh browser text gesture relinquishes score shortcuts. Keep the
      // Range itself intact; selecting notation explicitly claims focus again.
      if (event.defaultPrevented || classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface }).owner === 'notation') return;
      const focused = this.controlScope.activeElement;
      if (focused === this.el('score-editor') || focused === this.el('score-scroll')) (focused as HTMLElement).blur();
    }, { signal: this.abort.signal });
    document.addEventListener('pointerdown', event => {
      const path = event.composedPath();
      const score = ['score-editor', 'drag-entry', 'drag-pitch'].some(id => path.includes(this.el(id)));
      this.scorePressActive = score;
      this.blockedScorePress = score && this.isScoreInputBlocked();
    }, { capture: true, passive: true, signal: this.abort.signal });
    for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, () => {
      this.scorePressActive = false;
    }, { capture: true, passive: true, signal: this.abort.signal });
    // This also covers chooser popovers owned by SelectionControls and native
    // Document openings. A surface is a temporary task, never a mode switch.
    for (const root of this.controlScope.roots) root.addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState === 'open') this.cancelForSurface();
    }, { capture: true, signal: this.abort.signal });
  }

  private requireValue(id: string, message: string): string { const value = this.value(id); if (!value) throw new Error(message); return value; }
  private tupletValues() { return { actual: this.numeric('tuplet-actual'), normal: this.numeric('tuplet-normal'), bracket: this.value('tuplet-bracket') as 'auto' | 'yes' | 'no', ratio: this.checked('tuplet-ratio') }; }
  private structuralTarget(form: 'selected' | 'measure' | 'part'): string {
    this.requireWriting();
    const draft = this.inspectors.snapshot(form);
    if (!draft.targetId || draft.context?.creating) throw new Error(`Choose an existing ${form === 'selected' ? 'event' : form} first.`);
    if (!draft.matchesSelection || draft.status === 'missing' || draft.status === 'document-changed') {
      throw new Error(`This form still names ${draft.label ?? 'its original target'}. Return to that target or discard the draft before using this action. Nothing changed.`);
    }
    return draft.targetId;
  }
  private syncStructuralActions(): void {
    if (!this.inspectors) return;
    for (const [form, ids] of [
      ['selected', ['remove-event']],
      ['measure', ['add-voice', 'move-measure-earlier', 'move-measure-later', 'remove-measure', 'review-short-measure', 'clear-short-review']],
      ['part', ['remove-part']],
    ] as const) {
      const draft = this.inspectors.snapshot(form);
      const blocked = this.mode !== 'write' || this.session.signals.pendingSource.get() !== null || !draft.targetId
        || !!draft.context?.creating || !draft.matchesSelection || draft.status === 'missing' || draft.status === 'document-changed';
      for (const id of ids) {
        const button = this.el<HTMLButtonElement>(id); button.disabled = blocked;
        button.title = blocked && draft.dirty ? 'Return to the named draft target or discard its fields before this action.' : '';
        button.setAttribute('aria-describedby', `${form}-draft-status`);
      }
    }
    const measureDraft = this.inspectors.snapshot('measure');
    const measureTargetId = measureDraft.targetId;
    const inspectedMeasure = this.session.signals.score.get().staves.flatMap(staff => staff.measures).find(measure => measure.id === measureTargetId);
    const hasEmptyVoice = inspectedMeasure?.voices.some(voice => !voice.events.length) === true;
    const review = this.el<HTMLButtonElement>('review-short-measure');
    review.disabled ||= !inspectedMeasure?.incomplete || hasEmptyVoice;
    review.setAttribute('aria-describedby', `measure-draft-status short-ending-help${hasEmptyVoice ? ' short-ending-empty-help' : ''}`);
    const emptyHelp = this.el('short-ending-empty-help');
    emptyHelp.hidden = !hasEmptyVoice;
    if (hasEmptyVoice) {
      const writingInEmptyVoice = this.cursor.measureId === inspectedMeasure!.id
        && inspectedMeasure!.voices[this.cursor.voiceIndex]?.events.length === 0;
      emptyHelp.textContent = !measureDraft.matchesSelection
        ? 'This measure has unwritten voices. Use Return to target first, then choose an empty voice in Location & actions before writing or using Fill remainder with rests.'
        : writingInEmptyVoice
          ? 'This measure has unwritten voices. Write each empty voice or use Fill remainder with rests below before approving a short ending.'
          : 'This measure has unwritten voices. In Location & actions, choose this measure and an empty voice before writing or using Fill remainder with rests.';
    }
    if (hasEmptyVoice) review.title = 'Write each empty voice or add explicit rests before approving a short ending.';
    this.el<HTMLButtonElement>('clear-short-review').disabled ||= !inspectedMeasure || !this.session.signals.project.get().reviewedShortMeasures.includes(inspectedMeasure.id);
  }
  private applyInspector(form: InspectorFormName, action: (draft: InspectorResolution) => void, consume = false): void {
    try {
      const draft = this.inspectors.resolve(form);
      if (!draft.changed && !consume) { this.inspectors.commit(form); this.status('These values already match the accepted music.'); return; }
      action(draft);
      if (consume) this.inspectors.consume(form); else this.inspectors.commit(form);
    } catch (error) { this.inspectors.markFailure(form, error); throw error; }
  }
  private insertionCommand(): Insertion {
    const location = this.location();
    const value = this.readEvent();
    const starter = location.voice.events.length === 1 && location.voice.events[0].measureRest;
    return { type: 'insert-event', flow: true, cursor: { ...this.cursor, eventId: this.cursor.eventId ?? (starter ? location.voice.events[0].id : undefined) }, value,
      position: starter ? 'replace' : this.value('insert-position') as 'before' | 'after' | 'replace' };
  }
  private recipeKey(): string { return JSON.stringify({ value: this.readEvent(), position: this.value('insert-position') }); }
  private syncInsertAction(): void {
    const button = this.el<HTMLButtonElement>('insert-event');
    const label = this.el('insert-event-label');
    const caption = this.el('insert-event-destination');
    const destination = this.el('entry-destination');
    const localContinue = this.el<HTMLButtonElement>('continue-piece');
    destination.hidden = true; destination.textContent = ''; localContinue.hidden = true; localContinue.disabled = true;
    label.textContent = 'Insert here'; caption.textContent = ''; caption.hidden = true;
    button.title = 'Insert at the current musical location';
    button.setAttribute('aria-label', 'Insert at the current musical location');
    button.disabled = this.mode !== 'write' || this.session.signals.pendingSource.get() !== null;
    if (button.disabled) { this.syncReviewNotice(); return; }
    try {
      const analysis = analyzeContinuation(this.session.source, this.insertionCommand());
      if (analysis.eligible) {
        label.textContent = 'Add + insert';
        caption.textContent = `Bar ${analysis.newMeasureLabel}`; caption.hidden = false;
        button.title = `Add bar ${analysis.newMeasureLabel} to every staff and insert in ${this.staffName(this.cursor.staffId)}, bar ${analysis.newMeasureLabel}, voice ${this.cursor.voiceIndex + 1}. One Undo restores both.`;
        button.setAttribute('aria-label', `Add measure and insert: ${button.title}`);
        if (this.entryMode) { destination.hidden = false; destination.textContent = `Next with Insert: bar ${analysis.newMeasureLabel} · ${this.staffName(this.cursor.staffId)} · voice ${this.cursor.voiceIndex + 1}`; }
      } else if (analysis.ending) {
        label.textContent = 'Add + insert'; button.title = 'Continue writing in a new measure; the final barline moves to the new ending.';
        button.setAttribute('aria-label', button.title);
      }
    } catch { /* Invalid entry values stay editable; Insert explains the error. */ }
    this.syncReviewNotice();
  }
  private invalidateOffers(): void {
    this.continuationOffer = undefined; this.pointerOffer = undefined;
    this.surfaces?.close('continuation-review'); this.surfaces?.close('pointer-recovery');
  }
  private captureOffer(command: Insertion, pointer: boolean): ContinuationOffer {
    return { documentId: this.session.signals.project.get().id, revision: this.session.revision, selectionId: this.session.selectionId,
      selectionFingerprint: this.selectionFingerprint(),
      command: structuredClone(command), recipe: this.recipeKey(), pointer };
  }
  private reviewEnding(offer: ContinuationOffer): void {
    const analysis = analyzeContinuation(this.session.source, offer.command);
    if (!analysis.ending) throw new Error(analysis.reason);
    this.continuationOffer = offer;
    const endings = analysis.affectedStaves.filter(staff => staff.endBar === 'final').map(staff => `${this.staffName(staff.staffId)} (bar ${staff.measureNumber})`).join(', ');
    const destination = `${this.staffName(offer.command.cursor.staffId)}, bar ${analysis.newMeasureLabel}, voice ${offer.command.cursor.voiceIndex + 1}`;
    this.el('continuation-review-context').textContent = `Continue after bar ${analysis.currentMeasureLabel}? Change final barlines to single barlines on ${endings}. Add an aligned measure to every staff, including hidden parts, and insert ${this.entryDescription(offer.command.value)} at ${destination}. One Undo restores the ending and music.`;
    this.surfaces.open('continuation-review', '#confirm-continue-piece');
  }
  private offerPointerContinuation(command: Insertion, _error: unknown): boolean {
    if (this.mode !== 'write' || this.session.signals.pendingSource.get() !== null) return false;
    const analysis = analyzeContinuation(this.session.source, command);
    if (!analysis.eligible && !analysis.ending) return false;
    this.pointerOffer = this.captureOffer(command, true);
    this.el('pointer-recovery-context').textContent = `No music changed. The voice at ${this.entryLocationLabel(command.cursor)} is full. ${analysis.ending ? 'Review the final barlines, then add' : 'Add'} bar ${analysis.newMeasureLabel} to every staff and insert the captured ${this.entryDescription(command.value)} on ${this.staffName(command.cursor.staffId)}, voice ${command.cursor.voiceIndex + 1}?`;
    setControlLabel(this.el('confirm-pointer-recovery'), analysis.ending ? 'Review ending…' : 'Add measure and insert');
    this.surfaces.open('pointer-recovery', '#confirm-pointer-recovery');
    return true;
  }
  private confirmContinuation(pointer: boolean): void {
    this.requireWriting();
    const offer = pointer ? this.pointerOffer : this.continuationOffer;
    if (!offer || offer.documentId !== this.session.signals.project.get().id || offer.revision !== this.session.revision
      || offer.selectionId !== this.session.selectionId || offer.selectionFingerprint !== this.selectionFingerprint() || offer.recipe !== this.recipeKey()) {
      this.invalidateOffers(); throw new Error('That insertion offer changed. Choose the location and try again.');
    }
    const analysis = analyzeContinuation(this.session.source, offer.command);
    if (pointer && analysis.ending) { this.surfaces.close('pointer-recovery'); this.reviewEnding(offer); return; }
    if (pointer ? !analysis.eligible : !analysis.ending) { this.invalidateOffers(); throw new Error(analysis.reason); }
    this.execute(pointer ? { ...offer.command, type: 'append-and-insert' }
      : { ...offer.command, type: 'continue-piece', confirmation: 'final-to-single' });
    if (offer.pointer && offer.command.value.kind === 'note') this.setValue('event-pitch', offer.command.value.pitch);
    this.finishInsertion();
  }
  private insert(_keyboard = false): void {
    this.requireWriting();
    const command = this.insertionCommand();
    this.execute(command);
    this.finishInsertion();
  }
  private finishInsertion(): void {
    this.closeTransientSurfaces(); this.invalidateOffers();
    this.selectionError = undefined; document.body.dataset.selectionFeedback = 'none'; this.el('author-errors').hidden = true;
    this.clearActiveMarking();
    this.rangeStart = ''; this.rangeEnd = ''; this.entryMode = true; this.setValue('insert-position', 'after');
    this.rememberEntry(); this.syncEntryVisibility(); this.revealAfterRender = true;
    this.requestRender();
    this.el('score-editor').focus({ preventScroll: true });
  }
  private commitMetadata(): void {
    clearTimeout(this.metadataTimer);
    this.metadataDirty = false;
    const metadata = { title: this.value('project-title').trim() || 'Untitled composition', composer: this.value('project-composer').trim(), subtitle: this.value('project-subtitle').trim() };
    if (JSON.stringify(metadata) !== JSON.stringify(this.session.signals.project.get().metadata)) this.session.update('Edit composition details', project => { project.metadata = metadata; });
  }
  private editPart(update: boolean): void {
    this.applyInspector('part', draft => {
      const label = this.value('part-label').trim(); const staffIds = this.checkedValues('part-staves');
      if (!label || !staffIds.length) throw new Error('Name the part and choose at least one staff.');
      if (update && draft.context.creating) throw new Error('Choose an existing part to update.');
      const id = update ? draft.targetId : `part-${crypto.randomUUID()}`;
      this.session.update(update ? 'Update part' : 'Create part', project => {
        if (update) { const part = project.parts.find(part => part.id === id)!; part.label = label; part.staffIds = staffIds; }
        else { project.parts.push({ id, label, staffIds }); project.layouts[id] = defaultLayout(); }
      });
      this.partId = id; this.syncPanels(false); this.requestRender();
    }, !update);
  }
  private changed(event: CustomEvent<{ label: string; kind: string; revision: number; selectionId?: string }>): void {
    if (this.disposed) return;
    const change = event.detail;
    if (change.label === 'Select') return;
    this.staffInteraction.cancel('source');
    this.invalidateOffers();
    document.body.dataset.authorPrintReady = 'false';
    if (change.kind === 'draft') {
      this.listen?.refresh();
      this.syncSourceNotice();
      this.syncEntryVisibility();
      if (this.pageView) this.pageViewRevision = this.session.revision;
      document.body.dataset.authorRevision = String(this.session.revision);
      this.scheduleSave(); this.refreshPreflight(); return;
    }
    this.el('author-errors').hidden = true;
    this.selectionError = undefined; document.body.dataset.selectionFeedback = 'none';
    const lostWriting = this.entryMode && !!this.bookmark && !this.validBookmark()
      && !this.advancingWriting && change.kind !== 'history' && change.kind !== 'replace';
    if (lostWriting) {
      // A successful Source edit may remove or reparent the old writer. Its
      // fallback is for inspection only, never permission to write elsewhere.
      this.entryMode = false; this.entryDragArmed = false;
    }
    const restored = this.session.cursor;
    if (restored) this.cursor = restored;
    else if (change.kind === 'source' || change.kind === 'replace') this.cursor = { staffId: this.session.signals.score.get().staves[0].id, measureId: this.session.signals.score.get().staves[0].measures[0].id, voiceIndex: 0 };
    if (!this.entryMode) {
      const location = this.location(change.selectionId);
      this.cursor = { staffId: location.staff.id, measureId: location.measure.id, voiceIndex: location.voiceIndex, eventId: location.event?.id };
    }
    if (change.kind === 'replace') {
      clearTimeout(this.metadataTimer); this.metadataDirty = false;
      this.sourceEditor.clearFailure(); this.syncSourceNotice(true);
      this.clearActiveMarking(); this.markingRecovery = undefined;
      this.partId = 'score'; this.rangeStart = ''; this.rangeEnd = ''; this.bookmark = undefined;
      this.entryMode = false; this.entryDragArmed = false; this.resumeWritingAfterView = false;
      this.inspectionSelectionId = null; this.propertiesVisited = false; this.selectMore = false; this.pitchDragArmed = false;
      this.lastNotationClick = undefined;
    }
    this.check('ack-layout-warnings', false);
    this.pageView = undefined;
    // History restores the writing cursor even while another event is being
    // inspected. Resolve that cursor directly, before rendering Resume's state.
    if (change.kind === 'history' && restored && !this.editingNote && (this.entryMode || this.bookmark)) {
      this.rememberEntry(restored, this.bookmark?.partId ?? this.partId);
    }
    this.syncPanels(false);
    const notices = getProjectNotices(this.session.project);
    this.status([lostWriting ? 'The previous writing location changed. Choose Write notes to pick a new location.' : change.label, ...notices].join(' · '));
    this.scheduleSave(); this.requestRender();
  }
  private scheduleSave(): void { clearTimeout(this.saveTimer); this.el('save-status').textContent = 'Saving locally…'; this.saveTimer = setTimeout(() => { void this.saveNow(); }, 300); }
  private saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.recoveryBlocked) {
      this.recoveryWarning ||= 'Recovery unavailable. Download a project to keep your work.';
      this.el('save-status').textContent = 'Recovery unavailable · download a project to keep your work';
      this.syncReviewNotice(); return Promise.resolve();
    }
    const revision = this.session.revision;
    if (this.savedRevision === revision || this.saveRequestedRevision === revision) return this.saveWork;
    const project = this.session.project;
    this.saveRequestedRevision = revision;
    this.saveWork = this.saveWork.then(async () => {
      const result = await this.recovery.saveCoordinated(project);
      if (result.status === 'saved') this.savedRevision = revision;
      if (result.status !== 'saved') this.saveRequestedRevision = -1;
      this.recoveryWarning = result.status === 'saved' ? '' : result.message;
      // Persistence can finish after disposal; only the active workspace may
      // publish UI into a retained shell now owned by another session.
      if (this.disposed) return;
      this.el('save-status').textContent = result.status === 'saved'
        ? this.session.revision === revision ? 'Saved on this device · download a backup' : 'Unsaved changes · saving locally…'
        : result.message;
      if (result.status === 'conflict') this.showError(`${result.message} Download this copy before reloading to review the other version.`);
      this.syncReviewNotice();
    }).catch(error => {
      this.saveRequestedRevision = -1;
      this.recoveryWarning = `Recovery failed: ${messageOf(error)}. Download a project to keep your work.`;
      if (this.disposed) return;
      this.el('save-status').textContent = this.recoveryWarning; this.syncReviewNotice();
    });
    return this.saveWork;
  }
  private download(text: string, type: string, suffix: string): void {
    const url = URL.createObjectURL(new Blob([text], { type })); const link = node('a');
    link.href = url; link.download = `${(this.session.signals.project.get().metadata.title || 'music-notes').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0,80) || 'music-notes'}${suffix}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private setMode(mode: ViewMode): void {
    const previous = this.mode;
    if (mode !== 'listen') this.listen?.stop();
    this.staffInteraction.cancel('mode'); this.closeTransientSurfaces(); this.invalidateOffers();
    if (previous === 'write' && mode !== 'write') {
      this.resumeWritingAfterView = this.entryMode; this.parkEntry(); this.entryDragArmed = false;
    }
    this.viewport.cancel(); this.viewportRestore = undefined; this.sheetViewportRestore = undefined;
    this.deferredSheetReturn = false; this.revealAfterRender = false;
    this.mode = mode;
    if (previous !== 'write' && mode === 'write' && this.resumeWritingAfterView) {
      const mark = this.validBookmark();
      if (mark) {
        this.partId = mark.partId; this.cursor = { ...mark.cursor };
        this.session.setCursor(this.cursor); this.entryMode = true;
      } else {
        this.entryMode = false;
        this.status('The previous writing location is unavailable. Choose Write notes to pick a new location.');
      }
      this.resumeWritingAfterView = false;
    }
    this.tools.setMode(mode);
    document.body.dataset.view = mode;
    const switcher = this.el<AuthorViewSwitch>('view-switch');
    switcher.mode = mode; switcher.mount();
    this.el('author-workbench').setAttribute('mode', mode);
    for (const view of ['write', 'read', 'listen', 'pages']) this.el(`${view}-tools`).hidden = view !== mode;
    this.el('score-editor').hidden = mode === 'pages'; this.el('page-host').hidden = mode !== 'pages';
    this.el('author-workbench').hidden = mode === 'pages';
    this.el('workspace-dock').hidden = mode !== 'write';
    this.el('pointer-tools').hidden = mode !== 'write';
    this.el<HTMLAnchorElement>('skip-to-score').href = mode === 'pages' ? '#page-host' : '#score-editor';
    this.el('skip-to-score').textContent = mode === 'pages' ? 'Skip to the pages' : 'Skip to the score';
    this.el('page-host').tabIndex = -1;
    this.el('selection-toolbar').hidden = mode !== 'write'; this.el('navigator-panel').hidden = mode !== 'write'; this.el('keyboard-help').hidden = mode !== 'write';
    this.el<HTMLButtonElement>('source-trigger').disabled = mode !== 'write';
    this.el<HTMLButtonElement>('score-setup-trigger').disabled = mode !== 'write';
    if (mode === 'write') this.measureWritingFrame();
    this.syncPanels(false); this.syncPointerOffset(); this.requestRender();
    if (mode === 'read') this.el('score-editor').focus({ preventScroll: true });
    if (mode === 'listen') void this.openListen();
  }
  private async openListen(): Promise<void> {
    try {
      this.listenLoading ??= import('./listen-controller.js').then(({ ListenController }) => {
        if (this.disposed) return;
        this.listen = new ListenController({
          control: <T extends HTMLElement = HTMLElement>(id: string) => this.el<T>(id),
          snapshot: () => ({ project: this.session.project, partId: this.partId, active: this.mode === 'listen', hasDrafts: this.dirtyInspectorCount() > 0 }),
          highlight: ids => { this.playingIds = ids; this.drawSelection(); },
        });
      });
      await this.listenLoading;
      if (this.mode === 'listen' && !this.disposed) this.listen?.refresh();
    } catch (error) {
      this.listenLoading = undefined;
      this.el('listen-status').textContent = `Listen could not load: ${messageOf(error)}`;
    }
  }
  private requestRender(): void {
    this.staffInteraction.cancel('render');
    this.notationReviewContext = undefined; this.setNotationNotices([]);
    if (this.mode !== 'pages' && this.tools.state.presentation !== 'sheet' && !this.deferredSheetReturn && !this.layoutTransition && !this.revealAfterRender) this.viewportRestore = this.viewport.capture();
    if (this.revealAfterRender) { this.viewport.cancel(); this.viewportRestore = undefined; }
    const generation = ++this.renderGeneration;
    document.body.dataset.renderState = 'rendering'; document.body.dataset.authorPrintReady = 'false';
    // Revoke old screen coordinates before awaiting fonts or new engraving.
    this.selectionHud?.refresh();
    this.renderWork = this.render(generation).catch(error => {
      if (generation !== this.renderGeneration || this.disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
      document.body.dataset.renderState = 'error'; this.showError(error);
    }).finally(() => { if (generation === this.renderGeneration) document.body.dataset.authorReady = 'true'; });
  }
  private async render(generation: number): Promise<void> {
    const project = this.session.project; const mode = this.mode;
    // Pending source text changes recovery state, not the accepted music being
    // rendered. Accepted musical/metadata changes always create a new generation.
    const current = () => !this.disposed && generation === this.renderGeneration;
    if (mode === 'pages') {
      const result = await renderPageView(this.el('page-host'), project, this.partId, current);
      if (!current()) return;
      this.pageView = result; this.pageViewRevision = this.session.revision;
      this.pageViewGeneration = generation; this.pageViewPartId = this.partId;
      this.renderTurnOptions();
    } else {
      const projectionKey = JSON.stringify([project.sourceHtml, this.partId, project.parts, project.instructionScopes, this.profile()]);
      if (!this.surface || this.renderedProjectionKey !== projectionKey) {
        const projection = buildProjection(project, this.partId);
        if (projection.diagnostics.some(item => item.severity === 'error')) throw new Error(projection.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('\n'));
        const imported = document.importNode(projection.source, true) as MusicSurface;
        if (!(imported instanceof MusicSurface)) throw new Error('The musical source did not create a supported score surface.');
        if (this.surface?.localName === imported.localName) {
          for (const attribute of [...this.surface.attributes]) if (!imported.hasAttribute(attribute.name)) this.surface.removeAttribute(attribute.name);
          for (const attribute of [...imported.attributes]) this.surface.setAttribute(attribute.name, attribute.value);
          this.surface.replaceChildren(...imported.childNodes);
        } else { this.surface = imported; this.scoreMount.replaceChildren(imported); }
        this.renderedProjectionKey = projectionKey;
      }
      const surface = this.surface!;
      if (this.observedSurface !== surface) {
        this.surfaceScrollAbort?.abort(); this.surfaceScrollAbort = new AbortController(); this.observedSurface = surface;
        surface.addEventListener('notation-diagnostics', event => {
          // A listener earlier in this event's path can accept newer Source.
          // During an Author render, only its awaited current refresh may
          // publish notices; standalone resize updates arrive while ready.
          if (event.target === surface && document.body.dataset.renderState === 'ready') this.collectNotationNotices(surface);
        }, { signal: this.surfaceScrollAbort.signal });
      }
      surface.diagnosticsPresentation = 'errors';
      this.notationReviewContext = { surface, generation, documentId: project.id, sourceHtml: project.sourceHtml, partId: this.partId };
      surface.removeAttribute('print-preview');
      surface.style.width = mode === 'read' ? `${this.readingWidth ??= Math.max(240, Math.floor(this.el('score-host').getBoundingClientRect().width))}px` : '';
      surface.addEventListener('notation-render', () => { this.staffInteraction.cancel('render'); this.drawSelection(); }, { once: true, signal: this.abort.signal });
      await surface.refresh();
      if (!current()) return;
      this.collectNotationNotices(surface);
      if (surface.diagnostics.some(item => item.severity === 'error')) throw new Error(surface.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('\n'));
      this.drawSelection();
    }
    if (!current()) return;
    document.body.dataset.renderState = 'ready'; document.body.dataset.authorRevision = String(this.session.revision);
    if (mode === 'pages') this.refreshPreflight();
    else {
      if (this.revealAfterRender) { this.revealAfterRender = false; this.scrollToSelection(); }
      else if (this.tools.state.presentation !== 'sheet') this.viewport.restore(this.viewportRestore);
      this.viewportRestore = undefined; this.deferredSheetReturn = false; this.syncReturnControl(); this.drawSelection();
    }
  }

  private drawSelection(): void {
    this.selectionHud?.refresh();
    this.overlays.replaceChildren();
    const activeMarkingId = this.currentMarking()?.marking.id;
    if ((this.mode !== 'write' && this.mode !== 'listen') || !this.surface) return;
    const projection = this.surface.getRenderedProjection(); if (!projection) return;
    const bounds = this.el('score-host').getBoundingClientRect();
    const chosen = new Set<string>();
    if (this.mode === 'listen') for (const id of this.playingIds) chosen.add(id);
    else if (activeMarkingId) chosen.add(activeMarkingId);
    else try { for (const id of this.selectedEvents()) chosen.add(id); } catch { if (this.session.selectionId) chosen.add(this.session.selectionId); }
    const box = (svg: SVGSVGElement, region: { sourceId?: string; x: number; y: number; width: number; height: number }, className: string) => {
      const matrix = svg.getScreenCTM(); if (!matrix) return;
      const start = new DOMPoint(region.x, region.y).matrixTransform(matrix);
      const end = new DOMPoint(region.x + region.width, region.y + region.height).matrixTransform(matrix);
      const element = node('div', '', className);
      if (region.sourceId) element.dataset.sourceId = region.sourceId;
      element.style.left = `${start.x - bounds.left - 3}px`; element.style.top = `${start.y - bounds.top - 3}px`;
      element.style.width = `${Math.max(2, end.x - start.x + 6)}px`; element.style.height = `${Math.max(4, end.y - start.y + 6)}px`;
      this.overlays.append(element);
    };
    for (const { system, svg } of projection.frames) {
      for (const region of [...system.events, ...(system.markings ?? []), ...system.annotations, ...system.tuplets, ...system.measures]) if (chosen.has(region.sourceId)) box(svg, region, `author-selection${this.mode === 'listen' ? ' author-playing' : region.sourceId === this.cursor.measureId ? ' author-measure-selection' : ''}`);
      if (this.mode === 'write' && this.selectMore && this.session.selection.focusId) {
        const focused = system.events.find(region => region.sourceId === this.session.selection.focusId);
        if (focused) box(svg, focused, 'author-selection author-event-focus');
      }
      if (this.entryMode) {
        const location = this.location();
        const target = this.cursor.eventId;
        const before = this.value('insert-position') === 'before' || this.value('insert-position') === 'replace';
        // Empty voices have no neighboring event IDs to distinguish their
        // coincident start anchors. Resolve the actual projected voice; an
        // implicit voice may have a different generated ID in that projection.
        const projectedVoice = this.surface.score?.staves.find(staff => staff.id === location.staff.id)
          ?.measures.find(measure => measure.id === location.measure.id)?.voices[location.voiceIndex];
        const anchor = projectedVoice && system.anchors.find(anchor => anchor.staffId === location.staff.id
          && anchor.measureId === this.cursor.measureId && anchor.voiceId === projectedVoice.id && anchor.sourceId === projectedVoice.id
          && (target ? (before ? anchor.beforeId === target : anchor.afterId === target)
            : anchor.eventIndex === location.voice.events.length && anchor.afterId === location.voice.events.at(-1)?.id
              && (location.voice.events.length > 0 || projectedVoice.events.length === 0 && anchor.beforeId === undefined && compare(anchor.onset, rational(0)) === 0)));
        if (anchor) box(svg, { sourceId: anchor.sourceId, x: anchor.x, y: anchor.y - 8, width: 0, height: anchor.height + 16 }, 'author-caret');
      }
    }
  }
  private selectAtPoint(event: MouseEvent): void {
    if (event.defaultPrevented || this.isScoreInputBlocked() || this.blockedScorePress || isNativeSecondaryClick(event) || this.mode !== 'write' || this.entryMode || this.selectMore || selectionModifier(event)
      || classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface }).owner === 'native'
      || event.composedPath().some(item => item instanceof Element && item.hasAttribute('data-source-id'))) return;
    const projection = this.surface?.getRenderedProjection(); if (!projection || projection.layout.projection !== 'screen') return;
    for (const { system, svg } of projection.frames) {
      const matrix = svg.getScreenCTM(); if (!matrix) continue;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const measure = system.measures.find(region => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height);
      if (measure) { this.parkEntry(); this.rangeStart = ''; this.rangeEnd = ''; this.select(measure.sourceId, false); return; }
    }
  }
  private scrollToSelection(): void {
    this.viewport.cancel(); this.viewportRestore = undefined; this.sheetViewportRestore = undefined; this.deferredSheetReturn = false;
    this.revealAfterRender = document.body.dataset.renderState === 'rendering';
    if (!this.revealAfterRender) this.viewport.reveal();
    this.syncReturnControl();
  }
  private moveReading(direction: number): void {
    const location = this.location(); const measures = location.staff.measures;
    const layout = this.surface?.getLayoutGeometry();
    const current = layout?.systems.findIndex(system => system.start <= location.measureIndex && system.end > location.measureIndex) ?? -1;
    const target = layout?.systems[Math.min(Math.max(current + direction, 0), (layout?.systems.length ?? 1) - 1)]?.start ?? Math.min(Math.max(location.measureIndex + direction, 0), measures.length - 1);
    this.select(measures[target].id, false); this.scrollToSelection();
  }
  private deleteSelection(event: KeyboardEvent): void {
    const path = event.composedPath();
    const owner = classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface });
    const scoreFocus = ['score-editor', 'score-scroll', 'score-host'].some(id => path[0] === this.el(id)) || path[0] === this.surface;
    if (this.entryMode || event.shiftKey || !path.includes(this.el('score-editor')) || !scoreFocus && owner.owner !== 'notation'
      || this.pitchDragArmed || document.body.dataset.pointerGesture || this.selectionControls.interacting) return;
    if (this.isScoreInputBlocked()) return;
    const ids = this.safeSelectedEvents();
    if (!ids.length) return;
    event.preventDefault(); event.stopPropagation();
    // Removal selects a surviving neighbor. Holding the key must not delete it.
    if (event.repeat) return;
    const previousMark = this.activeMarking;
    const mark = this.currentMarking();
    if (previousMark && !mark) throw new Error('That attached mark changed. Select it again before deleting; its note was not removed.');
    if (mark && (ids.length !== 1 || ids[0] !== mark.eventId)) throw new Error('Select the exact attached mark again before deleting.');
    this.editNote(() => this.execute(mark
      ? { type: 'remove-event-marking', eventId: mark.eventId, markingId: mark.marking.id }
      : { type: 'remove-events', eventIds: ids }));
    this.lastNotationClick = undefined;
    this.syncRangeFields(); this.syncPanels(false); this.drawSelection();
  }
  private keyboard(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    if (this.isScoreInputBlocked()) {
      // Native popovers/pickers retain native Escape. An ordinary fallback has
      // no UA dismissal, so score-owned Escape can dismiss that temporary task.
      const path = event.composedPath();
      const owner = classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface });
      const scoreFocus = ['score-editor', 'score-scroll', 'score-host'].some(id => path[0] === this.el(id)) || path[0] === this.surface;
      // Escape belongs to any open native surface in the document, including
      // one outside this workspace. This browser policy is separate from the
      // explicitly scoped controls that may block or mutate this workspace.
      const nativeSurface = this.surfaces.hasOpenSurface({ nativeOnly: true })
        || [...document.querySelectorAll<HTMLElement>('[popover], dialog[open], select')]
          .some(panel => isNativeSurfaceOpen(panel, { nativeOnly: true }));
      if (event.key === 'Escape' && !isNativeAuthorInput(event) && !nativeSurface && (scoreFocus || owner.owner === 'notation')
        && this.surfaces.hasOpenFallback()) {
        event.preventDefault(); this.closeTransientSurfaces(); this.staffInteraction.cancel('escape');
        this.el('score-editor').focus({ preventScroll: true });
      }
      return;
    }
    // This button is an application gesture handle, not a text field. It keeps
    // focus after preparation, so Escape must work before the native-input exit.
    if (event.key === 'Escape' && this.pitchDragArmed && event.composedPath().includes(this.el('drag-pitch'))) {
      event.preventDefault(); event.stopPropagation();
      if (document.body.dataset.pointerGesture) this.staffInteraction.cancel('escape');
      else this.finishPitchDrag();
      return;
    }
    if (event.key === 'Escape' && this.entryDragArmed && event.composedPath().includes(this.el('drag-entry'))) {
      event.preventDefault(); event.stopPropagation();
      if (document.body.dataset.pointerGesture) this.staffInteraction.cancel('escape');
      else this.finishEntryDrag();
      return;
    }
    if (isNativeAuthorInput(event)) return;
    const path = event.composedPath();
    const owner = classifyAuthorInput(event, { host: this.el('score-host'), surface: this.surface });
    const scoreFocus = ['score-editor', 'score-scroll', 'score-host'].some(id => path[0] === this.el(id)) || path[0] === this.surface;
    if (!scoreFocus && owner.owner !== 'notation') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (this.mode === 'write') { if (event.shiftKey) this.session.redo(); else this.session.undo(); } return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.selectionControls.interacting) { this.selectionControls.cancel('escape'); return; }
      if (document.body.dataset.pointerGesture) { this.staffInteraction.cancel('escape'); return; }
      if (this.pitchDragArmed) { this.finishPitchDrag(); return; }
      if (this.entryDragArmed) { this.finishEntryDrag(); return; }
      if (this.entryMode) { this.status('Writing remains active. Choose Select to inspect music.', true); return; }
      else {
        this.staffInteraction.cancel('escape'); this.clearActiveMarking(); this.selectMore = false;
        this.session.setSelection(reduceSelection(this.session.selection, { type: 'clear' }, this.selectionContext()).state);
        this.inspectionSelectionId = null; this.lastNotationClick = undefined;
      }
      this.syncRangeFields(); this.syncPanels(false); this.drawSelection(); this.invalidateOffers(); return;
    }
    if (this.mode === 'read' && ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) { event.preventDefault(); this.moveReading(event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : -1); return; }
    if (this.mode !== 'write' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { this.deleteSelection(event); return; }
    if (event.key === 'Enter') {
      if (this.entryMode) { event.preventDefault(); this.insert(true); return; }
      if (this.session.selectionId) { event.preventDefault(); this.activateSelection(); return; }
    }
    if (this.selectMore && event.key === ' ') {
      event.preventDefault();
      const id = this.session.selection.focusId;
      if (id) this.select(id, false, 'toggle');
      return;
    }
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (this.entryMode) {
        event.preventDefault();
        if (event.shiftKey) this.status('Choose Select to select a passage. Writing location is unchanged.');
        else this.moveWriting(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      event.preventDefault(); this.parkEntry(); const events = this.allVoiceEvents();
      const focused = (this.selectMore ? this.session.selection.focusId : this.session.selection.primaryId) ?? this.cursor.eventId;
      const index = events.findIndex(item => item.event.id === focused);
      const next = events[Math.min(Math.max(index + (event.key === 'ArrowRight' ? 1 : -1), 0), events.length - 1)];
      if (next) {
        this.select(next.event.id, false, event.shiftKey ? 'range' : this.selectMore ? 'focus' : 'replace');
        if (!this.selectMore) this.scrollToSelection();
        else {
          const focusedPlace = this.location(next.event.id);
          this.viewport.reveal({ sourceId: next.event.id, staffId: focusedPlace.staff.id,
            measureId: focusedPlace.measure.id, voiceIndex: focusedPlace.voiceIndex });
        }
      }
      return;
    }
    if (this.entryMode && /^[nr]$/i.test(event.key)) {
      event.preventDefault(); this.chooseEntryKind(event.key.toLowerCase() === 'r'); return;
    }
    if (/^[a-g]$/i.test(event.key)) {
      event.preventDefault();
      if (!this.entryMode) { this.status('Choose Write notes to type pitches. Selecting music does not change it.'); return; }
      const notation = this.location().staff.notation ?? 'pitched';
      if (notation !== 'pitched') {
        this.status(notation === 'three-roads' ? '3 roads music uses relative pitch directions. Choose 3 roads note and use Insert or Enter; A–G pitch entry belongs to pitched staves.'
          : 'This rhythm staff has no pitches. Choose Rhythm note and use Insert or Enter; A–G pitch entry belongs to pitched staves.'); return;
      }
      const octave = this.value('event-pitch').match(/-?\d+$/)?.[0] ?? '4';
      this.setValue('event-kind', 'note'); this.setValue('event-pitch', `${event.key.toUpperCase()}${octave}`); this.check('event-measure-rest', false); this.syncEntryVisibility(); this.invalidateOffers(); this.insert(true);
    }
  }

  private currentPageView(): boolean {
    return this.mode === 'pages' && !!this.pageView && !this.metadataDirty
      && this.pageViewRevision === this.session.revision && this.pageViewGeneration === this.renderGeneration
      && this.pageViewPartId === this.partId && document.body.dataset.renderState === 'ready';
  }
  private refreshPreflight(): boolean {
    if (!this.currentPageView()) { document.body.dataset.authorPrintReady = 'false'; return false; }
    return updatePagePreflight(this.el('page-host'), this.el('page-preflight'), this.session.project, this.pageView!, this.checked('print-draft'), this.checked('ack-layout-warnings'));
  }
  private renderTurnOptions(): void {
    const pages = this.pageView?.plan.pages ?? [];
    const score = this.pageView?.projection.score;
    const choices = [{ value: '', label: pages.length > 1 ? 'Choose a page boundary' : 'No page turns in this layout' }];
    for (let index = 1; index < pages.length; index++) {
      const start = pages[index].systems[0].start;
      const measure = score?.staves[0].measures[start];
      const column = this.session.signals.project.get().columns.find(column => column.measureIds.includes(measure?.id ?? ''));
      if (column) choices.push({ value: column.id, label: `Page ${index} → ${index + 1} · before measure ${measure!.number}` });
    }
    this.options('turn-boundary', choices, this.value('turn-boundary')); this.renderTurn();
  }
  private renderTurn(): void {
    const host = this.el('turn-preview'); host.replaceChildren(); const id = this.value('turn-boundary');
    if (!id || !this.pageView) { host.append(node('p', 'Choose a boundary to inspect the outgoing system and next entrance.', 'field-help')); return; }
    const column = this.session.signals.project.get().columns.find(column => column.id === id); const pages = this.pageView.plan.pages;
    const index = pages.findIndex(page => page.index > 0 && column?.measureIds.includes(this.pageView!.projection.score.staves[0].measures[page.systems[0].start].id));
    if (index < 1) return;
    const reviewed = this.profile().reviewedTurns[id] === this.pageView.fingerprint;
    host.append(node('p', `${reviewed ? 'Reviewed for this layout' : 'Unreviewed'} · a human review, not a guarantee of turning time.`, 'field-help'));
    for (const [label, system] of [['Before the turn', pages[index - 1].systems.at(-1)!], ['Next entrance', pages[index].systems[0]]] as const) {
      const source = this.el('page-host').querySelector<HTMLElement>(`.page-system[data-system-index="${system.index}"]`);
      host.append(node('p', label, 'field-help'));
      if (source) host.append(source.cloneNode(true));
    }
  }
  private reviewTurn(reviewed: boolean): void {
    const id = this.requireValue('turn-boundary', 'Choose a physical page boundary first.'); const view = this.pageView;
    if (!view || !this.currentPageView()) throw new Error('Refresh Pages before reviewing a turn.');
    const fingerprint = view.fingerprint;
    this.session.update(reviewed ? 'Review page turn' : 'Clear page-turn review', project => {
      const profile = project.layouts[this.partId] ??= defaultLayout(); if (reviewed) profile.reviewedTurns[id] = fingerprint; else delete profile.reviewedTurns[id];
    });
  }
  private async print(): Promise<void> {
    if (this.disposed || this.printPreparing) return;
    this.printPreparing = true;
    const button = this.el<HTMLButtonElement>('print-score');
    button.disabled = true;
    try {
      this.commitMetadata();
      if (this.mode !== 'pages') this.setMode('pages');
      if (!this.currentPageView()) this.requestRender();
      await this.renderWork;
      if (this.disposed) return;
      if (!this.refreshPreflight()) throw new Error('The composition is not ready for this print request. Resolve the publication checks or choose an explicitly marked draft.');
      const revision = this.session.revision;
      if (!this.currentPageView() || this.pageViewRevision !== revision) throw new Error('The layout changed while preparing printing. Review Pages and try again.');
      // No asynchronous gap between the final revision/preflight check and request.
      this.printRequest();
      this.status('Print requested. Choose matching paper, 100% scale, no browser margins, and no browser headers/footers. If no dialog opens, use a browser with printing support. A request does not confirm a saved PDF.');
    } finally { this.printPreparing = false; if (!this.disposed) button.disabled = false; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.listen?.dispose();
    this.commitMetadata(); void this.saveNow(); this.disposed = true; this.renderGeneration++; clearTimeout(this.saveTimer); clearTimeout(this.metadataTimer);
    this.selectionHud.dispose(); this.selectionControls.dispose(); this.staffInteraction.dispose(); this.resizeObserver?.disconnect(); this.abort.abort();
    this.tools.dispose(); this.writingFrame.dispose(); this.surfaces.dispose(); this.inspectors.dispose(); this.markings.dispose(); this.eventMarkings.dispose(); this.viewport.dispose();
    this.fileReader.dispose(); this.confirmation.dispose(); this.entryPitch.dispose();
    this.surfaceScrollAbort?.abort();
  }
}
