import type {
  AccidentalDisplay, Annotation, ArticulationType, Barline, BeamPolicy, Clef, Duration,
  EventMarking, Measure, MusicEvent, OrnamentType, PitchAlteration, PitchDirection, Score,
  StaffNotation, StemDirection, TiePolicy, Tuplet,
} from '../model/types.js';

/** UI admission and discovery, not a replacement for musical validation. */
export type AuthorEntryKind = MusicEvent['kind'] | 'rhythmic-slash';

// Keep the existing string-valued native-control consumer API, while checking
// every authored value and every staff kind against the primary model types.
export const ENTRY_KINDS: Readonly<Record<StaffNotation, readonly string[]>> = Object.freeze({
  pitched: Object.freeze(['note', 'chord', 'rest', 'rhythmic-slash', 'slash'] as const),
  rhythm: Object.freeze(['rhythm', 'rest', 'rhythmic-slash', 'slash'] as const),
  'three-roads': Object.freeze(['road', 'rest'] as const),
} satisfies Record<StaffNotation, readonly AuthorEntryKind[]>);

export const DEFAULT_ENTRY_KIND: Readonly<Record<StaffNotation, MusicEvent['kind']>> = Object.freeze({
  pitched: 'note', rhythm: 'rhythm', 'three-roads': 'road',
} satisfies Record<StaffNotation, MusicEvent['kind']>);

export interface AuthoringRoute {
  readonly path: string;
  /** Stable controls in author.html; a route may require opening its containing pane. */
  readonly controls: readonly string[];
}

export const AUTHORING_ROUTES = {
  entry: { path: 'Write notes → set Accidentals, Duration, Dots and Attack → Insert or Enter with the score focused', controls: ['toggle-entry', 'entry-accidentals', 'entry-duration', 'entry-dots', 'entry-attack', 'event-kind', 'event-duration', 'insert-event', 'score-editor'] },
  pitch: { path: 'Next entry → Pitch & octave; Tools → Edit → Pitch & octave', controls: ['event-pitch', 'selected-pitch'] },
  alteration: { path: 'Write notes → Accidentals; New-note options → Pitch alteration; Edit note → Set accidental', controls: ['entry-accidentals', 'event-alteration', 'note-microtone', 'note-natural'] },
  chord: { path: 'Next entry → Chord pitches; Edit chord → Edit chord pitches → Tools → Edit', controls: ['event-pitches', 'note-advanced-edit', 'selected-pitches'] },
  selected: { path: 'Edit note → Advanced properties; Tools → Edit → Selected event', controls: ['note-advanced-edit', 'selected-kind', 'selected-duration', 'selected-dots', 'update-event'] },
  quick: { path: 'Select music → Edit note', controls: ['edit-selected-event', 'note-duration', 'note-dots'] },
  direction: { path: 'Write notes → Direction beside the staff → Higher, Same or Lower; New-note options → Pitch direction; Select → Direction; More → Properties → Pitch direction', controls: ['entry-direction-trigger', 'entry-direction-chooser', 'entry-direction-higher', 'entry-direction-same', 'entry-direction-lower', 'event-direction', 'selection-direction', 'note-direction', 'selected-direction'] },
  engraving: { path: 'Next entry → New-event engraving; Tools → Edit → Accidental display, stem and beam', controls: ['event-accidental-display', 'event-stem', 'event-beam', 'selected-accidental-display', 'selected-stem', 'selected-beam'] },
  fullRest: { path: 'Next entry or Tools → Edit → Full-measure rest', controls: ['event-measure-rest', 'selected-measure-rest'] },
  attached: { path: 'Edit selected event → Attached marks; select a printed mark → Edit → its exact mark row', controls: ['edit-selected-event', 'note-attached-marks', 'event-markings-target', 'event-markings-rows'] },
  articulation: { path: 'Write notes → Attack; Tools → Edit → Attached marks → Add articulation', controls: ['entry-attack', 'add-event-articulation', 'event-markings-rows', 'apply-event-markings'] },
  ornament: { path: 'Write notes → Attack; Tools → Edit → Attached marks → Add ornament', controls: ['entry-attack', 'add-event-ornament', 'event-markings-rows', 'apply-event-markings'] },
  interval: { path: 'Tools → Edit → Attached marks → Add harmony interval', controls: ['add-event-interval', 'event-markings-rows', 'apply-event-markings'] },
  intervalChain: { path: 'Tools → Edit → Attached marks → Apply interval edits to the complete tie chain', controls: ['event-markings-tie-scope', 'event-markings-tie-help', 'apply-event-markings'] },
  ties: { path: 'Tools → Rhythm → Tie selected notes or Remove ties', controls: ['range-start', 'range-end', 'tie-events', 'clear-ties'] },
  tuplet: { path: 'Tools → Rhythm → Tuplet group', controls: ['tuplet-actual', 'tuplet-normal', 'tuplet-bracket', 'tuplet-ratio', 'wrap-tuplet'] },
  staff: { path: 'Document → Score setup → Staves', controls: ['score-setup-trigger', 'staff-label', 'staff-notation', 'staff-clef', 'staff-key', 'add-staff'] },
  measure: { path: 'Tools → Measure → Measure settings', controls: ['measure-meter', 'measure-groups', 'measure-clef', 'measure-key', 'apply-measure'] },
  voice: { path: 'Tools → Measure → Add voice; Location & actions → Voice', controls: ['add-voice', 'event-voice'] },
  barline: { path: 'Tools → Measure → Ending barline and Start repeat', controls: ['measure-end-bar', 'measure-repeat-start'] },
  completion: { path: 'Tools → Measure → Pickup, Incomplete draft and short-ending review', controls: ['measure-pickup', 'measure-incomplete', 'review-short-measure'] },
  annotation: { path: 'Tools → Markings → Chord symbols, directions and fixed musical position', controls: ['annotation-kind', 'annotation-text', 'annotation-at', 'annotation-placement'] },
  tempo: { path: 'Tools → Markings → Tempo', controls: ['annotation-kind', 'annotation-bpm', 'annotation-beat', 'annotation-dots'] },
  pages: { path: 'Pages → Paper, spacing and line/page boundaries', controls: ['page-paper', 'page-scale', 'page-max-measures', 'layout-break', 'layout-keep'] },
  source: { path: 'Source → edit supported musical HTML → Apply source', controls: ['source-trigger', 'source-input', 'source-apply'] },
} as const satisfies Readonly<Record<string, AuthoringRoute>>;

