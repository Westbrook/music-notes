import { phPencilSimple, phSlidersHorizontal } from '../ui/icons/phosphor.js';
import { bravuraNoteQuarterUp, bravuraRestQuarter, bravuraNoteheadSlashHorizontalEnds, bravuraGClef, bravuraNoteheadSlashWhiteWhole, bravuraRestWholeLegerLine } from '../ui/icons/bravura.js';
import { durationIcon, eventIcon, markingIcon } from '../ui/notation-icons.js';
import { setControlLabel, setControlIcon } from '../ui/control-content.js';
import { formatRational, harmonyIntervalText, pitchDescription, pitchText, validateAlteration } from '../model/index.js';
import type { ArticulationType, Duration, EventMarking, MusicEvent, PitchDirection, Score, Step } from '../model/types.js';
import { composedAncestors, composedContains } from '../ui/composed-dom.js';
import type { MusicToggleButtonGroup } from '../ui/toggle-button-group.js';
import { ENTRY_ACCIDENTAL_OPTIONS, ENTRY_ATTACK_OPTIONS, ENTRY_DOTS_OPTIONS, entryAttack, entryDurationOptions } from './entry-palette.js';
import { assertEventMarkingsCompatible } from './event-markings-commands.js';
import { analyzeEventPropertyChange } from './batch-properties.js';
import { asControlScope } from './control-scope.js';
import type { ControlRoot, ControlScope } from './control-scope.js';
import { NativeSurfaces } from './native-surfaces.js';
import { PITCH_ALTERATIONS } from './notation-capabilities.js';
import type { NoteEditorState } from './note-editor.js';
import { enhanceSelects } from './select.js';
import type { AuthorCommand, EventInput, EventPropertyChange } from './types.js';

export interface SelectionControlsState extends NoteEditorState {
  score: Score;
  entryMode: boolean;
  events: readonly MusicEvent[];
  eventIds: readonly string[];
  selectionVersion: number;
  documentEpoch: number;
  selectMoreActive?: boolean;
  pitchDragArmed?: boolean;
  resumeLabel?: string;
  /** Actual visibility of More's destination, supplied by the persistent pane owner. */
  moreExpanded?: boolean;
  /** Only invokers inside Properties depend on its possibly held draft owner. */
  inspectionMatchesSelection?: boolean;
  structural?: { id: string; kind: 'instruction' | 'tuplet' | 'measure' | 'staff'; label: string };
}

export interface SelectionPropertiesTarget {
  eventId?: string;
  eventIds?: readonly string[];
  markingId?: string;
  sourceId?: string;
  section?: 'properties' | 'pitches' | 'nominal-span' | 'markings' | 'instruction' | 'tuplet' | 'selection' | 'tools';
  /** Only the persistent More/Tools invoker requests a toggle. Specific task routes remain open-only. */
  toggle?: true;
  invokerId?: string;
}

export interface SelectionControlsOptions {
  state: () => SelectionControlsState;
  /** One synchronous, whole-score transaction. Validation failures must throw. */
  execute: (command: AuthorCommand) => void;
  openProperties: (target?: SelectionPropertiesTarget) => void;
  openRelationships: () => void;
  selectMore: (enabled: boolean) => void;
  preparePitchDrag: () => void;
  cancelPitchDrag?: () => void;
  /** Entry controls remain owned by the workspace; this controller never writes a recipe. */
  resume?: () => void;
  report: (message: string) => void;
  error?: (message: string) => void;
  /** Explicit accepted actions, including no-ops, dismiss an earlier editing failure. */
  success?: () => void;
  /** Reconcile workspace feedback after a chooser closes and its local alert is hidden. */
  afterSurfaceClose?: () => void;
  /** Cancel score gestures synchronously for native and fallback openings alike. */
  beforeSurfaceOpen?: () => void;
}

type SurfaceName = 'value' | 'pitch' | 'shared';
interface Binding { key: string; target: string }
interface SurfaceBinding { binding: Binding; properties: boolean }
interface Activation { element: HTMLElement; binding: Binding; pointerId?: number; cancelled: boolean; cancellationReason?: 'escape' }
interface Opener extends SurfaceBinding { name: SurfaceName; invokerId: string }

const surfaceNames: readonly SurfaceName[] = ['value', 'pitch', 'shared'];
const durationLabels: Record<Duration, string> = {
  breve: 'Breve', whole: 'Whole', half: 'Half', quarter: 'Quarter', eighth: 'Eighth', sixteenth: 'Sixteenth',
  'thirty-second': '32nd', 'sixty-fourth': '64th', '128th': '128th',
};
const accidentals = [['selection-flat', -1], ['selection-natural', 0], ['selection-sharp', 1]] as const;
const chooserAccidentals = accidentals.map(([id, alter]) => [id.replace('selection-', 'selection-chooser-'), alter] as const);
const directions = [['selection-higher', 'higher'], ['selection-same', 'same'], ['selection-lower', 'lower']] as const;
const staleMessage = 'The selected music changed. Choose the current control again before applying this edit.';
const propertyGroups = ['selection-accidentals', 'selection-quick-duration', 'selection-quick-dots', 'selection-quick-attack'] as const;
const quickGroups = ['selection-kind', ...propertyGroups] as const;
const isNote = (event: MusicEvent): boolean => ['note', 'chord', 'rhythm', 'road'].includes(event.kind);
const heldMessage = 'Properties is holding another target. Return to that target or discard its draft before using this action.';

function binding(state: SelectionControlsState): Binding {
  const target = JSON.stringify([
    state.documentId, state.documentEpoch, [...state.eventIds], state.event?.id ?? null,
    state.activeMarkingId ?? null, state.structural?.id ?? null, state.structural?.kind ?? null,
    state.mode, state.entryMode, state.pendingSource, !!state.selectMoreActive, !!state.pitchDragArmed,
  ]);
  return { target, key: JSON.stringify([target, state.revision, state.selectionVersion]) };
}

function common(values: readonly (string | number)[]): string {
  return values.length && values.every(value => value === values[0]) ? String(values[0]) : '';
}

function markingName(mark: EventMarking): string {
  return mark.kind === 'interval' ? `${harmonyIntervalText(mark.interval)} ${mark.placement} interval` : mark.type.replaceAll('-', ' ');
}

function identity(event: MusicEvent): string {
  if (event.kind === 'note' || event.kind === 'chord') return event.pitches.map(pitchDescription).join(' + ');
  if (event.kind === 'rest') return event.measureRest ? 'Full-measure rest' : 'Rest';
  if (event.kind === 'rhythm') return 'Rhythm note';
  if (event.kind === 'road') return `3 roads note · ${event.pitchDirection ?? 'Direction missing'}`;
  return event.rhythmic ? 'Rhythmic slash' : 'Open slash';
}

function selectedMark(state: SelectionControlsState): EventMarking | undefined {
  return state.activeMarkingId ? state.event?.markings?.find(mark => mark.id === state.activeMarkingId) : undefined;
}

/** Validate exact source membership independently of the caller's revision counter. */
function selectionReason(state: SelectionControlsState): string | undefined {
  if (!state.eventIds.length || new Set(state.eventIds).size !== state.eventIds.length
    || state.selectionCount !== state.eventIds.length) return 'Select one or more distinct musical events.';
  const accepted = state.score.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => voice.events)));
  if (state.eventIds.some(id => accepted.filter(event => event.id === id).length !== 1)
    || state.events.length !== state.eventIds.length || new Set(state.events.map(event => event.id)).size !== state.events.length
    || state.events.some(event => !state.eventIds.includes(event.id))
    || !state.event || !state.eventIds.includes(state.event.id)) return 'The exact selection is no longer available. Select the current music again.';
  if (state.activeMarkingId && (!selectedMark(state) || state.eventIds.length !== 1)) return 'The selected attached mark is no longer on this event. Select its current notation again.';
  return undefined;
}

