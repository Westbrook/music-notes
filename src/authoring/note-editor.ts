import { setControlLabel } from '../ui/control-content.js';
import { compare, divide, durationTime, formatRational, harmonyIntervalText, multiply, pitchDescription, subtract, validateAlteration } from '../model/index.js';
import type { Duration, EventMarking, MusicEvent, PitchDirection, Rational, Tuplet } from '../model/types.js';
import { enhanceSelects } from './select.js';
import type { AuthorCommand, EventInput, ViewMode } from './types.js';

export interface NoteEditorState {
  documentId: string;
  mode: ViewMode;
  revision: number;
  pendingSource: boolean;
  event?: MusicEvent;
  staffLabel: string;
  measureNumber: string;
  voiceNumber: number;
  remaining: Rational;
  tuplets: readonly Tuplet[];
  selectionCount: number;
  /** Exact child target; its owner remains the selected rhythmic event. */
  activeMarkingId?: string;
}

export interface NoteEditorOptions {
  state: () => NoteEditorState;
  beforeOpen: () => void;
  /** Synchronous transactions; validation failures must throw for local feedback. */
  execute: (command: AuthorCommand) => void;
  undo: () => void;
  canUndo: () => boolean;
  /** Synchronous, explicit routes; the workspace preserves any inspector drafts. */
  openAttachedMarks?: (markingId?: string) => void;
  openAdvanced?: (target: 'pitches' | 'properties') => void;
}

type SelectedState = NoteEditorState & { event: MusicEvent };
type DirectionCommand = Extract<AuthorCommand, { type: 'update-event' }> & {
  fields: readonly ['pitchDirection'];
  value: EventInput & { kind: 'road'; pitchDirection: PitchDirection };
};
type PropertyCommand = Extract<AuthorCommand, { type: 'set-note-accidental' | 'set-event-rhythm' }> | DirectionCommand;
interface Binding { documentId: string; eventId: string; revision: number }
interface TriggerBinding extends Binding { markingId?: string }

const accidentals = [
  ['note-double-flat', -2, 'Double flat'], ['note-flat', -1, 'Flat'], ['note-natural', 0, 'Natural'],
  ['note-sharp', 1, 'Sharp'], ['note-double-sharp', 2, 'Double sharp'],
] as const;
const durationLabels: Record<Duration, string> = {
  breve: 'Breve', whole: 'Whole', half: 'Half', quarter: 'Quarter', eighth: 'Eighth', sixteenth: 'Sixteenth',
  'thirty-second': '32nd', 'sixty-fourth': '64th', '128th': '128th',
};
const directionLabels: Record<PitchDirection, string> = { higher: 'Higher (top)', same: 'Same (middle)', lower: 'Lower (bottom)' };

function selectedMark(state: NoteEditorState): EventMarking | undefined {
  return state.activeMarkingId ? state.event?.markings?.find(mark => mark.id === state.activeMarkingId) : undefined;
}

function markingName(mark: EventMarking): string {
  return mark.kind === 'interval' ? `${harmonyIntervalText(mark.interval)} ${mark.placement} interval` : mark.type.replaceAll('-', ' ');
}

function identity(event: MusicEvent): string {
  if (event.kind === 'note' || event.kind === 'chord') return event.pitches.map(pitchDescription).join(' + ');
  if (event.kind === 'rest') return event.measureRest ? 'Full-measure rest' : 'Rest';
  if (event.kind === 'rhythm') return 'Rhythm note';
  if (event.kind === 'road') return `3 roads note · ${event.pitchDirection ? directionLabels[event.pitchDirection] : 'Direction missing'}`;
  return event.rhythmic ? 'Rhythmic slash' : 'Open slash';
}

function writtenValue(event: MusicEvent): string {
  return `${durationLabels[event.duration]}${event.dots ? ` · ${event.dots} dot${event.dots === 1 ? '' : 's'}` : ''}`;
}

function unavailable(state: NoteEditorState): string | undefined {
  if (!state.documentId) return 'The current composition could not be identified. Reopen the score before editing.';
  if (state.mode !== 'write') return 'Return to Write to edit selected music.';
  if (state.pendingSource) return 'Apply or discard the Source draft before editing selected music.';
  if (!state.event || state.selectionCount !== 1) return 'Select one note, chord, rest, slash, rhythm note, or 3 roads note on the staff.';
  if (state.activeMarkingId && !selectedMark(state)) return 'The selected attached mark is no longer on this event. Select its current notation again.';
  return undefined;
}

