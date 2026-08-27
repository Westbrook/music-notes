// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MUSIC_ATTRIBUTES, readScore, serializeScore } from '../src/dom/index';
import { parseMeter, rational } from '../src/model/index';
import type { Score } from '../src/model/types';
import galleryHtml from '../index.html?raw';

function element(html: string): Element {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild!;
}

function read(html: string) { return readScore(element(html)); }
function errors(result: ReturnType<typeof readScore>) { return result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'); }
function measure(result: ReturnType<typeof readScore>, index = 0) { return result.score.staves[0].measures[index]; }
function events(result: ReturnType<typeof readScore>) { return measure(result).voices[0].events; }
function codes(result: ReturnType<typeof readScore>) { return result.diagnostics.map(diagnostic => diagnostic.code); }

describe('light DOM reader', () => {
  it('reads the original note/rest API without touching source markup', () => {
    const root = element(`<music-staff clef="treble">
      <music-measure><music-meter top="4" bottom="4"></music-meter>
        <music-tempo marking="Moderato" bpm="100"></music-tempo>
        <music-dynamics level="mf"></music-dynamics>
        <music-note pitch="B4"></music-note><music-note pitch="A4"></music-note>
        <music-rest duration="half"></music-rest>
      </music-measure></music-staff>`);
    const before = root.outerHTML;
    const result = readScore(root);
    expect(errors(result)).toEqual([]);
    expect(events(result).map(event => event.onset)).toEqual([rational(0), rational(1, 4), rational(1, 2)]);
    expect(events(result).map(event => event.time)).toEqual([rational(1, 4), rational(1, 4), rational(1, 2)]);
    expect(root.outerHTML).toBe(before);
    expect(readScore(root).score).toEqual(result.score);
    expect(result.sources.get(events(result)[0].id)).toBe(root.querySelector('music-note'));
  });

  it('preserves generated identities through mutations and reordering', () => {
    const root = element(`<music-measure><music-note pitch="C4" duration="half"></music-note><music-rest duration="half"></music-rest></music-measure>`);
    const note = root.children[0];
    const rest = root.children[1];
    const before = readScore(root);
    note.setAttribute('pitch', 'F#4');
    root.insertBefore(rest, note);
    const after = readScore(root);
    expect(errors(after)).toEqual([]);
    expect(events(after).map(event => event.id)).toEqual(events(before).map(event => event.id).reverse());
    expect(events(after)[1].pitches[0]).toMatchObject({ step: 'F', alter: 1, octave: 4 });
    expect(note.hasAttribute('id')).toBe(false);
    note.id = 'authored-note';
    expect(events(readScore(root))[1].id).toBe('authored-note');
  });

  it('prefers unique explicit IDs and diagnoses duplicate IDs without losing sources', () => {
    const root = element(`<music-measure id="bar"><music-note id="n" pitch="C4" duration="half"></music-note><music-note id="n" pitch="E4" duration="half"></music-note></music-measure>`);
    const result = readScore(root);
    expect(codes(result)).toContain('duplicate-id');
    expect(events(result)[0].id).toBe('n');
    expect(events(result)[1].id).not.toBe('n');
    expect(result.sources.get(events(result)[1].id)).toBe(root.children[1]);
    expect(readScore(root).score).toEqual(result.score);
    expect(root.children[1].id).toBe('n');
  });

  it('reserves explicitly authored IDs even when they resemble generated IDs', () => {
    const root = element(`<music-measure><music-note pitch="C4" duration="half"></music-note><music-rest duration="half"></music-rest></music-measure>`);
    const previous = events(readScore(root))[0].id;
    root.children[1].id = previous;
    const result = readScore(root);
    expect(events(result)[0].id).not.toBe(previous);
    expect(events(result)[1].id).toBe(previous);
    expect(result.sources.size).toBe(new Set(result.sources.keys()).size);
    expect(errors(result)).toEqual([]);
  });

  it('inherits root/staff defaults and measure context changes across a staff', () => {
    const result = read(`<music-system meter="7/8" groups="2+2+3" clef="tenor" key="G">
      <music-staff clef="bass" key="Bb">
        <music-measure><music-rest measure></music-rest></music-measure>
        <music-measure meter="15/8" groups="3+3+3+3+3" clef="alto" key="Dm"><music-rest measure></music-rest></music-measure>
        <music-measure><music-rest measure></music-rest></music-measure>
      </music-staff></music-system>`);
    expect(errors(result)).toEqual([]);
    expect(measure(result)).toMatchObject({ clef: 'bass', key: 'Bb', meter: { numerator: 7, denominator: 8, groups: [2, 2, 3] } });
    expect(measure(result, 1)).toMatchObject({ clef: 'alto', key: 'Dm', meter: { numerator: 15, denominator: 8 } });
    expect(measure(result, 2).meter).toEqual(measure(result, 1).meter);
    expect(measure(result, 2).clef).toBe('alto');
    expect(measure(result, 2).key).toBe('Dm');
  });

  it('keeps context independent across multiple staves', () => {
    const result = read(`<music-system bracket="brace"><music-staff clef="treble" key="G"><music-measure><music-rest measure></music-rest></music-measure></music-staff><music-staff clef="bass" key="Bb"><music-measure><music-rest measure></music-rest></music-measure></music-staff></music-system>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.bracket).toBe('brace');
    expect(result.score.staves.map(staff => staff.measures[0].key)).toEqual(['G', 'Bb']);
  });

  it('uses spelled absolute pitch regardless of the key and retains legacy accidentals', () => {
    const result = read(`<music-measure key="G"><music-note pitch="F4"></music-note><music-note pitch="F#4"></music-note><music-note pitch="B4" accidental="flat"></music-note><music-note pitch="F4" accidental="natural" accidental-display="courtesy"></music-note></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(events(result).map(event => event.pitches[0].alter)).toEqual([0, 1, -1, 0]);
    expect(events(result)[3].pitches[0].display).toBe('courtesy');
  });

  it('does not guess pitches or durations for malformed rhythmic events', () => {
    const result = read(`<music-measure incomplete><music-note></music-note><music-note pitch="H4"></music-note><music-note pitch="C4" duration="banana"></music-note><music-note pitch="G4" duration="half"></music-note></music-measure>`);
    expect(codes(result)).toContain('invalid-pitch');
    expect(codes(result)).toContain('invalid-duration');
    expect(events(result)).toHaveLength(1);
    expect(events(result)[0].pitches[0].step).toBe('G');
  });

  it.each(['note', 'rest'])('keeps double dots exact on a %s in 7/8', kind => {
    const result = read(`<music-measure meter="7/8" groups="2+2+3"><music-${kind}${kind === 'note' ? ' pitch="C4"' : ''} duration="half" dots="2"></music-${kind}></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(events(result)[0].time).toEqual(rational(7, 8));
    expect(events(result)[0].dots).toBe(2);
  });

  it('distinguishes a full measure rest from a whole-note rest in 5/4', () => {
    const result = read(`<music-measure meter="5/4" groups="3+2"><music-rest measure></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(events(result)[0]).toMatchObject({ duration: 'whole', measureRest: true, beam: 'none', time: rational(5, 4) });
    expect(codes(read(`<music-measure><music-rest measure dotted></music-rest></music-measure>`))).toContain('invalid-measure-rest');
  });

  it('allows an automatic beam policy on a measure rest without prescribing a beam', () => {
    const result = read(`<music-measure><music-rest measure beam="auto"></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(read(serializeScore(result.score)).score).toEqual(result.score);
  });

  it('applies nested tuplet ratios to mixed notes, chords, and rests', () => {
    const result = read(`<music-measure>
      <music-tuplet id="outer" actual="3" normal="2">
        <music-note pitch="C4" duration="quarter"></music-note>
        <music-tuplet id="inner" actual="5" normal="4" bracket="yes" ratio>
          <music-note pitch="D4" duration="eighth"></music-note><music-rest duration="eighth"></music-rest>
          <music-chord pitches="E4 G4" duration="eighth"></music-chord><music-note pitch="F4" duration="eighth"></music-note><music-note pitch="G4" duration="eighth"></music-note>
        </music-tuplet>
      </music-tuplet><music-rest duration="half"></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(events(result)[0].time).toEqual(rational(1, 6));
    expect(events(result).slice(1, 6).map(event => event.time)).toEqual(Array(5).fill(rational(1, 15)));
    expect(events(result)[1].tupletIds).toEqual(['outer', 'inner']);
    expect(events(result)[6].onset).toEqual(rational(1, 2));
    expect(measure(result).voices[0].tuplets.map(tuplet => tuplet.eventIds.length)).toEqual([6, 5]);
    expect(measure(result).voices[0].tuplets[1]).toMatchObject({ bracket: 'yes', showRatio: true });
  });

  it('adapts legacy triplet boundaries with rests and real duration scaling', () => {
    const result = read(`<music-measure><music-note pitch="C4" triplet="start"></music-note><music-rest></music-rest><music-note pitch="E4" triplet="end"></music-note><music-rest duration="half"></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(events(result).slice(0, 3).map(event => event.time)).toEqual(Array(3).fill(rational(1, 6)));
    expect(events(result)[3].onset).toEqual(rational(1, 2));
    expect(measure(result).voices[0].tuplets[0]).toMatchObject({ actual: 3, normal: 2 });
  });

  it.each([
    ['end', 'unmatched-triplet-end'], ['start', 'unclosed-triplet'], ['middle', 'invalid-triplet'],
  ])('diagnoses malformed legacy triplet=%s', (marker, code) => {
    expect(codes(read(`<music-measure incomplete><music-note pitch="C4" triplet="${marker}"></music-note></music-measure>`))).toContain(code);
  });

  it('reports nested legacy starts and suggests structured tuplets', () => {
    const result = read(`<music-measure incomplete><music-note pitch="C4" triplet="start"></music-note><music-note pitch="D4" triplet="start"></music-note><music-note pitch="E4" triplet="end"></music-note></music-measure>`);
    expect(codes(result)).toContain('nested-legacy-triplet');
  });

  it('bounds invalid tuplet values and nesting without throwing', () => {
    const invalid = read(`<music-measure incomplete><music-tuplet actual="0" normal="2"><music-note pitch="C4"></music-note></music-tuplet></music-measure>`);
    expect(codes(invalid)).toContain('invalid-number');
    expect(events(invalid)).toHaveLength(0);
    const nested = `${'<music-tuplet actual="2" normal="1">'.repeat(17)}<music-note pitch="C4"></music-note>${'</music-tuplet>'.repeat(17)}`;
    expect(codes(read(`<music-measure incomplete>${nested}</music-measure>`))).toContain('tuplet-depth');
  });

  it('anchors annotations in an implicit voice and does not invent a metronome mark', () => {
    const result = read(`<music-measure><music-tempo marking="Freely"></music-tempo><music-note pitch="C4"></music-note><music-dynamics level="mp"></music-dynamics><music-chord pitches="D4 F4 A4" duration="half"></music-chord><music-slash></music-slash><music-direction at="1/2">Open solo</music-direction></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(measure(result).annotations.map(annotation => annotation.onset)).toEqual([rational(0), rational(1, 4), rational(1, 2)]);
    expect(measure(result).annotations[0]).not.toHaveProperty('bpm');
    expect(events(result)[3 - 1]).toMatchObject({ kind: 'slash', duration: 'quarter', rhythmic: false });
  });

  it('preserves the legacy default mf for an otherwise unspecified dynamics element', () => {
    const result = read(`<music-measure><music-dynamics></music-dynamics><music-rest measure></music-rest></music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(measure(result).annotations[0].text).toBe('mf');
    expect(codes(read(`<music-measure><music-dynamics level=""></music-dynamics><music-rest measure></music-rest></music-measure>`))).toContain('empty-annotation');
  });

  it('keeps voices simultaneous and supports local or explicit annotation times', () => {
    const result = read(`<music-measure>
      <music-rehearsal text="A"></music-rehearsal>
      <music-voice id="upper"><music-note pitch="G4" duration="half" stem="up"></music-note><music-harmony text="Dm9"></music-harmony><music-note pitch="A4" duration="half"></music-note></music-voice>
      <music-direction text="Free rhythm"></music-direction>
      <music-voice id="lower"><music-rest measure></music-rest></music-voice>
      <music-tempo bpm="66" beat="quarter" dots="1" at="3/4"></music-tempo>
    </music-measure>`);
    expect(errors(result)).toEqual([]);
    expect(measure(result).voices.map(voice => voice.events[0].onset)).toEqual([rational(0), rational(0)]);
    expect(measure(result).annotations.map(annotation => annotation.onset)).toEqual([rational(0), rational(1, 2), rational(0), rational(3, 4)]);
    expect(measure(result).annotations[3]).toMatchObject({ bpm: 66, beat: 'quarter', dots: 1 });
  });

  it('does not silently combine explicit voices and unwrapped rhythm', () => {
    const result = read(`<music-measure><music-voice><music-rest measure></music-rest></music-voice><music-note pitch="C4"></music-note></music-measure>`);
    expect(codes(result)).toContain('mixed-voices');
  });

  it('applies direct meter changes before rhythm and diagnoses misplaced changes', () => {
    const result = read(`<music-staff><music-measure><music-meter top="2+2+3" bottom="8"></music-meter><music-rest measure></music-rest></music-measure><music-measure><music-rest measure></music-rest></music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    expect(measure(result).meter.display).toBe('2+2+3/8');
    expect(measure(result, 1).meter).toEqual(measure(result).meter);
    const late = read(`<music-measure><music-rest measure></music-rest><music-meter top="3" bottom="4"></music-meter></music-measure>`);
    expect(codes(late)).toContain('late-meter');
    expect(measure(late).meter.numerator).toBe(4);
  });

  it('preserves the legacy four defaults on a direct music-meter declaration', () => {
    const result = read(`<music-staff meter="7/8" groups="2+2+3"><music-measure><music-meter top="3"></music-meter><music-rest measure></music-rest></music-measure><music-measure><music-meter bottom="8"></music-meter><music-rest measure></music-rest></music-measure><music-measure><music-meter></music-meter><music-rest measure></music-rest></music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures.map(bar => bar.meter.display)).toEqual(['3/4', '4/8', '4/4']);
  });

  it('requires the meter and its grouping to share one declaration', () => {
    const result = read(`<music-measure groups="1+1+1+1"><music-meter top="4" bottom="4"></music-meter><music-rest measure></music-rest></music-measure>`);
    expect(codes(result)).toContain('conflicting-meter');
  });

  it('reads measure numbering, breaks, repeats, pickups, and incomplete drafts', () => {
    const result = read(`<music-measure number="0" break-before="page" keep-with-next pickup incomplete repeat-start end-bar="repeat-end"><music-slash duration="eighth" rhythmic></music-slash></music-measure>`);
    expect(measure(result)).toMatchObject({ number: '0', breakBefore: 'page', keepWithNext: true, pickup: true, incomplete: true, repeatStart: true, endBar: 'repeat-end' });
    expect(events(result)[0].rhythmic).toBe(true);
  });

  it('numbers an opening pickup zero, then counts complete measures from one', () => {
    const result = read(`<music-staff><music-measure pickup><music-note pitch="C4"></music-note></music-measure><music-measure><music-rest measure></music-rest></music-measure><music-measure><music-rest measure></music-rest></music-measure></music-staff>`);
    expect(errors(result)).toEqual([]);
    expect(result.score.staves[0].measures.map(bar => bar.number)).toEqual(['0', '1', '2']);
    expect(read(serializeScore(result.score)).score).toEqual(result.score);
  });

  it('diagnoses likely spelling errors but permits standard HTML and application metadata', () => {
    const result = read(`<music-measure class="bar" data-editor="selected" aria-label="Measure"><music-note pitch="C4" duraton="whole"></music-note><music-nte pitch="D4"></music-nte></music-measure>`);
    expect(codes(result)).toContain('unknown-attribute');
    expect(codes(result)).toContain('unknown-element');
    expect(result.diagnostics.some(diagnostic => diagnostic.message.includes('data-editor'))).toBe(false);
    expect(MUSIC_ATTRIBUTES['music-measure']).toContain('print-width');
  });

  it('does not confuse an onset typo with a standard HTML event handler', () => {
    const result = read(`<music-measure onclick="void 0"><music-direction onset="1/4" text="Solo"></music-direction><music-rest measure></music-rest></music-measure>`);
    expect(result.diagnostics.filter(diagnostic => diagnostic.code === 'unknown-attribute').map(diagnostic => diagnostic.message)).toEqual([
      expect.stringContaining('"onset"'),
    ]);
  });

  it('reports boolean false values and conflicting dot syntax', () => {
    expect(codes(read(`<music-measure incomplete="false"><music-rest measure></music-rest></music-measure>`))).toContain('invalid-boolean');
    expect(codes(read(`<music-measure incomplete><music-note pitch="C4" dots="2" dotted></music-note></music-measure>`))).toContain('conflicting-dots');
  });

  it('does not treat XML-style self-closing custom elements as siblings in HTML', () => {
    const result = read(`<music-measure><music-note pitch="C4" duration="half" /><music-rest duration="half" /></music-measure>`);
    expect(codes(result)).toContain('nonempty-rhythm-element');
    expect(result.diagnostics.some(diagnostic => diagnostic.message.includes('explicit closing tag'))).toBe(true);
  });

  it('reports wrong nesting and includes model validation diagnostics', () => {
    const nested = read(`<music-measure incomplete><music-voice><music-meter top="4" bottom="4"></music-meter><music-note pitch="C4"></music-note></music-voice></music-measure>`);
    expect(codes(nested)).toContain('unexpected-element');
    const underfull = read(`<music-measure id="short"><music-note pitch="C4"></music-note></music-measure>`);
    expect(errors(underfull).length).toBeGreaterThan(0);
    expect(underfull.diagnostics.some(diagnostic => diagnostic.measureId === 'short')).toBe(true);
  });

  it('diagnoses invalid onset, empty annotations, and invalid tempo without throwing', () => {
    const result = read(`<music-measure><music-rest measure></music-rest><music-direction at="1/0" text="Never"></music-direction><music-tempo bpm="fast"></music-tempo><music-harmony></music-harmony></music-measure>`);
    expect(codes(result)).toEqual(expect.arrayContaining(['invalid-onset', 'invalid-tempo', 'empty-annotation']));
    expect(measure(result).annotations).toHaveLength(0);
  });

  it('diagnoses unsupported root elements without object-prototype lookups throwing', () => {
    const result = read(`<constructor not-an-attribute="x"></constructor>`);
    expect(codes(result)).toContain('invalid-root');
    expect(codes(result)).toContain('unknown-attribute');
  });
});

describe('readable score serialization', () => {
  const rich = `<music-system id="score" label="Session &amp; study">
    <music-staff id="staff" label="Piano" key="G">
      <music-measure id="one" number="1" keep-with-next repeat-start>
        <music-tempo id="tempo" marking="Freely"></music-tempo><music-rehearsal id="letter">A</music-rehearsal>
        <music-voice id="melody">
          <music-tuplet id="outer" actual="3" normal="2" bracket="yes">
            <music-note id="n1" pitch="C5"></music-note>
            <music-tuplet id="inner" actual="5" normal="4" ratio bracket="no">
              <music-note id="n2" pitch="D5" duration="eighth"></music-note><music-rest id="r1" duration="eighth"></music-rest>
              <music-chord id="c1" pitches="E5 G5" duration="eighth" accidental-display="courtesy"></music-chord>
              <music-note id="n3" pitch="F#5" duration="eighth"></music-note><music-note id="n4" pitch="G5" duration="eighth"></music-note>
            </music-tuplet>
          </music-tuplet><music-dynamics id="dyn" level="mp"></music-dynamics><music-note id="n5" pitch="G5" duration="half"></music-note>
        </music-voice><music-voice id="bass"><music-rest id="r2" measure></music-rest></music-voice>
      </music-measure>
      <music-measure id="two" number="2" meter="7/8" groups="2+2+3" clef="bass" key="Bb" break-before="page" end-bar="double">
        <music-direction id="text" text="A &amp; B &quot;trade&quot; &lt;four&gt;" at="3/8" placement="below"></music-direction>
        <music-rest id="r3" measure></music-rest>
      </music-measure>
      <music-measure id="three" number="3" meter="5/4" groups="3+2" end-bar="repeat-end">
        <music-harmony id="harmony" text="Bb13(#11)"></music-harmony><music-slash id="slash" rhythmic></music-slash>
        <music-chord id="chord" pitches="Bb2 D3 Ab3 C4" duration="whole"></music-chord>
      </music-measure>
    </music-staff></music-system>`;

  it('round-trips all supported score semantics, nested groups, and identities', () => {
    const original = read(rich);
    expect(errors(original)).toEqual([]);
    const html = serializeScore(original.score);
    expect(html).toContain('at="1/2"');
    expect(html).toContain('actual="5" normal="4"');
    expect(html).toContain('&amp; B &quot;trade&quot; &lt;four&gt;');
    expect(html).not.toMatch(/<music-[^>]+\/>/);
    const reparsed = read(html);
    expect(errors(reparsed)).toEqual([]);
    expect(reparsed.score).toEqual(original.score);
    expect(serializeScore(reparsed.score)).toBe(html);
  });

  it('round-trips standalone roots and legacy triplets as canonical structured HTML', () => {
    const original = read(`<music-staff><music-measure><music-note pitch="C4" triplet="start"></music-note><music-rest></music-rest><music-note pitch="D4" triplet="end"></music-note><music-rest duration="half"></music-rest></music-measure></music-staff>`);
    const html = serializeScore(original.score);
    expect(html).toContain('<music-tuplet');
    expect(html).not.toContain('triplet=');
    expect(read(html).score).toEqual(original.score);
  });

  it('preserves attribute whitespace and escapes text as inert HTML', () => {
    const root = element(`<music-measure><music-direction text="placeholder"></music-direction><music-rest measure></music-rest></music-measure>`);
    root.children[0].setAttribute('text', 'A\nB\rC\t<script>"&');
    const original = readScore(root);
    const html = serializeScore(original.score);
    expect(html).toContain('&#10;');
    expect(html).not.toContain('<script>');
    expect(read(html).score).toEqual(original.score);
  });

  it('round-trips finite metronome values that use exponential numeric formatting', () => {
    const original = read(`<music-measure><music-tempo bpm="1e-7"></music-tempo><music-rest measure></music-rest></music-measure>`);
    expect(errors(original)).toEqual([]);
    expect(read(serializeScore(original.score)).score).toEqual(original.score);
  });

  it.each([4, 8, 16] as const)('round-trips exact nested subdivisions across meters with denominator %s', denominator => {
    const unit = { 4: 'quarter', 8: 'eighth', 16: 'sixteenth' }[denominator]!;
    const tripletUnit = { 4: 'eighth', 8: 'sixteenth', 16: 'thirty-second' }[denominator]!;
    const quintupletUnit = { 4: 'thirty-second', 8: 'sixty-fourth', 16: '128th' }[denominator]!;
    for (const numerator of [2, 3, 4, 5, 6, 7, 9, 11, 15]) {
      const groups = parseMeter(numerator, denominator).groups.join('+');
      const nested = `<music-tuplet actual="3" normal="2"><music-tuplet actual="5" normal="4" ratio>${Array.from({ length: 5 }, (_, i) => i % 2
        ? `<music-rest duration="${quintupletUnit}"></music-rest>`
        : `<music-chord pitches="C4 E4" duration="${quintupletUnit}"></music-chord>`).join('')}</music-tuplet><music-note pitch="D4" duration="${tripletUnit}"></music-note><music-rest duration="${tripletUnit}"></music-rest></music-tuplet>`;
      const filling = `<music-rest duration="${unit}"></music-rest>`.repeat(numerator - 1);
      const original = read(`<music-measure meter="${numerator}/${denominator}" groups="${groups}">${nested}${filling}</music-measure>`);
      expect(errors(original), `${numerator}/${denominator}`).toEqual([]);
      const reparsed = read(serializeScore(original.score));
      expect(errors(reparsed), `${numerator}/${denominator}`).toEqual([]);
      expect(reparsed.score, `${numerator}/${denominator}`).toEqual(original.score);
    }
  });

  it('rejects invalid model drafts instead of exporting repaired music', () => {
    const original = read(`<music-measure><music-note pitch="C4"></music-note></music-measure>`);
    expect(() => serializeScore(original.score)).toThrow('Cannot serialize score');
  });

  it('refuses nonsequential model timing and mixed chord display policies', () => {
    const original = read(`<music-measure><music-chord pitches="C4 E4" duration="whole"></music-chord></music-measure>`).score;
    const changeEvent = (score: Score, change: object): Score => ({
      ...score, staves: score.staves.map(staff => ({ ...staff, measures: staff.measures.map(bar => ({
        ...bar, voices: bar.voices.map(voice => ({ ...voice, events: voice.events.map(event => ({ ...event, ...change })) })),
      })) })),
    });
    expect(() => serializeScore(changeEvent(original, { onset: rational(1, 4) }))).toThrow();
    const pitches = original.staves[0].measures[0].voices[0].events[0].pitches.map((pitch, index) => ({ ...pitch, display: index ? 'courtesy' : 'auto' }));
    expect(() => serializeScore(changeEvent(original, { pitches }))).toThrow('different accidental display');
  });
});

describe('authored gallery fixtures', () => {
  function gallery(): DocumentFragment {
    // A template keeps stylesheets and scripts inert while preserving source HTML.
    const template = document.createElement('template');
    template.innerHTML = galleryHtml;
    return template.content;
  }

  function galleryScore(id: string): Element {
    const root = gallery().getElementById(id);
    expect(root, `The gallery must contain #${id}`).not.toBeNull();
    return root!;
  }

  /** Keep every musical field; normalize only source identities and layout choices. */
  function musicalContent(score: Score) {
    const { id: _scoreId, label: _description, staves, ...scoreProperties } = score;
    return {
      ...scoreProperties,
      staves: staves.map(({ id: _staffId, measures, ...staff }) => ({
        ...staff,
        measures: measures.map(({ id: _measureId, breakBefore: _break, keepWithNext: _keep, voices, annotations, ...bar }) => ({
          ...bar,
          annotations: annotations.map(({ id: _annotationId, ...annotation }) => annotation),
          voices: voices.map(({ id: _voiceId, events, tuplets, ...voice }) => ({
            ...voice,
            events: events.map(({ id: _eventId, tupletIds, ...event }) => ({
              ...event,
              tupletIds: tupletIds.map(id => tuplets.findIndex(tuplet => tuplet.id === id)),
            })),
            tuplets: tuplets.map(({ id: _tupletId, eventIds, ...tuplet }) => ({
              ...tuplet,
              eventIds: eventIds.map(id => events.findIndex(event => event.id === id)),
            })),
          })),
        })),
      })),
    };
  }

  it('reads and round-trips all nine gallery scores without changing their authored HTML', () => {
    const roots = [...gallery().querySelectorAll('[data-score]')];
    expect(roots.map(root => root.id).sort()).toEqual([
      'pitch-study', 'seven-study', 'fifteen-study', 'five-study', 'tuplet-study',
      'improv-study', 'piano-study', 'ensemble-auto-study', 'ensemble-study',
    ].sort());
    for (const root of roots) {
      const before = root.outerHTML;
      const original = readScore(root);
      expect(original.diagnostics, root.id).toEqual([]);
      const reparsed = read(serializeScore(original.score));
      expect(reparsed.diagnostics, root.id).toEqual([]);
      expect(reparsed.score, root.id).toEqual(original.score);
      expect(root.outerHTML, root.id).toBe(before);
    }
  });

  it('shows identical ensemble music with automatic defaults and opt-in layout hints', () => {
    const automaticRoot = galleryScore('ensemble-auto-study');
    const authoredRoot = galleryScore('ensemble-study');
    const automatic = readScore(automaticRoot);
    const authored = readScore(authoredRoot);
    expect(automatic.diagnostics).toEqual([]);
    expect(authored.diagnostics).toEqual([]);
    expect(musicalContent(automatic.score)).toEqual(musicalContent(authored.score));
    expect(automatic.score.staves.map(staff => staff.label)).toEqual(['Flute', 'Viola', 'Cello']);
    expect(automatic.score.staves.map(staff => staff.measures.length)).toEqual([4, 4, 4]);

    const hints = '[break-before], [keep-with-next], [max-measures]';
    expect(automaticRoot.matches(hints)).toBe(false);
    expect(automaticRoot.querySelectorAll(hints)).toHaveLength(0);
    for (const staff of automatic.score.staves) {
      expect(staff.measures.map(bar => [bar.breakBefore, bar.keepWithNext])).toEqual([
        ['auto', false], ['auto', false], ['auto', false], ['auto', false],
      ]);
    }
    expect(authoredRoot.hasAttribute('max-measures')).toBe(false);
    for (const name of ['bracket', 'measure-numbers', 'print-width']) {
      expect(automaticRoot.getAttribute(name), name).toBe(authoredRoot.getAttribute(name));
    }
    for (const staff of authored.score.staves) {
      expect(staff.measures.map(bar => [bar.breakBefore, bar.keepWithNext])).toEqual([
        ['auto', true], ['auto', false], ['line', false], ['page', false],
      ]);
    }
  });

  it('removes ensemble layout hints without altering music or replacing any source identity', () => {
    const root = galleryScore('ensemble-study');
    const before = readScore(root);
    expect(before.diagnostics).toEqual([]);

    root.setAttribute('max-measures', '3');
    expect(readScore(root).score).toEqual(before.score);
    root.removeAttribute('max-measures');
    expect(readScore(root).score).toEqual(before.score);
    for (const bar of root.querySelectorAll('music-measure')) {
      bar.removeAttribute('break-before');
      bar.removeAttribute('keep-with-next');
    }
    const after = readScore(root);
    expect(after.diagnostics).toEqual([]);
    expect(after.score).toEqual({
      ...before.score,
      staves: before.score.staves.map(staff => ({
        ...staff,
        measures: staff.measures.map(bar => ({ ...bar, breakBefore: 'auto', keepWithNext: false })),
      })),
    });
    expect([...after.sources.keys()]).toEqual([...before.sources.keys()]);
    for (const [id, source] of before.sources) expect(after.sources.get(id), id).toBe(source);
  });
});