export type AuthoringRouteId = keyof typeof AUTHORING_ROUTES;
export interface NotationCapability {
  readonly label: string;
  readonly routes: readonly AuthoringRouteId[];
  readonly limitation: string;
}
export interface EventCapability extends NotationCapability {
  readonly entryChoices: readonly AuthorEntryKind[];
  readonly staves: readonly StaffNotation[];
}
export interface MarkingCapability extends NotationCapability {
  readonly events: readonly MusicEvent['kind'][];
}

export const STAFF_CAPABILITIES = {
  pitched: { label: 'Pitched · five lines', routes: ['staff', 'entry'], limitation: 'Absolute authored pitches; an instrument label does not transpose music.' },
  rhythm: { label: 'Rhythm · one line', routes: ['staff', 'entry'], limitation: 'No pitch, clef, key or percussion map; use Insert or Enter with the score focused instead of pitch gestures.' },
  'three-roads': { label: '3 roads music · three lines', routes: ['staff', 'direction', 'entry'], limitation: 'Only road events and rests; each voice keeps its preceding main-pitch reference across rests.' },
} as const satisfies Readonly<Record<StaffNotation, NotationCapability>>;

export const EVENT_CAPABILITIES = {
  note: { label: 'Note', entryChoices: ['note'], staves: ['pitched'], routes: ['entry', 'pitch', 'alteration', 'quick', 'selected'], limitation: 'Direct pitch placement and dragging require one supported pitched note; tied pitch changes require an explicit tie decision.' },
  chord: { label: 'Chord', entryChoices: ['chord'], staves: ['pitched'], routes: ['entry', 'chord', 'selected', 'quick'], limitation: 'Pitch lists name every tone; quick rhythm edits affect the whole chord and do not choose a tone for accidental editing.' },
  rest: { label: 'Rest', entryChoices: ['rest'], staves: ['pitched', 'rhythm', 'three-roads'], routes: ['entry', 'fullRest', 'selected', 'quick'], limitation: 'An ordinary rest has written duration; a full-measure rest follows meter. Neither introduces a pitch.' },
  slash: { label: 'Improvisation slash', entryChoices: ['rhythmic-slash', 'slash'], staves: ['pitched', 'rhythm'], routes: ['entry', 'selected', 'annotation'], limitation: 'Rhythmic slashes prescribe attacks; open slashes leave attacks improvised. Neither is a road instruction.' },
  rhythm: { label: 'Rhythm note (no pitch)', entryChoices: ['rhythm'], staves: ['rhythm'], routes: ['entry', 'selected', 'quick'], limitation: 'Written time without pitch; Insert or Enter uses the exact recipe without inferring vertical pitch geometry.' },
  road: { label: '3 roads note', entryChoices: ['road'], staves: ['three-roads'], routes: ['entry', 'direction', 'selected', 'quick', 'attached', 'interval', 'intervalChain'], limitation: 'Explicit higher/same/lower direction and written time; tied continuations are Same and retain the complete harmony.' },
} as const satisfies Readonly<Record<MusicEvent['kind'], EventCapability>>;