function accidentalReason(event: MusicEvent): string | undefined {
  if (event.kind === 'chord') return 'A chord has separate pitch spellings. Edit its pitches in the inspector.';
  if (event.kind === 'road') return '3 roads notes specify pitch direction, not a pitch or accidental. Edit their direction in the inspector.';
  if (event.kind !== 'note' || event.pitches.length !== 1) return 'Rests, slashes, and rhythm notes have no pitch or accidental.';
  if (event.tie !== 'none') return 'This note belongs to a tie chain. Clear the connected ties in the inspector before changing its accidental.';
  return undefined;
}

function rhythmReason(event: MusicEvent): string | undefined {
  if (event.measureRest) return `A full-measure rest follows the meter (${formatRational(event.time)} whole notes here). Replace it with an ordinary rest in the inspector to choose a written value.`;
  if (event.kind === 'slash' && !event.rhythmic) return 'An open slash leaves attacks to the performer. Use the inspector to change its nominal duration or convert it to a rhythmic slash.';
  return undefined;
}

function dottedOverflowHelp(command: PropertyCommand, state: SelectedState): string {
  if (command.type !== 'set-event-rhythm' || command.dots === 0) return '';
  try {
    const factor = divide(state.event.time, durationTime(state.event.duration, state.event.dots));
    const proposed = multiply(durationTime(command.duration, command.dots), factor);
    if (compare(subtract(proposed, state.event.time), state.remaining) <= 0) return '';
    if (state.event.dots > 0 && command.duration !== state.event.duration) {
      const undotted = multiply(durationTime(command.duration), factor);
      return compare(subtract(undotted, state.event.time), state.remaining) <= 0
        ? ' Remove the dots first, then choose the longer duration.'
        : ' Even without dots, this duration exceeds the available space. Choose a shorter value or free space in this voice first.';
    }
    return ' Choose a shorter duration before adding dots.';
  } catch { return ''; } // Keep the original validation error if even its timing is out of bounds.
}

/** Direct controls for one accepted event; source and history remain in EditorSession. */
export class NoteEditor {
  private readonly options: NoteEditorOptions;
  private readonly document: Document;
  private readonly abort = new AbortController();
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly triggerLabel: HTMLElement;
  private readonly triggerValue: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly context: HTMLElement;
  private readonly accidentalHelp: HTMLElement;
  private readonly pitchControls: HTMLElement;
  private readonly directionField: HTMLElement;
  private readonly direction: HTMLSelectElement;
  private readonly directionHelp: HTMLElement;
  private readonly attachedMarks: HTMLButtonElement;
  private readonly advanced: HTMLButtonElement;
  private readonly rhythmHelp: HTMLElement;
  private readonly duration: HTMLSelectElement;
  private readonly dots: HTMLSelectElement;
  private readonly microtone: HTMLSelectElement;
  private readonly feedback: HTMLElement;
  private readonly error: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly accidentalButtons: HTMLButtonElement[];
  private nativePopover: boolean;
  private binding?: Binding;
  private triggerBinding?: TriggerBinding;
  private localChanges = 0;
  private ownAction = false;
  private opening = false;
  private disposed = false;

