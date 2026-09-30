import type { ArticulationType, Clef, Diagnostic, Duration, MarkingPlacement, OrnamentType, PitchAlteration, PitchDirection, Score, StaffNotation } from '../model/types.js';

export type ViewMode = 'write' | 'read' | 'listen' | 'pages';
export type PaperSize = 'letter' | 'a4';
export type BreakChoice = 'auto' | 'line' | 'page';

export interface PageSettings {
  paper: PaperSize;
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  staffScale: number;
  measureNumbers: 'all' | 'system' | 'none';
  maxMeasures: number | null;
  justifyLast: boolean;
}

export interface LayoutProfile extends PageSettings {
  /** Keys are stable column IDs, shared by parallel staff measures. */
  breaks: Record<string, BreakChoice>;
  keeps: Record<string, boolean>;
  reviewedTurns: Record<string, string>;
}

export interface PartDefinition { id: string; label: string; staffIds: string[] }
export interface MeasureColumnIdentity { id: string; measureIds: string[] }
export type InstructionScope = 'all' | string[];

export interface AuthorProject {
  version: 1;
  id: string;
  metadata: { title: string; composer: string; subtitle: string };
  sourceHtml: string;
  parts: PartDefinition[];
  columns: MeasureColumnIdentity[];
  layouts: Record<string, LayoutProfile>;
  instructionScopes: Record<string, InstructionScope>;
  reviewedShortMeasures: string[];
  pendingSource: string | null;
  updatedAt: number;
}

export interface Cursor {
  staffId: string;
  measureId: string;
  voiceIndex: number;
  eventId?: string;
}

/** One optional marking to add when writing an event; existing markings are retained. */
export type EventAttackInput =
  | { kind: 'articulation'; type: ArticulationType }
  | { kind: 'ornament'; type: OrnamentType };

export interface EventInput {
  kind: 'note' | 'chord' | 'rest' | 'slash' | 'rhythm' | 'road';
  /** Required for a road event; absent for every other kind. */
  pitchDirection?: PitchDirection;
  pitch: string;
  pitches: string;
  duration: Duration;
  dots: number;
  rhythmic: boolean;
  measureRest: boolean;
  accidentalDisplay: 'auto' | 'always' | 'courtesy';
  stem: 'auto' | 'up' | 'down';
  beam: 'auto' | 'start' | 'continue' | 'end' | 'none';
  attack?: EventAttackInput;
}

/** One accepted-value change across an exact selection, without borrowing mixed fields. */
export type EventPropertyChange =
  | { property: 'duration'; value: Duration }
  | { property: 'dots'; value: number }
  | { property: 'stem'; value: EventInput['stem'] }
  | { property: 'accidentalDisplay'; value: EventInput['accidentalDisplay'] }
  | { property: 'alter'; value: PitchAlteration; ties: 'reject' }
  | { property: 'articulation'; value: ArticulationType; present: boolean }
  | { property: 'ornament'; value: OrnamentType; present: boolean }
  | { property: 'attacks'; value: 'none' };

export interface AnnotationInput {
  kind: 'tempo' | 'dynamics' | 'direction' | 'harmony' | 'rehearsal';
  text: string;
  at: string;
  placement: 'above' | 'below';
  bpm?: number;
  beat?: Duration;
  dots?: number;
}

/** Raw interval text belongs to a marking draft, never to the scalar event form. */
export type EventMarkingInput =
  | { kind: 'articulation'; type: ArticulationType; placement: MarkingPlacement | 'auto' }
  | { kind: 'ornament'; type: OrnamentType; placement: MarkingPlacement }
  | { kind: 'interval'; value: string; placement: MarkingPlacement };

export type EventMarkingField = 'type' | 'value' | 'placement';
export type EventMarkingEdit =
  | { type: 'add'; value: EventMarkingInput }
  | { type: 'update'; markingId: string; value: EventMarkingInput; fields?: readonly EventMarkingField[] }
  | { type: 'remove'; markingId: string };

export interface MeasureInput {
  meter?: string;
  groups?: string;
  key?: string;
  clef?: Clef;
  pickup?: boolean;
  incomplete?: boolean;
  endBar?: 'single' | 'double' | 'final' | 'repeat-end' | 'none';
  repeatStart?: boolean;
}