export const PITCH_DIRECTION_CAPABILITIES = {
  higher: { label: 'Higher (top)', routes: ['direction'], limitation: 'Higher than this voice’s previous main pitch; no specific interval or absolute pitch is inferred.' },
  same: { label: 'Same (middle)', routes: ['direction'], limitation: 'Retain the preceding main pitch, including across rests; starting pitch is a performer choice.' },
  lower: { label: 'Lower (bottom)', routes: ['direction'], limitation: 'Lower than this voice’s previous main pitch; ornaments and harmony tones do not replace that reference.' },
} as const satisfies Readonly<Record<PitchDirection, NotationCapability>>;

const alterationRoute = { routes: ['alteration', 'pitch', 'chord'], limitation: 'Absolute alteration from the named natural, independent of key or current accidental; accidental display is a separate engraving choice.' } as const;
export const PITCH_ALTERATION_CAPABILITIES = {
  [-2]: { label: 'Double flat', ...alterationRoute },
  [-1.5]: { label: 'Three-quarter flat', ...alterationRoute },
  [-1]: { label: 'Flat', ...alterationRoute },
  [-0.5]: { label: 'Quarter flat', ...alterationRoute },
  [0]: { label: 'Natural', ...alterationRoute },
  [0.5]: { label: 'Quarter sharp', ...alterationRoute },
  [1]: { label: 'Sharp', ...alterationRoute },
  [1.5]: { label: 'Three-quarter sharp', ...alterationRoute },
  [2]: { label: 'Double sharp', ...alterationRoute },
} as const satisfies Readonly<Record<PitchAlteration, NotationCapability>>;

export interface PitchAlterationChoice { readonly value: PitchAlteration; readonly label: string }
export const PITCH_ALTERATIONS: readonly PitchAlterationChoice[] = Object.freeze(
  (Object.keys(PITCH_ALTERATION_CAPABILITIES).map(Number) as PitchAlteration[])
    .sort((a, b) => a - b).map(value => Object.freeze({ value, label: PITCH_ALTERATION_CAPABILITIES[value].label })),
);

export const MARKING_CAPABILITIES = {
  articulation: { label: 'Articulation', events: ['note', 'chord', 'rest', 'slash', 'rhythm', 'road'], routes: ['attached', 'articulation'], limitation: 'Attached to the complete event, not a separate chord tone. Rests and open slashes allow fermata only. Placement is automatic opposite the drawn stem, or above without a stem.' },
  ornament: { label: 'Ornament', events: ['note', 'road'], routes: ['attached', 'ornament'], limitation: 'A printed instruction on one main pitch, not written auxiliary notes, realized playback or a chord-tone selector. Placement is automatic opposite the drawn stem, or above without a stem.' },
  interval: { label: 'Harmony interval', events: ['road'], routes: ['attached', 'interval', 'intervalChain'], limitation: 'Figures 1–13 with optional flat/sharp, excluding lowered unison, on road main notes. Above/below is musical direction. Explicit complete-tie scope applies interval edits across connected segments, preserving each segment’s articulations and ornaments; nothing is inherited automatically.' },
} as const satisfies Readonly<Record<EventMarking['kind'], MarkingCapability>>;