  constructor(options: NoteEditorOptions, root: Document = document) {
    this.options = options;
    this.document = root;
    const control = <T extends HTMLElement>(id: string): T => {
      const element = root.getElementById(id);
      if (!element) throw new Error(`Missing note editor control: ${id}`);
      return element as T;
    };
    this.panel = control('note-editor');
    const body = this.panel.querySelector<HTMLElement>('.note-editor-body');
    if (!body) throw new Error('Missing note editor body');
    this.body = body;
    this.trigger = control('edit-selected-event');
    this.triggerLabel = control('edit-selected-label');
    this.triggerValue = control('edit-selected-value');
    this.heading = control('note-editor-heading');
    this.context = control('note-editor-context');
    this.accidentalHelp = control('note-accidental-help');
    this.pitchControls = control('note-pitch-controls');
    this.directionField = control('note-direction-field');
    this.direction = control('note-direction');
    this.directionHelp = control('note-direction-help');
    this.attachedMarks = control('note-attached-marks');
    this.advanced = control('note-advanced-edit');
    this.rhythmHelp = control('note-rhythm-help');
    this.duration = control('note-duration');
    this.dots = control('note-dots');
    this.microtone = control('note-microtone');
    this.feedback = control('note-editor-feedback');
    this.error = control('note-editor-error');
    this.undoButton = control('note-editor-undo');
    this.closeButton = control('close-note-editor');
    this.accidentalButtons = accidentals.map(([id]) => control<HTMLButtonElement>(id));
    this.nativePopover = typeof this.panel.showPopover === 'function' && typeof this.panel.hidePopover === 'function';
    this.panel.setAttribute('role', 'dialog');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-controls', this.panel.id);
    if (this.nativePopover) {
      this.panel.hidden = false;
      this.panel.setAttribute('popover', 'auto');
      this.trigger.setAttribute('popovertarget', this.panel.id);
      this.closeButton.setAttribute('popovertarget', this.panel.id);
      this.closeButton.setAttribute('popovertargetaction', 'hide');
      delete this.panel.dataset.popoverFallback;
    } else this.useFallback();
    enhanceSelects(this.panel);
    this.finishClose();

    const listen = (element: HTMLElement, type: string, action: (event: Event) => void) => {
      element.addEventListener(type, action, { signal: this.abort.signal });
    };
    listen(this.panel, 'beforetoggle', event => {
      if (event.target !== this.panel) return;
      if ((event as ToggleEvent).newState === 'open') {
        if (!this.beginOpen()) event.preventDefault();
      } else this.finishClose();
    });
    listen(this.panel, 'toggle', event => {
      if (event.target !== this.panel) return;
      if ((event as ToggleEvent).newState === 'open') this.focusOnOpen();
      else this.finishClose();
    });
    listen(this.trigger, 'click', event => {
      // A child mark routes to its existing inspector row. Suppress the native
      // popover default even when this click first discovers a stale target.
      if (this.triggerBinding?.markingId || this.options.state().activeMarkingId) {
        event.preventDefault(); this.open(); return;
      }
      if (this.nativePopover) return;
      event.preventDefault();
      if (this.binding) this.close(true);
      else this.open();
    });
    listen(this.closeButton, 'click', event => {
      if (this.nativePopover) return;
      event.preventDefault();
      this.close(true);
    });
    this.accidentalButtons.forEach((button, index) => listen(button, 'click', () => {
      const state = this.current();
      if (!state) return;
      const reason = accidentalReason(state.event);
      if (reason) { this.reject(reason, state); return; }
      this.apply({ type: 'set-note-accidental', eventId: state.event.id, alter: accidentals[index][1], ties: 'reject' });
    }));
    listen(this.microtone, 'change', () => {
      const state = this.current();
      if (!state) return;
      const reason = accidentalReason(state.event);
      if (reason) { this.reject(reason, state); return; }
      if (!this.microtone.value) { this.render(state); return; }
      this.apply({ type: 'set-note-accidental', eventId: state.event.id,
        alter: validateAlteration(Number(this.microtone.value)), ties: 'reject' });
    });
    listen(this.duration, 'change', () => this.changeRhythm('duration'));
    listen(this.dots, 'change', () => this.changeRhythm('dots'));
    listen(this.direction, 'change', () => this.changeDirection());
    listen(this.attachedMarks, 'click', () => this.routeFromPanel('marks'));
    listen(this.advanced, 'click', () => this.routeFromPanel('advanced'));
    listen(this.undoButton, 'click', () => this.undoLocal());
    listen(this.panel, 'keydown', event => this.keyboard(event as KeyboardEvent));
    this.refresh();
  }

  /** Call after every selection, source revision, draft, or view-mode change. */
  refresh(): void {
    if (this.disposed) return;
    const state = this.options.state();
    this.renderTrigger(state);
    if (!this.binding || this.opening) return;
    if (unavailable(state) || state.activeMarkingId || state.documentId !== this.binding.documentId || state.event?.id !== this.binding.eventId
      || (!this.ownAction && state.revision !== this.binding.revision)) {
      this.close(false);
      return;
    }
    this.render(state as SelectedState);
  }

