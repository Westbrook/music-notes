import type { ArticulationType, Duration, OrnamentType } from '../model/types.js';
import type { IconDefinition } from '../ui/icon-definition.js';
import type { NativeOption } from '../ui/native-options.js';
import { alterationIcon, articulationIcon, durationIcon, ornamentIcon } from '../ui/notation-icons.js';
import { bravuraAugmentationDot } from '../ui/icons/bravura.js';
import { phMinus } from '../ui/icons/phosphor.js';
import { PITCH_ALTERATIONS } from './notation-capabilities.js';
import type { EventInput } from './types.js';

// Runtime labels do not need the capability records' routes and explanations.
const durationLabels: Readonly<Record<Duration, string>> = {
  breve: 'Breve', whole: 'Whole', half: 'Half', quarter: 'Quarter', eighth: 'Eighth',
  sixteenth: 'Sixteenth', 'thirty-second': '32nd', 'sixty-fourth': '64th', '128th': '128th',
};
const articulationLabels: Readonly<Record<ArticulationType, string>> = {
  accent: 'Accent', staccato: 'Staccato', tenuto: 'Tenuto', marcato: 'Marcato', staccatissimo: 'Staccatissimo', fermata: 'Fermata',
};
const ornamentLabels: Readonly<Record<OrnamentType, string>> = {
  trill: 'Trill', turn: 'Turn', 'inverted-turn': 'Inverted turn', 'upper-mordent': 'Upper mordent', 'lower-mordent': 'Lower mordent',
};

const alterationOrder = [-1, 0, 1, -2, -1.5, -0.5, 0.5, 1.5, 2];
export const ENTRY_ACCIDENTAL_OPTIONS: readonly NativeOption[] = alterationOrder.map(value => ({
  value: String(value), label: PITCH_ALTERATIONS.find(choice => choice.value === value)!.label, icon: alterationIcon(value),
}));

const durationOrder: readonly Duration[] = ['half', 'quarter', 'eighth', 'sixteenth', 'whole', 'breve', 'thirty-second', 'sixty-fourth', '128th'];
export function entryDurationOptions(rest = false): readonly NativeOption[] {
  return durationOrder.map(value => ({ value, label: durationLabels[value], icon: durationIcon(value, rest) }));
}
export const ENTRY_DURATION_OPTIONS = entryDurationOptions();

/** Repeat the existing Bravura dot outline, preserving its music-icon scale. */
function dotsIcon(count: number): IconDefinition {
  if (count === 1) return bravuraAugmentationDot;
  return {
    name: `music:augmentationDots${count}`, viewBox: bravuraAugmentationDot.viewBox,
    paths: Array.from({ length: count }, (_, index) => {
      const x = 50 + (index - (count - 1) / 2) * 175;
      return `M${x + 50} 0q0-22-14-36T${x}-50Q${x - 21}-50 ${x - 35}-36T${x - 50} 0Q${x - 49} 21 ${x - 35} 35T${x} 50q22-1 36-15T${x + 50} 0Z`;
    }),
  };
}
export const ENTRY_DOTS_OPTIONS: readonly NativeOption[] = [
  ...[1, 2, 3].map(value => ({ value: String(value), label: `${value} dot${value === 1 ? '' : 's'}`, icon: dotsIcon(value) })),
  { value: '0', label: 'None', icon: phMinus },
];

export const ENTRY_ATTACK_OPTIONS: readonly NativeOption[] = [
  ...(Object.keys(articulationLabels) as ArticulationType[]).map(value => ({
    value: `articulation:${value}`, label: articulationLabels[value], icon: articulationIcon(value),
  })),
  ...(Object.keys(ornamentLabels) as OrnamentType[]).map(value => ({
    value: `ornament:${value}`, label: ornamentLabels[value], icon: ornamentIcon(value),
  })),
  { value: 'none', label: 'None', icon: phMinus },
];

export function entryAttack(value: string): EventInput['attack'] {
  if (value === 'none') return undefined;
  if (!ENTRY_ATTACK_OPTIONS.some(option => option.value === value)) throw new Error('Choose a supported attack for the next event.');
  const [kind, type] = value.split(':');
  return kind === 'articulation' ? { kind, type: type as ArticulationType } : { kind: 'ornament', type: type as OrnamentType };
}

export function entryAttackAllowed(value: string, kind: string): boolean {
  const attack = entryAttack(value);
  if (!attack) return true;
  if (attack.kind === 'ornament') return kind === 'note' || kind === 'road';
  return attack.type === 'fermata' || kind !== 'rest' && kind !== 'slash';
}

export function entryAttackOptions(kind: string): readonly NativeOption[] {
  return ENTRY_ATTACK_OPTIONS.map(option => ({ ...option, disabled: !entryAttackAllowed(option.value, kind) }));
}
