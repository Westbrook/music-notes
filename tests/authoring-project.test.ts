import { describe, expect, it } from 'vitest';
import { readScore } from '../src/dom/index.js';
import { copyProjectNotices, createProject, defaultLayout, findSource, getProjectNotices, importProject,
  MAX_PROJECT_LENGTH, MAX_SOURCE_LENGTH, normalizeProject, parseSource, ProjectValidationError, serializeProject } from '../src/authoring/project.js';
import type { AuthorProject } from '../src/authoring/types.js';

const single = `<music-staff id="staff" label="Flute"><music-measure id="m1"><music-rest id="rest1" measure></music-rest></music-measure></music-staff>`;
const ensemble = `<music-system id="ensemble" bracket="brace">
  <music-staff id="upper" label="Piano"><music-measure id="u1"><music-rest id="ur1" measure></music-rest></music-measure><music-measure id="u2"><music-rest id="ur2" measure></music-rest></music-measure></music-staff>
  <music-staff id="lower" clef="bass"><music-measure id="l1"><music-rest id="lr1" measure></music-rest></music-measure><music-measure id="l2"><music-rest id="lr2" measure></music-rest></music-measure></music-staff>
</music-system>`;
function piano() { return createProject(ensemble, 'Two hands', [{ id: 'piano', label: 'Piano', staffIds: ['upper', 'lower'] }]); }
function unsafeProject(change: (project: AuthorProject) => void): string { const project = createProject(single); change(project); return JSON.stringify(project); }