  open(): void {
    if (this.disposed) return;
    const displayed = this.displayedState();
    if (!displayed) return;
    if (displayed.binding.markingId) {
      const route = this.options.openAttachedMarks;
      if (!route || !this.prepareOpen(displayed.binding)) return;
      this.navigate(displayed.binding, () => route(displayed.binding.markingId));
      return;
    }
    if (this.binding) {
      if (!this.nativePopover) this.panel.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      this.focusInitial();
      return;
    }
    if (this.nativePopover) {
      try { this.panel.showPopover(); return; }
      catch { this.useFallback(); }
    }
    if (!this.beginOpen()) return;
    this.panel.hidden = false;
    this.panel.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    this.focusInitial();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.close(false);
  }

  private beginOpen(): boolean {
    if (this.disposed) return false;
    if (this.binding) return !!this.current();
    const displayed = this.displayedState();
    // A native toggle is not permission to open Tools for a selected mark.
    if (!displayed || displayed.binding.markingId) return false;
    const state = this.prepareOpen(displayed.binding);
    if (!state) return false;
    this.binding = { documentId: state.documentId, eventId: state.event.id, revision: state.revision };
    this.localChanges = 0;
    this.clearMessages();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.panel.dataset.noteEditorState = 'open';
    this.render(state);
    return true;
  }

  private sameTarget(state: NoteEditorState, target: TriggerBinding): boolean {
    return state.documentId === target.documentId && state.event?.id === target.eventId
      && state.revision === target.revision && (state.activeMarkingId || undefined) === target.markingId;
  }

  /** Do not refresh an unseen replacement into permission for the same click. */
  private displayedState(): { state: SelectedState; binding: TriggerBinding } | undefined {
    if (this.disposed || this.ownAction || this.opening) return undefined;
    const binding = this.triggerBinding && { ...this.triggerBinding };
    const state = this.options.state();
    if (!binding || unavailable(state) || !this.sameTarget(state, binding)) {
      this.renderTrigger(state); this.close(false); return undefined;
    }
    return { state: state as SelectedState, binding };
  }

  private prepareOpen(displayed: TriggerBinding): SelectedState | undefined {
    this.opening = true;
    try { this.options.beforeOpen(); }
    catch (error) { this.error.textContent = error instanceof Error ? error.message : String(error); this.error.hidden = false; return undefined; }
    finally { this.opening = false; }
    const state = this.options.state();
    this.renderTrigger(state);
    if (this.disposed || unavailable(state) || !this.sameTarget(state, displayed)) return undefined;
    return state as SelectedState;
  }

  private current(): SelectedState | undefined {
    if (this.disposed || this.ownAction || !this.binding) return undefined;
    const state = this.options.state();
    if (unavailable(state) || state.activeMarkingId || state.documentId !== this.binding.documentId
      || state.event?.id !== this.binding.eventId || state.revision !== this.binding.revision) {
      this.renderTrigger(state);
      this.close(false);
      return undefined;
    }
    return state as SelectedState;
  }

  private navigate(target: TriggerBinding, action: () => void): void {
    this.close(false);
    const state = this.options.state();
    if (this.disposed || unavailable(state) || !this.sameTarget(state, target)) { this.renderTrigger(state); return; }
    action();
  }

  private routeFromPanel(route: 'marks' | 'advanced'): void {
    const state = this.current();
    if (!state) return;
    const target = { ...this.binding! };
    if (route === 'marks') {
      const open = this.options.openAttachedMarks;
      if (open) this.navigate(target, () => open());
    } else {
      const open = this.options.openAdvanced;
      if (open) this.navigate(target, () => open(state.event.kind === 'chord' ? 'pitches' : 'properties'));
    }
  }