export type AuthorCommand =
  | { type: 'insert-event'; cursor: Cursor; value: EventInput; position: 'before' | 'after' | 'replace'; flow?: boolean }
  | { type: 'paste-music'; cursor: Cursor; text: string; position: 'before' | 'after' }
  | { type: 'append-and-insert'; cursor: Cursor; value: EventInput; position: 'before' | 'after' | 'replace' }
  | { type: 'continue-piece'; cursor: Cursor; value: EventInput; position: 'before' | 'after' | 'replace'; confirmation: 'final-to-single' }
  | { type: 'update-event'; eventId: string; value: EventInput; fields?: readonly (keyof EventInput)[] }
  | { type: 'set-events-property'; eventIds: readonly string[]; change: EventPropertyChange }
  | { type: 'set-note-pitch'; eventId: string; pitch: string; ties: 'reject' }
  | { type: 'set-note-accidental'; eventId: string; alter: PitchAlteration; ties: 'reject' }
  | { type: 'set-event-rhythm'; eventId: string; duration: Duration; dots: number }
  | { type: 'add-event-marking'; eventId: string; value: EventMarkingInput }
  | { type: 'update-event-marking'; eventId: string; markingId: string; value: EventMarkingInput; fields?: readonly EventMarkingField[] }
  | { type: 'remove-event-marking'; eventId: string; markingId: string }
  | { type: 'edit-event-markings'; eventId: string; edits: readonly EventMarkingEdit[]; intervalScope?: 'tie-chain' }
  | { type: 'remove-event'; eventId: string }
  | { type: 'remove-events'; eventIds: readonly string[] }
  | { type: 'fill-rests'; measureId: string; voiceIndex: number; tupletId?: string }
  | { type: 'append-measure'; afterMeasureId?: string; voiceIndex?: number }
  | { type: 'duplicate-measures'; measureIds: string[] }
  | { type: 'move-measure'; measureId: string; direction: -1 | 1 }
  | { type: 'remove-measure'; measureId: string }
  | { type: 'add-staff'; label: string; clef: Clef; key?: string; notation?: StaffNotation }
  | { type: 'set-staff'; staffId: string; label: string; clef: Clef; key: string; notation?: StaffNotation }
  | { type: 'add-voice'; measureId: string }
  | { type: 'set-measure'; measureId: string; values: MeasureInput }
  | { type: 'add-annotation'; measureId: string; value: AnnotationInput }
  | { type: 'update-annotation'; annotationId: string; value: AnnotationInput; fields?: readonly (keyof AnnotationInput)[] }
  | { type: 'remove-annotation'; annotationId: string }
  | { type: 'wrap-tuplet'; eventIds: string[]; actual: number; normal: number; bracket: 'auto' | 'yes' | 'no'; ratio: boolean }
  | { type: 'set-tuplet'; tupletId: string; actual: number; normal: number; bracket: 'auto' | 'yes' | 'no'; ratio: boolean }
  | { type: 'unwrap-tuplet'; tupletId: string }
  | { type: 'tie-events'; eventIds: string[] }
  | { type: 'clear-ties'; eventIds: string[] }
  | { type: 'convert-events'; eventIds: string[]; kind: 'note' | 'rest' | 'slash' | 'rhythm' | 'road'; rhythmic: boolean; pitch: string; pitchPlacement?: 'staff-middle'; pitchDirection?: PitchDirection };

export interface EditResult { selectionId?: string; cursor?: Cursor; message: string; copiedIds?: Record<string, string> }
export interface ProjectionResult { source: Element; score: Score; diagnostics: readonly Diagnostic[]; profile: LayoutProfile; label: string }

export interface MeasuredSystem {
  index: number;
  start: number;
  end: number;
  width: number;
  height: number;
  pageBreak: boolean;
}

export interface PagePlan {
  widthMm: number;
  heightMm: number;
  contentWidthPx: number;
  contentHeightPx: number;
  pages: { index: number; systems: MeasuredSystem[]; usedHeight: number }[];
  issues: string[];
}
