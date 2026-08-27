import { add, durationTime, equals, formatRational, meterTime, multiply, parseMeter, pitchText, rational, validateScore } from '../model/index';
import type { Annotation, Measure, Meter, MusicEvent, Score, Tuplet, Voice } from '../model/types';

type Attribute = readonly [string, string | number | boolean | undefined];

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Cannot serialize score: ${message}`);
}

function escapeAttribute(value: string): string {
  requireValue(!value.includes('\0'), 'HTML cannot preserve a null character.');
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');
}

function attributes(values: readonly Attribute[]): string {
  return values.filter(([, value]) => value !== false && value !== undefined)
    .map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeAttribute(String(value))}"`).join('');
}

function sameMeter(a: Meter, b: Meter): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator && a.display === b.display
    && a.explicitGroups === b.explicitGroups && a.groups.length === b.groups.length
    && a.groups.every((group, index) => group === b.groups[index]);
}

/**
 * Canonical, readable HTML. Throws when a programmatic model cannot be represented
 * without losing timing or pitch information; it never silently repairs music.
 */
export function serializeScore(score: Score): string {
  const errors = validateScore(score).filter(diagnostic => diagnostic.severity === 'error');
  requireValue(!errors.length, errors.map(diagnostic => `${diagnostic.sourceId}: ${diagnostic.message}`).join(' '));
  const lines: string[] = [];
  const ids = new Set<string>();
  const claim = (id: string): string => {
    requireValue(typeof id === 'string' && id.length > 0 && !/\s/.test(id), 'model ids must be nonempty and contain no whitespace.');
    requireValue(!ids.has(id), `duplicate model id "${id}".`);
    ids.add(id);
    return id;
  };
  const line = (depth: number, value: string): void => { lines.push(`${'  '.repeat(depth)}${value}`); };
  const open = (depth: number, tag: string, values: readonly Attribute[]): void => line(depth, `<${tag}${attributes(values)}>`);
  const close = (depth: number, tag: string): void => line(depth, `</${tag}>`);
  const leaf = (depth: number, tag: string, values: readonly Attribute[]): void => line(depth, `<${tag}${attributes(values)}></${tag}>`);

  const writeAnnotation = (annotation: Annotation, depth: number): void => {
    const textAttribute = annotation.kind === 'tempo' ? 'marking' : annotation.kind === 'dynamics' ? 'level' : 'text';
    requireValue(annotation.kind === 'tempo' || (annotation.bpm === undefined && annotation.beat === undefined && annotation.dots === undefined), 'tempo fields belong only to tempo annotations.');
    leaf(depth, `music-${annotation.kind}`, [
      ['id', claim(annotation.id)], [textAttribute, annotation.text || undefined],
      ['at', annotation.onset.numerator ? formatRational(annotation.onset) : undefined],
      ['placement', annotation.placement !== (annotation.kind === 'dynamics' ? 'below' : 'above') ? annotation.placement : undefined],
      ['bpm', annotation.bpm], ['beat', annotation.beat], ['dots', annotation.dots],
    ]);
  };

  const writeEvent = (event: MusicEvent, depth: number): void => {
    const pitched = event.kind === 'note' || event.kind === 'chord';
    requireValue(pitched || event.pitches.length === 0, `unpitched event "${event.id}" has pitches.`);
    requireValue(event.kind !== 'note' || event.pitches.length === 1, `note "${event.id}" must have exactly one pitch.`);
    requireValue(event.kind !== 'chord' || event.pitches.length > 0, `chord "${event.id}" has no pitches.`);
    const display = event.pitches[0]?.display;
    requireValue(event.pitches.every(pitch => pitch.display === display), `chord "${event.id}" has different accidental display policies per pitch. The pitches attribute supports one shared accidental-display.`);
    requireValue(!event.measureRest || event.kind === 'rest', `only a rest can be a measure rest ("${event.id}").`);
    requireValue(!event.rhythmic || event.kind === 'slash', `only a slash can have the rhythmic flag ("${event.id}").`);
    leaf(depth, `music-${event.kind}`, [
      ['id', claim(event.id)],
      [event.kind === 'chord' ? 'pitches' : 'pitch', pitched ? event.pitches.map(pitchText).join(' ') : undefined],
      ['duration', event.measureRest && event.duration === 'whole' ? undefined : event.duration],
      ['measure', event.measureRest], ['dots', event.dots || undefined],
      ['accidental-display', display && display !== 'auto' ? display : undefined],
      ['beam', event.beam !== (event.measureRest ? 'none' : 'auto') ? event.beam : undefined],
      ['stem', event.stem !== 'auto' ? event.stem : undefined],
      ['tie', event.tie !== 'none' ? event.tie : undefined],
      ['rhythmic', event.rhythmic],
    ]);
  };

  const writeVoice = (voice: Voice, measure: Measure, depth: number): void => {
    open(depth, 'music-voice', [['id', claim(voice.id)]]);
    const tuplets = new Map<string, Tuplet>();
    for (const tuplet of voice.tuplets) {
      requireValue(!tuplets.has(tuplet.id), `duplicate tuplet id "${tuplet.id}".`);
      requireValue(Number.isInteger(tuplet.actual) && tuplet.actual >= 2 && tuplet.actual <= 64 && Number.isInteger(tuplet.normal) && tuplet.normal >= 1 && tuplet.normal <= 64, `tuplet "${tuplet.id}" needs actual 2..64 and normal 1..64.`);
      tuplets.set(tuplet.id, tuplet);
    }
    const opened = new Set<string>();
    const memberships = new Map<string, string[]>();
    let active: string[] = [];
    let onset = rational(0);
    for (const event of voice.events) {
      requireValue(equals(event.onset, onset), `event "${event.id}" is not sequential. Use explicit rests to represent gaps and separate music-voice elements for simultaneous events.`);
      requireValue(event.tupletIds.length <= 16, 'tuplet nesting exceeds the DOM limit of 16.');
      let common = 0;
      while (common < active.length && common < event.tupletIds.length && active[common] === event.tupletIds[common]) common++;
      for (let index = active.length - 1; index >= common; index--) close(depth + 1 + index, 'music-tuplet');
      active = active.slice(0, common);
      for (const id of event.tupletIds.slice(common)) {
        const tuplet = tuplets.get(id);
        requireValue(tuplet, `event "${event.id}" refers to unknown tuplet "${id}".`);
        requireValue(!opened.has(id), `tuplet "${id}" is not contiguous or its nesting crosses another tuplet.`);
        opened.add(id);
        memberships.set(id, []);
        open(depth + 1 + active.length, 'music-tuplet', [
          ['id', claim(id)], ['actual', tuplet.actual], ['normal', tuplet.normal],
          ['bracket', tuplet.bracket !== 'auto' ? tuplet.bracket : undefined], ['ratio', tuplet.showRatio],
        ]);
        active.push(id);
      }
      let expectedTime = event.measureRest ? meterTime(measure.meter) : durationTime(event.duration, event.dots);
      for (const id of active) {
        const tuplet = tuplets.get(id)!;
        expectedTime = multiply(expectedTime, rational(tuplet.normal, tuplet.actual));
        memberships.get(id)!.push(event.id);
      }
      requireValue(equals(event.time, expectedTime), `event "${event.id}" has a time that disagrees with its duration, dots, or tuplets.`);
      writeEvent(event, depth + 1 + active.length);
      onset = add(onset, event.time);
    }
    for (let index = active.length - 1; index >= 0; index--) close(depth + 1 + index, 'music-tuplet');
    for (const tuplet of voice.tuplets) {
      const actual = memberships.get(tuplet.id);
      requireValue(actual && actual.length === tuplet.eventIds.length && actual.every((id, index) => id === tuplet.eventIds[index]), `tuplet "${tuplet.id}" membership does not match its events.`);
    }
    close(depth, 'music-voice');
  };

  open(0, 'music-system', [['id', claim(score.id)], ['label', score.label || undefined], ['bracket', score.bracket !== 'none' ? score.bracket : undefined]]);
  for (const staff of score.staves) {
    open(1, 'music-staff', [['id', claim(staff.id)], ['label', staff.label || undefined], ['clef', staff.clef !== 'treble' ? staff.clef : undefined], ['key', staff.key !== 'C' ? staff.key : undefined]]);
    let previousMeter: Meter | undefined;
    let previousClef = staff.clef;
    let previousKey = staff.key;
    for (const measure of staff.measures) {
      const [top, bottom] = measure.meter.display.split('/');
      const normalized = parseMeter(top, bottom, measure.meter.explicitGroups ? measure.meter.groups : undefined);
      requireValue(sameMeter(normalized, measure.meter), `meter "${measure.meter.display}" has inconsistent display, grouping, or values.`);
      const meterChanged = !previousMeter || !sameMeter(previousMeter, measure.meter);
      open(2, 'music-measure', [
        ['id', claim(measure.id)], ['number', measure.number],
        ['meter', meterChanged ? measure.meter.display : undefined],
        ['groups', meterChanged && measure.meter.explicitGroups ? measure.meter.groups.join('+') : undefined],
        ['clef', measure.clef !== previousClef ? measure.clef : undefined], ['key', measure.key !== previousKey ? measure.key : undefined],
        ['break-before', measure.breakBefore !== 'auto' ? measure.breakBefore : undefined],
        ['keep-with-next', measure.keepWithNext], ['end-bar', measure.endBar !== 'single' ? measure.endBar : undefined],
        ['repeat-start', measure.repeatStart], ['pickup', measure.pickup], ['incomplete', measure.incomplete],
      ]);
      for (const annotation of measure.annotations) writeAnnotation(annotation, 3);
      for (const voice of measure.voices) writeVoice(voice, measure, 3);
      close(2, 'music-measure');
      previousMeter = measure.meter;
      previousClef = measure.clef;
      previousKey = measure.key;
    }
    close(1, 'music-staff');
  }
  close(0, 'music-system');
  return `${lines.join('\n')}\n`;
}