  private changeDirection(): void {
    const state = this.current();
    if (!state) return;
    const event = state.event;
    if (event.kind !== 'road') { this.reject('Only a 3 roads note has a relative pitch direction. This action does not convert notation.', state); return; }
    const direction = this.direction.value;
    if (direction !== 'higher' && direction !== 'same' && direction !== 'lower') {
      this.reject('Choose Higher, Same, or Lower for this 3 roads note.', state); return;
    }
    // The narrow patch preserves authored rhythm, ties, child marks, and source
    // attributes. Never reuse the next-entry recipe or include a kind change.
    this.apply({ type: 'update-event', eventId: event.id, fields: ['pitchDirection'], value: {
      kind: 'road', pitchDirection: direction, pitch: '', pitches: '', duration: event.duration,
      dots: event.dots, rhythmic: event.rhythmic, measureRest: event.measureRest,
      accidentalDisplay: 'auto', stem: event.stem, beam: event.beam,
    } });
  }

  private changeRhythm(field: 'duration' | 'dots'): void {
    const state = this.current();
    if (!state) return;
    const reason = rhythmReason(state.event);
    if (reason) { this.reject(reason, state); return; }
    if (!Object.hasOwn(durationLabels, this.duration.value) || !/^[0-3]$/.test(this.dots.value)) {
      this.reject('Choose a supported note value and zero to three dots.', state);
      return;
    }
    // The other property always comes from accepted music, never a stale form value.
    this.apply({ type: 'set-event-rhythm', eventId: state.event.id,
      duration: field === 'duration' ? this.duration.value as Duration : state.event.duration,
      dots: field === 'dots' ? Number(this.dots.value) : state.event.dots });
  }

  private apply(command: PropertyCommand): void {
    const state = this.current();
    if (!state) return;
    const unchanged = command.type === 'set-note-accidental' ? state.event.pitches[0]?.alter === command.alter
      : command.type === 'set-event-rhythm' ? state.event.duration === command.duration && state.event.dots === command.dots
        : state.event.kind === 'road' && state.event.pitchDirection === command.value.pitchDirection;
    if (unchanged) {
      this.clearMessages();
      this.render(state);
      this.feedback.textContent = 'This value already matches the accepted music. No undo step was added.';
      return;
    }
    this.mutate(() => this.options.execute(command), state, false, command);
  }

  private undoLocal(): void {
    const state = this.current();
    if (!state) return;
    if (this.localChanges === 0 || !this.options.canUndo()) {
      this.feedback.textContent = 'There are no changes to undo in this editor.';
      return;
    }
    this.mutate(this.options.undo, state, true);
  }

  private mutate(action: () => void, before: SelectedState, undo: boolean, command?: PropertyCommand): void {
    const binding = this.binding!;
    const focused = this.document.activeElement as HTMLElement | null;
    this.clearMessages();
    this.ownAction = true;
    let failure: unknown;
    let failed = false;
    try { action(); } catch (error) { failed = true; failure = error; }
    finally { this.ownAction = false; }
    const after = this.options.state();
    if (this.binding !== binding) return;
    if (unavailable(after) || after.activeMarkingId || after.documentId !== binding.documentId || after.event?.id !== binding.eventId) { this.close(false); return; }
    const changed = after.revision !== before.revision;
    if (changed) {
      binding.revision = after.revision;
      this.localChanges = Math.max(0, this.localChanges + (undo ? -1 : 1));
    }
    this.renderTrigger(after);
    this.render(after as SelectedState);
    if (failed) {
      const message = failure instanceof Error ? failure.message : String(failure);
      this.error.textContent = `${changed ? 'The score changed, but the update reported an error.' : 'No change was applied.'} ${message}${command && !changed ? dottedOverflowHelp(command, before) : ''}`;
      this.error.hidden = false;
    } else {
      this.feedback.textContent = changed
        ? `${undo ? 'Undid the last change.' : 'Applied.'} ${identity(after.event!)} · ${writtenValue(after.event!)}.`
        : 'No change was needed. No undo step was added.';
    }
    // Keep keyboard ownership at the input, but give the diagnostic the visible
    // space after a failed edit. Revealing the restored input would hide it again.
    this.restoreFocus(focused, !failed);
    if (failed) this.revealInBody(this.error);
  }

