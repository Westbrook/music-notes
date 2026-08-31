import { createProject } from './project.js';
import type { AuthorProject, InstructionScope, PartDefinition } from './types.js';

export type TemplateId = 'blank' | 'rhythm' | 'three-roads' | 'lead' | 'piano' | 'ensemble';

export const templateOptions: readonly { value: TemplateId; label: string; description: string }[] = [
  { value: 'blank', label: 'Blank staff', description: 'One empty 4/4 draft bar, ready for your first idea.' },
  { value: 'rhythm', label: 'Single-line rhythm', description: 'An empty pitchless 4/4 draft for clapping, speaking, percussion, or written rhythmic cues.' },
  { value: 'three-roads', label: '3 roads music', description: 'An empty 4/4 draft for higher, same, or lower than each voice’s previous main pitch.' },
  { value: 'lead', label: 'Lead sheet', description: 'An original head, two-bar vamp and written rhythmic cue.' },
  { value: 'piano', label: 'Piano sketch', description: 'Two staves, independent voices and a short nested tuplet passage.' },
  { value: 'ensemble', label: 'Small ensemble', description: 'Flute, vibraphone and cello in a 2 + 2 + 3 groove.' },
];

interface TemplateDefinition {
  title: string;
  html: string;
  parts: PartDefinition[];
  instructionScopes?: Record<string, InstructionScope>;
}