describe('safe authoring source', () => {
  it('assigns persistent unique IDs without changing written music', () => {
    const project = createProject('<music-staff><music-measure><music-note pitch="F#4" duration="whole"></music-note></music-measure></music-staff>');
    const first = parseSource(project.sourceHtml);
    const ids = [first, ...first.querySelectorAll('*')].map(element => element.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const reopened = importProject(serializeProject(project));
    expect(reopened.sourceHtml).toBe(project.sourceHtml);
    expect(reopened.columns).toEqual(project.columns);
    expect([parseSource(reopened.sourceHtml), ...parseSource(reopened.sourceHtml).querySelectorAll('*')].map(element => element.id)).toEqual(ids);
    expect(readScore(first).score.staves[0].measures[0].voices[0].events[0].pitches[0]).toMatchObject({ step: 'F', alter: 1, octave: 4 });
  });

  it('preserves accepted HTML, comments, whitespace, and safe metadata rather than canonicalizing the model', () => {
    const source = `<!-- outside -->\n<music-staff id='staff' data-origin="handwritten">\n  <!-- phrase -->\n  <music-measure id="m1" data-phrase="A"><music-direction id="words" text="&lt;script&gt; is text"></music-direction><music-rest id="r" measure></music-rest></music-measure>\n</music-staff>\n<!-- after -->`;
    const project = createProject(source, 'A title');
    expect(project.sourceHtml).toBe(source);
    expect(importProject(serializeProject(project)).sourceHtml).toBe(source);
    const parsed = parseSource(source);
    findSource(parsed, 'words')!.setAttribute('text', 'Breathe');
    const edited = normalizeProject(project, parsed);
    expect(edited.sourceHtml).toContain('<!-- outside -->');
    expect(edited.sourceHtml).toContain('<!-- phrase -->');
    expect(edited.sourceHtml).toContain('<!-- after -->');
    expect(edited.sourceHtml).toContain('data-phrase="A"');
    expect(edited.sourceHtml).toContain('text="Breathe"');
  });

  it('finds the root and IDs containing selector punctuation without interpreting selectors', () => {
    const source = parseSource(single.replace('id="rest1"', 'id="rest:1[ready]"'));
    expect(findSource(source, 'staff')).toBe(source);
    expect(findSource(source, 'rest:1[ready]')?.localName).toBe('music-rest');
    expect(findSource(source, '[id]')).toBeUndefined();
  });

  it('rejects unsafe source before parsing even with registered custom tags, and keeps valid source disconnected', () => {
    let constructions = 0;
    if (!customElements.get('music-harmony')) customElements.define('music-harmony', class extends HTMLElement { constructor() { super(); constructions++; } });
    const source = single.replace('<music-rest', '<music-harmony id="h" text="Cmaj7"></music-harmony><music-rest');
    expect(() => parseSource(source.replace('text="Cmaj7"', 'text="Cmaj7" onclick="alert(1)"'))).toThrow(/not allowed/);
    expect(constructions).toBe(0);
    const root = parseSource(source);
    expect(root.isConnected).toBe(false);
    expect(root.parentNode?.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    expect(document.querySelector('music-staff')).toBeNull();
    // happy-dom eagerly upgrades custom tags in an inactive document's
    // template. Native constructor-inertness requires a real-browser check.
  });

  it.each([
    '<script>globalThis.compromised = true</script>',
    '<img src="https://example.invalid/x" onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>',
    '<iframe srcdoc="evil"></iframe>',
    '<template shadowrootmode="open"></template>',
    '<style>body { display: none }</style>',
    '<object data="javascript:alert(1)"></object>',
    '<div>harmless-looking unsupported content</div>',
  ])('rejects nonmusical DOM before it can be mounted: %s', (markup) => {
    expect(() => parseSource(single.replace('<music-rest', `${markup}<music-rest`))).toThrow(ProjectValidationError);
    expect(document.querySelector('script, img, iframe, object')).toBeNull();
  });

  it.each(['onclick="alert(1)"', 'onpointerdown="alert(1)"', 'onunknown="alert(1)"', 'style="background:url(https://example.invalid)"',
    'src="https://example.invalid"', 'is="unsafe-component"', 'contenteditable', 'class="hidden"', 'unknown="value"'])('rejects unsafe or unsupported attributes: %s', (attribute) => {
    expect(() => parseSource(single.replace('label="Flute"', `label="Flute" ${attribute}`))).toThrow(/not allowed/);
  });

  it.each([
    single.replace('</music-rest>', ''),
    single.replace('<music-rest id="rest1" measure></music-rest>', '<music-rest id="rest1" measure/>'),
    single.replace('id="rest1"', 'id="rest1" id="different"'),
    single.replace('id="rest1"', 'id="m1"'),
    single.replace('id="rest1"', 'id="__proto__"'),
    single.replace('id="rest1"', 'id="bad id"'),
    `<html><body>${single}</body></html>`,
    `<!doctype html>${single}`,
    `${single}${single}`,
    `${single}outside text`,
    '<music-measure><music-rest measure></music-rest></music-measure>',
    `<!-- not closed ${single}`,
    single.replace('<music-rest', '<!-- x --!><script>window.compromised=1</script><!-- --><music-rest'),
  ])('rejects malformed, repaired, or ambiguous source', source => {
    expect(() => parseSource(source)).toThrow(ProjectValidationError);
  });

  it('keeps incomplete warnings but rejects underfull or overflowing accepted measures', () => {
    const short = '<music-staff><music-measure incomplete><music-note pitch="C4" duration="quarter"></music-note></music-measure></music-staff>';
    const project = createProject(short);
    expect(readScore(parseSource(project.sourceHtml)).diagnostics.map(item => item.code)).toContain('incomplete-measure');
    expect(() => createProject(short.replace(' incomplete', ''))).toThrow(/Voice contains/);
    expect(() => createProject(short.replace('duration="quarter"', 'duration="breve"'))).toThrow(/exceeds|overflow|contains/i);
  });

  it.each(['print-width="0"', 'print-width="Infinity"', 'max-measures="1.5"', 'measure-numbers="sometimes"', 'justify-last="false"'])('validates layout attributes also checked by the rendering surface: %s', attribute => {
    expect(() => parseSource(single.replace('label="Flute"', attribute))).toThrow(ProjectValidationError);
  });

  it('bounds source size and nesting before creating a DOM tree', () => {
    expect(() => parseSource(single + ' '.repeat(MAX_SOURCE_LENGTH))).toThrow(/limit/);
    expect(() => parseSource(`<music-staff><music-measure>${'<music-tuplet>'.repeat(40)}${'</music-tuplet>'.repeat(40)}</music-measure></music-staff>`)).toThrow(/nesting/);
  });
});

describe('portable project validation and normalization', () => {
  it('round-trips independent score/part settings, metadata, scopes, and unaccepted source', () => {
    const project = piano();
    project.metadata.composer = 'A composer';
    project.metadata.subtitle = 'At concert pitch';
    project.pendingSource = '<script>This is only an unaccepted text buffer</script>';
    project.layouts.piano.paper = 'a4';
    project.layouts.piano.marginMm = 20;
    project.layouts.piano.staffScale = 1.15;
    project.layouts.piano.breaks[project.columns[1].id] = 'page';
    project.layouts.piano.reviewedTurns[project.columns[1].id] = 'Reviewed by performer';
    const reopened = importProject(serializeProject(project));
    expect(reopened).toEqual(project);
    expect(reopened.layouts.score.paper).toBe('letter');
    expect(reopened.pendingSource).toContain('<script>');
  });

  it('does not share defaults or caller-owned part arrays', () => {
    const a = defaultLayout();
    const b = defaultLayout();
    a.breaks.test = 'page';
    expect(b.breaks).toEqual({});
    const parts = [{ id: 'flute', label: 'Flute', staffIds: ['staff'] }];
    const project = createProject(single, undefined, parts);
    parts[0].staffIds.push('bad');
    expect(project.parts[0].staffIds).toEqual(['staff']);
  });

  it('retains stable columns and their layout anchors after the first parallel staff is removed', () => {
    const project = piano();
    project.layouts.piano.breaks[project.columns[1].id] = 'line';
    const source = parseSource(project.sourceHtml);
    findSource(source, 'upper')!.remove();
    const next = normalizeProject(project, source);
    expect(next.columns.map(column => column.id)).toEqual(project.columns.map(column => column.id));
    expect(next.columns.map(column => column.measureIds)).toEqual([['l1'], ['l2']]);
    expect(next.parts[0].staffIds).toEqual(['lower']);
    expect(next.layouts.piano.breaks).toEqual(project.layouts.piano.breaks);
    expect(getProjectNotices(next).join(' ')).toMatch(/staff membership/);
    expect(project.parts[0].staffIds).toEqual(['upper', 'lower']);
    const snapshot = structuredClone(next);
    copyProjectNotices(next, snapshot);
    expect(getProjectNotices(snapshot)).toEqual(getProjectNotices(next));
    expect(importProject(serializeProject(next))).toEqual(next);
  });

  it('preserves column identity through coordinated reordering and generates it for newly added measures', () => {
    const project = piano();
    const source = parseSource(project.sourceHtml);
    for (const staff of source.children) staff.prepend(staff.lastElementChild!);
    const moved = normalizeProject(project, source);
    expect(moved.columns.map(column => column.id)).toEqual(project.columns.map(column => column.id).reverse());
    for (const [index, staff] of [...source.children].entries()) {
      const measure = source.ownerDocument.createElement('music-measure');
      measure.id = `added-${index}`;
      const rest = source.ownerDocument.createElement('music-rest');
      rest.setAttribute('measure', '');
      measure.append(rest);
      staff.append(measure);
    }
    const added = normalizeProject(moved, source);
    expect(added.columns.slice(0, 2)).toEqual(moved.columns);
    expect(moved.columns.some(column => column.id === added.columns[2].id)).toBe(false);
    expect(parseSource(added.sourceHtml).querySelectorAll('music-rest[id]').length).toBe(6);
  });

  it('rejects accidental recombination of previously aligned measure identities', () => {
    const project = piano();
    const source = parseSource(project.sourceHtml);
    const upper = findSource(source, 'upper')!;
    upper.prepend(upper.lastElementChild!);
    expect(() => normalizeProject(project, source)).toThrow(/different saved columns/);
  });

  it('never silently drops a removed measure’s authored layout choice', () => {
    const project = piano();
    const removedColumn = project.columns[1].id;
    project.layouts.score.breaks[removedColumn] = 'page';
    const source = parseSource(project.sourceHtml);
    findSource(source, 'u2')!.remove();
    findSource(source, 'l2')!.remove();
    expect(() => normalizeProject(project, source)).toThrow(/Clear or reconnect/);
    expect(project.layouts.score.breaks[removedColumn]).toBe('page');
    delete project.layouts.score.breaks[removedColumn];
    expect(normalizeProject(project, source).columns.map(column => column.id)).toEqual([project.columns[0].id]);
  });

  it('reports removed empty parts and rejects unresolved scope recipients', () => {
    const source = ensemble.replace('<music-rest id="ur1"', '<music-direction id="cue" text="Watch the soloist"></music-direction><music-rest id="ur1"');
    const project = createProject(source, 'Parts', [{ id: 'right', label: 'Right', staffIds: ['upper'] }, { id: 'left', label: 'Left', staffIds: ['lower'] }]);
    const root = parseSource(project.sourceHtml);
    findSource(root, 'lower')!.remove();
    const next = normalizeProject(project, root);
    expect(next.parts.map(part => part.id)).toEqual(['right']);
    expect(next.layouts.left).toBeUndefined();
    expect(getProjectNotices(next).join(' ')).toMatch(/empty part/);
    project.instructionScopes.cue = ['left'];
    expect(() => normalizeProject(project, root)).toThrow(/missing part/);
  });

  it('retains valid instruction scopes and rejects missing or non-annotation anchors', () => {
    const project = createProject(single.replace('<music-rest', '<music-rehearsal id="cue" text="A"></music-rehearsal><music-rest'));
    project.instructionScopes.cue = 'all';
    expect(importProject(serializeProject(project)).instructionScopes).toEqual({ cue: 'all' });
    const root = parseSource(project.sourceHtml);
    findSource(root, 'cue')!.remove();
    expect(() => normalizeProject(project, root)).toThrow(/no longer refers to an annotation/);
    project.instructionScopes.rest1 = 'all';
    expect(() => serializeProject(project)).toThrow(/annotation/);
  });

  it('removes obsolete short-measure review records with a notice', () => {
    const project = createProject(single.replace('<music-measure id="m1">', '<music-measure id="m1" incomplete>').replace('measure></music-rest>', 'duration="quarter"></music-rest>'));
    project.reviewedShortMeasures = ['m1'];
    expect(importProject(serializeProject(project)).reviewedShortMeasures).toEqual(['m1']);
    const root = parseSource(project.sourceHtml);
    findSource(root, 'rest1')!.setAttribute('duration', 'whole');
    const next = normalizeProject(project, root);
    expect(next.reviewedShortMeasures).toEqual([]);
    expect(getProjectNotices(next).join(' ')).toMatch(/review for short measure/);
  });

  it('retains a blank draft in project recovery without treating it as reviewed silence', () => {
    const project = createProject(single.replace('<music-measure id="m1">', '<music-measure id="m1" incomplete>').replace('measure></music-rest>', 'duration="quarter"></music-rest>'));
    project.reviewedShortMeasures = ['m1'];
    const root = parseSource(project.sourceHtml); findSource(root, 'rest1')!.remove();
    const next = normalizeProject(project, root);
    expect(next.reviewedShortMeasures).toEqual([]);
    expect(getProjectNotices(next).join(' ')).toMatch(/review for short measure/);
    const reopened = importProject(serializeProject(next));
    expect(reopened.sourceHtml).toBe(next.sourceHtml); expect(reopened.columns).toEqual(project.columns);
    expect(readScore(parseSource(reopened.sourceHtml)).score.staves[0].measures[0]).toMatchObject({ incomplete: true, voices: [{ events: [] }] });
    reopened.reviewedShortMeasures = ['m1'];
    expect(() => serializeProject(reopened)).toThrow(/not an incomplete short measure/);
  });

  it('rejects executable accepted source even when the project schema is otherwise valid', () => {
    expect(() => importProject(unsafeProject(project => { project.sourceHtml = project.sourceHtml.replace('<music-rest', '<script>alert(1)</script><music-rest'); }))).toThrow(/Only documented/);
  });

  it.each([
    (project: AuthorProject) => { (project as unknown as { version: number }).version = 2; },
    (project: AuthorProject) => { project.layouts.score.staffScale = 0; },
    (project: AuthorProject) => { project.layouts.score.maxMeasures = 2.5; },
    (project: AuthorProject) => { project.parts[0].staffIds = ['missing']; },
    (project: AuthorProject) => { project.parts[0].staffIds = ['staff', 'staff']; },
    (project: AuthorProject) => { project.columns[0].measureIds = ['rest1']; },
    (project: AuthorProject) => { project.layouts.score.keeps.missing = true; },
    (project: AuthorProject) => { project.reviewedShortMeasures = ['m1']; },
    (project: AuthorProject) => { (project as unknown as Record<string, unknown>).extra = 'unsupported'; },
    (project: AuthorProject) => { delete (project as Partial<AuthorProject>).metadata; },
  ])('strictly rejects invalid project structure and references', change => {
    expect(() => importProject(unsafeProject(change))).toThrow(ProjectValidationError);
  });

  it('rejects prototype keys, custom prototypes, accessors, cycles, and nonfinite data', () => {
    const raw = serializeProject(createProject(single));
    expect(() => importProject(raw.replace('"version": 1', '"__proto__": {"polluted": true}, "version": 1'))).toThrow(/not allowed/);
    expect(() => importProject(raw.replace('"breaks": {}', '"breaks": {"constructor":"page"}'))).toThrow(/not allowed/);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    const inherited = createProject(single);
    Object.setPrototypeOf(inherited.metadata, { title: 'injected' });
    expect(() => serializeProject(inherited)).toThrow(/custom prototypes/);
    const accessor = createProject(single);
    Object.defineProperty(accessor.metadata, 'title', { get() { throw new Error('must not be invoked'); }, enumerable: true });
    expect(() => serializeProject(accessor)).toThrow(/not allowed/);
    const cyclic = createProject(single);
    (cyclic as unknown as Record<string, unknown>).self = cyclic;
    expect(() => serializeProject(cyclic)).toThrow(/cycles/);
    const infinite = createProject(single);
    infinite.updatedAt = Infinity;
    expect(() => serializeProject(infinite)).toThrow(/finite/);
  });

  it('bounds portable file size and reports malformed JSON without modifying a valid project', () => {
    expect(() => importProject('x'.repeat(MAX_PROJECT_LENGTH + 1))).toThrow(/limit/);
    expect(() => importProject('{broken')).toThrow(/not valid project JSON/);
    const project = createProject(single);
    const before = JSON.stringify(project);
    expect(() => normalizeProject(project, document.createElement('script'))).toThrow(ProjectValidationError);
    expect(JSON.stringify(project)).toBe(before);
  });
});