  private renderTrigger(state: NoteEditorState): void {
    const mark = selectedMark(state);
    const reason = unavailable(state)
      ?? (mark && !this.options.openAttachedMarks ? 'Open the Edit tools to change this attached mark.' : undefined);
    const event = state.event;
    this.triggerBinding = !reason && event
      ? { documentId: state.documentId, eventId: event.id, revision: state.revision, markingId: mark?.id }
      : undefined;
    this.trigger.disabled = !!reason;
    this.triggerLabel.textContent = mark ? `Edit ${markingName(mark)}`
      : event ? `Edit ${event.kind === 'rhythm' ? 'rhythm note' : event.kind === 'road' ? '3 roads note' : event.kind}` : 'Edit note';
    const eventIdentity = event?.kind === 'road' ? event.pitchDirection ? directionLabels[event.pitchDirection] : 'Direction missing'
      : event ? identity(event) : '';
    this.triggerValue.textContent = reason ?? `${mark ? 'On ' : ''}${eventIdentity} · ${event!.measureRest ? `${formatRational(event!.time)} whole notes` : writtenValue(event!)}`;
    this.trigger.title = reason ?? `Edit ${mark ? markingName(mark) : `accepted ${event!.kind}`} in measure ${state.measureNumber}, voice ${state.voiceNumber}.`;
    if (state.activeMarkingId) {
      this.trigger.removeAttribute('popovertarget');
      this.trigger.removeAttribute('aria-haspopup');
      this.trigger.removeAttribute('aria-expanded');
      this.trigger.setAttribute('aria-controls', 'event-markings-editor');
    } else {
      if (this.nativePopover) this.trigger.setAttribute('popovertarget', this.panel.id);
      else this.trigger.removeAttribute('popovertarget');
      this.trigger.setAttribute('aria-haspopup', 'dialog');
      this.trigger.setAttribute('aria-controls', this.panel.id);
      this.trigger.setAttribute('aria-expanded', String(!!this.binding));
    }
    for (const [key, value] of [['documentId', this.triggerBinding?.documentId], ['eventId', this.triggerBinding?.eventId],
      ['revision', this.triggerBinding ? String(this.triggerBinding.revision) : undefined], ['markingId', this.triggerBinding?.markingId]] as const) {
      if (value === undefined) delete this.trigger.dataset[key];
      else this.trigger.dataset[key] = value;
    }
  }

  private render(state: SelectedState): void {
    const event = state.event;
    this.heading.textContent = `Edit ${identity(event)}`;
    this.context.textContent = `${state.staffLabel || 'Staff'} · measure ${state.measureNumber} · voice ${state.voiceNumber}`;
    this.panel.dataset.documentId = state.documentId;
    this.panel.dataset.eventId = event.id;
    this.panel.dataset.revision = String(state.revision);
    this.pitchControls.hidden = event.kind !== 'note' || event.pitches.length !== 1;
    const pitchReason = accidentalReason(event);
    this.accidentalButtons.forEach((button, index) => {
      button.disabled = !!pitchReason;
      button.setAttribute('aria-pressed', String(event.kind === 'note' && event.pitches.length === 1
        && event.pitches[0].alter === accidentals[index][1]));
      button.title = pitchReason ?? `Set ${accidentals[index][2].toLowerCase()} on ${event.pitches[0].step}${event.pitches[0].octave}.`;
    });
    this.accidentalHelp.textContent = pitchReason
      ?? `Sets the absolute spelling of ${event.pitches[0].step}${event.pitches[0].octave}. The printed sign still follows the key and accidental display settings.`;
    this.microtone.disabled = !!pitchReason;
    const alter = event.pitches[0]?.alter;
    this.microtone.value = alter !== undefined && !Number.isInteger(alter) ? String(alter) : '';
    this.microtone.title = pitchReason ?? 'Choose a quarter-tone alteration relative to the natural letter, not the current accidental.';
    const road = event.kind === 'road';
    this.directionField.hidden = !road;
    this.directionHelp.hidden = !road;
    this.direction.disabled = !road;
    this.direction.value = road ? event.pitchDirection ?? '' : '';
    const tiedContinuation = event.tie === 'continue' || event.tie === 'end';
    for (const option of this.direction.options) option.disabled = road && tiedContinuation && option.value !== 'same';
    this.directionHelp.textContent = !road ? '' : tiedContinuation
      ? 'A tied continuation stays Same and sustains the previous main pitch. Higher or Lower cannot be applied while this tie is kept.'
      : 'Higher, Same, or Lower relative to the preceding main pitch in this voice. Rests keep the reference; ornaments and harmony tones do not replace it.';
    this.attachedMarks.hidden = !this.options.openAttachedMarks;
    this.attachedMarks.disabled = !this.options.openAttachedMarks;
    setControlLabel(this.attachedMarks, `Attached marks (${event.markings?.length ?? 0})`);
    this.advanced.hidden = !this.options.openAdvanced;
    this.advanced.disabled = !this.options.openAdvanced;
    setControlLabel(this.advanced, event.kind === 'chord' ? 'Edit chord pitches…' : 'Advanced properties…');
    const valueReason = rhythmReason(event);
    this.duration.disabled = !!valueReason;
    this.dots.disabled = !!valueReason;
    if (this.duration.value !== event.duration) this.duration.value = event.duration;
    if (this.dots.value !== String(event.dots)) this.dots.value = String(event.dots);
    const remaining = `Onset ${formatRational(event.onset)} whole notes. ${formatRational(state.remaining)} whole notes remaining in this voice.`;
    const tuplets = event.tupletIds.map(id => state.tuplets.find(tuplet => tuplet.id === id)).filter((tuplet): tuplet is Tuplet => !!tuplet);
    const timing = event.tupletIds.length
      ? ` Tuplet ${tuplets.map(tuplet => `${tuplet.actual}:${tuplet.normal}`).join(' × ')}: ${formatRational(durationTime(event.duration, event.dots))} written whole notes occupy ${formatRational(event.time)} whole notes here.`
      : '';
    this.rhythmHelp.textContent = valueReason ? `${valueReason} ${remaining}${timing}`
      : `${remaining}${timing} Shortening moves following events earlier within this voice; lengthening moves them later. No rests are added automatically.`;
    this.undoButton.disabled = this.localChanges === 0 || !this.options.canUndo();
  }