const attackArticulation = { routes: ['attached', 'articulation'], limitation: 'Requires a prescribed attack/release; unavailable on rests and open slashes.' } as const;
export const ARTICULATION_CAPABILITIES = {
  accent: { label: 'Accent', ...attackArticulation },
  staccato: { label: 'Staccato', ...attackArticulation },
  tenuto: { label: 'Tenuto', ...attackArticulation },
  marcato: { label: 'Marcato', ...attackArticulation },
  staccatissimo: { label: 'Staccatissimo', ...attackArticulation },
  fermata: { label: 'Fermata', routes: ['attached', 'articulation'], limitation: 'May attach to any event kind, including rests and open slashes; it does not add measured duration.' },
} as const satisfies Readonly<Record<ArticulationType, NotationCapability>>;

const ornamentRoute = { routes: ['attached', 'ornament'], limitation: 'Single pitched notes or road main notes only; no auxiliary pitch, ornament accidental or trill extension control.' } as const;
export const ORNAMENT_CAPABILITIES = {
  trill: { label: 'Trill', ...ornamentRoute },
  turn: { label: 'Turn', ...ornamentRoute },
  'inverted-turn': { label: 'Inverted turn', ...ornamentRoute },
  'upper-mordent': { label: 'Upper mordent', ...ornamentRoute },
  'lower-mordent': { label: 'Lower mordent', ...ornamentRoute },
} as const satisfies Readonly<Record<OrnamentType, NotationCapability>>;

// Canonical choices in the other current notation controls. These tables do
// not reproduce duration arithmetic, meter syntax, tie validation or layout.
const writtenValue = { routes: ['entry', 'selected', 'quick', 'tempo'], limitation: 'Written value is distinct from elapsed tuplet time. Full-measure rests follow meter; tempo beats do not insert events.' } as const;
export const DURATION_CAPABILITIES = {
  breve: { label: 'Breve', ...writtenValue }, whole: { label: 'Whole', ...writtenValue },
  half: { label: 'Half', ...writtenValue }, quarter: { label: 'Quarter', ...writtenValue },
  eighth: { label: 'Eighth', ...writtenValue }, sixteenth: { label: 'Sixteenth', ...writtenValue },
  'thirty-second': { label: '32nd', ...writtenValue }, 'sixty-fourth': { label: '64th', ...writtenValue },
  '128th': { label: '128th', ...writtenValue },
} as const satisfies Readonly<Record<Duration, NotationCapability>>;

const pitchedContext = { routes: ['staff', 'measure'], limitation: 'A pitched-staff context; rhythm and road staves omit clef and key rather than acquiring hidden pitches.' } as const;
export const CLEF_CAPABILITIES = {
  treble: { label: 'Treble', ...pitchedContext }, bass: { label: 'Bass', ...pitchedContext },
  alto: { label: 'Alto', ...pitchedContext }, tenor: { label: 'Tenor', ...pitchedContext },
} as const satisfies Readonly<Record<Clef, NotationCapability>>;

const stemChoice = { routes: ['engraving'], limitation: 'An engraving preference; it does not change pitch, duration, voice or open-slash meaning.' } as const;
export const STEM_CAPABILITIES = {
  auto: { label: 'Automatic', ...stemChoice }, up: { label: 'Up', ...stemChoice }, down: { label: 'Down', ...stemChoice },
} as const satisfies Readonly<Record<StemDirection, NotationCapability>>;

const beamChoice = { routes: ['engraving'], limitation: 'An engraving policy within supported rhythmic grouping, not a timing edit or cross-staff beam operation.' } as const;
export const BEAM_CAPABILITIES = {
  auto: { label: 'Follow beat groups', ...beamChoice }, start: { label: 'Start beam', ...beamChoice },
  continue: { label: 'Continue beam', ...beamChoice }, end: { label: 'End beam', ...beamChoice }, none: { label: 'No beam', ...beamChoice },
} as const satisfies Readonly<Record<BeamPolicy, NotationCapability>>;

const accidentalDisplay = { routes: ['engraving'], limitation: 'Controls the printed accidental, not absolute spelling or pitch alteration.' } as const;
export const ACCIDENTAL_DISPLAY_CAPABILITIES = {
  auto: { label: 'When needed', ...accidentalDisplay }, always: { label: 'Always', ...accidentalDisplay },
  courtesy: { label: 'Courtesy (parentheses)', ...accidentalDisplay },
} as const satisfies Readonly<Record<AccidentalDisplay, NotationCapability>>;