function writingReason(state: SelectionControlsState): string | undefined {
  if (!state.documentId) return 'Reopen the composition before editing its music.';
  if (state.mode !== 'write') return 'Return to Write to edit selected music.';
  if (state.entryMode) return 'Choose Select before changing existing music.';
  if (state.pendingSource) return 'Apply or discard the Source draft before editing selected music.';
  if (state.pitchDragArmed) return 'Finish the pitch drag before using selection controls.';
  return undefined;
}

function roadReason(event: MusicEvent | undefined, value: PitchDirection): string | undefined {
  if (event?.kind !== 'road') return 'Choose one 3 roads note to change relative direction.';
  if ((event.tie === 'continue' || event.tie === 'end') && value !== 'same') return 'A tied continuation sustains the previous pitch and must use Same.';
  return undefined;
}

/**
 * Immediate accepted-value editing. Bindings are transient and deliberately
 * stricter than inspector drafts: an external revision ends an open chooser.
 */
export class SelectionControls {
  private readonly options: SelectionControlsOptions;
  private readonly scope: ControlScope;
  private readonly document: Document;
  private readonly abort = new AbortController();
  private readonly toolbar: HTMLElement;
  private readonly surfaces: NativeSurfaces;
  private readonly opened = new Map<SurfaceName, SurfaceBinding>();
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private rendered: Binding;
  private activation?: Activation;
  private opener?: Opener;
  private pointerActive = false;
  private ownAction = false;
  private disposed = false;
  private errorMessage = '';
  private errorSurface?: SurfaceName;
  private readonly releaseRoots: (() => void)[] = [];
  private quickKey = '';

  constructor(options: SelectionControlsOptions, root: ControlRoot = document) {
    this.options = options;
    this.scope = asControlScope(root);
    this.document = this.scope.document;
    this.toolbar = this.el('selection-controls');
    this.rendered = binding(options.state());
    for (const id of quickGroups) {
      const group = this.el(id) as MusicToggleButtonGroup;
      group.mount();
      this.releaseRoots.push(this.scope.register(group.shadowRoot!));
    }
    for (const name of surfaceNames) enhanceSelects(this.panel(name));
    this.ensureAlterations('selection-alteration');
    this.ensureAlterations('selection-shared-alteration');
    this.bind();
    this.surfaces = new NativeSurfaces({
      ids: surfaceNames.map(name => this.panel(name).id),
      positionedIds: surfaceNames.map(name => this.panel(name).id),
      fallbackFocus: () => this.scope.getElementById('score-editor'),
      beforeOpen: id => this.beforeOpen(this.surfaceName(id)),
      afterClose: id => {
        const name = this.surfaceName(id); this.opened.delete(name);
        if (this.opener?.name === name) this.opener = undefined;
        if (this.errorSurface === name) this.errorSurface = undefined;
        this.renderError();
        this.options.afterSurfaceClose?.();
      },
    }, this.scope);
    for (const id of ['selection-pitch', 'properties-pitch']) this.listen(id, 'click', () => {
      // The fallback opens synchronously in the native-surface invoker handler.
      // Retain its invoker/scroll behavior, then choose the same initial control.
      if (!this.panel('pitch').hasAttribute('popover') && this.surfaces.isOpen(this.panel('pitch').id) && this.opened.has('pitch')) {
        this.focusFirst('pitch');
      }
    });
    this.refresh();
  }

  get interacting(): boolean {
    return !this.disposed && (this.pointerActive || !!this.activation && !this.activation.cancelled || !!this.opener || !!this.opened.size
      || surfaceNames.some(name => this.surfaces.isOpen(this.panel(name).id)));
  }

  refresh(): void {
    if (this.disposed) return;
    const state = this.options.state();
    const next = binding(state);
    if (next.key !== this.rendered.key && !this.ownAction) {
      this.cancel();
      this.clearError();
    }
    for (const [name, open] of this.opened) {
      if (open.properties && state.inspectionMatchesSelection !== true) {
        this.surfaces.closeAll(); this.opened.delete(name);
      }
    }
    this.rendered = next;
    this.render(state);
    this.surfaces.refreshPositions();
  }

  /** Dismiss presentation after deliberate selection; retained Review details belong to the workspace. */
  clearFeedback(): void {
    if (this.disposed) return;
    this.clearError();
  }

  close(): void {
    if (this.disposed) return;
    this.surfaces.closeAll(); this.opened.clear(); this.opener = undefined;
  }

  /** Returns whether closing an owned chooser required focus recovery; callers may recheck it after docking. */
  cancel(reason?: string): boolean {
    if (this.disposed) return false;
    const active = this.scope.activeElement;
    const focused = surfaceNames.find(name => this.surfaces.isOpen(this.panel(name).id) && this.panel(name).contains(active));
    this.invalidateActivation(reason);
    // Only restore focus that belonged to a surface we are hiding. A new field
    // elsewhere in the workspace always keeps the user's focus.
    if (focused) this.surfaces.close(this.panel(focused).id);
    this.close();
    const recovered = !!focused && !this.surfaces.isOpen(this.panel(focused).id);
    if (recovered) {
      const current = this.scope.activeElement as HTMLElement | null;
      if (!current || current === this.document.body || this.panel(focused!).contains(current) || !this.usable(current)) {
        const next = this.toolbarButtons()[0] ?? this.scope.getElementById('score-editor');
        if (next && this.usable(next)) next.focus({ preventScroll: true });
      }
    }
    return recovered;
  }

