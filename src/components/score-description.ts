import { formatRational, harmonyIntervalDescription, harmonyIntervalText, pitchDescription } from '../model/index.js';
import type { Score } from '../model/types.js';

/** Plain text performer description, reusable without a component or engraving engine. */
export function describeScore(score: Score): string {
  const lines = [score.label || 'Music score'];
  for (const staff of score.staves) {
    const rhythm = staff.notation === 'rhythm';
    const roads = staff.notation === 'three-roads';
    lines.push(`${staff.label || 'Staff'}; ${roads ? '3 roads music; top higher, middle same, bottom lower; pitch chosen by the performer' : rhythm ? 'single-line rhythm staff; pitch unspecified' : `${staff.clef} clef`}.`);
    if (roads) lines.push('Choose a starting reference pitch for each voice. Each attack compares with the last main pitch in that voice; rests preserve the reference. Harmony tones and ornament auxiliaries do not change that reference. A tied same direction sustains the main pitch and its harmonies without a new attack.');
    for (const measure of staff.measures) {
      lines.push(`Measure ${measure.number}; ${measure.meter.display}, groups ${measure.meter.groups.join(' + ')}`
        + `${rhythm || roads ? '' : `; key ${measure.key}; ${measure.clef} clef`}${measure.pickup ? '; pickup' : ''}${measure.incomplete ? '; incomplete draft' : ''}.`);
      for (const [index, voice] of measure.voices.entries()) {
        const events = voice.events.map((event) => {
          const name = event.kind === 'rest' ? event.measureRest ? 'full-measure rest' : 'rest'
            : event.kind === 'slash' ? event.rhythmic ? 'rhythmic slash' : 'improvised beat slash'
              : event.kind === 'rhythm' ? 'rhythm note; pitch unspecified'
                : event.kind === 'road' ? `${event.pitchDirection}, ${event.pitchDirection === 'higher' ? 'top' : event.pitchDirection === 'lower' ? 'bottom' : 'middle'} road${event.tie === 'continue' || event.tie === 'end' ? '; sustain without a new attack' : ''}`
                  : event.pitches.map(pitchDescription).join(' + ');
          const tuplets = event.tupletIds.map((id) => voice.tuplets.find((tuplet) => tuplet.id === id))
            .filter((tuplet) => tuplet !== undefined).map((tuplet) => `${tuplet.actual}:${tuplet.normal}`).join(' within ');
          const markings = (event.markings ?? []).map(marking => marking.kind === 'interval'
            ? `harmony ${harmonyIntervalText(marking.interval)}: ${harmonyIntervalDescription(marking.interval)} ${marking.placement} the main pitch`
            : marking.type.replaceAll('-', ' '));
          return `${name}, ${event.dots ? `${event.dots} dot${event.dots > 1 ? 's' : ''} ` : ''}${event.duration}`
            + `${tuplets ? ` in ${tuplets} tuplet` : ''}${event.tie !== 'none' ? `, tie ${event.tie}` : ''}`
            + `${markings.length ? `; ${markings.join('; ')}` : ''}`
            + ` (at ${formatRational(event.onset)}, duration ${formatRational(event.time)} whole notes)`;
        });
        const content = events.length ? events.join('; ')
          : `${measure.incomplete && !measure.pickup ? 'empty draft' : 'empty voice'}; rhythm not yet written`;
        lines.push(`  Voice ${index + 1}: ${content}.`);
      }
      for (const annotation of measure.annotations) {
        lines.push(`  ${annotation.kind} at ${formatRational(annotation.onset)}: ${annotation.text}`
          + (annotation.bpm === undefined ? '' : `; ${annotation.dots ? 'dotted ' : ''}${annotation.beat ?? 'quarter'} = ${annotation.bpm}`));
      }
      if (measure.breakBefore !== 'auto') lines.push(`  Starts a new ${measure.breakBefore}.`);
    }
  }
  return lines.join('\n');
}