export const ANNOTATION_CAPABILITIES = {
  harmony: { label: 'Chord symbol', routes: ['annotation'], limitation: 'Fixed-position authored chord text, not analyzed harmony or an interval attached to a main note.' },
  direction: { label: 'Performance direction', routes: ['annotation'], limitation: 'Fixed-position text with explicit recipients; words do not create playback or new musical grammar.' },
  rehearsal: { label: 'Rehearsal mark', routes: ['annotation'], limitation: 'A fixed-position authored label; it does not create a structural navigation or repeat operation.' },
  dynamics: { label: 'Dynamics', routes: ['annotation'], limitation: 'Fixed-position dynamic text, not an event articulation or a playback envelope.' },
  tempo: { label: 'Tempo', routes: ['annotation', 'tempo'], limitation: 'Optional metronome value and beat with fixed-position text; playback is not implemented.' },
} as const satisfies Readonly<Record<Annotation['kind'], NotationCapability>>;

const annotationPlacement = { routes: ['annotation'], limitation: 'Printed side of a fixed-position instruction, independent of recipients and event ownership.' } as const;
export const ANNOTATION_PLACEMENT_CAPABILITIES = {
  above: { label: 'Above staff', ...annotationPlacement }, below: { label: 'Below staff', ...annotationPlacement },
} as const satisfies Readonly<Record<Annotation['placement'], NotationCapability>>;

export const MARK_PLACEMENT_CAPABILITIES = {
  auto: { label: 'Automatic', routes: ['source'], limitation: 'Legacy source value for articulations only, preserved without a placement selector. All articulations and ornaments follow the drawn stem automatically, opposite it or above when stemless. New articulations use auto and new ornaments keep the compatible above source value.' },
  above: { label: 'Above', routes: ['interval'], limitation: 'Musical direction above the main pitch for harmony intervals. Legacy articulation/ornament source values remain accepted but do not control printed placement.' },
  below: { label: 'Below', routes: ['interval'], limitation: 'Musical direction below the main pitch for harmony intervals. Legacy articulation/ornament source values remain accepted but do not control printed placement.' },
} as const satisfies Readonly<Record<EventMarking['placement'], NotationCapability>>;

const barlineChoice = { routes: ['barline'], limitation: 'An authored ending barline; start-repeat has its own control and repeat playback is not implemented.' } as const;
export const BARLINE_CAPABILITIES = {
  single: { label: 'Single', ...barlineChoice }, double: { label: 'Double', ...barlineChoice },
  final: { label: 'Final', ...barlineChoice }, 'repeat-end': { label: 'Repeat end', ...barlineChoice }, none: { label: 'None', ...barlineChoice },
} as const satisfies Readonly<Record<Barline, NotationCapability>>;

const tupletBracket = { routes: ['tuplet'], limitation: 'Tuplet bracket display only; actual/normal values determine the existing group’s time ratio.' } as const;
export const TUPLET_BRACKET_CAPABILITIES = {
  auto: { label: 'Automatic', ...tupletBracket }, yes: { label: 'Show', ...tupletBracket }, no: { label: 'Hide', ...tupletBracket },
} as const satisfies Readonly<Record<Tuplet['bracket'], NotationCapability>>;

const layoutBreak = { routes: ['pages'], limitation: 'Author edits a per-view aligned-column layout profile. Raw break-before attributes remain Source details; a break does not certify a safe turn.' } as const;
export const BREAK_CAPABILITIES = {
  auto: { label: 'Automatically', ...layoutBreak }, line: { label: 'On a new line', ...layoutBreak }, page: { label: 'On a new page', ...layoutBreak },
} as const satisfies Readonly<Record<Measure['breakBefore'], NotationCapability>>;

const tieOperation = { routes: ['ties'], limitation: 'Created through a validated connected tie chain, not an independent flag picker; compatible kinds, pitches and road harmony must remain valid.' } as const;
export const TIE_CAPABILITIES = {
  none: { label: 'No tie', routes: ['ties'], limitation: 'Remove ties is an explicit operation on the connected chain; editing another property does not silently remove it.' },
  start: { label: 'Start tie', ...tieOperation }, continue: { label: 'Continue tie', ...tieOperation }, end: { label: 'End tie', ...tieOperation },
} as const satisfies Readonly<Record<TiePolicy, NotationCapability>>;