  private invalidateActivation(reason?: string): void {
    if (this.activation) {
      this.activation.cancelled = true;
      if (reason === 'escape') this.activation.cancellationReason = 'escape';
      const { element, pointerId } = this.activation;
      if (pointerId !== undefined) {
        try { if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId); } catch { /* Capture may already have ended. */ }
      }
    }
    this.pointerActive = false;
    this.opener = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidateActivation(); this.close(); this.abort.abort(); this.surfaces.dispose(); this.disposed = true;
    for (const timer of this.cleanupTimers) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.releaseRoots.forEach(release => release());
  }

  private el(id: string): HTMLElement {
    const element = this.scope.getElementById(id);
    if (!element) throw new Error(`Missing selection control: ${id}`);
    return element;
  }

  private button(id: string): HTMLButtonElement { return this.el(id) as HTMLButtonElement; }
  private field(id: string): HTMLSelectElement { return this.el(id) as HTMLSelectElement; }
  private panel(name: SurfaceName): HTMLElement { return this.el(`selection-${name}-chooser`); }
  private surfaceName(id: string): SurfaceName { return surfaceNames.find(name => this.panel(name).id === id)!; }

  private ensureAlterations(id: string): void {
    const select = this.field(id);
    for (const { value, label } of PITCH_ALTERATIONS) {
      if ([...select.options].some(option => option.value === String(value))) continue;
      const option = this.document.createElement('option'); option.value = String(value); option.textContent = label; select.append(option);
    }
    enhanceSelects(select);
  }

  private listen(id: string, type: string, listener: (event: Event) => void, capture = false): void {
    this.el(id).addEventListener(type, listener, { capture, signal: this.abort.signal });
  }

  private bind(): void {
    const signal = this.abort.signal;
    const controls = [this.toolbar, ...surfaceNames.map(name => this.panel(name)),
      this.el('edit-selected-event'),
      this.el('selection-done'), this.el('selection-select-more'), this.el('selection-prepare-drag'), this.el('properties-pitch')];
    for (const region of controls) {
      const surface = surfaceNames.some(name => this.panel(name) === region);
      region.addEventListener('pointerdown', event => {
        const pointer = event as PointerEvent;
        if (pointer.button !== 0 || !pointer.isPrimary) return;
        const element = this.eventButton(event);
        if (!element || element.matches(':disabled')) return;
        this.activation = { element, binding: this.rendered, pointerId: pointer.pointerId, cancelled: false };
        this.pointerActive = true;
      }, { capture: true, signal });
      region.addEventListener('keydown', event => {
        const key = event as KeyboardEvent;
        if (key.key === 'Escape') {
          if (!surface && this.eventButton(event) && !this.nativeField(event)) this.escapeAction(key);
          return;
        }
        if (key.key !== 'Enter' && key.key !== ' ') return;
        const element = this.eventButton(event);
        if (element && !element.closest('select') && !element.matches(':disabled')) {
          this.activation = { element, binding: this.rendered, cancelled: false };
        }
      }, { capture: true, signal });
    }
    this.document.addEventListener('pointerup', () => { this.pointerActive = false; }, { capture: true, signal });
    this.document.addEventListener('pointercancel', () => {
      this.pointerActive = false;
      if (this.activation) this.activation.cancelled = true;
    }, { capture: true, signal });
    const finishActivation = () => {
      const activation = this.activation;
      // A native event can checkpoint microtasks between listeners. Cleanup
      // therefore waits for a later task, after target/default activation. A
      // cancelled token survives even that cleanup until its click is rejected
      // or a deliberate new press replaces it.
      this.later(() => {
        if (this.activation === activation && !activation?.cancelled && !this.pointerActive) this.activation = undefined;
      });
    };
    this.document.addEventListener('click', finishActivation, { signal });
    this.document.addEventListener('keyup', event => {
      if ((event.key === 'Enter' || event.key === ' ') && this.activation?.pointerId === undefined) finishActivation();
    }, { capture: true, signal });
    this.toolbar.addEventListener('keydown', event => this.rove(event), { signal });
    this.toolbar.addEventListener('focusin', () => this.tabStops(), { signal });

    for (const id of quickGroups) {
      const group = this.el(id) as MusicToggleButtonGroup;
      const capture = (event: Event): void => {
        if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) return;
        if (event instanceof KeyboardEvent && !['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        if (group.disabled) return;
        this.activation = { element: group, binding: this.rendered, cancelled: false };
      };
      group.addEventListener('pointerdown', capture, { capture: true, signal });
      group.addEventListener('keydown', capture, { capture: true, signal });
      group.addEventListener('change', event => {
        if (event.target !== group) return;
        // A rejected edit must restore the accepted value even when the score
        // revision did not change. Other workspace refreshes can reuse it.
        this.quickKey = '';
        try {
          const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? group.value;
          if (id === 'selection-kind') this.changeKind(value, group);
          else this.changeProperty(this.quickChange(id, value, this.options.state()), undefined, group);
        } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); this.refresh(); }
      }, { signal });
    }
    for (const [id, alter] of chooserAccidentals) this.listen(id, 'click', () => this.changeProperty({ property: 'alter', value: alter, ties: 'reject' }, 'pitch', this.button(id)));
    for (const [id, direction] of directions) this.listen(id, 'click', () => this.changeDirection(direction, undefined, this.button(id)));
    for (const name of surfaceNames) {
      this.listen(`selection-${name}`, 'click', event => this.invoke(name, event), true);
      this.panel(name).addEventListener('beforetoggle', event => {
        if (event.target !== this.panel(name) || (event as ToggleEvent).newState !== 'open') return;
        const source = (event as ToggleEvent & { source?: HTMLElement | null }).source;
        // An invalidated native default activation cannot manufacture a new
        // binding from the now-current selection. Every opening starts with
        // this controller's explicit invoker, not a delayed beforetoggle alone.
        if (!this.opener || this.opener.name !== name || source && source.id !== this.opener.invokerId) event.preventDefault();
      }, { capture: true, signal });
      this.panel(name).addEventListener('toggle', event => {
        if (event.target !== this.panel(name) || (event as ToggleEvent).newState !== 'open'
          || !this.surfaces.isOpen(this.panel(name).id) || !this.opened.has(name)) return;
        // Opening is deliberate. A later selection refresh never enters this path.
        if (!this.panel(name).contains(this.scope.activeElement)) this.focusFirst(name);
      }, { signal });
      this.panel(name).addEventListener('keydown', event => {
        if (event.key !== 'Escape' || this.nativeField(event)) return;
        // Native popovers dismiss their innermost surface themselves. Cancelling
        // our pending press must not consume Escape or dismiss a second layer.
        this.invalidateActivation('escape');
        if (this.panel(name).hasAttribute('popover')) return;
        event.preventDefault(); event.stopPropagation(); this.surfaces.close(this.panel(name).id);
      }, { signal });
    }
    this.listen('properties-pitch', 'click', event => this.invoke('pitch', event, true), true);
    this.propertyField('selection-duration', 'value', value => ({ property: 'duration', value: value as Duration }));
    this.propertyField('selection-dots', 'value', value => ({ property: 'dots', value: Number(value) }));
    this.listen('selection-note-step', 'change', () => this.changePitch('step', this.field('selection-note-step').value));
    this.listen('selection-note-octave', 'change', () => this.changePitch('octave', this.field('selection-note-octave').value));
    this.propertyField('selection-alteration', 'pitch', value => ({ property: 'alter', value: validateAlteration(Number(value)), ties: 'reject' }));
    this.listen('selection-direction', 'change', () => this.changeDirection(this.field('selection-direction').value as PitchDirection, 'pitch'));
    this.propertyField('selection-shared-duration', 'shared', value => ({ property: 'duration', value: value as Duration }));
    this.propertyField('selection-shared-dots', 'shared', value => ({ property: 'dots', value: Number(value) }));
    this.propertyField('selection-stem', 'shared', value => ({ property: 'stem', value: value as EventInput['stem'] }));
    this.propertyField('selection-accidental-display', 'shared', value => ({ property: 'accidentalDisplay', value: value as EventInput['accidentalDisplay'] }));
    this.propertyField('selection-shared-alteration', 'shared', value => ({ property: 'alter', value: validateAlteration(Number(value)), ties: 'reject' }));
    this.listen('selection-articulation', 'change', () => {
      if (this.guard('shared')) this.renderArticulations(this.options.state());
    });
    for (const [id, present] of [['selection-add-articulation', true], ['selection-remove-articulation', false]] as const) {
      this.listen(id, 'click', () => this.changeProperty({ property: 'articulation', value: this.field('selection-articulation').value as ArticulationType, present }, 'shared', this.button(id)));
    }
    this.listen('edit-selected-event', 'click', () => this.route('properties', this.button('edit-selected-event')));
    this.listen('selection-mark-edit', 'click', () => this.route('markings', this.button('selection-mark-edit')));
    this.listen('selection-attached-marks', 'click', () => this.route('markings', this.button('selection-attached-marks')));
    this.listen('selection-delete', 'click', () => {
      const state = this.guard(undefined, this.button('selection-delete'));
      if (!state) return;
      const mark = selectedMark(state);
      const reason = writingReason(state) ?? selectionReason(state);
      if (reason) return this.fail(reason);
      this.perform(mark
        ? { type: 'remove-event-marking', eventId: state.event!.id, markingId: mark.id }
        : { type: 'remove-events', eventIds: [...state.eventIds] });
    });
    this.listen('selection-relationships', 'click', () => this.routeAction(this.button('selection-relationships'), () => this.options.openRelationships()));
    this.listen('selection-select-more', 'click', () => {
      const state = this.guard(undefined, this.button('selection-select-more'));
      if (!state) return;
      const reason = this.selectMoreReason(state);
      if (reason) return this.fail(reason);
      this.close(); this.routeActionSafely(() => { this.options.selectMore(!state.selectMoreActive); this.refresh(); });
    });
    this.listen('selection-prepare-drag', 'click', () => {
      const state = this.guard(undefined, this.button('selection-prepare-drag'), true);
      if (!state) return;
      const reason = this.pitchReason(state);
      if (reason) return this.fail(reason);
      this.close(); this.routeActionSafely(() => { this.options.preparePitchDrag(); this.refresh(); });
    });
    this.listen('selection-done', 'click', () => {
      const state = this.guard(undefined, this.button('selection-done'));
      if (!state) return;
      this.close();
      this.routeActionSafely(() => {
        if (state.pitchDragArmed) this.options.cancelPitchDrag?.();
        this.refresh();
      });
    });
  }

  private eventButton(event: Event): HTMLElement | null {
    return this.eventControl(event, 'button, [role="radio"]');
  }

  private nativeField(event: Event): boolean {
    return !!this.eventControl(event, 'select, input, textarea, [contenteditable]:not([contenteditable="false"])');
  }

  /** Delegated events identify their owned control before crossing a shadow host. */
  private eventControl(event: Event, selector: string): HTMLElement | null {
    for (const node of event.composedPath()) {
      if ((node as Node).nodeType === 1) {
        const element = node as HTMLElement;
        if (this.scope.contains(element) && element.matches(selector)) return element;
      }
      if (node === event.currentTarget) break;
    }
    return null;
  }

  private nativePopoverOpen(): boolean {
    return this.scope.querySelectorAll<HTMLElement>('[popover]').some(panel => {
      try { if (panel.matches(':popover-open')) return true; } catch { /* Engines without native selectors keep the explicit surface state. */ }
      return panel.dataset.surfaceState === 'open';
    });
  }

  private escapeAction(event: KeyboardEvent): void {
    if (!this.interacting) return;
    if (this.nativePopoverOpen()) { this.invalidateActivation('escape'); return; }
    this.cancel('escape'); event.preventDefault(); event.stopPropagation();
  }

  private later(action: () => void): void {
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      if (!this.disposed) action();
    }, 0);
    this.cleanupTimers.add(timer);
  }

  private propertyField(id: string, name: SurfaceName, change: (value: string) => EventPropertyChange): void {
    this.listen(id, 'change', () => {
      const value = this.field(id).value;
      if (!value) { this.refresh(); return; }
      try { this.changeProperty(change(value), name); }
      catch (error) { this.fail(error instanceof Error ? error.message : String(error), name); this.refresh(); }
    });
  }

  private invoke(name: SurfaceName, event: Event, properties = false): void {
    const invoker = event.currentTarget as HTMLButtonElement;
    const state = this.guard(undefined, invoker, properties);
    if (!state || invoker.disabled || writingReason(state) || selectionReason(state)) {
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    if (!properties && name === 'pitch' && state.eventIds.length === 1 && state.event
      && state.event.kind !== 'note' && state.event.kind !== 'road') {
      event.preventDefault(); event.stopImmediatePropagation(); this.close();
      this.openProperties({ eventId: state.event.id, section: state.event.kind === 'chord' ? 'pitches' : 'properties' }); return;
    }
    if (name === 'value' && state.eventIds.length === 1 && state.event?.kind === 'slash' && !state.event.rhythmic) {
      event.preventDefault(); event.stopImmediatePropagation(); this.close();
      this.openProperties({ eventId: state.event.id, section: 'nominal-span' }); return;
    }
    if (properties && this.pitchReason(state)) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    const opener = { name, binding: binding(state), properties, invokerId: invoker.id };
    this.opener = opener;
    this.later(() => { if (this.opener === opener) this.opener = undefined; });
  }

  private beforeOpen(name: SurfaceName): boolean {
    if (this.disposed) return false;
    const state = this.options.state();
    const candidate = this.opener?.name === name ? this.opener : undefined;
    this.opener = undefined;
    const reason = writingReason(state) ?? selectionReason(state);
    if (!candidate || candidate.binding.key !== binding(state).key || reason
      || candidate.properties && (state.inspectionMatchesSelection !== true || this.pitchReason(state))
      || state.activeMarkingId || (name === 'pitch' && state.eventIds.length !== 1)
      || name === 'value' && this.propertyReason(state, { property: 'duration', value: state.event?.duration ?? 'quarter' })
      || name === 'pitch' && state.event?.kind !== 'note' && state.event?.kind !== 'road') return false;
    this.options.beforeSurfaceOpen?.();
    const open = { binding: binding(state), properties: candidate.properties };
    this.opened.set(name, open);
    this.later(() => {
      // Another native beforetoggle listener may cancel the actual opening.
      if (this.opened.get(name) === open && !this.surfaces.isOpen(this.panel(name).id)) this.opened.delete(name);
    });
    this.render(state);
    return true;
  }

  private guard(name?: SurfaceName, element?: HTMLElement, properties = false): SelectionControlsState | undefined {
    if (this.disposed) return undefined;
    const state = this.options.state();
    const current = binding(state);
    const activation = element && this.activation?.element === element ? this.activation : undefined;
    if (activation) this.activation = undefined;
    // A deliberate Escape is not a new editing failure when the browser later
    // delivers the cancelled Space/click activation.
    if (activation?.cancelled && activation.cancellationReason === 'escape') return undefined;
    const open = name ? this.opened.get(name) : undefined;
    const expected = name ? open?.binding : activation?.binding ?? this.rendered;
    if (!expected || expected.key !== current.key || activation?.cancelled || activation && activation.binding.key !== current.key
      || name && !this.surfaces.isOpen(this.panel(name).id)) {
      this.cancel(); this.refresh(); this.fail(staleMessage, name); return undefined;
    }
    if ((properties || open?.properties) && state.inspectionMatchesSelection !== true) {
      this.close(); this.refresh(); this.fail(heldMessage, name); return undefined;
    }
    if (element?.matches(':disabled')) {
      this.fail(element.title || 'This control is unavailable for the current selection.', name); return undefined;
    }
    return state;
  }

  private changeProperty(change: EventPropertyChange, name?: SurfaceName, element?: HTMLElement): void {
    const state = this.guard(name, element);
    if (!state) { this.refresh(); return; }
    const reason = writingReason(state) ?? selectionReason(state)
      ?? (state.activeMarkingId ? 'Select the parent event to change its musical values.' : undefined);
    const analysis = analyzeEventPropertyChange(state.score, state.eventIds, change);
    if (reason || !analysis.eligible) {
      this.fail(reason ?? analysis.reason ?? 'This property is not available for every selected event.', name); this.refresh(); return;
    }
    if (!analysis.changedEventIds.length) { this.clearError(); this.refresh(); this.options.success?.(); return; }
    this.perform({ type: 'set-events-property', eventIds: [...state.eventIds], change }, name);
  }

  private quickChange(id: string, value: string, state: SelectionControlsState): EventPropertyChange {
    if (id === 'selection-accidentals') return { property: 'alter', value: validateAlteration(Number(value)), ties: 'reject' };
    if (id === 'selection-quick-duration') return { property: 'duration', value: value as Duration };
    if (id === 'selection-quick-dots') return { property: 'dots', value: Number(value) };
    const attack = entryAttack(value);
    if (!attack) return { property: 'attacks', value: 'none' };
    const present = !state.events.every(event => event.markings?.some(mark => mark.kind === attack.kind && mark.type === attack.type));
    return attack.kind === 'articulation' ? { property: 'articulation', value: attack.type, present }
      : { property: 'ornament', value: attack.type, present };
  }

  private renderQuick(state: SelectionControlsState, events: readonly MusicEvent[]): void {
    const key = binding(state).key;
    if (this.quickKey === key) return;
    this.quickKey = key;
    this.renderKind(state, events);
    const values = [common(events.flatMap(event => event.pitches.map(pitch => pitch.alter))),
      common(events.map(event => event.duration)), common(events.map(event => event.dots)), ''];
    const options = [ENTRY_ACCIDENTAL_OPTIONS, entryDurationOptions(!!events.length && events.every(event => event.kind === 'rest')), ENTRY_DOTS_OPTIONS, ENTRY_ATTACK_OPTIONS];
    propertyGroups.forEach((id, index) => {
      const group = this.el(id) as MusicToggleButtonGroup;
      group.value = values[index]; group.mixed = values[index] === ''; group.notifyUnchanged = true;
      group.options = options[index].map(option => {
        const reason = this.propertyReason(state, this.quickChange(id, option.value, state));
        return { ...option, disabled: !!reason, title: reason ?? option.label };
      });
      group.disabled = group.options.every(option => option.disabled);
      group.title = group.disabled ? this.propertyReason(state, this.quickChange(id, options[index][0].value, state)) ?? '' : '';
      if (id === 'selection-quick-attack') {
        group.choiceStates = Object.fromEntries(ENTRY_ATTACK_OPTIONS.map(option => {
          const attack = entryAttack(option.value);
          const count = events.filter(event => attack ? event.markings?.some(mark => mark.kind === attack.kind && mark.type === attack.type)
            : !event.markings?.some(mark => mark.kind === 'articulation' || mark.kind === 'ornament')).length;
          return [option.value, !count ? 'false' : count === events.length ? 'true' : 'mixed'];
        }));
      }
      group.mount();
    });
    this.el('selection-quick-tools').hidden = !!state.activeMarkingId || !!state.pitchDragArmed || !events.length;
  }

  private noteKind(state: SelectionControlsState): 'note' | 'rhythm' | 'road' {
    const staff = state.score.staves.find(staff => staff.measures.some(measure => measure.voices.some(voice => voice.events.some(event => event.id === state.event?.id))));
    return staff?.notation === 'rhythm' ? 'rhythm' : staff?.notation === 'three-roads' ? 'road' : 'note';
  }

  private kindMembers(state: SelectionControlsState, value: string): readonly MusicEvent[] {
    return state.events.filter(event => value === 'rest' ? event.kind !== 'rest' : !isNote(event));
  }

  private kindReason(state: SelectionControlsState, value: string): string | undefined {
    const reason = writingReason(state) ?? selectionReason(state)
      ?? (state.activeMarkingId ? 'Select the parent event to change its kind.' : undefined);
    if (reason) return reason;
    if (value !== 'note' && value !== 'rest') return 'Choose Note or Rest.';
    const scope = analyzeEventPropertyChange(state.score, state.eventIds, { property: 'articulation', value: 'fermata', present: false });
    if (!scope.eligible) return scope.reason;
    for (const event of this.kindMembers(state, value)) {
      if (event.tie !== 'none') return 'Clear the connected tie chain before changing notes to rests.';
      if (event.measureRest) return 'Choose an explicit written duration in Properties before changing a full-measure rest to a note.';
      try { assertEventMarkingsCompatible(event, { kind: value === 'rest' ? 'rest' : this.noteKind(state), rhythmic: false }); }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    }
    return undefined;
  }

  private renderKind(state: SelectionControlsState, events: readonly MusicEvent[]): void {
    const group = this.el('selection-kind') as MusicToggleButtonGroup;
    const kind = this.noteKind(state);
    group.options = [
      { value: 'note', label: kind === 'road' ? '3 roads note' : kind === 'rhythm' ? 'Rhythm note' : 'Note', icon: kind === 'road' ? bravuraNoteheadSlashHorizontalEnds : bravuraNoteQuarterUp },
      { value: 'rest', label: 'Rest', icon: bravuraRestQuarter },
    ].map(option => ({ ...option, disabled: !!this.kindReason(state, option.value), title: this.kindReason(state, option.value) ?? option.label }));
    group.value = common(events.map(event => isNote(event) ? 'note' : event.kind === 'rest' ? 'rest' : ''));
    group.mixed = false;
    group.choiceStates = Object.fromEntries(['note', 'rest'].map(value => {
      const count = events.filter(event => value === 'note' ? isNote(event) : event.kind === 'rest').length;
      return [value, count === 0 ? 'false' : count === events.length ? 'true' : 'mixed'];
    }));
    group.disabled = group.options.every(option => option.disabled);
    group.title = group.disabled ? this.kindReason(state, 'note') ?? '' : '';
    group.mount();
  }

  private changeKind(value: string, group: MusicToggleButtonGroup): void {
    const state = this.guard(undefined, group);
    if (!state) { this.refresh(); return; }
    const reason = this.kindReason(state, value);
    if (reason) { this.fail(reason); this.refresh(); return; }
    const members = this.kindMembers(state, value);
    if (!members.length) { this.clearError(); this.refresh(); this.options.success?.(); return; }
    const kind = value === 'rest' ? 'rest' : this.noteKind(state);
    this.perform({ type: 'convert-events', eventIds: members.map(event => event.id), kind, rhythmic: false, pitch: '',
      ...(kind === 'note' ? { pitchPlacement: 'staff-middle' as const } : {}),
      ...(kind === 'road' ? { pitchDirection: 'same' as const } : {}),
    });
  }

  private changeDirection(value: PitchDirection, name?: SurfaceName, element?: HTMLElement): void {
    const state = this.guard(name, element);
    if (!state) return;
    const reason = writingReason(state) ?? selectionReason(state)
      ?? (state.eventIds.length !== 1 || state.activeMarkingId ? 'Select one 3 roads note to change its direction.' : undefined)
      ?? (!['higher', 'same', 'lower'].includes(value) ? 'Choose Higher, Same, or Lower.' : roadReason(state.event, value));
    if (reason) { this.fail(reason, name); this.refresh(); return; }
    const event = state.event!;
    if (event.pitchDirection === value) { this.clearError(); this.refresh(); this.options.success?.(); return; }
    this.perform({ type: 'update-event', eventId: event.id, fields: ['pitchDirection'], value: {
      kind: 'road', pitchDirection: value, pitch: '', pitches: '', duration: event.duration, dots: event.dots,
      rhythmic: event.rhythmic, measureRest: event.measureRest, accidentalDisplay: 'auto', stem: event.stem, beam: event.beam,
    } }, name);
  }

  private changePitch(property: 'step' | 'octave', value: string): void {
    const state = this.guard('pitch');
    if (!state) return;
    const reason = this.pitchReason(state);
    if (reason) { this.fail(reason, 'pitch'); this.refresh(); return; }
    if (!value) { this.refresh(); return; }
    const event = state.event!;
    const previous = event.pitches[0];
    let pitch: string;
    try {
      // Each choice changes one accepted component; uncommitted sibling fields
      // and the writing recipe cannot contribute to this musical transaction.
      pitch = pitchText(property === 'step' ? { ...previous, step: value as Step } : { ...previous, octave: Number(value) });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error), 'pitch'); this.refresh(); return;
    }
    if (pitch === pitchText(previous)) { this.clearError(); this.refresh(); this.options.success?.(); return; }
    this.perform({ type: 'set-note-pitch', eventId: event.id, pitch, ties: 'reject' }, 'pitch');
  }

  private perform(command: AuthorCommand, name?: SurfaceName): void {
    const before = binding(this.options.state());
    const active = this.scope.activeElement as HTMLElement | null;
    this.ownAction = true;
    let error: unknown;
    let succeeded = false;
    try { this.options.execute(command); this.clearError(); succeeded = true; }
    catch (caught) { error = caught; }
    finally { this.ownAction = false; }
    const next = binding(this.options.state());
    if (next.target === before.target) {
      this.rendered = next;
      for (const open of this.opened.values()) open.binding = next;
    } else this.cancel();
    this.refresh();
    if (succeeded) this.options.success?.();
    else this.fail(error instanceof Error ? error.message : String(error ?? 'The change could not be applied.'), name);
    if (active && next.target === before.target) {
      const openSurface = surfaceNames.find(surface => this.surfaces.isOpen(this.panel(surface).id) && this.panel(surface).contains(active));
      if (this.usable(active) && (composedContains(this.toolbar, active) || openSurface)) {
        if (this.scope.activeElement !== active) active.focus({ preventScroll: true });
      } else if (openSurface) {
        const counterpart = active.id === 'selection-add-articulation' ? this.button('selection-remove-articulation')
          : active.id === 'selection-remove-articulation' ? this.button('selection-add-articulation') : undefined;
        if (counterpart && this.usable(counterpart)) counterpart.focus({ preventScroll: true });
        else this.focusFirst(openSurface);
      }
    }
  }

  private route(section: 'properties' | 'markings', element: HTMLElement): void {
    const state = this.guard(undefined, element);
    if (!state || state.mode !== 'write' || state.entryMode) return;
    const mark = selectedMark(state);
    if (state.activeMarkingId && !mark) return this.fail('The selected attached mark no longer exists. Select the current notation again.');
    this.close();
    if (state.eventIds.length > 1 && !selectionReason(state)) {
      this.openProperties({ eventIds: [...state.eventIds], section: 'selection' }, element);
    } else if (state.event && !selectionReason(state)) {
      this.openProperties({ eventId: state.event.id, ...(mark ? { markingId: mark.id } : {}), section: mark ? 'markings' : section }, element);
    } else if (state.structural) {
      this.openProperties({ sourceId: state.structural.id,
        section: state.structural.kind === 'instruction' ? 'instruction' : state.structural.kind === 'tuplet' ? 'tuplet' : 'tools' }, element);
    } else this.openProperties({ section: 'tools' }, element);
  }

  private routeAction(element: HTMLElement, action: () => void): void {
    const state = this.guard(undefined, element);
    if (!state || state.mode !== 'write' || state.entryMode) return;
    this.close(); this.routeActionSafely(action);
  }

  private openProperties(target: SelectionPropertiesTarget, invoker?: HTMLElement): void {
    const request: SelectionPropertiesTarget = invoker?.id === 'edit-selected-event'
      ? { ...target, toggle: true, invokerId: invoker.id } : target;
    this.routeActionSafely(() => this.options.openProperties(request));
  }

  private routeActionSafely(action: () => void): void {
    try { action(); }
    catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }

  private pitchReason(state: SelectionControlsState): string | undefined {
    return writingReason(state) ?? selectionReason(state)
      ?? (state.eventIds.length !== 1 || state.activeMarkingId || state.event?.kind !== 'note' || state.event.pitches.length !== 1
        ? 'Select one pitched note. Edit chord pitches explicitly in Properties.' : undefined)
      ?? (state.event?.tie !== 'none' ? 'Tied notes need their connected tie chain preserved. Clear it explicitly before changing pitch.' : undefined);
  }

  private selectMoreReason(state: SelectionControlsState): string | undefined {
    const reason = writingReason(state);
    if (reason) return reason;
    if (state.eventIds.length) {
      const selected = selectionReason(state);
      if (selected) return selected;
      // Fermata removal is valid for every event kind, so this tests only membership and staff/voice scope.
      const analysis = analyzeEventPropertyChange(state.score, state.eventIds, { property: 'articulation', value: 'fermata', present: false });
      return analysis.eligible ? undefined : analysis.reason;
    }
    return state.structural ? undefined : 'Choose a staff and voice before selecting more events.';
  }

  private setButton(id: string, visible: boolean, reason?: string, label?: string): void {
    const button = this.button(id);
    button.hidden = !visible; button.disabled = !!reason || !visible;
    button.title = reason ?? '';
    if (label !== undefined) setControlLabel(button, label);
  }

  private setField(id: string, value: string, reason?: string): void {
    const select = this.field(id);
    if (value === '' && ![...select.options].some(option => option.value === '')) {
      const option = this.document.createElement('option'); option.value = ''; option.textContent = 'Mixed'; option.disabled = true;
      const first = select.querySelector('option'); select.insertBefore(option, first);
    }
    select.value = value; select.disabled = !!reason; select.title = reason ?? '';
  }

  private propertyReason(state: SelectionControlsState, change: EventPropertyChange): string | undefined {
    const reason = writingReason(state) ?? selectionReason(state)
      ?? (state.activeMarkingId ? 'Choose the parent event to edit its musical values.' : undefined);
    if (reason) return reason;
    const analysis = analyzeEventPropertyChange(state.score, state.eventIds, change);
    return analysis.eligible ? undefined : analysis.reason;
  }

  private render(state: SelectionControlsState): void {
    const active = this.scope.activeElement as HTMLElement | null;
    const hadFocus = !!active && composedContains(this.toolbar, active);
    const valid = !selectionReason(state);
    const event = valid && state.eventIds.length === 1 ? state.event : undefined;
    const events = valid ? state.events : [];
    const mark = selectedMark(state);
    const more = !!state.selectMoreActive;
    const show = state.mode === 'write' && !state.entryMode;
    const kind = state.pitchDragArmed ? 'pitch-drag' : more ? 'select-more' : state.activeMarkingId ? 'marking'
      : state.eventIds.length > 1 ? 'multiple' : event?.kind ?? (state.structural ? 'structural' : 'none');
    this.toolbar.hidden = !show;
    this.toolbar.dataset.selectionState = kind;
    this.el('pointer-tools').dataset.selectionState = kind;
    this.toolbar.dataset.eventIds = JSON.stringify([...state.eventIds]);
    this.toolbar.dataset.selectionCount = String(state.eventIds.length);
    this.toolbar.dataset.documentId = state.documentId;
    this.toolbar.dataset.documentEpoch = String(state.documentEpoch);
    this.toolbar.dataset.selectionVersion = String(state.selectionVersion);
    this.toolbar.dataset.revision = String(state.revision);
    if (event) this.toolbar.dataset.eventId = event.id; else delete this.toolbar.dataset.eventId;
    const baseReason = writingReason(state) ?? selectionReason(state);
    const single = !!event && !state.activeMarkingId && !more;
    const group = !state.activeMarkingId && (state.eventIds.length > 1 || more);
    const targetAction = !group && (!!state.activeMarkingId || !event && !!state.structural);
    const alterationReason = this.propertyReason(state, { property: 'alter', value: 0, ties: 'reject' });
    const rhythmReason = this.propertyReason(state, { property: 'duration', value: event?.duration ?? 'quarter' });
    const valueEvents = state.activeMarkingId ? [] : events;
    const duration = common(valueEvents.map(item => item.duration));
    const dots = common(valueEvents.map(item => item.dots));
    const writtenValue = !valueEvents.length ? 'Value' : !duration ? 'Mixed value'
      : `${durationLabels[duration as Duration]}${dots === '' ? ' · mixed dots' : Number(dots) ? ` · ${dots} dot${dots === '1' ? '' : 's'}` : ''}`;
    const compactValue = !valueEvents.length ? 'Value' : !duration || dots === '' ? 'Mixed'
      : `${duration === 'sixteenth' ? '16th' : durationLabels[duration as Duration]}${Number(dots) ? ` ${'·'.repeat(Number(dots))}` : ''}`;
    const nominalSpan = single && event.kind === 'slash' && !event.rhythmic;
    this.setButton('selection-value', !more && !state.pitchDragArmed, nominalSpan ? baseReason : rhythmReason, single && event.measureRest ? 'Follows meter'
      : nominalSpan ? 'Nominal span…' : compactValue);
    setControlIcon(this.button('selection-value'), single && event.measureRest ? bravuraRestWholeLegerLine
      : nominalSpan ? bravuraNoteheadSlashWhiteWhole
        : duration ? durationIcon(duration as Duration, valueEvents.every(item => item.kind === 'rest')) : phSlidersHorizontal);
    this.button('selection-value').setAttribute('aria-label', single && event.measureRest ? 'Value follows the meter'
      : nominalSpan ? 'Edit open slash nominal span in Properties' : group ? `Value for ${state.eventIds.length} selected events: ${writtenValue}` : `Value: ${writtenValue}`);
    this.button('selection-value').title = rhythmReason ?? 'Change the selected music’s written value and dots.';
    this.renderQuick(state, state.activeMarkingId ? [] : events);
    this.el('selection-road-directions').hidden = !single || event?.kind !== 'road';
    for (const [id, direction] of directions) {
      this.setButton(id, single && event?.kind === 'road', baseReason ?? roadReason(event, direction));
      this.button(id).setAttribute('aria-checked', String(single && event?.kind === 'road' && event.pitchDirection === direction));
    }
    const pitchLabel = event?.kind === 'note' ? 'Pitch' : event?.kind === 'chord' ? 'Pitches' : event?.kind === 'road' ? 'Direction' : 'Options';
    this.setButton('selection-pitch', !group && !targetAction, baseReason, pitchLabel);
    setControlIcon(this.button('selection-pitch'), event ? event.kind === 'note' ? bravuraGClef : eventIcon(event) : phSlidersHorizontal);
    this.button('selection-pitch').setAttribute('aria-label', event ? `${pitchLabel}: ${identity(event)}` : 'Event options: choose music on the staff');
    this.setButton('selection-shared', group, baseReason,
      more ? 'Actions' : 'Shared');
    this.button('selection-shared').setAttribute('aria-label', `${more ? 'Selection actions' : 'Shared properties'} for ${state.eventIds.length} selected events`);
    this.setButton('selection-relationships', group && !state.pitchDragArmed, baseReason, 'Relate');
    this.button('selection-relationships').setAttribute('aria-label', `Relationships for ${state.eventIds.length} selected events`);
    this.setButton('selection-attached-marks', !group && !state.activeMarkingId && !state.pitchDragArmed,
      single ? baseReason : 'Select one musical event to inspect or add its attached marks.');
    this.button('selection-attached-marks').setAttribute('aria-label', single ? `Attached marks for ${identity(event)}` : 'Attached marks: select one musical event');
    this.setButton('selection-mark-edit', targetAction, state.activeMarkingId ? baseReason : writingReason(state), 'Edit');
    setControlIcon(this.button('selection-mark-edit'), mark ? markingIcon(mark) : phPencilSimple);
    this.button('selection-mark-edit').setAttribute('aria-label', state.activeMarkingId
      ? `Edit attached ${mark ? markingName(mark) : 'mark'}`
      : state.structural ? `Edit ${state.structural.kind}: ${state.structural.label}` : 'Edit the selected target');
    this.setButton('selection-delete', show && valid && !state.pitchDragArmed, baseReason);
    this.button('selection-delete').setAttribute('aria-label', mark
      ? `Delete attached ${markingName(mark)}` : `Delete ${state.eventIds.length} selected event${state.eventIds.length === 1 ? '' : 's'}`);
    this.setButton('selection-done', show && !!state.pitchDragArmed, state.mode !== 'write' ? 'Return to Write.' : undefined);
    this.setButton('edit-selected-event', show, state.mode !== 'write' || state.entryMode ? 'Choose Select in Write.' : undefined);
    this.button('edit-selected-event').setAttribute('aria-controls', 'workspace-tools');
    this.button('edit-selected-event').setAttribute('aria-expanded', String(state.moreExpanded === true));
    this.el('edit-selected-label').textContent = 'More';
    this.el('edit-selected-value').textContent = '';
    this.setButton('selection-select-more', show && !state.pitchDragArmed, this.selectMoreReason(state));
    this.button('selection-select-more').setAttribute('aria-pressed', String(more));
    const propertiesReason = state.inspectionMatchesSelection === true ? this.pitchReason(state) : heldMessage;
    this.setButton('properties-pitch', event?.kind === 'note' && !state.activeMarkingId, propertiesReason);
    this.setButton('selection-prepare-drag', true, propertiesReason);
    this.el('selection-controls-context').textContent = this.caption(state, event, mark);

    this.setField('selection-duration', duration, rhythmReason);
    this.setField('selection-dots', dots, this.propertyReason(state, { property: 'dots', value: event?.dots ?? 0 }));
    this.el('selection-rhythm-help').textContent = this.rhythmHelp(state, event, rhythmReason);
    this.el('selection-alteration-field').hidden = event?.kind !== 'note';
    this.el('selection-direction-field').hidden = event?.kind !== 'road';
    const pitched = single && event.kind === 'note' && event.pitches.length === 1;
    this.el('selection-note-step-field').hidden = !pitched;
    this.el('selection-note-octave-field').hidden = !pitched;
    const pitchReason = this.pitchReason(state);
    this.setField('selection-note-step', pitched ? event.pitches[0].step : '', pitchReason);
    this.setField('selection-note-octave', pitched ? String(event.pitches[0].octave) : '', pitchReason);
    this.el('selection-chooser-accidentals').hidden = !pitched;
    for (const [id, alter] of chooserAccidentals) {
      this.setButton(id, pitched, alterationReason);
      this.button(id).setAttribute('aria-pressed', String(pitched && event.pitches[0].alter === alter));
    }
    this.setField('selection-alteration', event?.kind === 'note' && event.pitches.length === 1 ? String(event.pitches[0].alter) : '', alterationReason);
    this.setField('selection-direction', event?.kind === 'road' ? event.pitchDirection ?? '' : '', baseReason ?? roadReason(event, event?.pitchDirection ?? 'same'));
    for (const option of this.field('selection-direction').options) {
      option.disabled = option.value === '' || !!roadReason(event, option.value as PitchDirection);
    }
    this.el('selection-pitch-help').textContent = event?.kind === 'road'
      ? 'Higher, Same, and Lower refer to the previous main pitch in this voice, across rests and barlines. Tied continuations use Same. Written rhythm stays unchanged.'
      : pitchReason ?? 'Letter, octave, and absolute alteration change immediately and independently. Natural means unaltered even under a key signature. Written rhythm, attached marks, and the printed accidental policy stay unchanged.';
    const shared: readonly [string, string, EventPropertyChange][] = [
      ['selection-shared-duration', common(events.map(item => item.duration)), { property: 'duration', value: 'quarter' }],
      ['selection-shared-dots', common(events.map(item => item.dots)), { property: 'dots', value: 0 }],
      ['selection-stem', common(events.map(item => item.stem)), { property: 'stem', value: 'auto' }],
      ['selection-accidental-display', common(events.flatMap(item => item.pitches.map(pitch => pitch.display))), { property: 'accidentalDisplay', value: 'auto' }],
      ['selection-shared-alteration', common(events.flatMap(item => item.pitches.map(pitch => pitch.alter))), { property: 'alter', value: 0, ties: 'reject' }],
    ];
    for (const [id, value, change] of shared) this.setField(id, value, this.propertyReason(state, change));
    this.renderArticulations(state);
    this.renderError();
    this.tabStops();
    if (hadFocus && active && !this.usable(active) && !this.toolbar.hidden) this.toolbarButtons()[0]?.focus({ preventScroll: true });
  }

  private renderArticulations(state: SelectionControlsState): void {
    const value = this.field('selection-articulation').value as ArticulationType;
    const count = state.events.filter(event => event.markings?.some(mark => mark.kind === 'articulation' && mark.type === value)).length;
    for (const [id, present] of [['selection-add-articulation', true], ['selection-remove-articulation', false]] as const) {
      const change: EventPropertyChange = { property: 'articulation', value, present };
      const analysis = analyzeEventPropertyChange(state.score, state.eventIds, change);
      const reason = this.propertyReason(state, change) ?? (!analysis.changedEventIds.length
        ? present ? 'Every selected event already has this articulation.' : 'No selected event has this articulation.' : undefined);
      this.setButton(id, true, reason, present ? `Add to all ${state.eventIds.length} events` : 'Remove from selection');
    }
    this.field('selection-articulation').disabled = !!(writingReason(state) ?? selectionReason(state));
    const reasons = ['selection-shared-duration', 'selection-shared-dots', 'selection-stem', 'selection-accidental-display', 'selection-shared-alteration']
      .map(id => this.field(id).title).filter(Boolean);
    const unique = [...new Set(reasons)];
    const presence = count === 0 ? 'None' : count === state.eventIds.length ? 'All' : 'Some';
    this.el('selection-shared-help').textContent = `${state.eventIds.length} selected events. Only the property you choose changes; gaps in the selection stay untouched. ${presence} have ${value.replaceAll('-', ' ')} (${count}/${state.eventIds.length}).${unique.length ? ` ${unique.join(' ')}` : ''}`;
  }

  private caption(state: SelectionControlsState, event?: MusicEvent, mark?: EventMarking): string {
    const place = `${state.staffLabel || 'Staff'} · bar ${state.measureNumber || '—'} · voice ${state.voiceNumber}`;
    const selected = new Set(state.eventIds);
    const bars = state.score.staves.flatMap(staff => staff.measures
      .filter(measure => measure.voices.some(voice => voice.events.some(item => selected.has(item.id))))
      .map(measure => measure.number));
    const scope = state.eventIds.length > 1
      ? `${state.staffLabel || 'Staff'} · voice ${state.voiceNumber} · ${bars.length === 1 ? 'bar' : 'bars'} ${bars.join(', ')}` : place;
    if (state.pitchDragArmed) return `${event ? identity(event) : 'Selected note'} · ${place} · Drag pitch, then Done.`;
    if (state.selectMoreActive) return `${state.eventIds.length} selected · ${scope} · Tap events to toggle; turn Select more off to keep the selection.`;
    if (state.activeMarkingId) return `${mark ? markingName(mark) : 'Missing attached mark'} · ${place}`;
    if (state.eventIds.length > 1) return `${state.eventIds.length} selected events · ${scope}`;
    if (event) return `${identity(event)} · ${place}`;
    return state.structural ? `${state.structural.label} · ${place}` : 'Choose music on the staff.';
  }

  private rhythmHelp(state: SelectionControlsState, event: MusicEvent | undefined, reason?: string): string {
    const remaining = `Remaining in this voice: ${formatRational(state.remaining)} whole notes.`;
    if (!event) return reason ?? (state.eventIds.length > 1
      ? `Choose a written value or dots for all ${state.eventIds.length} selected events. Only the chosen property changes; each event keeps its other values and tuplet ratios. Shortening moves following events earlier in the same voice without inserting rests.`
      : 'Choose musical events to change their written rhythm.');
    const tuplets = state.tuplets.filter(tuplet => event.tupletIds.includes(tuplet.id));
    const context = tuplets.length ? ` Tuplet ${tuplets.map(tuplet => `${tuplet.actual}:${tuplet.normal}`).join(' inside ')}; elapsed time ${formatRational(event.time)} whole notes.` : '';
    return `${reason ? `${reason} ` : ''}${durationLabels[event.duration]}${event.dots ? ` with ${event.dots} dot${event.dots === 1 ? '' : 's'}` : ''}. ${remaining}${context} Shortening a value moves following events earlier in the same voice; it does not insert a rest.`;
  }

  private clearError(): void {
    this.errorMessage = ''; this.errorSurface = undefined;
    this.renderError();
  }

  private fail(message: string, name?: SurfaceName): void {
    this.errorMessage = message;
    // Late native events can reject after dismissal; their detail belongs in
    // Review, without reviving an alert inside the closed chooser.
    this.errorSurface = name && this.opened.has(name) && this.surfaces.isOpen(this.panel(name).id) ? name : undefined;
    this.renderError(); this.options.error?.(message);
  }

  private renderError(): void {
    const error = this.el('selection-controls-error');
    error.textContent = this.errorMessage; error.hidden = !this.errorMessage;
    // Full details live in Review. The workspace owns its compact announcement;
    // an active chooser keeps its own actionable local alert.
    error.removeAttribute('role'); error.removeAttribute('aria-live');
    this.toolbar.dataset.hasError = String(!!this.errorMessage);
    for (const name of surfaceNames) {
      const local = this.el(`selection-${name}-error`);
      local.textContent = this.errorSurface === name ? this.errorMessage : ''; local.hidden = !local.textContent;
    }
  }

  private usable(element: HTMLElement, visibility?: Map<Element, boolean>): boolean {
    if (!element.isConnected || element.matches(':disabled')) return false;
    for (const ancestor of [element, ...composedAncestors(element)]) {
      let visible = visibility?.get(ancestor);
      if (visible === undefined) {
        const style = this.document.defaultView?.getComputedStyle(ancestor);
        visible = !ancestor.matches('[hidden], [inert], [aria-hidden="true"]') && style?.display !== 'none' && style?.visibility !== 'hidden';
        visibility?.set(ancestor, visible);
      }
      if (!visible) return false;
    }
    return true;
  }

  private toolbarButtons(): HTMLButtonElement[] {
    const visibility = new Map<Element, boolean>();
    return [...quickGroups.flatMap(id => [...this.el(id).shadowRoot!.querySelectorAll<HTMLButtonElement>('.controls > button')]),
      ...this.toolbar.querySelectorAll<HTMLButtonElement>('button')].filter(button => this.usable(button, visibility));
  }

  private tabStops(): void {
    const buttons = this.toolbarButtons();
    const focused = this.scope.activeElement;
    const current = buttons.find(button => button === focused) ?? buttons.find(button => button.tabIndex === 0) ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  }

  private rove(event: KeyboardEvent): void {
    const target = this.eventButton(event);
    if (!target || target.closest('select')) return;
    if ((event.key === ' ' || event.key === 'Enter') && target.getAttribute('role') === 'radio') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) target.click(); return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = this.toolbarButtons(); const index = buttons.indexOf(target as HTMLButtonElement);
    if (!buttons.length || index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault(); event.stopPropagation(); buttons[next].focus({ preventScroll: true }); this.tabStops();
  }

  private focusFirst(name: SurfaceName): void {
    if (name === 'pitch') {
      if (!this.opened.get(name)?.properties) {
        const current = chooserAccidentals.map(([id]) => this.button(id))
          .find(button => button.getAttribute('aria-pressed') === 'true' && this.usable(button));
        if (current) { current.focus({ preventScroll: true }); return; }
      }
      // Letter/octave controls must not change the established direct-choice
      // entry point for quarter tones, road direction, or Properties spelling.
      const current = this.field(this.options.state().event?.kind === 'road' ? 'selection-direction' : 'selection-alteration');
      if (this.usable(current)) { current.focus({ preventScroll: true }); return; }
    }
    const field = [...this.panel(name).querySelectorAll<HTMLElement>('select, input, button, [tabindex]')]
      .find(element => element.tagName === 'SELECT' && this.usable(element))
      ?? [...this.panel(name).querySelectorAll<HTMLElement>('button, [tabindex]')].find(element => this.usable(element));
    field?.focus({ preventScroll: true });
  }
}