  private reject(message: string, state: SelectedState): void {
    this.render(state);
    this.feedback.textContent = '';
    this.error.textContent = message;
    this.error.hidden = false;
    this.revealInBody(this.error);
  }

  private clearMessages(): void {
    this.feedback.textContent = '';
    this.error.textContent = '';
    this.error.hidden = true;
  }

  private keyboard(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      this.undoLocal();
    } else if (!this.nativePopover && event.key === 'Escape'
      && !(event.target as Element | null)?.closest('select')) {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
    }
  }

  private focusOnOpen(): void {
    const binding = this.binding;
    queueMicrotask(() => {
      if (this.binding !== binding || !binding || this.disposed) return;
      if (!this.current()) return;
      if (!this.panel.contains(this.document.activeElement)) this.focusInitial();
    });
  }

  private focusInitial(reveal = true): void {
    if (!this.current()) return;
    const pressed = this.accidentalButtons.find(button => !button.disabled && button.getAttribute('aria-pressed') === 'true');
    const fallback = !this.advanced.hidden && !this.advanced.disabled ? this.advanced
      : !this.attachedMarks.hidden && !this.attachedMarks.disabled ? this.attachedMarks : this.closeButton;
    const target = !this.directionField.hidden && !this.direction.disabled ? this.direction
      : pressed ?? (!this.microtone.disabled && this.microtone.value ? this.microtone : !this.duration.disabled ? this.duration : fallback);
    target.focus({ preventScroll: true });
    if (reveal) this.revealInBody(target);
  }

  private restoreFocus(focused: HTMLElement | null, reveal = true): void {
    if (!this.current()) return;
    if (focused && this.panel.contains(focused) && focused.isConnected && !focused.matches(':disabled') && !focused.closest('[hidden]')) {
      focused.focus({ preventScroll: true });
      if (reveal) this.revealInBody(focused);
    } else if (!this.panel.contains(this.document.activeElement) || this.document.activeElement?.matches(':disabled')) {
      this.focusInitial(reveal);
    }
  }

  /** Scroll only this pane: scrollIntoView can also move the score and document. */
  private revealInBody(target: HTMLElement): void {
    // Focus handlers can close the editor or change its source binding.
    if (!this.current() || !target.isConnected || !this.body.contains(target) || target.closest('[hidden]')) return;
    const body = this.body;
    const viewport = body.getBoundingClientRect();
    if (body.clientHeight <= 0 || viewport.height <= 0) return;
    const scaleY = body.offsetHeight > 0 ? viewport.height / body.offsetHeight : 1;
    const scaleX = body.offsetWidth > 0 ? viewport.width / body.offsetWidth : 1;
    const gap = 4 * scaleY;
    const top = viewport.top + body.clientTop * scaleY + gap;
    const bottom = viewport.top + (body.clientTop + body.clientHeight) * scaleY - gap;
    if (!(bottom > top)) return;

    // A long staff label must remain readable without covering the control.
    // Recheck on every explicit reveal so a later, shorter context pins again.
    delete this.context.dataset.contextPinned;
    const sticky = this.document.defaultView?.getComputedStyle(this.context).position === 'sticky';
    const controlBounds = target.getBoundingClientRect();
    if (controlBounds.height <= 0) return;
    let pinned = sticky;
    if (pinned && this.context.getBoundingClientRect().height + controlBounds.height + gap > bottom - top) {
      this.context.dataset.contextPinned = 'false';
      pinned = false;
    }

    const adjustment = (start: number, end: number, minimum: number, maximum: number): number =>
      end - start > maximum - minimum || start < minimum ? start - minimum : end > maximum ? end - maximum : 0;
    const clamp = (value: number, maximum: number): number => Math.max(0, Math.min(Math.max(0, maximum), value));

    // A second measurement accounts for the context reaching its sticky edge
    // while scrolling. Neither pass asks an ancestor to reveal anything.
    for (let pass = 0; pass < 2; pass++) {
      const context = this.context.getBoundingClientRect();
      const minimum = pinned ? Math.max(top, context.bottom + gap) : top;
      const control = target.getBoundingClientRect();
      let bounds: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'> = control;
      const label = target.closest('label');
      if (label && body.contains(label)) {
        const labelled = label.getBoundingClientRect();
        if (labelled.height > 0 && labelled.height <= bottom - minimum) bounds = labelled;
      }
      if (!pinned && context.height > 0) {
        const start = Math.min(context.top, bounds.top);
        const end = Math.max(context.bottom, bounds.bottom);
        // Only co-reveal when the actual intervening content fits too.
        if (end - start <= bottom - minimum) bounds = { ...bounds, top: start, bottom: end };
      }
      const nextTop = clamp(body.scrollTop + adjustment(bounds.top, bounds.bottom, minimum, bottom) / scaleY,
        body.scrollHeight - body.clientHeight);
      if (nextTop !== body.scrollTop) body.scrollTop = nextTop;

      if (body.clientWidth > 0 && scaleX > 0) {
        const left = viewport.left + (body.clientLeft + 4) * scaleX;
        const right = viewport.left + (body.clientLeft + body.clientWidth - 4) * scaleX;
        const nextLeft = clamp(body.scrollLeft + adjustment(control.left, control.right, left, right) / scaleX,
          body.scrollWidth - body.clientWidth);
        if (nextLeft !== body.scrollLeft) body.scrollLeft = nextLeft;
      }
    }
  }

  private useFallback(): void {
    this.nativePopover = false;
    this.panel.removeAttribute('popover');
    this.panel.dataset.popoverFallback = 'true';
    this.panel.hidden = true;
    this.trigger.removeAttribute('popovertarget');
    this.closeButton.removeAttribute('popovertarget');
    this.closeButton.removeAttribute('popovertargetaction');
  }

  private close(returnFocus: boolean): void {
    if (this.nativePopover) {
      try { this.panel.hidePopover(); } catch { /* Already closed or disconnected. */ }
    } else this.panel.hidden = true;
    this.finishClose();
    if (!this.nativePopover && returnFocus && !this.trigger.disabled) this.trigger.focus();
  }

  private finishClose(): void {
    this.binding = undefined;
    this.localChanges = 0;
    this.undoButton.disabled = true;
    if (this.triggerBinding?.markingId) this.trigger.removeAttribute('aria-expanded');
    else this.trigger.setAttribute('aria-expanded', 'false');
    this.panel.dataset.noteEditorState = 'closed';
    delete this.panel.dataset.documentId;
    delete this.panel.dataset.eventId;
    delete this.panel.dataset.revision;
  }
}