// These are authored starting documents, not renderer fixtures. Blank starters
// are explicitly incomplete; studies contain complete music. Layout stays
// automatic, without playback assumptions or engraving-specific coordinates.
const templates: Record<TemplateId, TemplateDefinition> = {
  blank: {
    title: 'Untitled',
    parts: [{ id: 'melody', label: 'Melody', staffIds: ['blank-staff'] }],
    html: `<music-staff id="blank-staff" label="Melody" clef="treble" key="C" meter="4/4">
  <music-measure id="blank-m1" incomplete></music-measure>
</music-staff>`,
  },
  rhythm: {
    title: 'Untitled rhythm',
    parts: [{ id: 'rhythm', label: 'Rhythm', staffIds: ['rhythm-staff'] }],
    html: `<music-staff id="rhythm-staff" label="Rhythm" notation="rhythm" meter="4/4">
  <music-measure id="rhythm-m1" incomplete></music-measure>
</music-staff>`,
  },
  'three-roads': {
    title: 'Untitled 3 roads music',
    parts: [{ id: 'three-roads', label: '3 roads music', staffIds: ['three-roads-staff'] }],
    html: `<music-staff id="three-roads-staff" label="3 roads music" notation="three-roads" meter="4/4">
  <music-measure id="three-roads-m1" incomplete>
    <music-direction id="three-roads-instruction" text="Start on Same (middle) at any main pitch." placement="below"></music-direction>
    <music-direction id="three-roads-lanes" text="Top higher; middle same; bottom lower." placement="below"></music-direction>
    <music-direction id="three-roads-reference" text="Rests keep each voice's last main pitch." placement="below"></music-direction>
    <music-direction id="three-roads-ties" text="Ties hold main pitch and added harmonies." placement="below"></music-direction>
  </music-measure>
</music-staff>`,
  },
  lead: {
    title: 'Side Street',
    parts: [{ id: 'lead', label: 'Lead', staffIds: ['lead-staff'] }],
    html: `<music-staff id="lead-staff" label="Lead" clef="treble" key="Dm" meter="4/4">
  <music-measure id="lead-m1">
    <music-tempo id="lead-tempo" marking="Easy swing" bpm="112" beat="quarter"></music-tempo>
    <music-rehearsal id="lead-head" text="A"></music-rehearsal>
    <music-harmony id="lead-m1-harmony" text="Dm9"></music-harmony>
    <music-note id="lead-m1-n1" pitch="D5" duration="quarter"></music-note>
    <music-note id="lead-m1-n2" pitch="F5" duration="eighth"></music-note>
    <music-note id="lead-m1-n3" pitch="E5" duration="eighth"></music-note>
    <music-note id="lead-m1-n4" pitch="D5" duration="quarter"></music-note>
    <music-note id="lead-m1-n5" pitch="A4" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m2">
    <music-harmony id="lead-m2-harmony" text="Cmaj9"></music-harmony>
    <music-note id="lead-m2-n1" pitch="C5" duration="quarter"></music-note>
    <music-note id="lead-m2-n2" pitch="E5" duration="quarter"></music-note>
    <music-note id="lead-m2-n3" pitch="G5" duration="quarter"></music-note>
    <music-note id="lead-m2-n4" pitch="F5" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m3">
    <music-harmony id="lead-m3-harmony" text="G13"></music-harmony>
    <music-note id="lead-m3-n1" pitch="E5" duration="eighth"></music-note>
    <music-note id="lead-m3-n2" pitch="F5" duration="eighth"></music-note>
    <music-note id="lead-m3-n3" pitch="A5" duration="quarter"></music-note>
    <music-note id="lead-m3-n4" pitch="G5" duration="quarter"></music-note>
    <music-note id="lead-m3-n5" pitch="E5" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m4">
    <music-harmony id="lead-m4-harmony" text="Dm9"></music-harmony>
    <music-note id="lead-m4-n1" pitch="D5" duration="half" dots="1"></music-note>
    <music-rest id="lead-m4-rest" duration="quarter"></music-rest>
  </music-measure>
  <music-measure id="lead-m5">
    <music-harmony id="lead-m5-harmony" text="Bbmaj9"></music-harmony>
    <music-note id="lead-m5-n1" pitch="Bb4" duration="quarter"></music-note>
    <music-note id="lead-m5-n2" pitch="D5" duration="quarter"></music-note>
    <music-note id="lead-m5-n3" pitch="F5" duration="eighth"></music-note>
    <music-note id="lead-m5-n4" pitch="G5" duration="eighth"></music-note>
    <music-note id="lead-m5-n5" pitch="A5" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m6">
    <music-harmony id="lead-m6-harmony" text="Cmaj9"></music-harmony>
    <music-note id="lead-m6-n1" pitch="G5" duration="quarter"></music-note>
    <music-note id="lead-m6-n2" pitch="E5" duration="eighth"></music-note>
    <music-note id="lead-m6-n3" pitch="D5" duration="eighth"></music-note>
    <music-note id="lead-m6-n4" pitch="C5" duration="quarter"></music-note>
    <music-note id="lead-m6-n5" pitch="E5" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m7">
    <music-harmony id="lead-m7-harmony" text="A7sus4"></music-harmony>
    <music-note id="lead-m7-n1" pitch="A4" duration="half" tie="start"></music-note>
    <music-note id="lead-m7-n2" pitch="A4" duration="quarter" tie="end"></music-note>
    <music-note id="lead-m7-n3" pitch="G4" duration="quarter"></music-note>
  </music-measure>
  <music-measure id="lead-m8" end-bar="double">
    <music-harmony id="lead-m8-harmony" text="Dm9"></music-harmony>
    <music-note id="lead-m8-n1" pitch="D5" duration="whole"></music-note>
  </music-measure>
  <music-measure id="lead-m9">
    <music-rehearsal id="lead-vamp" text="B"></music-rehearsal>
    <music-direction id="lead-vamp-instruction" text="Vamp written once; continue to cue."></music-direction>
    <music-harmony id="lead-m9-harmony" text="Dm9"></music-harmony>
    <music-slash id="lead-m9-s1" duration="quarter"></music-slash>
    <music-slash id="lead-m9-s2" duration="quarter"></music-slash>
    <music-slash id="lead-m9-s3" duration="quarter"></music-slash>
    <music-slash id="lead-m9-s4" duration="quarter"></music-slash>
  </music-measure>
  <music-measure id="lead-m10" end-bar="double">
    <music-harmony id="lead-m10-harmony" text="G13sus"></music-harmony>
    <music-slash id="lead-m10-s1" duration="quarter"></music-slash>
    <music-slash id="lead-m10-s2" duration="quarter"></music-slash>
    <music-slash id="lead-m10-s3" duration="quarter"></music-slash>
    <music-slash id="lead-m10-s4" duration="quarter"></music-slash>
  </music-measure>
  <music-measure id="lead-m11">
    <music-rehearsal id="lead-cue" text="C"></music-rehearsal>
    <music-direction id="lead-cue-instruction" text="Written rhythm; choose pitches."></music-direction>
    <music-harmony id="lead-m11-harmony" text="A7alt"></music-harmony>
    <music-rest id="lead-m11-r1" duration="eighth"></music-rest>
    <music-slash id="lead-m11-s1" duration="eighth" rhythmic></music-slash>
    <music-slash id="lead-m11-s2" duration="quarter" rhythmic></music-slash>
    <music-rest id="lead-m11-r2" duration="eighth"></music-rest>
    <music-slash id="lead-m11-s3" duration="eighth" rhythmic></music-slash>
    <music-slash id="lead-m11-s4" duration="quarter" rhythmic></music-slash>
  </music-measure>
  <music-measure id="lead-m12" end-bar="final">
    <music-harmony id="lead-m12-harmony" text="Dm6/9"></music-harmony>
    <music-note id="lead-m12-n1" pitch="D5" duration="half"></music-note>
    <music-note id="lead-m12-n2" pitch="A4" duration="quarter"></music-note>
    <music-note id="lead-m12-n3" pitch="D5" duration="quarter"></music-note>
  </music-measure>
</music-staff>`,
  },
  piano: {
    title: 'Quiet Geometry',
    parts: [{ id: 'piano', label: 'Piano', staffIds: ['piano-upper', 'piano-lower'] }],
    html: `<music-system id="piano-score" label="Piano" bracket="brace" key="Dm" meter="4/4">
  <music-staff id="piano-upper" label="Right hand" clef="treble">
    <music-measure id="piano-upper-m1">
      <music-tempo id="piano-tempo" marking="Spacious" bpm="72" beat="quarter"></music-tempo>
      <music-dynamics id="piano-dynamics" level="mp"></music-dynamics>
      <music-rehearsal id="piano-rehearsal" text="A"></music-rehearsal>
      <music-voice id="piano-upper-m1-melody">
        <music-note id="piano-upper-m1-n1" pitch="A4" duration="quarter" stem="up"></music-note>
        <music-note id="piano-upper-m1-n2" pitch="C5" duration="eighth" stem="up"></music-note>
        <music-note id="piano-upper-m1-n3" pitch="D5" duration="eighth" stem="up"></music-note>
        <music-note id="piano-upper-m1-n4" pitch="E5" duration="quarter" stem="up"></music-note>
        <music-note id="piano-upper-m1-n5" pitch="F5" duration="quarter" stem="up"></music-note>
      </music-voice>
      <music-voice id="piano-upper-m1-inner">
        <music-chord id="piano-upper-m1-chord" pitches="D4 F4" duration="whole" stem="down"></music-chord>
      </music-voice>
    </music-measure>
    <music-measure id="piano-upper-m2">
      <music-voice id="piano-upper-m2-melody">
        <music-note id="piano-upper-m2-n1" pitch="E5" duration="half" stem="up"></music-note>
        <music-note id="piano-upper-m2-n2" pitch="D5" duration="quarter" stem="up"></music-note>
        <music-note id="piano-upper-m2-n3" pitch="A4" duration="quarter" stem="up"></music-note>
      </music-voice>
      <music-voice id="piano-upper-m2-inner">
        <music-chord id="piano-upper-m2-chord" pitches="Bb3 D4" duration="whole" stem="down"></music-chord>
      </music-voice>
    </music-measure>
    <music-measure id="piano-upper-m3">
      <music-direction id="piano-flourish-instruction" text="Keep the pulse through the flourish."></music-direction>
      <music-voice id="piano-upper-m3-melody">
        <music-tuplet id="piano-outer-tuplet" actual="3" normal="2" bracket="yes" ratio>
          <music-note id="piano-upper-m3-n1" pitch="F5" duration="quarter" stem="up"></music-note>
          <music-tuplet id="piano-inner-tuplet" actual="5" normal="4" bracket="yes" ratio>
            <music-note id="piano-upper-m3-n2" pitch="E5" duration="eighth" stem="up"></music-note>
            <music-note id="piano-upper-m3-n3" pitch="D5" duration="eighth" stem="up"></music-note>
            <music-rest id="piano-upper-m3-rest" duration="eighth"></music-rest>
            <music-note id="piano-upper-m3-n4" pitch="C5" duration="eighth" stem="up"></music-note>
            <music-note id="piano-upper-m3-n5" pitch="A4" duration="eighth" stem="up"></music-note>
          </music-tuplet>
        </music-tuplet>
        <music-note id="piano-upper-m3-n6" pitch="G4" duration="half" stem="up"></music-note>
      </music-voice>
      <music-voice id="piano-upper-m3-inner">
        <music-chord id="piano-upper-m3-chord" pitches="C4 E4" duration="whole" stem="down"></music-chord>
      </music-voice>
    </music-measure>
    <music-measure id="piano-upper-m4" end-bar="final">
      <music-voice id="piano-upper-m4-melody">
        <music-note id="piano-upper-m4-n1" pitch="D5" duration="half" dots="1" stem="up"></music-note>
        <music-rest id="piano-upper-m4-rest" duration="quarter"></music-rest>
      </music-voice>
      <music-voice id="piano-upper-m4-inner">
        <music-chord id="piano-upper-m4-chord" pitches="D4 F4 A4" duration="whole" stem="down"></music-chord>
      </music-voice>
    </music-measure>
  </music-staff>
  <music-staff id="piano-lower" label="Left hand" clef="bass">
    <music-measure id="piano-lower-m1">
      <music-note id="piano-lower-m1-n1" pitch="D3" duration="half"></music-note>
      <music-note id="piano-lower-m1-n2" pitch="A2" duration="half"></music-note>
    </music-measure>
    <music-measure id="piano-lower-m2">
      <music-note id="piano-lower-m2-n1" pitch="G2" duration="half"></music-note>
      <music-note id="piano-lower-m2-n2" pitch="D3" duration="half"></music-note>
    </music-measure>
    <music-measure id="piano-lower-m3">
      <music-note id="piano-lower-m3-n1" pitch="C3" duration="half"></music-note>
      <music-note id="piano-lower-m3-n2" pitch="G2" duration="half"></music-note>
    </music-measure>
    <music-measure id="piano-lower-m4" end-bar="final">
      <music-note id="piano-lower-m4-n1" pitch="D3" duration="whole"></music-note>
    </music-measure>
  </music-staff>
</music-system>`,
  },
  ensemble: {
    title: 'Three Small Windows',
    parts: [
      { id: 'flute', label: 'Flute', staffIds: ['ensemble-flute'] },
      { id: 'vibraphone', label: 'Vibraphone', staffIds: ['ensemble-vibes'] },
      { id: 'cello', label: 'Cello', staffIds: ['ensemble-cello'] },
    ],
    instructionScopes: {
      'ensemble-tempo': 'all',
      'ensemble-rehearsal-a': 'all',
      'ensemble-rehearsal-b': 'all',
      'ensemble-pulse-instruction': 'all',
      'ensemble-m1-harmony': 'all',
      'ensemble-m2-harmony': 'all',
      'ensemble-m3-harmony': 'all',
      'ensemble-m4-harmony': 'all',
      'ensemble-flute-dynamics': ['flute'],
      'ensemble-flute-instruction': ['flute'],
      'ensemble-vibes-dynamics': ['vibraphone'],
      'ensemble-vibes-instruction': ['vibraphone'],
      'ensemble-cello-dynamics': ['cello'],
    },
    html: `<music-system id="ensemble-score" label="Flute, vibraphone and cello" bracket="bracket" key="Dm" meter="2+2+3/8" groups="2+2+3">
  <music-staff id="ensemble-flute" label="Flute" clef="treble">
    <music-measure id="ensemble-flute-m1">
      <music-tempo id="ensemble-tempo" marking="Light, in 2 + 2 + 3" bpm="184" beat="eighth"></music-tempo>
      <music-rehearsal id="ensemble-rehearsal-a" text="A"></music-rehearsal>
      <music-harmony id="ensemble-m1-harmony" text="Dm9"></music-harmony>
      <music-dynamics id="ensemble-flute-dynamics" level="mf"></music-dynamics>
      <music-note id="ensemble-flute-m1-n1" pitch="D5" duration="quarter"></music-note>
      <music-note id="ensemble-flute-m1-n2" pitch="F5" duration="quarter"></music-note>
      <music-note id="ensemble-flute-m1-n3" pitch="A5" duration="quarter" dots="1"></music-note>
    </music-measure>
    <music-measure id="ensemble-flute-m2">
      <music-harmony id="ensemble-m2-harmony" text="Gm9"></music-harmony>
      <music-note id="ensemble-flute-m2-n1" pitch="G5" duration="eighth"></music-note>
      <music-note id="ensemble-flute-m2-n2" pitch="A5" duration="eighth"></music-note>
      <music-note id="ensemble-flute-m2-n3" pitch="F5" duration="quarter"></music-note>
      <music-note id="ensemble-flute-m2-n4" pitch="E5" duration="eighth"></music-note>
      <music-note id="ensemble-flute-m2-n5" pitch="D5" duration="quarter"></music-note>
    </music-measure>
    <music-measure id="ensemble-flute-m3">
      <music-rehearsal id="ensemble-rehearsal-b" text="B"></music-rehearsal>
      <music-direction id="ensemble-pulse-instruction" text="Keep the 2 + 2 + 3 pulse."></music-direction>
      <music-direction id="ensemble-flute-instruction" text="Improvise around D; next bar written."></music-direction>
      <music-harmony id="ensemble-m3-harmony" text="Dm9"></music-harmony>
      <music-slash id="ensemble-flute-m3-s1" duration="quarter"></music-slash>
      <music-slash id="ensemble-flute-m3-s2" duration="quarter"></music-slash>
      <music-slash id="ensemble-flute-m3-s3" duration="quarter" dots="1"></music-slash>
    </music-measure>
    <music-measure id="ensemble-flute-m4" end-bar="final">
      <music-harmony id="ensemble-m4-harmony" text="Dm6/9"></music-harmony>
      <music-note id="ensemble-flute-m4-n1" pitch="D5" duration="quarter"></music-note>
      <music-note id="ensemble-flute-m4-n2" pitch="F5" duration="quarter"></music-note>
      <music-note id="ensemble-flute-m4-n3" pitch="A5" duration="quarter" dots="1"></music-note>
    </music-measure>
  </music-staff>
  <music-staff id="ensemble-vibes" label="Vibraphone" clef="treble">
    <music-measure id="ensemble-vibes-m1">
      <music-dynamics id="ensemble-vibes-dynamics" level="mp"></music-dynamics>
      <music-chord id="ensemble-vibes-m1-c1" pitches="F4 A4 C5 E5" duration="quarter"></music-chord>
      <music-rest id="ensemble-vibes-m1-rest" duration="quarter"></music-rest>
      <music-chord id="ensemble-vibes-m1-c2" pitches="F4 A4 C5 E5" duration="quarter" dots="1"></music-chord>
    </music-measure>
    <music-measure id="ensemble-vibes-m2">
      <music-chord id="ensemble-vibes-m2-c1" pitches="D4 F4 A4 Bb4" duration="quarter"></music-chord>
      <music-rest id="ensemble-vibes-m2-rest" duration="quarter"></music-rest>
      <music-chord id="ensemble-vibes-m2-c2" pitches="D4 F4 A4 Bb4" duration="quarter" dots="1"></music-chord>
    </music-measure>
    <music-measure id="ensemble-vibes-m3">
      <music-direction id="ensemble-vibes-instruction" text="Sparse voicings; leave space."></music-direction>
      <music-slash id="ensemble-vibes-m3-s1" duration="quarter"></music-slash>
      <music-slash id="ensemble-vibes-m3-s2" duration="quarter"></music-slash>
      <music-slash id="ensemble-vibes-m3-s3" duration="quarter" dots="1"></music-slash>
    </music-measure>
    <music-measure id="ensemble-vibes-m4" end-bar="final">
      <music-chord id="ensemble-vibes-m4-chord" pitches="F4 A4 B4 E5" duration="half"></music-chord>
      <music-rest id="ensemble-vibes-m4-rest" duration="quarter" dots="1"></music-rest>
    </music-measure>
  </music-staff>
  <music-staff id="ensemble-cello" label="Cello" clef="bass">
    <music-measure id="ensemble-cello-m1">
      <music-dynamics id="ensemble-cello-dynamics" level="mp"></music-dynamics>
      <music-note id="ensemble-cello-m1-n1" pitch="D3" duration="quarter"></music-note>
      <music-note id="ensemble-cello-m1-n2" pitch="A2" duration="quarter"></music-note>
      <music-note id="ensemble-cello-m1-n3" pitch="C3" duration="quarter" dots="1"></music-note>
    </music-measure>
    <music-measure id="ensemble-cello-m2">
      <music-note id="ensemble-cello-m2-n1" pitch="G2" duration="quarter"></music-note>
      <music-note id="ensemble-cello-m2-n2" pitch="D3" duration="quarter"></music-note>
      <music-note id="ensemble-cello-m2-n3" pitch="F3" duration="quarter" dots="1"></music-note>
    </music-measure>
    <music-measure id="ensemble-cello-m3">
      <music-note id="ensemble-cello-m3-n1" pitch="D3" duration="quarter"></music-note>
      <music-rest id="ensemble-cello-m3-rest" duration="quarter"></music-rest>
      <music-note id="ensemble-cello-m3-n2" pitch="A2" duration="quarter" dots="1"></music-note>
    </music-measure>
    <music-measure id="ensemble-cello-m4" end-bar="final">
      <music-note id="ensemble-cello-m4-n1" pitch="D3" duration="half" dots="1"></music-note>
      <music-rest id="ensemble-cello-m4-rest" duration="eighth"></music-rest>
    </music-measure>
  </music-staff>
</music-system>`,
  },
};

export function createTemplate(id: TemplateId): AuthorProject {
  if (!Object.hasOwn(templates, id)) throw new RangeError('Unknown score template.');
  const template = templates[id];
  const parts = template.parts.map(part => ({ ...part, staffIds: [...part.staffIds] }));
  const project = createProject(template.html, template.title, parts);
  project.instructionScopes = Object.fromEntries(
    Object.entries(template.instructionScopes ?? {}).map(([sourceId, scope]): [string, InstructionScope] => [
      sourceId, scope === 'all' ? scope : [...scope],
    ]),
  );
  return project;
}