const scoreBracket = { routes: ['source'], limitation: 'Raw score bracket selection remains in Source. Templates provide initial brackets; Score setup does not expose a bracket selector.' } as const;
export const SCORE_BRACKET_CAPABILITIES = {
  none: { label: 'None', ...scoreBracket }, brace: { label: 'Brace', ...scoreBracket }, bracket: { label: 'Bracket', ...scoreBracket },
} as const satisfies Readonly<Record<Score['bracket'], NotationCapability>>;

export type AttributeCapability =
  | { readonly route: Exclude<AuthoringRouteId, 'source'>; readonly note?: string }
  | { readonly route: 'source'; readonly note: string };
export interface ElementCapability {
  readonly description: string;
  readonly route: AuthoringRouteId;
  readonly attributes: Readonly<Record<string, AttributeCapability>>;
}

const source = (note: string): AttributeCapability => ({ route: 'source', note });
const rawLayout = {
  'max-measures': source('Raw root layout attribute. Pages offers a separate per-view measure-count preference.'),
  'justify-last': source('Raw root layout attribute. Pages stores final-system justification in the layout profile.'),
  'measure-numbers': source('Raw root layout attribute. Pages stores number visibility in the layout profile.'),
  'print-width': source('Raw component width, not paper size. Author Pages derives physical content width from paper and margins.'),
  'print-preview': source('Component preview attribute; Author uses its own Pages view and does not expose this boolean as a musical edit.'),
} satisfies Record<string, AttributeCapability>;
const inheritedContext = {
  clef: source('Inherited root/staff context. Score setup edits a staff’s initial clef; Measure edits explicit local context.'),
  key: source('Inherited root/staff context. Score setup edits a staff’s initial key; Measure edits explicit local context.'),
  meter: source('Inherited signature syntax; Tools → Measure edits the aligned bar’s effective meter.'),
  groups: source('Inherited beat-group syntax; Tools → Measure edits explicit groups on the aligned bar.'),
} satisfies Record<string, AttributeCapability>;
const writtenRhythm = {
  duration: { route: 'selected' }, dots: { route: 'selected' },
  dotted: source('Legacy one-dot boolean; visual controls edit the supported dot count rather than selecting this spelling.'),
  beam: { route: 'engraving' }, stem: { route: 'engraving' }, tie: { route: 'ties' },
  triplet: source('Legacy flat triplet syntax. Tools → Rhythm authors explicit tuplet groups instead of this alias.'),
} satisfies Record<string, AttributeCapability>;
const positionedText = {
  text: { route: 'annotation' }, placement: { route: 'annotation' }, at: { route: 'annotation' },
} satisfies Record<string, AttributeCapability>;

/**
 * Cover the schema names, not their grammar. Tests compare these keys with the
 * DOM schema and declared custom-element registrations. Adding an attribute
 * requires a route decision even when its deliberate home remains Source.
 */
