import type { Clef, Duration } from '../src/model/types.js';

import galleryHTML from '../index.html?raw';

const note = (pitch: string, duration = 'quarter', attributes = '') => `<music-note pitch="${pitch}" duration="${duration}" ${attributes}></music-note>`;
const rest = (duration = 'quarter', attributes = '') => `<music-rest duration="${duration}" ${attributes}></music-rest>`;
const chord = (pitches: string, duration = 'quarter', attributes = '') => `<music-chord pitches="${pitches}" duration="${duration}" ${attributes}></music-chord>`;
const slash = (duration = 'quarter', rhythmic = true) => `<music-slash duration="${duration}"${rhythmic ? ' rhythmic' : ''}></music-slash>`;
const tuplet = (actual: number, normal: number, content: string, attributes = '') => `<music-tuplet actual="${actual}" normal="${normal}" ${attributes}>${content}</music-tuplet>`;
const bar = (content: string, attributes = '') => `<music-measure ${attributes}>${content}</music-measure>`;

export function alignmentScore(): string {
  const upper = [
    note('C5', 'half') + note('D5', 'half'),
    tuplet(3, 2, ['E5', 'D5', 'C5'].map(pitch => note(pitch)).join('')) + note('F5', 'half'),
    tuplet(5, 4, ['E5', 'D5', 'C5', 'B4', 'A4'].map(pitch => note(pitch, 'eighth')).join(''), 'ratio') + note('G4', 'half'),
    ['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'].map(pitch => note(pitch, 'eighth')).join(''),
    note('C5', 'whole'),
    note('D5', 'half', 'dotted') + note('C5'),
  ];
  const lower = [
    ['C3', 'D3', 'E3', 'F3'].map(pitch => note(pitch)).join(''),
    note('C3', 'half') + note('D3') + note('E3'),
    note('G2', 'half') + note('C3', 'half'),
    note('C3', 'whole'),
    ['F3', 'E3', 'D3', 'G2'].map(pitch => note(pitch)).join(''),
    note('G2', 'half') + note('C3', 'half'),
  ];
  return `<music-system label="Aligned ensemble — half notes, quarters and tuplets" bracket="bracket">
    <music-staff clef="treble" label="Flute">${upper.map((content, index) => bar(content, index === 5 ? 'end-bar="final"' : '')).join('')}</music-staff>
    <music-staff clef="bass" label="Cello">${lower.map((content, index) => bar(content, index === 5 ? 'end-bar="final"' : '')).join('')}</music-staff>
  </music-system>`;
}

export function meterRestScore(): string {
  return `<music-staff label="Meter inheritance and full-measure rests" meter="7/8" groups="2+2+3">
    ${bar('<music-rest measure></music-rest>')}
    ${bar('<music-rest measure></music-rest>')}
    ${bar('<music-meter top="5" bottom="4" groups="3+2"></music-meter><music-rest measure></music-rest>')}
    ${bar('<music-rest measure></music-rest>', 'end-bar="final"')}
  </music-staff>`;
}

export function breakScore(): string {
  return `<music-staff label="Manual line and page breaks" print-width="680">
    ${bar(note('C5', 'whole'), 'keep-with-next')}
    ${bar(note('D5', 'whole'), 'break-before="line"')}
    ${bar('<music-direction text="Page turn during the preceding rest is an author decision"></music-direction><music-rest measure></music-rest>', 'break-before="page"')}
    ${bar(note('C5', 'whole'), 'end-bar="final"')}
  </music-staff>`;
}

