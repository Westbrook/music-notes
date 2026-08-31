import { harmonyIntervalText, pitchDescription } from '../model/index.js';
import type { EventMarking, MusicEvent } from '../model/types.js';

export const directionLabel = (direction: string | undefined): string => direction === 'higher' ? 'Higher (top)'
  : direction === 'same' ? 'Same (middle)' : direction === 'lower' ? 'Lower (bottom)' : 'Choose direction';

export function eventLabel(event: MusicEvent): string {
  const name = event.kind === 'rest' ? event.measureRest ? 'Measure rest' : 'Rest'
    : event.kind === 'slash' ? event.rhythmic ? 'Written slash rhythm' : 'Open slash'
      : event.kind === 'road' ? `3 roads note · ${directionLabel(event.pitchDirection)}`
        : event.kind === 'rhythm' ? 'Rhythm note' : event.pitches.map(pitchDescription).join(' + ');
  return `${name} · ${event.duration}${event.dots ? `, ${event.dots} dot${event.dots === 1 ? '' : 's'}` : ''}`;
}

export const markingLabel = (marking: EventMarking): string => marking.kind === 'interval'
  ? `Harmony ${harmonyIntervalText(marking.interval)} ${marking.placement}` : marking.type.replaceAll('-', ' ');
