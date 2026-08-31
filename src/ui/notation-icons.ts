import type { ArticulationType, Clef, Duration, EventMarking, MusicEvent, OrnamentType } from '../model/types.js';
import type { IconDefinition } from './icon-definition.js';
import { phArrowDown, phArrowRight, phArrowUp, phArrowsVertical } from './icons/phosphor.js';
import {
  bravuraAccidentalDoubleFlat,
  bravuraAccidentalDoubleSharp,
  bravuraAccidentalFlat,
  bravuraAccidentalNatural,
  bravuraAccidentalQuarterToneFlatStein,
  bravuraAccidentalQuarterToneSharpStein,
  bravuraAccidentalSharp,
  bravuraAccidentalThreeQuarterTonesFlatZimmermann,
  bravuraAccidentalThreeQuarterTonesSharpStein,
  bravuraArticAccentAbove,
  bravuraArticMarcatoAbove,
  bravuraArticStaccatissimoAbove,
  bravuraArticStaccatoAbove,
  bravuraArticTenutoAbove,
  bravuraCClef,
  bravuraFClef,
  bravuraFermataAbove,
  bravuraGClef,
  bravuraNote128thUp,
  bravuraNote16thUp,
  bravuraNote32ndUp,
  bravuraNote64thUp,
  bravuraNote8thUp,
  bravuraNoteDoubleWhole,
  bravuraNoteHalfUp,
  bravuraNoteQuarterUp,
  bravuraNoteWhole,
  bravuraNoteheadSlashHorizontalEnds,
  bravuraNoteheadSlashWhiteDoubleWhole,
  bravuraNoteheadSlashWhiteHalf,
  bravuraNoteheadSlashWhiteWhole,
  bravuraOrnamentMordent,
  bravuraOrnamentShortTrill,
  bravuraOrnamentTrill,
  bravuraOrnamentTurn,
  bravuraOrnamentTurnInverted,
  bravuraRest128th,
  bravuraRest16th,
  bravuraRest32nd,
  bravuraRest64th,
  bravuraRest8th,
  bravuraRestDoubleWholeLegerLine,
  bravuraRestHalfLegerLine,
  bravuraRestQuarter,
  bravuraRestWholeLegerLine,
} from './icons/bravura.js';

const notes: Record<Duration, IconDefinition> = {
  breve: bravuraNoteDoubleWhole, whole: bravuraNoteWhole, half: bravuraNoteHalfUp,
  quarter: bravuraNoteQuarterUp, eighth: bravuraNote8thUp, sixteenth: bravuraNote16thUp,
  'thirty-second': bravuraNote32ndUp, 'sixty-fourth': bravuraNote64thUp, '128th': bravuraNote128thUp,
};
const rests: Record<Duration, IconDefinition> = {
  breve: bravuraRestDoubleWholeLegerLine, whole: bravuraRestWholeLegerLine, half: bravuraRestHalfLegerLine,
  quarter: bravuraRestQuarter, eighth: bravuraRest8th, sixteenth: bravuraRest16th,
  'thirty-second': bravuraRest32nd, 'sixty-fourth': bravuraRest64th, '128th': bravuraRest128th,
};
const alterations: Readonly<Record<number, IconDefinition>> = {
  '-2': bravuraAccidentalDoubleFlat, '-1.5': bravuraAccidentalThreeQuarterTonesFlatZimmermann,
  '-1': bravuraAccidentalFlat, '-0.5': bravuraAccidentalQuarterToneFlatStein,
  0: bravuraAccidentalNatural, 0.5: bravuraAccidentalQuarterToneSharpStein,
  1: bravuraAccidentalSharp, 1.5: bravuraAccidentalThreeQuarterTonesSharpStein, 2: bravuraAccidentalDoubleSharp,
};
const articulations: Record<ArticulationType, IconDefinition> = {
  accent: bravuraArticAccentAbove, staccato: bravuraArticStaccatoAbove, tenuto: bravuraArticTenutoAbove,
  marcato: bravuraArticMarcatoAbove, staccatissimo: bravuraArticStaccatissimoAbove, fermata: bravuraFermataAbove,
};
const ornaments: Record<OrnamentType, IconDefinition> = {
  trill: bravuraOrnamentTrill, turn: bravuraOrnamentTurn, 'inverted-turn': bravuraOrnamentTurnInverted,
  'upper-mordent': bravuraOrnamentShortTrill, 'lower-mordent': bravuraOrnamentMordent,
};

/** Leger-line rest variants distinguish whole and half rests outside a stave. */
export function durationIcon(duration: Duration, rest = false): IconDefinition { return (rest ? rests : notes)[duration]; }
export function alterationIcon(alteration: number): IconDefinition | undefined { return alterations[alteration]; }
export function clefIcon(clef: Clef): IconDefinition { return clef === 'treble' ? bravuraGClef : clef === 'bass' ? bravuraFClef : bravuraCClef; }
export function articulationIcon(type: ArticulationType): IconDefinition { return articulations[type]; }
export function ornamentIcon(type: OrnamentType): IconDefinition { return ornaments[type]; }
export function markingIcon(marking: EventMarking): IconDefinition {
  return marking.kind === 'articulation' ? articulations[marking.type]
    : marking.kind === 'ornament' ? ornaments[marking.type] : phArrowsVertical;
}
export function eventIcon(event: Pick<MusicEvent, 'kind' | 'duration' | 'rhythmic'> & Partial<Pick<MusicEvent, 'measureRest' | 'pitchDirection'>>): IconDefinition {
  if (event.kind === 'road') return event.pitchDirection === 'higher' ? phArrowUp
    : event.pitchDirection === 'lower' ? phArrowDown : phArrowRight;
  if (event.kind === 'slash') return !event.rhythmic || event.duration === 'whole' ? bravuraNoteheadSlashWhiteWhole
    : event.duration === 'breve' ? bravuraNoteheadSlashWhiteDoubleWhole
      : event.duration === 'half' ? bravuraNoteheadSlashWhiteHalf : bravuraNoteheadSlashHorizontalEnds;
  if (event.kind === 'rest' && event.measureRest) return durationIcon('whole', true);
  return durationIcon(event.duration, event.kind === 'rest');
}