export function nestedScore(clef: Clef = 'treble'): string {
  const pitches: Record<Clef, [string, string, string]> = {
    treble: ['C5', 'E5', 'G5'], bass: ['C3', 'E3', 'G3'], alto: ['C4', 'E4', 'G4'], tenor: ['C4', 'E4', 'G4'],
  };
  const [low, middle, high] = pitches[clef];
  const inner1 = tuplet(3, 2, note(low, 'eighth') + rest('eighth') + note(middle, 'eighth'), 'bracket="yes" ratio');
  const inner2 = tuplet(3, 2, Array.from({ length: 3 }, () => chord(`${low} ${middle}`, 'eighth')).join(''), 'bracket="yes" ratio');
  const inner3 = tuplet(3, 2, slash('eighth') + slash('eighth', false) + slash('eighth'), 'bracket="yes" ratio');
  const uniform = tuplet(3, 2, inner1 + inner2 + inner3, 'bracket="yes" ratio') + note(high, 'half');
  const mixed = tuplet(3, 2, note(low) + tuplet(5, 4,
    note(middle, 'eighth') + rest('eighth') + chord(`${low} ${high}`, 'eighth') + slash('eighth') + note(high, 'eighth'),
    'bracket="yes" ratio'), 'bracket="yes" ratio') + rest('half');
  const quintuplet = tuplet(5, 4, note(low) + rest('eighth') + chord(`${low} ${middle}`, 'eighth') + slash('eighth'), 'bracket="yes" ratio') + note(high, 'half');
  const septuplet = tuplet(7, 4, Array.from({ length: 7 }, (_, index) => index === 3 ? rest('eighth') : note(index % 2 ? high : low, 'eighth')).join(''), 'bracket="yes" ratio') + rest('half');
  const single = tuplet(3, 2, note(middle, 'quarter', 'dotted'), 'bracket="yes" ratio') + rest('half', 'dotted');
  return `<music-staff clef="${clef}" label="Nested tuplets and improvisation — ${clef}" max-measures="2">
    ${bar('<music-direction text="Three inner triplets share one outer triplet; the middle slash leaves rhythm open"></music-direction>' + uniform)}
    ${bar(mixed)}${bar(quintuplet)}${bar(septuplet)}${bar(single, 'end-bar="final"')}
  </music-staff>`;
}

export function tieScore(): string {
  return `<music-staff label="Chord ties preserve pitches when source order changes">
    ${bar(chord('C4 E4 G4', 'whole', 'tie="start"'))}
    ${bar(chord('G4 C4 E4', 'whole', 'tie="continue"'), 'break-before="line"')}
    ${bar(chord('E4 G4 C4', 'whole', 'tie="end"'), 'break-before="page" end-bar="final"')}
  </music-staff>`;
}

export const durationCases: readonly { duration: Duration; numerator: number; denominator: number }[] = [
  { duration: 'breve', numerator: 2, denominator: 1 },
  { duration: 'whole', numerator: 1, denominator: 1 },
  { duration: 'half', numerator: 1, denominator: 2 },
  { duration: 'quarter', numerator: 1, denominator: 4 },
  { duration: 'eighth', numerator: 1, denominator: 8 },
  { duration: 'sixteenth', numerator: 1, denominator: 16 },
  { duration: 'thirty-second', numerator: 1, denominator: 32 },
  { duration: 'sixty-fourth', numerator: 1, denominator: 64 },
  { duration: '128th', numerator: 1, denominator: 128 },
];

export function durationMatrixBar(clef: Clef, duration: Duration): string {
  const base: Record<Clef, [string, string]> = {
    treble: ['C5', 'E5'], bass: ['C3', 'E3'], alto: ['C4', 'E4'], tenor: ['C4', 'E4'],
  };
  const [low, high] = base[clef];
  return note(low, duration) + rest(duration) + chord(`${low} ${high}`, duration)
    + slash(duration) + slash(duration, false);
}

/** The gallery lead sheet: close harmony, one direction, and open versus prescribed rhythm. */
export function improvScore(): string {
  return `<music-staff id="improv-study" data-score clef="treble" max-measures="3" measure-numbers="all" aria-label="Jazz harmony and improvisation directions">
    <music-measure meter="4/4">
      <music-rehearsal text="A"></music-rehearsal>
      <music-direction text="Swing; solo until cue"></music-direction>
      <music-harmony text="Dm9"></music-harmony>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
    </music-measure>
    <music-measure>
      <music-harmony text="G13(b9)"></music-harmony>
      <music-slash duration="quarter" dots="1" rhythmic></music-slash>
      <music-slash duration="eighth" rhythmic></music-slash>
      <music-rest duration="quarter"></music-rest>
      <music-slash duration="quarter" rhythmic></music-slash>
    </music-measure>
    <music-measure end-bar="final">
      <music-harmony text="Cmaj9/E"></music-harmony>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
      <music-slash duration="quarter"></music-slash>
    </music-measure>
  </music-staff>`;
}

/** Read the actual authored example, without executing the gallery's scripts. */
function galleryScore(id: string): string {
  const template = document.createElement('template');
  template.innerHTML = galleryHTML;
  const score = template.content.querySelector(`[id="${id}"][data-score]`);
  if (!score) throw new Error(`Missing gallery score ${id}.`);
  return score.outerHTML;
}

export function automaticEnsembleScore(): string {
  return galleryScore('ensemble-auto-study');
}

/** The same passage with an authored keep preference, line break and page break. */
export function turningEnsembleScore(): string {
  return galleryScore('ensemble-study');
}
