/** Renderer-independent, serializable musical data. Time is measured in whole notes. */
export interface Rational { readonly numerator: number; readonly denominator: number }

export type Duration = 'breve' | 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirty-second' | 'sixty-fourth' | '128th';
export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';
export type StaffNotation = 'pitched' | 'rhythm' | 'three-roads';
/** A relative instruction against the last main pitch in the same voice. */
export type PitchDirection = 'higher' | 'same' | 'lower';
export type PitchAlteration = -2 | -1.5 | -1 | -0.5 | 0 | 0.5 | 1 | 1.5 | 2;
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type AccidentalDisplay = 'auto' | 'always' | 'courtesy';
export interface Pitch {
  readonly step: Step;
  readonly octave: number;
  /** Absolute semitone alteration; supported values are multiples of 0.5 from -2 to 2. */
  readonly alter: number;
  readonly display: AccidentalDisplay;
}

export interface Meter {
  readonly numerator: number;
  readonly denominator: number;
  /** Groups are in denominator units, not quarter-note beats. */
  readonly groups: readonly number[];
  readonly explicitGroups: boolean;
  /** Printed signature: e.g. 7/8 or 2+2+3/8. */
  readonly display: string;
}

export type BeamPolicy = 'auto' | 'start' | 'continue' | 'end' | 'none';
export type StemDirection = 'auto' | 'up' | 'down';
export type TiePolicy = 'none' | 'start' | 'continue' | 'end';

export type ArticulationType = 'accent' | 'staccato' | 'tenuto' | 'marcato' | 'staccatissimo' | 'fermata';
export type OrnamentType = 'trill' | 'turn' | 'inverted-turn' | 'upper-mordent' | 'lower-mordent';
export type MarkingPlacement = 'above' | 'below';
export type IntervalNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
/** Major/perfect interval number; alter changes its magnitude before direction is applied. */
export interface HarmonyInterval {
  readonly number: IntervalNumber;
  readonly alter: -1 | 0 | 1;
}
export interface ArticulationMarking {
  readonly id: string;
  readonly kind: 'articulation';
  readonly type: ArticulationType;
  /** Legacy source value; engraving always follows the side opposite the printed stem. */
  readonly placement: MarkingPlacement | 'auto';
}
export interface OrnamentMarking {
  readonly id: string;
  readonly kind: 'ornament';
  readonly type: OrnamentType;
  /** Legacy source value; engraving always follows the side opposite the printed stem. */
  readonly placement: MarkingPlacement;
}
export interface IntervalMarking {
  readonly id: string;
  readonly kind: 'interval';
  readonly interval: HarmonyInterval;
  /** Musical direction from the main pitch, not an interchangeable display preference. */
  readonly placement: MarkingPlacement;
}
export type EventMarking = ArticulationMarking | OrnamentMarking | IntervalMarking;

export interface MusicEvent {
  readonly id: string;
  readonly kind: 'note' | 'chord' | 'rest' | 'slash' | 'rhythm' | 'road';
  readonly pitches: readonly Pitch[];
  /** Required only for road events; no absolute pitch or interval is inferred. */
  readonly pitchDirection?: PitchDirection;
  /** Event-local instructions with source identities; omitted or empty means none. They consume no time. */
  readonly markings?: readonly EventMarking[];
  readonly duration: Duration;
  readonly dots: number;
  readonly onset: Rational;
  readonly time: Rational;
  readonly tupletIds: readonly string[];
  readonly beam: BeamPolicy;
  readonly stem: StemDirection;
  readonly tie: TiePolicy;
  readonly measureRest: boolean;
  /** Slashes with stems prescribe rhythm; stemless slashes leave rhythm improvised. */
  readonly rhythmic: boolean;
}

export interface Tuplet {
  readonly id: string;
  readonly actual: number;
  readonly normal: number;
  readonly eventIds: readonly string[];
  readonly bracket: 'auto' | 'yes' | 'no';
  readonly showRatio: boolean;
}

export interface Voice {
  readonly id: string;
  readonly events: readonly MusicEvent[];
  readonly tuplets: readonly Tuplet[];
}

export interface Annotation {
  readonly id: string;
  readonly kind: 'tempo' | 'dynamics' | 'direction' | 'harmony' | 'rehearsal';
  readonly onset: Rational;
  readonly text: string;
  readonly placement: 'above' | 'below';
  readonly bpm?: number;
  readonly beat?: Duration;
  readonly dots?: number;
}

export type Barline = 'single' | 'double' | 'final' | 'repeat-end' | 'none';
export interface Measure {
  readonly id: string;
  readonly number: string;
  readonly meter: Meter;
  readonly clef: Clef;
  readonly key: string;
  readonly voices: readonly Voice[];
  readonly annotations: readonly Annotation[];
  readonly breakBefore: 'auto' | 'line' | 'page';
  readonly keepWithNext: boolean;
  readonly endBar: Barline;
  readonly repeatStart: boolean;
  readonly pickup: boolean;
  readonly incomplete: boolean;
}

export interface Staff {
  readonly id: string;
  readonly label: string;
  /** Omitted means pitched. Rhythm uses one line; three-roads uses the five-line staff's outer and middle lines. */
  readonly notation?: StaffNotation;
  /** Rhythm and three-roads retain neutral treble/C defaults for compatibility; neither is printed. */
  readonly clef: Clef;
  readonly key: string;
  readonly measures: readonly Measure[];
}

export interface Score {
  readonly id: string;
  readonly label: string;
  readonly bracket: 'none' | 'brace' | 'bracket';
  readonly staves: readonly Staff[];
}

export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly sourceId: string;
  readonly measureId?: string;
}