export const NOTATION_ELEMENT_CAPABILITIES = {
  'music-system': {
    description: 'Multi-staff score structure; templates and Score setup create it as needed.', route: 'staff',
    attributes: { label: source('Source score label is independent of document title metadata.'), bracket: source('Choose the source brace/bracket/none; templates provide initial brackets but there is no bracket form.'), ...inheritedContext, ...rawLayout },
  },
  'music-staff': {
    description: 'Pitched, rhythm or road staff with explicit notation and initial context.', route: 'staff',
    attributes: { label: { route: 'staff' }, notation: { route: 'staff' }, ...inheritedContext, clef: { route: 'staff' }, key: { route: 'staff' }, ...rawLayout },
  },
  'music-measure': {
    description: 'Aligned bar with local context and publication/completion choices.', route: 'measure',
    attributes: {
      label: source('Raw accessible measure label has no dedicated form.'), number: source('Author numbers structural additions; arbitrary source numbering remains an explicit Source edit.'),
      clef: { route: 'measure' }, key: { route: 'measure' }, meter: { route: 'measure' }, groups: { route: 'measure' },
      'break-before': source('Raw boundary hint. Author Pages edits the corresponding column in a per-view layout profile.'),
      'keep-with-next': source('Raw keep hint. Author Pages stores its own per-view preference.'),
      'end-bar': { route: 'barline' }, 'repeat-start': { route: 'barline' }, pickup: { route: 'completion' }, incomplete: { route: 'completion' }, ...rawLayout,
    },
  },
  'music-voice': { description: 'Sequential voice selected through Location; Add voice creates its container.', route: 'voice', attributes: {} },
  'music-tuplet': { description: 'Explicit, possibly nested tuplet group within one bar.', route: 'tuplet', attributes: { actual: { route: 'tuplet' }, normal: { route: 'tuplet' }, bracket: { route: 'tuplet' }, ratio: { route: 'tuplet' } } },
  'music-note': { description: 'One absolute pitch with written time and optional attached marks.', route: 'pitch', attributes: { pitch: { route: 'pitch' }, accidental: source('Separate accidental attribute is an alternate source spelling; pitch controls set absolute spelling without requiring this alias.'), 'accidental-display': { route: 'engraving' }, ...writtenRhythm } },
  'music-chord': { description: 'Complete explicit pitch list sharing written time.', route: 'chord', attributes: { pitches: { route: 'chord' }, 'accidental-display': { route: 'engraving', note: 'Shared display choice; individual nested pitch policies remain Source details and survive unrelated edits.' }, ...writtenRhythm } },
  'music-rest': { description: 'Ordinary written rest or meter-following full-measure rest.', route: 'fullRest', attributes: { measure: { route: 'fullRest' }, ...writtenRhythm, tie: source('Rests cannot carry a non-none tie. The shared schema name is not permission to create one through Source or a form.') } },
  'music-slash': { description: 'Open improvisation or explicitly prescribed slash rhythm.', route: 'entry', attributes: { rhythmic: { route: 'entry' }, ...writtenRhythm, tie: source('Slashes cannot carry a non-none tie. Use a supported written event kind when sustain requires ties.') } },
  'music-rhythm': { description: 'Pitch-free written duration on a one-line rhythm staff.', route: 'entry', attributes: { ...writtenRhythm } },
  'music-road': { description: 'Relative main-pitch direction with written time on a road staff.', route: 'direction', attributes: { direction: { route: 'direction' }, ...writtenRhythm } },
  'music-articulation': { description: 'Event-owned articulation with its own source identity.', route: 'articulation', attributes: { type: { route: 'articulation' }, placement: source('Legacy values are preserved. Automatic placement puts articulations opposite the drawn stem, or above without a stem; this attribute is not an engraving override.') } },
  'music-ornament': { description: 'Event-owned ornament instruction, not auxiliary written notes.', route: 'ornament', attributes: { type: { route: 'ornament' }, placement: source('Legacy values are preserved. Automatic placement puts ornaments opposite the drawn stem, or above without a stem; this attribute is not an engraving override.') } },
  'music-interval': { description: 'Harmony interval attached to a road main note, distinct from a chord symbol; complete-tie scope is an explicit editing operation.', route: 'interval', attributes: { value: { route: 'interval', note: 'Choose complete-tie scope to apply interval changes across connected tied road notes without changing each segment’s other marks.' }, placement: { route: 'interval', note: 'Above/below is musical direction, not a cosmetic placement setting; complete-tie scope also applies this direction change.' } } },
  'music-meter': { description: 'Alternate child-element meter syntax; Measure exposes the musical signature and groups.', route: 'measure', attributes: { top: { route: 'measure' }, bottom: { route: 'measure' }, groups: { route: 'measure' } } },
  'music-tempo': { description: 'Fixed-position tempo text and optional metronome value.', route: 'tempo', attributes: { marking: { route: 'annotation' }, bpm: { route: 'tempo' }, beat: { route: 'tempo' }, dots: { route: 'tempo' }, dotted: source('Legacy tempo-dot alias; the tempo form edits the dot count.'), ...positionedText } },
  'music-dynamics': { description: 'Fixed-position dynamic text with explicit instruction recipients.', route: 'annotation', attributes: { level: { route: 'annotation' }, ...positionedText } },
  'music-direction': { description: 'Fixed-position performance instruction, not generated playback behavior.', route: 'annotation', attributes: { ...positionedText } },
  'music-harmony': { description: 'Fixed-position authored chord-symbol text, not an event-relative harmony interval.', route: 'annotation', attributes: { ...positionedText } },
  'music-rehearsal': { description: 'Fixed-position rehearsal mark with explicit recipients.', route: 'annotation', attributes: { ...positionedText } },
} as const satisfies Readonly<Record<`music-${string}`, ElementCapability>>;
